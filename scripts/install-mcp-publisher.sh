#!/usr/bin/env bash
# Install a checksum-verified mcp-publisher into the current directory.
# Used by release.yml (verify) and mcp-registry.yml from packages/mcp-server.
#
# To bump: change VERSION and SHA256 to the values in the release's
# registry_<version>_checksums.txt for mcp-publisher_linux_amd64.tar.gz.
set -euo pipefail

VERSION="v1.8.1"
SHA256="a06c9096dcb9727c13555b6be26c7effa707b01f06a4c561ba7a3635443cf2cc"
ASSET="mcp-publisher_linux_amd64.tar.gz"

if [ "$(uname -s)" != "Linux" ] || [ "$(uname -m)" != "x86_64" ]; then
  echo "install-mcp-publisher: only linux/amd64 is pinned, not $(uname -s)/$(uname -m)" >&2
  exit 1
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

curl -fsSL -o "$TMP/$ASSET" \
  "https://github.com/modelcontextprotocol/registry/releases/download/${VERSION}/${ASSET}"
echo "${SHA256}  $TMP/$ASSET" | sha256sum -c -
tar -xzf "$TMP/$ASSET" -C "$TMP" mcp-publisher
mv "$TMP/mcp-publisher" ./mcp-publisher
chmod +x ./mcp-publisher
