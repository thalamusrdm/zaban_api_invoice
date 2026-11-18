'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const CustomerTax = require('../public/customer-tax');

function identifier(firstEight) {
  for (let digit = 0; digit < 10; digit++) {
    const value = firstEight + digit;
    if (CustomerTax.validNumber(value)) return value;
  }
  throw Error('Invalid test identifier');
}
const individual = identifier('01234567'), company = identifier('51234567');

test('only checksum-valid domestic company and individual identifiers receive automatic explanations', () => {
  for (const prefix of ['51', '52']) assert.equal(CustomerTax.infer({ WTAXNUM: identifier(prefix + '234567') }).value, '2');
  for (const prefix of ['0', '1', '2', '3']) assert.equal(CustomerTax.infer({ WTAXNUM: identifier(prefix + '1234567') }).value, '1');
  for (const value of ['', '000000000', company.slice(0, 8), company + '1', company.slice(0, 8) + ((Number(company[8]) + 1) % 10), 'IL' + individual]) {
    assert.equal(CustomerTax.infer({ WTAXNUM: value }), null, value);
  }
  for (const prefix of ['4', '53', '54', '55', '56', '57', '58', '6', '7', '8', '9']) {
    assert.equal(CustomerTax.infer({ WTAXNUM: identifier(prefix.padEnd(8, '1')) }), null, prefix);
  }
});

test('existing explanations are preserved and VAT number or customer name alone never determines VAT status', () => {
  for (const code of ['1', '2', '3', '4', '5', '9', 'unknown']) {
    assert.equal(CustomerTax.infer({ WTAXNUM: company, WTAXNUMEXPL: code }), null);
  }
  assert.equal(CustomerTax.infer({ VATNUM: company, CUSTDES: 'חברה בע״מ' }), null);
  assert.equal(CustomerTax.infer({ WTAXNUM: individual, VATNUM: individual }).value, '1');
  assert.equal(CustomerTax.infer({ WTAXNUM: ' ' + company + ' ', WTAXNUMEXPL: ' ' }).value, '2');
});

function sdkFixture(overrides = {}, options = {}) {
  const row = { CUSTNAME: 'TEST', CUSTDES: 'Test customer', STATDES: 'פעיל', EMAIL: 'test@example.com',
    EDOCUMENTS: 'Y', WTAXNUM: company, VATNUM: company, WTAXNUMEXPL: '', ...overrides };
  const calls = [], sdkModule = { exports: {} };
  let reads = 0;
  const sdk = {
    async login() {},
    async formStart(_name, onMessage) {
      const pending = {};
      return {
        columns: { EMAIL: {}, EDOCUMENTS: {}, PHONE: {}, WTAXNUMEXPL: { mandatory: 1, readonly: 0, type: 'char' }, ...options.columns },
        async setSearchFilter() {},
        async getRows() { reads++; return { CUSTOMERS: { 1: { ...row } } }; },
        async setActiveRow() { calls.push('activate'); },
        async fieldUpdate(field, value) {
          calls.push([field, value]); pending[field] = value;
          if (options.fieldError) onMessage({ type: 'error', message: 'Field rejected' });
        },
        async saveRow() { calls.push('save'); if (!options.discard) Object.assign(row, pending); },
        async endCurrentForm() { calls.push('close'); },
      };
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../priority-sdk.js'), 'utf8'), {
    require(name) {
      if (name === 'priority-web-sdk') return sdk;
      if (name === './public/customer-tax') return CustomerTax;
      throw Error('Unexpected dependency: ' + name);
    },
    module: sdkModule, process: { env: { PRIORITY_BASE_URL: 'https://priority.invalid/odata/tabula.ini/test' } },
    setTimeout: () => ({ unref() {} }), console,
  });
  return { sdk: sdkModule.exports, calls, row, get reads() { return reads; } };
}

test('reading a customer performs no tax or other field updates', async () => {
  const fixture = sdkFixture();
  const result = await fixture.sdk.digitalCustomerForm('TEST');
  assert.equal(result.numberExplanation, '');
  assert.equal(fixture.calls.filter(Array.isArray).length, 0);
  assert.ok(!fixture.calls.includes('save'));
});

test('saving a customer fills a mandatory missing explanation even when email and digital status are already correct', async () => {
  for (const [number, code] of [[company, '2'], [individual, '1']]) {
    const fixture = sdkFixture({ WTAXNUM: number, VATNUM: number });
    const saved = await fixture.sdk.prepareDigitalCustomer('TEST', 'test@example.com');
    assert.equal(saved.numberExplanation, code);
    assert.equal(saved.requiredMissing.length, 0);
    assert.deepEqual(fixture.calls.filter(Array.isArray), [['WTAXNUMEXPL', code]]);
    assert.equal(fixture.reads, 2, 'must read back after saving');
    await fixture.sdk.prepareDigitalCustomer('TEST', 'test@example.com');
    assert.equal(fixture.calls.filter(c => c === 'save').length, 1, 'a repeated save is a no-op');
  }
});

test('automatic explanation is saved together with changed email and phone and electronic consent', async () => {
  const fixture = sdkFixture({ EMAIL: '', PHONE: '0501111111', EDOCUMENTS: '' });
  const result = await fixture.sdk.prepareDigitalCustomer('TEST', 'new@example.com', '0522222222');
  assert.equal(result.numberExplanation, '2');
  assert.equal(result.email, 'new@example.com');
  assert.equal(result.phone, '0522222222');
  assert.equal(result.digital, true);
  assert.equal(fixture.calls.filter(c => c === 'save').length, 1);
});

