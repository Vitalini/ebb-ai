# `apps/dashboard` — planned

The public dashboard component of ebb-ai (working name **ebb-ai live
map of AI carbon intensity**) lands in v0.2 per the project roadmap.
See [`PLAN.md`](../../PLAN.md) sections 4.4 and 7 (Month 4).

When it ships, this directory will contain a Next.js application
that:

- Visualizes current and forecasted grid carbon intensity across
  Anthropic / OpenAI / Google regions, side-by-side with the
  scheduler's own active queue.
- Surfaces a "best window finder" for ad-hoc planning.
- Aggregates opt-in carbon-saved metrics from hosted ebb-ai users.

For now, the static informational landing site lives in
[`../site/`](../site/). The dashboard is intentionally distinct from
the marketing site: it is the operator's tool, the marketing site is
the public-facing front.
