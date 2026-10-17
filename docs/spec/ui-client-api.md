# `tidegap ui` client API

The contract the browser extension and the Mac app code against. Both are clients of the local `tidegap ui` server. They never read `queue.db`. Source: `packages/cli/src/ui/` (`server.ts`, `api.ts`, `clients.ts`, `discovery.ts`, `summary.ts`). Tests: `packages/cli/test/ui-*.test.ts`.

Available from CLI 0.19.0. A 0.18 server answers 401 to every client token, because it checks the bearer before it routes.

## Finding the server

- Default address: `http://127.0.0.1:47821/`. `tidegap ui` tries port 47821 first. When the port is taken, it serves on a free port and prints a warning; clients configured for 47821 do not find it. `--port <n>` sets a port and does not fall back (`--port 0` takes any free port).
- Discovery file: while the server runs, `~/.tidegap/ui.json` (mode 0600) holds:

  ```json
  { "version": 1, "pid": 4242, "port": 47821, "url": "http://127.0.0.1:47821/", "started_at": "2026-10-17T09:00:00.000Z", "cli_version": "0.19.0" }
  ```

  It holds no token. The server removes it on a clean stop, only when the `pid` is its own. A file left by a crash names a dead pid: check the pid before you trust the port.
- The extension cannot read files. It uses port 47821, with an override in its options. The Mac app reads `ui.json`.

## Authentication

Every `/api/*` request, the event stream included, sends `Authorization: Bearer <token>`. No cookie is set or read.

| Token | Where it comes from | Lifetime |
|---|---|---|
| page | random per run, in the link that `tidegap ui` prints (`#token=…`) | until the server stops |
| client (`tgc_…`) | `tidegap clients add --name <n> --kind extension\|macos [--json]`, or "Connect an app" in the page | until revoked |

- `tidegap clients add --json` prints `{"client_id": "…", "token": "tgc_…"}`. The token is shown once.
- The registry `~/.tidegap/ui-clients.json` (mode 0600) stores `{id, name, kind, token_sha256, created_at}` per client, never the token. The server re-reads it when it changes, so `add` and `revoke` apply without a restart.
- `tidegap clients list` shows ids, kinds and names. `tidegap clients revoke <id>` removes a client; its next request gets 401.

### Origin and scope matrix

| `Origin` header | page token | client token | no or bad token |
|---|---|---|---|
| absent | all routes | all routes except `/api/clients*` (403) | 401 |
| `http://<loopback>:<this port>` | all routes | all routes except `/api/clients*` (403) | 401 |
| `chrome-extension://`, `moz-extension://`, `safari-web-extension://` + an id of letters, digits and `-` | 403 | `/api/*` except `/api/clients*` (403) | 401 |
| anything else, `null` included | 403 | 403 | 403 |

- `<loopback>` is `127.0.0.1`, `localhost` or `[::1]`. The `Host` header must name one of them, with no port or this server's port; anything else gets 403.
- An extension origin with a path, a port or an empty id is "anything else".
- An extension origin gets 403 on every static file (`/`, `/app.js`, …).
- The server sends no CORS headers. An MV3 extension with `host_permissions` for `http://127.0.0.1/*` fetches without CORS in Chrome and Firefox.

## Routes for clients

### `GET /api/summary[?since=<iso>]`

One answer for a compact client.

```json
{
  "generated_at": "2026-10-17T10:00:00.000Z",
  "region": "FR",
  "counts": { "queued": 2, "scheduled": 1, "running": 1, "submitted": 1 },
  "active": 5,
  "unread": 1,
  "next_run": { "task_id": "…", "title": "…", "scheduled_for": "2026-10-17T13:00:00.000Z" },
  "clean_window": { "start": "2026-10-17T14:00:00.000Z", "end": "2026-10-17T17:00:00.000Z", "band": "clean", "g": 104, "now": false, "fallback": false },
  "forecast_ok": true,
  "finished": [{ "task_id": "…", "title": "…", "status": "completed", "completed_at": "2026-10-17T09:58:00.000Z" }],
  "cursor": "2026-10-17T09:58:00.000Z"
}
```

