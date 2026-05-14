# Security Policy

## Supported versions

Security fixes apply to the latest minor release on `main`. ebb-ai is
pre-1.0; please always upgrade to the latest tag before reporting.

| Version | Supported |
|---|---|
| v0.5.x   | ✅ |
| < v0.5   | ❌ — please upgrade before reporting |

## How to report a vulnerability

**Please do not open a public GitHub issue.**

Use the repository's private **Security Advisory** submission form:

> https://github.com/Vitalini/ebb-ai/security/advisories/new

Include:

- A description of the issue and its blast radius (what an attacker
  can do).
- Reproduction steps with concrete commands or code.
- Affected versions or commits.
- (Optional) A proposed fix or mitigation.

You'll get an acknowledgement within 72 hours. For critical issues
(remote code execution, secrets disclosure), the maintainer aims to
ship a fix within 7 days.

## Scope

In scope:

- The `@ebb-ai/core`, `@ebb-ai/mcp`, `@ebb-ai/cli` packages.
- The `ebb_ai` Python package.
- The `apps/dashboard` Next.js app.

Out of scope:

- Vulnerabilities in upstream dependencies — please report those to
  their respective maintainers. ebb-ai does not run a separate
  triage queue for third-party CVEs.
- Issues in your own deployment configuration (e.g. forgotten API
  keys, misconfigured launchd plist, weak sudo policy) — ebb-ai's
  defaults are documented as conservative; deployment is the
  operator's responsibility.

## Things that are NOT vulnerabilities

For transparency:

- The SQLite ledger is intentionally world-readable on the user's
  filesystem. Carbon receipts and task records are intentionally
  auditable. The receipt's `prompt` field is redacted by default
  using regex patterns for common API-key shapes — this is a
  best-effort sanitization, not a sandbox. If your prompts contain
  truly sensitive data, configure `redactInReceipt` explicitly.
- The MCP server runs over stdio in the host's process tree. It
  inherits the host's privileges. This is the MCP standard.

## Hall of Fame

We will credit reporters in `CHANGELOG.md` on request.
