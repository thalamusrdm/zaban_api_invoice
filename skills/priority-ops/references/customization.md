# Internal development and revisions

Start with the supported configuration layer. If code is required, identify the internal entity, company prefix, target build, dependencies, and the exact moment at which the behavior must run.

| Work | Vendor reference |
| --- | --- |
| Form columns, base table, subforms | [Form Generator](https://prioritysoftware.github.io/sdk/Forms) |
| Field vs row vs form triggers | [Form Triggers](https://prioritysoftware.github.io/sdk/Form-Triggers), [creating triggers](https://prioritysoftware.github.io/sdk/Creating-your-Triggers.html) |
| Procedures, inputs, actions | [Procedures](https://prioritysoftware.github.io/sdk/Procedures), [Actions](https://prioritysoftware.github.io/sdk/Actions) |
| Data imports and staging | [Interfaces](https://prioritysoftware.github.io/sdk/Interfaces), [Form Loads](https://prioritysoftware.github.io/sdk/Form-Loads) |
| IDE and tooling | [Priority Dev Tools](https://prioritysoftware.github.io/sdk/VSCode-Extension) |
| Upgrade and transport | [Customization Rules](https://prioritysoftware.github.io/sdk/Customization-Rules), [Installing Customizations](https://prioritysoftware.github.io/sdk/Installing-Customizations) |

- Reuse the installation's four-letter customization prefix. For a change to a standard procedure, the SDK calls for a custom copy. Verify linked reports, parameters and Actions. For a trigger choose field, row or form scope by lifecycle; avoid an interface re-entering the trigger that invokes it.
- Route writes to standard data through supported forms, procedures or form interfaces. Direct SQL writes bypass validations and triggers. DBLOAD can stage data; INTERFACE applies the form behavior. Check warning/BPM handling in [BPM](bpm.md).
- Package a revision with dependencies before dependents (for example, an interface before the procedure that uses it). Test on a compatible build and check the target has the prerequisite modules. Include revert/recovery steps appropriate to schema and data effects; a reverse revision does not necessarily undo business data changes.
- Before rollout, exercise the actual route and user: insert/update, blocked input, and any affected subform or report. Compare pre/post results and performance on representative data. When an exposed custom field changes, verify Priority API metadata separately.
