# Contributing to ebb-ai

Thank you for considering a contribution. ebb-ai is a small, carefully
scoped project: a carbon-aware scheduler for agentic-AI workloads, a
matching Model Context Protocol server, and a future spec proposal
for upstream MCP. Contributions in any of those three areas, plus
documentation and integrations, are welcome.

## Before you write code

If your change is small (one-line bug fix, typo, test addition) just
send the PR.

If your change is larger (new feature, API change, new provider
adapter, anything in the spec proposal layer) please **open an issue
first**. We want to discuss the shape before you invest time. The
24-week roadmap is in [`PLAN.md`](./PLAN.md); the success metrics in
section 8 reflect what we're aiming for in the v0.x line. Anything
outside that scope is welcome to discuss but may be deferred.

## Development setup

```bash
git clone https://github.com/Vitalini/ebb-ai.git
cd ebb-ai
pnpm install
pnpm build
pnpm test     # 18/18 should pass
```

Requirements: Node 20+, pnpm 9+.

## Workflow

1. Fork the repository.
2. Branch from `main` — name the branch after the area
   (`feat/anthropic-batch`, `fix/scheduler-timer-overflow`,
   `docs/spec/priority-field`).
3. Write the change. Add or update tests so they cover the new
   behavior.
4. Run `pnpm typecheck && pnpm build && pnpm test` locally. Make
   sure all pass.
5. Commit. Use a clear subject; mention the package in scope where
   applicable (`feat(core): enforce carbonBudgetG in scheduler`).
6. Open a PR against `main`. Describe what changed and why, link
   any related issue.

CI will run the same `typecheck → build → test` matrix on Node 20
and 22; PRs need it green before merge.

## Code style

- TypeScript strict mode, `noUncheckedIndexedAccess`,
  `noImplicitOverride` (already configured in
  `tsconfig.base.json`).
- Prefer named exports.
- Prefer `Promise<T>` over `async` for public types; use `async` in
  bodies where it helps readability.
- Comments answer *why*, not *what*. Don't restate the code.
- No emojis in source or docs unless a specific user-facing surface
  explicitly calls for them.
- American English in code, comments, and documentation. Oxford
  comma.

## Tests

- `vitest` for both core and mcp-server. Tests live next to the
  package in `test/`.
- Aim for meaningful tests, not coverage-fishing. The reviewer who
  audited v0.1 explicitly called out that the 9 core-ts tests are
  *meaningful, not just structural* — keep that bar.
- New public-API surface needs at least one happy-path test plus
  one failure-path test (rejection, error type, etc.).

## Documentation

- Update `CHANGELOG.md` under `[Unreleased]` for any user-visible
  change.
- If you change the public API of `@ebb-ai/core` or `@ebb-ai/mcp`,
  update the relevant package README.
- If you add a new example integration, add a `README.md` to its
  folder.

## Releases

ebb-ai follows [Semantic Versioning](https://semver.org). The
release process (cut a tag, publish to npm, draft GitHub release
notes from the CHANGELOG) lands when the project decides to publish
to npm — which is post-v0.1.0 per the roadmap. For now, all releases
are local-only.

## Security

If you discover a security issue (especially around the MCP server's
handling of untrusted input or the Electricity Maps API key), please
report it privately by email rather than in a public issue. See
`SECURITY.md` (forthcoming) for the disclosure policy.

## License

By contributing you agree that your contribution will be licensed
under the Apache License 2.0, the same license as the project.
