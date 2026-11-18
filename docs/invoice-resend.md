# Recent invoice actions and explicit email resend

Both agent and customer recent-invoice lists expose the existing signed-copy viewer, signing flow, copy download and existing-original download. Final invoices also expose an explicit resend dialog. Agent results include `canManageDocuments`, derived on the server from the existing API-owner restriction; this does not grant additional access to invoices belonging to another Priority user.

`GET /api/invoices/resend-options?ivnum=IN...` reads the invoice's customer and current customer email, independently of any customer selected in the invoice form. It never sends mail or updates the customer. The recipient can be changed for this send without changing the customer card.

`POST /api/invoices/resend-original` requires `ivnum`, a validated single `email`, `consent: true` and a UUID `requestId`. It reads exactly the original attachment used by the existing-original download endpoint. Missing, ambiguous or invalid original attachments block sending; this path never generates, prints or replaces an original.

Each intentional resend has a distinct workflow key, passed through the existing SMTP/n8n transport. The persisted delivery store binds the request to the internal invoice, customer and recipient. Concurrent requests and retries, including after a process restart, reuse that intent. An uncertain send is blocked rather than automatically repeated. The browser saves pending intent in session storage before sending; refreshing the page retains the same recipient and request ID. A new deliberate resend requires reopening and confirming after the previous attempt was confirmed.

Keep the server's existing `data/delivery` directory when deploying updates. A mail-server acceptance is not proof of delivery to the customer's mailbox. Automated tests use fake mail transports; development does not send live customer mail.
