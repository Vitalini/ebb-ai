# Hub-Submission Log — ebb-ai

Single source of truth for "where have we submitted ebb-ai, what's the
status, when did we last touch it." Update on every submission and on
every status change (approved / rejected / merged).

## Format

Each row: `YYYY-MM-DD | platform | action | URL | status | notes`.

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
| - | modelcontextprotocol/servers | PR to README community list | https://github.com/modelcontextprotocol/servers | not started | One-line entry per the existing format |
| 2026-05-19 | mcp.so | Submitted via web form | https://mcp.so/server/ebb-ai | **LIVE** — public listing under `ebb-ai` slug, Overview/Tools/Comments structure populated | Form takes Name + URL + Server Config JSON; second step (Edit Server) adds Title + Description + Tags. No moderation queue visible — published immediately. |
| - | smithery.ai | Submit via web form / GitHub | https://smithery.ai | not started | One-click install model |
| 2026-05-19 | glama.ai/mcp | Manual submission via "Add Server" modal | https://glama.ai/mcp/servers (search "ebb-ai") | submitted, awaiting review | GitHub OAuth signup required first; `Server` tab (not Connector — we're open-source with GitHub source). Submission says "Public submissions are reviewed before becoming publicly visible." |
| - | mcp-get.com | Auto-index of `@ebb-ai/mcp` on npm? | https://mcp-get.com | not started | Indexes npm scoped packages |
| 2026-05-19 | punkpeye/awesome-mcp-servers | PR #6348 — Environment & Nature section | https://github.com/punkpeye/awesome-mcp-servers/pull/6348 | OPEN, labels `has-emoji` + `valid-name`, awaiting maintainer merge | AI-PR opt-in title (`🤖🤖🤖`) honored by maintainer's streamlined process |
| 2026-05-19 | Green-Software-Foundation/awesome-green-software | PR #215 — AI > Carbon section | https://github.com/Green-Software-Foundation/awesome-green-software/pull/215 | OPEN, DCO-signed, targets `dev` branch | Highest semantic fit; only 2 existing entries in AI Carbon (1ClickImpact, Experiment Impact Tracker), ebb-ai is a reduction-at-source complement |
| 2026-05-19 | ComposioHQ/awesome-claude-skills | PR #877 — Development & Code Tools | https://github.com/ComposioHQ/awesome-claude-skills/pull/877 | OPEN | 60k⭐ list; ebb-ai inserted alphabetically between D3.js and FFUF |
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
