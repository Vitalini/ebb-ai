---
title: ebb ui v2 (task manager: actions, repeating tasks, reply, agenda/journal UI) - Plan
type: feat
date: 2026-10-15
topic: ebb-ui-v2
origin: docs/plans/2026-10-15-1219-feat-task-visibility-continuation-plan.md
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# ebb ui v2 (task manager: actions, repeating tasks, reply, agenda/journal UI) - Plan

## Goal Capsule

- **Objective:** A user who deferred tasks can run their queue from one local page: see a dated to-do list and a journal of finished work, cancel, move, run now or reply to a task, keep repeating tasks going without re-entering them, and jump back to the Claude Code session that created a task.
- **Means:** store-level task actions in core with cross-process conditional writes (KTD1 to KTD5), series rollover at the terminal transition (KTD6), history-aware provider adapters for reply (KTD7), write endpoints on the existing loopback server (KTD8, KTD9), a session id carried by the `/ebb-ai:defer` command (KTD10), and a dependency-free front end rebuilt on a small token set (KTD11 to KTD13).
- **Authority:** the orchestrator brief of 2026-10-15 ("ebb ui v2", decisions settled by Fable, not reopened here), then repository evidence, then the brainstorm `docs/plans/2026-10-15-1219-feat-task-visibility-continuation-plan.md` for reply design (R16 to R18, AE3, AE4). Where the brief and the repository disagree, the repository wins and the deviation is listed in Planning Contract / Deviations from the Brief.
- **Delivery shape:** two PRs from this plan. PR A (U1 to U10) on branch `feat/ui-v2-core`: core, Python storage parity, CLI, MCP, OpenClaw, `ebb ui` API, Claude Code plugin. PR B (U11 to U18) on branch `feat/ui-v2-frontend`, created from the PR A branch head: front end only, plus the static file map and a seed script. The v1 page keeps working on PR A.
- **Stop conditions:** stop and report if a unit needs a change to `selectWindow` or to the routing scorer; if the UI server would have to dispatch a provider call itself; if a gate fails twice the same way.
- **Execution profile:** core first (U1 to U4), then Python (U5), then hosts (U6, U7), then the UI API (U8), plugin (U9), docs (U10). PR B is sequential in unit order. No version bump in either PR; release 0.17.0 is cut after PR B, by a separate request.
- **Who finishes:** the pipeline ends at two open, reviewed PRs. Vitalii merges.

---

## Product Contract

Product Contract preservation: no upstream Product Contract for this scope. The brief is the source; brainstorm R16 to R18 (reply) are adopted with their IDs noted inline.

### Summary

`ebb ui` becomes a task manager. Three views (Agenda, Timeline, Journal) and a task detail drawer.
Tasks can be cancelled, rescheduled (also by drag and drop onto a day), run now, marked read or unread, and replied to.
Tasks can repeat daily, weekly or every quota reset; core enqueues the next occurrence when one finishes.
A task enqueued from Claude Code keeps the session id, and the detail shows a copyable resume command.
The UI server still never dispatches; it writes to the ledger and the dispatcher (`ebb tick` or the OpenClaw loop) runs the task.

### Problem Frame

