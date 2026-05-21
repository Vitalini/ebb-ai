/**
 * Result delivery for the OpenClaw plugin.
 *
 * When a deferred task completes its result can be delivered through one
 * or more channels, chosen per task. The result is ALWAYS kept in the
 * queue as well — delivery is additive, never a replacement.
 *
 * Modes:
 *   - chat      → the gateway's active chat channel (Telegram here)
 *   - telegram  → an explicit Telegram DM (Bot API, key + chat from config)
 *   - webhook   → HTTP POST of the result to any URL
 *   - file      → write a rendered report to disk
 *   - queue     → no push; retrieve via check_queue_status (always on)
 *
 * The report renders as Markdown, HTML, plain text or JSON.
 *
 * Delivery preferences are kept in a plugin-owned sidecar
 * (~/.ebb-ai/delivery.json) keyed by task id — no core schema change.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { CarbonReceipt, TaskRecord } from "@ebb-ai/core";

export type DeliveryMode = "chat" | "telegram" | "webhook" | "file" | "queue";
export type ReportFormat = "md" | "html" | "txt" | "json";

export type DeliveryConfig = {
  modes: DeliveryMode[];
  webhookUrl?: string;
  filePath?: string;
  format?: ReportFormat;
};

/** A stored delivery entry — the config plus the last delivery's outcomes. */
export type DeliveryRecord = DeliveryConfig & {
  deliveredAt?: string;
  outcomes?: DeliveryOutcome[];
};

export type DeliveryOption = {
  mode: DeliveryMode;
  available: boolean;
  detail: string;
};

const ALL_FORMATS: ReportFormat[] = ["md", "html", "txt", "json"];

// ── Integration scan ────────────────────────────────────────────────────────

type TelegramChannelConfig = {
  enabled?: boolean;
  botToken?: string;
  allowFrom?: Array<string | number>;
};

function telegramConfig(openclawConfig: unknown): TelegramChannelConfig | undefined {
  return (
    openclawConfig as
      | { channels?: { telegram?: TelegramChannelConfig } }
      | undefined
  )?.channels?.telegram;
}

/** Resolve a Telegram bot token + DM chat id from the gateway config. */
export function telegramTarget(
  openclawConfig: unknown,
): { token: string; chatId: string } | undefined {
  const tg = telegramConfig(openclawConfig);
  if (!tg?.enabled || !tg.botToken || !tg.allowFrom?.length) return undefined;
  return { token: tg.botToken, chatId: String(tg.allowFrom[0]) };
}

/**
 * Scan which delivery options are usable in this gateway. `chat` /
 * `telegram` need a configured Telegram channel; `webhook` / `file` /
 * `queue` are always available.
 */
export function scanDeliveryOptions(openclawConfig: unknown): DeliveryOption[] {
  const tg = telegramTarget(openclawConfig);
  return [
    {
      mode: "chat",
      available: !!tg,
      detail: tg
        ? "deliver to your default OpenClaw chat — currently the Telegram DM (not group threads/topics yet)"
        : "no chat channel configured",
    },
    {
      mode: "telegram",
      available: !!tg,
      detail: tg
        ? "explicit Telegram direct message (same target as chat for now)"
        : "Telegram channel not configured",
    },
    {
      mode: "webhook",
      available: true,
      detail: "HTTP POST the result to a URL you provide",
    },
    {
      mode: "file",
      available: true,
      detail: "write a report file (format: md, html, txt or json)",
    },
    {
      mode: "queue",
      available: true,
      detail: "keep in the queue, retrieve with check_queue_status (always on)",
    },
  ];
}

// ── Delivery-preference sidecar ─────────────────────────────────────────────

function sidecarPath(): string {
  return (
    process.env.EBB_DELIVERY_FILE?.trim() ||
    join(homedir(), ".ebb-ai", "delivery.json")
  );
}

async function readSidecar(): Promise<Record<string, DeliveryRecord>> {
  try {
    return JSON.parse(await readFile(sidecarPath(), "utf8")) as Record<
      string,
      DeliveryRecord
    >;
  } catch {
    return {};
  }
}

