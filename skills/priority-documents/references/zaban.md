# Zaban invoice workflow

Use only for the zaban_invoice repository. Verify current code, configuration and deployment before using these notes. Sources in the checkout: `server.js`, `invoice-payload.js`, `priority-sdk.js`, `docs/invoice-fields.md`, `docs/priority-original-pdf.md`, `docs/digital-email-signature.md`, and `priority/original-pdf/README.md`. Read dated updates in the docs; early findings may be superseded.

| Stage | Project evidence |
| --- | --- |
| Draft | `buildInvoicePayload` maps the installed fields and Jerusalem date. Server posts header and `AINVOICEITEMS_SUBFORM` to `AINVOICES`. Prefer current payload builder to copied examples, especially for currencies and custom fields. |
| Close | Uses `CLOSEANINVOICE` by default through Web SDK. The current route reads internal `IV` first, then looks up the same `IV` to reconcile changed `IVNUM` and status. Its REST lookup key is `IVNUM, IVTYPE='A', DEBIT='D'`; don't use internal `IV` as a write key. |
| Display/copy | `WWWSHOWAIV` is the default print procedure. Inspect the actual route/options; a regular PDF is not necessarily the digital original. |
| Existing original | `GET /api/invoices/existing-original` reads `EXTFILES_SUBFORM` and requires one matching `מסמך ממוחשב` PDF. It does not generate output. |
| Original download without mail | Preflight customer readiness, create/close once, prepare the original, then download saved bytes. Inspect the dedicated `ZBAN_ORIGINALPDF` procedure and the current route before changing it. |
| Email / customer signature | The mail route uses native Priority mail with recipient checks; acceptance is not delivery. The signature route works on a separate copy and retains its own attachment state. |

For retries, inspect the request ID binding and durable workflow state scoped by environment and internal document identity. The `DETAILS` duplicate lookup alone is not concurrency protection; do not assume the plain draft route has the same replay protection as digital modes. Never clear saved results or printed flags to force a new attempt. Check persisted bytes/hash, attachments and mail state first.

The project docs record a historical successful no-mail original flow with matching saved and downloaded bytes and a separately attached signed copy. That is historical evidence for the documented environment, not a new live check or a claim about the currently deployed version. Keep real customer/document IDs and credentials out of this skill.
