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
    return { date: new URL(url, 'http://local').searchParams.get('date'), rates: { USD: { rate: 3.11, rateDate: '2026-10-19' }, '$': { rate: 3.12, rateDate: '2026-10-19' } } };
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
  const ui = exchangeUI(url => new Promise(resolve => { pending[url.split('=')[1]] = resolve; }));
  const field = ui.addRow('USD');
  const first = ui.ctx.load();
  ui.elements.date.value = '2026-10-19'; const second = ui.ctx.load();
  pending['2026-10-19']({ date: '2026-10-19', rates: { USD: { rate: 3.2, rateDate: '2026-10-19' } } }); await second;
  pending['2026-10-20']({ date: '2026-10-20', rates: { USD: { rate: 9, rateDate: '2026-10-20' } } }); await first;
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