async function writeSidecar(
  all: Record<string, DeliveryRecord>,
): Promise<void> {
  const path = sidecarPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(all, null, 2));
}

/** Persist the delivery preference for one task (keeps recorded outcomes). */
export async function setDeliveryConfig(
  taskId: string,
  config: DeliveryConfig,
): Promise<void> {
  const all = await readSidecar();
  all[taskId] = { ...all[taskId], ...config };
  await writeSidecar(all);
}

/** Record the outcomes of a delivery attempt so they are auditable later. */
export async function recordDeliveryOutcomes(
  taskId: string,
  config: DeliveryConfig,
  outcomes: DeliveryOutcome[],
): Promise<void> {
  const all = await readSidecar();
  all[taskId] = { ...config, deliveredAt: new Date().toISOString(), outcomes };
  await writeSidecar(all);
}

/** Read the delivery preference for one task; defaults to chat-or-queue. */
export async function getDeliveryConfig(
  taskId: string,
  fallbackChatAvailable: boolean,
): Promise<DeliveryConfig> {
  const all = await readSidecar();
  return all[taskId] ?? { modes: [fallbackChatAvailable ? "chat" : "queue"] };
}

/** Read the full delivery record (config + last outcomes) for one task. */
export async function readDeliveryRecord(
  taskId: string,
): Promise<DeliveryRecord | undefined> {
  return (await readSidecar())[taskId];
}

/** Validate a requested delivery config; returns an error string or null. */
export function validateDeliveryConfig(config: DeliveryConfig): string | null {
  if (!config.modes.length) return "deliver: choose at least one mode";
  if (config.modes.includes("webhook") && !config.webhookUrl?.trim()) {
    return "deliver includes webhook but webhook_url is missing";
  }
  if (config.modes.includes("file") && !config.filePath?.trim()) {
    return "deliver includes file but file_path is missing";
  }
  if (config.format && !ALL_FORMATS.includes(config.format)) {
    return `format must be one of: ${ALL_FORMATS.join(", ")}`;
  }
  return null;
}

// ── Report rendering ────────────────────────────────────────────────────────

type CompletedTask = TaskRecord<unknown> & {
  result?: { text?: string } | unknown;
  receipt?: CarbonReceipt;
};

function resultText(task: CompletedTask): string {
  const r = task.result as { text?: string } | undefined;
  if (r && typeof r.text === "string") return r.text;
  return typeof task.result === "string" ? task.result : "(no text result)";
}

