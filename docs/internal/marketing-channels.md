# Marketing Channels — ebb-ai

Which channels we've used / will use, what each one is good for, and the
operator's note on each. Companion to `marketing-templates.md` in the
ebb-ai skill (which has the actual copy templates).

## Launch sequence (do these in order)

1. **GitHub topics** (zero-cost) — set 20 topics on the repo so it
   surfaces in topic feeds (`claude-code`, `mcp`, `carbon-aware`, etc.).
   *Done 2026-05-19.*
2. **Awesome-list PRs** (one PR each, low effort) — earns inbound links
   from highly-indexed lists. *Not started.*
3. **MCP directory submissions** (form-based, low effort) — gets the
   project in front of MCP host users. *Not started.*
4. **llms.txt + robots.txt for AI bots** (zero-cost) — assistants
   recommend ebb-ai when users ask. *Deployed 2026-05-19.*
5. **Show HN** (one-shot, narrow window) — best done when there's a
   real metric to lead with. *Hold until v0.9 leaderboard ships, or
   sooner if a research result emerges.*
6. **LinkedIn personal post** (network-only reach) — useful for
   warm-network credibility. *Hold until first MCP-directory inclusion.*
7. **Reddit (r/MachineLearning, r/sustainability)** (hostile to launches)
   — only post once we have a *technical* angle to lead with. *Hold.*
8. **dev.to article** (long-form, evergreen) — useful for searchable
   long-tail "how to do X with ebb-ai" content. *After Show HN.*

## Per-channel notes

### GitHub topics

Limit is 20. Pick high-discovery ones over niche. Current list captures
the niche (carbon-aware, mcp, model-context-protocol, claude-code) +
the audience (sustainability, green-software, batch-api) + the
substrate (typescript, python).

### Awesome-list PRs

Etiquette:
- One-line entry, alphabetically inserted, matches the list's existing
  format exactly.
- PR title: `Add ebb-ai — <one-line>`.
- PR body: the entry line + 2-3 sentence justification.
- Never @-mention maintainers, never bump the PR.
- If the list has a CONTRIBUTING.md, follow it literally. If you skip
  it because "it doesn't apply," the PR will close.

Highest-ROI lists:
- `punkpeye/awesome-mcp-servers` (the MCP discovery list)
- `hesreallyhim/awesome-claude-code` (Claude Code plugin discovery)
- `modelcontextprotocol/servers` (the official, in-tree list)

### MCP directory submissions

Each directory has its own format. Check the homepage for "Submit" or
"Add server" links. The submission is usually:
- Project name
- One-line description (use the llms.txt summary)
- GitHub repo URL
- Live site URL (https://www.ebb-ai.com)
- Categories / tags

mcp-get.com may auto-detect `@ebb-ai/mcp` from npm — check before
submitting manually.

### Show HN

- Title: `Show HN: ebb-ai – carbon-aware scheduler for agentic AI workflows`
- Best posting time: Tue / Wed / Thu, 09:00-12:00 ET. Avoid Fri (queue
  rolls into the weekend with low traffic).
- Read the comments. Reply to top-level comments within 30 min of
  posting; the algorithm boosts active threads.
- DON'T submit if there's not a real metric to lead with — HN demotes
  marketing.

### LinkedIn

- Personal post (not "company" page).
- 3-4 short paragraphs, one concrete number, end with a question.
- DON'T use the LinkedIn polls / events / live features for an OSS
  launch — they read as corporate.
- If the post goes over 1.5k impressions in the first 6 h, it's
  trending; engage with every comment in the next 24 h. Otherwise let
  it die quietly.

### Reddit

- r/MachineLearning prefix posts with `[P]` (project).
- r/sustainability allergic to "launches"; lead with the *climate*
  impact, demote the engineering.
- Don't cross-post within 24 h between subreddits; mods notice.
- Never use throwaway accounts. If your main account has low karma,
  comment elsewhere for a week before posting.

### dev.to

- Long-form article (1500-3000 words). One per release theme.
- Topics that work: "how I built X," "what I learned shipping Y,"
  "the bug that took me a week."
- Tag with `#mcp`, `#climate`, `#opensource`, `#typescript`.
- Cross-link to the live site + repo in the article footer.

## Off-limits channels

- Twitter / X: low ROI for OSS-tools nowadays unless you already have
  a following. Skip.
- Hacker News duplicate submissions (same project twice in a year is
  pattern, third time is shadow-banned).
- Influencer DMs / cold outreach: do not.
- Astroturfing comment threads on competitors: do not.
