# Deployment, versions and errors

Source: [REST overview](https://prioritysoftware.github.io/restapi/), checked 2026-10-19.

- Obtain service root from installation configuration / Send Program Activation Link; do not guess host, ini or company.
- Administrator exposes parent forms through Limited Access/API Forms; subforms follow. App licensing uses `X-App-Id`, `X-App-Key`; generic licensing omits these.
- Paths/fields are case-sensitive. Dates use DateTimeOffset; company/server timezone settings affect offsets. Decimals use a period.
- 25.1 uses `MAXAPILINES` (default 2,000); earlier versions use `MAXFORMLINES`. Responses cap at 350 MB.
- Cloud fair use lists 100 calls/minute/user, 10 processing + 5 queued, three-minute timeout; also a 5,000/300s sliding-window limit. Treat all as constraints, not interchangeable quotas; recheck current policy when sizing throughput.
- Errors became JSON in 19.1. Preserve sanitized status/body; older servers may return XML.

Diagnostic advice:

| Symptom | Investigate |
| --- | --- |
| 401 | auth mode, API identity, token validity |
| Permission/form error | API exposure, license, user/field permissions |
| 400/409 | exact keys, types, duplicates, business validation |
| 404 | case, company, form/key, removed forms |
| 429 | bounded backoff with jitter, Retry-After when present |
| Timeout/5xx | network and server state; reconcile mutations before retry |
| Missing custom field | schema refresh in write.md |

Use bounded retries for safe reads. Financial write recovery must verify whether data already persisted.

For version-specific removals/changes open [release notes](https://prioritysoftware.github.io/restapi/releasenotes/). Do not run live test writes merely to check this skill.
