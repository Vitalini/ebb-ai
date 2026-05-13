# Roadmap

What's shipped, what's next, and what's deliberately out of scope.

Source of truth for ship events: [`CHANGELOG.md`](./CHANGELOG.md).
This roadmap is the forward-looking complement.

---

## Shipped

### v0.5 — 2026-05-13 *(current)*

- Full operator-control surface: `cancel_task` / `expedite_task` /
  `update_deadline` / `retry_task` across MCP, TypeScript, Python.
- Task-clarity layer: `schedule_task` `dry_run: true` preview mode;
  prompt validation at the MCP boundary.
- Result delivery: `output_path` writes `{ taskId, result, receipt }`
  JSON on completion; receipts include the (redacted) prompt and
  token counts.
- Failure-mode mitigations: retry-with-exponential-backoff on 429
  and 5xx; row-level claim against concurrent ticks; default
  secret-redaction on the stored prompt.
- Linux daemonization (real systemd `.service` + `.timer` units
  plus `rtcwake` wake events).
- Python port at parity (`Scheduler.tick` + control surface).

### v0.4 — 2026-05-12

- `ebb` CLI: `tick`, `install --laptop|--server`, `queue list`,
  `receipts list`, `register-wake`.
- macOS `launchd` plist generator and `pmset schedule wake`
  integration.
- `Scheduler.enqueueProviderCall(spec, opts)` + `Scheduler.tick`
  for cross-process drain.
- SQLite schema migration: `body_json` column.

### v0.3 — 2026-05-12

- `recommend_window` MCP tool + `recommendWindow()` library —
  planning endpoint that returns the chosen window without
  scheduling.
- Cursor and Claude Desktop example folders.
- `QUICKSTART.md` (now expanded with Troubleshooting in v0.5).

### v0.2 — 2026-05-12

- `AnthropicAdapter` and `OpenAIAdapter` with sync + Batch API paths.
- SQLite-backed durable queue.
- Python port: `ebb_ai` with `aiosqlite` persistence.
- Next.js dashboard at `apps/dashboard/` with 4 pages + 2 API routes.

### v0.1 — 2026-05-12

- Scheduler core (TypeScript): `defer`, `pickBestWindow`,
  `CarbonBudgetExceededError`, `InvalidDeadlineError`.
- `@ebb-ai/mcp` Model Context Protocol server with three tools
  over stdio.
- Mock + Electricity Maps grid feeds.
- Reference integrations for Claude Desktop, Claude Code,
  OpenClaw, Codex CLI.

---

## Up next

### v0.6 — target Q3 2026

- **WAL multi-writer SQLite.** Today's row-level claim already
  serializes concurrent ticks file-wide; v0.6 adds WAL mode so
  multiple schedulers + an `ebb tick` daemon can share one DB
  without serializing.
- **Webhook delivery.** `output: { webhook: "https://..." }`
  POSTs `{ taskId, result, receipt }` on completion. Pairs with
  the existing `output_path` file mode and the pull-by-id default.
- **Lenient deadline parser.** Accept `"tomorrow 8am"` and other
  human-readable inputs at the boundary, with a confirmation flow
  on ambiguous parses.
- **Stuck-running auto-recovery.** Tasks in `running` for more
  than one hour (configurable) auto-fail and become eligible for
  `retry_task`. v0.5 reports them; v0.6 acts.
- **Python `pyebb` CLI.** Same subcommand surface as the
  TypeScript `ebb` binary. Today's TS CLI covers operator
  deployments; v0.6 brings parity for Python-only shops.
- **Windows full daemonization.** `schtasks` template becomes a
  real installer with PowerShell scheduled-task creation +
  wake-from-sleep registration.

### v0.7

- **WattTime marginal-emissions feed.** Today's average-intensity
  feed (Electricity Maps) is good enough for v0.5; marginal
  emissions are the more honest climate signal for
  time-shifting. WattTime's API is the canonical source.
- **Per-model energy coefficients.** Replace today's
  `ENERGY_KWH_PER_TASK = 0.0015` constant with per-model figures
  drawn from Patterson et al. 2021 and Luccioni et al. 2023.
  Receipts gain calibrated carbon-per-token math.
- **Gemini and local-Ollama adapters.** Same `ProviderAdapter`
  surface; routing across providers becomes possible.
- **Upstream MCP spec PR(s).** The draft at
  [`docs/spec/01-priority-and-deadline-fields.md`](./docs/spec/01-priority-and-deadline-fields.md)
  goes upstream as a proposal for optional `priority`, `deadline`,
  and `carbon_budget` fields on `tools/call` envelopes.

### v0.8+

- **Cross-provider routing.** For a given prompt, pick the
  cheapest carbon-weighted route across {Anthropic, OpenAI,
  Gemini, local}.
- **Hosted live dashboard** (today the dashboard is self-hostable
  via Vercel; v0.8 adds an opt-in stats aggregator).
- **ESG/SEC-friendly carbon-receipt export.** CSV + JSON +
  monthly PDF for finance / sustainability teams.

### v1.0 — when the surface is stable

- Frozen public APIs across TypeScript and Python.
- Adapters for at least one ISO/RTO demand-response program
  (PJM / ERCOT / CAISO).
- Documented partner integrations with first-party MCP hosts.

---

## Deliberately not in scope

- **Generic job-scheduling.** ebb-ai is opinionated about agent /
  MCP layer scheduling with carbon awareness. For
  general-purpose work-queue needs (Sidekiq, Celery, BullMQ),
  use those.
- **Training carbon.** Inference is, by volume, already a larger
  workload than training in aggregate. Training has its own
  tooling (`codecarbon`, ML CO2 calculators). ebb-ai stays
  inference-focused.
- **Replacing the LLM provider.** ebb-ai routes through Anthropic,
  OpenAI, and (planned) Gemini and Ollama. It does not run a
  hosted LLM itself.

---

## How to influence the roadmap

- Open an issue with the `enhancement` label and the user story.
  See `.github/ISSUE_TEMPLATE/feature_request.md` for the shape.
- Propose a spec-level change against the draft at
  `docs/spec/01-priority-and-deadline-fields.md`.
- Send a PR. The contribution guide is at
  [`CONTRIBUTING.md`](./CONTRIBUTING.md).
