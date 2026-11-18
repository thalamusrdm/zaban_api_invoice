'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const PartLookup = require('../public/part-lookup');

function scannerUI(api, invoiceType = '2') {
  const rows = [], states = new WeakMap(), errors = [], timers = [];
  let focused, onInput;
  function addLine(partname = '') {
    const tr = { dataset: {}, isConnected: true, querySelector: selector => fields[selector],
      remove() { rows.splice(rows.indexOf(tr), 1); this.isConnected = false; } };
    const fields = {
      '.l-part': { value: partname, focus() { focused = this; }, select() {}, dispatchEvent(){onInput({target:this});}, closest: () => tr, classList: { contains: name => name === 'l-part' } },
      '.l-price': { value: '' }, '.l-grams': { value: '1' }, '.l-desc': {}, '.l-unit': {}, '.part-list': { hidden: true },
    };
    Object.defineProperty(fields['.l-part'], 'isConnected', { get: () => tr.isConnected });
    Object.defineProperty(tr, 'nextElementSibling', { get() { return rows[rows.indexOf(tr) + 1]; } });
    rows.push(tr); return tr;
  }
  const first = addLine();
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const source = html.slice(html.indexOf('async function resolvePartInput('), html.indexOf("tbody.addEventListener('focusout'"));
  const inputSource = html.slice(html.indexOf("tbody.addEventListener('input', e => {\n  const input"), html.indexOf("tbody.addEventListener('pointerdown'"));
  const ctx = { Event:class{constructor(type,options){this.type=type;Object.assign(this,options);}}, api, PartLookup, partState: states, clearTimeout() {}, setTimeout(fn) { timers.push(fn); return timers.length; },
    tbody: { rows, addEventListener(_type, fn) { onInput = fn; } }, partRow: input => input.closest('tr'), recalc() {},
    addLine, $: () => ({ value: invoiceType }),
    renderPartList(input, items) {
      const state = states.get(input) || {};
      Object.assign(state, { items, active: -1 }); states.set(input, state);
      input.closest('tr').querySelector('.part-list').hidden = false;
    },
    pickPart(input, index, focusQuantity) {
      assert.equal(focusQuantity, false);
      const p = states.get(input).items[index], tr = input.closest('tr');
      const state = states.get(input); state.revision = (state.revision || 0) + 1;
      input.value = p.PARTNAME; tr.dataset.selectedPart = p.PARTNAME;
      tr.dataset.selectedType = invoiceType;
      tr.querySelector('.l-price').value = p.BASEPLPRICE;
    },
    hidePartList(input) { input.closest('tr').querySelector('.part-list').hidden = true; },
    showMsg(_type, message) { errors.push(message); }, escapeHtml: String,
  };
  vm.runInNewContext(source + '\n' + inputSource, ctx);
  return { ctx, rows, errors, first, states,
    edit(input, value) { input.value = value; onInput({ target: input }); },
    runSearch() { return timers.pop()(); },
    get focused() { return focused; } };
}

test('rapid scanner Enter resolves barcode once then focuses exactly one new row', async () => {
  let resolve, calls = 0;
  const ui = scannerUI(url => { calls++; assert.match(url, /exact=1/); return new Promise(done => { resolve = done; }); });
  const input = ui.first.querySelector('.l-part'); input.value = '7290000000001';
  const first = ui.ctx.advanceScannedLine(input), repeated = ui.ctx.advanceScannedLine(input);
  resolve({ value: [{ PARTNAME: 'REAL-PART', BARCODE: input.value, BASEPLPRICE: 100 }] });
  await Promise.all([first, repeated]);
  assert.equal(calls, 1); assert.equal(input.value, 'REAL-PART'); assert.equal(ui.rows.length, 2);
  assert.equal(ui.focused, ui.rows[1].querySelector('.l-part'));
  await ui.ctx.advanceScannedLine(ui.focused);
  assert.equal(ui.rows.length, 2);
});

