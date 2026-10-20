// שרת מקומי להפקת חשבוניות מס בפריוריטי.
// Node 18+; install dependencies with npm ci, then run npm start.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { buildInvoicePayload, INVOICE_TYPES, CURRENCIES } = require('./invoice-payload');
const { exchangeQuery, exchangeResult, priorityExchangeResult } = require('./exchange-rates');
const { goldCutoff, goldResult } = require('./gold-rates');
let sdk; // נטען אחרי קריאת .env (ראו למטה)

// ---------- טעינת .env ----------
(function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
})();

const BASE_URL = process.env.PRIORITY_BASE_URL;
const COMPANY = process.env.PRIORITY_COMPANY;
const USER = process.env.PRIORITY_USER;
const PASSWORD = process.env.PRIORITY_PASSWORD;
const PORT = Number(process.env.PORT || 18473);
const TIMEOUT_MS = 30000;

if (!BASE_URL || !COMPANY || !USER || !PASSWORD || PASSWORD.startsWith('*')) {
  console.error('Missing config in .env — fill PRIORITY_BASE_URL, PRIORITY_COMPANY, PRIORITY_USER, PRIORITY_PASSWORD');
  process.exit(1);
}

sdk = require('./priority-sdk');

const API_BASE = `${BASE_URL.replace(/\/$/, '')}/${COMPANY}`;
const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASSWORD}`).toString('base64');
const LOG_FILE = path.join(__dirname, 'requests.log');

function log(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  fs.appendFile(LOG_FILE, line + '\n', () => {});
  console.log(line);
}

// ---------- קריאה ל-Priority ----------
async function priority(method, pathAndQuery, body) {
  const url = `${API_BASE}/${pathAndQuery}`;
  const started = Date.now();
  let res, text;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    text = await res.text();
  } catch (err) {
    log({ method, url, error: String(err), ms: Date.now() - started });
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      const e = new Error('אין תשובה משרת Priority (timeout). ייתכן שה-IP של המחשב לא מאושר בחומת האש של השרת.');
      e.status = 504;
      throw e;
    }
    const e = new Error('שגיאת רשת מול שרת Priority: ' + err.message);
    e.status = 502;
    throw e;
  }
  log({ method, url, status: res.status, body: body || undefined, response: text.slice(0, 2000), ms: Date.now() - started });

  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* לא JSON */ }

  if (!res.ok) {
    // להציג את הודעת השגיאה של Priority כפי שהיא
    let msg = data?.error?.message?.value || data?.error?.message || text || `Priority החזיר ${res.status}`;
    if (typeof msg === 'object') msg = JSON.stringify(msg);
    if (res.status === 401) msg = 'שם משתמש או סיסמה שגויים מול Priority (401)';
    if (res.status === 403) msg = 'למשתמש ה-API אין הרשאה לטופס (403): ' + msg;
    const e = new Error(msg);
    e.status = res.status === 400 ? 400 : 502;
    throw e;
  }
  return data;
}

// escape לערך בתוך מחרוזת OData
const odataStr = s => String(s).replace(/'/g, "''");

// ---------- Handlers ----------
const exchangeRateCache = new Map();
const goldPriceCache = new Map();
const handlers = {
  'GET /api/gold-prices': async q => {
    const date = q.get('date');
    const cutoff = goldCutoff(date);
    const cached = goldPriceCache.get(date);
    if (cached && cached.expires > Date.now()) return cached.promise;
    const promise = (async () => {
      const result = goldResult(await sdk.getGoldPrices(cutoff), date, cutoff);
      log({ method: 'GET', source: 'priority-gold', date, updatedAt: result.updatedAt });
      return result;
    })();
    goldPriceCache.set(date, { promise, expires: Date.now() + 10 * 60 * 1000 });
    promise.catch(() => { if (goldPriceCache.get(date)?.promise === promise) goldPriceCache.delete(date); });
    return promise;
  },
  'GET /api/exchange-rates': async q => {
    const date = q.get('date');
    const source = q.get('source') || 'boi';
    if (!['boi', 'priority'].includes(source)) throw badRequest('מקור שער לא תקין');
    const query = exchangeQuery(date);
    const cacheKey = `${source}:${date}`;
    const cached = exchangeRateCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return cached.promise;
    const promise = (async () => {
    try {
      if (source === 'priority') {
        const result = priorityExchangeResult(await sdk.getCurrencyRates(date), date);
        log({ method: 'GET', source: 'priority', date, rates: result.rates });
        return result;
      }
      const response = await fetch(query, { headers: { Accept: 'text/csv' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) throw new Error(`בנק ישראל החזיר שגיאה (${response.status})`);
      const result = exchangeResult(await response.text(), date);
      log({ method: 'GET', source: 'bank-of-israel', date, rate: result.rates.USD.rate, rateDate: result.rates.USD.rateDate });
      return result;
    } catch (err) {
      const sourceName = source === 'priority' ? 'פריוריטי' : 'בנק ישראל';
      if (err.name === 'TimeoutError' || err.name === 'AbortError') err.message = 'תם הזמן לטעינת שער הדולר מ' + sourceName;
      else if (err.message === 'fetch failed') err.message = 'לא ניתן להתחבר ל' + sourceName + ' לטעינת שער הדולר';
      err.status = 502;
      throw err;
    }
    })();
    exchangeRateCache.set(cacheKey, { promise, expires: Date.now() + 10 * 60 * 1000 });
    promise.catch(() => { if (exchangeRateCache.get(cacheKey)?.promise === promise) exchangeRateCache.delete(cacheKey); });
    return promise;
  },
  // Suggestions contain codes/descriptions only, never customer or invoice data.
  'GET /api/invoices/options': async () => {
    if (invoiceOptionsCache && Date.now() - invoiceOptionsCache.ts < 10 * 60 * 1000) return invoiceOptionsCache.data;
    const data = await priority('GET', 'AINVOICES?$select=WARHSNAME,WARHSDES,LOCNAME,AGENTCODE,AGENTNAME&$orderby=IV desc&$top=100');
    const rows = data.value || [];
    const unique = (code, label) => [...new Map(rows.filter(r => r[code]).map(r => [r[code], { code: r[code], label: r[label] || r[code] }])).values()];
    const options = { invoiceTypes: INVOICE_TYPES, currencies: CURRENCIES, warehouses: unique('WARHSNAME', 'WARHSDES'), agents: unique('AGENTCODE', 'AGENTNAME') };
    invoiceOptionsCache = { ts: Date.now(), data: options };
    return options;
  },
  // בדיקת חיבור
  'GET /api/health': async () => {
    await priority('GET', `AINVOICES?$top=1&$select=IVNUM`);
    return { ok: true, company: COMPANY };
  },

  // כל הלקוחות — לדרופ-דאון. נטען מ-Priority פעם ב-10 דקות לכל היותר (קאש בזיכרון)
  'GET /api/customers/all': async () => {
    const now = Date.now();
    if (custCache.data && now - custCache.ts < 10 * 60 * 1000) return custCache.data;
    const data = await priority('GET', `CUSTOMERS?$select=CUSTNAME,CUSTDES&$top=5000`);
    custCache = { data, ts: now };
    return data;
  },

  // חיפוש פריטים (מק"ט) להשלמה אוטומטית בשורות החשבונית — לפי תחילת מק"ט או חלק מהתיאור
  'GET /api/parts': async (q) => {
    const term = (q.get('q') || '').trim();
    if (term.length < 1) return { value: [] };
    const invoiceType = q.get('invoiceType');
    if (!INVOICE_TYPES.some(x => x.code === invoiceType)) throw badRequest('יש לבחור סוג חשבונית לחיפוש מק״ט');
    const t = odataStr(term);
    const sel = 'PARTNAME,BARCODE,PARTDES,PUNITNAME,UNITNAME,BASEPLPRICE,BASEPLCODE,EDEA_PARTTYPE,EDEA_FEIN,FAMILYDES';
    const get = f => priority('GET', `LOGPART?$select=${sel}&$top=15&$filter=${encodeURIComponent(`(${f}) and STATDES eq 'פעיל' and EDEA_PARTTYPE eq '${invoiceType}'`)}`);
    if (q.get('exact') === '1') {
      return get(`PARTNAME eq '${t}' or BARCODE eq '${t}'`);
    }
    // שתי שאילתות במקביל: התאמה לפי מק"ט (קודם) ואז לפי תיאור — כך "14" מחזיר קודם את המק"ט 14 עצמו
    const [byCode, byDesc] = await Promise.all([get(`PARTNAME eq '${t}*' or BARCODE eq '${t}'`), get(`PARTDES eq '*${t}*'`)]);
    const seen = new Set();
    const value = [];
    for (const p of [...(byCode.value || []), ...(byDesc.value || [])]) {
      if (seen.has(p.PARTNAME)) continue;
      seen.add(p.PARTNAME);
      value.push(p);
      if (value.length >= 20) break;
    }
    // מק"ט מדויק תמיד ראשון
    value.sort((a, b) => (b.PARTNAME === term) - (a.PARTNAME === term));
    return { value };
  },

  // פרטי לקוח הנדרשים ל"חשבוניות ישראל" (מספר הקצאה): מס' חברה, הסבר המס', תיק מע"מ, סוג לקוח וכו'
  'GET /api/customers/details': async (q) => {
    const custname = (q.get('custname') || '').trim();
    if (!custname) throw badRequest('חסר מספר לקוח');
    const sel = ['CUSTNAME', 'CUSTDES', ...CUST_EDITABLE, 'CTYPENAME', 'CTYPE2NAME', 'PCUSTDES', 'EDEA_CONSIGWARHSDES'].join(',');
    return priority('GET', `CUSTOMERS(CUSTNAME='${odataStr(custname)}')?$select=${sel}`);
  },

  // עדכון שדות הלקוח (רק הרשימה המותרת) — PATCH ל-CUSTOMERS
  'POST /api/customers/update': async (_q, body) => {
    const custname = (body?.custname || '').trim();
    if (!custname) throw badRequest('חסר מספר לקוח');
    const payload = {};
    for (const f of CUST_EDITABLE) {
      if (body?.fields && Object.prototype.hasOwnProperty.call(body.fields, f)) {
        payload[f] = String(body.fields[f] ?? '').trim();
      }
    }
    if (!Object.keys(payload).length) throw badRequest('לא נשלחו שדות לעדכון');
    if (payload.WTAXNUM && !/^\d{5,9}$/.test(payload.WTAXNUM)) throw badRequest('מס\' חברה / ת.ז חייב להיות 5–9 ספרות');
    if (payload.VATNUM && !/^\d{5,9}$/.test(payload.VATNUM)) throw badRequest('תיק מע"מ חייב להיות 5–9 ספרות');
    await priority('PATCH', `CUSTOMERS(CUSTNAME='${odataStr(custname)}')`, payload);
    const sel = ['CUSTNAME', 'CUSTDES', ...CUST_EDITABLE, 'CTYPENAME', 'CTYPE2NAME', 'PCUSTDES', 'EDEA_CONSIGWARHSDES'].join(',');
    return priority('GET', `CUSTOMERS(CUSTNAME='${odataStr(custname)}')?$select=${sel}`);
  },

  // חיפוש לקוחות לפי שם או מספר.
  // Priority לא תומך ב-contains/startswith — התחביר שלו הוא eq עם כוכבית (*) כתו-כל.
  'GET /api/customers': async (q) => {
    const term = (q.get('q') || '').trim();
    if (term.length < 2) return { value: [] };
    const t = odataStr(term);
    const filter = /^\d+$/.test(term)
      ? `CUSTNAME eq '${t}*'`
      : `CUSTDES eq '*${t}*'`;
    try {
      return await priority('GET', `CUSTOMERS?$select=CUSTNAME,CUSTDES&$filter=${encodeURIComponent(filter)}&$top=15`);
    } catch (err) {
      // למשתמש ה-API אין הרשאה למסך CUSTOMERS — מאפשרים הזנת מספר לקוח ידנית
      if (/להפעיל API למסך/.test(err.message)) return { value: [], unavailable: true };
      throw err;
    }
  },

  // בדיקת כפילות לפי DETAILS
  'GET /api/invoices/check': async (q) => {
    const details = (q.get('details') || '').trim();
    if (!details) return { value: [] };
    const filter = `DETAILS eq '${odataStr(details)}' and OWNERLOGIN eq '${odataStr(USER)}'`;
    return priority('GET', `AINVOICES?$select=IVNUM,IVDATE,STATDES,TOTPRICE,DETAILS&$filter=${encodeURIComponent(filter)}&$top=5`);
  },

  // חשבוניות אחרונות שנוצרו דרך ה-API
  'GET /api/invoices/recent': async () => {
    const filter = `OWNERLOGIN eq '${odataStr(USER)}'`;
    return priority('GET', `AINVOICES?$select=IVNUM,IVDATE,CUSTNAME,CDES,STATDES,QPRICE,VAT,TOTPRICE,DETAILS&$filter=${encodeURIComponent(filter)}&$orderby=IV desc&$top=10`);
  },

  // סגירת חשבונית: טיוטה (T...) -> סופית (IN...).
  // OData לא מריץ את פעולת הסגירה, ולכן היא רצה דרך Priority Web SDK (ראו priority-sdk.js).
  'POST /api/invoices/close': async (_q, body) => {
    const ivnum = (body?.ivnum || '').trim();
    if (!ivnum) throw badRequest('חסר מספר חשבונית');

    // מזהה פנימי (IV) לפני הסגירה — כדי לאתר את המספר הסופי החדש אחריה
    const key = `AINVOICES(IVNUM='${odataStr(ivnum)}',IVTYPE='A',DEBIT='D')`;
    const before = await priority('GET', `${key}?$select=IV,STATDES`);
    if (before.STATDES !== 'טיוטא') throw badRequest(`חשבונית ${ivnum} אינה טיוטה (סטטוס: ${before.STATDES})`);

    // מריצים את הסגירה; גם אם ה-SDK נכשל (למשל בשלב שליחת מייל אחרי הסגירה),
    // המצב בפועל נקבע לפי מה שקרה לחשבונית עצמה
    let result = null, sdkError = null;
    try {
      result = await sdk.closeInvoice(ivnum, log);
    } catch (err) {
      sdkError = err.message || String(err);
    }

    // איתור החשבונית אחרי הסגירה לפי המזהה הפנימי
    const after = await priority('GET', `AINVOICES?$select=IVNUM,STATDES,TOTPRICE&$filter=${encodeURIComponent(`IV eq ${before.IV}`)}`);
    const inv = after?.value?.[0];
    if (inv && !(inv.IVNUM === ivnum && inv.STATDES === 'טיוטא')) {
      // נסגרה בפועל — הצלחה, גם אם היה כשל בשלב משני של הפרוצדורה (מייל/הדפסה)
      return { ivnum: inv.IVNUM, status: inv.STATDES };
    }
    if (!inv) return { ivnum, status: 'נסגרה (רעננו את הרשימה)' };

    // עדיין טיוטה — כישלון אמיתי; מציגים את ההודעה של פריוריטי כפי שהיא
    const why = [
      ...(result?.messages || []),
      ...(result?.formMessages || []),
      ...(sdkError ? [sdkError] : []),
    ].join('\n');
    throw badRequest('סגירת החשבונית נכשלה: ' + (why || 'החשבונית עדיין טיוטה — יש לבדוק בפריוריטי'));
  },

  // הורדת מסמך החשבונית (PDF): מפיקים דרך ה-SDK ומזרימים ללקוח
  'GET /api/invoices/document': async (q) => {
    const ivnum = (q.get('ivnum') || '').trim();
    if (!ivnum) throw badRequest('חסר מספר חשבונית');

    // הגנה: מפיקים מסמך רק לחשבוניות של משתמש ה-API, כדי לא "לשרוף" בטעות
    // את המקור של חשבונית שמשתמש אחר אמור להדפיס בנייר
    const own = await priority('GET', `AINVOICES(IVNUM='${odataStr(ivnum)}',IVTYPE='A',DEBIT='D')?$select=OWNERLOGIN`);
    if (own.OWNERLOGIN !== USER) {
      throw badRequest(`החשבונית ${ivnum} לא נוצרה על ידי משתמש ה-API (אלא על ידי ${own.OWNERLOGIN || 'משתמש אחר'}). ההפקה נחסמה כדי שהמקור שלה יישאר בהדפסה אצל המשתמש שלה.`);
    }

    const doc = await sdk.getInvoiceDocumentUrl(ivnum, log);

    // עדיפות ל-PDF המוטמע בתשובת Priority — בלי תלות בהורדה חיצונית שעלולה להיתקע
    if (doc.datauri) {
      const m = doc.datauri.match(/^data:([^;]+);base64,(.*)$/s);
      if (m) {
        const contentType = m[1];
        const buffer = Buffer.from(m[2], 'base64');
        const ext = /pdf/i.test(contentType) ? 'pdf' : /html/i.test(contentType) ? 'html' : 'bin';
        log({ document: ivnum, source: 'datauri', bytes: buffer.length });
        return { __file: { buffer, contentType, filename: `${ivnum}.${ext}` } };
      }
    }

    if (!doc.url) throw badRequest('לא התקבל מסמך מ-Priority');
    let res = await fetch(doc.url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      res = await fetch(doc.url, { headers: { Authorization: AUTH }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    }
    if (!res.ok) return { url: doc.url, note: 'לא ניתן היה להוריד את הקובץ ישירות — פתחו את הקישור בדפדפן' };
    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'application/octet-stream';
    const ext = /pdf/i.test(contentType) ? 'pdf' : /html/i.test(contentType) ? 'html' : 'bin';
    log({ document: ivnum, source: 'url', bytes: buffer.length });
    return { __file: { buffer, contentType, filename: `${ivnum}.${ext}` } };
  },

  // יצירת חשבונית
  'POST /api/invoices': async (_q, body) => {
    const payload = buildInvoicePayload(body, USER);

    const inv = await priority('POST', 'AINVOICES?$expand=AINVOICEITEMS_SUBFORM', payload);
    return {
      ivnum: inv.IVNUM,
      status: inv.STATDES,
      beforeVat: inv.QPRICE,
      vat: inv.VAT,
      total: inv.TOTPRICE,
    };
  },
};

function badRequest(msg) { const e = new Error(msg); e.status = 400; return e; }

// שדות לקוח שהממשק רשאי לעדכן (מסך "לקוחות" > "נתוני חברה")
const CUST_EDITABLE = ['WTAXNUM', 'WTAXNUMEXPL', 'VATNUM', 'BUSINESSTYPE', 'CTYPECODE', 'CTYPE2CODE', 'PCUSTNAME', 'EDEA_CONSIGWARHSNAME'];

let custCache = { data: null, ts: 0 };
let invoiceOptionsCache = null;

// ---------- HTTP server ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const key = `${req.method} ${url.pathname}`;

  if (handlers[key]) {
    let body = null;
    if (req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
      catch { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'JSON לא תקין' })); }
    }
    try {
      const data = await handlers[key](url.searchParams, body);
      if (data && data.__file) {
        const f = data.__file;
        res.writeHead(200, {
          'Content-Type': f.contentType,
          'Content-Disposition': `attachment; filename="${encodeURIComponent(f.filename)}"`,
          'Content-Length': f.buffer.length,
        });
        return res.end(f.buffer);
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(err.status || 500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // קבצים סטטיים
  const file = url.pathname === '/' ? '/index.html' : url.pathname;
  const fp = path.join(__dirname, 'public', path.normalize(file).replace(/^([.\\/])+/, ''));
  if (fp.startsWith(path.join(__dirname, 'public')) && fs.existsSync(fp) && fs.statSync(fp).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    return fs.createReadStream(fp).pipe(res);
  }
  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Invoice UI running: http://localhost:${PORT}`);
  console.log(`Company: ${COMPANY} | User: ${USER}`);
});
