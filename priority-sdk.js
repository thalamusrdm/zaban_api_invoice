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
          step = await withTimeout(step.proc.documentOptions(1, f ? f.format : 1, { pdf: 1, word: 0, mode: 'display' }), stage);
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
          step = await withTimeout(step.proc.clientContinue(), stage);
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

// Read-only access works through Web SDK even when the OData form is not enabled.
async function getCurrencyRates(date) {
  await withTimeout(ensureLogin(), 'login for currency rates');
  const result = [];
  for (const code of ['USD', '$']) {
    let form, history;
    let messageError;
    const onMessage = msg => { messageError = new Error(errText(msg)); };
    try {
      form = await withTimeout(priority.formStart('CURRENCIES', onMessage, () => {}, undefined, 0), 'currency form');
      await withTimeout(form.setSearchFilter({ or: 0, ignorecase: 1, QueryValues: [{ field: 'CODE', fromval: code, toval: '', op: '=', sort: 0, isdesc: 0 }] }), 'currency filter');
      const rows = await withTimeout(form.getRows(1), 'currency rows');
      const row = rows?.CURRENCIES?.['1'];
      if (!row || row.CODE !== code) continue;
      await withTimeout(form.setActiveRow(1), 'currency active row');
      history = await withTimeout(form.startSubForm('CURRHIS', onMessage, () => {}), 'currency history');
      await withTimeout(history.setSearchFilter({ or: 0, ignorecase: 1, QueryValues: [{ field: 'CURDATE', fromval: date, toval: '', op: '<=', sort: 1, isdesc: 1 }] }), 'currency history filter');
      const historical = await withTimeout(history.getRows(1), 'currency history rows');
      if (messageError) throw messageError;
      result.push({ CODE: row.CODE, EXCH: row.EXCH, EXCHDATE: row.EXCHDATE, EXCHQUANT: row.EXCHQUANT,
        CURRHIS_SUBFORM: Object.values(historical?.CURRHIS || {}).map(x => ({ EXCH: x.EXCH, CURDATE: x.CURDATE, SDATE: x.SDATE })) });
    } finally {
      if (history) try { await withTimeout(history.endCurrentForm(), 'close currency history', 5000); } catch {}
      if (form) try { await withTimeout(form.endCurrentForm(), 'close currency form', 5000); } catch {}
    }
  }
  return result;
}

async function getGoldPrices(cutoff) {
  await withTimeout(ensureLogin(), 'login for gold prices');
  let form, messageError;
  try {
    form = await withTimeout(priority.formStart('FZAB_GOLDPRICE', msg => { messageError = new Error(errText(msg)); }, () => {}, undefined, 0), 'gold price form');
    await withTimeout(form.setSearchFilter({ or: 0, ignorecase: 1, QueryValues: [{ field: 'UDATE', fromval: cutoff, toval: '', op: '<=', sort: 1, isdesc: 1 }] }), 'gold price filter');
    const rows = await withTimeout(form.getRows(1), 'gold price rows');
    if (messageError) throw messageError;
    return Object.values(rows?.FZAB_GOLDPRICE || {}).map(({ UDATE, USDPRICE, USDPRICE2, USDPRICE3 }) => ({ UDATE, USDPRICE, USDPRICE2, USDPRICE3 }));
  } finally {
    if (form) try { await withTimeout(form.endCurrentForm(), 'close gold price form', 5000); } catch {}
  }
}


// Standalone custom procedure; never changes regular AINVOICES activations.
async function getOriginalInvoiceDocument(ivnum) {
  await ensureLogin();
  let proc;
  try {
    let step = await withTimeout(priority.procStart('ZBAN_ORIGINALPDF', 'P', () => {}, undefined), 'original procedure');
    proc = step?.proc;
    if (step?.type !== 'inputFields' || step.input?.EditFields?.length !== 1) throw new Error('מבנה הקלט של פרוצדורת המקור אינו תואם');
    const field = step.input.EditFields[0];
    step = await withTimeout(proc.inputFields(1, { EditFields: [{ field: field.field, op: 0, value: ivnum, op2: 0, value2: '' }] }), 'original generation');
    for (let i = 0; i < 12 && step; i++) {
      if (step.type === 'displayUrl') {
        const first = Array.isArray(step.Urls) ? step.Urls[0] : step.Urls;
        let url = (typeof first === 'string' ? first : first?.url) || step.url;
        if (url && typeof url === 'object') url = url.url;
        if (first?.datauri) return { datauri: first.datauri };
        if (typeof url !== 'string' || !url.trim()) throw new Error('המקור לא החזיר כתובת קובץ');
        // Persist the native path before translation/download, so failures never lose it.
        return { url };
      }
      // Warnings are not auto-approved on the original path.
      if (step.type === 'message') throw new Error(step.message || 'פריוריטי עצרה את הפקת המקור');
      if (step.type === 'end') break;
      throw new Error('שלב לא צפוי בפרוצדורת המקור: ' + step.type);
    }
    throw new Error('פרוצדורת המקור הסתיימה בלי קובץ');
  } catch (err) { loginPromise = null; throw err; }
  finally { if (proc) try { await withTimeout(proc.cancel(), 'release original procedure', 5000); } catch {} }
}


