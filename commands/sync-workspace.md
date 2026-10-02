---
name: sync-workspace
description: Deprecated alias for /hydradb:ingest. Force a workspace sync of markdown-first workspace context into HydraDB. Prefer /hydradb:ingest; this still works.
---

Sync the current workspace context files into HydraDB:

```bash
node "${CURSOR_PLUGIN_ROOT}/scripts/plugin.mjs" ingest --json $ARGUMENTS
```

Report:

- how many files were scanned
- how many were synced
- how many were skipped
- any errors

If the user asks why specific files were skipped, explain it from the JSON output and the current config. Remember that the sync path may redact or skip sensitive-looking content before upload.

Also mention whether files were synced as memory or knowledge, since that depends on `ingestionMode`.
