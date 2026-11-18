(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CustomerTax = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  function validNumber(value) {
    if (!/^\d{9}$/.test(value) || /^0+$/.test(value)) return false;
    return [...value].reduce((sum, digit, index) => {
      const product = Number(digit) * (index % 2 + 1);
      return sum + (product > 9 ? product - 9 : product);
    }, 0) % 10 === 0;
  }

  // This classifies the identifier, not the customer's VAT registration status.
  // In particular, an individual's ID cannot distinguish a registered/exempt dealer.
  function infer(row) {
    if (String(row?.WTAXNUMEXPL ?? '').trim()) return null;
    const number = String(row?.WTAXNUM ?? '').trim();
    if (!validNumber(number)) return null;
    if (/^5[12]/.test(number)) return { value: '2', label: 'חברה', number };
    if (/^[0-3]/.test(number)) return { value: '1', label: 'עצמאי / תעודת זהות', number };
    // Other corporations, foreign identifiers and unknown ranges need explicit data.
    return null;
  }

  return { validNumber, infer };
});
