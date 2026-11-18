# Orders and fulfillment

Sources: [Sales Orders SOP](https://cdn.priority-software.com/docs/SOP_Sales_Order_22_1_E.pdf) and [Delivery Scheduling SOP](https://cdn.priority-software.com/docs/SOP_Delivery_Sched_23_E.pdf). These are versioned examples; confirm the applicable process and actions in the installation.

| Stage | Verify before proceeding | Verify afterward |
| --- | --- | --- |
| Quote to order | Customer, accepted revision, item codes, unit/quantity, price, currency, tax/terms and delivery dates. Use supported source-document conversion if available. | Order is linked to the intended source and copied lines/totals match; correct order status and approvals. |
| Order to shipment | Remaining **per line**; compare prior shipments and open quantity. Check warehouse, location, batch/serial data and the actual dispatch quantity. | Shipment linked to the correct order lines; expected inventory and remaining quantities. |
| Shipment to invoice | Selected shipments, quantities billed so far and which lines remain billable; check existing drafts as well as finals. | Correct links, no double billing, remaining amount/quantity as expected. |
| Return | Original shipment and exact quantity physically returned, destination and applicable lot/serial. | Return recorded; verify stock separately from any credit or refund. |

For partial dispatch, carry source-line identity through the next document; two lines can share a SKU. Search **View Open Order Items** for the order-side remainder. The delivery scheduling SOP shows changing a shipment's status to Final, while invoice finalization is an Action. Verify the installed shipment workflow and effects; do not transfer the invoice rule about status updates to all document types.

If a follow-on document is missing, first determine whether preparation failed, a draft already exists, or the wrong source lines/company were selected. Do not open replacement documents until that is resolved.
