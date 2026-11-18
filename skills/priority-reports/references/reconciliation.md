# Trace a discrepancy to source records

1. Save the report definition/variant, input selections, execution time and full detail export. Align those with an independent read of source documents, movements or ledger. Verify pagination and permissions. Remove subtotal/header rows before comparing raw detail.
2. At the same grain, verify keys such as company + invoice type + document key + line, or company + movement key + line and warehouse. Include the measure basis (currency/unit) in the comparison. Keep the business reference for user drill-down; do not join solely on display number across companies or document types. If the report is summarized, first aggregate source rows by the same verified dimensions and keep the mapping to source lines.
3. Classify source-only, report-only, repeated keys, and common keys with different values. For a common mismatch, break down date/status, signs, currency, discounts/tax, quantity/unit, or rounding. Investigate repeated keys before aggregating them: they may be legitimate detail or a join defect.
4. Explain the delta with concrete evidence: expected vs actual by matched grain, unexplained remainder, example documents/lines, and suspected or verified cause. Report zero-net but offsetting differences separately. Confirm a fix by rerunning the original slice and testing a case outside it.

## Offline export comparator

```powershell
python <skill-dir>/scripts/reconcile.py report.csv source.csv --key COMPANY,DOC_TYPE,DOC_ID,CURRENCY --report-value ACTUAL --source-value EXPECTED
```

Header names are examples. Normalize the exports to the same key headers, grain and decimal convention first. Supports UTF-8 CSV/TSV (`--delimiter tab`), signed plain decimals with dot separators, and exact text keys including leading zeros. Explicit `--tolerance 0.01` separates minor differences from larger ones; default is exact. Differences are report minus source. Repeated keys are flagged without netting; the helper compares each unique key and never adds unlike currencies/units. It prints counts and bounded row references, no key values, and makes no ERP calls. Record numbers start at 2 (header is 1); a multiline CSV record counts once. Exit 0 means valid inputs, not reconciled totals.
