> ## Documentation Index
> Fetch the complete documentation index at: https://docs.hydradb.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Boolean Recall

> Perform a deterministic / full text search for exact matches within your indexed sources or memories

### Examples

#### API Request
```bash
curl --request POST \
  --url https://api.hydradb.com/recall/boolean_recall \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '{
  "query": "John Quotas AND Smith Quotas",
  "tenant_id": "tenant_1234",
  "sub_tenant_id": "sub_tenant_4567",
  "max_results": 25,
  "operator": "and"
}'
```

#### TypeScript
```ts
const results = await client.recall.booleanRecall({
  query: "John Smith Jake",
  tenantId: "tenant_1234",
  subTenantId: "sub_tenant_4567",
  maxResults: 25,
  operator: "and"
});
```

#### Python (Sync)
```python
# Async usage is similar, just use async_client and await
results = client.recall.boolean_recall(
    query="John Smith Jake",
    tenant_id="tenant_1234",
    sub_tenant_id="sub_tenant_4567",
    max_results=25,
    operator="and"
)
```

### Boolean Operators

#### OR Operator

* **Usage**: `"operator": "or"`
* **Behavior**: At least one search term must be present in the chunk for it to match
* **Best for**: Broad searches to find documents containing any of the specified terms
* **Example**: Searching for "python javascript react" with OR will return chunks containing any of these programming languages

#### AND Operator

* **Usage**: `"operator": "and"`
* **Behavior**: All search terms must be present in the chunk for it to match
* **Best for**: Precise searches where you need all keywords to be present
* **Example**: Searching for "machine learning algorithms" with AND will only return chunks containing "machine" AND "learning" AND "algorithms"

#### PHRASE Operator

* **Usage**: `"operator": "phrase"`
* **Behavior**: The exact phrase must appear in the chunk in the given word order
* **Best for**: Finding specific terminology or multi-word expressions
* **Example**: Searching for "mechanical engineer" with PHRASE will only return chunks where "mechanical engineer" appears as a contiguous phrase

### Optimization Tips

#### For Better Precision

* Use the **AND operator** when you need all terms to be present
* Use the **PHRASE operator** when word order matters (e.g. "machine learning" vs "learning machine")
* Use **specific terminology** rather than generic terms

#### For Broader Results

* Use the **OR operator** to find documents with any of the search terms
* Try **synonyms and related terms** to expand your search

### Response

Returns an array of relevant context

### Operator Parameter

The `operator` parameter controls how the search terms are combined:

* **OR operator** (default): At least one token must be present in the document
* **AND operator**: All tokens must be present in the document
* **PHRASE operator**: The exact phrase must appear as-is in the document

### Max Results Parameter

The `max_results` parameter controls the maximum number of results returned:

* Must be between 1 and 1000
* Defaults to the system limit if not specified

### Use Cases

* **Precise keyword matching**: Use AND operator when you need all search terms to be present
* **Broad search**: Use OR operator to find documents containing any of the search terms
* **Exact phrase matching**: Use PHRASE operator for finding specific multi-word expressions in your documents
