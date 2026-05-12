#!/usr/bin/env bash
# Install ebb-ai as an MCP server in OpenClaw.
#
# Assumes:
#   - This script is run from anywhere; it discovers the repo via its
#     own location.
#   - OpenClaw config lives at ~/.openclaw/mcp.json (XDG-style).
#   - The user has pnpm and node installed.
#
# Exits non-zero on any error.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
SERVER_ENTRY="${REPO_ROOT}/packages/mcp-server/dist/server.js"
OC_CONFIG_DIR="${HOME}/.openclaw"
OC_CONFIG_FILE="${OC_CONFIG_DIR}/mcp.json"

echo "[ebb-ai] repo: ${REPO_ROOT}"

if [ ! -f "${REPO_ROOT}/package.json" ]; then
  echo "[ebb-ai] FATAL: cannot locate repo root (expected package.json at ${REPO_ROOT})" >&2
  exit 1
fi

echo "[ebb-ai] installing workspace deps…"
(cd "${REPO_ROOT}" && pnpm install --frozen-lockfile)

echo "[ebb-ai] building MCP server…"
(cd "${REPO_ROOT}" && pnpm --filter @ebb-ai/core build)
(cd "${REPO_ROOT}" && pnpm --filter @ebb-ai/mcp build)

if [ ! -f "${SERVER_ENTRY}" ]; then
  echo "[ebb-ai] FATAL: server entry not found at ${SERVER_ENTRY}" >&2
  exit 1
fi

mkdir -p "${OC_CONFIG_DIR}"

if [ ! -f "${OC_CONFIG_FILE}" ]; then
  echo "[ebb-ai] creating new OpenClaw MCP config at ${OC_CONFIG_FILE}"
  cat > "${OC_CONFIG_FILE}" <<EOF
{
  "mcpServers": {
    "ebb-ai": {
      "command": "node",
      "args": ["${SERVER_ENTRY}"],
      "env": {
        "EBB_DEFAULT_REGION": "US-CAL-CISO"
      }
    }
  }
}
EOF
  echo "[ebb-ai] done. restart OpenClaw to pick up the new MCP server."
  exit 0
fi

# Merge into existing config. Use jq if available; otherwise warn.
if command -v jq >/dev/null 2>&1; then
  TMP="$(mktemp)"
  jq --arg cmd "node" --arg arg "${SERVER_ENTRY}" \
     '.mcpServers."ebb-ai" = { "command": $cmd, "args": [$arg], "env": { "EBB_DEFAULT_REGION": "US-CAL-CISO" } }' \
     "${OC_CONFIG_FILE}" > "${TMP}"
  mv "${TMP}" "${OC_CONFIG_FILE}"
  echo "[ebb-ai] merged into ${OC_CONFIG_FILE}. restart OpenClaw."
else
  echo "[ebb-ai] WARNING: jq not installed — cannot safely merge into existing ${OC_CONFIG_FILE}." >&2
  echo "[ebb-ai] Please add this block to mcpServers manually:" >&2
  cat >&2 <<EOF
    "ebb-ai": {
      "command": "node",
      "args": ["${SERVER_ENTRY}"],
      "env": {
        "EBB_DEFAULT_REGION": "US-CAL-CISO"
      }
    }
EOF
  exit 2
fi
