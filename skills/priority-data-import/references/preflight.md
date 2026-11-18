# Preflight and duplicates

Keep the source unchanged. For spreadsheets, read identifiers as text; if Excel has already removed zeros or rounded a long identifier, recover it from the source system instead of guessing. Use an explicit date format, decimal convention, currency and unit. Check the header, encoding (especially Hebrew), duplicate columns, blank required fields, unknown references and formula-derived values before converting to the interface format.

Compare on the verified business key with an explicit normalization policy. Never collapse codes by lowercasing, trimming or numeric conversion by default. Use a complete, company-scoped extract of the relevant keys, including inactive rows when relevant; if unavailable, query exact keys before classifying creates.

| Result | Action |
| --- | --- |
| Missing/invalid key | Quarantine with source row and reason. |
| Same key and same mapped values | Keep one candidate only after confirming equivalence; keep the collapsed source-row links. |
| Same key, conflicting values | Quarantine the entire group; no arbitrary first/last row wins. |
| Multiple ERP candidates | Block; resolve the scope or key before importing. |
| Exactly one ERP record | Compare mapped fields; skip no-change, and propose only allowed field updates. |
| No exact match | Candidate create only after verifying lookup scope and policy. Review secondary signals separately. |

## Offline exact-key helper

Use after exporting the **mapped** input and optional existing-key extract to UTF-8 CSV/TSV with matching key headers. It never calls Priority or writes files. Record numbers start at 2 (header is 1); a multiline record counts once. Keys are compared exactly, with whitespace-only components flagged as missing. Existing non-key values are not compared.

```powershell
python <skill-dir>/scripts/preflight.py mapped.csv --key CUSTNAME --existing existing-keys.csv
python <skill-dir>/scripts/preflight.py mapped-prices.tsv --delimiter tab --key LIST,VERSION,PART,UOM,MINQTY
```

The price headers are illustrative source aliases, not Priority field names. JSON reports counts and up to 20 row examples per category (`--examples 0` for counts only). It prints no key values. Repeated input is classified separately even when the key exists in ERP; resolve it, then rerun preflight on the chosen candidates. Exit 0 means the files parsed, not that the load is approved or clean.
