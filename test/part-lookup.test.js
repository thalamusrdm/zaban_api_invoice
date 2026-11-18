'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const lookup = require('../public/part-lookup');

test('scanner framing is removed while leading zeros, separators and case are preserved', () => {
  assert.equal(lookup.normalize('\u0002\u200e 00123-A/7 \r\n\u0003'), '00123-A/7');
  assert.equal(lookup.exactMatches([{ PARTNAME: '123-A/7' }], '00123-A/7').length, 0);
  assert.equal(lookup.exactMatches([{ PARTNAME: 'ABC' }], 'abc').length, 0);
  assert.equal(lookup.isValid('A'.repeat(129)), false);
  assert.equal(lookup.isValid('ABC\nDEF'), false);
  assert.equal(lookup.isValid('000123456789012345678901234567'), true);
});

test('a SKU/barcode collision stays ambiguous, while repeated rows for one SKU are deduplicated', () => {
  const rows = [{ PARTNAME: '735306', BARCODE: 'OTHER' }, { PARTNAME: 'SECOND', BARCODE: '735306' }];
  assert.equal(lookup.exactMatches([...rows, rows[0]], '735306').length, 2);
  assert.equal(lookup.exactMatches(rows, '735').length, 0);
});
