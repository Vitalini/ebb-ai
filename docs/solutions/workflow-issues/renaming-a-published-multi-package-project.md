---
title: Renaming a published multi-package project without breaking installed users
date: 2026-10-16
category: workflow-issues
module: packages (all), compat/, scripts, CI
problem_type: workflow_issue
component: tooling
severity: high
applies_when:
  - "Renaming a project that is already published on npm, PyPI, a plugin hub and the MCP Registry, with users holding state on disk"
  - "Planning a rename PR, its commit order, its compat layer, or the leftover-name check"
root_cause: inadequate_documentation
resolution_type: documentation_update
tags: [rename, rebrand, migration, compat-shims, deprecation, home-directory, env-vars]
---

# Renaming a published multi-package project without breaking installed users

## Context

Ebb AI became Tidegap in 0.18.0 (PR #51, plan `docs/plans/2026-10-16-1008-feat-rebrand-tidegap-plan.md`). The name appeared in 255 files and about 2,700 places, and outside the repo too: npm, PyPI, ClawHub, the MCP Registry, the Claude Code marketplace, GitHub and Vercel. Users had a SQLite ledger, a signing key, config and a daemon unit under the old names. The rules below are what made the rename safe. Why the name changed: `docs/solutions/tooling-decisions/choosing-a-project-name-and-trademark-clearance.md`.

## Guidance

**1. Inventory by token, not by file.** Count hits per token kind, so each kind gets an owner. Search `git ls-files`, minus images and minus history (CHANGELOG, `docs/solutions/`, `docs/plans/`, `docs/archive/`). Kinds here: `EBB_` env vars, `@ebb-ai/` scope, `.ebb-ai` paths, `/ebb-ai:` plugin commands, `ebb_ai` Python import, repo slug, domain, ClawHub id, unit labels, MCP Registry id. A repo grep finds only repo hits. List the external places separately (registries, hosts, DNS).

**2. Commit order keeps every commit green.**
1. Packages and identifiers (carries the import and test renames the package rename forces).
2. Paths, env fallback and daemon migration.
3. Plugin, MCP and host identities.
4. Site and images.
5. Docs.
6. Compat shims (after docs, so their READMEs link final docs).
7. Release prep (last; `pnpm check:versions` sees the final tree).
Review fixes go before the release commit. If one lands after it, move the release commit back to the tip with a scripted rebase.

**3. Bin alias: extra bin entries, same file.** `@tidegap/cli` bins `tidegap` and `ebb` both point at `./dist/index.js`. `npx` accepts several bins only when they point at one file. The program reads the basename of `process.argv[1]` and prints one deprecation line to stderr for the alias (`packages/cli/src/index.ts`). On Windows the npm cmd shim passes the real path, so no line prints there; accepted.

**4. Env vars: new name wins, old name is a fallback.** Each host boundary reads `TIDEGAP_<NAME>` first, then `EBB_<NAME>`, and collects the fallen-back names for one stderr line per process (`Fallbacks.pick` in `packages/cli/src/env.ts`; the MCP server has its own copy; stderr only, stdout is the protocol channel). Keep the library environment-pure: only hosts read env.

**5. Config-file keys follow the same rule.** `EBB_*` keys inside the config file are folded into `TIDEGAP_*`; an `EBB_<NAME>` key is kept only when `TIDEGAP_<NAME>` is absent (`budget.ts`, `quota.ts`, Python `budget.py`). Exported option types gain the new fields and keep the old ones marked deprecated.

**6. Home-dir migration: decide by the state of the OLD dir.** Another 0.18 code path (the log dir) may create `~/.tidegap` first, so "does the new dir exist" is the wrong test. Implemented in `packages/core-ts/src/paths.ts` and mirrored in `packages/core-py/src/tidegap/paths.py`. Rules:
- Old dir absent: use the new one. Old dir is a link to the new one: use the new one.
- Old dir is a real dir and the new one is absent: `rename`, then link the old path to the new one. A 0.17 daemon unit pins `--db ~/.ebb-ai/queue.db` and SQLite refuses writes when the open path stops resolving to the same file, so the move and the link must succeed or fail together.
- Both exist, new one holds no `queue.db` or `signing.key`: merge entry by entry, remove the emptied old dirs, link. A file in both stops the move.
- Both hold a `queue.db` or `signing.key`: change nothing, use the new dir, one line naming both paths.
- Follow a user's own link: if the old path is a link to somewhere else (another disk), use it in place with one line. Use the new dir only if it already holds data.
- Windows: the link is a directory junction (no privilege needed). Detect junctions as links, in both cores. Python `Path.is_junction` is 3.12+, so it needs its own check.
- Rollback is best effort: a failed `mkdir` or `rename` during undo must not throw out of the resolver. Say what is left in one line.
- Concurrent first runs: a lost race (`ENOENT`, `EEXIST`, `ENOTEMPTY`) re-checks the state, up to 3 attempts. Any other rename error uses the old dir in place with one line.
- Never copy (two ledgers diverge once a 0.17 process writes). Never delete except the emptied old dir. An explicit path (`--db`, an env path, plugin `dbPath`) bypasses the resolver.
- Test hermetically: point `HOME` and `USERPROFILE` at a temp dir in a global setup (`packages/cli/test/hermetic-home.ts`, Python `conftest.py`), or a test migrates the developer's real home. Inject the filesystem calls for failure cases. Test concurrency with real spawned processes (`test_concurrent_first_runs_agree_and_keep_data`).

**7. Secrets file: read the old one, do not move it.** `tick` reads the new path, else the old one. `install` copies old to new (mode 0600). The old systemd unit still references the old path.

**8. Daemon units: detect, never remove.** Status reports `installed` when the new or the legacy label exists (`packages/cli/src/platform/index.ts`). `install` writes the new unit and prints the exact unload and remove commands for the old one; it never runs them (keeps the existing contract). A double tick is safe because task claims are compare-and-set. Warn when the new daemon would pin a script inside the deprecated package (`resolveLauncher`), because that unit dies on `npm uninstall`.

**9. Compat shims keep the old daemon path alive.** An old unit runs `node .../@ebb-ai/cli/dist/index.js`, not the bin. The `@ebb-ai/cli@0.17.1` shim therefore keeps an entry at `dist/index.js`. It prints one line, sets `argv[1]` to the new entry so the new program does not print its own alias line, then imports it. Shims live in `compat/`, outside the pnpm workspace globs and outside check-versions. Versions: new packages 0.18.0 (minor under 0.x), shims 0.17.1 (so `^0.17.0` ranges pick them up). `@ebb-ai/mcp` keeps its old `mcpName`. The PyPI shim re-exports and aliases submodules, warns once at import, and carries `Development Status :: 7 - Inactive`; `pip install` itself prints nothing.

**10. Compat tests run in CI and in preflight.** The shim tests first ran nowhere; a review caught it. Now `node --test compat/test/shims.test.mjs` runs in `.github/workflows/ci.yml` and in `pnpm preflight`; the Python job imports `ebb_ai.grid` and checks the warning appears exactly once. Pass the test file by name: Node 22 does not expand a directory for `--test`.

**11. Leftover-name grep with an allowlist.** Run `git grep -niE "ebb" -- ':!CHANGELOG.md' ':!docs/solutions' ':!docs/plans' ':!docs/archive' ':!docs/release' ':!compat' ':!pnpm-lock.yaml'`, plus `git grep '@ebb-ai/' -- pnpm-lock.yaml` (must be empty). Every remaining hit must be on the allowlist: compat code and its tests, kept internal ids (SVG/CSS ids, test seams, temp-dir prefixes), migration notes, hub-log history rows, quoted raw output, an external slug renamed later in the runbook. Anything else is a miss.

## Repointing a renamed plugin hub listing (ClawHub, PR #58)

**A hub listing shows the description of its last published manifest. There is no web edit.** To point the old `@vitalini/ebb` listing at `@vitalini/tidegap`, publish a pointer release from `compat/clawhub/ebb/` (0.17.1). Rules:

- **Keep the locked runtime id.** ClawHub fixed the plugin id `ebb` at first publish. The pointer keeps `id: ebb` and changes only the display name and description.
- **Register no tools.** The manifest has no `contracts.tools`. `configSchema` accepts any object, so an existing `plugins.entries.ebb` block still validates.
- **Log one migration warning**, once, on the first `full` registration: install the new plugin and move the config block to `plugins.entries.tidegap`. The user config key is `plugins.entries.<id>` (not `plugins.<id>`).
- **Keep the old `uiHints`**, so the sensitive fields stay hidden in the host UI. Dropping them would show secrets as plain text. A fix commit added them back.
- **The shim is plain ESM with no dependencies**, tested without a build (`compat/test/clawhub-shim.test.mjs`, in `pnpm preflight`). Validate with `clawhub package validate`, rehearse with `publish --dry-run --json`.
- The release is "ready, not published" until the publish command runs after merge; track it as a hub-submission-log row. The 0.17.1 pointer was published on 2026-10-17 from `main` `ee615aa`.

## Why This Matters

A rename that skips these steps fails on users, not in CI: a hidden ledger, a daemon that ticks into a missing path, an `npx` config that 404s. The user table (what happens, what the user does) belongs in the PR and the CHANGELOG upgrade note. Pair this with the release order in `docs/solutions/tooling-decisions/trusted-publishing-release-workflow.md` (the publish-before-merge order in `version-lockstep-check.md` is superseded) and reserve external names first (see the clearance doc).

## When to Apply

- Any rename of a published package set with on-disk user state.
- Removal of the aliases is a separate release (here 0.19); put it in the plan as deferred work.

## Related

- `docs/solutions/best-practices/shared-sqlite-ledger-migrations.md`
- `docs/solutions/logic-errors/compare-and-set-task-transitions.md`
- `docs/solutions/tooling-decisions/rendered-repo-images-and-brand-name.md`
- `docs/solutions/tooling-decisions/trusted-publishing-release-workflow.md` (how releases ship; the compat pointer stays a manual publish)
