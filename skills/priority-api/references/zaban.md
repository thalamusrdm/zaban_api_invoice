# zaban_invoice: local evidence only

Use only for `C:/Users/dor thalamus/Documents/zaban_invoice`. Inspected 2026-10-19: README.md, server.js, priority-sdk.js; **no live ERP verification in skill creation**. Recheck current code/config before execution. Never copy .env contents into the skill.

| Need | Existing evidence |
| --- | --- |
| REST wrapper/routes | server.js; uses existing PRIORITY_* configuration |
| SDK | priority-sdk.js; priority-web-sdk dependency |
| Customer search | CUSTOMERS: CUSTNAME, CUSTDES |
| Products | LOGPART; local status filter is installation-specific |
| Draft creation | POST AINVOICES with AINVOICEITEMS_SUBFORM |
| Invoice key | IVNUM + IVTYPE='A' + DEBIT='D' in current routes |
| Closing | closeInvoice(), activation CLOSEANINVOICE; env PRIORITY_CLOSE_PROC overrides |
| Document output | getInvoiceDocumentUrl(), WWWSHOWAIV; env PRIORITY_PRINT_PROC overrides |

Draft body in current code:

```json
{
  "CUSTNAME": "CUSTOMER_CODE",
  "IVDATE": "2026-10-19T00:00:00+03:00",
  "OWNERLOGIN": "API_LOGIN",
  "IVCODENAME": "02",
  "EDEA_INVTYPE": "1",
  "DETAILS": "EXTERNAL_REFERENCE",
  "AINVOICEITEMS_SUBFORM": [
    {"PARTNAME": "ITEM_CODE", "TQUANT": 1, "PRICE": 100}
  ]
}
```

Custom fields/codes are specific to this installation, not universal invoice requirements. Use the project's Jerusalem date helper for actual dates/DST. Priority's returned QPRICE/VAT/TOTPRICE determine totals.

README records 2026-09-22 `contains`/`startswith` returning 501. Existing search uses `CUSTDES eq '*term*'`. Preserve this known fallback locally; current vendor docs support string functions elsewhere. Do not globally declare those functions unsupported.

README records production company `zaban`, test `zabant`, old test `zabcopy`; these are historical notes, not current environment selection. Old test had period/numbering failures. Check current configured company before writes; do not switch it automatically.

Closing by STATDES PATCH was rejected locally; SDK closing is a separate operation. Current server verifies result using internal IV in a read filter; do not use that auto-unique ID as a write key. Final IVNUM may change after closing.

Code currently confirms SDK warnings automatically; this is observed behavior, not a universal recommendation. Check messages and actual final state. Host/firewall notes in README are historical leads, not proof that every timeout is an IP issue.
