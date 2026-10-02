# HydraDB Cursor Plugin

Persistent, cross-session memory for [Cursor](https://github.com/cursor/plugin-template),
powered by [HydraDB](https://hydradb.com).

It recalls relevant notes when you send a prompt, syncs your markdown docs into
HydraDB, and saves conversations as durable memories - the same behavior as the
HydraDB Claude Code plugin, on the same underlying engine (`scripts/plugin.mjs`).

## What's Cursor-specific here

- **Manifest:** `.cursor-plugin/plugin.json` (plus `.cursor-plugin/marketplace.json`).
- **Commands:** the user-typed slash commands live in `commands/*.md`. The
  model-invoked skills (`auto-recall`, `hydradb-context`) stay in `skills/`.
- **Hooks:** `hooks/hooks.json` (with `"version": 1`) uses Cursor's event names and
  relative paths:
  - `sessionStart` → inject status + sync docs (`session-start`, `session-sync-hook`)
  - `afterFileEdit` → incremental sync (`post-tool-use`)
  - `stop` → save the conversation (`stop`)
- **Hook output shape:** Cursor reads a flat `{ "additional_context": "..." }`, not
  Claude/Codex's nested `hookSpecificOutput`. The runner sets `HYDRADB_HOOK_FORMAT=cursor`
  so the shared engine emits the right shape.

Everything else (`scripts/`, config, API docs) is shared as-is.

## What differs from Claude/Codex (verified against Cursor's hooks docs)

- **No per-prompt auto-recall.** Cursor's `beforeSubmitPrompt` hook can only allow/block
  a prompt - it cannot inject text. Only `sessionStart` and `postToolUse` can inject
  context. So recall on Cursor happens at session start (initial context) and via the
  manual `/hydradb query` command; there is no per-message auto-recall like Claude/Codex.
- Capture (`stop`) and doc sync (`sessionStart`, `afterFileEdit`) work the same.
- Plugin-root variable: scripts use `CURSOR_PLUGIN_ROOT` (Cursor's convention).

## Prerequisites

- Node.js >= 18 and npm
- A HydraDB account (API key + tenant ID) - [hydradb.com](https://hydradb.com)
- Cursor

## Quick start

```bash
make bootstrap
export HYDRADB_API_KEY="your-api-key"
export HYDRADB_TENANT_ID="your-tenant-id"
```

Install via Cursor's plugin/marketplace flow pointing at this repo. Validate the
layout against the [Cursor plugin template](https://github.com/cursor/plugin-template).

## Configuration & usage

Config keys, environment overrides, and capture/search/ingest modes are identical
to the Claude Code plugin - see [docs/usage.md](docs/usage.md) and `config.example.json`.

## License

[Apache 2.0](LICENSE) - Copyright (c) 2026 HydraDB
