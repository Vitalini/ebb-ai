# Compatibility shims for the old names

Ebb AI was renamed to Tidegap in 0.18.0. These packages keep the old install
commands working for one more release. Each one depends on the new package,
prints one deprecation line on stderr, and is never updated again.

| Package | Version | What it does |
|---|---|---|
| `npm/core` → `@ebb-ai/core` | 0.17.1 | Re-exports `@tidegap/core` and its `grid`, `energy`, `types` subpaths |
| `npm/cli` → `@ebb-ai/cli` | 0.17.2 | Bin `ebb` and the `dist/index.js` path that 0.17 daemon units pin; runs `@tidegap/cli` |
| `npm/mcp` → `@ebb-ai/mcp` | 0.17.1 | Bin `ebb-mcp` for `npx -y @ebb-ai/mcp`; starts the `@tidegap/mcp` server. Keeps `mcpName: io.github.Vitalini/ebb-ai` |
| `pypi/ebb-ai` → `ebb-ai` | 0.17.1 | `import ebb_ai` (and its submodules) resolves to `tidegap`; classifier `Development Status :: 7 - Inactive` |

The 0.17.1 version is a patch on the old line, so `^0.17.0` ranges in existing
manifests pick the shims up.

These directories sit outside the pnpm workspace and outside
`scripts/check-versions.mjs`; `pnpm build` and `pnpm test` never touch them.
Check them with `node --test compat/test/shims.test.mjs` after `pnpm build` (the test links
the workspace `@tidegap/*` packages into a temp `node_modules`).

Publish them only after `@tidegap/*` 0.18.0 and PyPI `tidegap` 0.18.0 are
live: see the Release and Deprecation Runbook in
`docs/plans/2026-10-16-1008-feat-rebrand-tidegap-plan.md` (steps 5 to 7).
