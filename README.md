# HydraDB Cursor Plugin

Persistent, cross-session memory for [Cursor](https://github.com/cursor/plugin-template),
powered by [HydraDB](https://hydradb.com).

It recalls relevant notes when you send a prompt, syncs your markdown docs into
HydraDB, and saves conversations as durable memories - the same behavior as the
HydraDB Claude Code plugin, on the same underlying engine (`scripts/plugin.mjs`).

## Prerequisites

- Node.js >= 18 and npm
- A HydraDB account (API key + tenant ID) - [hydradb.com](https://hydradb.com)
- Cursor

## Quick start

```bash
make bootstrap
export HYDRADB_API_KEY="your-api-key"
export HYDRADB_DATABASE="your-tenant-id"
```

Install via Cursor's plugin/marketplace flow pointing at this repo. Validate the
layout against the [Cursor plugin template](https://github.com/cursor/plugin-template).

## Configuration & usage

Config keys, environment overrides, and capture/search/ingest modes are identical
to the Claude Code plugin - see [docs/usage.md](docs/usage.md) and `config.example.json`.

## License

[Apache 2.0](LICENSE) - Copyright (c) 2026 HydraDB
