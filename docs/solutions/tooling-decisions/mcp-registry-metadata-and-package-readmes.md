---
title: MCP Registry needs mcpName plus server.json (version-checked), and package READMEs must work from a published install
date: 2026-10-15
category: tooling-decisions
module: packages/mcp-server, packages/*/README.md, scripts/check-versions.mjs
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - "Publishing or releasing @ebb-ai/mcp to the MCP Registry"
  - "Editing a package README that npm or PyPI renders"
tags: [mcp-registry, server-json, readme, npm, pypi, release]
---

# MCP Registry metadata and package READMEs

## MCP Registry

Registry ownership of an npm package is proven by `mcpName` in `packages/mcp-server/package.json` (`io.github.Vitalini/ebb-ai`). It must equal `name` in `packages/mcp-server/server.json`. `server.json` carries its own version twice: top-level `version` and `packages[0].version`. Both must equal the release version.

`scripts/check-versions.mjs` checks both server.json fields (a missing `packages[0]` reports `(not found)`), so release prep fails loudly instead of publishing stale registry metadata. The release procedure itself is in [version-lockstep-check](version-lockstep-check.md); server.json is now one more file it covers. The npm package must be published before the registry entry, since the registry validates against npm.

## Package READMEs (npm, PyPI)

- Open with commands that work from a published install (`npx`, `pip install`), not from a repo checkout.
- Use absolute links (`https://github.com/Vitalini/ebb-ai/blob/main/...`). Relative links break on npm and PyPI.
- Never link a file that does not exist. PR #43 fixed dead links in the README head.
- Every number in the README needs a row in `docs/claims.md`, see [claims-audit-method](../best-practices/claims-audit-method.md).
