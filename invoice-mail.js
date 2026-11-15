'use strict';
const { emailAddress } = require('./digital-invoice');

// A separate transport sends saved original bytes, never runs Priority printing.
function createMailer(env = process.env, createTransport = options => require('nodemailer').createTransport(options)) {
  let transport;
  function configuration() {
    const required = ['SMTP_HOST', 'SMTP_FROM', 'SMTP_USER'];
    if (required.some(key => !env[key]) || !(env.SMTP_PASSWORD ||
        (env.SMTP_OAUTH_CLIENT_ID && env.SMTP_OAUTH_CLIENT_SECRET && env.SMTP_OAUTH_REFRESH_TOKEN && env.SMTP_OAUTH_TOKEN_URL))) {
      throw Object.assign(new Error('חיבור הדואר של היישום טרם הוגדר. ניתן להמשיך בהורדת המקור ללא מייל.'), { status: 503 });
    }
    const from = emailAddress(env.SMTP_FROM);
    const port = Number(env.SMTP_PORT || 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('הגדרת חיבור הדואר אינה תקינה');
    const auth = env.SMTP_PASSWORD ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : {
      type: 'OAuth2', user: env.SMTP_USER, clientId: env.SMTP_OAUTH_CLIENT_ID,
      clientSecret: env.SMTP_OAUTH_CLIENT_SECRET, refreshToken: env.SMTP_OAUTH_REFRESH_TOKEN,
      accessUrl: env.SMTP_OAUTH_TOKEN_URL,
      customParams: { scope: env.SMTP_OAUTH_SCOPE || 'https://outlook.office.com/SMTP.Send offline_access' },
    };
    return { from, options: { host: env.SMTP_HOST, port, secure: port === 465, requireTLS: true,
      auth, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
      disableFileAccess: true, disableUrlAccess: true } };
  }
  function status() {
    try { return { configured: true, from: configuration().from }; }
    catch { return { configured: false }; }
  }
  function getTransport() { return transport ||= createTransport(configuration().options); }
  async function verify() {
    configuration();
    try { await getTransport().verify(); }
    catch { throw Object.assign(new Error('החיבור לתיבה השולחת לא אומת. יש לבדוק את הגדרות הדואר; לא נשלחה הודעה.'), { status: 503 }); }
  }
  async function sendOriginal({ ivnum, email, buffer, workflowKey }) {
    const { from } = configuration();
    email = emailAddress(email);
    if (!/^IN[0-9]+$/.test(ivnum) || !/^[a-f0-9]{64}$/.test(workflowKey) || !Buffer.isBuffer(buffer) ||
        buffer.length > 15000000 || buffer.subarray(0, 5).toString() !== '%PDF-' || !buffer.includes(Buffer.from('/ByteRange'))) {
      throw new Error('לא התקבל מקור חשבונית תקין לשליחה');
    }
    let result;
    try {
      result = await getTransport().sendMail({ from, to: email,
        messageId: `<invoice-${workflowKey}@${from.split('@')[1]}>`,
        subject: `חשבונית מקור ${ivnum}`,
        text: `שלום,\nמצורפת חשבונית המקור ${ivnum}.\nצבאן בכור תכשיטים`,
        attachments: [{ filename: `${ivnum}-original.pdf`, content: buffer, contentType: 'application/pdf' }],
      });
    } catch { throw new Error('תוצאת שליחת המייל אינה ודאית. יש לבדוק בתיבה השולחת לפני ניסיון נוסף.'); }
    if (!(result.accepted || []).some(address => String(address).toLowerCase() === email.toLowerCase()) || result.rejected?.length) {
      throw new Error('שרת הדואר לא אישר קבלת ההודעה לנמען. יש לבדוק לפני ניסיון נוסף.');
    }
    return { acceptedByMailServer: true, email, ivnum, messageId: result.messageId };
  }
  return { status, verify, sendOriginal };
}
module.exports = { createMailer };