test('Enter advances to an empty SKU field while prices can be completed later', async () => {
  for (const invoiceType of ['1', '2', '4']) {
    const ui = scannerUI(async () => ({ value: [{ PARTNAME: 'TEST-PART' }] }), invoiceType);
    const input = ui.first.querySelector('.l-part');
    input.value = 'TEST-PART';
    await ui.ctx.advanceScannedLine(input);
    assert.equal(ui.rows.length, 2);
    assert.equal(ui.focused, ui.rows[1].querySelector('.l-part'));
    assert.equal(ui.focused.value, '');
    assert.equal(ui.errors.length, 0);
    await ui.ctx.advanceScannedLine(input);
    assert.equal(ui.rows.length, 2);
  }
});

test('unknown or ambiguous scans keep the current row and never create blank duplicates', async () => {
  for (const value of [[], [{ PARTNAME: 'A', BASEPLPRICE: 100 }, { PARTNAME: 'B', BASEPLPRICE: 100 }]]) {
    const ui = scannerUI(async () => ({ value }));
    const input = ui.first.querySelector('.l-part'); input.value = 'SCAN';
    await ui.ctx.advanceScannedLine(input);
    assert.equal(ui.rows.length, 1); assert.equal(ui.focused, input); assert.equal(ui.errors.length, 1);
  }
});

test('barcode collisions and a lone unrelated result never select a product automatically', async () => {
  for (const response of [
    { value: [{ PARTNAME: 'CODE', BARCODE: 'OTHER' }, { PARTNAME: 'SECOND', BARCODE: 'CODE' }] },
    { value: [{ PARTNAME: 'UNRELATED', BARCODE: 'OTHER' }] },
    { value: [{ PARTNAME: 'CODE' }], truncated: true },
  ]) {
    const ui = scannerUI(async () => response, '4');
    const input = ui.first.querySelector('.l-part'); input.value = 'CODE';
    await ui.ctx.advanceScannedLine(input);
    assert.equal(ui.rows.length, 1);
    assert.equal(ui.first.dataset.selectedPart, undefined);
    assert.equal(input.value, 'CODE');
    assert.equal(ui.errors.length, 1);
  }
});

test('an ambiguous barcode can be resolved by explicitly choosing the intended product', async () => {
  let calls = 0;
  const ui = scannerUI(async () => {
    calls++;
    return { value: [{ PARTNAME: 'FIRST', BARCODE: 'CODE' }, { PARTNAME: 'SECOND', BARCODE: 'CODE' }] };
  });
  const input = ui.first.querySelector('.l-part'); input.value = 'CODE';
  await ui.ctx.advanceScannedLine(input);
  ui.states.get(input).active = 1;
  await ui.ctx.advanceScannedLine(input);
  assert.equal(input.value, 'SECOND');
  assert.equal(ui.rows.length, 2);
  assert.equal(calls, 1);
});

test('editing during a pending scan rejects the old response without locking the new scan', async () => {
  const pending = [];
  const ui = scannerUI(url => new Promise(resolve => pending.push({ url, resolve })), '4');
  const input = ui.first.querySelector('.l-part');
  ui.edit(input, 'FIRST');
  const first = ui.ctx.advanceScannedLine(input);
  ui.edit(input, 'SECOND');
  const second = ui.ctx.advanceScannedLine(input);
  pending[1].resolve({ value: [{ PARTNAME: 'SECOND' }] }); await second;
  pending[0].resolve({ value: [{ PARTNAME: 'FIRST' }] }); await first;
  assert.equal(input.value, 'SECOND');
  assert.equal(ui.rows.length, 2);
  assert.equal(ui.first.dataset.selectedPart, 'SECOND');
});

test('autocomplete ignores an old response even when the user returns to the same query', async () => {
  const pending = [];
  const ui = scannerUI(() => new Promise(resolve => pending.push(resolve)));
  const input = ui.first.querySelector('.l-part');
  ui.edit(input, 'A');
  const old = ui.runSearch();
  ui.edit(input, 'B');
  ui.edit(input, 'A');
  const current = ui.runSearch();
  pending[1]({ value: [{ PARTNAME: 'A-NEW' }] }); await current;
  pending[0]({ value: [{ PARTNAME: 'A-OLD' }] }); await old;
  assert.equal(ui.states.get(input).items[0].PARTNAME, 'A-NEW');
});

