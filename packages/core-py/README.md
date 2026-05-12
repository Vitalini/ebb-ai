# ebb-ai (Python)

Python port of the `@ebb-ai/core` TypeScript library. **Not yet
implemented in v0.1.** See the parent
[`PLAN.md`](../../PLAN.md) section 7 Month 2 for the planned scope.

When v0.2 ships, the API will mirror the TypeScript surface:

```python
from ebb_ai import defer

result = await defer(
    task=lambda: anthropic.messages.create(...),
    deadline="2026-05-13T08:00:00-04:00",
    carbon_budget_g=5,
    region="us-east",
)
```

For now, Python users can still consume the MCP server via any
MCP-aware Python agent framework (e.g., `mcp` package on PyPI). See
the parent [`README.md`](../../README.md) for setup.
