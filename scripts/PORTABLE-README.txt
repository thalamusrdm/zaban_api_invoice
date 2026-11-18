Zaban Invoice - complete portable deployment (Windows x64)
=========================================================
Read START-HERE.he.md for detailed Hebrew instructions.

1. Stop the old invoice server and back up its entire folder.
2. Extract ALL ZIP files into a NEW folder. Do not run inside the ZIP.
3. For an existing server, copy its .env AND entire data folder into the
   new folder before starting. Preserve server settings over bundled settings.
4. Run start-server.bat and keep its CMD window open.
5. Open http://localhost:18473/?agent=90 on the server, or use SERVER-IP
   from the agent's phone/tablet. Change agent=90 to the agent's number.

Node.js and all production dependencies are bundled. No installer, npm,
service registration or PATH changes are needed on the destination server.
The server needs its existing network access to Priority, rates and mail.

DATA: This release does not include source-machine data or live invoices.
Always retain the destination server's entire data folder. It holds original
PDFs and operation records that prevent duplicate generation and email.
Never run two independent data stores for the same invoice operations.
Keep the old application folder for rollback.

CONFIG: Configured bundles contain .env with private connection credentials.
Keep the ZIP private. Unconfigured bundles have .env.example instead.
For a new server, review the bundled settings before starting.

CURRENT FLOW: Issue and close -> save original in Priority -> optional email
-> customer signs a copy -> saved signature confirmation.
The original PDF is NEVER downloaded automatically. Download it only by
clicking the explicit original-download button at the end or in invoice actions.

CONTENTS: application and public assets, Hebrew font, locked dependencies,
Node runtime and license, tests, scripts, Priority procedures and n8n workflows.
PACKAGE-SHA256.txt lists file hashes; build-info.json records build metadata.
