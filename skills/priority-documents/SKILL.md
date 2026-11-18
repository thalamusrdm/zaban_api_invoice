---
name: priority-documents
description: Plan, implement, and troubleshoot Priority ERP sales document workflows from quote or order through shipment, invoice, credit, receipt and delivery. Use for document lifecycle questions including הזמנה, משלוח, חשבונית מס, זיכוי, קבלה, and מקור דיגיטלי. Use priority-api for generic API syntax and priority-ops for ERP configuration changes.
---

# Priority documents

Read only the reference for the requested stage:

| Need | Reference |
| --- | --- |
| Quotes, orders, shipments, partial fulfillment, returns | [Orders and fulfillment](references/fulfillment.md) |
| Invoice preparation, posting, finalization errors | [Sales invoices](references/invoices.md) |
| Cancel, credit, receipt, allocate payment, refund | [Corrections and payments](references/corrections-payments.md) |
| Print, digital original, copy, customer signature, email | [Document output](references/output.md) |
| Working in the zaban_invoice project | Also [Zaban workflow](references/zaban.md) |

1. Identify company, document type, key, current state and requested result. Capture source documents, affected lines, currency and references as needed. Localized names, statuses, fields and actions depend on installation; verify via the actual form, actions, project evidence or metadata.
2. Treat preparation, finalization, output, sending, payment and reversal as distinct operations. Run only the requested stage. Verify its prerequisites and confirm the expected effects on the document, related documents, inventory, ledger or payment provider as applicable.
3. After a timeout or ambiguous result, check persisted state before retrying. Use a stable document identity where available; a display number may change on finalization. Preserve external correlation and distinguish a saved document from an attempted operation.

Draft instructions or code without making live changes when asked how to do something. A document action may post or send even if it sounds like a preview. State what was verified, what is installation-specific and what still needs checking. Answer in the user's language.
