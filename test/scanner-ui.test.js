'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function scannerUI(api) {
  const rows = [], states = new WeakMap(), errors = [];
  let focused;
  function addLine() {
    const tr = { dataset: {}, isConnected: true, querySelector: selector => fields[selector] };
    const fields = { '.l-part': { value: '', focus() { focused = this; }, select() {}, closest: () => tr }, '.l-price': { value: '' }, '.part-list': { hidden: true } };
    Object.defineProperty(tr, 'nextElementSibling', { get() { return rows[rows.indexOf(tr) + 1]; } });
    rows.push(tr); return tr;
  }
  const first = addLine();
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const source = html.slice(html.indexOf('async function advanceScannedLine('), html.indexOf("tbody.addEventListener('focusout'"));
  const ctx = { api, partState: states, clearTimeout, addLine, $: () => ({ value: '2' }),
    renderPartList(input, items) { states.set(input, { items, active: -1 }); },
    pickPart(input, index) { const p = states.get(input).items[index], tr = input.closest('tr'); input.value = p.PARTNAME; tr.dataset.selectedPart = p.PARTNAME; tr.querySelector('.l-price').value = p.BASEPLPRICE; },
    hidePartList() {}, showMsg(_type, message) { errors.push(message); }, escapeHtml: String,
  };
  vm.runInNewContext(source, ctx);
  return { ctx, rows, errors, first, get focused() { return focused; } };
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

test('unknown or ambiguous scans keep the current row and never create blank duplicates', async () => {
  for (const value of [[], [{ PARTNAME: 'A', BASEPLPRICE: 100 }, { PARTNAME: 'B', BASEPLPRICE: 100 }]]) {
    const ui = scannerUI(async () => ({ value }));
    const input = ui.first.querySelector('.l-part'); input.value = 'SCAN';
    await ui.ctx.advanceScannedLine(input);
    assert.equal(ui.rows.length, 1); assert.equal(ui.focused, input); assert.equal(ui.errors.length, 1);
  }
});
