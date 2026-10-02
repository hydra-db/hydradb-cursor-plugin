---
name: last-recall
description: Show the most recent auto-recall payload. Use to debug whether recall ran, what HydraDB returned, or what was injected.
---

Inspect the last auto-recall payload recorded by the plugin:

```bash
node "${CURSOR_PLUGIN_ROOT}/scripts/plugin.mjs" last-recall --json
```

Summarize:

- whether auto-recall was skipped or executed
- the skip reason, if any
- how many memory and knowledge chunks were returned
- whether an `additionalContext` block was emitted
- any recall errors

If `additionalContext` is present, show the important parts of what would have been injected into Claude's context.
