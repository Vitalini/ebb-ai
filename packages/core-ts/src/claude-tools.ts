/**
 * The Claude Code tools a `claude-code` task may use (v1).
 *
 * Read-only on purpose: a task can read web pages, and web content is
 * untrusted (prompt injection). So no tool that runs commands or writes
 * files is ever allowed: `Bash`, `Write` and `Edit` are not on the list.
 */

/** Every tool name a task, `TIDEGAP_CLAUDE_TOOLS` or the adapter accepts. */
export const CLAUDE_CODE_TOOL_ALLOWLIST: readonly string[] = ["WebSearch", "WebFetch", "Read", "Grep", "Glob"];

/** The tool set of a `claude-code` run when neither the task nor the env names one. */
export const DEFAULT_CLAUDE_CODE_TOOLS: readonly string[] = ["WebSearch", "WebFetch"];

/**
 * Check a `tools` value: an array of allowlisted names (`[]` = none).
 * Returns the error message, or `undefined` when the value is valid.
 */
export function claudeCodeToolsError(value: unknown): string | undefined {
  const allowed = `allowed: ${CLAUDE_CODE_TOOL_ALLOWLIST.join(", ")} (or [] for none)`;
  if (!Array.isArray(value)) return `tools must be an array of tool names; ${allowed}`;
  const bad = value.filter((t) => typeof t !== "string" || !CLAUDE_CODE_TOOL_ALLOWLIST.includes(t));
  if (bad.length === 0) return undefined;
  return `tools ${bad.map((t) => JSON.stringify(t)).join(", ")} not allowed; ${allowed}`;
}
