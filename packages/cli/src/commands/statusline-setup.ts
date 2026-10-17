/**
 * Offer to register `tidegap usage hook` as the Claude Code statusLine
 * command (D1). Writes `~/.claude/settings.json` only after the user's yes;
 * an existing statusLine command is kept and wrapped (`usage hook -- sh -c
 * '<old command>'`), so the user's statusline still prints.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Shell-quote one token. */
function shq(s: string): string {
  return /^[A-Za-z0-9_./:@%+=-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

export function claudeSettingsPath(home: string = homedir()): string {
  return join(home, ".claude", "settings.json");
}

/** The statusLine command: the hook, wrapping `existing` when there is one. */
export function statuslineCommand(launcher: string[], existing?: string): string {
  const hook = `${launcher.map(shq).join(" ")} usage hook`;
  return existing ? `${hook} -- sh -c ${shq(existing)}` : hook;
}

/** The manual snippet for `~/.claude/settings.json`. */
export function statuslineSnippet(launcher: string[] = ["tidegap"]): string {
  return JSON.stringify({ statusLine: { type: "command", command: statuslineCommand(launcher) } }, null, 2);
}

export type StatuslineSetupResult =
  | { status: "registered"; command: string }
  | { status: "already" }
  | { status: "declined" }
  | { status: "unreadable"; reason: string };

export async function offerStatuslineHook(opts: {
  launcher: string[];
  confirm: (question: string) => Promise<boolean>;
  settingsPath?: string;
}): Promise<StatuslineSetupResult> {
  const path = opts.settingsPath ?? claudeSettingsPath();
  let settings: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not a JSON object");
      settings = parsed as Record<string, unknown>;
    } catch (err) {
      return { status: "unreadable", reason: `${path}: ${(err as Error).message}` };
    }
  }
  const current = settings.statusLine as { type?: unknown; command?: unknown } | undefined;
  const existing = typeof current?.command === "string" && current.command.trim() ? current.command : undefined;
  if (existing && /\busage hook\b/.test(existing)) return { status: "already" };
  const command = statuslineCommand(opts.launcher, existing);
  const question = existing
    ? `Wrap your Claude Code statusLine in \`tidegap usage hook\` so Tidegap sees your subscription limits?\n  ${path}: ${command}\n[y/N] `
    : `Register \`tidegap usage hook\` as the Claude Code statusLine so Tidegap sees your subscription limits?\n  ${path}: ${command}\n[y/N] `;
  if (!(await opts.confirm(question))) return { status: "declined" };
  const next = { ...settings, statusLine: { ...(current ?? {}), type: "command", command } };
  const tmp = `${path}.tidegap.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
  return { status: "registered", command };
}
