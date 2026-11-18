# Report design, exceptions and native tooling

Sources: [Report Generator](https://prioritysoftware.github.io/sdk/Reports), [Report Columns](https://prioritysoftware.github.io/sdk/Report-Columns), [Organizing Report Data](https://prioritysoftware.github.io/sdk/Organize-Report-Data), [BI Reports](https://prioritysoftware.github.io/sdk/BI-Reports), [Debug Tools](https://prioritysoftware.github.io/sdk/Debug-Tools).

## Build from a verifiable definition

Specify what one row represents, its key, input filters, output columns and independent tie-out. Calculate at the measure's natural grain. For example, sum header totals once per invoice; for line analysis use line amounts and an explicit policy for header discounts and charges. Never join details to another one-to-many set and sum repeated header values. Check counts and amounts before/after each join. A Distinct flag can be valid for an intentional unique list; it does not repair the wrong grain.

In native Priority, use **System Management > Generators > Reports** as documented. Copy the standard report for a customization and use the installation's custom prefix. Copying does not carry its procedure/menu/form links. Inspect input parameters, calculated columns, sort/group levels, subtotals and the actual calling procedure. For BI, trace data preparation, report and runner together; check refresh scope and timing. Do not assume the visible report is the only entity to change.

For a simple report, the SDK documents **WINDBI > Dump > Report** to inspect its query. For a report driven by a procedure, trace the procedure and its input/temp data. Do not replay a procedure with unknown effects to gather a trace. Verify the prepared output, permissions and performance under the intended user.

## Exception report

Specify trigger, threshold, exclusions, age window, expected owner and stable deduplication key. Examples: overdue unshipped order lines, negative stock by warehouse, or finalized invoice missing an expected downstream record. Include reason, source key, observed/expected value, delta and first relevant date. Distinguish absent evidence from a confirmed failure. Test one true exception, one valid exclusion, a boundary case and an already resolved item.
