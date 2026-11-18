# Authentication

Verified 2026-10-19 against [official authentication docs](https://prioritysoftware.github.io/restapi/authenticate/).

| Mode | Authorization |
| --- | --- |
| Basic | `Basic base64(API_USERNAME:PASSWORD)`; API username differs from normal login |
| PAT (19.1+) | `Basic base64(TOKEN:PAT)`; literal password `PAT` |
| OAuth2 / External ID | `Bearer ACCESS_TOKEN`; requires External ID module |

Basic username/password is unavailable with External ID enabled. Prefer PAT for unattended integration when supported by the deployment. The documented on-prem OAuth guide uses authorization code + PKCE, scope `openid rest_api`; do not transplant its endpoints to SaaS without checking deployment documentation.

Use existing secret storage or environment variables. Redact Authorization, passwords, tokens and application keys from diagnostics. Keep authentication server-side for the invoice app.

For license headers and API form access, read [operations.md](operations.md). A connection failure needs the actual HTTP status and sanitized response, not a password pasted into chat.
