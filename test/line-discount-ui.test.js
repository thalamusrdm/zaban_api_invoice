'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const InvoiceCalculations = require('../public/invoice-calculations');

test('global discount synchronizes both controls and all rows; line edits still calculate once', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const listeners = {};
  const elements = { discount: { value: '85', addEventListener(type, fn) { listeners.defaultInput = fn; } }, discountBottom: {value:'85',addEventListener(type,fn){listeners.bottomInput=fn;}}, tBefore: {}, tVat: {}, tTotal: {},
    productsQuantity: {}, productsAmount: {}, invoiceType: { value: '4' } };
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
  assert.equal(first.querySelector('.l-discount').value, '90');
  assert.equal(second.querySelector('.l-discount').value, '90');
  assert.equal(elements.discountBottom.value, '90');
  assert.equal(first.dataset.discountEdited, undefined);
  assert.ok(Math.abs(elements.tBefore.textContent - 895.68) < 1e-8);
  assert.ok(Math.abs(elements.tTotal.textContent - 1056.9024) < 1e-8);
  elements.discountBottom.value = '75'; listeners.bottomInput({target:elements.discountBottom});
  assert.equal(elements.discount.value, '75');
  assert.equal(first.querySelector('.l-discount').value, '75');
  assert.equal(second.querySelector('.l-discount').value, '75');
  assert.ok(Math.abs(elements.tBefore.textContent - 2239.2) < 1e-8);
  assert.equal(elements.productsQuantity.textContent, '2');
  assert.equal(elements.productsAmount.textContent, elements.tBefore.textContent);
  elements.invoiceType.value = '1';
  listeners.defaultInput();
  assert.equal(elements.productsQuantity.textContent, '2 גרם');
});


test('new product rows inherit the current global discount before and after products are entered', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const source = html.slice(html.indexOf('function addLine('), html.indexOf("$('addLine').addEventListener"));
  for (const invoiceType of ['1', '2', '4']) {
    const rows = [], elements = {invoiceType:{value:invoiceType},discount:{value:'15'}};
    const document = {createElement(){
      const fields = {};
      return {dataset:{},isConnected:true,
        set innerHTML(value){for(const input of value.matchAll(/<input\b([^>]+)>/g)){const cls=/class="([^"]+)"/.exec(input[1])?.[1], val=/value="([^"]*)"/.exec(input[1])?.[1] || '';if(cls)fields['.'+cls]={value:val,focus(){},select(){}};}},
        querySelector(selector){return fields[selector];}};
    }};
    const ctx = {document,$:id=>elements[id],tbody:{appendChild(row){rows.push(row);}},setLineExchange(){},recalc(){},escapeHtml:String,api:async()=>({value:[]})};
    vm.runInNewContext(source,ctx);
    const first=ctx.addLine('TEST');
    assert.equal(first.querySelector('.l-discount').value,'15');
    elements.discount.value='30';
    const second=ctx.addLine('NEXT');
    assert.equal(second.querySelector('.l-discount').value,'30');
    assert.equal(first.querySelector('.l-discount').value,'15');
    assert.equal(rows.length,2);
  }
});
