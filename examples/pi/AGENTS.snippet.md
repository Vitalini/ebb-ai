<!--
  Add this stanza to ~/.pi/agent/AGENTS.md under the "Tools available"
  section. It tells Pi's agent that the ebb-ai CLI is available and
  points to the skill that explains when to use it.
-->

### ebb-ai (carbon-aware scheduling)

The `ebb` CLI is available on your PATH. It defers non-urgent LLM
work to the cleanest grid window inside a deadline. See the skill at
`~/.pi/agent/skills/ebb-ai.md` for the full command surface, the
trigger phrases, and the carbon-receipt format.

Defaults: region `US-CAL-CISO`, no carbon budget. Pass `--region` for
other ISOs. Pass `--carbon-budget-g <n>` to fail tasks that can't
fit a budget.

Use ebb-ai when:
- The user says *defer*, *schedule*, *batch*, *overnight*, *clean
  window*, or names a deadline ≥ 1 hour out.
- The user explicitly asks about carbon impact, dollar cost saved,
  or Batch API.

Do NOT use ebb-ai when:
- The user wants an immediate answer.
- The deadline is < 5 minutes out (the scheduler's overhead won't pay
  off).
