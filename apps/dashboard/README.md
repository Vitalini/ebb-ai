# `@ebb-ai/dashboard`

The public dashboard for **ebb-ai** — a live map of AI-compute carbon
intensity across the major LLM-provider regions, with a 72-hour forecast,
a best-window finder, and a view into the scheduler's task queue.

Built with Next.js 15 (app router), React 19, TypeScript strict mode,
Tailwind 4, and Recharts.

This app is the operator's tool. It is intentionally distinct from the
marketing/landing site under [`../site/`](../site/).

---

## Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9

(The repo is a pnpm workspace; running the dashboard from anywhere else
will not pick up the workspace package linkage. Always invoke from this
directory or from the repo root with `pnpm --filter @ebb-ai/dashboard`.)

---

## Quick start

```bash
# From the repo root
pnpm install
pnpm --filter @ebb-ai/dashboard dev

# Or from this directory
cd apps/dashboard
pnpm install
pnpm dev
```

Open <http://localhost:3000>.

With zero configuration, the dashboard serves a deterministic synthetic
carbon-intensity curve (UTC-aligned sinusoid, region-specific floors)
that exercises every band and every code path. This is by design — the
dashboard must demo cleanly without any external API keys.

---

## What's on each page

| Route | What it shows |
|---|---|
| `/` | Live grid of six regions (CAISO, ERCOT, ISO-NE, PJM, FR, DE). Each card: current g CO2e/kWh, band, 24-hour sparkline. Click → forecast. |
| `/forecast?region=US-CAL-CISO` | 72-hour line chart with band-threshold reference lines; tables of the cleanest and dirtiest hours; min/max/avg/swing stats; region picker. |
| `/plan` | Form: region, deadline (datetime-local), optional carbon budget in grams. Submits to the same page; renders the chosen window with projected carbon, a "copy CLI command" button for ebb-mcp, and the forecast chart with the chosen hour highlighted. |
| `/queue` | Snapshot of the scheduler queue with carbon receipts on completed tasks. Stub data in v0.2; v0.3 will wire this to the live scheduler. |
| `/api/grid/[region]?hours=72` | JSON. Electricity Maps if key is set; mock otherwise. Edge-cached 5 minutes. |
| `/api/queue` | JSON. Stub queue, deterministic per 5-minute slot so screenshots are stable. |

---

## Environment variables

| Var | Required | Effect |
|---|---|---|
| `EBB_ELECTRICITY_MAPS_API_KEY` | no | When set, `/api/grid/[region]` and the home/forecast pages call Electricity Maps' free-tier API. On any failure (timeout, 401, empty payload) the dashboard transparently falls back to the mock — it never goes dark. |
| `NEXT_PUBLIC_BASE_URL` | no | Override the base URL the queue page uses when calling `/api/queue` on the server. Defaults to `https://$VERCEL_URL` on Vercel or `http://localhost:3000` locally. |

Free-tier API key signup: <https://www.electricitymaps.com/free-tier-api>

---

## Scripts

```bash
pnpm dev         # next dev   — hot-reload dev server on :3000
pnpm build       # next build — production bundle; must succeed before deploy
pnpm start       # next start — serve the built app
pnpm lint        # next lint  — eslint with next/typescript rules
pnpm typecheck   # tsc --noEmit
```

---

## Deploy to Vercel

The dashboard is a stock Next.js 15 app and deploys with no special
config:

```bash
# From the repo root, point the Vercel project at apps/dashboard:
vercel link        # choose the root, then set the project root to apps/dashboard
vercel --prod
```

In the Vercel project settings:

- **Root directory:** `apps/dashboard`
- **Build command:** `pnpm build` (default)
- **Install command:** `pnpm install`
- **Environment variables:** add `EBB_ELECTRICITY_MAPS_API_KEY` if you
  have a key. Otherwise the mock keeps things working.

---

## Architecture notes

- **No dependency on `@ebb-ai/core` in v0.2.** The dashboard ships a
  trimmed copy of the grid feed (`src/lib/grid.ts`) and the type shapes
  (`src/lib/types.ts`). This is deliberate: it avoids fighting the
  ESM/CJS interop story while both packages are iterating quickly.
  When the v0.3 HTTP control plane lands on the scheduler, this app
  will import `@ebb-ai/core` for the shared types and call the
  scheduler over HTTP for the live queue.
- **Server components by default.** The home, forecast, plan, and
  queue pages are all React Server Components. The chart components,
  the best-window result panel, and the planner are client components
  because they need Recharts (DOM-only) or user interactivity.
- **Strict TypeScript.** `noUncheckedIndexedAccess` is on; expect
  explicit guards around array lookups.
- **No animation by default.** Charts use `isAnimationActive={false}`
  so screenshots and SSR snapshots are stable.
- **Edge caching.** `/api/grid/[region]` is cached for 300 seconds at
  the edge. The pages themselves are `force-dynamic` so the surfaced
  intensities are always fresh on initial load.

---

## Screenshots

A typical run on the mock feed shows six region cards in a 3×2 grid,
each carrying a colored band badge (clean → very_dirty), a current
intensity readout, and a 24-hour teal sparkline. The forecast page
plots the 72-hour curve over band-threshold reference lines (one per
band) with a vertical "best" marker on the cleanest hour. The plan
page renders the chosen window in a teal-bordered card with a
projected-grams stat and a copy-able CLI command. The queue page
shows a tabulated list of tasks with status pills, enqueued/finished
relative times, and carbon receipts on completed entries.

---

## License

Apache-2.0. See [`../../LICENSE`](../../LICENSE).
