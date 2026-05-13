# `examples/openclaw-demo` — placeholder

The complete worked OpenClaw demo (a real end-to-end recording of an
agent deferring a task overnight and seeing the carbon receipt the
next morning) lands once the v0.1 demo recording exists. The plan is
captured in [`ROADMAP.md`](../../ROADMAP.md) section 12, Day 6.

In the meantime, the OpenClaw skill definition and its installer
live next door at [`../openclaw-skill/`](../openclaw-skill/). That
directory contains:

- `SKILL.md` — the OpenClaw skill metadata, trigger phrases, and
  workflow patterns.
- `scripts/install.sh` — one-shot installer that wires `@ebb-ai/mcp`
  into `~/.openclaw/mcp.json`.
