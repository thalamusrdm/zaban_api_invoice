'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function exchangeUI(api) {
  const rows = [];
  const elements = {
    lines: { querySelector: () => ({ rows }) },
    date: { value: '2026-10-20', validity: { valid: true }, addEventListener() {} },
    exchangeStatus: { textContent: '' },
    retryExchangeRates: { hidden: true, addEventListener(name, fn) { this[name] = fn; } },
    useBoiRates: { checked: true, addEventListener() {} },
    invoiceType: { value: '2', addEventListener() {} },
  };
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const block = html.slice(html.indexOf("const tbody = $('lines')"), html.indexOf('function addLine('));
  const ctx = { api, $: id => elements[id], recalc() {} };
  vm.runInNewContext(block + '\nthis.load = loadExchangeRates; this.setLine = setLineExchange;', ctx);
  return { ctx, elements, addRow(currency) {
    const fields = { '.l-currency': { value: currency }, '.l-exchange': { value: '' } };
    const row = { querySelector: selector => fields[selector] };
    rows.push(row); ctx.setLine(row); return fields['.l-exchange'];
  } };
}

test('opening loads once; new rows, currency switches and cached dates reuse the rate', async () => {
  let calls = 0;
  const ui = exchangeUI(async url => {
    calls++;
    return { source: 'bank-of-israel', date: new URL(url, 'http://local').searchParams.get('date'), rates: { USD: { rate: 3.11, rateDate: '2026-10-19' }, '$': { rate: 3.12, rateDate: '2026-10-19' } } };
  });
  await ui.ctx.load();
  for (let i = 0; i < 10; i++) assert.equal(Number(ui.addRow('USD').value), 3.1722);
  assert.equal(Number(ui.addRow('$').value), 3.1824);
  assert.equal(Number(ui.addRow('ש"ח').value), 1);
  await ui.ctx.load();
  assert.equal(calls, 1);
  ui.elements.date.value = '2026-10-18'; await ui.ctx.load();
  assert.equal(calls, 2);
  ui.elements.date.value = '2026-10-20'; await ui.ctx.load();
  assert.equal(calls, 2);
});

test('out of order date responses cannot fill a rate for the wrong invoice date', async () => {
  const pending = {};
  const ui = exchangeUI(url => new Promise(resolve => { pending[new URL(url, 'http://local').searchParams.get('date')] = resolve; }));
  const field = ui.addRow('USD');
  const first = ui.ctx.load();
  ui.elements.date.value = '2026-10-19'; const second = ui.ctx.load();
  pending['2026-10-19']({ source: 'bank-of-israel', date: '2026-10-19', rates: { USD: { rate: 3.2, rateDate: '2026-10-19' } } }); await second;
  pending['2026-10-20']({ source: 'bank-of-israel', date: '2026-10-20', rates: { USD: { rate: 9, rateDate: '2026-10-20' } } }); await first;
  assert.equal(Number(field.value), 3.264);
});

test('failed loading clears old rates and keeps the rate locked without retrying per row', async () => {
  let calls = 0;
  const ui = exchangeUI(async () => { calls++; throw new Error('offline'); });
  await ui.ctx.load();
  const field = ui.addRow('USD');
  assert.equal(field.value, ''); assert.equal(field.readOnly, true);
  assert.match(ui.elements.exchangeStatus.textContent, /offline/);
  ui.addRow('USD'); assert.equal(calls, 1);
});

test('switching sources separates caches and ignores the previous in-flight source', async () => {
  const pending = {}; let calls = 0;
  const ui = exchangeUI(url => new Promise(resolve => { calls++; pending[new URL(url, 'http://local').searchParams.get('source')] = resolve; }));
  const field = ui.addRow('$'); const first = ui.ctx.load();
  ui.elements.useBoiRates.checked = false; const second = ui.ctx.load();
  pending.priority({ source: 'priority', date: '2026-10-20', rates: { USD: { rate: 3.11, rateDate: '2026-10-19' }, '$': { rate: 3.22422, rateDate: '2026-10-19' } } }); await second;
  pending.boi({ source: 'bank-of-israel', date: '2026-10-20', rates: { USD: { rate: 3.11, rateDate: '2026-10-19' }, '$': { rate: 3.11, rateDate: '2026-10-19' } } }); await first;
  assert.equal(Number(field.value), 3.22422);
  ui.elements.useBoiRates.checked = true; await ui.ctx.load();
  assert.equal(Number(field.value), 3.1722); assert.equal(calls, 2);
  ui.elements.invoiceType.value = '4';
  await ui.ctx.load();
  assert.equal(Number(field.value), 3.1722); assert.equal(calls, 2);
  assert.match(ui.elements.exchangeStatus.textContent, /בתוספת 2%/);
  ui.elements.useBoiRates.checked = false;
  await ui.ctx.load();
  assert.equal(Number(field.value), 3.22422); assert.equal(calls, 2);
});

test('a failed rate request can be retried in place and fills existing lines without losing invoice data', async () => {
 let calls=0;const ui=exchangeUI(async()=>{if(++calls===1)throw new Error('temporary outage');return {date:'2026-10-20',source:'bank-of-israel',rates:{USD:{rate:3.11,rateDate:'2026-10-19'}}};});
 const field=ui.addRow('USD');await ui.ctx.load();assert.equal(field.value,'');assert.equal(ui.elements.retryExchangeRates.hidden,false);
 await ui.elements.retryExchangeRates.click();assert.equal(calls,2);assert.equal(Number(field.value),3.1722);assert.equal(ui.elements.retryExchangeRates.hidden,true);
 await ui.ctx.load();assert.equal(calls,2);
});
test('simultaneous attempts reuse one request and a late failed source does not erase a newer source',async()=>{
 const pending={};let calls=0;const ui=exchangeUI(url=>{calls++;return new Promise((resolve,reject)=>pending[new URL(url,'http://local').searchParams.get('source')]={resolve,reject});});
 const field=ui.addRow('USD');const a=ui.ctx.load(),b=ui.ctx.load();assert.equal(calls,1);
 ui.elements.useBoiRates.checked=false;const c=ui.ctx.load();pending.priority.resolve({date:'2026-10-20',source:'priority',rates:{USD:{rate:3.1,rateDate:'2026-10-19'}}});await c;
 pending.boi.reject(new Error('offline'));await Promise.all([a,b]);assert.equal(Number(field.value),3.1);assert.equal(ui.elements.retryExchangeRates.hidden,true);
});
