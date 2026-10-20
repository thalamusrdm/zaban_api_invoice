'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function goldUI(api) {
  const rows = [], elements = { date: { value: '2026-10-20', validity: { valid: true }, addEventListener() {} }, invoiceType: { value: '1', addEventListener() {} }, goldStatus: {} };
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const ctx = { api, Intl, Date, $: id => elements[id], tbody: { rows }, recalc() {}, setLineExchange(tr) { tr.fxCurrency = tr.querySelector('.l-currency').value; } };
  vm.runInNewContext(html.slice(html.indexOf('const goldRequests ='), html.indexOf('function addLine(')) + '\nthis.load = loadGoldPrices; this.fill = setGoldLinePrice;', ctx);
  return { ctx, elements, add(part) {
    const fields = { '.l-price': {}, '.l-currency': {}, '.l-desc': {} };
    const tr = { dataset: { goldPart: part, partDescription: 'Gold' }, querySelector: s => fields[s] };
    rows.push(tr); ctx.fill(tr); return fields;
  } };
}
const quote = date => ({ date, updatedAt: '2026-10-20T15:44:00+03:00', prices: { '14': { price: 78.36, currency: '$' }, '18': { price: 100.46, currency: '$' }, F: { price: 132.48, currency: '$' } } });
test('one gold quote serves all rows without fetching per row or applying FX to the dollar price', async () => {
  let calls = 0; const ui = goldUI(async () => { calls++; return quote('2026-10-20'); });
  const first = ui.add('14'); await ui.ctx.load();
  assert.equal(first['.l-price'].value, 78.36);
  assert.equal(ui.add('18')['.l-price'].value, 100.46);
  assert.equal(ui.add('F')['.l-price'].value, 132.48);
  await ui.ctx.load(); assert.equal(calls, 1);
});
test('old-date responses cannot replace new gold prices and failed loading clears the price', async () => {
  const pending = {}; const ui = goldUI(url => new Promise((resolve, reject) => { pending[new URL(url, 'http://local').searchParams.get('date')] = { resolve, reject }; }));
  const field = ui.add('14')['.l-price']; const old = ui.ctx.load();
  ui.elements.date.value = '2026-10-19'; const newer = ui.ctx.load();
  pending['2026-10-19'].resolve(quote('2026-10-19')); await newer;
  pending['2026-10-20'].resolve({ ...quote('2026-10-20'), prices: { '14': { price: 999 } } }); await old;
  assert.equal(field.value, 78.36);
  ui.elements.date.value = '2026-10-18'; const failed = ui.ctx.load();
  assert.equal(field.value, ''); pending['2026-10-18'].reject(new Error('offline')); await failed;
  assert.equal(field.value, ''); assert.match(ui.elements.goldStatus.textContent, /offline/);
});
