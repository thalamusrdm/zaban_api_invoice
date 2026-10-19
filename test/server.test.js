'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const path = require('node:path');

// The real HTTP handler runs with a fake Priority transport and no filesystem writes.
function isolatedServer() {
  let handler;
  const calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'), {
    __dirname: path.join(__dirname, '..'),
    require(name) {
      if (name === 'http') return { createServer(fn) { handler = fn; return { listen() {} }; } };
      if (name === 'fs') return { existsSync: () => false, appendFile() {} };
      if (name === './priority-sdk') return {};
      if (name === './invoice-payload') return require('../invoice-payload');
      return require(name);
    },
    process: { env: { PRIORITY_BASE_URL: 'http://priority.invalid/odata/config', PRIORITY_COMPANY: 'test-only', PRIORITY_USER: 'fake-user', PRIORITY_PASSWORD: 'fake-password' } },
    console: { log() {}, error() {} }, Buffer, URL, AbortSignal,
    async fetch(url, options) {
      calls.push({ url, method: options.method, body: options.body && JSON.parse(options.body) });
      const response = options.method === 'POST'
        ? { IVNUM: 'T-FAKE', STATDES: 'טיוטא', QPRICE: 100, VAT: 18, TOTPRICE: 118 }
        : { value: [{ WARHSNAME: 'TEST-W', WARHSDES: 'Test warehouse', AGENTCODE: 'TEST-A', AGENTNAME: 'Test agent', CUSTNAME: 'must-not-leak', IVNUM: 'must-not-leak' }] };
      return { ok: true, status: 200, text: async () => JSON.stringify(response) };
    },
  });
  return {
    calls,
    async request(method, url, body) {
      const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
      Object.assign(req, { method, url });
      let status, text;
      const res = { writeHead(code) { status = code; }, end(value) { text = value; } };
      await handler(req, res);
      return { status, body: text && JSON.parse(text) };
    },
  };
}

test('HTTP route sends selected fields to the isolated Priority transport', async () => {
  const server = isolatedServer();
  const result = await server.request('POST', '/api/invoices', {
    custname: 'TEST-CUSTOMER', date: '2026-10-19', invoiceType: '2', warehouse: 'TEST', location: '0', agent: 'TEST-A', booknum: 'TEST-BOOK', discount: 5,
    lines: [{ partname: 'TEST-PART', quantity: 2, price: 100, currency: 'USD', exchange: 3.11, discount: 10 }],
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.ivnum, 'T-FAKE');
  assert.equal(server.calls.length, 1);
  assert.equal(server.calls[0].method, 'POST');
  const p = server.calls[0].body;
  assert.equal(p.EDEA_INVTYPE, '2');
  assert.equal(p.WARHSNAME, 'TEST');
  assert.equal(p.BOOKNUM, 'TEST-BOOK');
  assert.equal(p.AINVOICEITEMS_SUBFORM[0].ICODE, 'USD');
  assert.equal(p.AINVOICEITEMS_SUBFORM[0].EXCH, 3.11);
  assert.equal(p.AINVOICEITEMS_SUBFORM[0].EDEA_BOOKNUM, undefined);
});

test('invalid FX input returns 400 before any Priority request', async () => {
  const server = isolatedServer();
  const result = await server.request('POST', '/api/invoices', { custname: 'TEST', date: '2026-10-19', lines: [{ partname: 'TEST-PART', quantity: 1, price: 100, currency: '$' }] });
  assert.equal(result.status, 400);
  assert.equal(server.calls.length, 0);
});

test('suggestions use GET, strip invoice/customer data, and cache results', async () => {
  const server = isolatedServer();
  const first = await server.request('GET', '/api/invoices/options');
  const second = await server.request('GET', '/api/invoices/options');
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, second.body);
  assert.equal(server.calls.length, 1);
  assert.equal(server.calls[0].method, 'GET');
  assert.equal(first.body.warehouses[0].code, 'TEST-W');
  assert.equal(first.body.agents[0].code, 'TEST-A');
  assert.equal(JSON.stringify(first.body).includes('must-not-leak'), false);
});
