'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const path = require('node:path');

// The real HTTP handler runs with a fake Priority transport and no filesystem writes.
function isolatedServer(getResponse, responseStatus = 200, sdk = {}, store, originals, mailer) {
  let handler;
  const calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'), {
    __dirname: path.join(__dirname, '..'),
    require(name) {
      if (name === 'http') return { createServer(fn) { handler = fn; return { listen() {} }; } };
      if (name === 'fs') return { existsSync: () => false, appendFile() {} };
      if (name === './priority-sdk') return sdk;
      if (name === './invoice-mail') return { createMailer: () => mailer || require('../invoice-mail').createMailer({}) };
      if (name === './invoice-payload') return require('../invoice-payload');
      if (name === './invoice-close') return require('../invoice-close');
      if (name === './public/part-lookup') return require('../public/part-lookup');
      if (name === './exchange-rates') return require('../exchange-rates');
      if (name === './original-documents') return originals ? {originalStore:()=>originals} : require('../original-documents');
      if (name === './digital-invoice') return {...require('../digital-invoice'),workflowStore:directory=>store||require('../digital-invoice').workflowStore(directory)};
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
    async request(method, url, body, contentType = 'application/json') {
      const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
      Object.assign(req, { method, url, headers: { 'content-type': contentType } });
      let status, text, headers;
      const res = { writeHead(code,values) { status = code; headers=values; }, end(value) { text = value; } };
      await handler(req, res);
      return { status, headers, buffer:Buffer.isBuffer(text)?text:undefined, body: text && !Buffer.isBuffer(text) ? JSON.parse(text) : undefined };
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

test('agent invoice list queries only the selected agent and rejects ambiguous scopes', async () => {
  const server = isolatedServer(() => ({ value: [
    { AGENTCODE: '80', IVNUM: 'IN80', CUSTNAME: 'TEST' },
    { AGENTCODE: '40', IVNUM: 'IN40', CUSTNAME: 'OTHER' },
  ] }));
  const result = await server.request('GET', '/api/invoices/recent?agent=80');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.value.map(row => row.IVNUM), ['IN80']);
  const query = new URL(server.calls[0].url).searchParams;
  assert.equal(query.get('$filter'), "AGENTCODE eq '80'");
  assert.equal(query.get('$top'), '11');
  assert.equal(query.get('$orderby'), 'IV desc');
  for (const url of ['/api/invoices/recent?agent=80&custname=TEST', '/api/invoices/recent?agent=12345678901234567']) {
    assert.equal((await server.request('GET', url)).status, 400);
  }
  assert.equal(server.calls.length, 1);
});

test('invoice creation applies the chosen warehouse after the agent warehouse default and before items', async () => {
  const server = isolatedServer((_url, options) => {
    const payload = JSON.parse(options.body);
    let warehouse, location;
    for (const [field, value] of Object.entries(payload)) {
      if (field === 'AGENTCODE') { warehouse = value; location = ''; }
      if (field === 'WARHSNAME') { warehouse = value; location = ''; }
      if (field === 'LOCNAME') location = value;
      if (field === 'AINVOICEITEMS_SUBFORM') {
        assert.equal(warehouse, '1');
        assert.equal(location, '0');
        assert.equal(value[0].PARTNAME, 'TEST-PART');
      }
    }
    return { IVNUM: 'T-TEST', STATDES: 'טיוטא' };
  });
  const result = await server.request('POST', '/api/invoices', {
    custname: 'TEST', date: '2026-11-11', agent: '80', warehouse: '1', location: '0',
    lines: [{ partname: 'TEST-PART', quantity: 1, price: 100, currency: 'ש"ח' }],
  });
  assert.equal(result.status, 200);
  assert.equal(server.calls.length, 1);
});

test('customer delivery validates one email and saves settings without creating an invoice', async () => {
  const calls = [];
  const server = isolatedServer(null, 200, { async prepareDigitalCustomer(custname, email, phone) {
    const customer = { custname, email };
    if (phone !== undefined) customer.phone = phone;
    calls.push(customer);
    return { ...customer, digital: true };
  } });
  const invalid = await server.request('POST', '/api/customers/digital', { custname: 'TEST', email: 'bad email' });
  assert.equal(invalid.status, 400);
  const wrongFormat = await server.request('POST', '/api/customers/digital', { custname: 'TEST', email: 'customer@example.com' }, 'text/plain');
  assert.equal(wrongFormat.status, 415);
  assert.equal(calls.length, 0);
  const saved = await server.request('POST', '/api/customers/digital', { custname: 'TEST', email: ' customer@example.com ' });
  assert.equal(saved.status, 200);
  assert.deepEqual(calls, [{ custname: 'TEST', email: 'customer@example.com' }]);
  assert.deepEqual(saved.body, { ...calls[0], digital: true });
  const contact = { custname: 'TEST', email: 'customer@example.com' };
  const invalidPhone = await server.request('POST', '/api/customers/digital', { ...contact, phone: 'call me' });
  assert.equal(invalidPhone.status, 400);
  assert.equal(calls.length, 1);
  const savedPhone = await server.request('POST', '/api/customers/digital', { ...contact, phone: ' +972 (50) 555-0123 ' });
  assert.equal(savedPhone.status, 200);
  assert.deepEqual(calls[1], { ...contact, phone: '+972 (50) 555-0123' });
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
    assert.equal(server.calls.length, 3);
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

test('manual exact lookup finds the lab product without relying on prefix or description searches', async () => {
  const product = { PARTNAME: '735306', BARCODE: '735306', PARTDES: 'Lab bracelet', STATDES: 'פעיל', EDEA_PARTTYPE: '4' };
  const server = isolatedServer(url => {
    const filter = new URL(url).searchParams.get('$filter');
    assert.equal(filter.includes('*'), false);
    return { value: [product] };
  });
  const result = await server.request('GET', '/api/parts?q=735306&invoiceType=4');
  assert.equal(result.status, 200);
  assert.equal(result.body.value[0].PARTNAME, '735306');
  assert.equal(server.calls.length, 1);
});

test('a failed description lookup preserves matching code suggestions', async () => {
  const server = isolatedServer(url => {
    const filter = new URL(url).searchParams.get('$filter');
    if (filter.includes('PARTDES')) throw new Error('description unavailable');
    if (filter.includes('735*')) return { value: [{ PARTNAME: '735306', STATDES: 'פעיל', EDEA_PARTTYPE: '4' }] };
    return { value: [] };
  });
  const result = await server.request('GET', '/api/parts?q=735&invoiceType=4');
  assert.equal(result.status, 200);
  assert.equal(result.body.partial, true);
  assert.equal(result.body.value[0].PARTNAME, '735306');
});

test('partial barcode searches suggest a product but do not treat it as an exact match', async () => {
  const server = isolatedServer(url => {
    const filter = new URL(url).searchParams.get('$filter');
    return { value: filter.includes("BARCODE eq '000123*'")
      ? [{ PARTNAME: 'LAB-PART', BARCODE: '000123456789', STATDES: 'פעיל', EDEA_PARTTYPE: '4' }] : [] };
  });
  const result = await server.request('GET', '/api/parts?q=000123&invoiceType=4');
  assert.equal(result.status, 200);
  assert.equal(result.body.value[0].PARTNAME, 'LAB-PART');
});

test('wrong classification and inactive products are diagnosed without becoming selectable', async () => {
  for (const [product, reason] of [
    [{ PARTNAME: '735306', STATDES: 'פעיל', EDEA_PARTTYPE: '2' }, 'wrong_invoice_type'],
    [{ PARTNAME: '735306', STATDES: 'לא פעיל', EDEA_PARTTYPE: '4' }, 'inactive'],
  ]) {
    const server = isolatedServer(url => {
      const scoped = new URL(url).searchParams.get('$filter').includes('EDEA_PARTTYPE');
      return { value: scoped ? [] : [product] };
    });
    const result = await server.request('GET', '/api/parts?q=735306&invoiceType=4&exact=1');
    assert.equal(result.status, 200);
    assert.equal(result.body.value.length, 0);
    assert.equal(result.body.reason, reason);
  }
});

test('long framed barcodes retain leading zeros, and matching identities remain ambiguous', async () => {
  const barcode = '000123456789012345678901234567';
  const products = [
    { PARTNAME: barcode, BARCODE: 'OTHER', STATDES: 'פעיל', EDEA_PARTTYPE: '4' },
    { PARTNAME: 'SECOND', BARCODE: barcode, STATDES: 'פעיל', EDEA_PARTTYPE: '4' },
  ];
  const server = isolatedServer(url => {
    const filter = new URL(url).searchParams.get('$filter');
    assert.ok(filter.includes(barcode));
    assert.equal(filter.includes('\u0002'), false);
    return { value: products };
  });
  const result = await server.request('GET', '/api/parts?q=' + encodeURIComponent('\u0002' + barcode + '\r\n\u0003') + '&invoiceType=4&exact=1');
  assert.equal(result.status, 200);
  assert.equal(result.body.value.length, 2);
  assert.equal(server.calls.length, 1);
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
  const server = isolatedServer(() => ({ value: [{ PARTNAME: 'REAL-PART', BARCODE: '7290000000001', BASEPLPRICE: 100, BASEPLCODE: 'USD', STATDES: 'פעיל', EDEA_PARTTYPE: '4' }] }));
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


test('close is verified by internal IV and unverified absence never returns success', async t => {
  for (const found of [true, false]) {
    let closed=0;
    const store=await deliveryFixture(t);
    const identity={IV:123,OWNERLOGIN:'fake-user',CUSTNAME:'TEST'};
    const server=isolatedServer(url => url.includes('$filter=') ? { value: found ? [{...identity, IVNUM:'IN123',STATDES:'סופית' }] : [] } : {...identity,IVNUM:'T-TEST',STATDES:'טיוטא'},200,{async closeInvoice(){closed++;return {}; }},store);
    const result=await server.request('POST','/api/invoices/close',{ivnum:'T-TEST'});
    assert.equal(closed,1);assert.equal(result.status,found ? 200 : 409);
    if(found)assert.equal(result.body.ivnum,'IN123');else assert.match(result.body.error,/לא ניתן לאמת/);
    assert.ok(decodeURIComponent(server.calls[1].url).includes('IV eq 123'));
  }
});

test('original route rejects non-API invoices before running any original procedure',async()=>{let calls=0;const s=isolatedServer(()=>({IV:123,OWNERLOGIN:'another-user'}),200,{async getOriginalInvoiceDocument(){calls++;}});const response=await s.request('POST','/api/invoices/original',{ivnum:'IN123'});assert.equal(response.status,400);assert.equal(calls,0);});

test('closing recovers an SDK timeout, saves the exact original and reuses it after restart',async t=>{
  const store=await deliveryFixture(t),d=require('../digital-invoice');
  await store.write(d.keyFor('http://priority.invalid/odata/config/test-only',123),'context',{originalDownload:true,custname:'TEST'});
  const bytes=Buffer.from('%PDF-1.7 /ByteRange exact signed original');
  let final=false,closes=0,prints=0,uploads=0,attachment;
  const identity={IV:123,CUSTNAME:'TEST',OWNERLOGIN:'fake-user'};
  const transport=(url,options)=>{
    if(url.includes('EXTFILES_SUBFORM')){
      if(options.method==='POST'){uploads++;attachment=JSON.parse(options.body);return {EXTFILENUM:1};}
      return {value:attachment?[attachment]:[]};
    }
    const row={...identity,IVNUM:final?'IN123':'T123',STATDES:final?'סופית':'טיוטא'};
    return url.includes('$filter=')?{value:[row]}:row;
  };
  const sdk={async digitalCustomerForm(){return {name:'Test',digital:true};},async closeInvoice(){closes++;final=true;throw Error('SDK timeout');},async getOriginalInvoiceDocument(){prints++;return {datauri:'data:application/pdf;base64,'+bytes.toString('base64')};}};
  const originals=(_key,produce,download)=>produce().then(download);
  const server=isolatedServer(transport,200,sdk,store,originals);
  const result=await server.request('POST','/api/invoices/close',{ivnum:'T123'});
  assert.equal(result.status,200);assert.equal(result.body.ivnum,'IN123');
  assert.equal(uploads,1);assert.equal(prints,1);assert.equal(closes,1);
  assert.deepEqual(Buffer.from(attachment.EXTFILENAME.split(',')[1],'base64'),bytes);
  const restarted=isolatedServer(transport,200,sdk,store,originals);
  assert.equal((await restarted.request('POST','/api/invoices/close',{ivnum:'T123'})).status,200);
  const status=await restarted.request('GET','/api/invoices/close-status?ivnum=T123');
  assert.equal(status.body.closed,true);assert.equal(status.body.ivnum,'IN123');
  assert.equal(uploads,1);assert.equal(prints,1);assert.equal(closes,1);
  assert.ok([...server.calls,...restarted.calls].every(call=>call.method==='GET'||call.url.includes('EXTFILES_SUBFORM')));
});

test('server rejects original-mode creation for an ineligible customer before any invoice write',async()=>{const s=isolatedServer(undefined,200,{async getOriginalCustomerReadiness(){return {ready:false,reason:'לא מוגדר למסמך ממוחשב'};}});const response=await s.request('POST','/api/invoices',{original:true,custname:'301100',date:'2026-10-22',invoiceType:'1',lines:[{partname:'14',quantity:1,price:10,currency:'USD',exchange:3.11}]});assert.equal(response.status,400);assert.match(response.body.error,/מסמך ממוחשב/);assert.equal(s.calls.length,0);});

async function deliveryFixture(t){const fsp=require('node:fs/promises');const os=require('node:os');const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'invoice-http-digital-'));t.after(()=>fsp.rm(dir,{recursive:true,force:true}));return require('../digital-invoice').workflowStore(dir);}
const validDigitalBody=()=>({custname:'TEST',date:'2026-10-22',invoiceType:'1',lines:[{partname:'14',quantity:1,price:10,currency:'USD',exchange:3.11}],digitalEmail:true,consent:true,email:'agent@example.com',requestId:'cdf70483-4d40-4320-85c5-4569db7eac51'});
test('digital creation retries reuse one draft and reject changing the payload under its request ID',async t=>{const store=await deliveryFixture(t);let created=0,prepared=0;const server=isolatedServer((_url,options)=>{if(options.method==='POST'){created++;return {IV:123,IVNUM:'T123',STATDES:'טיוטא'};}throw Error('Unexpected transport');},200,{async prepareDigitalCustomer(custname,email){prepared++;return {custname,email};},async prepareDigitalInvoice(){}},store);const body=validDigitalBody();const result=await Promise.all([server.request('POST','/api/invoices',body),server.request('POST','/api/invoices',body)]);assert.equal(result[0].status,200);assert.equal(result[1].body.ivnum,'T123');assert.equal(created,1);assert.equal(prepared,1);const changed=await server.request('POST','/api/invoices',{...body,email:'other@example.com'});assert.equal(changed.status,400);assert.equal(created,1);});
test('mail retries cannot send twice or change the saved recipient',async t=>{const store=await deliveryFixture(t);const d=require('../digital-invoice');const key=d.keyFor('http://priority.invalid/odata/config/test-only',123);await store.write(key,'context',{digitalEmail:true,custname:'TEST',email:'agent@example.com'});let mails=0;const server=isolatedServer(()=>({IV:123,IVNUM:'IN123',CUSTNAME:'TEST',OWNERLOGIN:'fake-user'}),200,{async sendDigitalInvoice(ivnum,email){mails++;return {ivnum,email,acceptedByPriority:true};}},store);const body={ivnum:'IN123',digitalEmail:true,consent:true,email:'agent@example.com'};assert.equal((await server.request('POST','/api/invoices/email',body)).status,200);assert.equal((await server.request('POST','/api/invoices/email',body)).status,200);assert.equal(mails,1);assert.equal((await server.request('POST','/api/invoices/email',{...body,email:'other@example.com'})).status,400);assert.equal(mails,1);});
test('signature displays the exact original and uploads only a separate receipt once',async t=>{
  const store=await deliveryFixture(t),{PDFDocument}=require('pdf-lib'),{PNG}=require('pngjs');
  let original=Buffer.from('%PDF-1.7 /ByteRange signed original bytes');const snapshot=Buffer.from(original);
  const png=new PNG({width:640,height:180});png.data.fill(255);for(let x=30;x<500;x++)for(let y=80;y<84;y++){const i=(640*y+x)*4;png.data[i]=png.data[i+1]=png.data[i+2]=20;}
  const signature='data:image/png;base64,'+PNG.sync.write(png).toString('base64');
  let uploads=0,attachment;
  const server=isolatedServer((url,options)=>{
    if(url.includes('EXTFILES_SUBFORM')){
      if(options.method==='POST'){uploads++;attachment=JSON.parse(options.body);return {EXTFILENUM:77};}
      if(url.includes('$filter='))return {value:attachment?[{EXTFILENUM:77,...attachment}]:[]};
      return {value:[{EXTFILENUM:1,EXTFILEDES:'מסמך ממוחשב',EXTFILENAME:'data:application/pdf;base64,'+original.toString('base64')},...(attachment?[attachment]:[])]};
    }
    return {IV:url.includes('IN124')?124:123,IVNUM:url.includes('IN124')?'IN124':'IN123',CUSTNAME:'TEST',OWNERLOGIN:'fake-user'};
  },200,{async getInvoiceDocumentUrl(){throw Error('No copy generation allowed');}},store);
  const source=await server.request('GET','/api/invoices/signature-copy?ivnum=IN123');
  assert.equal(source.status,200);assert.deepEqual(source.buffer,snapshot);
  const body={ivnum:'IN123',token:source.headers['X-Signature-Token'],signer:'בדיקה',signature,acknowledgement:true};
  assert.equal((await server.request('POST','/api/invoices/sign',{...body,ivnum:'IN124'})).status,400);
  assert.equal((await server.request('POST','/api/invoices/sign',{...body,acknowledgement:false})).status,400);
  original=Buffer.from('%PDF-1.7 /ByteRange CHANGED');
  assert.equal((await server.request('POST','/api/invoices/sign',body)).status,400);assert.equal(uploads,0);
  original=snapshot;
  const signed=await server.request('POST','/api/invoices/sign',body);assert.equal(signed.status,200,JSON.stringify(signed.body));
  assert.equal((await server.request('POST','/api/invoices/sign',body)).status,200);
  assert.equal(uploads,1);assert.match(attachment.EXTFILEDES,/^ACK_IN123_/);
  const receipt=await PDFDocument.load(Buffer.from(attachment.EXTFILENAME.split(',')[1],'base64'));
  assert.equal(receipt.getTitle(),'אישור חתימת לקוח IN123');assert.equal(receipt.getPageCount(),1);
  assert.ok(receipt.getKeywords().includes(require('node:crypto').createHash('sha256').update(snapshot).digest('hex')));
  assert.deepEqual(original,snapshot);
  assert.ok(server.calls.every(x=>x.method==='GET'||x.url.includes('EXTFILES_SUBFORM')));
  const saved=await server.request('GET','/api/invoices/existing-signed?ivnum=IN123');assert.equal(saved.status,200);
  assert.match(saved.headers['Content-Disposition'],/signature-receipt/);
  attachment=undefined;
  assert.equal((await server.request('POST','/api/invoices/sign',body)).status,400);assert.equal(uploads,1);
});

test('recent invoices require a customer, scope the Priority query and exclude other customers',async()=>{
  const server=isolatedServer(()=>({value:[{IVNUM:'IN123',CUSTNAME:'301100'},{IVNUM:'IN124',CUSTNAME:'OTHER'}]}));
  assert.equal((await server.request('GET','/api/invoices/recent')).status,400);
  assert.equal(server.calls.length,0);
  const result=await server.request('GET','/api/invoices/recent?custname=301100');
  assert.equal(result.status,200);
  assert.equal(result.body.value.length,1);
  assert.equal(result.body.value[0].CUSTNAME,'301100');
  const query=new URL(server.calls[0].url).searchParams;
  assert.equal(query.get('$filter'),"OWNERLOGIN eq 'fake-user' and CUSTNAME eq '301100'");
  assert.equal(query.get('$top'),'10');
});

test('saved signed copy returns the exact Priority attachment using GETs only',async()=>{
  const bytes=Buffer.from('%PDF-1.7\ncustomer signed copy');
  const server=isolatedServer(url=>url.includes('EXTFILES_SUBFORM')?{value:[{EXTFILEDES:'מסמך ממוחשב',EXTFILENAME:'data:application/pdf;base64,'+Buffer.from('%PDF-original').toString('base64')},{EXTFILENUM:2,EXTFILEDES:'SIGNED_IN123_test',EXTFILENAME:'data:application/pdf;base64,'+bytes.toString('base64')}]}:{IV:123,OWNERLOGIN:'fake-user',CUSTNAME:'301100'});
  const result=await server.request('GET','/api/invoices/existing-signed?ivnum=IN123');
  assert.equal(result.status,200);assert.deepEqual(result.buffer,bytes);
  assert.match(result.headers['Content-Disposition'],/IN123-signed.pdf/);
  assert.equal(server.calls.length,2);assert.ok(server.calls.every(x=>x.method==='GET'));
});

test('signed copy lookup rejects missing, ambiguous, mismatched or invalid attachments without generation',async()=>{
  const pdf='data:application/pdf;base64,'+Buffer.from('%PDF-test').toString('base64');
  for(const rows of [[],[{EXTFILEDES:'SIGNED_IN124_other',EXTFILENAME:pdf}],[{EXTFILEDES:'SIGNED_IN123_a',EXTFILENAME:pdf},{EXTFILEDES:'SIGNED_IN123_b',EXTFILENAME:pdf}],[{EXTFILEDES:'SIGNED_IN123_a',EXTFILENAME:'data:application/pdf;base64,YmFk'}],[{EXTFILEDES:'SIGNED_IN123_a',EXTFILENAME:'https://other.invalid/signed.pdf'}]]){
    const server=isolatedServer(url=>url.includes('EXTFILES_SUBFORM')?{value:rows}:{IV:123,OWNERLOGIN:'fake-user',CUSTNAME:'301100'});
    const result=await server.request('GET','/api/invoices/existing-signed?ivnum=IN123');
    assert.ok(result.status>=400);assert.equal(server.calls.length,2);assert.ok(server.calls.every(x=>x.method==='GET'));
  }
});

test('signed copy lookup enforces invoice ownership and final invoice identifiers',async()=>{
  const server=isolatedServer(()=>({IV:123,OWNERLOGIN:'other-user'}));
  assert.equal((await server.request('GET','/api/invoices/existing-signed?ivnum=T123')).status,400);assert.equal(server.calls.length,0);
  assert.equal((await server.request('GET','/api/invoices/existing-signed?ivnum=IN123')).status,400);assert.equal(server.calls.length,1);
});

test('existing original download returns the exact attachment bytes using GETs only',async()=>{
  const bytes=Buffer.from('%PDF-1.7\nexisting signed original /ByteRange [0 1 2 3]');
  const server=isolatedServer(url=>url.includes('EXTFILES_SUBFORM')?{value:[{EXTFILENUM:1,EXTFILEDES:'מסמך ממוחשב',EXTFILENAME:'data:application/pdf;base64,'+bytes.toString('base64')},{EXTFILENUM:2,EXTFILEDES:'SIGNED_IN123_x',EXTFILENAME:'data:application/pdf;base64,'+Buffer.from('signed copy').toString('base64')}]}:{IV:123,OWNERLOGIN:'fake-user'});
  for(let i=0;i<2;i++){const result=await server.request('GET','/api/invoices/existing-original?ivnum=IN123');assert.equal(result.status,200);assert.deepEqual(result.buffer,bytes);assert.match(result.headers['Content-Disposition'],/IN123-original.pdf/);}
  assert.equal(server.calls.length,4);assert.ok(server.calls.every(x=>x.method==='GET'));
});
test('existing original never generates a replacement for missing, ambiguous or invalid originals',async()=>{
  const pdf='data:application/pdf;base64,'+Buffer.from('%PDF-1.7 /ByteRange').toString('base64');
  for(const rows of [[],[{EXTFILEDES:'SIGNED_IN123_x',EXTFILENAME:pdf}],[{EXTFILEDES:'מסמך ממוחשב',EXTFILENAME:pdf},{EXTFILEDES:'מסמך ממוחשב',EXTFILENAME:pdf}],[{EXTFILEDES:'מסמך ממוחשב',EXTFILENAME:'data:application/pdf;base64,YmFk'}],[{EXTFILEDES:'מסמך ממוחשב',EXTFILENAME:'https://other.invalid/original.pdf'}]]){
    const server=isolatedServer(url=>url.includes('EXTFILES_SUBFORM')?{value:rows}:{IV:123,OWNERLOGIN:'fake-user'});
    const result=await server.request('GET','/api/invoices/existing-original?ivnum=IN123');assert.ok(result.status>=400);assert.ok(server.calls.every(x=>x.method==='GET'));assert.equal(server.calls.length,2);
  }
});
test('existing original download rejects other users and draft identifiers before reading attachments',async()=>{
  const server=isolatedServer(()=>({IV:123,OWNERLOGIN:'other-user'}));
  assert.equal((await server.request('GET','/api/invoices/existing-original?ivnum=T123')).status,400);assert.equal(server.calls.length,0);
  assert.equal((await server.request('GET','/api/invoices/existing-original?ivnum=IN123')).status,400);assert.equal(server.calls.length,1);
});

test('no-email creation requires a digital customer, ignores missing email and creates one draft',async t=>{
  const store=await deliveryFixture(t);let created=0;const sdk={async digitalCustomerForm(){return {name:'TEST',digital:true,email:'',requiredMissing:[]};}};
  const server=isolatedServer((_u,o)=>{assert.equal(o.method,'POST');created++;return {IV:123,IVNUM:'T123'};},200,sdk,store);
  const {email,consent,digitalEmail,...body}=validDigitalBody();body.originalDownload=true;
  await Promise.all([server.request('POST','/api/invoices',body),server.request('POST','/api/invoices',body)]).then(results=>results.forEach(x=>assert.equal(x.status,200)));
  assert.equal(created,1);const d=require('../digital-invoice');const context=await store.read(d.keyFor('http://priority.invalid/odata/config/test-only',123));assert.equal(context.originalDownload,true);assert.equal(context.digitalEmail,undefined);
  const blocked=isolatedServer(()=>{throw Error('must not create');},200,{async digitalCustomerForm(){return {name:'TEST',digital:false};}},store);assert.equal((await blocked.request('POST','/api/invoices',body)).status,400);assert.equal(blocked.calls.length,0);
});
test('original preparation reuses an existing original with no generation, mail or attachment write',async()=>{
  const pdf='data:application/pdf;base64,'+Buffer.from('%PDF-1.7 /ByteRange').toString('base64');
  const server=isolatedServer(url=>url.includes('EXTFILES_SUBFORM')?{value:[{EXTFILEDES:'מסמך ממוחשב',EXTFILENAME:pdf}]}:{IV:123,OWNERLOGIN:'fake-user',CUSTNAME:'TEST'});
  assert.equal((await server.request('POST','/api/invoices/prepare-original-download',{ivnum:'IN123'})).status,200);assert.ok(server.calls.every(x=>x.method==='GET'));
});
test('no-email original is generated once, saved unchanged and verified in attachments',async t=>{
  const store=await deliveryFixture(t);const d=require('../digital-invoice');const key=d.keyFor('http://priority.invalid/odata/config/test-only',123);await store.write(key,'context',{originalDownload:true,custname:'TEST'});
  const bytes=Buffer.from('%PDF-1.7 /ByteRange [0 1 2 3] exact original');let stored=null,prints=0,uploads=0;
  const server=isolatedServer((url,o)=>{if(url.includes('EXTFILES_SUBFORM')){if(o.method==='POST'){uploads++;const body=JSON.parse(o.body);stored=body;return {EXTFILENUM:1};}return {value:stored?[stored]:[]};}return {IV:123,OWNERLOGIN:'fake-user',CUSTNAME:'TEST'};},200,{async getOriginalInvoiceDocument(){prints++;return {datauri:'data:application/pdf;base64,'+bytes.toString('base64')};}},store,(_key,produce,download)=>produce().then(download));
  assert.equal((await server.request('POST','/api/invoices/prepare-original-download',{ivnum:'IN123'})).status,200);
  assert.equal((await server.request('POST','/api/invoices/prepare-original-download',{ivnum:'IN123'})).status,200);
  assert.equal(prints,1);assert.equal(uploads,1);const result=await server.request('GET','/api/invoices/existing-original?ivnum=IN123');assert.deepEqual(result.buffer,bytes);
  assert.ok(server.calls.filter(x=>x.method==='POST').every(x=>x.url.includes('EXTFILES_SUBFORM')));
});
test('ambiguous no-email generation is never retried automatically',async t=>{
  const store=await deliveryFixture(t);const d=require('../digital-invoice');await store.write(d.keyFor('http://priority.invalid/odata/config/test-only',123),'context',{originalDownload:true,custname:'TEST'});let prints=0;
  const server=isolatedServer(url=>url.includes('EXTFILES_SUBFORM')?{value:[]}:{IV:123,OWNERLOGIN:'fake-user',CUSTNAME:'TEST'},200,{async getOriginalInvoiceDocument(){prints++;throw Error('timeout after generation');}},store,(_key,produce,download)=>produce().then(download));
  for(let i=0;i<2;i++)assert.ok((await server.request('POST','/api/invoices/prepare-original-download',{ivnum:'IN123'})).status>=400);assert.equal(prints,1);assert.ok(server.calls.every(x=>x.method==='GET'));
});

test('combined issuance persists approved recipient, reuses its draft and binds recipient to request ID', async t => {
  const store=await deliveryFixture(t); let creates=0;
  const mailer={async verify(){}};
  const sdk={async digitalCustomerForm(){return {name:'Test',digital:true,email:'agent@example.com',requiredMissing:[]};}};
  const server=isolatedServer(()=>{creates++;return {IV:123,IVNUM:'T123'};},200,sdk,store,undefined,mailer);
  const body={...validDigitalBody(),digitalEmail:false,originalDownload:true,sendOriginalEmail:true};
  const first=await server.request('POST','/api/invoices',body);
  assert.equal(first.status,200);assert.equal(first.body.sendOriginalEmail,true);
  assert.equal((await server.request('POST','/api/invoices',body)).status,200);assert.equal(creates,1);
  const context=await store.read(require('../digital-invoice').keyFor('http://priority.invalid/odata/config/test-only',123));
  assert.equal(context.email,body.email);assert.ok(context.consentAt);assert.equal(context.originalDownload,true);
  assert.equal((await server.request('POST','/api/invoices',{...body,consent:false})).status,400);
  assert.equal(creates,1);
});

test('saved original is mailed once across concurrent requests and restart, with exact download bytes',async t=>{
  const store=await deliveryFixture(t),d=require('../digital-invoice');
  const key=d.keyFor('http://priority.invalid/odata/config/test-only',123);
  await store.write(key,'context',{originalDownload:true,sendOriginalEmail:true,custname:'TEST',email:'agent@example.com'});
  const bytes=Buffer.from('%PDF-1.7 /ByteRange exact saved original');let sends=0;
  const transport=url=>url.includes('EXTFILES_SUBFORM')?{value:[{EXTFILEDES:'מסמך ממוחשב',EXTFILENAME:'data:application/pdf;base64,'+bytes.toString('base64')}]}:{IV:123,IVNUM:'IN123',CUSTNAME:'TEST',OWNERLOGIN:'fake-user'};
  const sdk={async digitalCustomerForm(){return {digital:true,email:'agent@example.com'};}};
  const mailer={async verify(){},async sendOriginal(value){sends++;assert.deepEqual(value.buffer,bytes);return {acceptedByMailServer:true,ivnum:value.ivnum,email:value.email};}};
  const server=isolatedServer(transport,200,sdk,store,undefined,mailer);
  const body={ivnum:'IN123',email:'agent@example.com'};
  const result=await Promise.all([server.request('POST','/api/invoices/email-original',body),server.request('POST','/api/invoices/email-original',body)]);
  assert.equal(result[0].status,200);assert.equal(result[1].status,200);assert.equal(sends,1);
  const restarted=isolatedServer(transport,200,sdk,store,undefined,mailer);
  assert.equal((await restarted.request('POST','/api/invoices/email-original',body)).status,200);assert.equal(sends,1);
  const download=await server.request('GET','/api/invoices/existing-original?ivnum=IN123');assert.deepEqual(download.buffer,bytes);
  assert.equal((await server.request('POST','/api/invoices/email-original',{...body,email:'other@example.com'})).status,400);
  assert.ok(server.calls.every(call=>call.method==='GET'));
});

test('uncertain original mail is blocked on retry and missing transport blocks before creation',async t=>{
  const store=await deliveryFixture(t),d=require('../digital-invoice');
  const key=d.keyFor('http://priority.invalid/odata/config/test-only',123);
  await store.write(key,'context',{originalDownload:true,sendOriginalEmail:true,custname:'TEST',email:'agent@example.com'});
  const bytes=Buffer.from('%PDF-1.7 /ByteRange original');let sends=0;
  const sdk={async digitalCustomerForm(){return {name:'Test',digital:true,email:'agent@example.com'};}};
  const server=isolatedServer(url=>url.includes('EXTFILES_SUBFORM')?{value:[{EXTFILEDES:'מסמך ממוחשב',EXTFILENAME:'data:application/pdf;base64,'+bytes.toString('base64')}]}:{IV:123,CUSTNAME:'TEST',OWNERLOGIN:'fake-user'},200,sdk,store,undefined,{async verify(){},async sendOriginal(){sends++;throw Error('uncertain');}});
  const body={ivnum:'IN123',email:'agent@example.com'};
  assert.equal((await server.request('POST','/api/invoices/email-original',body)).status,500);
  assert.equal((await server.request('POST','/api/invoices/email-original',body)).status,400);assert.equal(sends,1);
  const unconfigured=isolatedServer(()=>{throw Error('must not create');},200,sdk,store);
  assert.equal((await unconfigured.request('POST','/api/invoices',{...validDigitalBody(),digitalEmail:false,originalDownload:true,sendOriginalEmail:true})).status,503);
  assert.equal(unconfigured.calls.length,0);
});

function resendTransport(bytes, {owner='fake-user', attachments} = {}) {
  return url => url.includes('EXTFILES_SUBFORM')
    ? {value:attachments || [{EXTFILEDES:'מסמך ממוחשב', EXTFILENAME:'data:application/pdf;base64,' + bytes.toString('base64')}]}
    : {IV:url.includes('IN124')?124:123, CUSTNAME:'INVOICE-CUSTOMER', OWNERLOGIN:owner};
}
const resendBody = () => ({ivnum:'IN123', email:'chosen@example.com', consent:true, requestId:'cdf70483-4d40-4320-85c5-4569db7eac51'});

test('resend options use the invoice customer rather than any customer selected in the browser and do not send or update', async () => {
  const server=isolatedServer(()=>({IV:123,CUSTNAME:'INVOICE-CUSTOMER',OWNERLOGIN:'fake-user'}),200,{
    async digitalCustomerForm(customer){assert.equal(customer,'INVOICE-CUSTOMER');return {name:'Test customer',email:'customer@example.com'};},
  },undefined,undefined,{status:()=>({configured:true})});
  const result=await server.request('GET','/api/invoices/resend-options?ivnum=IN123&custname=OTHER');
  assert.equal(result.status,200);
  assert.deepEqual(result.body,{ivnum:'IN123',custname:'INVOICE-CUSTOMER',name:'Test customer',email:'customer@example.com',configured:true});
  assert.ok(server.calls.every(call=>call.method==='GET'));
});

test('explicit resends use exact saved original bytes, deduplicate retries across restart and allow a separate deliberate resend', async t => {
  const store=await deliveryFixture(t),bytes=Buffer.from('%PDF-1.7 /ByteRange saved original');
  let sends=0;const keys=[];
  const mailer={async verify(){},async sendOriginal({ivnum,email,buffer,workflowKey}){
    sends++;keys.push(workflowKey);assert.deepEqual(buffer,bytes);return {acceptedByMailServer:true,ivnum,email};
  }};
  const server=isolatedServer(resendTransport(bytes),200,{},store,undefined,mailer);
  const body=resendBody();
  const results=await Promise.all([server.request('POST','/api/invoices/resend-original',body),server.request('POST','/api/invoices/resend-original',body)]);
  assert.equal(results[0].status,200);assert.equal(results[1].status,200);assert.equal(sends,1);
  const restarted=isolatedServer(resendTransport(bytes),200,{},store,undefined,mailer);
  assert.equal((await restarted.request('POST','/api/invoices/resend-original',body)).status,200);assert.equal(sends,1);
  const next=await server.request('POST','/api/invoices/resend-original',{...body,requestId:'4fbe6e39-e211-47f3-9a3c-05fd0332cdaa'});
  assert.equal(next.status,200);assert.equal(sends,2);assert.notEqual(keys[0],keys[1]);
  assert.ok(server.calls.every(call=>call.method==='GET'),'must not regenerate or change customer data');
  assert.equal(results[0].body.sha256,require('node:crypto').createHash('sha256').update(bytes).digest('hex'));
});

test('resend does not reuse the automatic issuance mail state and cannot change recipient or invoice under the same request ID', async t => {
  const store=await deliveryFixture(t),digital=require('../digital-invoice');let sends=0;
  await store.write(digital.keyFor('http://priority.invalid/odata/config/test-only',123),'mail',{status:'complete',result:{email:'old@example.com'}});
  const server=isolatedServer(resendTransport(Buffer.from('%PDF-1.7 /ByteRange saved')),200,{},store,undefined,{
    async verify(){},async sendOriginal(){sends++;return {acceptedByMailServer:true};},
  });
  const body=resendBody();assert.equal((await server.request('POST','/api/invoices/resend-original',body)).status,200);
  for (const changed of [{email:'different@example.com'},{ivnum:'IN124'}]) {
    assert.equal((await server.request('POST','/api/invoices/resend-original',{...body,...changed})).status,400);
  }
  assert.equal(sends,1);
});

test('invalid resend consent, recipient and request ID fail before reading Priority or sending', async () => {
  const server=isolatedServer(()=>{throw Error('Must not read Priority');});
  for(const invalid of [{consent:false},{email:'x@example.com\r\nBcc:other@example.com'},{requestId:''},{requestId:'------------------------------------'}]) {
    assert.equal((await server.request('POST','/api/invoices/resend-original',{...resendBody(),...invalid})).status,400);
  }
  assert.equal(server.calls.length,0);
});

test('resend keeps existing invoice ownership checks and rejects drafts', async t => {
  const server=isolatedServer(resendTransport(Buffer.from('%PDF- /ByteRange'),{owner:'other'}),200,{},await deliveryFixture(t));
  for(const method of ['GET','POST']) {
    const url=method==='GET'?'/api/invoices/resend-options?ivnum=IN123':'/api/invoices/resend-original';
    assert.equal((await server.request(method,url,method==='POST'?resendBody():undefined)).status,400);
  }
  assert.equal((await server.request('POST','/api/invoices/resend-original',{...resendBody(),ivnum:'T123'})).status,400);
});

test('missing, ambiguous or invalid originals never trigger resend or regeneration', async t => {
  for(const attachments of [[],[{EXTFILEDES:'מסמך ממוחשב',EXTFILENAME:'invalid'}],
    [{EXTFILEDES:'מסמך ממוחשב'},{EXTFILEDES:'מסמך ממוחשב'}]]) {
    let sends=0;
    const server=isolatedServer(resendTransport(Buffer.from(''),{attachments}),200,{},await deliveryFixture(t),undefined,{
      async verify(){throw Error('must not verify before original');},async sendOriginal(){sends++;},
    });
    assert.notEqual((await server.request('POST','/api/invoices/resend-original',resendBody())).status,200);
    assert.equal(sends,0);assert.ok(server.calls.every(call=>call.method==='GET'));
  }
});

test('uncertain resends and unconfirmed acceptance remain blocked across restart', async t => {
  for(const response of ['timeout','unconfirmed']) {
    const store=await deliveryFixture(t);let sends=0;
    const transport=resendTransport(Buffer.from('%PDF-1.7 /ByteRange original'));
    const mailer={async verify(){},async sendOriginal(){sends++;if(response==='timeout')throw Error('timeout');return {};}};
    const first=isolatedServer(transport,200,{},store,undefined,mailer);
    assert.equal((await first.request('POST','/api/invoices/resend-original',resendBody())).status,500);
    const restarted=isolatedServer(transport,200,{},store,undefined,mailer);
    assert.equal((await restarted.request('POST','/api/invoices/resend-original',resendBody())).status,400);
    assert.equal(sends,1);
  }
});

test('agent rows expose document eligibility without exposing the Priority owner login', async () => {
  const server=isolatedServer(()=>({value:[
    {AGENTCODE:'90',IVNUM:'IN123',OWNERLOGIN:'fake-user'},
    {AGENTCODE:'90',IVNUM:'IN124',OWNERLOGIN:'other-user'},
  ]}));
  const result=await server.request('GET','/api/invoices/recent?agent=90');
  assert.deepEqual(result.body.value.map(row=>row.canManageDocuments),[true,false]);
  assert.ok(result.body.value.every(row=>!('OWNERLOGIN' in row)));
});

test('agent history pages contain ten rows and use the last visible IV to fetch older records', async () => {
  let rows=Array.from({length:23},(_,i)=>({IV:200-i,IVNUM:'IN'+(200-i),AGENTCODE:'90',OWNERLOGIN:'fake-user'}));
  const server=isolatedServer(url=>{
    const query=new URL(url).searchParams,filter=query.get('$filter');
    assert.equal(query.get('$orderby'),'IV desc');assert.equal(query.get('$top'),'11');
    const before=Number(filter.match(/IV lt (\d+)/)?.[1]||Infinity);
    return {value:rows.filter(row=>row.IV<before).slice(0,11)};
  });
  const first=await server.request('GET','/api/invoices/recent?agent=90');
  assert.equal(first.status,200);assert.equal(first.body.value.length,10);assert.equal(first.body.nextBefore,'191');assert.equal(first.body.hasMore,true);
  assert.ok(first.body.value.every(row=>!('IV' in row)));
  // New records arriving at the top must not shift or repeat the older pages.
  rows.unshift({IV:201,IVNUM:'IN201',AGENTCODE:'90',OWNERLOGIN:'fake-user'});
  const second=await server.request('GET','/api/invoices/recent?agent=90&before=191');
  assert.equal(second.body.value.length,10);assert.equal(second.body.value[0].IVNUM,'IN190');assert.equal(second.body.nextBefore,'181');
  const last=await server.request('GET','/api/invoices/recent?agent=90&before=181');
  assert.equal(last.body.value.length,3);assert.equal(last.body.hasMore,false);assert.equal(last.body.nextBefore,null);
  const numbers=[...first.body.value,...second.body.value,...last.body.value].map(row=>row.IVNUM);
  assert.equal(new Set(numbers).size,23);
  assert.ok(server.calls.every(call=>call.method==='GET'));
});

test('history rejects invalid cursors and customer/agent mixtures before contacting Priority', async () => {
  const server=isolatedServer(()=>{throw Error('Must not query');});
  for(const query of ['agent=90&before=0','agent=90&before=-1','agent=90&before=1.5',
    'agent=90&before=1%20or%201%20eq%201','agent=90&before=9007199254740992','before=10',
    'custname=TEST&before=10','agent=90&custname=TEST&before=10']) {
    assert.equal((await server.request('GET','/api/invoices/recent?'+query)).status,400,query);
  }
  assert.equal(server.calls.length,0);
});

test('exactly ten or zero remaining rows hide load-more without requiring an empty extra page', async () => {
  for(const count of [0,10]) {
    const server=isolatedServer(()=>({value:Array.from({length:count},(_,i)=>({IV:100-i,IVNUM:'IN'+(100-i),AGENTCODE:'90'}))}));
    const result=await server.request('GET','/api/invoices/recent?agent=90');
    assert.equal(result.body.value.length,count);assert.equal(result.body.hasMore,false);assert.equal(result.body.nextBefore,null);
  }
});
