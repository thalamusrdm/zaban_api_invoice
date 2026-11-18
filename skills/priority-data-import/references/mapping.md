# Mapping customers, parts and price lists

Use one mapping per target entity: source column, target form/subform and field, data type/length, key role, transform, blank policy, reference lookup, and write policy. Identify the installed interface or use metadata plus a read-only sample. Schema alone does not establish business rules or permission. See [Priority metadata](https://prioritysoftware.github.io/restapi/request/).

| Entity | Identify | Validate before load |
| --- | --- | --- |
| Customers | `CUSTOMERS` with customer code `CUSTNAME` in the vendor example and Zaban. If Priority assigns codes, persist a reliable source-to-ERP mapping. | Name, address/contacts, country, status and financial defaults as needed. Tax IDs and names are possible duplicate signals, not universal unique keys. Separate customer master fields from contact rows and financial settings. |
| Parts | `LOGPART` with part code `PARTNAME` in the vendor example and Zaban. | Description, base/sale units, family, status and inventory flags as applicable. Barcode or description is a review signal unless the installation enforces it as a key. Check whether a unit or inventory-control change is allowed for existing stock. |
| Customer price lists | Separate the list header, dated version, item rows and customer assignments. Verify actual keys at each level. | Part exists; currency, price, unit and quantity break are explicit. Compare dates and overlapping tiers. The same part in different versions or quantity breaks is not automatically a duplicate. Decide whether to add a version, amend one, or only link customers. |

## Price list traps

The [Customer Price Lists SOP](https://cdn.priority-software.com/docs/SOP_CustPrice23_0_E.pdf) distinguishes the **Base** list (linked to catalogue list prices in the documented cases), **Price List Dates**, **Part Prices**, and **Customer Price Lists** assignments. A copied version's effective date does not by itself activate it in the documented flow. Verify activation independently from import. Among assigned lists, smaller priority numbers have higher priority; confirm the full price hierarchy for the actual sale.

Load prerequisites first: reference codes, customers/parts, then list header/version, price rows, and finally assignments or activation if requested. Verify representative effective prices in a test sales line with the intended customer, date, unit, currency and quantity, including just below/at a tier boundary. Check one unaffected customer or version.

In zaban_invoice, inspect current `server.js` for read paths and custom fields such as `EDEA_PARTTYPE`. The existing customer-edit whitelist and product lookup are not bulk import mappings. No write interface for these three entities was verified live when this skill was created.
