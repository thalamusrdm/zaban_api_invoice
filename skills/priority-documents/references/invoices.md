# Sales invoice: prepare and finalize

Source: [Sales Invoices SOP v23.1](https://cdn.priority-software.com/docs/SOP_SalesInvs_23_1_E.pdf). Use the SOP for the exact invoice variant; export, cash-based, multi-shipment and over-the-counter workflows can differ. [Cash-based accounting SOP](https://cdn.priority-software.com/docs/SOP_ProFormaInv_23_0_E.pdf).

1. Decide whether to prepare from existing sales/shipping documents or to enter a standalone invoice. Confirm source links, customer, dates, currency/exchange rate, line quantities and prices, discounts, tax treatment and payment terms. Verify draft number, saved lines and ERP-calculated totals. Determine the intended action before creating anything.
2. For posting, use the applicable **Finalize Invoice/Memo** action; choose a combined finalize-and-print action only when both effects are requested. Do not substitute a direct invoice status update. Verify final number/status and, as applicable, source billing balances, ledger entries and allocation/approval results.
3. If closing fails, capture the exact action/step and message. Check that the document is still pending and the role can run the action. Investigate closed period, wrong company, missing numbering series, blocking data or rules according to the evidence; use priority-ops for the configuration. After a timeout look up the original record before replaying.
4. Pending removal, finalized correction, printing and email are different tasks. See [corrections and payments](corrections-payments.md) and [output](output.md).

When debugging installed document customizations, inspect initial/follow-up procedures on the financial document type. A follow-up invocation is not proof of successful finalization; check the persisted result first. [Priority SDK financial document hooks](https://prioritysoftware.github.io/sdk/Financial-Document-Initial-Follow-up-Procedure.html).
