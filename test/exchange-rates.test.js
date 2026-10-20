'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { exchangeQuery, exchangeResult } = require('../exchange-rates');
const header = 'SERIES_CODE,BASE_CURRENCY,COUNTER_CURRENCY,DATA_TYPE,UNIT_MULT,COMMENTS,TIME_PERIOD,OBS_VALUE';
const row = (date, rate, type = 'OF00') => `RER_USD_ILS,USD,ILS,${type},0,,${date},${rate}`;

test('BOI query validates dates, bounds history and handles future invoices', () => {
  for (const date of ['', '2026-02-30', '2026-13-01', "2026-10-20' or 1 eq 1"]) assert.throws(() => exchangeQuery(date), { status: 400 });
  const url = new URL(exchangeQuery('2026-10-20', '2026-10-20'));
  assert.equal(url.hostname, 'edge.boi.gov.il');
  assert.ok(url.pathname.endsWith('/RER_USD_ILS'));
  assert.equal(url.searchParams.get('endperiod'), '2026-10-20');
  assert.equal(url.searchParams.get('startperiod'), '2026-07-22');
  assert.equal(new URL(exchangeQuery('2026-10-25', '2026-10-20')).searchParams.get('endperiod'), '2026-10-20');
});

test('official latest rate on or before invoice date applies to both dollar codes', () => {
  const csv = [header, row('2026-10-21', 9), row('2026-10-19', 3.11), row('2026-10-16', 3.089), row('2026-10-20', 8, 'OTHER')].join('\r\n');
  const result = exchangeResult(csv, '2026-10-20');
  assert.equal(result.source, 'bank-of-israel');
  assert.deepEqual(result.rates.USD, { rate: 3.11, rateDate: '2026-10-19' });
  assert.deepEqual(result.rates.$, result.rates.USD);
  assert.equal(exchangeResult(csv, '2026-10-18').rates.USD.rateDate, '2026-10-16');
});

test('CSV supports BOM, quoted comments with commas and newlines, and unit multipliers', () => {
  const csv = '\uFEFF' + header + '\r\nRER_USD_ILS,USD,ILS,OF00,-2,"note, with ""quotes""\nand newline",2026-10-19,311\r\n';
  assert.equal(exchangeResult(csv, '2026-10-20').rates.USD.rate, 3.11);
});

test('invalid, absent, nonofficial or future rates never become a guessed rate', () => {
  for (const value of ['', 'NaN', '0', '-3', 'Infinity']) assert.throws(() => exchangeResult(header + '\n' + row('2026-10-19', value), '2026-10-20'), { status: 502 });
  for (const csv of [header, header + '\n' + row('2026-10-21', 3), '<html>not CSV</html>', header + '\n' + row('2026-10-19', 3, 'OTHER')]) {
    assert.throws(() => exchangeResult(csv, '2026-10-20'), { status: 502 });
  }
});
