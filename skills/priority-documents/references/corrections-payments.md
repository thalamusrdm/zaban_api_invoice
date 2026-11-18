# Corrections, receipts and refunds

Sources: [Sales Invoices SOP](https://cdn.priority-software.com/docs/SOP_SalesInvs_23_1_E.pdf), [Priority Payments guide](https://cdn.priority-software.com/docs/SOP_Priority_Payments_Guide_23_0_E.pdf), [bank reconciliation SOP](https://cdn.priority-software.com/docs/SOP_BankRecon_%28Split%29_23_0_E.pdf). Verify local finance policy, installed actions and provider behavior; these are workflow guides, not tax advice.

| Intent | What to verify |
| --- | --- |
| Remove a pending invoice | Confirm it is pending and check dependencies. Find **Delete Pending Invoice/Memo** for the applicable type. Verify removal or cancellation state after the action. |
| Reverse a finalized invoice | Use the supported cancellation action. Confirm original vs designated date with finance and verify the resulting cancellation document, reversing journal entry and linkage. |
| Partial credit or return | Confirm lines/amount, original invoice linkage, tax/currency and whether there is a physical return. Use the installed credit workflow. Do not treat a negative amount in an arbitrary form as equivalent to a credit memo. |
| Issue a receipt | Confirm actual payment or an explicitly requested payment operation, amount, currency, means, customer, reference and invoice allocation. Use **Record a Receipt** from the invoice when appropriate; a partial receipt does not settle the full invoice. |
| Reverse payment or refund | Identify the original receipt and provider transaction. Distinguish internal reversal, allocation changes and actual gateway refund. Verify all applicable results separately. |

Check existing receipts, allocations and linked credits before reversing. Sequence depends on document type, payments and configuration; verify the installed process rather than assuming one universal order. When a gateway response is uncertain, reconcile gateway reference and ERP records before any reattempt. Never collect or retain card data in skill notes.
