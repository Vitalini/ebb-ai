---
title: Dependency-free task UI (ebb ui v2) — patterns that held up in review
date: 2026-10-15
category: best-practices
module: packages/cli/ui (api.js, state.js, app.js, keys.js, dnd.js, dom.js), scripts/ui-seed.mjs
problem_type: best_practice
component: frontend
severity: medium
applies_when:
  - "Changing the ebb ui front end (ES modules, no build step, no framework)"
  - "Adding a write action, a toast, a shortcut or a new view"
tags: [frontend, optimistic-update, sse, undo, keyboard, dnd, ebb-ui]
---

# Dependency-free task UI patterns

PR #49 (ui v2) shipped about 3,200 lines of plain ES modules. Review found a bug in each place
where one of these patterns was missing. Server-side rules live in `loopback-web-ui-hardening.md`.

## Rules

- **Render with text nodes only.** `dom.js` `h()` appends strings as `document.createTextNode`.
  Task text never reaches HTML. `ui-server.test.ts` reads every file in `packages/cli/ui` and fails on
  `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(`, `new Function`,
  `setAttribute("style"`, and on `localStorage`, `sessionStorage`, `document.cookie`, `indexedDB`.
  The browser-storage ban was added in review. Add a new forbidden API to that test, not to a comment.
- **Token lives in module memory.** `boot()` reads `#token=...` from the URL fragment into `api.js`
  (`setToken`). No storage. A reload without the fragment gives `SessionExpired` and the page says to run `ebb ui` again.
- **Optimistic update = an "op" patch applied at read time** (`state.perform`). A refresh that lands
  before the server has the change cannot flash old state back. Keep the patch until the change
  stream names the task and a re-fetch shows the new state (`confirmOps`; a 5 s timer re-fetches
  if the stream is down). A failed refresh says nothing about the write, so it keeps the patch.
- **Roll back on error and show the server's reason.** 409 and 400 show `err.message` (the core's
  one-line rule, for example "Start dispatcher" refusals). Any other status shows a fixed text,
  and a network error says "nothing changed". Never show exception text.
- **Undo = a deferred request** (`cancelWithUndo`). The row looks cancelled at once. The POST goes out
  when the 5 s toast expires. Undo deletes the patch and sends nothing, so there is nothing to
  reverse on the server. On `pagehide` all delayed cancels flush with `keepalive: true`.
  Do not keep an Undo toast or an optimistic look for an op that already settled (fixed in `97f5ba9`).
- **One press, one action.** `keys.js` returns on `e.repeat`; holding `c` must not cancel row
  after row as focus moves. Reply send ignores a repeated Cmd/Ctrl+Enter and disables the button
  while in flight. `startDispatcher` disables its button and re-enables it in `finally`.
- **SSE through `fetch`, not `EventSource`** (the Authorization header is needed). On a drop:
  mark disconnected, wait `delay`, double it up to 30 s, reconnect. A `hello` event after a
  reconnect triggers `refresh()`, because changes made while the stream was down emit no event.
- **Cheap re-render for a long list.** The view is rebuilt as a detached tree, then dropped if
  `isEqualNode` matches the live one (`app.js`), so the stream firing on every tick does not
  destroy hover or a click in flight. `swapChildren` does the same for the banner and drawer.
  This is whole-tree compare, not per-row keys. It was enough for the 200-row seed. If a
  list outgrows it, add keys keyed by `task_id`; do not add a framework first.
- **Drag and drop has two other paths.** DnD (`dnd.js`) moves a task to a day. The same move is
  reachable by the `m` key and by the row "⋯" menu, both opening the move-to list in `dialog.js`.
  Touch uses the menu; touch targets are `--touch: 44px`. A drop label names a weekday once
  (`Moved to Sat 17 Oct`, `0a42730`).
- **Look up renderers by own key.** `Object.hasOwn(VIEWS, name)` before calling, because the name
  comes from `location.hash` (CodeQL `js/unvalidated-dynamic-method-call`, `94c7d98`).
- **Seed script refuses real ledgers.** `scripts/ui-seed.mjs` writes throwaway prompts that a
  running dispatcher would send to a provider. `--db` must name a new file outside `~/.ebb-ai`;
  an existing file or a path inside that folder exits 1. Default is a temp dir.

## Why it matters

Each rule above came from a review finding or a CodeQL alert, not from design. The cost of
missing one is a cancelled task nobody asked to cancel, a lost token, or seed prompts sent to a provider.
