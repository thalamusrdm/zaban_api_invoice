'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {createN8nMailer}=require('../n8n-mail');
const env={N8N_INVOICE_MAIL_URL:'https://n8n.example/webhook/invoice-original-email',N8N_INVOICE_MAIL_KEY:'private-test-key'};
const payload={ivnum:'IN123',email:'customer@example.com',buffer:Buffer.from('%PDF-1.7 /ByteRange saved bytes'),workflowKey:'a'.repeat(64)};
const acceptance={accepted:true,protocol:'zaban-original-v1',from:'sales@zaban-bechor.co.il',email:payload.email,ivnum:payload.ivnum,workflow_key:payload.workflowKey,sha256:createHash('sha256').update(payload.buffer).digest('hex')};
test('n8n sends exact saved bytes with authenticated POST and no redirects',async()=>{
  let sent;
  const mailer=createN8nMailer(env,async(url,options)=>{sent={url,options,body:JSON.parse(options.body)};return{ok:true,json:async()=>acceptance};});
  assert.equal((await mailer.sendOriginal(payload)).acceptedByMailServer,true);
  assert.deepEqual(Buffer.from(sent.body.pdf_base64,'base64'),payload.buffer);
  assert.equal(sent.body.sha256,acceptance.sha256);
  assert.equal(sent.options.redirect,'error');
  assert.equal(sent.options.headers['X-Zaban-Invoice-Key'],env.N8N_INVOICE_MAIL_KEY);
  assert.equal(JSON.stringify(mailer.status()).includes(env.N8N_INVOICE_MAIL_KEY),false);
});
test('n8n readiness never sends an attachment or email',async()=>{
  let body;
  const mailer=createN8nMailer(env,async(url,options)=>{body=JSON.parse(options.body);return{ok:true,json:async()=>({ready:true,protocol:'zaban-original-v1',from:'sales@zaban-bechor.co.il'})};});
  await mailer.verify();assert.deepEqual(body,{action:'check'});
});
test('n8n failures and mismatched confirmations remain uncertain with one attempt',async()=>{
  for(const value of [{success:true},{...acceptance,sha256:'b'.repeat(64)},{...acceptance,email:'another@example.com'},null]){
    let calls=0;
    const mailer=createN8nMailer(env,async()=>{calls++;return{ok:true,json:async()=>value};});
    await assert.rejects(mailer.sendOriginal(payload),/אינה ודאית/);assert.equal(calls,1);
  }
  let calls=0;
  const mailer=createN8nMailer(env,async()=>{calls++;throw Error('private-token');});
  await assert.rejects(mailer.sendOriginal(payload),e=>!e.message.includes('private-token'));
  assert.equal(calls,1);
});
test('n8n configuration and attachment validation fail before transmitting data',async()=>{
  for(const url of ['http://n8n.example/x','https://user:pass@n8n.example/x','https://n8n.example/x?key=secret']) assert.equal(createN8nMailer({...env,N8N_INVOICE_MAIL_URL:url}).status().configured,false);
  const mailer=createN8nMailer(env,async()=>{throw Error('must not send');});
  await assert.rejects(mailer.sendOriginal({...payload,buffer:Buffer.alloc(2800001)}));
  assert.throws(()=>mailer.validateOriginal(Buffer.alloc(2800001)),{status:413});
  await assert.rejects(mailer.sendOriginal({...payload,buffer:Buffer.from('%PDF- unsigned')}),/תקין/);
});
