---
title: Releases ship by GitHub OIDC trusted publishing; setup limits and traps found on the way
date: 2026-10-16
category: tooling-decisions
module: .github/workflows/release.yml, mcp-registry.yml
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - "Changing how npm, PyPI, ClawHub or the MCP Registry get published"
  - "Setting up or debugging trusted publishers"
  - "Driving a registry web form with a browser agent"
tags: [release, oidc, trusted-publishing, npm, provenance, pnpm, clawhub, github-environment]
---

# Releases by trusted publishing

PR #60, plan `docs/plans/2026-10-16-1509-chore-trusted-publishing-plan.md`. Release order and web settings are in the PR and `CONTRIBUTING`. This doc keeps what is not obvious from `release.yml`.

## Decisions and traps

- **npm cannot be set up with the old token.** npm 11.19 has `npm trust github|list`, but a bypass-2FA granular token gets 403 even on `npm trust list`. npm also warns these tokens are being restricted for direct publishing. Set the trusted publisher in the npm web form per package.
- **The npm web form needs account 2FA with a security key**, and asks for the key again on every save. Plan for three saves (three packages) and a human at the key.
- **Use `pnpm pack` then `npm publish <tgz> --provenance`.** `pnpm publish` gets OIDC only from pnpm 11. Pack with pnpm so `workspace:` ranges are rewritten; check the tarball has none and has the right `repository.url`.
- **`npm publish --dry-run` fails for an already-published version** unless `--force` is passed. Use `--force` in the dry run only, never in the real publish. The real job skips versions that exist, so "Re-run failed jobs" finishes a partial release.
- **Create the GitHub environment (`release`) before the first tag.** A job that names a missing environment creates it with no protection. Set the required reviewer and the `v*` tag-only deployment rule first.
- **ClawHub supports GitHub OIDC** (`clawhub package trusted-publisher set`). Once set, a manual publish needs `--manual-override-reason`.
- **The MCP Registry needs no setup:** OIDC grants `io.github.tidegap/*` (see `mcp-registry-metadata-and-package-readmes.md`).
- **Keep `verify` free of OIDC and environment.** Pull requests run it as a rehearsal; only a `v*` tag reaches the publish jobs.

## Secrets hygiene: browser-agent downloads

The Playwright MCP browser saves downloads into `<repo>/.playwright-mcp/`. A 2FA setup there downloaded the npm recovery codes into the repo folder. The folder is gitignored, but the codes must be moved out of the repo right away (to a password manager), and the file deleted. Brief any browser agent that touches 2FA: no download, or set the output directory outside the repo first.

## Related

- `version-lockstep-check.md` (the old publish-before-merge order is superseded)
- `mcp-registry-metadata-and-package-readmes.md`
- `docs/solutions/workflow-issues/renaming-a-published-multi-package-project.md`
