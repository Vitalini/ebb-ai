---
title: Choosing a project name - trademark register search and availability checks
date: 2026-10-16
category: tooling-decisions
module: naming (rebrand to Tidegap)
problem_type: tooling_decision
component: tooling
severity: high
applies_when:
  - "Naming a new open-source project or renaming one because of a trademark conflict"
  - "Judging whether a name is safe enough to publish under"
  - "Reserving names before a rename PR goes public"
root_cause: inadequate_documentation
resolution_type: documentation_update
tags: [naming, trademark, clearance, npm, pypi, rdap, rebrand]
---

# Choosing a project name - trademark register search and availability checks

## Context

Ebb AI was renamed to Tidegap (0.18.0, PR #51). The first pass was a web search. It found only a Headspace "EBB" filing in class 35 and rated the risk low; the advice was to keep the name. A search of the registers themselves changed the answer. Web search is not a register search. The rename mechanics are in `docs/solutions/workflow-issues/renaming-a-published-multi-package-project.md`.

## Guidance

**1. Search five registers.** USPTO, EUIPO, WIPO Global Brand Database, UK IPO, and one local register (Ukraine, the owner's country). Search the bare word, not "Name AI": a mark `EBB` covers `EBB AI`.
- USPTO: the site's own JSON endpoint `POST https://tmsearch.uspto.gov/prod-stage-v1-0-0/tmsearch` (the `api-v1-0-0` path returned 405). Wordmark phrase and wildcard `EBB*`, alive only. Then read the status in TSDR.
- EUIPO eSearch: trade marks, `MarkVerbalElementText CONTAINS`, through `/copla/ctmsearch/json`. Filter live status locally.
- WIPO: similar-name search. Anonymous access caps a list at 360 results, and the Nice-class and status filters did not work through the URL. Filter locally.
- UK IPO: word, "Contains String", status Live, 50 per page. International registrations show as `WO...` with status "Protected".
- Ukraine (sis.nipo.gov.ua): keyword search plus wildcard. Run a control search (a known mark) to prove the search works.
Mirrors and web search return 403s and stale snapshots. Do not rely on them.

**2. Read classes 9 and 42.** Class 9 is downloadable software, class 42 is SaaS and development services. Record per hit: owner, number, classes, goods text, status, filing date. Discard other classes (class 10 medical, class 3 cosmetics) unless the goods text is software.

**3. The "similar found" rule.** Rate the name `similar found` when a live mark is the same word in class 9 or 42, or a near variant, for goods that sit next to yours. A mark does not have to read exactly like yours. For Ebb: Headspace `EBB` (class 9, AI apps, live in the US, EU, UK, Australia), `MY EBB` (classes 9 and 42, AI task software), `ebb3` (UK, 9 and 42). That meant a claim was possible and there was no defense, so the project renamed. Not legal advice; a clean result lowers risk and does not remove it.

**4. Search every candidate the same way.** Tidegap (`TIDEGAP`, `TIDE GAP`) returned 0 hits in all five registers. WIPO tokenizes `TIDE GAP` into `TIDE` and returns thousands of detergent marks; read those as noise, and rely on the `TIDEGAP` query.

**5. Availability checks.** For each candidate:
- npm: `npm view <name>` and `npm view @<name>/core` (404 means free). A scope check can return 403 whether taken or not; use `curl https://registry.npmjs.org/-/org/<name>/user` after creating the org.
- PyPI: `https://pypi.org/pypi/<name>/json` returns 404 when free.
- GitHub: user and org lookup (`gh api users/<name>`), plus repo search.
- Domains by RDAP, not WHOIS: Verisign RDAP for `.com`, Google registry RDAP for `.dev`. `rdap.org` rate-limits (302/429).
- Reject a name when any of npm, PyPI, GitHub or `.com` is taken.
Rejected here: `lowtide` (npm and GitHub taken, `.com` and `.dev` registered), `grididle` (`.com` taken), `idleai` (npm and GitHub taken).

**6. Reserve names before the PR goes public.** The repo is public, so the PR announces the new names to squatters. Before pushing: create the GitHub org (and make membership public; the MCP Registry checks it for `io.github.<org>/*`), create the npm org, check PyPI (register with a minimal owner release if needed), buy the domain, claim the ClawHub slug. ClawHub locks the runtime plugin id at first publish, so decide the id before that publish. Vercel's CLI refuses `domain add` for a domain not in the account (`domain_not_owned`); add it in the dashboard.

## Why This Matters

Web search missed the live class-9 filing. A takedown after adoption grows costs the npm scope, the PyPI project, the listings and the domain. Ten minutes of register search before naming prevents a full rename.

## Related

- `docs/solutions/tooling-decisions/mcp-registry-metadata-and-package-readmes.md`
- `docs/plans/2026-10-16-1008-feat-rebrand-tidegap-plan.md` (runbook step 0)