- `active` is the sum of `counts`. `unread` counts completed or failed tasks nobody has opened.
- `next_run` is the queued or scheduled task with the earliest `scheduled_for`, or `null`.
- `clean_window` comes from a 24-hour forecast for the server's default region, cached for 10 minutes and shared with `/api/forecast`. It is the first run of consecutive `very_clean` or `clean` hours that ends after now, including the hours of that run that already passed. `band` is `very_clean` only when every hour is very clean. `g` is the lowest intensity in the window (gCO2e/kWh). `now` is true when the window contains now.
- With no clean hour, `clean_window` is the single cleanest hour after now, with `fallback: true`. A fallback window feeds the badge and the menu header, never a "clean window" notification.
- A forecast failure gives `clean_window: null` and `forecast_ok: false`, with status 200.
- `finished` is present only when `since` is given: completed or failed tasks with `completed_at` after `since`, newest first, at most 20. When more than 20 finished after `since`, it lists the oldest of them: at most 20, cut so that tasks with the same `completed_at` stay in one answer (more than 20 only when more than 20 share the first instant). The next poll with the new cursor lists the rest.
- `cursor`: store it and send it back as `since` next time. It is the server's clock, so client clock skew does not matter. Without `since` it is `generated_at`. With `since` it is the newest `completed_at` listed, or `since` itself when nothing finished.
- A `since` that is not an ISO-8601 instant gets 400.

Polling `summary` with the stored cursor gives each finished task once (AE3). Task titles are untrusted text (they come from prompts): render them as text only and truncate them in notifications.

### `POST /api/tasks` (quick add)

`Content-Type: application/json`, a body of at most 64 KiB, strict keys:

| Key | Required | Rule |
|---|---|---|
| `prompt` | yes | 1 to 32 000 characters, not blank |
| `deadline` | no | ISO-8601 instant in the future; default now + 24 h |
| `title` | no | at most 200 characters |
| `provider` | no | `anthropic` (default), `openai`, `gemini`, `ollama` |
| `model` | no | 1 to 200 characters; default `TIDEGAP_DEFAULT_MODEL` for Anthropic, else the provider's default model |

Answer: 201 with the task's list summary (`task_id`, `status`, `deadline`, `scheduled_for`, `provider`, `model`, …). The new id goes to the event stream. The server schedules the task and never dispatches it; `tidegap tick` runs it.

### `GET /api/events`

Server-sent events. `hello` on connect, then `tasks` with `{"ids": [...]}` when tasks change. Refetch the summary on `tasks`, and on `hello` after a reconnect. A stream opened with a client token ends when that token is revoked (the server checks it before each event and each keep-alive); the reconnect then gets 401.

### Other routes

The page's routes (`GET /api/tasks`, `GET /api/tasks/<id>`, `GET /api/status`, `GET /api/forecast`, the task actions) take a client token too. They are not part of this contract and can change with the page.

## Routes for the page only

A client token gets 403 on these.

| Route | Body | Answer |
|---|---|---|
| `GET /api/clients` | none | 200 `{"clients": [{id, name, kind, created_at}]}` |
| `POST /api/clients` | `{"name": "…", "kind": "extension"\|"macos"}`; `kind` defaults to `extension` | 201 `{"client": {…}, "token": "tgc_…"}` |
| `POST /api/clients/<id>/revoke` | none | 200 `{"revoked": "<id>"}`; 404 for an unknown id |

## Errors

Every error body is `{"error": "<one line>"}`, never a stack or a path from a provider.

| Status | When |
|---|---|
| 400 | bad JSON, an unknown key, an invalid field, a body on a body-less route, a bad `since` |
| 401 | no token, an unknown token, a revoked token |
| 403 | a foreign `Host` or `Origin`; the page token from an extension origin; a client token on `/api/clients*`; a static file from an extension origin |
| 404 | unknown route or id |
| 405 | wrong method, for example `POST /api/summary` |
| 409 | the core refused the action (for example no window meets a carbon budget) |
| 413 | body over 64 KiB |
| 415 | a body route without `Content-Type: application/json` |
| 500 | anything else, with a fixed message |

## Badge rule (KTD6)

Both clients use one priority order:

1. No token: `?`.
2. Server unreachable: `off`.
3. `active > 0`: the count, capped at `99+`.
4. `clean_window.now`: `now`.
5. A window later: time to its start (`45m`, `5h`). The Mac menu bar shows the start clock time instead (`14:00`).
6. No forecast: empty.

The tooltip or menu header carries the full line, for example `3 queued · clean 14:00-17:00 FR`.

## Known risk: port squatting

Accepted for a single-user Mac (decision of 2026-10-17). While `tidegap ui` is down, any process that binds 127.0.0.1:47821 first receives the extension's bearer token on its next poll. That includes a process of another macOS account or a sandboxed app, neither of which can read `queue.db`. The token stays valid until revoked. Web pages stay blocked by the Host, Origin and token checks. If you suspect it, revoke the client (`tidegap clients revoke <id>`) and connect it again. The alternative, signed requests (a timestamped HMAC keyed by the token's SHA-256), was considered and not built.