async function getOriginalCustomerReadiness(custname) {
  await ensureLogin();
  let form;
  try {
    form = await withTimeout(priority.formStart('CUSTOMERS', () => {}, () => {}, undefined, 0), 'original customer check');
    if (!form.columns?.EDOCUMENTS) throw new Error('לא ניתן לבדוק בפריוריטי הגדרת מסמך ממוחשב');
    await withTimeout(form.setSearchFilter({ or: 0, ignorecase: 1, QueryValues: [{ field: 'CUSTNAME', fromval: custname, op: '=', sort: 0, isdesc: 0 }] }), 'original customer filter');
    const row = (await withTimeout(form.getRows(1), 'original customer settings'))?.CUSTOMERS?.['1'];
    if (!row || row.CUSTNAME !== custname) throw new Error('הלקוח לא נמצא בבדיקת מסמך ממוחשב');
    const ready = ['Y', '1', 1, true].includes(row.EDOCUMENTS);
    return { ready, custname, reason: ready ? '' : 'הלקוח ' + custname + ' אינו מוגדר בפריוריטי כ״מקבל מסמך ממוחשב״. לא נוצרה חשבונית במסלול זה. אפשר לבחור הורדת העתק או להסדיר את הגדרת הלקוח.' };
  } finally { if (form) try { await withTimeout(form.endCurrentForm(), 'close original customer check', 5000); } catch {} }
}


async function resolveOriginalDocumentUrl(filename) {
  let url = filename;
  if (typeof url !== 'string' || !url.trim()) throw new Error('חסרה כתובת המקור שנשמר');
  if (!/^https?:/i.test(url)) {
    await ensureLogin();
    let form;
    try {
      form = await withTimeout(priority.formStart('AINVOICES', () => {}, () => {}, undefined, 0), 'resolve saved original path');
      url = await withTimeout(form.getFileUrl(url), 'original file URL');
    } finally { if (form) try { await form.endCurrentForm(); } catch {} }
  }
  if (new URL(url).origin !== new URL(process.env.PRIORITY_BASE_URL).origin) throw new Error('התקבל קישור מחוץ לשרת פריוריטי');
  return url;
}


