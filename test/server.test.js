'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const path = require('node:path');

// The real HTTP handler runs with a fake Priority transport and no filesystem writes.
function isolatedServer(getResponse, responseStatus = 200, sdk = {}) {
  let handler;
  const calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'), {
    __dirname: path.join(__dirname, '..'),
    require(name) {
      if (name === 'http') return { createServer(fn) { handler = fn; return { listen() {} }; } };
      if (name === 'fs') return { existsSync: () => false, appendFile() {} };
      if (name === './priority-sdk') return sdk;
      if (name === './invoice-payload') return require('../invoice-payload');
      if (name === './exchange-rates') return require('../exchange-rates');
      if (name === './gold-rates') return require('../gold-rates');
      return require(name);
    },
    process: { env: { PRIORITY_BASE_URL: 'http://priority.invalid/odata/config', PRIORITY_COMPANY: 'test-only', PRIORITY_USER: 'fake-user', PRIORITY_PASSWORD: 'fake-password' } },
    console: { log() {}, error() {} }, Buffer, URL, AbortSignal,
    async fetch(url, options) {
      calls.push({ url, method: options.method || 'GET', headers: options.headers, body: options.body && JSON.parse(options.body) });
      const response = getResponse ? getResponse(url, options) : options.method === 'POST'
        ? { IVNUM: 'T-FAKE', STATDES: 'טיוטא', QPRICE: 100, VAT: 18, TOTPRICE: 118 }
        : { value: [{ WARHSNAME: 'TEST-W', WARHSDES: 'Test warehouse', AGENTCODE: 'TEST-A', AGENTNAME: 'Test agent', CUSTNAME: 'must-not-leak', IVNUM: 'must-not-leak' }] };
      return { ok: responseStatus < 400, status: responseStatus, text: async () => typeof response === 'string' ? response : JSON.stringify(response) };
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

test('gold route validates date, shares one SDK quote across concurrent calls and caches by date', async () => {
  let calls = 0;
  const server = isolatedServer(null, 200, { async getGoldPrices(cutoff) {
    calls++; assert.ok(Number.isFinite(Date.parse(cutoff)));
    return [{ UDATE: '2026-10-19T15:44:00+03:00', USDPRICE: '78.355698896', USDPRICE2: '100.456024226', USDPRICE3: '132.482598287' }];
  } });
  const bad = await server.request('GET', '/api/gold-prices?date=2026-02-30');
  assert.equal(bad.status, 400); assert.equal(calls, 0);
  const results = await Promise.all([server.request('GET', '/api/gold-prices?date=2026-10-20'), server.request('GET', '/api/gold-prices?date=2026-10-20')]);
  assert.equal(results[0].status, 200); assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].body.prices['14'].price, 78.36); assert.equal(calls, 1);
  await server.request('GET', '/api/gold-prices?date=2026-10-19'); assert.equal(calls, 2);
  assert.equal(server.calls.length, 0);
});

test('failed gold SDK loading has no price fallback and can be retried', async () => {
  let calls = 0;
  const server = isolatedServer(null, 200, { async getGoldPrices() { calls++; throw new Error('gold offline'); } });
  const first = await server.request('GET', '/api/gold-prices?date=2026-10-20');
  assert.ok(first.status >= 500); assert.match(first.body.error, /gold offline/);
  await server.request('GET', '/api/gold-prices?date=2026-10-20');
  assert.equal(calls, 2); assert.equal(server.calls.length, 0);
});

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

test('part search applies the selected classification before the result limit', async () => {
  for (const type of ['1', '2', '4']) {
    const server = isolatedServer();
    const result = await server.request('GET', `/api/parts?q=ring&invoiceType=${type}`);
    assert.equal(result.status, 200);
    assert.equal(server.calls.length, 2);
    for (const call of server.calls) {
      const url = new URL(call.url);
      assert.equal(call.method, 'GET');
      assert.ok(url.searchParams.get('$filter').includes(`EDEA_PARTTYPE eq '${type}'`));
      assert.ok(url.searchParams.get('$filter').includes("STATDES eq 'פעיל'"));
      assert.ok(url.searchParams.get('$select').includes('BASEPLPRICE,BASEPLCODE'));
    }
  }
});

