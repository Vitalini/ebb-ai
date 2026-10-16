# Hub-Submission Log — Tidegap

Single source of truth for "where have we submitted Tidegap, what's the
status, when did we last touch it." Update on every submission and on
every status change (approved / rejected / merged).

The project was called Ebb AI (`ebb-ai`) until 0.18. Rows dated before
2026-10-16 are history and keep the old names and URLs.

## Format

Each row: `YYYY-MM-DD | platform | action | URL | status | notes`.

## Rename to Tidegap (0.18)

Steps from the Release and Deprecation Runbook in
`docs/plans/2026-10-16-1008-feat-rebrand-tidegap-plan.md`. Update each row
when it runs.

| Date | Platform | Action | URL | Status | Notes |
|---|---|---|---|---|---|
| - | GitHub | Create org `tidegap`, transfer `Vitalini/ebb-ai`, rename the repo to `tidegap`; re-upload the social preview; re-check the 20 topics | https://github.com/tidegap/tidegap | not started | Do not create a new `Vitalini/ebb-ai` repo: it breaks the redirect |
| - | npm | Publish `@tidegap/{core,cli,mcp}` 0.18.0 from the reviewed PR head | https://www.npmjs.com/org/tidegap | not started | Before merge |
| - | PyPI | Publish `tidegap` 0.18.0 | https://pypi.org/project/tidegap/ | not started | |
| - | MCP Registry | Publish `io.github.tidegap/tidegap` 0.18.0 | https://registry.modelcontextprotocol.io | not started | npm 0.18.0 first; org membership public |
| 2026-10-16 | MCP Registry | Interactive `mcp-publisher login github` refused `io.github.tidegap/tidegap` (403); publish via `mcp-registry.yml` (GitHub OIDC) | https://registry.modelcontextprotocol.io | blocked: workflow pending | `gh workflow run mcp-registry.yml` after merge |
| - | npm | Publish shims `@ebb-ai/{core,cli,mcp}` 0.17.1, then `npm deprecate` | https://www.npmjs.com/org/ebb-ai | not started | `compat/npm/*` |
| - | PyPI | Publish shim `ebb-ai` 0.17.1 | https://pypi.org/project/ebb-ai/ | not started | `compat/pypi/ebb-ai` |
| - | MCP Registry | Final `io.github.Vitalini/ebb-ai` 0.17.1 pointing at the new id; set old versions `deprecated` | https://registry.modelcontextprotocol.io | not started | Confirm the `mcp-publisher` status command |
| - | ClawHub | Publish `@vitalini/tidegap` 0.18.0 (runtime id `tidegap` locks on first publish); point the old `@vitalini/ebb` description at it | https://clawhub.ai/plugins/@vitalini/tidegap | not started | Do not delete `@vitalini/ebb` |
| - | Vercel | Reconnect git to `tidegap/tidegap`; add `tidegap.com` and `www.tidegap.com` (www primary); add `TIDEGAP_*` env vars | https://www.tidegap.com | not started | Before merge |
| - | Vercel | `ebb-ai.com` and `www.ebb-ai.com` 301 to `https://www.tidegap.com`, path kept | https://www.ebb-ai.com | not started | After merge; keep the domain 12 months |
| - | Google Search Console, Bing | Resubmit sitemap; change of address for the old property | https://search.google.com/search-console | not started | |
| - | mcp.so | Edit the entry: name, URL, config JSON with `@tidegap/mcp` | https://mcp.so/server/ebb-ai | not started | Entry already stale (v0.7) |
| - | punkpeye/awesome-mcp-servers | Update PR #16076: name `tidegap/tidegap`, new link and Glama badge path | https://github.com/punkpeye/awesome-mcp-servers/pull/16076 | not started | |
| - | Green-Software-Foundation/awesome-green-software | One-line PR renaming the entry and link | https://github.com/Green-Software-Foundation/awesome-green-software | not started | PR #215 merged to `dev` |
| - | Glama | Re-check the server page after the transfer; claim `tidegap/tidegap` if a new entry appears | https://glama.ai/mcp/servers/tidegap/tidegap | not started | |
| - | ComposioHQ/awesome-claude-skills | Update PR #877 with the renamed entry, alphabetical position near "T" | https://github.com/ComposioHQ/awesome-claude-skills/pull/877 | not started | |
| 2026-10-16 | npm | Published `@tidegap/{core,cli,mcp}` 0.18.0 | https://www.npmjs.com/org/tidegap | done | |
| 2026-10-16 | PyPI | Published `tidegap` 0.18.0 | https://pypi.org/project/tidegap/ | done | |
| 2026-10-16 | ClawHub | Published `@vitalini/tidegap` 0.18.0 | https://clawhub.ai/plugins/@vitalini/tidegap | done | |
| 2026-10-16 | MCP Registry | Publish `io.github.tidegap/tidegap` | https://registry.modelcontextprotocol.io | pending | 403 org permission at time of writing |
| 2026-10-16 | npm, PyPI | Old packages deprecated: `@ebb-ai/core` 0.17.1, `@ebb-ai/mcp` 0.17.1, `@ebb-ai/cli` 0.17.2; PyPI `ebb-ai` 0.17.1 set Inactive | https://www.npmjs.com/org/ebb-ai | done | |
| 2026-10-16 | GitHub | Repo transferred to `tidegap/tidegap`; description and homepage updated | https://github.com/tidegap/tidegap | done | |
| 2026-10-16 | GitHub | Re-upload social preview | https://github.com/tidegap/tidegap/settings | not done; Vitalii's step | `assets/social-preview.png` now says Tidegap (last changed in commit `72cd825`) |
| 2026-10-16 | ClawHub | `@vitalini/ebb` 0.17.1 pointer release (`compat/clawhub/ebb`): runtime id `ebb`, no tools, one startup warning pointing at `@vitalini/tidegap` | https://clawhub.ai/vitalini/plugins/ebb | ready, not published | ClawHub shows the description from the published manifest and has no edit form, so only a new version can point the old listing at the new one. Publish command: `compat/README.md` |
| 2026-10-16 | mcp.so | Update listing to Tidegap | https://mcp.so/server/ebb-ai | to do | |
| 2026-10-16 | awesome-mcp-servers, awesome-green-software (GSF), awesome-claude-skills (Composio) | Rename updates for PR #16076, the GSF list entry and PR #877 | see rows above | in flight | |
| 2026-10-16 | Domain | `tidegap.com` registered on Spaceship; Vercel 301 from `ebb-ai.com` | https://www.tidegap.com | done | |

