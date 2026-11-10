'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { lineTotal } = require('../public/invoice-calculations');
const { buildInvoicePayload } = require('../invoice-payload');

test('gold rows use a manual shekel price, without requesting a gold quote or FX', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const rows = [];
  const fields = {
    '.l-part': { value: '14' }, '.l-grams': { value: '2.5', focus() {} },
    '.l-price': { value: '123.40' }, '.l-currency': { value: 'ש"ח' },
    '.l-exchange': {}, '.l-discount': { value: '0' }, '.l-unit': {}, '.l-desc': {},
  };
  const row = { isConnected: true, querySelector: selector => fields[selector] };
  const elements = {
    lines: { querySelector: () => ({ rows, appendChild: tr => rows.push(tr) }) },
    date: { value: '2026-11-10', addEventListener() {} },
    discount: { value: '0' }, useBoiRates: { checked: false, addEventListener() {} },
    invoiceType: { value: '1' },
  };
  const calls = [];
  const ctx = { $: id => elements[id], document: { createElement: () => row }, escapeHtml: String,
    api: async url => { calls.push(url); return { value: [{ PARTNAME: '14', PARTDES: 'Gold', BASEPLPRICE: 76.58, BASEPLCODE: '$' }] }; },
  };
  const section = (start, end) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
  vm.runInNewContext(section("const tbody = $('lines')", "$('addLine').addEventListener") +
    section('function readLines()', 'function recalc()') + section('function applyPartPrice(', "tbody.addEventListener('input', e => {\n  const input"), ctx);
  ctx.addLine();
  await ctx.loadExchangeRates();
  ctx.applyPartPrice(row, { BASEPLPRICE: 100, BASEPLCODE: 'USD' });
  assert.match(row.innerHTML, /aria-label="מחיר בש״ח לגרם"/);
  assert.doesNotMatch(row.innerHTML.match(/<input class="l-price"[^>]+>/)[0], /readonly/);
  assert.match(row.innerHTML, /<option value="ש&quot;ח">/);
  assert.equal(fields['.l-price'].value, '123.40');
  assert.equal(fields['.l-unit'].textContent, 'גרם');
  assert.deepEqual(calls, ['/api/parts?q=14&invoiceType=1']);
  const lines = ctx.readLines();
  assert.equal(lineTotal(lines[0]), 308.5);
  const [item] = buildInvoicePayload({ custname: 'TEST', date: '2026-11-10', invoiceType: '1', lines }, 'API').AINVOICEITEMS_SUBFORM;
  assert.equal(item.TQUANT, 2.5);
  assert.equal(item.PRICE, 123.4);
  assert.equal(item.ICODE, 'ש"ח');
  assert.equal(item.EXCH, 1);
});
