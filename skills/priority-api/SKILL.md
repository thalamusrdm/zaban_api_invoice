---
name: priority-api
description: Build and troubleshoot Priority ERP REST/OData integrations and Web SDK actions. Use for Priority API queries, customers, invoices, metadata, subforms, attachments, procedures and reports, including Hebrew requests about פריוריטי. Distinguish installation-specific behavior from current vendor documentation.
---

# Priority API

Read only the reference needed for the requested action. Answer in the user's language. Source check: 2026-10-19; this is a compact working guide, not a complete form catalog.

| Task / Hebrew cues | Read |
| --- | --- |
| Connection, credentials, הרשאות, התחברות | [auth.md](references/auth.md) |
| Find form/field/key, מטאדאטה, שדות | [schema.md](references/schema.md) |
| Search, filters, pagination, sync, חיפוש | [query.md](references/query.md) |
| Create/update/delete, subforms, files, text, batch | [write.md](references/write.md) |
| Close/print invoice, procedure/report, סגירה, הדפסה | [sdk.md](references/sdk.md) |
| Errors, limits, version differences, תקלות | [operations.md](references/operations.md) |
| Working in zaban_invoice / צבאן | Also [zaban.md](references/zaban.md) |

## Working rules

- Identify the actual service root, company, form and intended result. Reuse project configuration; never put credentials or business records into this skill.
- Resolve unknown fields, key types and navigation properties from that installation's metadata; examples are templates. Schema alone does not establish business meaning.
- For a known workflow use the local recipe. For an uncovered operation, changed behavior, version claim or conflict, open only the relevant official page linked by the reference. Do not crawl the portal again. Record narrowly scoped corrections with source, date and affected installation/version.
- Explain or draft API requests without executing writes unless the user requested execution. Creating this skill does not authorize ERP mutations. After an ambiguous write timeout, reconcile the record before retrying.
- Give a concrete method/path/body or code using verified field names; distinguish draft creation, closing and printing. Report what was actually verified.

## Save metadata context

Download metadata using the project's existing authenticated client, save it locally, then run:

```powershell
python <skill-dir>/scripts/metadata_slice.py <metadata.xml> CUSTOMERS
python <skill-dir>/scripts/metadata_slice.py <metadata.xml> AINVOICES --fields IVNUM,IVTYPE,DEBIT
```

The helper reads a local XML file, prints the selected entity and immediate subforms as compact JSON, and never connects to Priority. Cache by service root/company; refresh after schema changes. Do not load the full XML into chat.
