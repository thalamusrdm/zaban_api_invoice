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
  for (let i = 0; i < 10; i++) assert.equal(Number(ui.addRow('USD').value), 3.11);
  assert.equal(Number(ui.addRow('$').value), 3.12);
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
  assert.equal(Number(field.value), 3.2);
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
  pending.priority({ source: 'priority', date: '2026-10-20', rates: { USD: { rate: 3.11, rateDate: '2026-10-19' }, '$': { rate: 3.1722, rateDate: '2026-10-19' } } }); await second;
  pending.boi({ source: 'bank-of-israel', date: '2026-10-20', rates: { USD: { rate: 3.11, rateDate: '2026-10-19' }, '$': { rate: 3.11, rateDate: '2026-10-19' } } }); await first;
  assert.equal(Number(field.value), 3.1722);
  ui.elements.useBoiRates.checked = true; await ui.ctx.load();
  assert.equal(Number(field.value), 3.11); assert.equal(calls, 2);
});
