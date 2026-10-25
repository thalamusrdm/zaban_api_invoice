'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const path = require('node:path');

// The real HTTP handler runs with a fake Priority transport and no filesystem writes.
function isolatedServer(getResponse, responseStatus = 200, sdk = {}, store, originals) {
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
    async request(method, url, body) {
      const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
      Object.assign(req, { method, url });
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


test('close is verified by internal IV and unverified absence never returns success', async () => {
  for (const found of [true, false]) {
    let closed=0;
    const server=isolatedServer(url => url.includes('$filter=') ? { value: found ? [{ IVNUM:'IN-TEST',STATDES:'סופית' }] : [] } : { IV:123,STATDES:'טיוטא' },200,{async closeInvoice(){closed++;return {};}});
    const result=await server.request('POST','/api/invoices/close',{ivnum:'T-TEST'});
    assert.equal(closed,1);assert.equal(result.status,found ? 200 : 502);
    if(found)assert.equal(result.body.ivnum,'IN-TEST');else assert.match(result.body.error,/לא ניתן לאמת/);
    assert.ok(decodeURIComponent(server.calls[1].url).includes('IV eq 123'));
  }
});

test('original route rejects non-API invoices before running any original procedure',async()=>{let calls=0;const s=isolatedServer(()=>({IV:123,OWNERLOGIN:'another-user'}),200,{async getOriginalInvoiceDocument(){calls++;}});const response=await s.request('POST','/api/invoices/original',{ivnum:'IN123'});assert.equal(response.status,400);assert.equal(calls,0);});

test('server rejects original-mode creation for an ineligible customer before any invoice write',async()=>{const s=isolatedServer(undefined,200,{async getOriginalCustomerReadiness(){return {ready:false,reason:'לא מוגדר למסמך ממוחשב'};}});const response=await s.request('POST','/api/invoices',{original:true,custname:'301100',date:'2026-10-22',invoiceType:'1',lines:[{partname:'14',quantity:1,price:10,currency:'USD',exchange:3.11}]});assert.equal(response.status,400);assert.match(response.body.error,/מסמך ממוחשב/);assert.equal(s.calls.length,0);});

async function deliveryFixture(t){const fsp=require('node:fs/promises');const os=require('node:os');const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'invoice-http-digital-'));t.after(()=>fsp.rm(dir,{recursive:true,force:true}));return require('../digital-invoice').workflowStore(dir);}
const validDigitalBody=()=>({custname:'TEST',date:'2026-10-22',invoiceType:'1',lines:[{partname:'14',quantity:1,price:10,currency:'USD',exchange:3.11}],digitalEmail:true,consent:true,email:'agent@example.com',requestId:'cdf70483-4d40-4320-85c5-4569db7eac51'});
test('digital creation retries reuse one draft and reject changing the payload under its request ID',async t=>{const store=await deliveryFixture(t);let created=0,prepared=0;const server=isolatedServer((_url,options)=>{if(options.method==='POST'){created++;return {IV:123,IVNUM:'T123',STATDES:'טיוטא'};}throw Error('Unexpected transport');},200,{async prepareDigitalCustomer(custname,email){prepared++;return {custname,email};},async prepareDigitalInvoice(){}},store);const body=validDigitalBody();const result=await Promise.all([server.request('POST','/api/invoices',body),server.request('POST','/api/invoices',body)]);assert.equal(result[0].status,200);assert.equal(result[1].body.ivnum,'T123');assert.equal(created,1);assert.equal(prepared,1);const changed=await server.request('POST','/api/invoices',{...body,email:'other@example.com'});assert.equal(changed.status,400);assert.equal(created,1);});
test('mail retries cannot send twice or change the saved recipient',async t=>{const store=await deliveryFixture(t);const d=require('../digital-invoice');const key=d.keyFor('http://priority.invalid/odata/config/test-only',123);await store.write(key,'context',{digitalEmail:true,custname:'TEST',email:'agent@example.com'});let mails=0;const server=isolatedServer(()=>({IV:123,IVNUM:'IN123',CUSTNAME:'TEST',OWNERLOGIN:'fake-user'}),200,{async sendDigitalInvoice(ivnum,email){mails++;return {ivnum,email,acceptedByPriority:true};}},store);const body={ivnum:'IN123',digitalEmail:true,consent:true,email:'agent@example.com'};assert.equal((await server.request('POST','/api/invoices/email',body)).status,200);assert.equal((await server.request('POST','/api/invoices/email',body)).status,200);assert.equal(mails,1);assert.equal((await server.request('POST','/api/invoices/email',{...body,email:'other@example.com'})).status,400);assert.equal(mails,1);});
test('signed copy is attached to its own invoice once; another invoice cannot use its token',async t=>{const store=await deliveryFixture(t);const {PDFDocument}=require('pdf-lib');const {PNG}=require('pngjs');const fixture=await PDFDocument.create();const invoicePage=fixture.addPage();invoicePage.drawText('TEST COPY IN123');await require('./fixtures/signature-invoice.cjs').addSignatureFields(fixture,invoicePage);const bytes=Buffer.from(await fixture.save());const png=new PNG({width:640,height:180});png.data.fill(255);for(let x=30;x<500;x++)for(let y=80;y<84;y++){const i=(640*y+x)*4;png.data[i]=png.data[i+1]=png.data[i+2]=20;}const signature='data:image/png;base64,'+PNG.sync.write(png).toString('base64');let uploads=0,descriptor;let uploaded;
const server=isolatedServer((url,options)=>{if(url.includes('EXTFILES_SUBFORM')){if(options.method==='POST'){uploads++;const payload=JSON.parse(options.body);descriptor=payload.EXTFILEDES;uploaded=Buffer.from(payload.EXTFILENAME.split(',')[1],'base64');return {EXTFILENUM:77};}return {value:descriptor?[{EXTFILENUM:77,EXTFILEDES:descriptor}]:[]};}return {IV:url.includes('IN124')?124:123,IVNUM:url.includes('IN124')?'IN124':'IN123',CUSTNAME:'TEST',OWNERLOGIN:'fake-user'};},200,{async getInvoiceDocumentUrl(){return {datauri:'data:application/pdf;base64,'+bytes.toString('base64')};}},store);
const copy=await server.request('GET','/api/invoices/signature-copy?ivnum=IN123');assert.equal(copy.status,200);assert.deepEqual(copy.buffer,bytes);const token=copy.headers['X-Signature-Token'];const body={ivnum:'IN123',token,signer:'בדיקה',signature};assert.equal((await server.request('POST','/api/invoices/sign',{...body,ivnum:'IN124'})).status,400);assert.equal(uploads,0);assert.equal((await server.request('POST','/api/invoices/sign',body)).status,200);assert.equal((await server.request('POST','/api/invoices/sign',body)).status,200);assert.equal(uploads,1);assert.equal((await PDFDocument.load(uploaded)).getPageCount(),1);assert.match(descriptor,/IN123/);});

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
