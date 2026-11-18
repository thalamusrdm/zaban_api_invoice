# Query recipes

Source: [Querying Data](https://prioritysoftware.github.io/restapi/query/), checked 2026-10-19.

```http
GET /CUSTOMERS?$select=CUSTNAME,CUSTDES&$filter=CUSTNAME eq '001'&$top=1
GET /CUSTOMERS?$select=CUSTNAME,CUSTDES&$orderby=CUSTNAME asc&$top=100&$skip=0
GET /CUSTOMERS?$filter=contains(CUSTDES,'example')&$top=10
GET /ORDERS?$since=2026-10-01T00:00:00Z&$expand=ORDERITEMS_SUBFORM
```

Operators: `eq ne gt ge lt le`, `and or`, parentheses. Current docs support `contains`, `startswith`, `endswith`, nested `tolower`; `substringof` is unsupported. Installation differences: see [zaban.md](zaban.md).

`$since` (20.0+) requires BPM forms; it is not a universal change feed. Supported lookup forms can use `UDATE` filtering with 25.0 plus required updates; verify the field first. Prefer UTC checkpoints.

Construction advice: escape apostrophes by doubling them inside OData string literals; then URL-encode query values once. Encode timezone `+` as `%2B`. Preserve numeric-looking string keys such as leading-zero customer IDs.

Pagination algorithm: select only required fields, use stable ordering including all key fields, increment skip by actual rows received, stop on empty page. A short page may reflect a server cap. Concurrent changes can shift offset pages; reconcile overlaps/deduplicate for synchronization. Persist checkpoints only after successful processing. See [operations.md](operations.md) for result limits.
