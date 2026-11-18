---
name: priority-reports
description: Build and investigate Priority ERP sales, inventory and exception reports. Use for Report Generator, processed or BI reports, mismatched totals, drill-down to source documents or lines, and report reconciliation (דוחות מכירות, מלאי, חריגים, פער בסכומים, התאמה למסמכי מקור).
---

# Priority reports

Load only what applies:

| Task | Reference |
| --- | --- |
| Build, modify or debug a native report; design exceptions | [Report design](references/design.md) |
| Define sales metrics and choose source documents | [Sales](references/sales.md) |
| Define inventory balances, movements or availability | [Inventory](references/inventory.md) |
| Explain a total difference or compare two exports | [Reconciliation](references/reconciliation.md) |

1. Fix the definition before changing the report: company, effective user, row grain, source entity, date field and period, statuses, branch/warehouse scope, measure, currency or unit, tax/sign/rounding rules, and report refresh time. Name the independent source of truth for that measure.
2. Start with the smallest slice that reproduces the issue. Compare document or movement keys before comparing sums. Retain drill-down identifiers. If a report only exposes summaries, obtain the underlying detail; a matching grand total can hide offsetting errors.
3. Test on representative records and a known total. Separate reproduced facts from hypotheses. Report signed differences, affected documents/lines, cause or remaining uncertainty, and how to verify a fix.

Use `priority-api` for read-only extraction and metadata, `priority-documents` for document lifecycle, and `priority-ops` for permissions or internal deployment. Investigation does not authorize editing source documents, posting transactions, or changing the live report. Answer in the user's language.
