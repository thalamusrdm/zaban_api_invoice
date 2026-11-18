---
name: priority-ops
description: Diagnose and configure Priority ERP from inside the system, including user privileges, company settings, fiscal periods, document numbering, BPM, Tabula Task Scheduler, and internal SDK customizations. Use for advanced Priority administration or implementation (ניהול מערכת, הרשאות, קבועים, מספור, תקופות, חוקים עסקיים, טריגרים). Use priority-api for ordinary REST/OData and external Web SDK calls.
---

# Priority operations

Start with the actual task. Load only the relevant reference; read the linked vendor section when the version, screen path, module or behavior is uncertain.

| Task | Reference |
| --- | --- |
| Users, group leaders, company access, form/field/data privileges | [access](references/access.md) |
| Company settings, system/financial constants, fiscal periods, invoice numbering | [settings and finance](references/settings-finance.md) |
| Status transitions, business rules, defaults, approvals | [BPM](references/bpm.md) |
| Internal SDK, generators, triggers, interfaces, revisions | [customization](references/customization.md) |
| Scheduler, service/run failures, traces and performance | [diagnostics](references/diagnostics.md) |

1. Establish company/environment, version/build, Web or Windows client, deployment, affected user, entity or program, and exact symptom. Reuse available evidence. Distinguish what is observed, documented, and inferred.
2. Locate the setting by verified screen title or internal name; label translated names as search terms if unverified. Confirm its scope and existing value before changing it. A test company may still share installation-level settings with production.
3. For a change, give the precise target, previous and proposed values, expected effect, verification, and recovery method. Reproduce with the affected role in a safe environment when practical. Treat changes to posted documents, fiscal periods, number sequences, privileged access and shared rules as potentially consequential.
4. Execute only within the authorized scope. If production state after a failure is uncertain, inspect before retrying. Verify with the affected user and report actual outcomes. Creating or invoking this skill is not authorization to mutate ERP state.

Use the installed `priority-api` skill when the boundary is REST exposure, credentials, metadata, OData, or running an existing action through the external Web SDK. This skill covers defining and diagnosing the behavior inside Priority. Answer in the user's language.
