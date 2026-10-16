# Tidegap in Pi (pi.dev)

[Pi](https://pi.dev) is a minimal terminal coding harness with the
explicit design choice of **not** baking in MCP. Instead, MCP is
supported via a user-installed extension, and a "Skills" feature
lets the agent call CLI tools described in markdown.

Tidegap therefore has two valid integration paths into Pi:

1. **Skill path (recommended).** Drop the Tidegap CLI into Pi's
   `~/.pi/agent/` and reference it from `AGENTS.md`. Pi's agent reads
   the skill and learns when to invoke `tidegap tick`, `tidegap queue`,
   `tidegap receipts`, and how to compose `schedule_task`-style requests.
2. **Extension path.** Pi's extension API lets a TypeScript module
   bridge MCP. If you want the same `recommend_window` and
   `schedule_task` tools Pi-natively, write a small Pi extension that
   spawns `@tidegap/mcp` and forwards calls. (Out of scope for this
   example — Pi-extension docs at pi.dev/extensions.)

This folder ships path (1) — the simpler, idiomatic Pi integration.

## 1. Build Tidegap

```bash
cd /path/to/tidegap
pnpm install
pnpm --filter @tidegap/cli build       # builds the `tidegap` CLI (v0.4+)
pnpm --filter @tidegap/mcp build       # builds the MCP server bin
```

## 2. Drop the skill into Pi

```bash
mkdir -p ~/.pi/agent/skills
cp tidegap.md ~/.pi/agent/skills/
```

The file [`tidegap.md`](./tidegap.md) in this folder is the skill.
Pi's agent will pick it up automatically on next launch.

## 3. Register Tidegap in `AGENTS.md`

Open `~/.pi/agent/AGENTS.md` (Pi creates it on first launch). Add the
[`AGENTS.snippet.md`](./AGENTS.snippet.md) stanza near the bottom of
the *Tools available* section.

That stanza tells Pi: "the agent may invoke `tidegap` from the shell for
carbon-aware scheduling work, and the tidegap.md skill explains how."

## 4. Use it

Run Pi as usual (`pi`). Ask the agent:

> Pi, run my weekly OSS-trend research report at 3am tomorrow when
> the grid is cleanest.

The agent reads the Tidegap skill, then runs:

```
tidegap tick           # one-shot — drains any due tasks
tidegap queue list     # see what's pending
tidegap receipts list  # see what already ran with their carbon receipts
```

To schedule a task, the agent uses the MCP server's `schedule_task`
tool indirectly by either (a) spawning the MCP server as a one-shot
RPC, or (b) calling the lower-level `tidegap` commands documented in the
skill.

## Notes

- Pi deliberately gives you primitives, not features — so the
  Tidegap integration is documentation-shaped, not config-shaped.
- If you'd rather have Tidegap tools appear natively in Pi the way
  they do in Claude Desktop, write a Pi extension. Tidegap will help —
  open an issue at https://github.com/tidegap/tidegap/issues.

See also: [examples/openclaw-skill](../openclaw-skill/) — same
skill-document pattern, different agent host.
