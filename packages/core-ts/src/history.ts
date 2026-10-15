/**
 * Task-visibility helpers (v0.17): title derivation, message history and
 * display text. Pure functions; no I/O.
 */

import type { QuotaResetConfig } from "./quota.js";
import { redactPrompt } from "./redact.js";
import type { ProviderCallSpec, TaskMessage, TaskRecord } from "./types.js";

/** Maximum stored title length, in characters. */
export const TITLE_MAX_CHARS = 80;

// C0 controls except TAB and LF, DEL, and C1 controls. CR is stripped too:
// a bare CR rewinds the terminal line and can hide text.
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const CONTROL_CHARS_WITH_NEWLINES = /[\u0000-\u0008\u000A-\u001F\u007F-\u009F]/g;

/**
 * Remove control characters (C0 and C1, including ESC) from untrusted text
 * before it reaches a terminal or a hook line, so a prompt or a model reply
 * cannot inject terminal escape sequences. `multiline: true` keeps newlines
 * and tabs; otherwise every newline and tab becomes a space.
 */
export function stripControlChars(
  text: string,
  opts: { multiline?: boolean } = {},
): string {
  if (opts.multiline) return text.replace(CONTROL_CHARS, "");
  return text
    .replace(/[\t\n]/g, " ")
    .replace(CONTROL_CHARS_WITH_NEWLINES, "");
}

/**
 * Derive a task title: the first non-empty line of `text`, redacted with
 * the spec's patterns (or the defaults), control characters removed,
 * whitespace collapsed, cut to {@link TITLE_MAX_CHARS} with an ellipsis.
 * Returns undefined when nothing printable remains.
 */
export function deriveTitle(
  text: string,
  redactPatterns?: string[],
): string | undefined {
  const redacted = redactPrompt(text, redactPatterns);
  const firstLine =
    redacted
      .split(/\r?\n/)
      .map((l) => stripControlChars(l).replace(/\s+/g, " ").trim())
      .find((l) => l.length > 0) ?? "";
  if (firstLine.length === 0) return undefined;
  const chars = Array.from(firstLine);
  if (chars.length <= TITLE_MAX_CHARS) return firstLine;
  return `${chars.slice(0, TITLE_MAX_CHARS - 1).join("").trimEnd()}…`;
}

function parseSpec(bodyJson: string | undefined): Partial<ProviderCallSpec> | undefined {
  if (!bodyJson) return undefined;
  try {
    const spec = JSON.parse(bodyJson) as Partial<ProviderCallSpec> | null;
    return spec && typeof spec === "object" ? spec : undefined;
  } catch {
    return undefined;
  }
}

/** The stored prompt of a provider-call task (redacted once the task finished). */
export function taskPrompt(record: TaskRecord<unknown>): string | undefined {
  const spec = parseSpec(record.bodyJson);
  return typeof spec?.prompt === "string" ? spec.prompt : undefined;
}

/** The model's reply text of a completed provider-call task, when present. */
export function taskResultText(record: TaskRecord<unknown>): string | undefined {
  const r = record.result as { text?: unknown } | undefined;
  return r && typeof r === "object" && typeof r.text === "string" ? r.text : undefined;
}

/**
 * The task's full conversation, oldest first: prior turns stored in
 * `body_json.messages`, then the prompt as the user turn, then the result
 * text as the assistant turn when the task completed. A corrupt or
 * closure-task body yields an empty list.
 */
export function taskHistory(record: TaskRecord<unknown>): TaskMessage[] {
  const spec = parseSpec(record.bodyJson);
  if (!spec || typeof spec.prompt !== "string") return [];
  const out: TaskMessage[] = [];
  if (Array.isArray(spec.messages)) {
    for (const m of spec.messages) {
      if (
        m &&
        typeof m === "object" &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string"
      ) {
        out.push({ role: m.role, content: m.content });
      }
    }
  }
  out.push({ role: "user", content: spec.prompt });
  const reply = record.status === "completed" ? taskResultText(record) : undefined;
  if (reply !== undefined) out.push({ role: "assistant", content: reply });
  return out;
}

/**
 * Display label for a task's deadline kind (R21). `absolute` for a plain
 * deadline; `quota reset (claude)` for a quota deadline, extended with
 * `, reset_at <iso>, margin_h <n>` when `quota` has the label (the reset is
 * the stored deadline plus the margin configured now).
 */
export function deadlineKindLabel(
  record: Pick<TaskRecord<unknown>, "deadlineKind" | "quotaProvider" | "deadline">,
  quota: QuotaResetConfig = {},
): string {
  if (record.deadlineKind !== "quota_reset") return "absolute";
  const label = `quota reset (${record.quotaProvider ?? "unknown"})`;
  const schedule = quota[record.quotaProvider ?? ""];
  const deadlineMs = record.deadline ? Date.parse(record.deadline) : Number.NaN;
  if (!schedule || !Number.isFinite(deadlineMs)) return label;
  const resetAt = new Date(deadlineMs + schedule.marginH * 3_600_000);
  return `${label}, reset_at ${resetAt.toISOString()}, margin_h ${schedule.marginH}`;
}