async function digitalCustomerForm(custname, change) {
  await ensureLogin();
  let form, error;
  const onMessage = m => { if (m.type === 'information') form?.infoMsgConfirm(); else { error = new Error(errText(m)); if (m.type === 'warning') form?.warningConfirm(0); } };
  try {
    form = await withTimeout(priority.formStart('CUSTOMERS', onMessage, () => {}, undefined, 0), 'digital customer');
    for (const field of ['EMAIL','EDOCUMENTS']) if (!form.columns?.[field]) throw Error('לא נמצא שדה ' + field + ' בכרטיס הלקוח');
    await withTimeout(form.setSearchFilter({or:0,ignorecase:1,QueryValues:[{field:'CUSTNAME',fromval:custname,op:'=',sort:0,isdesc:0}]}), 'digital customer filter');
    const row = (await withTimeout(form.getRows(1), 'digital customer data'))?.CUSTOMERS?.['1'];
    if (!row || row.CUSTNAME !== custname) throw Error('הלקוח לא נמצא בפריוריטי');
    if (change) {
      await form.setActiveRow(1);
      if (row.EMAIL !== change.email) await form.fieldUpdate('EMAIL', change.email);
      if (!['Y','1',1,true].includes(row.EDOCUMENTS)) await form.fieldUpdate('EDOCUMENTS','Y');
      if (error) throw error;
      await withTimeout(form.saveRow(0), 'save digital customer');
      if (error) throw error;
    }
    const requiredMissing=Object.entries(form.columns).filter(([key,col])=>col.mandatory===1 && col.readonly===0 && col.type!=='bool' && (row[key]===undefined || row[key]===null || row[key]==='')).map(([key,col])=>({field:key,title:col.title}));
    const blocked=['לא פעיל','מבוטל'].includes(row.STATDES);
    return {requiredMissing,blocked,custname:row.CUSTNAME,name:row.CUSTDES,email:row.EMAIL||'',digital:['Y','1',1,true].includes(row.EDOCUMENTS),companyNumber:row.WTAXNUM||'',vatNumber:row.VATNUM||'',numberExplanation:row.WTAXNUMEXPL||''};
  } finally { if (form) try { await form.endCurrentForm(); } catch {} }
}
async function prepareDigitalCustomer(custname,email) {
  const before=await digitalCustomerForm(custname);
  if(before.blocked || before.requiredMissing?.length)throw Error('יש להשלים שדות חובה בכרטיס הלקוח בפריוריטי: '+(before.requiredMissing||[]).map(x=>x.title).join(', '));
  await digitalCustomerForm(custname,{email});
  const saved = await digitalCustomerForm(custname);
  if (!saved.digital || saved.email !== email || !saved.name) throw Error('לא ניתן לאמת את המייל והגדרת המסמך הממוחשב בפריוריטי');
  return saved;
}
async function openDigitalInvoice(ivnum) {
  await ensureLogin();
  let form, error;
  form = await withTimeout(priority.formStart('AINVOICES',m=>{if(m.type==='information')form?.infoMsgConfirm();else {error=new Error(errText(m));if(m.type==='warning')form?.warningConfirm(0);}},()=>{},undefined,0),'email invoice');
  try {
    await form.setSearchFilter({or:0,ignorecase:1,QueryValues:[{field:'IVNUM',fromval:ivnum,op:'=',sort:0,isdesc:0}]});
    const row=(await form.getRows(1))?.AINVOICES?.['1'];
    if(error)throw error;
    if(!row || row.OWNERLOGIN!==process.env.PRIORITY_USER)throw Error('החשבונית אינה בטיפול משתמש ה-API');
    await form.setActiveRow(1);return {form,row,getError:()=>error};
  } catch(e) {try{await form.endCurrentForm();}catch{}throw e;}
}
async function prepareDigitalInvoice(ivnum,custname) {
  const {form,row,getError}=await openDigitalInvoice(ivnum);
  try {
    if(row.CUSTNAME!==custname || row.FINAL==='Y')throw Error('נדרשת טיוטת החשבונית של הלקוח שנבחר');
    // An empty invoice contact makes native automail use the verified customer EMAIL.
    if(row.NAME){await form.fieldUpdate('NAME','');await form.saveRow(0);}
    if(getError())throw getError();
  }finally{await form.endCurrentForm();}
}
async function sendDigitalInvoice(ivnum,email,custname) {
  const {form,row}=await openDigitalInvoice(ivnum);
  let proc;
  try {
    if(row.CUSTNAME!==custname || row.FINAL!=='Y' || row.NAME)throw Error('לא ניתן לאמת חשבונית סופית ונמען מייל יחיד');
    if(['Y','1',1,true].includes(row.PRINTEDBOOL))throw Error('החשבונית כבר הודפסה או הופקה. אין להפעיל משלוח מקור נוסף לפני בירור.');
    const recipient=await digitalCustomerForm(custname);
    if(!recipient.digital || recipient.email!==email)throw Error('פרטי המייל בפריוריטי השתנו מאז ההכנה. המשלוח נעצר.');
    let step=await withTimeout(form.activateStart('WWWSHOWAIV','P',()=>{}),'start digital email');
    proc=step?.proc;let requested=false;
    for(let i=0;i<25 && step?.type;i++){
      if(step.type==='end'){
        if(!requested)throw Error('לא הופעלה בקשת משלוח');
        return {acceptedByPriority:true,email,ivnum};
      }
      if(step.type==='client')step=await withTimeout(step.proc.clientContinue(),'email client');
      else if(step.type==='documentOptions'){
        if(requested || step.hasAutoMail===0)throw Error('משלוח מייל אינו זמין או הופעל פעמיים');
        const format=(step.formats||[]).find(f=>f.selected)||(step.formats||[])[0];
        if(!format)throw Error('חסרה תצורת חשבונית בפריוריטי');
        requested=true;
        step=await withTimeout(step.proc.documentOptions(1,format.format,{pdf:1,word:0,mode:'automail'}),'email original',90000);
      }else if(step.type==='displayUrl')step=await withTimeout(step.proc.continueProc(),'complete email');
      else if(step.type==='message'){
        if(!['information','info'].includes(step.messagetype))throw Error(step.message||'פריוריטי עצרה את משלוח המקור');
        step=await withTimeout(step.proc.message(1),'email information');
      }else throw Error('שלב לא נתמך במשלוח: '+step.type);
    }
    throw Error('פריוריטי לא אישרה את סיום בקשת המשלוח');
  }finally{try{await form.activateEnd();}catch{}if(proc)try{await proc.cancel();}catch{}await form.endCurrentForm();}
}

module.exports = { digitalCustomerForm, prepareDigitalCustomer, prepareDigitalInvoice, sendDigitalInvoice, resolveOriginalDocumentUrl, getOriginalCustomerReadiness, getOriginalInvoiceDocument, closeInvoice, getInvoiceDocumentUrl, getCurrencyRates, getGoldPrices };
