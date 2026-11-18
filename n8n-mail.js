'use strict';
const { createHash } = require('node:crypto');
const { emailAddress } = require('./digital-invoice');

// The existing n8n Outlook credential owns Microsoft authentication.
// Never retry sends here: a lost response can still mean mail was sent.
function createN8nMailer(env, request = globalThis.fetch) {
  function configuration() {
    let url;
    try { url = new URL(env.N8N_INVOICE_MAIL_URL); } catch {}
    if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
        !env.N8N_INVOICE_MAIL_KEY || /[\r\n]/.test(env.N8N_INVOICE_MAIL_KEY)) {
      throw Object.assign(new Error('חיבור הדואר ל־n8n טרם הוגדר. ניתן להמשיך בהורדת המקור ללא מייל.'), {status:503});
    }
    return {url:url.href, from:emailAddress(env.N8N_INVOICE_MAIL_FROM || 'sales@zaban-bechor.co.il')};
  }
  function status() {
    try { return {configured:true, from:configuration().from}; } catch { return {configured:false}; }
  }
  async function post(body) {
    const {url} = configuration();
    const response = await request(url, {
      method:'POST', redirect:'error', signal:AbortSignal.timeout(90000),
      headers:{'Content-Type':'application/json', 'X-Zaban-Invoice-Key':env.N8N_INVOICE_MAIL_KEY},
      body:JSON.stringify(body),
    });
    if (!response.ok) throw new Error('n8n mail request failed');
    const value = await response.json();
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Unexpected mail response');
    return value;
  }
  async function verify() {
    const {from} = configuration();
    try {
      const result = await post({action:'check'});
      if (result.ready !== true || result.from !== from || result.protocol !== 'zaban-original-v1') throw Error('Not ready');
    } catch {
      throw Object.assign(new Error('תהליך הדואר ב־n8n אינו זמין. לא נשלחה הודעה.'), {status:503});
    }
  }
  function validateOriginal(buffer) {
    // Leave room for base64, JSON and Outlook metadata under Graph's 4 MB limit.
    if (buffer.length > 2800000) throw Object.assign(new Error('מקור החשבונית גדול מדי לשליחה במייל. אפשר להוריד אותו למכשיר.'), {status:413});
  }
  async function sendOriginal({ivnum,email,buffer,workflowKey}) {
    const {from} = configuration();
    email = emailAddress(email);
    if (!/^IN[0-9]+$/.test(ivnum) || !/^[a-f0-9]{64}$/.test(workflowKey) || !Buffer.isBuffer(buffer) ||
        buffer.subarray(0,5).toString() !== '%PDF-' || !buffer.includes(Buffer.from('/ByteRange'))) {
      throw new Error('לא התקבל מקור חשבונית תקין לשליחה');
    }
    validateOriginal(buffer);
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    try {
      const result = await post({action:'send',protocol:'zaban-original-v1',ivnum,email,workflow_key:workflowKey,
        sha256,pdf_base64:buffer.toString('base64')});
      if (result.accepted !== true || result.protocol !== 'zaban-original-v1' || result.from !== from ||
          result.email !== email || result.ivnum !== ivnum || result.workflow_key !== workflowKey || result.sha256 !== sha256) {
        throw Error('Missing acceptance');
      }
      return {acceptedByMailServer:true,email,ivnum,provider:'n8n-outlook',messageId:result.messageId};
    } catch {
      throw new Error('תוצאת שליחת המייל אינה ודאית. יש לבדוק בתיבת Sales וב־n8n לפני ניסיון נוסף.');
    }
  }
  return {status,verify,sendOriginal,validateOriginal};
}
module.exports = {createN8nMailer};
