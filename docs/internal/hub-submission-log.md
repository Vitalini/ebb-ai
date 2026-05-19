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
| - | mcp.so | Submit via web form | https://mcp.so/submit | not started | Form-based |
| - | smithery.ai | Submit via web form / GitHub | https://smithery.ai | not started | One-click install model |
| - | glama.ai/mcp | Auto-indexed? Check | https://glama.ai/mcp/servers | not started | Aggregator, may auto-detect |
| - | mcp-get.com | Auto-index of `@ebb-ai/mcp` on npm? | https://mcp-get.com | not started | Indexes npm scoped packages |
| - | punkpeye/awesome-mcp-servers | PR README entry | https://github.com/punkpeye/awesome-mcp-servers | not started | Single-line, no Claude-Code dupe |
| - | hesreallyhim/awesome-claude-code | PR README entry | https://github.com/hesreallyhim/awesome-claude-code | not started | Specifically for the plugin, link to /docs |
| - | ClawHub | `clawhub skill publish ./skills/personal/ebb-ai` | https://clawhub.ai | not started | Requires `clawhub login` first |

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
