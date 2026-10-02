> ## Documentation Index
> Fetch the complete documentation index at: https://docs.hydradb.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Memory Recall

> Hybrid search over user memories only. Use this when you need context from stored user preferences, conversations, or behavioral memories.

### When to use it

Use **recall preferences** when you want to search over **user memories** (preferences, conversations, inferred traits). Same request body as [full recall](/api-reference/endpoint/full-recall) (sources); the endpoint you call determines the search target.

### Examples

#### API Request
```bash
curl -X 'POST' \
'https://api.hydradb.com/recall/recall_preferences' \
-H 'accept: application/json' \
-H 'Content-Type: application/json' \
-d '{
"tenant_id": "string",
"sub_tenant_id": "string",
"query": "string",
"mode": "fast",
"max_results": 10,
"additional_context": "string"
}'
```

#### TypeScript
```ts
const results = await client.recall.recallPreferences({
  query: "Which mode does user prefer",
  tenantId: "tenant_1234",
  subTenantId: "sub_tenant_4567",
  alpha: 0.8,
  recencyBias: 0
});
```

#### Python (Sync)
```python
# Async usage is similar, just use async_client and await
results = client.recall.recall_preferences(
    query="Which mode does user prefer",
    tenant_id="tenant_1234",
    sub_tenant_id="sub_tenant_4567",
    alpha=0.8,
    recency_bias=0
)
```

> **Default Sub-Tenant Behavior**: If you don't specify a `sub_tenant_id`, the search will be performed within the default sub-tenant created when your tenant was set up.

## Optional Parameters

### Alpha

Controls the balance between semantic and keyword search (0.0-1.0 or `"auto"`). Default `0.8` is recommended for most use cases.

### Recency Bias

Controls how much recent content is prioritized (0.0 = no bias, 1.0 = strong recency preference).

### Max Results

Range 1-1001; default 10. Start with 10-20 for most use cases.

## Response

Same as full recall: `RetrievalResult` with `chunks` and `graph_context` (e.g. `chunk_relations`, `query_paths`).
