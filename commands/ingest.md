---
name: ingest
description: Ingest the workspace's markdown context into HydraDB now. Use for an immediate sync instead of waiting for auto-sync.
---

Ingest the current workspace context files into HydraDB:

```bash
node "${CURSOR_PLUGIN_ROOT}/scripts/plugin.mjs" ingest --json $ARGUMENTS
```

Report:

- how many files were scanned
- how many were synced
- how many were skipped
- any errors

If the user asks why specific files were skipped, explain it from the JSON output and the current config. Remember that the ingest path may redact or skip sensitive-looking content before upload.

Also mention whether files were ingested as memory or knowledge, since that depends on `ingestionMode`.

