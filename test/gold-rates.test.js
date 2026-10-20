'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { goldCutoff, goldResult } = require('../gold-rates');

test('gold uses invoice end-of-day in Jerusalem, capped at now including DST', () => {
  const now = new Date('2026-10-20T12:50:00Z');
  assert.equal(goldCutoff('2026-10-20', now), now.toISOString());
  assert.equal(goldCutoff('2026-10-21', now), now.toISOString());
  assert.equal(goldCutoff('2026-10-19', now), '2026-10-19T20:59:59.000Z');
  assert.equal(goldCutoff('2026-01-19', now), '2026-01-19T21:59:59.000Z');
  assert.throws(() => goldCutoff('2026-02-30', now), /תאריך/);
});

test('gold selects newest eligible timestamp and maps explicit gram prices, rounded for invoice PRICE', () => {
  const rows = [
    { UDATE: '2026-10-20T15:13:00+03:00', USDPRICE: '78.283894669', USDPRICE2: '100.363967524', USDPRICE3: '132.361192813' },
    { UDATE: '2026-10-20T16:13:00+03:00', USDPRICE: '999', USDPRICE2: '999', USDPRICE3: '999' },
    { UDATE: '2026-10-20T15:44:00+03:00', USDPRICE: '78.355698896', USDPRICE2: '100.456024226', USDPRICE3: '132.482598287' },
  ];
  const data = goldResult(rows, '2026-10-20', '2026-10-20T12:50:00Z');
  assert.equal(data.updatedAt, rows[2].UDATE);
  assert.equal(data.prices['14'].price, 78.36);
  assert.equal(data.prices['18'].price, 100.46);
  assert.equal(data.prices.F.price, 132.48);
  assert.equal(data.prices.F.unit, 'גרם');
  assert.equal(data.prices.F.rawPrice, 132.482598287);
});

test('missing, invalid, or future-only gold quote blocks pricing rather than using another record', () => {
  for (const rows of [[], [{ UDATE: '2026-10-21T00:00:00Z' }], [{ UDATE: '2026-10-20T01:00:00Z', USDPRICE: '0', USDPRICE2: '1', USDPRICE3: '1' }]]) {
    assert.throws(() => goldResult(rows, '2026-10-20', '2026-10-20T12:50:00Z'), /מחיר זהב תקין/);
  }
});
