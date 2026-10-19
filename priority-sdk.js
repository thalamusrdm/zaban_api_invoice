// סגירת חשבונית (טיוטה T -> סופית IN) דרך Priority Web SDK.
// ה-OData API לא מריץ פרוצדורות מסך, ולכן הסגירה נעשית כאן: פתיחת טופס AINVOICES,
// איתור החשבונית והרצת ההפעלה הישירה CLOSEANINVOICE ("סגירת החשבונית").
'use strict';

const priority = require('priority-web-sdk');

const CLOSE_PROC = process.env.PRIORITY_CLOSE_PROC || 'CLOSEANINVOICE';

let loginPromise = null;
function ensureLogin() {
  if (!loginPromise) {
    loginPromise = priority.login({
      url: process.env.PRIORITY_BASE_URL.replace(/\/odata\/.*$/, ''),
      tabulaini: (process.env.PRIORITY_BASE_URL.match(/tabula[^/]*\.ini/) || ['tabula.ini'])[0],
      language: 1, // עברית — כדי שהודעות השגיאה יחזרו בעברית
      profile: { company: process.env.PRIORITY_COMPANY },
      appname: 'local-invoices',
      username: process.env.PRIORITY_USER,
      password: process.env.PRIORITY_PASSWORD,
      devicename: 'local-invoices-ui',
    }).catch(err => { loginPromise = null; throw err; });
  }
  return loginPromise;
}

// עוטף כל קריאת SDK ב-timeout כדי שהממשק לעולם לא ייתקע על "סוגר…"
function withTimeout(promise, stage, ms = 45000) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`תקיעה בשלב ${stage} (timeout אחרי ${ms / 1000} שניות)`)), ms).unref?.()),
  ]);
}

function errText(e) {
  if (!e) return 'שגיאה לא ידועה';
  if (typeof e === 'string') return e;
  return e.message || e.text || JSON.stringify(e).slice(0, 500);
}

/**
 * סוגר חשבונית טיוטה. מחזיר את ההודעות שהצטברו מהפרוצדורה.
 * @param {string} ivnum מספר טיוטה, למשל 'T59790'
 */
async function closeInvoice(ivnum, log) {
  const trace = msg => { if (log) log({ sdkClose: ivnum, step: msg }); };
  let stage = 'login';
  try {
    await ensureLogin();
    trace('login OK');

    // הודעות מהטופס (שגיאה/אזהרה/מידע) חייבות אישור, אחרת הטופס נתקע בצד השרת.
    // מאשרים אוטומטית, שומרים את הטקסט, ואם הגיעה שגיאה — נכשלים איתה בסוף.
    const formMessages = [];
    let formError = null;
    let formRef = null;
    const onMsg = resp => {
      const text = errText(resp);
      formMessages.push(text);
      trace(`form message (${resp?.type}): ${text}`);
      if (resp?.type === 'error' || resp?.fatal) formError = text;
      const f = resp?.form || formRef;
      try {
        if (resp?.type === 'warning') f?.warningConfirm(1);
        else f?.infoMsgConfirm();
      } catch (e) { trace('confirm failed: ' + errText(e)); }
    };

    stage = 'formStart';
    const form = await withTimeout(priority.formStart('AINVOICES', onMsg, () => {}, undefined, 0), 'formStart');
    formRef = form;
    trace('formStart OK');
    try {
      stage = 'setSearchFilter';
      await withTimeout(form.setSearchFilter({
        or: 0, ignorecase: 1,
        QueryValues: [{ field: 'IVNUM', fromval: ivnum, toval: '', op: '=', sort: 0, isdesc: 0 }],
      }), stage);
      stage = 'getRows';
      const rows = await withTimeout(form.getRows(1), stage);
      const first = rows?.AINVOICES?.['1'];
      if (!first) throw new Error(`חשבונית ${ivnum} לא נמצאה בטופס`);
      trace('row found');
      stage = 'setActiveRow';
      await withTimeout(form.setActiveRow(1), stage);

      // הרצת הפרוצדורה + אישור אוטומטי של הודעות ("האם לסגור?" וכו')
      stage = `activateStart ${CLOSE_PROC}`;
      const procMessages = [];
      let step = await withTimeout(form.activateStart(CLOSE_PROC, 'P', () => {}), stage);
      trace('activateStart returned: type=' + (step && step.type));
      let guard = 0;
      while (step && step.type && step.type !== 'end') {
        if (++guard > 20) throw new Error('הפרוצדורה לא הסתיימה אחרי 20 שלבים');
        stage = `proc step ${step.type}`;
        if (step.type === 'message') {
          procMessages.push(step.message);
          trace(`proc ${step.messagetype}: ${step.message}`);
          if (step.messagetype === 'error') {
            try { await withTimeout(step.proc.message(1), 'proc error confirm'); } catch {}
            throw new Error(step.message);
          }
          step = await withTimeout(step.proc.message(1), 'proc confirm'); // אישור
          trace('after confirm: type=' + (step && step.type));
        } else if (step.type === 'displayUrl') {
          step = await step.proc.continueProc?.() ?? { type: 'end' };
        } else {
          throw new Error(`הפרוצדורה מבקשת קלט שהממשק לא תומך בו (${step.type}). יש לסגור במסך פריוריטי.`);
        }
      }
      stage = 'activateEnd';
      try { await withTimeout(form.activateEnd(), stage); } catch (e) { trace('activateEnd: ' + errText(e)); }

      // אם במהלך הריצה הגיעה הודעת שגיאה מהטופס — הסגירה נכשלה
      if (formError) { const e = new Error(formError); e.noStage = true; throw e; }

      trace('done. procMessages=' + JSON.stringify(procMessages) + ' formMessages=' + JSON.stringify(formMessages));
      return { messages: procMessages, formMessages };
    } finally {
      try { form.endCurrentForm(); } catch {}
    }
  } catch (err) {
    // הסשן של ה-SDK עלול להינעל/להינתק (למשל התחברות מקבילה למסך Priority עם אותו משתמש) —
    // מאפסים את ההתחברות כדי שהניסיון הבא יתחבר מחדש נקי
    loginPromise = null;
    const msg = errText(err);
    if (log) log({ sdkClose: ivnum, failedAt: stage, error: msg });
    throw new Error(err.noStage ? msg : `[${stage}] ${msg}`);
  }
}

