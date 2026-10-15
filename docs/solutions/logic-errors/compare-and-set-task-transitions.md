---
title: Task writes from several processes are compare-and-set, timing-guarded after an await, and series successors are insert-once
date: 2026-10-15
category: logic-errors
module: packages/core-ts/src/storage/sqlite.ts
problem_type: logic_error
component: tooling
severity: high
applies_when:
  - "Adding a write to a task row from the UI server, the CLI or a ticker"
  - "Computing a new schedule after an await (forecast fetch) and then storing it"
  - "Creating a row whose id is derived, such as a series successor"
  - "Choosing an HTTP status for a refused action in the UI API"
tags: [sqlite, compare-and-set, transitionIf, insertIfAbsent, race, ui-api, dispatcher]
---

# Compare-and-set task transitions

## Context

The UI server, `ebb` commands and one or more tickers write the same SQLite ledger. Each holds an in-memory copy of a row. An upsert from a stale copy silently undoes another process's write (cancel, run now, stop series, a claim).

## Rules

- **Every cross-process write is `store.transitionIf(next, expectedStatuses, unchangedSince?)`**, reached through `Scheduler.writeIf`. The UPDATE has `WHERE task_id = ? AND status IN (...)`. It returns false and writes nothing on a miss. `writeIf` then reloads the cache from the ledger.
- **`upsert` no longer owns `repeat` or the identity columns** (title, origin_*, parent_task_id, series_id, origin_session_id). They are insert-only. A stale copy therefore cannot undo a "stop series" from another process. `read_at` is likewise never written by upsert.
- **A miss is not an error.** Cancel re-reads and retries once, then reports the refreshed row. `runNow` and `reschedule` turn a miss into a refusal. The sweep (`rescheduleIfPending`) skips the row.
- **After an async wait, also guard the timing columns.** `scheduleProviderCall` reads the stored row before `fetchForecast` and passes it as `unchangedSince`. The UPDATE then requires `scheduled_for`, `not_before`, `deadline` and `intensity_source` to equal that read (`IS`, so NULL matches NULL). Status alone is not enough: during the forecast await the UI can run the task now or pin it while the status stays `scheduled`, and the late write would overwrite the new time.
- **Derived ids use `insertIfAbsent`** (`INSERT ... ON CONFLICT DO NOTHING`, true only for the inserter). Series successor id is `<series_id>~<n+1>`, so two dispatchers finishing one occurrence create one successor. The successor is written before the parent's terminal write, so a crash between them leaves the series alive, never ended.
- **A stop and a rollover can cross.** Rollover reads `repeat` from the stored row (a stop wins), inserts, then re-reads. If `repeat` became `none` meanwhile it ends the successor. Stop writes `repeat = none` first and then cancels pending occurrences. One side always sees the other.
- **Start dispatcher is idempotent.** `DispatcherControl.start` refuses (409) while a UI-started child is alive (`ui_child`, pid in ledger meta `ui_dispatcher`) and while any other ticker ticked recently (`ticking`, from `last_tick_at`). It spawns `ebb tick --daemon` only when both are clear. The server never dispatches itself.

## HTTP status in the UI API

- `TaskActionError` and `InvalidDeadlineError` are refusals: **409** with the core's one-line rule. A lost race surfaces the same way, so a second click says what happened.
- Anything else is **500** with a fixed generic body (`action failed`, `could not start the dispatcher`). Exception text can hold paths or SQL. See `loopback-web-ui-hardening.md`.
- Do not map unknown errors to 409 to look friendly: it hides real faults as user mistakes.

## Related

- `quota-reset-deadlines.md`: the first use of this idea (`updateIfPending`), now one case of `transitionIf`.
- `repeat-series-and-replies.md`
