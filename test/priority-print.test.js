'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');

test('customer setup saves contact details and electronic documents together and verifies persisted values', async () => {
  const row = { CUSTNAME: 'TEST', CUSTDES: 'Test customer', EMAIL: '', PHONE: '', EDOCUMENTS: '' };
  const writes = [];
  let reads = 0;
  const sdk = {
    async login() {},
    async formStart(name) {
      assert.equal(name, 'CUSTOMERS');
      const pending = {};
      return {
        columns: { EMAIL: { mandatory: 1, readonly: 0 }, PHONE: {}, EDOCUMENTS: { type: 'bool' } },
        async setSearchFilter({ QueryValues }) { assert.equal(QueryValues[0].fromval, 'TEST'); },
        async getRows() { reads++; return { CUSTOMERS: { 1: { ...row } } }; },
        async setActiveRow(index) { assert.equal(index, 1); },
        async fieldUpdate(field, value) { pending[field] = value; },
        async saveRow() { writes.push({ ...pending }); Object.assign(row, pending); },
        async endCurrentForm() {},
      };
    },
  };
  const context = {
    module: { exports: {} },
    process: { env: { PRIORITY_BASE_URL: 'https://test.invalid/odata/config' } },
    setTimeout() { return { unref() {} }; },
    require() { return sdk; },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../priority-sdk.js'), 'utf8'), context);
  const { prepareDigitalCustomer } = context.module.exports;
  const saved = await prepareDigitalCustomer('TEST', 'customer@example.com', '050-5550123');
  assert.equal(saved.email, 'customer@example.com');
  assert.equal(saved.phone, '050-5550123');
  assert.equal(saved.digital, true);
  assert.equal(reads, 2);
  await prepareDigitalCustomer('TEST', 'customer@example.com', '050-5550123');
  await prepareDigitalCustomer('TEST', 'corrected@example.com');
  assert.deepEqual(writes, [
    { EMAIL: 'customer@example.com', PHONE: '050-5550123', EDOCUMENTS: 'Y' },
    { EMAIL: 'corrected@example.com' },
  ]);
});

test('printing acknowledges client steps correctly and explicitly selects display, never email or signature',async()=>{
  let client=0,options,closed=0;
  const proc={async clientContinue(){client++;return {type:'documentOptions',formats:[{format:-1,selected:1}],proc};},async documentOptions(...args){options=args;return {type:'displayUrl',Urls:[{datauri:'data:application/pdf;base64,JVBERi0='}],proc};},async continueProc(){throw Error('Wrong continuation for client step');}};
  const form={async setSearchFilter(){},async getRows(){return {AINVOICES:{1:{IVNUM:'IN-FAKE'}}};},async setActiveRow(){},async activateStart(){return {type:'client',data:[{NAM:"'PRINTORIG'",VAL:'1'}],proc};},async activateEnd(){},async endCurrentForm(){closed++;}};
  const ctx={module:{exports:{}},process:{env:{PRIORITY_BASE_URL:'https://test.invalid/odata/tabula.ini',PRIORITY_COMPANY:'test',PRIORITY_USER:'fake',PRIORITY_PASSWORD:'fake'}},setTimeout(){return {unref(){}};},require(){return {async login(){},async formStart(){return form;}};}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../priority-sdk.js'),'utf8'),ctx);
  const result=await ctx.module.exports.getInvoiceDocumentUrl('IN-FAKE');
  assert.equal(client,1);assert.equal(options[0],1);assert.equal(options[1],-1);assert.equal(options[2].pdf,1);assert.equal(options[2].mode,'display');assert.equal(options[2].word,0);assert.equal(closed,1);assert.ok(result.datauri.startsWith('data:application/pdf'));
});

test('original uses only the standalone procedure and the exact requested invoice input',async()=>{let called,input,cancelled=0;const proc={async inputFields(ok,fields){input=fields;return {type:'displayUrl',Urls:[{url:'https://test.invalid/original.pdf'}],proc};},async cancel(){cancelled++;}};const fake={async login(){},async procStart(name){called=name;return {type:'inputFields',input:{EditFields:[{field:1}]},proc};},async formStart(){throw Error('Must not modify regular invoice actions');}};const ctx={module:{exports:{}},process:{env:{PRIORITY_BASE_URL:'https://test.invalid/odata/config',PRIORITY_COMPANY:'zaban'}},URL,setTimeout(){return {unref(){}};},require(){return fake;}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../priority-sdk.js'),'utf8'),ctx);const doc=await ctx.module.exports.getOriginalInvoiceDocument('IN123');assert.equal(called,'ZBAN_ORIGINALPDF');assert.equal(input.EditFields[0].value,'IN123');assert.equal(doc.url,'https://test.invalid/original.pdf');assert.equal(cancelled,1);});

test('relative original paths are retained and resolved read-only without another generation',async()=>{let generated=0,resolved=0;const proc={async inputFields(){return {type:'displayUrl',Urls:[{url:'../../system/mail/saved/original.pdf'}],proc};},async cancel(){}};const fake={async login(){},async procStart(){generated++;return {type:'inputFields',input:{EditFields:[{field:1}]},proc};},async formStart(){return {async getFileUrl(filename){resolved++;assert.equal(filename,'../../system/mail/saved/original.pdf');return 'https://test.invalid/primail/saved/original.pdf';},async endCurrentForm(){}};}};const ctx={module:{exports:{}},process:{env:{PRIORITY_BASE_URL:'https://test.invalid/odata/config'}},URL,setTimeout(){return {unref(){}};},require(){return fake;}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../priority-sdk.js'),'utf8'),ctx);const doc=await ctx.module.exports.getOriginalInvoiceDocument('IN123');assert.equal(doc.url,'../../system/mail/saved/original.pdf');assert.equal(generated,1);const url=await ctx.module.exports.resolveOriginalDocumentUrl(doc.url);assert.equal(url,'https://test.invalid/primail/saved/original.pdf');assert.equal(resolved,1);assert.equal(generated,1);});

test('digital email uses the approved customer address and native automail exactly once',async()=>{let options,activations=0;const proc={async clientContinue(){return {type:'documentOptions',formats:[{selected:1,format:-1}],hasAutoMail:1,proc};},async documentOptions(...args){options=args;return {type:'displayUrl',Urls:[{url:'https://test.invalid/result'}],proc};},async continueProc(){return {type:'end',proc};},async cancel(){}};const invoice={async setSearchFilter(){},async getRows(){return {AINVOICES:{1:{IVNUM:'IN123',OWNERLOGIN:'API',CUSTNAME:'TEST',FINAL:'Y',NAME:'',PRINTEDBOOL:''}}};},async setActiveRow(){},async activateStart(name){activations++;assert.equal(name,'WWWSHOWAIV');return {type:'client',proc};},async activateEnd(){},async endCurrentForm(){}};const customer={columns:{EMAIL:{},EDOCUMENTS:{}},async setSearchFilter(){},async getRows(){return {CUSTOMERS:{1:{CUSTNAME:'TEST',CUSTDES:'Test',EMAIL:'agent@example.com',EDOCUMENTS:'Y'}}};},async endCurrentForm(){}};const ctx={module:{exports:{}},process:{env:{PRIORITY_BASE_URL:'https://test.invalid/odata/config',PRIORITY_USER:'API'}},URL,setTimeout(){return {unref(){}};},require(){return {async login(){},async formStart(name){return name==='AINVOICES'?invoice:customer;}};}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../priority-sdk.js'),'utf8'),ctx);const result=await ctx.module.exports.sendDigitalInvoice('IN123','agent@example.com','TEST');assert.equal(result.acceptedByPriority,true);assert.equal(options[2].mode,'automail');assert.equal(options[2].pdf,1);assert.equal(activations,1);});
