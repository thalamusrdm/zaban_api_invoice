# Users and privileges

Source: [Priority Users and Privileges, Web v23.0](https://cdn.priority-software.com/docs/SOP_Users_Permissions_23_0_web_E.pdf). Confirm labels and permissions in the installed version.

Diagnose with the target user and company. Separate sign-in/licensing, company access, entity access, read/write, field restrictions, data authorization and procedure execution. An administrator's successful test does not prove the end user's access.

| Symptom | First inspection |
| --- | --- |
| Can't sign in | Active User, license/seat, identity provider or authentication method |
| Works in another company | Compare effective privileges and the active company |
| Form opens but a field is locked | Form/field privileges, document status, triggers and workflow |
| Form opens but some records are absent | Data authorization, form filters and active company; compare a known record |
| Permission differs between menus | Check all menu occurrences. The Web SOP says the less restrictive privilege applies if the same entity occurs in multiple menus |
| UI works but OData fails | API identity/license, Limited Access/API Forms, field privileges and correct company; use priority-api for HTTP specifics |

Use **User Permissions** and **Privilege Explorer** to identify whether a user inherits from a group leader. Before altering that leader, check which other users would be affected. Prefer the smallest scoped grant; keep a record of the previous value and verify both an allowed operation and an operation that should remain denied.

Useful report names to search: **Discreps in User Privilege Tree**, **Compare Privileges Btw Companies**, **Compare User Priv Btw Companies**. Reports are under **System Management > System Maintenance > Privileges > Reports on Privileges** in the referenced Web SOP. Data Authorization is a separate topic in Priority Xpert. Do not assume UI data restrictions carry over to every integration channel.
