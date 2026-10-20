'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const InvoiceCalculations = require('../public/invoice-calculations');

test('default discounts seed unedited rows; overrides calculate from full price once', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const listeners = {};
  const elements = { discount: { value: '85', addEventListener(type, fn) { listeners.defaultInput = fn; } }, tBefore: {}, tVat: {}, tTotal: {} };
  function row(discount) {
    const tr = { dataset: {}, querySelector: selector => fields[selector] };
    const fields = Object.fromEntries(Object.entries({ '.l-part': 'TEST', '.l-grams': '1', '.l-price': '1440', '.l-currency': 'USD', '.l-exchange': '3.11', '.l-discount': discount, '.l-total': '' })
      .map(([selector, value]) => [selector, { value, closest: () => tr, classList: { contains: cls => '.' + cls === selector } }]));
    return tr;
  }
  const first = row('0'), second = row('0');
  const tbody = { rows: [first, second], addEventListener(type, fn) { listeners[type] = fn; } };
  const handlersStart = html.indexOf("tbody.addEventListener('input', e => {");
  const handlers = html.slice(handlersStart, html.indexOf("$('invoiceType').addEventListener('change'", handlersStart));
  const calculations = html.slice(html.indexOf('function readLines()'), html.indexOf('\naddLine();\nloadExchangeRates();'));
  vm.runInNewContext(calculations + '\n' + handlers, { tbody, $: id => elements[id], InvoiceCalculations, VAT_RATE: 0.18, fmt: n => n, setLineExchange() {} });
  listeners.defaultInput();
  assert.equal(first.querySelector('.l-discount').value, '85');
  assert.ok(Math.abs(elements.tBefore.textContent - 1343.52) < 1e-8);
  first.querySelector('.l-discount').value = '80';
  listeners.input({ target: first.querySelector('.l-discount') });
  assert.ok(Math.abs(first.querySelector('.l-total').textContent - 895.68) < 1e-8);
  elements.discount.value = '90'; listeners.defaultInput();
  assert.equal(first.querySelector('.l-discount').value, '80');
  assert.equal(second.querySelector('.l-discount').value, '90');
  assert.ok(Math.abs(elements.tBefore.textContent - 1343.52) < 1e-8);
  assert.ok(Math.abs(elements.tTotal.textContent - 1585.3536) < 1e-8);
});
