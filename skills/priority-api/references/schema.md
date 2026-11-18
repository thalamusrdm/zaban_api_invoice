# Schema and paths

Source: [Requesting Data](https://prioritysoftware.github.io/restapi/request/), checked 2026-10-19.

| Need | Request relative to service root |
| --- | --- |
| Available entity sets | `GET /` |
| Priority version (22.0+) | `GET /GetPriorityVersion()` |
| OData version | `GET /GetODataVersion()` |
| Authenticated login | `GET /GetLoginName` |
| Full XML schema | `GET /$metadata` |
| One top-level form (25.0+) | `GET /GetMetadataFor(entity='CUSTOMERS')` |
| Single record | `GET /CUSTOMERS('001')` |
| Related rows | `GET /ORDERS('SO_EXAMPLE')/ORDERITEMS_SUBFORM` |
| Inline children | `GET /ORDERS('SO_EXAMPLE')?$expand=ORDERITEMS_SUBFORM` |

Scoped metadata on-prem requires BIN dated 2025-06-29 or later and application-server reinstallation. If unprepared, first request that form with `$top=1`; older installations use full metadata and the local slicing helper.

EntityType = form; Property = field; NavigationProperty = subform. Read Key/PropertyRef and EDM types. Collection navigations use arrays; singleton navigations use objects. Mandatory annotations arrive in 25.1. UI data privilege restrictions are not necessarily applied to REST reads; do not assume identical visibility.

Use [write.md](write.md) for composite keys. Business meaning and required update order need project evidence or a Priority implementer.