test('live existing explanation is preserved even if it differs from identifier inference', async () => {
  const fixture = sdkFixture({ WTAXNUMEXPL: '3' });
  const result = await fixture.sdk.prepareDigitalCustomer('TEST', 'new@example.com');
  assert.equal(result.numberExplanation, '3');
  assert.deepEqual(fixture.calls.filter(Array.isArray), [['EMAIL', 'new@example.com']]);
});

test('unidentifiable numbers, blocked customers and other required fields are never bypassed', async () => {
  for (const value of ['', '123456789', identifier('58234567')]) {
    const fixture = sdkFixture({ WTAXNUM: value });
    await assert.rejects(fixture.sdk.prepareDigitalCustomer('TEST', 'test@example.com'), /שדות חובה/);
    assert.equal(fixture.calls.filter(Array.isArray).length, 0);
  }
  const blocked = sdkFixture({ STATDES: 'לא פעיל' });
  await assert.rejects(blocked.sdk.prepareDigitalCustomer('TEST', 'test@example.com'), /אינו פעיל/);
  const missing = sdkFixture({}, { columns: { BUSINESSTYPE: { mandatory: 1, readonly: 0, type: 'char', title: 'תחום עיסוק' } } });
  await assert.rejects(missing.sdk.prepareDigitalCustomer('TEST', 'test@example.com'), /תחום עיסוק/);
  assert.ok(!missing.calls.includes('save'));
});

test('unavailable explanation field, rejected field updates and failed persistence cannot report success', async () => {
  for (const columns of [{ WTAXNUMEXPL: undefined }, { WTAXNUMEXPL: { readonly: 1 } }]) {
    const fixture = sdkFixture({}, { columns });
    await assert.rejects(fixture.sdk.prepareDigitalCustomer('TEST', 'test@example.com'), /אינו זמין/);
    assert.ok(!fixture.calls.includes('save'));
  }
  const rejected = sdkFixture({}, { fieldError: true });
  await assert.rejects(rejected.sdk.prepareDigitalCustomer('TEST', 'test@example.com'), /Field rejected/);
  assert.ok(!rejected.calls.includes('save'));
  const discarded = sdkFixture({}, { discard: true, columns: { WTAXNUMEXPL: { readonly: 0 } } });
  await assert.rejects(discarded.sdk.prepareDigitalCustomer('TEST', 'test@example.com'), /הסבר המספר/);
});

test('a customer filter mismatch never updates another customer', async () => {
  const fixture = sdkFixture({ CUSTNAME: 'OTHER' });
  await assert.rejects(fixture.sdk.prepareDigitalCustomer('TEST', 'test@example.com'), /לא נמצא/);
  assert.equal(fixture.calls.filter(Array.isArray).length, 0);
});

function customerUI(details) {
  const elements = {};
  const $ = id => elements[id] ||= { innerHTML: '', value: '', textContent: '',
    classList: { add() {}, remove() {} }, reportValidity: () => true };
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const source = html.slice(html.indexOf('const EXPL_NAMES'), html.indexOf('let digitalCustomerRequest'));
  const ctx = { $, CustomerTax };
  vm.createContext(ctx);
  vm.runInContext(source + '\nthis.render = renderCustDetails;', ctx);
  ctx.render(details);
  return { ctx, $, elements, html };
}

test('customer screen previews automatic classification without asking agents to edit it', () => {
  const ui = customerUI({ CUSTNAME: 'TEST', WTAXNUM: company, VATNUM: company });
  assert.match(ui.$('custRows').innerHTML, /חברה.*יישמר אוטומטית/);
  assert.match(ui.$('custAlloc').innerHTML, /ללא צורך בעריכה/);
  assert.doesNotMatch(ui.$('custAlloc').innerHTML, /חסר|בלחיצה/);
  ui.ctx.render({ CUSTNAME: 'TEST', WTAXNUM: individual, VATNUM: individual });
  assert.match(ui.$('custRows').innerHTML, /עצמאי \/ תעודת זהות/);
  ui.ctx.render({ CUSTNAME: 'TEST', WTAXNUM: '123456789', VATNUM: '123456789' });
  assert.match(ui.$('custAlloc').innerHTML, /חסר.*הסבר/);
  ui.ctx.render({ CUSTNAME: 'TEST', WTAXNUM: individual, VATNUM: individual, WTAXNUMEXPL: '3' });
  assert.match(ui.$('custRows').innerHTML, /עוסק מורשה/);
  assert.doesNotMatch(ui.$('custRows').innerHTML, /יישמר אוטומטית/);
});

test('verified server result refreshes tax details after the existing customer save', async () => {
  const ui = customerUI({ CUSTNAME: 'TEST', WTAXNUM: company, VATNUM: company });
  Object.assign(ui.ctx, { digitalCustomerRequest: 1, digitalCustomerProfile: { phone: '' },
    showCustomerDelivery() {}, api: async () => ({ companyNumber: company, vatNumber: company, numberExplanation: '2' }) });
  ui.$('custname').value = 'TEST'; ui.$('customerEmail').value = 'test@example.com';
  vm.runInContext(ui.html.slice(ui.html.indexOf('async function saveCustomerDelivery'), ui.html.indexOf('async function loadCustDetails')), ui.ctx);
  assert.equal(await ui.ctx.saveCustomerDelivery(), true);
  assert.match(ui.$('custRows').innerHTML, /2 – חברה/);
  assert.doesNotMatch(ui.$('custRows').innerHTML, /יישמר אוטומטית/);
});
