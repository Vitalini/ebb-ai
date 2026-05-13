# ebb-ai in Pi (pi.dev)

[Pi](https://pi.dev) is a minimal terminal coding harness with the
explicit design choice of **not** baking in MCP. Instead, MCP is
supported via a user-installed extension, and a "Skills" feature
lets the agent call CLI tools described in markdown.

ebb-ai therefore has two valid integration paths into Pi:

1. **Skill path (recommended).** Drop the ebb-ai CLI into Pi's
   `~/.pi/agent/` and reference it from `AGENTS.md`. Pi's agent reads
   the skill and learns when to invoke `ebb tick`, `ebb queue`,
   `ebb receipts`, and how to compose `schedule_task`-style requests.
2. **Extension path.** Pi's extension API lets a TypeScript module
   bridge MCP. If you want the same `recommend_window` and
   `schedule_task` tools Pi-natively, write a small Pi extension that
   spawns `@ebb-ai/mcp` and forwards calls. (Out of scope for this
   example — Pi-extension docs at pi.dev/extensions.)

This folder ships path (1) — the simpler, idiomatic Pi integration.

## 1. Build ebb-ai

```bash
cd /path/to/ebb-ai
pnpm install
pnpm --filter @ebb-ai/cli build       # builds the `ebb` CLI (v0.4+)
pnpm --filter @ebb-ai/mcp build       # builds the MCP server bin
```

## 2. Drop the skill into Pi

```bash
mkdir -p ~/.pi/agent/skills
cp ebb-ai.md ~/.pi/agent/skills/
```

The file [`ebb-ai.md`](./ebb-ai.md) in this folder is the skill.
Pi's agent will pick it up automatically on next launch.

## 3. Register ebb-ai in `AGENTS.md`

Open `~/.pi/agent/AGENTS.md` (Pi creates it on first launch). Add the
[`AGENTS.snippet.md`](./AGENTS.snippet.md) stanza near the bottom of
the *Tools available* section.

That stanza tells Pi: "the agent may invoke `ebb` from the shell for
carbon-aware scheduling work, and the ebb-ai.md skill explains how."

## 4. Use it

Run Pi as usual (`pi`). Ask the agent:

> Pi, run my weekly OSS-trend research report at 3am tomorrow when
> the grid is cleanest.

The agent reads the ebb-ai skill, then runs:

```
ebb tick           # one-shot — drains any due tasks
ebb queue list     # see what's pending
ebb receipts list  # see what already ran with their carbon receipts
```

To schedule a task, the agent uses the MCP server's `schedule_task`
tool indirectly by either (a) spawning the MCP server as a one-shot
RPC, or (b) calling the lower-level `ebb` commands documented in the
skill.

## Notes

- Pi deliberately gives you primitives, not features — so the
  ebb-ai integration is documentation-shaped, not config-shaped.
- If you'd rather have ebb-ai tools appear natively in Pi the way
  they do in Claude Desktop, write a Pi extension. ebb-ai will help —
  open an issue at https://github.com/Vitalini/ebb-ai/issues.

See also: [examples/openclaw-skill](../openclaw-skill/) — same
skill-document pattern, different agent host.
