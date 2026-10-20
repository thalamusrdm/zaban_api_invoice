'use strict';

function validDate(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}

function exchangeQuery(date, today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date())) {
  if (!validDate(date)) { const error = new Error('תאריך חשבונית לא תקין'); error.status = 400; throw error; }
  // Include prior publications for holidays; future invoices can only use rates already published.
  const end = date < today ? date : today;
  const start = new Date(`${end}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 90);
  const params = new URLSearchParams({ startperiod: start.toISOString().slice(0, 10), endperiod: end, format: 'csv' });
  return 'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/RER_USD_ILS?' + params;
}

function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  const source = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((c === '\r' || c === '\n') && !quoted) {
      if (c === '\r' && source[i + 1] === '\n') i++;
      row.push(cell); if (row.some(x => x.trim())) rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (quoted) throw new Error('תשובת בנק ישראל אינה בפורמט תקין');
  row.push(cell); if (row.some(x => x.trim())) rows.push(row);
  const headers = rows.shift() || [];
  return rows.map(values => Object.fromEntries(headers.map((key, i) => [key.trim(), (values[i] || '').trim()])));
}

function exchangeResult(csv, date) {
  const candidates = parseCsv(csv).filter(x => x.SERIES_CODE === 'RER_USD_ILS' && x.BASE_CURRENCY === 'USD'
    && x.COUNTER_CURRENCY === 'ILS' && x.DATA_TYPE === 'OF00' && validDate(x.TIME_PERIOD) && x.TIME_PERIOD <= date)
    .sort((a, b) => b.TIME_PERIOD.localeCompare(a.TIME_PERIOD));
  const latest = candidates[0];
  const value = latest?.OBS_VALUE ? Number(latest.OBS_VALUE) : NaN;
  const multiplier = latest?.UNIT_MULT ? Number(latest.UNIT_MULT) : NaN;
  const rate = Number((value * 10 ** multiplier).toFixed(6));
  if (!Number.isFinite(rate) || rate <= 0 || rate > 9999999.999999) {
    const error = new Error('לא נמצא שער דולר יציג תקין בבנק ישראל לתאריך החשבונית או לפניו בטווח הנתונים שנשלף'); error.status = 502; throw error;
  }
  const info = { rate, rateDate: latest.TIME_PERIOD };
  return { date, source: 'bank-of-israel', rates: { USD: info, '$': { ...info } } };
}

function priorityExchangeResult(rows, date) {
  const rates = {};
  for (const row of rows) {
    if (!['USD', '$'].includes(row.CODE)) continue;
    const quantity = Number(row.EXCHQUANT);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    const history = [...(row.CURRHIS_SUBFORM || []), { EXCH: row.EXCH, CURDATE: row.EXCHDATE }]
      .filter(x => validDate(x.CURDATE) && x.CURDATE <= date)
      .sort((a, b) => b.CURDATE.localeCompare(a.CURDATE) || String(b.SDATE || '').localeCompare(String(a.SDATE || '')));
    const latest = history[0];
    const rate = Number((Number(latest?.EXCH) / quantity).toFixed(6));
    if (Number.isFinite(rate) && rate > 0 && rate <= 9999999.999999) rates[row.CODE] = { rate, rateDate: latest.CURDATE, updatedAt: latest.SDATE || null };
  }
  if (!rates.USD || !rates.$) { const error = new Error('חסר שער דולר תקין בפריוריטי עבור USD או $ לתאריך החשבונית'); error.status = 502; throw error; }
  return { date, source: 'priority', rates };
}

module.exports = { exchangeQuery, exchangeResult, priorityExchangeResult };