## Search engines

| Date | Platform | Action | URL | Status | Notes |
|---|---|---|---|---|---|
| 2026-05-19 | Google Search Console | Add URL prefix property | https://search.google.com/search-console | meta tag deployed; awaiting verify-button click | Token `NWwuXFBCyAQVChXdBSa3n5wwxm6xsZVrhON5YvaxpSM` |
| - | Google Search Console | Sitemap submit | sitemap.xml | pending verification | Submit immediately after verify |
| - | Bing Webmaster Tools | Add site, import from GSC | https://bing.com/webmasters | not started | Import from GSC saves time |

## MCP / Claude / OpenClaw directories

| Date | Platform | Action | URL | Status | Notes |
|---|---|---|---|---|---|
| 2026-05-19 | GitHub topics | Set 20 topics | https://github.com/Vitalini/ebb-ai | done | `claude-code` + `python` added in the last 2 slots |
| 2026-10-15 | GitHub social preview | Upload `assets/social-preview.png` (1280×640) in Settings > General > Social preview (web UI only; no API) | https://github.com/Vitalini/ebb-ai/settings | not done; Vitalii's step | Re-upload only when the `assets/social-preview.png` sha256 in `assets/images.lock.json` changes |
| - | modelcontextprotocol/servers | PR to README community list | https://github.com/modelcontextprotocol/servers | not started | One-line entry per the existing format |
| 2026-05-19 | mcp.so | Submitted via web form | https://mcp.so/server/ebb-ai | **LIVE but stale** (checked 2026-10-15): shows v0.7, "seven grid regions", "No tools detected" | Form takes Name + URL + Server Config JSON; second step (Edit Server) adds Title + Description + Tags. No moderation queue visible — published immediately. |
| - | smithery.ai | Submit via web form / GitHub | https://smithery.ai | not started | One-click install model |
| 2026-05-19 | glama.ai/mcp | Manual submission via "Add Server" modal | https://glama.ai/mcp/servers (search "ebb-ai") | listed (checked 2026-10-15); score badge "rated A" (claimed, 9 tools) | GitHub OAuth signup required first; `Server` tab (not Connector — we're open-source with GitHub source). Submission says "Public submissions are reviewed before becoming publicly visible." |
| - | mcp-get.com | Auto-index of `@ebb-ai/mcp` on npm? | https://mcp-get.com | not started | Indexes npm scoped packages |
| 2026-05-19 | punkpeye/awesome-mcp-servers | PR #6348 — Environment & Nature section | https://github.com/punkpeye/awesome-mcp-servers/pull/6348 | closed, not merged, 2026-07-24 — bot closed for inactivity after nudges asking for a Glama badge and score | AI-PR opt-in title (`🤖🤖🤖`) honored by maintainer's streamlined process |
| 2026-10-09 | punkpeye/awesome-mcp-servers | PR #16076 — resubmission | https://github.com/punkpeye/awesome-mcp-servers/pull/16076 | OPEN, labels `valid-name`, `has-emoji`, `has-glama` (checked 2026-10-15) | Glama badge in the entry; replaces closed #6348 |
| 2026-05-19 | Green-Software-Foundation/awesome-green-software | PR #215 — AI > Carbon section | https://github.com/Green-Software-Foundation/awesome-green-software/pull/215 | MERGED 2026-08-04 (to `dev`); maintainers rewrote the entry before it reached `main`; live entry has no percentage | Highest semantic fit; only 2 existing entries in AI Carbon (1ClickImpact, Experiment Impact Tracker), ebb-ai is a reduction-at-source complement |
| 2026-05-19 | ComposioHQ/awesome-claude-skills | PR #877 — Development & Code Tools | https://github.com/ComposioHQ/awesome-claude-skills/pull/877 | OPEN, no comments as of 2026-10-15 | 60k⭐ list; ebb-ai inserted alphabetically between D3.js and FFUF |
| 2026-05-19 | hesreallyhim/awesome-claude-code | (deferred) | https://github.com/hesreallyhim/awesome-claude-code | not opened | Repo is mid-restructure ("Table of Contents: TODO" + "update in progress" banner). Wait for them to ship the new TOC, then PR. |
| 2026-05-19 | ClawHub | Plugin published as `@vitalini/ebb-ai@0.1.0` | https://clawhub.ai/plugins/@vitalini/ebb-ai | **withdrawn** — soft-deleted; runtime id was the wrong `vitalini-ebb-ai` and ClawHub locks runtime id at first publish | Replaced by `@vitalini/ebb` (see below). Skill stayed local (`~/.openclaw/workspace/skills/personal/ebb-ai/`). |
| 2026-05-19 | ClawHub | Workaround republish as `@vitalini/ebb-ai-mcp@0.1.0` | https://clawhub.ai/plugins/@vitalini/ebb-ai-mcp | **withdrawn** — soft-deleted; `-mcp` suffix didn't match the project name | Had the correct runtime id but the slug was rejected by Vitalik. |
| 2026-05-19 | ClawHub | Final publish as `@vitalini/ebb@0.1.0` | https://clawhub.ai/plugins/@vitalini/ebb | **LIVE** — runtime id `ebb`; install `openclaw plugins install clawhub:@vitalini/ebb` | Fresh clean slug, no runtime-id baggage. ClawHub security scan runs automatically. Needs `clawhub` CLI ≥ 0.17 (`package` subcommand). |

## Marketing channels

| Date | Platform | Action | URL | Status | Notes |
|---|---|---|---|---|---|
| - | Show HN | Post launch | https://news.ycombinator.com/submit | not started | Use template from `references/marketing-templates.md` in skill |
| - | LinkedIn | Personal post | linkedin.com/in/vitalii-borovyk | not started | One real metric, end with question |
| - | r/MachineLearning | [P] post | reddit.com/r/MachineLearning | not started | Lead with technical motivation |
| - | r/sustainability | Post | reddit.com/r/sustainability | not started | Plain language, demote engineering |
| - | dev.to | Article | dev.to | not started | Long-form, links to repo + live |

## How to add a row

When submitting somewhere new:

1. Add the row with `YYYY-MM-DD` today's date.
2. Status starts as `submitted` or `PR opened`.
3. Update status on response: `approved`, `merged`, `rejected`,
   `awaiting review`, etc.
4. Link the PR or form-submission URL in the Notes column when relevant.

## How to remove a row

Don't remove rows. If a submission is rejected or withdrawn, set status
to `rejected: <reason>` or `withdrawn: <reason>` and keep the row. The
log is a history, not a current state.