function receiptLine(task: CompletedTask): string {
  const rc = task.receipt;
  if (!rc) return `region ${task.region}`;
  let carbon = "";
  if (typeof rc.actualCarbonGCo2 === "number") {
    carbon = `${rc.actualCarbonGCo2} gCO2e actual`;
    if (
      typeof rc.estimatedCarbonGCo2 === "number" &&
      typeof rc.deltaPct === "number"
    ) {
      carbon += ` (est ${rc.estimatedCarbonGCo2}, ${
        rc.deltaPct >= 0 ? "+" : ""
      }${rc.deltaPct}%)`;
    }
  } else if (typeof rc.estimatedCarbonGCo2 === "number") {
    carbon = `~${rc.estimatedCarbonGCo2} gCO2e`;
  }
  return [
    `ran ${rc.ranAt ?? task.completedAt ?? "?"}`,
    rc.region ?? task.region,
    rc.model ? `model ${rc.model}` : "",
    carbon,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Render a completed task as a report in the requested format. */
export function formatReport(
  task: CompletedTask,
  format: ReportFormat = "md",
): string {
  const text = resultText(task);
  const meta = receiptLine(task);
  const title = "ebb-ai — deferred task complete";

  if (format === "json") {
    return JSON.stringify(
      {
        task_id: task.taskId,
        status: task.status,
        scheduled_for: task.scheduledFor ?? null,
        completed_at: task.completedAt ?? null,
        region: task.region,
        receipt: task.receipt ?? null,
        result: text,
      },
      null,
      2,
    );
  }
  if (format === "txt") {
    return `${title}\ntask ${task.taskId}\n${meta}\n\n${text}\n`;
  }
  if (format === "html") {
    const esc = (s: string) =>
      s.replace(/[&<>]/g, (c) =>
        c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;",
      );
    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font:15px/1.6 ui-sans-serif,system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;color:#1a2230}
.meta{font:12px ui-monospace,monospace;color:#6b7280;border-left:3px solid #34d399;padding-left:.6rem}
pre{white-space:pre-wrap;background:#f6f8fa;padding:1rem;border-radius:8px}</style></head>
<body><h1>✅ ${esc(title)}</h1>
<p class="meta">task ${esc(task.taskId)}<br>${esc(meta)}</p>
<pre>${esc(text)}</pre></body></html>
`;
  }
  // markdown (default)
  return `# ✅ ${title}

\`task ${task.taskId}\` · ${meta}

---

${text}
`;
}

/** A compact chat/Telegram message — the report trimmed for a message. */
export function formatChatMessage(task: CompletedTask): string {
  const text = resultText(task);
  const meta = receiptLine(task);
  const body = text.length > 3500 ? `${text.slice(0, 3500)}\n…(truncated)` : text;
  return `✅ ebb-ai — deferred task complete\ntask ${task.taskId} · ${meta}\n\n${body}`;
}

// ── Delivery execution ──────────────────────────────────────────────────────

export type DeliveryOutcome = {
  mode: DeliveryMode;
  ok: boolean;
  detail: string;
};

async function deliverWebhook(
  task: CompletedTask,
  url: string,
): Promise<DeliveryOutcome> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "ebb-ai",
        task_id: task.taskId,
        status: task.status,
        completed_at: task.completedAt ?? null,
        region: task.region,
        receipt: task.receipt ?? null,
        result: resultText(task),
        report_md: formatReport(task, "md"),
      }),
    });
    if (!res.ok) {
      return { mode: "webhook", ok: false, detail: `HTTP ${res.status}` };
    }
    return { mode: "webhook", ok: true, detail: `POST ${url} → ${res.status}` };
  } catch (err) {
    return {
      mode: "webhook",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function deliverFile(
  task: CompletedTask,
  path: string,
  format: ReportFormat,
): Promise<DeliveryOutcome> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, formatReport(task, format));
    return { mode: "file", ok: true, detail: `wrote ${path}` };
  } catch (err) {
    return {
      mode: "file",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function deliverTelegram(
  task: CompletedTask,
  target: { token: string; chatId: string },
  mode: DeliveryMode,
): Promise<DeliveryOutcome> {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${target.token}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: target.chatId,
          text: formatChatMessage(task),
          disable_web_page_preview: true,
        }),
      },
    );
    if (!res.ok) {
      return { mode, ok: false, detail: `Telegram HTTP ${res.status}` };
    }
    return { mode, ok: true, detail: `Telegram DM → ${target.chatId}` };
  } catch (err) {
    return {
      mode,
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Deliver a completed task's result through every configured mode.
 * Never throws — each mode's outcome is reported individually so one
 * failing channel cannot block the others or crash the dispatcher.
 */
export async function deliverResult(
  task: CompletedTask,
  config: DeliveryConfig,
  openclawConfig: unknown,
): Promise<DeliveryOutcome[]> {
  const outcomes: DeliveryOutcome[] = [];
  for (const mode of config.modes) {
    if (mode === "queue") {
      outcomes.push({ mode, ok: true, detail: "kept in queue" });
      continue;
    }
    if (mode === "webhook") {
      outcomes.push(
        config.webhookUrl
          ? await deliverWebhook(task, config.webhookUrl)
          : { mode, ok: false, detail: "no webhook_url" },
      );
      continue;
    }
    if (mode === "file") {
      outcomes.push(
        config.filePath
          ? await deliverFile(task, config.filePath, config.format ?? "md")
          : { mode, ok: false, detail: "no file_path" },
      );
      continue;
    }
    if (mode === "chat" || mode === "telegram") {
      const target = telegramTarget(openclawConfig);
      outcomes.push(
        target
          ? await deliverTelegram(task, target, mode)
          : {
              mode,
              ok: false,
              detail: "no chat channel — result kept in queue",
            },
      );
      continue;
    }
  }
  return outcomes;
}
