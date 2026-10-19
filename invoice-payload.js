'use strict';

const INVOICE_TYPES = [
  { code: '1', label: 'זהב' },
  { code: '2', label: 'יהלומים' },
  { code: '4', label: 'תכשיטים בשיבוץ יהלומי מעבדה' },
];
const CURRENCIES = ['ש"ח', '$', 'USD'];

function invalid(message) { throw Object.assign(new Error(message), { status: 400 }); }
function text(value, label, max = 80) {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string' || value.trim().length > max) invalid(`${label}: ערך לא תקין`);
  return value.trim() || undefined;
}
function number(value, label, min, max, fallback, scale) {
  if (value == null || value === '') {
    if (fallback !== undefined) return fallback;
    invalid(`${label}: חסר ערך`);
  }
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) invalid(`${label}: ערך לא תקין`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) invalid(`${label}: ערך לא תקין`);
  if (scale !== undefined && Math.abs(n - Number(n.toFixed(scale))) > 1e-9) invalid(`${label}: מותרות עד ${scale} ספרות אחרי הנקודה`);
  return n;
}

function buildInvoicePayload(body, user) {
  const { custname, date, details, lines } = body || {};
  const customer = text(custname, 'מספר לקוח', 16);
  if (!customer) invalid('חסר מספר לקוח');
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) invalid('תאריך לא תקין');
  if (!Array.isArray(lines) || !lines.length) invalid('חייבת להיות לפחות שורה אחת');
  const type = text(body.invoiceType ?? '1', 'סוג חשבונית');
  if (!INVOICE_TYPES.some(x => x.code === type)) invalid('סוג חשבונית לא תקין');
  const tz = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Jerusalem', timeZoneName: 'longOffset' })
    .formatToParts(new Date(`${date}T12:00:00Z`)).find(p => p.type === 'timeZoneName').value;
  return {
    CUSTNAME: customer,
    IVDATE: `${date}T00:00:00${tz.replace('GMT', '') || '+00:00'}`,
    OWNERLOGIN: user,
    IVCODENAME: '02',
    EDEA_INVTYPE: type,
    DETAILS: text(details, 'פרטים', 24),
    WARHSNAME: text(body.warehouse, 'מחסן', 4),
    LOCNAME: text(body.location, 'איתור', 14),
    AGENTCODE: text(body.agent, 'סוכן', 16),
    BOOKNUM: text(body.booknum, 'חשבונית פנקס', 48),
    PERCENT: number(body.discount, 'הנחה כללית', 0, 100, 0, 2),
    AINVOICEITEMS_SUBFORM: lines.map((line, i) => {
      if (!line || typeof line !== 'object') invalid(`שורה ${i + 1}: לא תקינה`);
      const label = `שורה ${i + 1}`;
      const part = text(line.partname, `${label}: מק"ט`, 22);
      if (!part) invalid(`${label}: חסר מק"ט`);
      const currency = text(line.currency ?? 'ש"ח', `${label}: מטבע`);
      if (!CURRENCIES.includes(currency)) invalid(`${label}: מטבע לא תקין`);
      if (line.booknum || line.EDEA_BOOKNUM) invalid(`${label}: מספר פנקס לשורה הוא שדה לקריאה בלבד בפריוריטי`);
      return {
        PARTNAME: part,
        // grams remains supported for callers of the original local API.
        TQUANT: number(line.quantity ?? line.grams, `${label}: כמות`, 0.001, 99999999999999, undefined, 3),
        PRICE: number(line.price, `${label}: מחיר`, 0.01, 99999999999.99, undefined, 2),
        ICODE: currency,
        EXCH: currency === 'ש"ח' ? 1 : number(line.exchange, `${label}: שער חליפין`, 0.000001, 9999999.999999, undefined, 6),
        PERCENT: number(line.discount, `${label}: הנחה`, 0, 100, 0, 2),
      };
    }),
  };
}

module.exports = { buildInvoicePayload, INVOICE_TYPES, CURRENCIES };
