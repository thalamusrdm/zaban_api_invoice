# Status flows, business rules and defaults

Sources: [Priority BPM distribution SOP v21.0](https://cdn.priority-software.com/docs/SOP_BPMDistribution_E_21_0.pdf), [BPM for a new custom document](https://prioritysoftware.github.io/sdk/Create-BPM.html), and [Executing the Form Load](https://prioritysoftware.github.io/sdk/Execute-FormLoads).

Choose the layer by the desired behavior:

| Need | Inspect first |
| --- | --- |
| Control which status can follow another, who gets a task, or approval path | Form's BPM flow chart and status rules |
| Warn, block, or notify based on a field condition | Business Rules Generator |
| Fill or derive a value during entry | Data Generator and field triggers |
| Post, close, print, issue or cancel a document | Document's supported action/procedure and its business effects |
| Create BPM for a new custom entity | Internal SDK BPM guide; this is development, not merely editing a chart |

Capture source status, target status, company, form, user, triggering action, condition and expected side effects. Reproduce the permitted case, a denied case and a case that should not trigger a notification. Avoid sending test mail to real recipients. When copying rules, inspect selected source rules and each target company; the distribution SOP describes an add-on, so verify availability.

**Import trap:** the SDK's INTERFACE `-enforcebpm` flag enables Business Rules Generator and BPM checks. Without it, those checks and permitted paths can be bypassed even when mail is sent. Data Generator rules are evaluated separately. Confirm actual interface flags and test the real import path; a UI test alone cannot prove it behaves the same.

Never use a direct status update to replace a document action with financial or inventory consequences. When an action fails, check the business error and prerequisites before changing BPM.
