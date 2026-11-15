'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createMailer} = require('../invoice-mail');
const env = { SMTP_HOST:'smtp.invalid', SMTP_FROM:'digital@example.com', SMTP_USER:'digital@example.com', SMTP_PASSWORD:'test-only' };
const source = Buffer.from('%PDF-1.7 /ByteRange existing original bytes');
const payload = {ivnum:'IN123', email:'customer@example.com', buffer:source, workflowKey:'a'.repeat(64)};
test('mail transport requires configuration and does not expose credentials', async () => {
  const mailer=createMailer({});
  assert.deepEqual(mailer.status(),{configured:false});
  await assert.rejects(mailer.verify(), /טרם הוגדר/);
});
test('SMTP sends the exact saved PDF with TLS and a stable message ID', async () => {
  let options, message;
  const mailer=createMailer(env, config=>{options=config;return {async verify(){},async sendMail(value){message=value;return {accepted:[payload.email],rejected:[],messageId:value.messageId};}};});
  await mailer.verify();const result=await mailer.sendOriginal(payload);
  assert.equal(options.requireTLS,true);assert.equal(options.secure,false);
  assert.equal(options.disableFileAccess,true);assert.equal(options.disableUrlAccess,true);
  assert.equal(message.from,env.SMTP_FROM);assert.equal(message.to,payload.email);
  assert.equal(message.attachments[0].content,source);
  assert.equal(message.attachments[0].filename,'IN123-original.pdf');
  assert.equal(result.acceptedByMailServer,true);assert.ok(result.messageId.includes(payload.workflowKey));
  assert.equal(JSON.stringify(mailer.status()).includes('test-only'),false);
});
test('failed or rejected sends are never presented as accepted and provider errors stay private', async () => {
  for(const transport of [{async sendMail(){throw Error('secret-access-token');}},{async sendMail(){return {accepted:[],rejected:[payload.email]};}}]){
    const mailer=createMailer(env,()=>transport);
    await assert.rejects(mailer.sendOriginal(payload), error=>!error.message.includes('secret-access-token'));
  }
});
test('Microsoft OAuth configuration uses an explicit token endpoint and scope', async () => {
  let options;
  const mailer=createMailer({...env,SMTP_PASSWORD:'',SMTP_OAUTH_CLIENT_ID:'app',SMTP_OAUTH_CLIENT_SECRET:'secret',SMTP_OAUTH_REFRESH_TOKEN:'refresh',SMTP_OAUTH_TOKEN_URL:'https://login.microsoftonline.com/common/oauth2/v2.0/token'},config=>{options=config;return {async verify(){}};});
  await mailer.verify();assert.equal(options.auth.type,'OAuth2');
  assert.equal(options.auth.accessUrl,'https://login.microsoftonline.com/common/oauth2/v2.0/token');
  assert.match(options.auth.customParams.scope,/outlook.office.com\/SMTP.Send/);
});
