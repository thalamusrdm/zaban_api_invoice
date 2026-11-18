# Output: print, original, copies, signature and email

Sources: [Web SDK document examples](https://prioritysoftware.github.io/api/doc_examples/), [SDK WINHTML document output](https://prioritysoftware.github.io/sdk/WINHTML), [Web SDK procedure steps](https://prioritysoftware.github.io/api/procedure/).

| User intent | Operation and evidence |
| --- | --- |
| Download an existing original | Retrieve the saved attachment or stored bytes associated with the correct final document. Report absent or ambiguous files. Retrieval must not start printing or sending. |
| Generate an original without email | Verify a supported native e-document path, prerequisites, final status and original availability. Store and return the exact generated file; use the same file for later downloads. |
| Copy or reprint | Use the applicable copy action/template. Label the result according to its actual type; a PDF or a template title alone proves neither originality nor signature. |
| Customer signs a copy | Keep it as a distinct artifact, with linkage to the source copy and audit information. Never modify the original bytes. |
| Email a document | Verify the exact recipient and document. Native mail acceptance, a queued message and confirmed delivery are distinct results. Verify the relevant state and do not send again after an ambiguous outcome without reconciliation. |

A signed PDF and a Priority e-document are distinct outputs in the SDK. Track output type, byte retrieval, native registration/attachment and mail separately. A client-step print hint or a PDF signature marker is not proof that a valid original exists. Never reset a native printed flag, fabricate print acknowledgment or quietly substitute a copy.

Verify actual installed SDK steps and options. Some printing and mail actions change ERP state. Treat read-only download, original generation, email and signature attachment as separate permissions and operations.
