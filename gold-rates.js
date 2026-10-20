'use strict';

// Prices are already calculated by Priority for these specific gram-based products.
// Do not derive prices from the ounce quote or infer purity for other products.
const GOLD_FIELDS = { '14': 'USDPRICE', '18': 'USDPRICE2', F: 'USDPRICE3' };

function goldCutoff(date, now = new Date()) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
    throw Object.assign(new Error('תאריך חשבונית לא תקין'), { status: 400 });
  }
  const offset = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Jerusalem', timeZoneName: 'longOffset' })
    .formatToParts(new Date(`${date}T12:00:00Z`)).find(p => p.type === 'timeZoneName').value.replace('GMT', '') || '+00:00';
  const end = new Date(`${date}T23:59:59${offset}`);
  return new Date(Math.min(end.getTime(), now.getTime())).toISOString();
}

function goldResult(rows, date, cutoff) {
  const latest = rows.filter(row => Number.isFinite(Date.parse(row.UDATE)) && Date.parse(row.UDATE) <= Date.parse(cutoff))
    .sort((a, b) => Date.parse(b.UDATE) - Date.parse(a.UDATE))[0];
  const prices = {};
  for (const [part, field] of Object.entries(GOLD_FIELDS)) {
    const raw = Number(latest?.[field]);
    if (!Number.isFinite(raw) || raw <= 0 || raw > 99999999999.99) {
      throw Object.assign(new Error('חסר מחיר זהב תקין בלוג פריוריטי לתאריך החשבונית'), { status: 502 });
    }
    prices[part] = { price: Number(raw.toFixed(2)), rawPrice: raw, currency: '$', unit: 'גרם' };
  }
  return { date, source: 'priority-gold', updatedAt: latest.UDATE, prices };
}

module.exports = { goldCutoff, goldResult };
