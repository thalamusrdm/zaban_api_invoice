# Pilot, execution and recovery

References: [Priority Interfaces](https://prioritysoftware.github.io/sdk/Interfaces), [Form Loads](https://prioritysoftware.github.io/sdk/Form-Loads), [Executing the Form Load](https://prioritysoftware.github.io/sdk/Execute-FormLoads).

## Pick the route

- Prefer an installed, verified form interface for repeatable bulk loads. DBLOAD can stage flat files; INTERFACE maps to forms and applies their triggers. Verify the interface's insert/update matching, required format, and parent/child behavior. Do not write directly to production tables.
- For a small supported REST import, use explicit create or update by verified key and persist per-row outcomes. Do not infer an upsert or assume `$batch` rolls back changes. Use priority-api for syntax, limitations and metadata.
- Verify warning policy and the `-enforcebpm` behavior where relevant. Do not add an ignore-warnings switch merely to make the sample pass.

## Sample gate

Choose a small set covering a normal new row, an allowed update, an unchanged repeat, a conflicting duplicate, a missing reference, and data edges (leading zero/Hebrew or price tiers/versions). Keep intentional failures out of production. Before running, list the expected action and readback per sample row. Use the actual interface, company and effective role in a test environment.

Read back keys and changed fields, verify skipped rows did not mutate, check one unrelated record, and confirm downstream defaults or effective price. Run the same input again in test where replay is part of the workflow; expect no additional creates and only the approved changes. Scale in bounded batches only after the gate passes.

## Recover

Track run ID, source row, target key, operation, before/after values, result and exact error. Reconcile counts for created, updated, unchanged/skipped, rejected and uncertain. Stop on wrong company, mismatched mapping, unexpected updates or unresolved commit state.

For native loads preserve the same load data and its `LOADED` state; `Reload`/`-repeat` targets rows not marked Y. Read Load Errors (`INTERFACEERR`), or the configured alternate error sink. Verify current target state before reattempting even a reported failure. For REST, build a retry set from reconciled keys; never resubmit a whole partially successful file blindly. Recovery depends on pre-change values and approved reversal/update steps, not a presumed rollback.