test('scan errors can be retried, and an untouched empty trailing row is excluded from review', async () => {
  let calls = 0;
  const ui = scannerUI(async () => {
    if (++calls === 1) throw new Error('offline');
    return { value: [{ PARTNAME: 'TEST' }] };
  });
  const input = ui.first.querySelector('.l-part'); input.value = 'TEST';
  await ui.ctx.advanceScannedLine(input);
  assert.equal(ui.rows.length, 1);
  await ui.ctx.advanceScannedLine(input);
  assert.equal(ui.rows.length, 2);
  assert.equal(await ui.ctx.validateProductSelections(), true);
  assert.equal(ui.rows.length, 1);
  assert.equal(calls, 2);
});


test('review removes untouched blank rows between selected products and at the start or end', async () => {
  const ui=scannerUI(async url=>({value:[{PARTNAME:new URL(url,'http://test').searchParams.get('q')}]}),'4');
  // The scanner can leave an empty row before another product is added manually.
  ui.first.querySelector('.l-part').value='';
  const first=ui.ctx.addLine('FIRST');
  ui.ctx.addLine('');ui.ctx.addLine('');
  const second=ui.ctx.addLine('SECOND');
  ui.ctx.addLine('');
  assert.equal(await ui.ctx.validateProductSelections(),true);
  assert.deepEqual(ui.rows,[first,second]);
  assert.equal(first.querySelector('.l-part').value,'FIRST');
  assert.equal(second.querySelector('.l-part').value,'SECOND');
});

test('review keeps incomplete rows with entered quantity, price or a line discount', async () => {
  for(const kind of ['quantity','price','discount']){
    const ui=scannerUI(async()=>({value:[{PARTNAME:'FIRST'}]}));
    ui.first.querySelector('.l-part').value='FIRST';
    const partial=ui.ctx.addLine('');
    if(kind==='quantity')partial.querySelector('.l-grams').value='2';
    if(kind==='price')partial.querySelector('.l-price').value='50';
    if(kind==='discount')partial.dataset.discountEdited='true';
    assert.equal(await ui.ctx.validateProductSelections(),false);
    assert.equal(ui.rows.length,2);
    assert.equal(ui.rows[1],partial);
    assert.match(ui.errors.at(-1),/שורה ללא מוצר/);
  }
});


test('camera barcode fills an empty SKU through exact lookup and focuses the next SKU once',async()=>{
  let calls=0;
  const ui=scannerUI(async()=>{calls++;return {value:[{PARTNAME:'REAL-PART',BARCODE:'001234',BASEPLPRICE:200}]};},'4');
  assert.equal(await ui.ctx.receiveCameraBarcode('001234'),true);
  assert.equal(ui.first.querySelector('.l-part').value,'REAL-PART');
  assert.equal(calls,1);assert.equal(ui.rows.length,2);
  assert.equal(ui.focused,ui.rows[1].querySelector('.l-part'));
});
test('camera scan preserves partially entered rows and rejects invalid codes before lookup',async()=>{
  const ui=scannerUI(async()=>({value:[{PARTNAME:'SCANNED'}]}),'2');
  ui.first.querySelector('.l-grams').value='2';
  await ui.ctx.receiveCameraBarcode('SCANNED');
  assert.equal(ui.first.querySelector('.l-part').value,'');
  assert.equal(ui.first.querySelector('.l-grams').value,'2');
  assert.equal(ui.rows[1].querySelector('.l-part').value,'SCANNED');
  const count=ui.rows.length;
  assert.equal(await ui.ctx.receiveCameraBarcode('x'.repeat(129)),false);
  assert.equal(ui.rows.length,count);
});
test('camera scan reuses the untouched default gold row instead of leaving a price-less product',async()=>{
  const ui=scannerUI(async()=>({value:[{PARTNAME:'14',BARCODE:'140000'}]}),'1');
  ui.first.querySelector('.l-part').value='14';ui.first.dataset.displayPart='14';
  assert.equal(await ui.ctx.receiveCameraBarcode('140000'),true);
  assert.equal(ui.first.querySelector('.l-part').value,'14');
  assert.equal(ui.rows.length,2);
  assert.equal(ui.rows[1].querySelector('.l-part').value,'');
});
