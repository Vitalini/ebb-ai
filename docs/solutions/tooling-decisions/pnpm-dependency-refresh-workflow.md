---
title: How to refresh pnpm dependencies here without pnpm update -r side effects or an open override range
date: 2026-09-27
category: tooling-decisions
module: dependency management
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - "Bumping dependency versions or pnpm.overrides ranges in this repo's root package.json or pnpm-lock.yaml"
  - "Deciding whether a Dependabot PR already covers a security advisory"
tags: [pnpm, overrides, lockfile, dependabot, semver]
---

# How to refresh pnpm dependencies here without pnpm update -r side effects or an open override range

## Context

The 2026-09 models/deps refresh (PR #35, unit U6) bumped the MCP SDK, patched several transitive advisories through `pnpm.overrides`, and closed two critical Next.js RCE advisories. Three workflow decisions from that pass are worth keeping: how to bump in-range versions without noisy diffs, how to write an override range so it can't silently jump a major, and where to check a security floor instead of trusting the tool that proposed it.

## Guidance

**Use `pnpm update -r --no-save` for in-range, lockfile-only bumps.**

This session found that a plain `pnpm update -r` rewrites every workspace `package.json` it touches: it raises version floors in `dependencies`/`devDependencies` (not just the lockfile), re-sorts object keys, and can un-escape unicode elsewhere in the file. On a repo this size that turns a lockfile bump into a large, hard-to-review manifest diff. `--no-save` updates the lockfile within the ranges each `package.json` already declares and leaves the manifests untouched, which is what a routine in-range refresh should produce.

**A `pnpm.overrides` entry must target a caret range (`^x.y.z`), not an open `>=x.y.z`.**

`package.json`'s `pnpm.overrides` (root `package.json`) started with entries like `"fast-uri@<3.1.6": ">=3.1.6"` and `"nanoid@<3.3.18": ">=3.3.18"`. An open lower bound has no ceiling, so pnpm resolved it to whatever is newest at install time — which pulled in a new major outside what the transitive dependents (`ajv` for `fast-uri`, `postcss` for `nanoid`) declared support for:

- `fast-uri@>=3.1.6` resolved to fast-uri 4.x under `ajv`, a major `ajv` doesn't declare.
- `nanoid@>=3.3.18` resolved to nanoid 6.x under `postcss` — nanoid 6 is ESM-only, and `postcss` needs the CommonJS build nanoid 3.x still ships.

Both were fixed by narrowing the target to a caret range pinned at the patched floor, in PR #35: `"nanoid@<3.3.18": "^3.3.18"`, `"fast-uri@<3.1.6": "^3.1.6"`, and the same fix applied to the `hono` and `qs` overrides in the same pass. The rule generalizes: an override exists to patch a specific advisory within the version line the dependents already use, not to let the resolver pick any newer major.

**Check the advisory's floor version, not what a grouped Dependabot PR proposes.**

Dependabot's grouped npm PR (#33) bundled `next` `16.2.11` -> `16.3.0` along with nine unrelated bumps. The advisory this refresh closed needed `next >= 16.3.3` (`next@16.3.6` landed in this PR's `apps/web`). A grouped PR is optimizing for "moves the version forward," not "clears the specific advisory" — always confirm the advisory's stated floor (`npm view <pkg> versions` / the advisory page) before treating a Dependabot PR as sufficient, and reject or supersede a grouped PR that stops short of it.

## Why This Matters

A manifest-wide diff from `pnpm update -r` makes the real change (the security-relevant bump) hard to find in review. An open-ended override range converts a targeted patch into an unbounded one that can pull in a major the rest of the tree doesn't support — exactly the nanoid/fast-uri failure this refresh had to unwind. Trusting a grouped Dependabot PR's version number instead of the advisory's floor can leave a repo believing an advisory is closed when it isn't.

## When to Apply

- Any dependency bump in this repo done through `pnpm update` rather than a manual `package.json` edit.
- Any time a new or existing `pnpm.overrides` entry is added or widened.
- Before closing a security ticket on the strength of a Dependabot PR alone.

## Examples

```bash
# In-range, lockfile-only refresh — no manifest diff
pnpm update -r --no-save

# Override: wrong (open range, floats to any newer major)
"nanoid@<3.3.18": ">=3.3.18"

# Override: right (pinned to the patched floor's major)
"nanoid@<3.3.18": "^3.3.18"
```

## Related

- `docs/plans/2026-09-27-2059-chore-models-deps-refresh-plan.md`, R17 and the health-audit-sourced ranges in the Sources section
- `package.json` `pnpm.overrides` — current state of these ranges