test('missing or invalid invoice classification cannot trigger an unfiltered part search', async () => {
  for (const type of ['', '3', "4' or 1 eq 1"]) {
    const server = isolatedServer();
    const result = await server.request('GET', '/api/parts?q=ring&invoiceType=' + encodeURIComponent(type));
    assert.equal(result.status, 400);
    assert.equal(server.calls.length, 0);
  }
});

test('one public BOI request retrieves both dollar codes without Priority credentials', async () => {
  const server = isolatedServer(() => 'SERIES_CODE,BASE_CURRENCY,COUNTER_CURRENCY,DATA_TYPE,UNIT_MULT,TIME_PERIOD,OBS_VALUE\nRER_USD_ILS,USD,ILS,OF00,0,2026-10-19,3.11\n');
  const result = await server.request('GET', '/api/exchange-rates?date=2026-10-20');
  assert.equal(result.status, 200);
  assert.equal(result.body.rates.USD.rate, 3.11);
  assert.equal(result.body.rates.$.rate, 3.11);
  assert.equal(server.calls.length, 1);
  assert.equal(server.calls[0].method, 'GET');
  assert.equal(new URL(server.calls[0].url).hostname, 'edge.boi.gov.il');
  assert.equal(server.calls[0].headers.Authorization, undefined);
  const cached = await server.request('GET', '/api/exchange-rates?date=2026-10-20');
  assert.equal(cached.body.rates.USD.rate, 3.11);
  assert.equal(server.calls.length, 1);
  const invalid = await server.request('GET', '/api/exchange-rates?date=2026-02-30');
  assert.equal(invalid.status, 400);
  assert.equal(server.calls.length, 1);
});

test('BOI errors are reported without falling back to Priority or a guessed rate', async () => {
  const server = isolatedServer(() => 'service unavailable', 503);
  const result = await server.request('GET', '/api/exchange-rates?date=2026-10-20');
  assert.equal(result.status, 502);
  assert.match(result.body.error, /בנק ישראל.*503/);
  assert.equal(server.calls.length, 1);
});

test('scanner lookup uses exact part/barcode matching, type and active status in one GET', async () => {
  const server = isolatedServer(() => ({ value: [{ PARTNAME: 'REAL-PART', BARCODE: '7290000000001', BASEPLPRICE: 100, BASEPLCODE: 'USD' }] }));
  const result = await server.request('GET', '/api/parts?q=7290000000001&invoiceType=4&exact=1');
  assert.equal(result.status, 200);
  assert.equal(result.body.value[0].PARTNAME, 'REAL-PART');
  assert.equal(server.calls.length, 1);
  assert.equal(server.calls[0].method, 'GET');
  const filter = new URL(server.calls[0].url).searchParams.get('$filter');
  assert.ok(filter.includes("PARTNAME eq '7290000000001' or BARCODE eq '7290000000001'"));
  assert.ok(filter.includes("EDEA_PARTTYPE eq '4'"));
  assert.ok(filter.includes("STATDES eq 'פעיל'"));
  assert.equal(filter.includes('*'), false);
});

test('Priority and BOI routes cache separately without silent source fallback', async () => {
  let sdkReads = 0;
  const server = isolatedServer(() => 'SERIES_CODE,BASE_CURRENCY,COUNTER_CURRENCY,DATA_TYPE,UNIT_MULT,TIME_PERIOD,OBS_VALUE\nRER_USD_ILS,USD,ILS,OF00,0,2026-10-19,3.11\n', 200, {
    async getCurrencyRates(date) {
      sdkReads++; assert.equal(date, '2026-10-20');
      return ['USD', '$'].map((CODE, i) => ({ CODE, EXCHQUANT: 1, EXCH: i ? 3.1722 : 3.11, EXCHDATE: '2026-10-19' }));
    },
  });
  const boi = await server.request('GET', '/api/exchange-rates?date=2026-10-20');
  const priority = await server.request('GET', '/api/exchange-rates?date=2026-10-20&source=priority');
  assert.equal(boi.body.rates.$.rate, 3.11); assert.equal(priority.body.rates.$.rate, 3.1722);
  assert.equal(priority.body.source, 'priority');
  await server.request('GET', '/api/exchange-rates?date=2026-10-20&source=priority');
  assert.equal(sdkReads, 1); assert.equal(server.calls.length, 1);
  const invalid = await server.request('GET', '/api/exchange-rates?date=2026-10-20&source=unknown');
  assert.equal(invalid.status, 400); assert.equal(sdkReads, 1);
});
