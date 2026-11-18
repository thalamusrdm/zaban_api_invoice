---
name: priority-data-import
description: Prepare and reconcile Priority ERP imports of customers, items and customer price lists. Use for Excel or CSV mapping, pilot loads, duplicate keys, create versus update, and retrying rejected rows (ייבוא לקוחות, מק״טים, מחירונים, בדיקת מדגם, כפילויות). Use priority-api for API mechanics and priority-ops for administration.
---

# Priority data import

Read [mapping](references/mapping.md) for the relevant entity, then only the applicable operational reference:

| Need | Reference |
| --- | --- |
| File validation, exact-key duplicates, compare with an ERP extract | [Preflight](references/preflight.md) |
| Sample, native interface or REST, rollout, recovery | [Execution](references/execution.md) |

1. Identify the target company, environment, import path, and explicit create/update policy. Export relevant existing keys and current values. Verify form, parent/subform, required and writable fields, references, and the installed key. Preserve raw IDs, leading zeros and row identity.
2. Prepare a mapping and a read-only reconciliation: missing/invalid keys, duplicate input, ambiguous target matches, no-change, proposed creates, and proposed updates with old/new values. No-match requires a complete, correctly scoped lookup; a partial export does not establish absence. Block conflicting groups. Blank, zero and explicit clear are different instructions.
3. Build a small representative sample and expected results. Test with the real import route in a verified test environment when execution is requested. Review the readback and business effects before scaling. Do not treat a clean file check as a successful ERP pilot.
4. Save outcomes by source row and business key. After a timeout or mixed result, reconcile the target before retrying. Requeue only rows verified as missing or rejected and safe to retry.

For a request to prepare or review, produce artifacts and a proposed load without writing to Priority. Perform ERP writes only within the requested and verified scope. Answer in the user's language.
