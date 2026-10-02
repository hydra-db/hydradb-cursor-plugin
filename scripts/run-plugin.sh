#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Normalize the plugin root/data across hosts. Cursor provides CURSOR_PLUGIN_ROOT.
# Fall back to the repo layout when a hook runs outside a host. plugin.mjs still
# reads CLAUDE_PLUGIN_ROOT/CLAUDE_PLUGIN_DATA, so map onto those.
PLUGIN_ROOT="${CURSOR_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}}"
export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
export CURSOR_PLUGIN_ROOT="$PLUGIN_ROOT"
if [[ -n "${CURSOR_PLUGIN_DATA:-}" && -z "${CLAUDE_PLUGIN_DATA:-}" ]]; then
  export CLAUDE_PLUGIN_DATA="$CURSOR_PLUGIN_DATA"
fi

# Cursor expects a flat { additional_context } hook output, not the nested
# hookSpecificOutput shape used by Claude Code and Codex.
export HYDRADB_HOOK_FORMAT="cursor"

NODE_BIN=""
if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
elif [[ -n "${NVM_BIN:-}" && -x "${NVM_BIN}/node" ]]; then
  NODE_BIN="${NVM_BIN}/node"
else
  for candidate in \
    "$HOME"/.nvm/versions/node/*/bin/node \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    /usr/bin/node
  do
    if [[ -x "$candidate" ]]; then
      NODE_BIN="$candidate"
      break
    fi
  done
fi

if [[ -z "$NODE_BIN" ]]; then
  echo "HydraDB plugin error: unable to locate a node executable for hook execution." >&2
  exit 127
fi

exec "$NODE_BIN" "${PLUGIN_ROOT}/scripts/plugin.mjs" "$@"
