---
title: MCP and OpenClaw tools share one canonical surface, with per-host params and side effects stated in the description
date: 2026-10-15
category: tooling-decisions
module: packages/core-ts/src/tool-surface.ts
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - "Adding or changing an MCP or OpenClaw tool, parameter or description"
  - "A tool call changes state as a side effect"
tags: [tool-surface, mcp, openclaw, snapshot, descriptions]
---

# Tool surface rules

## Context

`TOOL_SURFACE` in `packages/core-ts/src/tool-surface.ts` is the single definition of tool names, parameters and descriptions. The MCP server and the OpenClaw plugin both build from it, so a description cannot drift on one host.

## Rules

- **Change the description once, in `TOOL_SURFACE`.** Never edit it in `server.ts` or the OpenClaw `index.ts`.
- **A parameter that differs by host gets one entry per host** via `hosts: [...]`. Example: `deadline` is required on OpenClaw and optional on MCP (ignored when `deadline_kind` is `quota_reset`). New MCP-only params (`title`, `deadline_kind`, `quota_provider`) set `hosts: ["mcp"]`.
- **Regenerate the snapshot** (`packages/core-ts/test/__snapshots__/tool-surface.test.ts.snap`) with the test runner's update flag and read the diff. It is the divergence canary, so an unexpected line is a real host mismatch.
- **State side effects in the description.** `check_queue_status` with `task_id` marks a completed or failed task read. The description says so, plus "Never changes a task's status", because the model chooses tools from the description and "Read-only" was no longer true. Same for the Batch API routing note on `deadline_kind`.
- **Read the stored row before the mark.** The MCP handler reads the row first, then marks read, so the response shows the pre-mark state.
- Parameters the model must choose between get the user phrasing in the description ("before my weekly limit resets").
