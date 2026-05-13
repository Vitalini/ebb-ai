## Summary

<!-- 1-3 sentences. What does this PR change and why. -->

## Type of change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that changes existing behavior)
- [ ] Documentation
- [ ] Test-only / CI / chore

## Test plan

<!-- How did you verify this? Specific commands or scenarios. -->

```
pnpm --filter @ebb-ai/core test
pnpm --filter @ebb-ai/mcp test
pnpm --filter @ebb-ai/cli test
```

## Checklist

- [ ] All existing tests still pass locally.
- [ ] New tests added where the change touches behavior.
- [ ] `CHANGELOG.md` updated under `[Unreleased]` if user-visible.
- [ ] If touching public types: documented in the relevant package's README.
- [ ] If touching the SQLite schema: migration is idempotent and additive.

## Related issues

<!-- Closes #123, refs #456 -->
