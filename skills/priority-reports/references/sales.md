# Sales measures and source records

Sources: [Sales Orders SOP](https://cdn.priority-software.com/docs/SOP_Sales_Order_22_1_E.pdf) and [Sales Invoices SOP](https://cdn.priority-software.com/docs/SOP_SalesInvs_23_1_E.pdf). Verify which installed document variants and statuses are in scope.

| Measure | Start with | Common reason for a mismatch |
| --- | --- | --- |
| Booked sales or open orders | Sales order lines; ordered or remaining quantity/value as defined | Partial shipments, cancellations, line vs order status, order date vs due date |
| Shipped volume/value | Shipment and return lines | Duplicate joins to invoices, different dates, unit conversion, return sign |
| Invoiced sales | Finalized invoices and in-scope credits/cancellations | Drafts, credit sign applied twice, tax inclusion, exchange rate/date, header discount |
| Receipts or cash collection | Receipt/payment and allocation records | Partial payment, unapplied amounts, cash date vs invoice date |
| Ledger sales | Relevant journal postings and accounts | Posting period, reversals, FX, excluded accounts, invoiced versus recognized basis |

For a net/gross difference, compare stored document totals, tax, discounts and non-item charges before recomputing from displayed unit prices. Align currency or use an explicitly defined conversion and rounding policy. Verify one normal invoice, one credit/reversal and one discounted or foreign-currency example. Inspect original and reversal separately; do not exclude the original and also subtract the reversal unless the report explicitly calls for that treatment.

For Zaban, `server.js` reads invoice header `QPRICE`, `VAT`, `TOTPRICE` and `STATDES` from `AINVOICES`. Its recent-invoice view is limited and scoped to the app owner; it is not a company-wide report. Confirm actual field meanings and complete extraction for the requested population. The on-screen estimate is not the persisted ERP total.
