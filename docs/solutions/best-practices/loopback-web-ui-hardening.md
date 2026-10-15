---
title: Hardening a loopback web UI in a CLI (ebb ui) — DNS rebinding, token in the fragment, no CORS, fixed static map
date: 2026-10-15
category: best-practices
module: packages/cli/src/ui (server.ts, events.ts, api.ts)
problem_type: best_practice
component: tooling
severity: high
applies_when:
  - "A CLI starts a local HTTP server that shows or changes user data"
  - "Adding a live-update stream (SSE) or a provider-backed endpoint to such a server"
tags: [loopback, dns-rebinding, csrf, sse, bearer-token, csp, ebb-ui]
---

# Hardening a loopback web UI in a CLI

Binding to 127.0.0.1 is not enough. Any web page in the user's browser can reach a loopback server.
`ebb ui` (`packages/cli/src/ui/server.ts`) layers these defenses. Keep all of them when you change it.

## Rules

- **Bind 127.0.0.1 only.** No host option exists.
- **Host allow-list against DNS rebinding.** Accept `127.0.0.1`, `localhost`, `[::1]`, with no port or this server's port. Anything else gets 403. A rebinding page sends its own hostname in `Host`.
- **Origin allow-list.** When `Origin` is sent, it must name the same loopback host. Another origin gets 403.
- **Bearer token, random per run.** The token travels in the URL fragment (`#token=...`), which browsers never send to a server. The page reads it and keeps it in memory only. It checks `Authorization: Bearer` on every `/api/*` request, SSE included. Compare in constant time: hash both sides, then `timingSafeEqual` (equal length by construction).
- **No CORS headers.** Other origins cannot read responses.
- **CSP plus `nosniff`, `no-referrer`, `no-store`.** `frame-ancestors 'none'`, `base-uri 'none'`, `form-action 'none'`.
- **Fixed static file map** (`/`, `/app.js`, `/app.css`). No request path reaches the disk, so there is no traversal surface. New front-end modules are added to the map one by one; the rule still holds.
- **State changes only by POST.** A GET on a mutating route returns 405. A link or image tag cannot change state.
- **Writes need a JSON content type and a size cap (ui v2).** Routes that read a body (cancel, reschedule, reply) accept only `Content-Type: application/json` (415 otherwise) and at most 64 KiB (413). A cross-site HTML form cannot send that type without a CORS preflight, and the server answers no preflight. Bodies are strict JSON objects; an unknown field is 400. Body-less routes (read, unread, run-now, dispatcher/start) refuse a non-empty body, which keeps the v1 page's bare mark-read POST working.
- **Bearer header, never a cookie.** Every POST carries `Authorization: Bearer`. A cookie would ride along on cross-site requests; the header cannot.
- **Write, never dispatch.** The server's `Scheduler` has no provider adapters, so an action can only change the ledger. A refused action returns 409 with the core's one-line rule. "Start dispatcher" spawns the same `ebb` binary as a separate detached process.
- **Generic error bodies.** Never return exception text.

## Live updates (SSE)

- The server polls the store (`data_version` poll, `pollMs`) and keeps a per-task fingerprint map (`events.ts`). It emits an event only for tasks whose fingerprint changed or vanished. There are no DB triggers or file watchers.
- The browser re-renders on `tasks` events. It also re-renders on the `hello` event after a **reconnect**, because changes made while the stream was down emit nothing.
- Guard the poll callback so one thrown error does not kill the stream.

## Provider quota

The forecast endpoint calls a provider. The page asks on every change event. Cache each answer for a short time per request key (`forecastCache` in `api.ts`, WeakMap keyed by context). Without it, a busy ledger burns the user's quota.

## Why it matters

Review of PR #45 found missing Host/Origin checks, error text in bodies, an unguarded poll and an uncached forecast. Each looked safe on a "local only" assumption.
