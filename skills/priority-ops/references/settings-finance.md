# Constants, fiscal periods and document numbering

Vendor references: [Managing Fiscal Periods, v22.1](https://cdn.priority-software.com/docs/SOP_FiscalPeriods22_1_E.pdf) and [Create Document Numeration Templates, v23.0](https://cdn.priority-software.com/docs/SOP_Numeration_Templates_23_0_E.pdf). This is a configuration diagnostic; finance decides whether a period or number sequence should change.

## Constants and scope

Resolve exact setting name and where its value is stored. Search **System Constants** or **Financial Constants** as appropriate; verify scope before editing, including whether a test company shares it. Record current value, affected companies, module, dependency, restart or cache requirement if documented, and restore procedure. Do not assume a default is the installed value. Compare a known working company or version without copying its settings wholesale.

## Invoice draft exists but closing fails

1. Verify company, document type, branch, draft status, transaction and reference dates, intended action and exact message. Check whether the action is available to the affected user.
2. In **Define Fiscal Years > Fiscal Periods**, inspect the matching period and distinct transaction/reference date closure flags. The SOP documents **Open Fiscal Period** and **Close Fiscal Period**; check input range and any multi-company selection. A closed period can be an intentional control. Don't move the document date to bypass it.
3. For numbering errors inspect **Document Numeration Templates** by relevant year, document type and branch. Determine calendar versus fiscal year; the cited SOP documents `DocumentNumeration=1` for fiscal-year numbering. Do not change that constant as a workaround. Compare existing series and preview before proposing **Open Numeration Templates**. A template already in use and a missing template require different handling.
4. Retry only after addressing the verified cause. Re-read the document, final number and resulting postings where relevant. If the response timed out, reconcile before attempting to close again.

For zaban_invoice, prior tests documented separate fiscal-period and numbering failures in an old test company. This is a diagnostic lead, not current state; check the project's README and the selected company. Draft creation, closing and output are separate operations.
