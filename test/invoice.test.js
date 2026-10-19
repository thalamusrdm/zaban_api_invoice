'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildInvoicePayload } = require('../invoice-payload');
const { lineTotal, totals } = require('../public/invoice-calculations');

const gold = () => ({ custname: 'TEST', date: '2026-10-19', lines: [{ partname: '14', quantity: 1.66, price: 315, currency: 'ש"ח' }] });

test('gold quantities, currency and Jerusalem date map to Priority fields', () => {
  const p = buildInvoicePayload(gold(), 'test-api');
  assert.equal(p.IVDATE, '2026-10-19T00:00:00+03:00');
  assert.equal(p.EDEA_INVTYPE, '1');
  assert.equal(p.IVCODENAME, '02');
  assert.equal(p.OWNERLOGIN, 'test-api');
  assert.equal(p.AINVOICEITEMS_SUBFORM[0].TQUANT, 1.66);
  assert.equal(p.AINVOICEITEMS_SUBFORM[0].ICODE, 'ש"ח');
  assert.equal(p.AINVOICEITEMS_SUBFORM[0].EXCH, 1);
  assert.equal(p.WARHSNAME, undefined);
  assert.equal(p.AGENTCODE, undefined);
  assert.equal(totals(gold().lines).beforeVat, 522.9);
});

test('jewelry supports foreign currency, exchange and both discount levels', () => {
  const body = { ...gold(), invoiceType: '4', warehouse: '1', location: '0', agent: '10', booknum: 'TEST-HEADER', discount: 2,
    lines: [{ partname: 'TEST-PART', quantity: 1, price: 4199, currency: '$', exchange: 3.15078, discount: 85 }] };
  const p = buildInvoicePayload(body, 'test-api');
  assert.equal(p.EDEA_INVTYPE, '4');
  assert.equal(p.WARHSNAME, '1');
  assert.equal(p.LOCNAME, '0');
  assert.equal(p.AGENTCODE, '10');
  assert.equal(p.BOOKNUM, 'TEST-HEADER');
  assert.equal(p.PERCENT, 2);
  assert.equal(p.AINVOICEITEMS_SUBFORM[0].EDEA_BOOKNUM, undefined);
  assert.equal(p.AINVOICEITEMS_SUBFORM[0].PERCENT, 85);
  assert.ok(Math.abs(lineTotal(body.lines[0]) - 1984.518783) < 0.00001);
  assert.ok(Math.abs(totals(body.lines, 2).total - 1984.518783 * 0.98 * 1.18) < 0.00001);
});

test('missing or invalid exchange rates are rejected and never previewed as shekels', () => {
  for (const exchange of [undefined, '', ' ', 0, -1, 'NaN', 'Infinity', true]) {
    const body = gold(); body.lines[0] = { ...body.lines[0], currency: 'USD', exchange };
    assert.throws(() => buildInvoicePayload(body, 'test-api'), { status: 400 });
  }
  const line = { quantity: 1, price: 100, currency: 'USD', exchange: '' };
  assert.equal(lineTotal(line), null);
  assert.equal(totals([line]), null);
});

test('invalid dates, quantities, discounts and types cannot reach Priority', () => {
  for (const update of [{ date: '2026-02-30' }, { date: 'not-a-date' }, { discount: 101 }, { discount: -1 }, { invoiceType: 'unknown' }, { lines: [] }]) {
    assert.throws(() => buildInvoicePayload({ ...gold(), ...update }, 'test-api'), { status: 400 });
  }
  for (const update of [{ quantity: 0 }, { quantity: -1 }, { price: 'Infinity' }, { discount: 101 }, { currency: 'INVALID' }, { partname: {} }]) {
    const body = gold(); Object.assign(body.lines[0], update);
    assert.throws(() => buildInvoicePayload(body, 'test-api'), { status: 400 });
  }
});

test('legacy grams remain supported; server controls owner, type and status', () => {
  const body = gold(); delete body.lines[0].quantity; body.lines[0].grams = 2;
  Object.assign(body, { OWNERLOGIN: 'other', STATDES: 'סופית', IVCODENAME: 'other', PRIORITY_PASSWORD: 'fake' });
  const p = buildInvoicePayload(body, 'test-api');
  assert.equal(p.AINVOICEITEMS_SUBFORM[0].TQUANT, 2);
  assert.equal(p.OWNERLOGIN, 'test-api');
  assert.equal(p.IVCODENAME, '02');
  assert.equal(p.STATDES, undefined);
  assert.equal(p.PRIORITY_PASSWORD, undefined);
});

test('winter dates and fully discounted lines calculate correctly', () => {
  const body = gold(); body.date = '2026-12-01'; body.invoiceType = '2';
  assert.equal(buildInvoicePayload(body, 'test-api').IVDATE, '2026-12-01T00:00:00+02:00');
  body.lines[0].discount = 100;
  assert.equal(totals(body.lines).total, 0);
  assert.equal(totals(gold().lines, 101), null);
});

test('metadata read-only line references cannot be written', () => {
  for (const key of ['booknum', 'EDEA_BOOKNUM']) {
    const body = gold(); body.lines[0][key] = 'TEST-BOOK';
    assert.throws(() => buildInvoicePayload(body, 'test-api'), { status: 400 });
  }
});

test('metadata string lengths and decimal scales are enforced before writing', () => {
  for (const update of [{ details: 'x'.repeat(25) }, { warehouse: '12345' }, { location: 'x'.repeat(15) }, { agent: 'x'.repeat(17) }, { booknum: 'x'.repeat(49) }, { discount: 1.001 }]) {
    assert.throws(() => buildInvoicePayload({ ...gold(), ...update }, 'test-api'), { status: 400 });
  }
  for (const update of [{ partname: 'x'.repeat(23) }, { quantity: 1.0001 }, { price: 10.001 }, { discount: 0.001 }, { currency: 'USD', exchange: 3.1234567 }]) {
    const body = gold(); Object.assign(body.lines[0], update);
    assert.throws(() => buildInvoicePayload(body, 'test-api'), { status: 400 });
  }
});
