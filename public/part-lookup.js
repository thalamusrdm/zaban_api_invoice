(function (root) {
  'use strict';
  const maxLength = 128;

  function normalize(value) {
    // Keep leading zeros, punctuation and internal spaces in product identifiers.
    return String(value ?? '').replace(/^[\s\u0002\u0003\u200e\u200f]+|[\s\u0002\u0003\u200e\u200f]+$/g, '');
  }

  function isValid(value) {
    const term = normalize(value);
    return term.length > 0 && term.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(term);
  }

  function uniqueParts(items) {
    const seen = new Set();
    return items.filter(item => {
      const key = String(item.PARTNAME ?? '').trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function exactMatches(items, value) {
    const term = normalize(value);
    if (!term) return [];
    return uniqueParts(items.filter(item =>
      String(item.PARTNAME ?? '').trim() === term || String(item.BARCODE ?? '').trim() === term));
  }

  const api = { normalize, isValid, exactMatches, uniqueParts, maxLength };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PartLookup = api;
})(typeof window !== 'undefined' ? window : globalThis);