`ebb ui` (PR #45) was rejected after a trial on a reference ledger (not in the repo). The ledger has ~60 tasks, all finished (31 cancelled, 22 completed, 6 failed), none with a title or origin, so v1 shows a list of task ids and an empty timeline. The page cannot act on a task: `packages/cli/src/ui/api.ts` routes only GET reads plus the read marker. Repeating work ("check my weekly limit list") has to be re-entered by hand. A finished task has no way back to the conversation that produced it.

### Key Decisions

All carried from the brief (session-settled 2026-10-15 by the orchestrator; `user-directed` because Vitalii stated the requirement and rejected the read-only v1):

- **Three views plus detail; Agenda is the default.** Governs R1 to R5. (session-settled: user-directed — chosen over the v1 timeline and inbox: "a to-do list with dates".)
- **Writes are allowed; the UI server never dispatches.** Run now and reschedule write to the store; a dispatcher executes. Governs R6 to R11. (session-settled: user-directed — chosen over v1's read-only page and over in-process dispatch from the UI server.)
- **Start dispatcher spawns `ebb tick` as a detached child.** Governs R11. (session-settled: user-directed — chosen over telling the user to run a command.)
- **Repeat is a task rule (`none | daily | weekly | quota_reset`) with a `series_id`; `repeat` defaults to `none` for every task, including `quota_reset` ones; repeating is opt-in.** Governs R12 to R14. (session-settled: user-directed — chosen over a separate "weekly limit list" entity; default `none` decided by Vitalii on Q1, 2026-10-15.)
- **Continue = reply through the provider (brainstorm D(1)) plus a `claude --resume` line; no agent runner.** Governs R15 to R17. (session-settled: user-approved in the brainstorm, re-confirmed by the brief.)
- **Dependency-free front end, no build step.** Governs R18 to R21. (session-settled: user-directed — chosen over a framework build.)
- **Security model unchanged; token in an `Authorization` header on every POST, never a cookie.** Governs R22. (session-settled: user-directed.)

### Requirements

**Views**

- R1. Agenda (default view) lists pending tasks grouped by local day: Today, Tomorrow, then weekday plus date, then Later. Overdue tasks (scheduled time passed, still pending) and failed tasks that are unread surface in a section at the top.
- R2. An agenda row shows title, scheduled hour with the carbon band label, deadline, kind badge (absolute, quota reset, repeats daily or weekly), provider and model, and an unread dot. A day header shows that day's cleanest forecast hour when the forecast covers the day.
- R3. Timeline is the forecast curve with task markers, restyled with the same tokens and row anatomy.
- R4. Journal lists finished tasks (completed, failed, cancelled), newest first, filterable by status, provider and kind. A row expands to the result summary, receipt verification state and gCO2.
- R5. Task detail shows prompt, result as text (raw JSON collapsed), message history, receipt, origin (host, cwd, session), parent and children, series history, and the actions allowed for the task's state.

**Actions**

- R6. Cancel a pending task (queued, scheduled, submitted, running). For a series occurrence, cancel skips this occurrence; "stop series" cancels it and ends the series.
- R7. Reschedule a pending, not-yet-claimed task to a new deadline, to an exact time, or to a local day (drag and drop onto a day header). The task keeps its carbon window choice inside the new bounds.
- R8. Run now marks a pending task due at once; the next dispatcher tick runs it, bypassing the carbon window and the Batch API. Its receipt records `intensitySource: "expedited"`.
- R9. Mark read and unread (exists in v1; kept).
- R10. Reply to a completed task: a child task with the parent's history plus the new user turn, through the same provider and model, default deadline one hour ahead (brainstorm R16, R17). No reply on failed or cancelled tasks (brainstorm AE4). Available from the UI, `ebb queue reply <id> "<text>"` and MCP/OpenClaw `reply_task`.
- R11. The UI says "runs on the next tick" after a write and shows the dispatcher state. When no dispatcher ran within the stale threshold and none is running, the UI offers Start dispatcher, which spawns `ebb tick --daemon` against the same ledger and shows its PID and log path.

**Repeating tasks**

- R12. A task may carry `repeat` (`none`, `daily`, `weekly`, `quota_reset`) and belongs to a series identified by `series_id` (the first occurrence's task id).
- R13. When an occurrence finishes (completed, failed, or cancelled as a skip), core enqueues the next occurrence with the same request body and the next deadline, exactly once even with two dispatchers. A stopped series enqueues nothing.
- R14. `repeat` defaults to `none` for every task, including `deadline_kind: "quota_reset"`. Repeating is opt-in: `repeat: "weekly"` (or `daily`, or `quota_reset` to follow the provider's reset) on `schedule_task`, `--repeat weekly` on `/ebb-ai:defer`. The weekly limit list is the set of series whose repeat is `weekly` or `quota_reset`.

**Return to the session**

- R15. A task enqueued through `/ebb-ai:defer` stores `origin_session_id` when Claude Code provides one.
- R16. The detail shows `cd <cwd> && claude --resume <session_id>` with a copy button when both values exist.
- R17. The detail and `ebb queue show` display the reply chain: parent link, children, history in order (brainstorm R18).

**Front end quality**

- R18. A token set defines colours (light and dark, carbon band colours), type scale and 8-point spacing; every view uses only tokens.
- R19. Keyboard: j/k move, Enter opens, Esc closes, c cancel, r reschedule, plus the map in the design spec. Every action reachable by mouse is reachable by keyboard and by touch.
- R20. Empty, loading (skeleton) and error states exist for each view. Writes are optimistic and confirmed by the SSE stream; cancel shows a toast with Undo.
- R21. Native HTML5 drag and drop with a visible drop target and a keyboard alternative. Mobile width (360 px) works without a mouse.

**Security**

- R22. Loopback bind, Host and Origin allow-list, per-run token in memory, POST for every write, CSP, no CORS. POST requires the bearer header and a JSON content type; no cookie is ever set.

### Scope Boundaries

- No unattended agent runner, no `needs_input` state (brainstorm D(2), deferred).
- No task creation from the UI (enqueue stays with MCP, OpenClaw and the library).
- No provider-side cancel for a submitted batch (existing warning stays).
- Python core: storage columns only (see U5). The Python ticker neither rolls a series nor sends reply history.
- No new Claude Code slash command for reply; `/ebb-ai:check` and the UI cover it.

### Deferred to Follow-Up Work

- A "resume series" action for a series stopped by a failed successor.
- Stopping a dispatcher started by the UI from the UI (PR A shows PID and log; the user stops it with `kill`).

### Success Criteria

- On a reference ledger with ~60 tasks (not in the repo), Agenda shows no pending tasks (the empty state, or only Needs attention rows for unread failed tasks) with the next action, Journal lists all tasks with readable titles, and every detail opens.
- On the seeded ledger, every action in the PR B smoke list passes and screenshots exist in the session scratchpad.
- Two dispatchers running against one ledger never produce two successors for one occurrence (test).

### Outstanding Questions

Deferred to implementation unless marked otherwise; see Planning Contract / Open Questions.

### Sources

- Brief: <session notes, not in the repo>.
- `docs/plans/2026-10-15-1219-feat-task-visibility-continuation-plan.md` (reply design R16 to R18, AE3, AE4).
- `docs/plans/2026-10-15-1437-feat-task-visibility-pr1-plan.md` (PR 1a/1b structure and gates).
- `docs/solutions/best-practices/loopback-web-ui-hardening.md`, `docs/solutions/logic-errors/quota-reset-deadlines.md`, `docs/solutions/tooling-decisions/tool-surface-shared-descriptions.md`.

---

## Planning Contract

### Repository Facts This Plan Relies On

- Core already has `cancelTask`, `expediteTask`, `updateDeadline`, `rescheduleIfPending`, `retryTask`, `markTaskRead`, `markTaskUnread` (`packages/core-ts/src/scheduler.ts:371-1020`). `cancelTask` sets `completedAt`, redacts the body and writes with an unconditional `upsert`; it reads the in-memory cache first (`resolveTask`).
- `expediteTask` dispatches in-process with adapters; it is not usable by a server that must not dispatch.
- The dispatcher already drops a late result for a task cancelled in another process (`scheduler.ts:1626-1645` reads the store before finalizing).
- `TaskStore` has `updateIfPending` (conditional on `queued`/`scheduled`), `claimScheduled`, `claimSubmitted`, `markRead/markUnread`, `dataVersion`, meta get/set (`packages/core-ts/src/storage/sqlite.ts`). Identity columns are insert-only in `upsert`.
- There is no shared post-task step. The shared step is pre-tick: `prepareTick` (`packages/core-ts/src/quota.ts:335`) records `last_tick_at` and sweeps passed quota deadlines; `ebb tick` (`packages/cli/src/commands/tick.ts:285`) and the OpenClaw loop (`packages/openclaw-plugin/src/index.ts:404`) both call it. OS notification after a tick is CLI-only (`notifyFinished`).
- Terminal transitions redact secrets out of `body_json` (`redactBodyJson`, `packages/core-ts/src/redact.ts:63`); failed tasks keep the original body for retry.
- History is stored in `body_json.messages` and read by `taskHistory` (`packages/core-ts/src/history.ts:84`), but no adapter sends it: Anthropic sends one user message (`packages/core-ts/src/providers/anthropic.ts:290`); OpenAI and Ollama send system plus prompt.
- `cancel_task` already exists on MCP (`packages/mcp-server/src/server.ts:741`) and OpenClaw (`packages/openclaw-plugin/src/index.ts:934`). `reply_task` does not exist. MCP stdio smoke expects 9 tools (`packages/mcp-server/scripts/smoke-stdio.mjs:17`).
- `ebb ui` server holds a `TaskStore` only, no `Scheduler`; routes are matched by hand in `handleApi`; POST bodies are never read; static files come from a fixed three-entry map (`packages/cli/src/ui/server.ts:41`).
- `ebb tick --daemon --interval <s>` exists (`packages/cli/src/index.ts:51-58`). The installed daemon runs every 300 s by default (`packages/cli/src/commands/install.ts:49`). With no provider key, `runTickOnce` returns before `prepareTick`, so `last_tick_at` is not written.
- `install.ts` resolves the exact `ebb` launcher with `resolveLauncher` (private today).
- The Claude Code plugin enqueues through MCP `schedule_task` from `packages/claude-code-plugin/commands/defer.md`; its only hook is SessionStart (`hooks/hooks.json`). Claude Code 2.1.301 substitutes `${CLAUDE_SESSION_ID}` in command and skill text and exports `CLAUDE_CODE_SESSION_ID` to child processes (checked in the installed binary).
- The MCP server records `originCwd` from its process cwd (`server.ts:351-356`).
- No Playwright dependency exists anywhere in the repo.
- Forecast horizon is 72 hours (`MAX_HORIZON_HOURS`, `scheduler.ts:63`).

### Deviations from the Brief

| # | Brief says | Repository shows | Plan does |
|---|---|---|---|
| D1 | Add MCP `cancel_task` (OpenClaw parity) | `cancel_task` exists on both hosts | Only `reply_task` is new; `cancel_task` gains an optional `series` flag on both hosts |
| D2 | Store `cancelled_at` | `cancelTask` already writes `completed_at` with status `cancelled` | No `cancelled_at` column; Journal sorts on `completed_at` |
| D3 | Repeat rollover "in the shared post-task step" | No post-task step exists; the shared step is pre-tick; bodies are redacted at the terminal write | Rollover runs inside `Scheduler` at the terminal transition, before redaction (KTD6); covers tick, OpenClaw loop, expedite, retry and cancel |
| D4 | "Hook passes session id" | Hooks do not enqueue; `/ebb-ai:defer` calls MCP `schedule_task` | The defer command passes `origin_session_id: "${CLAUDE_SESSION_ID}"`; no env fallback (KTD10) |
| D5 | Run now | `expediteTask` dispatches in-process; a run-now row with a deadline over 24 h away would be submitted to the Batch API by the next tick | New write-only `runNow` with an `expedited` marker that the batch sweep skips (KTD3) |
| D6 | Reply = PR 2 of brainstorm | No adapter sends history today | PR A extends all four adapters, sync and batch (U3) |
| D7 | Undo for cancel | Cancel is terminal and redacts the body | Undo is a delayed commit in the page (5 s); no un-cancel API (KTD12) |
| D8 | Agenda shows one row per upcoming occurrence | Only the next occurrence exists as a task | Later occurrences are projected rows, drawn from the series rule, not draggable |
| D9 | Playwright smoke | No Playwright in the repo; the front end stays dependency-free | Repo gets a seed script; the smoke runs through the Playwright MCP browser in a QA agent; no new devDependency (U18) |
| D10 | (implicit) rows have titles | Real ledger: 59 of 59 rows have no title or origin | List summaries carry `display_title` derived from the redacted prompt when `title` is null |
| D11 | (implicit) UI server can reschedule | UI server has no `Scheduler`, so no window picker | `startUiServer` builds a `Scheduler` on the same ledger and feed for writes; every action re-reads the row from the store first |
| D12 | Dispatcher state from last tick | No-key ticks write no `last_tick_at` | Dispatcher state combines `last_tick_at`, daemon install status and the liveness of a UI-started child |
| D13 | Front end changes only in PR B | Static map is fixed in `server.ts` | PR B edits `server.ts` only to extend the static map |

### Key Technical Decisions

- KTD1. **Every write path re-reads the row and writes with a status compare-and-set.** New `TaskStore.transitionIf(record, expectedStatuses)` updates the mutable columns `WHERE task_id = ? AND status IN (...)` and returns whether it wrote. `cancelTask` keeps its signature and idempotency but refreshes from the store and uses `transitionIf`; on a miss it re-reads and returns the current row (terminal) or retries once (claimed meanwhile). The dispatcher side re-reads too: after a successful `claimScheduled` or `claimSubmitted` in `tick()`, the row is re-read from the store, replaces the cached record, and batch eligibility (`expedited`, `notBefore`, deadline) is checked again on the fresh row before `submitBatch` or `dispatchProviderCall`. Reason: the UI and CLI are separate, long-lived processes, and the OpenClaw loop keeps one long-lived `Scheduler` whose cache would otherwise dispatch a row with the deadline and markers it read before the UI wrote; the v1 cache plus unconditional upsert could also overwrite a completion written by a ticker.
- KTD2. **Allowed actions are computed in core, not in the page.** `taskActions(record)` in `packages/core-ts/src/history.ts` returns `{cancel, stopSeries, reschedule, runNow, reply, markRead}` from status, body presence and series. The API returns it as `actions`; CLI and MCP error messages use the same rules. Reason: the later native app reads the same API.
- KTD3. **Run now is a write, marked `expedited`.** `Scheduler.runNow(taskId)` sets `status = scheduled`, `scheduledFor = now`, `intensitySource = "expedited"`, `notBefore` cleared, through `transitionIf(['queued','scheduled'])`. `collectBatchSubmitCandidates` skips rows whose `intensitySource` is `expedited`; `dispatchProviderCall` keeps `expedited` instead of overwriting it with the window source. Closure tasks (no `bodyJson`) are refused. `expediteTask` stays for MCP and OpenClaw.
- KTD4. **Reschedule has three targets; pinned targets carry a persisted `not_before`.** `Scheduler.rescheduleTask(taskId, target)` with `target` one of `{deadline}` (window picker up to the new deadline, as `updateDeadline`; clears `notBefore`), `{at}` (exact time: `scheduledFor = at`, `notBefore = at`, `deadline = max(deadline, at)`, no picker) or `{dayStart, dayEnd}` (`notBefore = dayStart`, `deadline = dayEnd`; forecast entries before `notBefore` are filtered out before `selectWindow`). The window filter is applied in `scheduleProviderCall` via the record's `notBefore`; `selectWindow` is untouched. When the forecast does not reach `notBefore` yet, the row is written `scheduled` at a fallback time (dayStart plus the task's current hour-of-day offset, clamped into the day) with `estimatedCarbonGCo2` null, which marks it unplanned. Two rules make the marker work: `collectBatchSubmitCandidates` skips rows whose `notBefore` is in the future (otherwise a deadline over 24 h away is batch-submitted on the next tick, ignoring `scheduledFor`), and a new `replanSweep` inside `prepareTick` re-scores unplanned `scheduled` rows once `notBefore` is within the 72 h horizon, through `rescheduleIfPending` (conditional write). Day bounds come from the client as ISO instants, so the server needs no time zone. Only `queued`/`scheduled` rows; a `quota_reset` row becomes `absolute` (as `updateDeadline` with `deadlineKind: "absolute"`).
- KTD5. **Reply builds a child from the parent's stored spec.** `Scheduler.replyToTask(parentId, text, opts)` requires a completed provider-call parent, copies provider, model, region, `redactInReceipt`, sets `messages = taskHistory(parent)` (prior turns, parent prompt, parent reply), `prompt = text`, `parentTaskId = parentId`, deadline default now + 1 h, title default "Re: <parent display title>" cut by `deriveTitle`, and enqueues through `enqueueProviderCall`. The parent history is the redacted form; that is what the user saw. Children never repeat.
- KTD6. **Series rollover lives at the terminal transition, before redaction, is insert-once, and needs no feed.** A private `rollSeries(record, spec)` runs when an occurrence with `repeat != none` turns completed, failed, or cancelled-as-skip, before the body is redacted. It first re-reads the occurrence row and skips when the stored `repeat` is `none` (a "stop series" written by another process while the occurrence was running). The successor id is deterministic: `<series_id>~<n+1>`, where `n` is parsed from the current id (`series_id` itself is occurrence 1). It is written with new `TaskStore.insertIfAbsent` (INSERT ... ON CONFLICT DO NOTHING), so two dispatchers create one successor. The successor is inserted before the occurrence's own terminal write, so a crash between the two writes leaves the series alive. The successor is inserted already `scheduled`, unplanned (KTD4): `notBefore` = the previous occurrence's deadline (start of the new period), `scheduledFor` = new deadline minus one hour, `estimatedCarbonGCo2` null. `replanSweep` gives it a carbon window once its period is inside the forecast horizon, and the batch sweep leaves it alone until `notBefore`. So rollover never fetches a forecast, `cancelTask` stays synchronous, and no successor can strand in `queued`. Next deadline: `daily` +24 h, `weekly` +7 days from the previous deadline, rolled forward until at least one hour ahead. For `repeat = quota_reset` the successor's kind and label come from the series rule, not from the finishing occurrence: kind `quota_reset`, label = the newest `quotaProvider` stored on any occurrence of the series, deadline = the next reset minus margin when a quota config is passed to `Scheduler` (new optional `quotaConfig` getter), else previous deadline +7 days; the quota sweep corrects drift. So moving one occurrence (which makes that row absolute) does not detach the series from the reset. A budget failure of a successor at re-plan time fails it and does not roll again (no recursion). "Stop series" sets `repeat = none` on the pending occurrence in the same CAS write that cancels it.
- KTD7. **History reaches the provider through `DispatchOptions.messages`.** `DispatchOptions` gains `messages?: TaskMessage[]` (prior turns). Anthropic, OpenAI, Gemini and Ollama prepend them in order before the current prompt, sync and batch. `dispatchProviderCall` and `submitBatch` pass `spec.messages`. Brainstorm AE3 is the acceptance test.
- KTD8. **The UI server writes through a `Scheduler`, emits its own changes.** `startUiServer` creates one `Scheduler` with the same `dbPath`, feed and default region, used only for actions; reads keep using the `TaskStore`. Every action handler returns `changedIds` so the SSE stream fires immediately. The handler never passes adapters, so it cannot dispatch.
- KTD9. **POST hardening.** Every `/api/*` POST requires `Authorization: Bearer` plus the Host and Origin checks. Routes that read a body (cancel, reschedule, reply) also require `Content-Type: application/json` (415 otherwise; a cross-site form cannot send it without a preflight, which the server never answers with CORS) and a body of at most 64 KiB (413). Body-less routes (read, unread, run-now, dispatcher/start) accept an empty body with no content type, so the v1 page's mark-read POST keeps working on PR A; a non-empty body there gives 400. Bodies are parsed with a strict shape check per route; unknown fields give 400. No cookie is ever set. Error bodies stay generic.
- KTD10. **Session id comes from the command text, validated at the host.** `/ebb-ai:defer` passes `origin_session_id: "${CLAUDE_SESSION_ID}"`. The MCP handler stores it only if it matches `^[A-Za-z0-9_-]{8,128}$` (an unsubstituted `${...}` literal fails and is dropped). No fallback to the `CLAUDE_CODE_SESSION_ID` env of the MCP process: the MCP server outlives `/clear`, so that value can name the wrong conversation. `origin_session_id` is an MCP-only schedule param (`hosts: ["mcp"]`).
- KTD11. **Front end is plain ES modules served from a fixed map.** `index.html` loads `app.js` as a module; other modules are listed explicitly in `STATIC_FILES`. No bundler, no framework, no remote resource. All task strings go through `textContent`.
- KTD12. **Optimistic writes with SSE confirmation; cancel undo is a delayed commit.** The page applies an action locally, marks the row pending, and sends the POST. The row is confirmed when an SSE `tasks` event names it and a re-fetch shows the new state; a 4xx/5xx rolls back and shows an error toast. Cancel waits 5 s behind an Undo toast before the POST; `pagehide` flushes pending cancels with `fetch(..., {keepalive: true})`.
- KTD13. **Dispatcher start reuses the install launcher.** `resolveLauncher` is exported from `install.ts`. `POST /api/dispatcher/start` spawns `[launcher..., "tick", "--daemon", "--interval", "60", "--db", dbPath]` detached with stdout and stderr appended to `~/.ebb-ai/logs/ui-tick.log` (dir mode 0700), stores `{pid, log, started_at}` in ledger meta key `ui_dispatcher`, and refuses (409) while that PID is alive. Dispatcher state: `running` (UI child alive, or `last_tick_at` within 2 × interval, interval 300 s when the daemon is installed, else 60 s), `stale`, or `never`.

### High-Level Technical Design

Directional only.

```
browser (token in memory)
   | GET /api/tasks, /api/tasks/:id, /api/series/:id, /api/status, /api/forecast
   | POST /api/tasks/:id/{cancel,reschedule,run-now,reply,read,unread}, /api/dispatcher/start
   | SSE /api/events  <---- TaskEvents (data_version poll + emit on own writes)
   v
ebb ui server --reads--> TaskStore ----\
              --writes-> Scheduler (no adapters) --transitionIf / insertIfAbsent--> queue.db
                                                                       ^
ebb tick daemon / OpenClaw loop: prepareTick -> tick(adapters) --------/
        terminal transition -> rollSeries (successor insert) -> terminal CAS write -> redact
```

Series lifecycle:

```
occ1 (series_id = occ1.id, repeat weekly)
  scheduled --tick--> completed ---> insertIfAbsent(occ1~2, deadline +7d) ---> scheduled ...
  scheduled --cancel(skip)--> cancelled ---> occ1~2
  scheduled --cancel(series)--> cancelled, repeat=none ---> (no successor)
```

### Implementation Constraints

- No version bump, no release, no lockfile change in either PR.
- New core exports go through `packages/core-ts/src/index.ts`; `environment-purity.test.ts` must stay green (core reads no env).
- Tool names, params and descriptions change only in `TOOL_SURFACE`; regenerate and read the snapshot.
- Front end: no dependency, no build step, no inline script or style (CSP), no `innerHTML` with data.
- PR B must not change any API contract shipped in PR A; a missing field is a PR A follow-up commit on the PR A branch before PR B rebases.

### Assumptions

- The 5 s undo window and the 60 s interval of a UI-started dispatcher are acceptable defaults.
- `display_title` derived at read time (D10) needs no backfill write.
- The quota-reset default of R14 applies to new tasks only; existing quota tasks keep `repeat` null (treated as `none`).

### Open Questions

- Q1 (answered 2026-10-15 by Vitalii). A `quota_reset` task does NOT repeat by default; `repeat` defaults to `none` everywhere, and `weekly` is opt-in (`--repeat weekly`, `schedule_task.repeat`). The `schedule_task` description and the defer command say so.
- Q2 (affects U2, U4; not blocking). A day target or series successor beyond the 72 h forecast sits at a fallback hour until `replanSweep` re-scores it. If no dispatcher runs between the moment the day enters the horizon and the fallback hour, it runs at the fallback hour with no carbon choice. Accepted as the default (answered 2026-10-15; documented in the CLI README).
- Q3 (affects U5; deferred). A Python ticker on the same ledger would dispatch a reply child without history and would not roll a series. Plan: document it; making the Python ticker skip such rows is out of scope (accepted 2026-10-15; documented in CHANGELOG and the `tick` docstring).

### Sequencing

PR A: U1 -> U2 -> U3 -> U4 -> U5 -> U6 -> U7 -> U8 -> U9 -> U10. U3 is independent of U2 and may run in either order; U5 depends only on U1.
PR B: U11 -> U12 -> U13 -> U14 -> U15 -> U16 -> U17 -> U18, on top of the PR A branch head.

---

## Implementation Units

### Unit Index

| U-ID | Title | Key files | Depends on |
|---|---|---|---|
| U1 | Series, repeat, session columns and CAS store writes | `packages/core-ts/src/types.ts`, `packages/core-ts/src/storage/sqlite.ts`, `packages/core-ts/src/scheduler.ts` | — |
| U2 | Core task actions (cancel CAS, run now, reschedule, reply, allowed actions) | `packages/core-ts/src/scheduler.ts`, `packages/core-ts/src/history.ts`, `packages/core-ts/src/index.ts` | U1 |
| U3 | History-aware provider adapters | `packages/core-ts/src/providers/*.ts`, `packages/core-ts/src/scheduler.ts` | — |
| U4 | Series rollover and re-plan sweep | `packages/core-ts/src/scheduler.ts`, `packages/core-ts/src/quota.ts` | U1, U2 |
| U5 | Python storage parity | `packages/core-py/src/ebb_ai/scheduler.py` | U1 |
| U6 | Tool surface, MCP and OpenClaw | `packages/core-ts/src/tool-surface.ts`, `packages/mcp-server/src/server.ts`, `packages/openclaw-plugin/src/index.ts` | U2, U4 |
| U7 | CLI queue write commands | `packages/cli/src/index.ts`, `packages/cli/src/commands/queue.ts` | U2 |
| U8 | `ebb ui` write API and Start dispatcher | `packages/cli/src/ui/*.ts`, `packages/cli/src/commands/ui.ts`, `packages/cli/src/commands/install.ts` | U2, U4 |
| U9 | Claude Code plugin passes the session id | `packages/claude-code-plugin/commands/defer.md` | U6 |
| U10 | PR A docs and CHANGELOG | `CHANGELOG.md`, package READMEs, `docs/solutions/...` | U1-U9 |
| U11 | Tokens, shell and static map | `packages/cli/ui/tokens.css`, `packages/cli/ui/app.css`, `packages/cli/ui/index.html`, `packages/cli/src/ui/server.ts` | PR A |
| U12 | Data layer: API client, state, SSE, toasts | `packages/cli/ui/api.js`, `packages/cli/ui/state.js`, `packages/cli/ui/toast.js`, `packages/cli/ui/dom.js`, `packages/cli/ui/app.js` | U11 |
| U13 | Agenda view | `packages/cli/ui/agenda.js`, `packages/cli/ui/row.js` | U12 |
| U14 | Task detail drawer | `packages/cli/ui/detail.js` | U12 |
| U15 | Journal view | `packages/cli/ui/journal.js` | U12, U13 |
| U16 | Timeline restyle | `packages/cli/ui/timeline.js` | U12 |
| U17 | Drag and drop, keyboard, reschedule dialog, dispatcher banner | `packages/cli/ui/dnd.js`, `packages/cli/ui/keys.js`, `packages/cli/ui/dialog.js` | U13, U14 |
| U18 | Seed script, smoke, asset tests, CHANGELOG | `scripts/ui-seed.mjs`, `packages/cli/test/ui-server.test.ts`, `CHANGELOG.md` | U11-U17 |

### PR A — core, CLI, API

#### U1. Series, repeat, session columns and CAS store writes

- **Goal:** the ledger can hold series membership, the repeat rule and the Claude Code session, and supports compare-and-set and insert-once writes.
- **Requirements:** R12, R13, R15, R6 (CAS), KTD1, KTD6.
- **Files:** `packages/core-ts/src/types.ts` (`TaskRecord.seriesId`, `repeat`, `originSessionId`, `notBefore`; `RepeatRule` type; `DeferOptions.repeat`, `originSessionId`), `packages/core-ts/src/storage/sqlite.ts` (columns `series_id`, `repeat`, `origin_session_id`, `not_before`; `not_before` is mutable and written by upsert, `updateIfPending` and `transitionIf`; index `tasks_series_idx`; `series_id` and `origin_session_id` insert-only, `repeat` updated only by `transitionIf`; `insertIfAbsent`; `transitionIf`; `TaskListFilter.seriesId`; header comment), `packages/core-ts/src/scheduler.ts` (`identityFields` writes the new fields; `validateRepeat`: repeat needs a provider-call task; repeat defaults to `none` for every kind (Q1); a repeating task's `seriesId` defaults to its own id).
- **Approach:** follow the v0.17 `addColumn` pattern. `transitionIf` writes the same column set as `updateIfPending` plus `completed_at`, `result_json`, `receipt_json`, `intensity_source`, `repeat`, with a caller-given status list.
- **Test scenarios** (`packages/core-ts/test/storage.test.ts`, `packages/core-ts/test/scheduler.test.ts`):
  - a v0.16-shaped ledger gains the four columns and the index; reopening is a no-op;
  - upsert never overwrites `series_id` or `origin_session_id`; `transitionIf` writes `repeat`;
  - `transitionIf` returns false and writes nothing when status is outside the list;
  - `insertIfAbsent` returns true once and false for the same id, leaving the first row unchanged;
  - enqueue with `deadlineKind: "quota_reset"` and no repeat stores `repeat = none` and no series; with `repeat: "weekly"` stores weekly and `series_id = task id`;
  - `repeat` on a closure task throws; an unknown repeat value throws.
- **Verification:** `pnpm --filter @ebb-ai/core test`, `pnpm --filter @ebb-ai/core typecheck`.

#### U2. Core task actions

- **Goal:** cancel, stop series, run now, reschedule and reply are safe to call from any process, and the allowed actions are computed once.
- **Requirements:** R6, R7, R8, R10, R17, KTD1 to KTD5.
- **Files:** `packages/core-ts/src/scheduler.ts` (`cancelTask(taskId, {series?})` refreshed + CAS; `runNow`; `rescheduleTask`; `replyToTask`; `scheduleProviderCall` honours `notBefore`; batch sweep skips `expedited` and future `notBefore`; `tick()` re-reads each claimed row (KTD1); `dispatchProviderCall` keeps `expedited`), `packages/core-ts/src/history.ts` (`taskActions`, `displayTitle`), `packages/core-ts/src/index.ts`.
- **Approach:** each action starts with `store.get` (fresh row), checks `taskActions`, writes with `transitionIf`, and updates the cache from the written record. Errors use one message style: `<action>: task <id> is <status>; <what is allowed>`. `displayTitle(record)` = `title ?? deriveTitle(taskPrompt(record))` (redacted).
- **Test scenarios** (new `packages/core-ts/test/task-actions.test.ts`; additions to `packages/core-ts/test/cross-process.test.ts`):
  - cancel from a second `Scheduler` on the same file while the first holds a cached `scheduled` copy: row ends cancelled; a ticker that claimed first wins and cancel returns the running row marked cancelled (late result dropped, existing behaviour);
  - cancel on a completed row returns it unchanged (idempotent);
  - cancel `{series: true}` sets `repeat = none`;
  - runNow sets scheduledFor ≤ now and `expedited`; next `tick` dispatches it even with deadline 3 days ahead and a batch-capable adapter (no batch submit); receipt `intensitySource` is `expedited`;
  - runNow on running, terminal or closure tasks throws;
  - reschedule `{deadline}` re-runs the picker; `{at}` pins scheduledFor exactly and raises deadline; `{dayStart, dayEnd}` with a covering forecast picks an hour inside the day; with a day beyond the forecast pins at the same hour-of-day inside the day; a quota_reset row becomes absolute;
  - a day target four days ahead and an `{at}` three days ahead, with a batch-capable adapter: the next tick does not batch-submit them; once `notBefore` is inside the horizon `replanSweep` gives a window inside the day;
  - long-lived scheduler that has ticked once; `runNow` from a second scheduler on a row with a 3-day deadline; the first scheduler's next tick dispatches it sync with no batch submit (stale-cache guard);
  - reschedule on running/submitted/terminal rows throws;
  - reply on a completed task creates a child with `parentTaskId`, history of 3 turns (AE3 shape), same provider/model/region, deadline ≈ now + 1 h, `repeat` none; reply on failed or cancelled throws (AE4);
  - `taskActions` table test across all statuses, closure vs provider-call, series vs not;
  - `displayTitle` on a row without title returns the redacted first prompt line.
- **Verification:** `pnpm --filter @ebb-ai/core test`.

#### U3. History-aware provider adapters

- **Goal:** a reply child sends the full conversation.
- **Requirements:** R10, brainstorm R17, KTD7.
- **Files:** `packages/core-ts/src/providers/base.ts`, `packages/core-ts/src/providers/anthropic.ts`, `packages/core-ts/src/providers/openai.ts`, `packages/core-ts/src/providers/gemini.ts`, `packages/core-ts/src/providers/ollama.ts`, `packages/core-ts/src/scheduler.ts` (pass `spec.messages` in sync dispatch and `submitBatch`).
- **Approach:** prior turns map to each vendor's role names (Gemini uses `model` for assistant). Order: system (where the vendor takes it in the list), prior turns, current user prompt. No messages means today's request, byte for byte.
- **Test scenarios** (`packages/core-ts/test/providers.test.ts`, `packages/core-ts/test/providers-gemini-ollama.test.ts`, `packages/core-ts/test/batch.test.ts`):
  - each adapter, sync: request body carries the turns in order then the prompt;
  - Anthropic and OpenAI batch request lines carry the turns;
  - no messages: request equals the current fixture (regression);
  - end to end through `tick` with a recording adapter: a reply child dispatches 3 turns (AE3).
- **Verification:** `pnpm --filter @ebb-ai/core test`.

#### U4. Series rollover

- **Goal:** a repeating task keeps coming back exactly once per finished occurrence.
- **Requirements:** R12, R13, R14, KTD6.
- **Files:** `packages/core-ts/src/scheduler.ts` (`rollSeries`; call sites: completed and failed in `dispatchProviderCall`, completed and failed in `pollBatch`, `failTask` for a dispatched occurrence, `cancelTask` skip), `packages/core-ts/src/quota.ts` (`replanSweep` added to `prepareTick` after the quota sweep; doc comment), `packages/core-ts/src/types.ts` (`SchedulerOptions.quotaConfig`), `packages/cli/src/commands/tick.ts`, `packages/openclaw-plugin/src/index.ts` (pass `quotaConfig` to the `Scheduler`).
- **Approach:** as KTD6. Successor copies the pre-redaction body, `region`, `carbonBudgetG`, `title`, `originHost`, `originCwd`, `originSessionId`, `repeat`, `seriesId`; kind and quota label come from the series rule; `parentTaskId` stays empty (series is not a reply chain). The successor is inserted `scheduled` and unplanned; no forecast fetch happens in rollover. Rollover failures are logged and never fail the finishing occurrence.
- **Test scenarios** (new `packages/core-ts/test/series.test.ts`; `packages/core-ts/test/quota.test.ts`):
  - weekly occurrence completes: one successor `<id>~2`, deadline +7 d, same prompt (unredacted even when the prompt has a key-looking string, while the finished row is redacted);
  - daily occurrence whose next deadline is in the past rolls forward to the first future day;
  - failed occurrence rolls; cancelled skip rolls; stop series does not;
  - two `Scheduler` instances finishing the same occurrence path (simulated double terminal) produce one successor;
  - weekly successor: `notBefore` = previous deadline, `scheduledFor` ≥ previous deadline, not batch-submitted by the next tick; `replanSweep` gives it a window inside its period once in range; budget failure at re-plan: successor failed and no `~3` appears;
  - cancel-as-skip from a synchronous `cancelTask` leaves a `scheduled` successor (never `queued`);
  - stop series while the occurrence is running, then the provider call fails or completes: no successor;
  - reschedule one occurrence of a quota_reset series (row becomes absolute), complete it: the successor is `quota_reset` with the series label;
  - quota_reset series: successor keeps kind and label; `sweepQuotaDeadlines` re-resolves it after a reset passes;
  - a reply child never rolls.
- **Verification:** `pnpm --filter @ebb-ai/core test`.

#### U5. Python storage parity

- **Goal:** the Python core opens a v2 ledger and keeps the new columns intact.
- **Requirements:** R12, R15 (storage only), Q3.
- **Files:** `packages/core-py/src/ebb_ai/scheduler.py` (add `series_id`, `repeat`, `origin_session_id` to the visibility migration; `tasks_series_idx`; leave them out of the upsert UPDATE list), `packages/core-py/tests/test_task_visibility.py`.
- **Approach:** columns only. No rollover, no history dispatch, no new Python API. A docstring note on `tick` states that reply history and series rollover are TS-only.
- **Test scenarios:** a Python-created ledger has the columns; a TS-shaped row with all three fields survives a Python status transition and upsert unchanged.
- **Verification:** `cd packages/core-py && .venv/bin/ruff check . && .venv/bin/pytest -q`.

#### U6. Tool surface, MCP and OpenClaw

- **Goal:** agents can reply, stop a series and enqueue repeating tasks; Claude Code tasks carry their session.
- **Requirements:** R6, R10, R12, R14, R15, D1, KTD10.
- **Files:** `packages/core-ts/src/tool-surface.ts` (`reply_task` on both hosts with `task_id`, `text`, optional `deadline`; `cancel_task` gains optional `series` boolean on both hosts; `schedule_task` gains `repeat` and `origin_session_id`, MCP only), `packages/core-ts/test/__snapshots__/tool-surface.test.ts.snap`, `packages/mcp-server/src/server.ts` (handlers; `check_queue_status` detail prints series, repeat, session, parent and children), `packages/mcp-server/scripts/smoke-stdio.mjs` (`EXPECTED_TOOLS = 10`), `packages/openclaw-plugin/src/index.ts`, `packages/openclaw-plugin/src/tool-schemas.ts` if it mirrors the surface.
- **Approach:** descriptions state side effects ("creates a new task that runs at the next window; costs one provider call"; "repeat defaults to none, also for deadline_kind quota_reset; pass weekly to repeat", per Q1). `reply_task` returns the child id and scheduled time.
- **Test scenarios** (`packages/core-ts/test/tool-surface.test.ts`, `packages/mcp-server/test/server.task-visibility.test.ts`, `packages/mcp-server/test/tool-surface-derivation.test.ts`, `packages/openclaw-plugin/test/plugin.test.ts`, `packages/openclaw-plugin/test/tool-surface-derivation.test.ts`):
  - snapshot diff shows only the new tool and params;
  - MCP `reply_task` on a completed task returns a child id; on a failed task returns an error naming the rule;
  - MCP `schedule_task` with `origin_session_id: "${CLAUDE_SESSION_ID}"` stores nothing; with a UUID stores it;
  - `cancel_task` with `series: true` ends the series on both hosts;
  - OpenClaw registers `reply_task`.
- **Verification:** `pnpm --filter @ebb-ai/core test`, `pnpm --filter @ebb-ai/mcp test`, `pnpm --filter @ebb-ai/mcp smoke`, `pnpm --filter @vitalini/ebb test`.

#### U7. CLI queue write commands

- **Goal:** every UI action has a terminal equivalent.
- **Requirements:** R6, R7, R8, R10, R16, R17.
- **Files:** `packages/cli/src/index.ts` (register `queue cancel <id> [--series]`, `queue reschedule <id> (--by <duration|iso> | --at <iso> | --day <yyyy-mm-dd>)`, `queue run-now <id>`, `queue reply <id> <text> [--by <duration|iso>]`, `queue list --series <id>`), `packages/cli/src/commands/queue.ts` (handlers build a `Scheduler` with `buildDefaultGridFeed` like `ebb ui`; `--day` uses the local zone to compute bounds; `renderTask` prints series, repeat, origin session, resume line, parent and children; `taskSummary` adds `display_title`, `series_id`, `repeat`, `provider`, `model`).
- **Approach:** every write prints the new state and "runs on the next tick (last tick: …)"; exit code 1 with the core message on a refused action.
- **Test scenarios** (`packages/cli/test/queue.test.ts`): each command on a temp ledger changes the row as U2 specifies; refused actions exit 1; `show` prints `cd <cwd> && claude --resume <id>` only when both exist, with the cwd shell-quoted; `list --series` lists occurrences oldest first.
- **Verification:** `pnpm --filter @ebb-ai/cli test`, `pnpm --filter @ebb-ai/cli typecheck`.

#### U8. `ebb ui` write API and Start dispatcher

- **Goal:** the local API exposes every action and the dispatcher state without breaking v1.
- **Requirements:** R4, R5, R6 to R11, R16, R17, R22, KTD8, KTD9, KTD13, D10 to D12.
- **Files:** `packages/cli/src/ui/server.ts` (JSON body reader with type and size checks; header comment now "writes by POST, never dispatches"), `packages/cli/src/ui/api.ts` (routes below; `listSummary` adds `display_title`, `series_id`, `repeat`, `provider`, `model`, `carbon_g` (receipt actual, else estimate), `intensity_g_per_kwh` (receipt), `actions`; detail adds `origin_session_id`, `resume_command`, `parent`, `children`, `series` summary, `actions`; list accepts `series=` and `limit=`), new `packages/cli/src/ui/dispatcher.ts` (spawn, meta record, liveness, state), `packages/cli/src/commands/ui.ts` (build the action `Scheduler`; pass launcher), `packages/cli/src/commands/install.ts` (export `resolveLauncher`).
- **Routes:**
  - `POST /api/tasks/:id/cancel` body `{series?: boolean}` -> 200 task summary.
  - `POST /api/tasks/:id/reschedule` body exactly one of `{deadline}`, `{at}`, `{day_start, day_end}` (ISO instants, day span 1 to 25 h) -> 200 summary.
  - `POST /api/tasks/:id/run-now` -> 200 summary.
  - `POST /api/tasks/:id/reply` body `{text (1..32000 chars), deadline?}` -> 201 child summary.
  - `POST /api/tasks/:id/read|unread` (unchanged).
  - `GET /api/series/:id` -> rule, occurrences (oldest first), next projected deadlines (up to 8).
  - `POST /api/dispatcher/start` -> 201 `{pid, log, started_at}`; 409 when one is alive.
  - `GET /api/status` adds `dispatcher: {state, last_tick_at, interval_s, ui_child: {pid, log, alive} | null}`.
  - Refused actions return 409 with the core rule message (no stack, no path).
- **Test scenarios** (`packages/cli/test/ui-server.test.ts`, new `packages/cli/test/ui-actions.test.ts`):
  - every POST without token 401, wrong Host or Origin 403; on body routes `text/plain` body 415, 70 KiB body 413, unknown field 400; GET on a POST route 405;
  - a body-less POST to `read` with only the bearer header (the v1 page request) returns 204;
  - each action changes the ledger as U2 specifies and the SSE stream emits the id;
  - reschedule by day bounds with a mock feed picks an hour inside the day;
  - reply returns 201 and the child appears in the parent's `children`;
  - the server never calls an adapter (the action scheduler is built without adapters; assert no dispatch with a spy feed);
  - dispatcher start with an injected spawner: records meta, second call 409 while alive, state `running`; stale `last_tick_at` and no child gives `stale`;
  - list on a row without title returns `display_title` from the prompt and still carries no prompt field;
  - v1 page still renders against the extended API (existing asset tests).
- **Verification:** `pnpm --filter @ebb-ai/cli test`.

#### U9. Claude Code plugin passes the session id

- **Goal:** tasks deferred from Claude Code can be resumed in their session.
- **Requirements:** R15, D4, KTD10.
- **Files:** `packages/claude-code-plugin/commands/defer.md` (step 2 adds `origin_session_id` = `${CLAUDE_SESSION_ID}`; output block adds a `resume` line when the response returns one; mention `--repeat daily|weekly|none` argument mapping to `repeat`; state that `--by quota-reset` is a one-off by default and `--repeat weekly` makes it repeat (Q1)), `packages/claude-code-plugin/skills/ebb-ai/SKILL.md` (same param note), `packages/claude-code-plugin/README.md`.
- **Approach:** no hook change; the SessionStart hook stays as is. Document that auto-invoked deferral through the command carries the id, and a direct model call to `schedule_task` does not.
- **Test scenarios:** none automated in this package; covered by U6 MCP tests. Manual check in Verification Contract.
- **Verification:** `grep -n 'CLAUDE_SESSION_ID' packages/claude-code-plugin/commands/defer.md`.

#### U10. PR A docs and CHANGELOG

- **Goal:** users and agents can find the new commands and rules.
- **Requirements:** all PR A requirements.
- **Files:** `CHANGELOG.md` (Unreleased / Added: task actions, repeating tasks, reply, session resume, `ebb ui` write API, Start dispatcher; Notes: `repeat` defaults to `none`, also for `quota_reset` tasks; Python core stores but does not act on series or history), `packages/cli/README.md`, `packages/mcp-server/README.md`, `docs/solutions/best-practices/loopback-web-ui-hardening.md` (writes: JSON content type, size cap, bearer header, no cookie; static map rule still holds).
- **Test scenarios:** `packages/cli/test/docs-lockstep.test.ts` stays green.
- **Verification:** full PR A gate.

### PR B — front end v2

#### Design spec

**Tokens** (`packages/cli/ui/tokens.css`, `:root` light, `@media (prefers-color-scheme: dark)` dark):

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f6f6f2` | `#101412` | page |
| `--surface` | `#ffffff` | `#171c19` | rows, drawer |
| `--surface-2` | `#eef0ea` | `#1f2521` | day headers, hover, skeleton |
| `--line` | `#dde1da` | `#2d3531` | borders |
| `--fg` | `#1a201d` | `#e6ece8` | text |
| `--fg-muted` | `#5a655f` | `#9aa8a0` | secondary text |
| `--accent` | `#1d6b4d` | `#5cc796` | the one accent: focus, primary button, drop target, unread dot |
| `--accent-fg` | `#ffffff` | `#0b1410` | text on accent |
| `--danger` | `#a8361f` | `#f08a74` | failed, cancel |
| `--warn` | `#8a6200` | `#e3b341` | overdue, stale dispatcher |
| `--band-very-clean` / `-bg` | `#0e5a39` / `#d9f1e3` | `#86e2b0` / `#11301f` | carbon label |
| `--band-clean` / `-bg` | `#3b6912` / `#e8f2d4` | `#b8dd7e` / `#25311a` | carbon label |
| `--band-average` / `-bg` | `#755600` / `#f5ecc9` | `#e9c96a` / `#342c13` | carbon label |
| `--band-dirty` / `-bg` | `#954612` / `#f8e0cd` | `#f1a46c` / `#392415` | carbon label |
| `--band-very-dirty` / `-bg` | `#981c1c` / `#f6d7d7` | `#f38e8e` / `#3c1b1b` | carbon label |

Band chips always carry the text label ("very clean", "clean", "average", "dirty", "very dirty"), so colour is never the only signal. Every fg/bg pair meets WCAG AA (4.5:1) for 12 px text; U11 checks the ratios with a small script in the test.

Type scale (system UI stack; `font-variant-numeric: tabular-nums` for times and grams; ui-monospace for ids and commands): `--fs-xs 12/16`, `--fs-sm 13/18`, `--fs-md 15/22` (body), `--fs-lg 18/24` (day header), `--fs-xl 22/28` (view title), `--fs-2xl 28/34` (drawer title). Weights 400, 500, 600.

Spacing (8-point with a 4 half-step): `--sp-1 4`, `--sp-2 8`, `--sp-3 12`, `--sp-4 16`, `--sp-5 24`, `--sp-6 32`, `--sp-7 48` px. Radius `--r-1 6`, `--r-2 10`. Row min height 56 px (touch target 44 px). Motion `--t-fast 120ms`, `--t-med 200ms`, off under `prefers-reduced-motion`.

**Shell** (all views):

```
+--------------------------------------------------------------------------+
| ebb   [Agenda] [Timeline] [Journal ●3]          ● dispatcher: ran 2m ago |
+--------------------------------------------------------------------------+
| ! No dispatcher has run for 3 h. Tasks will not run. [Start dispatcher]  |  <- banner, only when stale/never
+--------------------------------------------------------------------------+
| view                                                   | detail drawer   |
|                                                        | (420 px, right) |
+--------------------------------------------------------------------------+
                                             [toast: Cancelled "x". Undo]
```

Below 720 px the nav becomes a bottom tab bar and the drawer is a full-screen sheet.

**Agenda:**

```
Needs attention (2)
 ▲ 14:00 overdue  Weekly limit report        anthropic · sonnet-5   [Run now]
 ✕ failed         Summarize notifications    openai · gpt-6-sol     [Open]
Today · Thu 15 Oct ............................ cleanest 03:00 very clean
 ●  22:00 [clean]   Translate README          by 23:59 · absolute   anthropic · sonnet-5
    23:00 [average] Log triage   ↻ weekly     by Fri 18:00          anthropic · haiku
Tomorrow · Fri 16 Oct .......................... cleanest 02:00 very clean
    03:00 [v.clean] Refactor helpers ⏱ quota  by Fri 08:00 (claude) anthropic · sonnet-5
Mon 19 Oct ..................................... forecast not available yet
    ~10:00 ↻ Log triage (projected)
Later
    Thu 29 Oct ...
```

**Row anatomy** (`row.js`, shared by Agenda, Journal, Timeline list):

```
[dot][time      ][band chip ][title ............................][kind badge][provider · model][actions]
 8px  56px tabular  pill 12px  fs-md 500, 1 line, ellipsis         pill         fs-sm muted       hover/focus: ▶ ↦ ✕ ; touch: ⋯
      second line (fs-sm muted): deadline "by Fri 18:00" · series "repeats weekly" · origin host
```

Unread dot only on finished unread tasks. Projected rows: dashed border, muted, no actions, not draggable. Pending-write rows: 60% opacity plus a small spinner in the actions slot.

**Timeline:** the v1 curve restyled: band-coloured area under the curve, now line, deadline ticks, task markers as 10 px circles in band colour; clicking a marker selects the row in a list under the chart (same row anatomy). Height 220 px desktop, 160 px mobile.

**Journal:**

```
[Status: all ▾] [Provider: all ▾] [Kind: all ▾]                  59 tasks
Today
 ✓ 14:02  Translate README       completed · 0.4 g · receipt ✓     ›
Mon 12 Oct
 ✕ 09:10  Summarize PRs          failed · rate limit               ›
 ⊘ 08:00  Log triage ↻           cancelled                         ›
   └ expanded: result first 6 lines · receipt verified/unsigned · 0.41 g CO2e at 120 g/kWh (clean) · [Open]
```

**Detail drawer:**

```
Translate README                                    [×]
completed · ran Thu 14:02 · 0.4 g CO2e · clean
[Reply] [Mark unread]     (pending: [Run now] [Reschedule] [Cancel])
Result ─────────────────────────────────────────────
 text (pre-wrap, max 60 vh, scroll)   ▸ Raw JSON
Conversation ───────────────────────────────────────
 you: …   model: …   you: …
 [ reply box, 3 rows ........................ ] [Send]  "Runs on the next tick"
Receipt ────────────────────────────────────────────
 region · intensity · estimated vs actual · signature ✓
Origin ─────────────────────────────────────────────
 mcp · ~/projects/ebb
 $ cd ~/projects/ebb && claude --resume 3f2a…      [Copy]
Chain / Series ─────────────────────────────────────
 parent: … · children: … · series: weekly, 6 occurrences, next Fri 23:00 [Stop series]
```

**Drag and drop states:**

| State | Visual | Notes |
|---|---|---|
| idle | grab handle on hover/focus (desktop), none on touch | only rows where `actions.reschedule` |
| dragging | source row 50% opacity; "Run now" drop zone slides in under the header; all day headers get a dashed `--line` outline | `dragstart` sets `text/x-ebb-task` with the id |
| over valid target | header fills `--surface-2`, 2 px `--accent` outline, label "Move to Fri 16 Oct" or "Run now" | `dragover` preventDefault only for valid targets |
| over invalid | no outline, `dropEffect = none` | own day, past days |
| dropped | row moves under the target, pending style | optimistic (KTD12) |
| confirmed | pending style removed, toast "Moved to Fri 16 Oct · runs at 03:00" | after SSE + re-fetch |
| failed | row returns, error toast with the server message | 409 or network |
| cancelled | Esc or drop outside restores | |

Touch and keyboard alternative: the row menu and `m` open a "Move to" list (Run now, Today, Tomorrow, next 5 days, Pick date and time…). Native HTML5 DnD does not fire on most touch browsers; the menu is the touch path.

**Keyboard map** (ignored while focus is in an input, textarea or select):

| Key | Action |
|---|---|
| `j` / `k` (and ↓ / ↑) | next / previous row |
| `Enter` | open detail |
| `Esc` | close dialog, drawer, menu or drag |
| `c` | cancel (toast with Undo) |
| `C` | stop series (confirm dialog) |
| `r` | reschedule dialog (date and time, or deadline) |
| `m` | move-to-day list |
| `n` | run now |
| `u` | toggle read |
| `R` | focus the reply box (completed task) |
| `1` `2` `3` | Agenda, Timeline, Journal |
| `/` | focus Journal filters |
| `?` | shortcut help |

Focus is visible (2 px `--accent` outline). The drawer traps focus and returns it to the row on close. Toasts use `role="status"`; errors `role="alert"`.

**Empty, loading, error states:**

| View | Empty | Loading | Error |
|---|---|---|---|
| Agenda | "Nothing scheduled." plus how to defer (`/ebb-ai:defer …`) and a link to Journal when it has rows | 3 skeleton day groups, 2 rows each | inline card "Could not load tasks. Retry"; keeps last data if any |
| Timeline | curve with "No tasks in the next 72 h" | skeleton chart block | "Forecast unavailable" (502) with the task list still shown |
| Journal | "Nothing finished yet." | 6 skeleton rows | as Agenda |
| Detail | n/a | skeleton title and 3 blocks | 404 "Task not found" (deleted or bad link) |
| Session | — | — | 401 "This link expired. Run `ebb ui` again." (v1 behaviour kept) |
| Stream | — | — | "Disconnected, retrying…" bar; re-fetch on `hello` after reconnect |

#### U11. Tokens, shell and static map

- **Goal:** one visual system and the page frame.
- **Requirements:** R18, R21, R22, KTD11, D13.
- **Files:** new `packages/cli/ui/tokens.css`, rewritten `packages/cli/ui/app.css`, `packages/cli/ui/index.html` (nav with three views, dispatcher pill, banner, toast region, drawer, bottom bar under 720 px), `packages/cli/src/ui/server.ts` (`STATIC_FILES` adds `/tokens.css` and every module of U12 to U17 with correct types).
- **Test scenarios** (`packages/cli/test/ui-server.test.ts`): every static path serves with CSP; unknown path 404; index references only relative paths; CSS loads nothing remote; contrast check of each band fg/bg pair ≥ 4.5 parsed from `tokens.css`.
- **Verification:** `pnpm --filter @ebb-ai/cli test`.

#### U12. Data layer

- **Goal:** one place for API calls, state, optimistic writes and toasts.
- **Requirements:** R11, R20, R22, KTD12.
- **Files:** new `packages/cli/ui/api.js` (bearer header, JSON POST, typed errors, 401 -> expired), `packages/cli/ui/state.js` (tasks map, pending ops, SSE apply with stale-render guard as v1 `renderSeq`), `packages/cli/ui/toast.js` (queue, Undo, 5 s commit, `pagehide` flush), `packages/cli/ui/dom.js` (`h()` helper from v1, `textContent` only), `packages/cli/ui/app.js` (bootstrap, token from fragment then cleared, router `#/agenda|timeline|journal|task/<id>`).
- **Test scenarios:** extend the asset test so no module contains `innerHTML`, `insertAdjacentHTML`, `eval`, `new Function` or a remote URL.
- **Verification:** `pnpm --filter @ebb-ai/cli test`.

#### U13. Agenda view

- **Goal:** the default to-do list.
- **Requirements:** R1, R2, R14 (projected series rows), D8.
- **Files:** new `packages/cli/ui/agenda.js`, new `packages/cli/ui/row.js`.
- **Approach:** fetch pending statuses plus unread failed; group by local day of `scheduled_for` (fallback `deadline`); band at the scheduled hour from the forecast points of the task's region, else from `intensity_g_per_kwh`, else no chip; projected rows from `/api/series/:id` next deadlines within 14 days.
- **Verification:** smoke items A1 to A5 (U18).

#### U14. Task detail drawer

- **Goal:** everything about one task and its actions.
- **Requirements:** R5, R10, R16, R17, KTD12.
- **Files:** new `packages/cli/ui/detail.js`.
- **Approach:** buttons render from `actions`; reply posts and opens the child; Copy uses `navigator.clipboard.writeText` with a selectable fallback; opening a finished task marks it read (v1 behaviour).
- **Verification:** smoke items D1 to D6.

#### U15. Journal view

- **Goal:** the log of finished work.
- **Requirements:** R4.
- **Files:** new `packages/cli/ui/journal.js`.
- **Approach:** statuses completed, failed, cancelled; filters client-side, state in the hash query (`#/journal?status=failed`); expandable rows with `<details>`.
- **Verification:** smoke items J1 to J3.

#### U16. Timeline restyle

- **Goal:** the curve matches the new system.
- **Requirements:** R3.
- **Files:** new `packages/cli/ui/timeline.js` (moves v1 `chart()` and `renderTimeline` out of `app.js`).
- **Verification:** smoke item T1.

#### U17. Drag and drop, keyboard, dialogs, dispatcher banner

- **Goal:** direct manipulation with full keyboard and touch parity.
- **Requirements:** R7, R8, R11, R19, R21.
- **Files:** new `packages/cli/ui/dnd.js`, `packages/cli/ui/keys.js`, `packages/cli/ui/dialog.js` (reschedule, move-to, stop-series confirm, shortcut help, using `<dialog>`), banner and Start dispatcher in `app.js`.
- **Approach:** states and keys exactly as the design spec; day bounds computed in the browser's zone and sent as ISO instants.
- **Verification:** smoke items K1 to K4, M1 to M3, S1, S2.

#### U18. Seed script, smoke, asset tests, CHANGELOG

- **Goal:** repeatable proof that every action works in a real browser.
- **Requirements:** all PR B requirements, D9.
- **Files:** new `scripts/ui-seed.mjs` (builds a ledger in a temp dir from the built `@ebb-ai/core`: 2 overdue/failed, 6 scheduled over 4 days incl. a weekly series and a quota_reset series, 1 running, 8 finished incl. a reply chain and a task with `origin_session_id`; starts `ebb ui --no-open --db <tmp>` with the mock feed and prints the link), `packages/cli/test/ui-server.test.ts`, `CHANGELOG.md` (Unreleased / Changed: `ebb ui` v2).
- **Smoke list** (run by a QA agent through the Playwright MCP browser against the seeded ledger; one screenshot per item to the session scratchpad; desktop 1280×800 and mobile 390×844 for A1, D1, J1):
  - A1 Agenda renders day groups, Needs attention, band chips, badges; A2 empty state on an empty ledger; A3 skeleton visible on a delayed response; A4 projected series rows; A5 dark mode screenshot.
  - D1 detail opens with result text, raw JSON collapsed, receipt; D2 reply creates a child and the drawer shows it; D3 resume command copy; D4 mark unread then read; D5 stop series; D6 404 detail.
  - J1 Journal lists finished rows newest first; J2 each filter narrows; J3 row expands.
  - T1 Timeline curve and markers.
  - K1 j/k/Enter/Esc; K2 `c` then Undo leaves the task scheduled; K3 `c` without Undo cancels after 5 s and SSE confirms; K4 `r` reschedule to a time.
  - M1 drag a row onto Tomorrow, see the drop target, row moves and is confirmed; M2 drag onto Run now, row shows "runs on the next tick"; M3 the move-to menu at mobile width.
  - S1 stale dispatcher banner and Start dispatcher shows PID and log path; S2 a 409 from a racing write rolls the row back with an error toast.
- **Verification:** full PR B gate plus the smoke report.

---

## Verification Contract

Gates per PR, run in the worktree from the repo root:

- `pnpm build && pnpm typecheck && pnpm test`
- `cd packages/core-py && .venv/bin/ruff check . && .venv/bin/pytest -q`
- `pnpm --filter @ebb-ai/mcp smoke`
- `pnpm check:versions`
- `pnpm gen:data:check`

PR A extra checks:

- Read the regenerated `packages/core-ts/test/__snapshots__/tool-surface.test.ts.snap` diff: only `reply_task`, `cancel_task.series`, `schedule_task.repeat`, `schedule_task.origin_session_id`.
- Manual: in Claude Code, `/ebb-ai:defer say hi --by 2h`, then `ebb queue show <id>` prints the resume line with the current session id.
- Manual: `ebb ui` on a reference ledger with ~60 tasks (not in the repo) serves the v1 page without errors.

PR B extra checks:

- `node scripts/ui-seed.mjs` prints a working link; the smoke list passes; screenshots are in the session scratchpad, not the repo.
- A reference ledger with ~60 tasks (not in the repo) renders Agenda with no pending tasks (empty state or only unread failed rows) and Journal with ~60 readable titles.

Browser smoke never runs inside a parallel stream; it runs once at the end of PR B.

---

## Definition of Done

- PR A: U1 to U10 done, all gates green, no version bump, CHANGELOG Unreleased updated, v1 page works against the new API, PR open and reviewed.
- PR B: U11 to U18 done, all gates green, smoke list passed with screenshots, no new dependency, no build step, PR open and reviewed.
- Each unit's test scenarios exist and pass; no skipped or focused tests left.
- Abandoned-attempt code and debug output are removed from both diffs.
- Q1 is answered (2026-10-15: `repeat` defaults to `none`).
