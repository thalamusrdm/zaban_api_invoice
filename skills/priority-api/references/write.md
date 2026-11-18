# Writes, files and batches

Source: [Modifying Data](https://prioritysoftware.github.io/restapi/modify/), checked 2026-10-19. Use JSON bodies.

| Operation | Pattern |
| --- | --- |
| Create | `POST /FORM` with one object |
| Update | `PATCH /FORM(key)` with changed fields |
| Delete | `DELETE /FORM(key)` |
| Child | `POST /FORM(key)/CHILD_SUBFORM` |
| Child update/delete | `/FORM(key)/CHILD_SUBFORM(childKey)` |
| Composite example | `/AINVOICES(IVNUM='T_EXAMPLE',IVTYPE='A',DEBIT='D')` |
| Deep insert | Parent object containing navigation array/object |

Use metadata keys, not read-only auto-unique IDs for writes. No PUT recipe.

Attachments (21.0+): POST attachment subform with `EXTFILEDES` and `EXTFILENAME: "data:application/pdf;base64,..."`; optional `SUFFIX: ".pdf"` (22.0+). MIME restrictions apply.

Text (20.0+): POST/PATCH text navigation with `{"TEXT":"<p dir='rtl'>שלום</p>","APPEND":true,"SIGNATURE":false}`. APPEND selects append/replace. Text-only forms require plaintext and no signature.

`POST /$batch`: maximum 100 operations on current versions; **no rollback**, including atomicity groups. Use `id`, `dependsOn`, `$1/CHILD_SUBFORM` references. Check every subresponse. Response matches request format from 22.1; older responses may be multipart.

Schema refresh (22.0+): `POST /ClearEntityMetadata` with `{"Entity":"ORDERS"}`; omit body only when clearing all is intended. Subforms refresh with parent.

Implementation advice: reconcile after uncertain writes; duplicate-checking alone does not prevent concurrent duplicate creation. Verify persisted results before reporting success.
