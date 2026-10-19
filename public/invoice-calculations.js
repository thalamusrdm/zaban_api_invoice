(function (root) {
  'use strict';
  function lineTotal(line) {
    const exchange = line.currency === 'ש"ח' ? 1 : Number(line.exchange);
    if (!Number.isFinite(exchange) || exchange <= 0) return null;
    const quantity = Number(line.quantity), price = Number(line.price), discount = Number(line.discount || 0);
    if (![quantity, price, discount].every(Number.isFinite) || quantity < 0 || price < 0 || discount < 0 || discount > 100) return null;
    return quantity * price * (1 - discount / 100) * exchange;
  }
  function totals(lines, discount = 0, vatRate = 0.18) {
    const values = lines.map(lineTotal);
    if (values.some(x => x === null) || !Number.isFinite(discount) || discount < 0 || discount > 100) return null;
    const beforeVat = values.reduce((sum, n) => sum + n, 0) * (1 - discount / 100);
    return { beforeVat, vat: beforeVat * vatRate, total: beforeVat * (1 + vatRate) };
  }
  const api = { lineTotal, totals };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.InvoiceCalculations = api;
})(typeof window !== 'undefined' ? window : globalThis);
