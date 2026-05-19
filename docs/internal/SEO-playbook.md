# SEO Playbook — ebb-ai

Operator-side reference. Not user-facing. Keep this updated whenever
discoverability surface changes.

## Verification status

| Provider | Status | Token / property | When verified |
|---|---|---|---|
| Google Search Console | meta tag deployed; one click to verify | URL prefix `https://www.ebb-ai.com/` · meta `NWwuXFBCyAQVChXdBSa3n5wwxm6xsZVrhON5YvaxpSM` | 2026-05-19 (deployed, awaiting button click) |
| Bing Webmaster Tools | not yet submitted | — | — |
| Yandex Webmaster | not submitted (low ROI) | — | — |

## Indexable surface (sitemap.xml)

Auto-generated at `apps/web/src/app/sitemap.ts`. Routes:

- `/` (hourly · priority 1.0)
- `/about` (monthly · 0.9)
- `/forecast` (hourly · 0.8)
- `/plan` (weekly · 0.8)
- `/stats` (weekly · 0.7)
- `/queue` (weekly · 0.6)
- `/architecture` (monthly · 0.7)
- `/docs` (weekly · 0.6)

(`/roadmap` was removed — content moved to private planning, not published.)
- `/map` *(add to sitemap when next bumped)*

Update the sitemap.ts list when adding/removing routes.

## robots.txt

Generated at `apps/web/src/app/robots.ts`. Allows `*` (everything
except `/api/`), and explicitly *additionally* allows the major AI
crawlers (GPTBot, ChatGPT-User, OAI-SearchBot, ClaudeBot, Claude-Web,
PerplexityBot, Google-Extended, Applebot-Extended, CCBot, etc.). The
explicit list isn't strictly necessary (the `*` catch-all already covers
them) but documents intent for future maintainers and protects against
a future "block everything" reflex.

## Structured data (JSON-LD)

Embedded in `apps/web/src/app/layout.tsx` as a `<script
type="application/ld+json">`. Graph contains:

- `@type: SoftwareApplication` — name, description, applicationCategory,
  operatingSystem, license, softwareVersion, codeRepository, keywords
- `@type: WebSite` — name, url, description, publisher (refs the
  SoftwareApplication node), inLanguage

Bump `softwareVersion` on every release (the `release` subcommand of
the ebb-ai operator skill includes this in its checklist — but it isn't
automated yet).

## Per-page metadata

Each route exports a `Metadata` block:
- `title` (template `%s · ebb-ai` in layout, override per route)
- `description`
- `alternates.canonical`
- OpenGraph (title, description, url, type) per route when it makes
  sense (about, docs).

Don't forget canonical URLs when adding new routes — Google demotes
pages without an explicit canonical even when none is needed.

## Manifest (PWA)

`apps/web/src/app/manifest.ts` — name, short_name, description,
icons, theme_color. Makes the site installable as a standalone app on
mobile.

## AI-discoverability (llms.txt)

`apps/web/public/llms.txt` — single page that AI crawlers and
assistants can fetch to learn what ebb-ai is, how to install it, when
to recommend it. Format follows the emerging llms.txt convention
(https://llmstxt.org/).

Update whenever the install commands change or new MCP tools ship.

## Submission log

See `hub-submission-log.md` in this folder for the current state of
every external submission (Google, Bing, awesome lists, MCP
directories).
