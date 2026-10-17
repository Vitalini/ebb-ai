---
title: Time-of-day bugs hide behind the clock; sweep fake time across hours, DST ends and zones in one test run
date: 2026-10-16
category: logic-errors
module: packages/core-ts (scheduler.ts, grid.ts, quota.ts), packages/openclaw-plugin tests
problem_type: logic_error
component: tooling
severity: high
applies_when:
  - "A test passes or fails depending on the hour or the time zone it runs in"
  - "Code infers a state (such as 'pinned') by comparing two timestamps"
  - "Code floors or rounds 'now' to an hour, or builds day boundaries"
  - "Tests in one file share a ledger or store"
tags: [flaky-test, time-of-day, dst, utc, fake-timers, pinned-rows, shared-ledger]
---

# Time-of-day bugs and fake-time sweeps

PR #59 (fix of the failure that blocked every PR on 2026-10-16). An earlier flake, PR #39 (`fix/test-tick-future-flake`), was a test-only clock fix. This one was two code bugs and two test bugs. Rule: **a test that fails only at some hours is a code bug until a sweep says otherwise.**

## Findings

1. **Do not infer "pinned" from `scheduledFor === notBefore`.** A re-plan that moved a task to a day beyond the forecast kept its time of day. Enqueued between 19:00 and 19:59 UTC with a 6 h window, the fallback landed exactly on 00:00 UTC, equal to `notBefore`. `replanSweep` (`quota.ts`) and `isBatchCandidate` (`scheduler.ts`) read that as an exact-time pin and never gave the row a carbon window. Fix: the day fallback moves one minute into the day. A derived marker needs a value no other path can produce, or an explicit flag.
2. **Floor "now" in UTC, never in local time.** Feeds used `setMinutes(0,0,0)`. In the repeated hour at DST end (Europe/Kyiv, 2026-10-25) that resolves one hour early, so the forecast fell one hour short. Local flooring is also wrong in zones with :30 and :45 offsets. All four feeds (mock, UK, EIA, ENTSO-E) now use `setUTCMinutes`; `grid.test.ts` and `grid-feeds-fixtures.test.ts` check the UTC hour under Europe/Kyiv, Asia/Kolkata, America/Los_Angeles and UTC.
3. **Tests that share a ledger must assert on their own task.** The plugin AE9 test shared its ledger with the `schedule_task` test, whose task the mock curve can place in the current hour; the tick then ran it. The AE9 test now checks only that its own quota task was not dispatched. A second test bug: the "stale cache" test dispatched on its first tick at 04:xx UTC because the mock curve picks the current hour; it now pins the row an hour out.

## The sweep (reusable method)

Copy the test file to a throwaway, not committed. Run it under fake `Date` at HH:30 for **every hour of several days**: an ordinary day, the EU DST end (2026-10-25), the US DST end (2026-11-01), and the days around them. That was 120 instants, in one vitest run per zone (`TZ=UTC`, `Europe/Kyiv`, `America/Los_Angeles`). One run replaces waiting a day for the clock to reach the bad hour. Before the fix it failed at 19:30 UTC, 04:30 UTC and 2026-10-24 12:30 in Kyiv; after, 2651/2651 in each zone.

## Not repaired

Rows already moved this way by 0.17 or 0.18 keep their day-start time. They cannot be told apart from a real exact-time pin. The CHANGELOG says so.

## Related

- `repeat-series-and-replies.md` (pinned tasks stay unplanned until the forecast covers the window)
- `quota-reset-deadlines.md`
