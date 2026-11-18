# Scheduler and system diagnostics

Sources: [Tabula Task Scheduler v21](https://cdn.priority-software.com/docs/Pri_Scheduler21_E.pdf) and [Priority Debug Tools](https://prioritysoftware.github.io/sdk/Debug-Tools). Verify tools against deployment and build; the scheduler SOP distinguishes cloud and on-prem recorded input.

## Tabula Task Scheduler (TTS)

In **Define TTS Tasks** (System Management > System Maintenance > Tabula Task Scheduler), inspect active flag, entity/type, company plus extra companies, schedule and recorded input, max runtime and parallel execution. Compare intended run time against scheduler time; verify execution identity in the installation.

- **Never started:** check enabled state, calendar/frequency, environment and scheduler service availability; compare another task in the same environment.
- **Started but failed:** capture first program error, inputs, company and duration; compare the same operation in a controlled test with the same permissions.
- **Runs twice or overlaps:** inspect parallel execution, repeated schedules, multiple company assignments and external automation before changing settings.
- **After failure:** check scheduler logs and persisted results. Never trigger a second posting/import while the first outcome is unknown. For changes verify an actual subsequent run and its intended business result.

## Trace or performance issue

Capture time zone and timestamp, affected user/role, form/procedure, sanitized record identifier, steps, exact message, and comparison with a working case. Isolate whether the issue is permission, configuration, business validation, customization, environment or external caller.

The SDK documents **Run Entity (Advanced)** with `-trc` for forms/procedures; command formats differ between Web and Windows. **INTERFACE** accepts `-debug` with an output path. These tools execute the entity, so don't trace a write by casually replaying it in production. `DEBUGRESTRICTED` can block debug commands; use existing logs first, and scope any authorized diagnostic change and restore the prior setting. For slow custom forms/reports, use SDK optimization tools to verify joins and table access before changing indexes or infrastructure.