/**
 * מפיק את מסמך החשבונית (PDF) דרך ההפעלה "הדפסת חשבונית מס" (WWWSHOWAIV)
 * ומחזיר קישור מלא למסמך בשרת Priority.
 */
async function getInvoiceDocumentUrl(ivnum, log) {
  const trace = msg => { if (log) log({ sdkPrint: ivnum, step: msg }); };
  let stage = 'login';
  try {
    await ensureLogin();
    // אישור אוטומטי של הודעות (למשל "החשבונית נסגרה בהצלחה") — אחרת ה-session נתקע
    let formRef = null;
    const onMsg = resp => {
      trace(`form message (${resp?.type}): ${errText(resp)}`);
      const f = resp?.form || formRef;
      try {
        if (resp?.type === 'warning') f?.warningConfirm(1);
        else f?.infoMsgConfirm();
      } catch (e) { trace('confirm failed: ' + errText(e)); }
    };

    stage = 'formStart';
    const form = await withTimeout(priority.formStart('AINVOICES', onMsg, () => {}, undefined, 0), stage);
    formRef = form;
    try {
      stage = 'setSearchFilter';
      await withTimeout(form.setSearchFilter({
        or: 0, ignorecase: 1,
        QueryValues: [{ field: 'IVNUM', fromval: ivnum, toval: '', op: '=', sort: 0, isdesc: 0 }],
      }), stage);
      stage = 'getRows';
      const rows = await withTimeout(form.getRows(1), stage);
      if (!rows?.AINVOICES?.['1']) throw new Error(`חשבונית ${ivnum} לא נמצאה`);
      stage = 'setActiveRow';
      await withTimeout(form.setActiveRow(1), stage);

      stage = 'activateStart ' + PRINT_PROC;
      let step = await withTimeout(form.activateStart(PRINT_PROC, 'P', () => {}));
      let url = null, datauri = null, guard = 0;
      while (step && step.type && step.type !== 'end') {
        if (++guard > 20) break;
        stage = `proc step ${step.type}`;
        trace(stage);
        if (step.type === 'documentOptions') {
          const f = (step.formats || []).find(x => x.selected) || (step.formats || [])[0];
          step = await withTimeout(step.proc.documentOptions(1, f ? f.format : 1, 1 /* PDF */), stage);
        } else if (step.type === 'reportOptions') {
          const f = (step.formats || []).find(x => x.selected) || (step.formats || [])[0];
          step = await withTimeout(step.proc.reportOptions(1, f ? f.format : 1), stage);
        } else if (step.type === 'message') {
          trace(`proc ${step.messagetype}: ${step.message}`);
          if (step.messagetype === 'error') throw new Error(step.message);
          step = await withTimeout(step.proc.message(1), stage);
        } else if (step.type === 'displayUrl') {
          const u = step.Urls;
          const first = Array.isArray(u) ? u[0] : u;
          url = first?.url || step.url || null;
          if (typeof url === 'object' && url) url = url.url || null;
          datauri = first?.datauri || null; // ה-PDF עצמו, מוטמע — אמין יותר מהורדה בקישור
          trace(`got url: ${url} (datauri: ${datauri ? datauri.length + ' chars' : 'none'})`);
          break;
        } else if (step.type === 'client') {
          trace('client step data: ' + JSON.stringify(step.data).slice(0, 500));
          const m = JSON.stringify(step.data || '').match(/https?:\\?\/\\?\/[^"']+|\.\.[^"']*\.(pdf|htm[l]?)/i);
          if (m) { url = m[0].replace(/\\\//g, '/'); trace('url from client step: ' + url); }
          step = await withTimeout(step.proc.continueProc(), stage);
        } else {
          throw new Error(`שלב לא נתמך בהפקת המסמך (${step.type})`);
        }
      }
      // כבר יש לנו את המסמך (datauri) — לא נותנים ל-activateEnd לתקוע את הבקשה
      try { await withTimeout(form.activateEnd(), 'activateEnd', 8000); } catch (e) { trace('activateEnd: ' + errText(e)); }
      if (!url && !datauri) throw new Error('הפרוצדורה הסתיימה בלי להחזיר מסמך');

      let full = null;
      if (url) {
        stage = 'getFileUrl';
        full = /^https?:/i.test(url) ? url : await withTimeout(form.getFileUrl(url), stage);
        trace('full url: ' + full);
      }
      return { url: full, datauri };
    } finally {
      try { form.endCurrentForm(); } catch {}
    }
  } catch (err) {
    loginPromise = null;
    const msg = errText(err);
    if (log) log({ sdkPrint: ivnum, failedAt: stage, error: msg });
    throw new Error(err.noStage ? msg : `[${stage}] ${msg}`);
  }
}

const PRINT_PROC = process.env.PRIORITY_PRINT_PROC || 'WWWSHOWAIV';

module.exports = { closeInvoice, getInvoiceDocumentUrl };
