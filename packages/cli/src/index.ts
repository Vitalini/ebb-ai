#!/usr/bin/env node
/**
 * `ebb` — CLI entry point.
 *
 *   ebb tick           drain due tasks (one-shot or --daemon)
 *   ebb install        write launchd plist or print systemd/schtasks templates
 *   ebb queue list     print queued/scheduled/running/completed tasks
 *   ebb receipts list  print carbon receipts for completed tasks
 *   ebb stats          local-only personal-impact summary
 *   ebb register-wake  schedule a macOS wake event 30s before a task
 *   ebb ui             local task page (timeline, inbox, detail) on 127.0.0.1
 */

import { createRequire } from "node:module";
import { Command } from "commander";
import { runInstall, type InstallMode } from "./commands/install.js";
import { runQueueList, runQueueShow, runQueueUnread } from "./commands/queue.js";
import { runReceiptsList } from "./commands/receipts.js";
import { runRegisterWake } from "./commands/register-wake.js";
import { runStats } from "./commands/stats.js";
import { runTick } from "./commands/tick.js";
import { runUi } from "./commands/ui.js";
import { runVerify } from "./commands/verify.js";

/**
 * CLI version — read from this package's own `package.json` so there is
 * a single source of truth and `ebb --version` never drifts from the
 * published version. `createRequire` resolves relative to this module,
 * so it works from both `src` (tests) and `dist` (published bin).
 */
export function readCliVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const CLI_VERSION = readCliVersion();

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("ebb")
    .description("CLI for ebb-ai — carbon-aware scheduler tick + install")
    .version(CLI_VERSION);

  program
    .command("tick")
    .description("Drain due provider-call tasks")
    .option("--db <path>", "SQLite queue path", undefined)
    .option("--once", "Run a single drain pass (default)")
    .option("--daemon", "Loop forever, draining every --interval seconds")
    .option("--interval <sec>", "Daemon interval seconds", (v) => parseInt(v, 10), 60)
    .option("--region <code>", "Default region for hydrated tasks", undefined)
    .option("--no-notify", "Do not post an OS notification per finished task")
    .action(async (opts) => {
      const code = await runTick({
        notify: opts.notify !== false,
        db: opts.db,
        once: opts.once === true,
        daemon: opts.daemon === true,
        interval: opts.interval,
        region: opts.region,
      });
      process.exit(code);
    });

  const install = program
    .command("install")
    .description("Wire up the OS-level cron tick")
    .option("--laptop", "Laptop mode: launchd plist + pmset wake registration helper")
    .option("--server", "Server mode: launchd plist only, no wake events")
    .action(async (opts) => {
      let mode: InstallMode | undefined;
      if (opts.laptop) mode = "laptop";
      if (opts.server) mode = "server";
      if (!mode) {
        install.help({ error: true });
        process.exit(2);
        return;
      }
      const result = await runInstall({ mode });
      // eslint-disable-next-line no-console
      console.log(result.nextSteps);
    });

  const queue = program
    .command("queue")
    .description("Inspect the queue");
  queue
    .command("list")
    .description("List queued / scheduled / running / completed tasks")
    .option("--db <path>", "SQLite queue path", undefined)
    .option("--status <status>", "Filter by status", undefined)
    .option("--kind <kind>", "Filter by deadline kind: absolute | quota_reset", undefined)
    .option("--unread", "Only completed or failed tasks nobody has viewed yet")
    .option("--json", "Emit JSON instead of the table")
    .action(async (opts) => {
      try {
        const res = await runQueueList({
          db: opts.db,
          status: opts.status,
          kind: opts.kind,
          unread: opts.unread === true,
          json: opts.json === true,
        });
        // eslint-disable-next-line no-console
        console.log(res.rendered);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error((err as Error).message);
        process.exit(1);
      }
    });
  queue
    .command("show <task-id>")
    .description("Show one task: prompt, result, receipt; marks a finished task read")
    .option("--db <path>", "SQLite queue path", undefined)
    .option("--raw", "Include the raw vendor payload")
    .option("--json", "Emit JSON (the record plus its message history)")
    .option("--no-mark-read", "Do not mark the task read (for scripts)")
    .action(async (taskId: string, opts: {
      db?: string;
      raw?: boolean;
      json?: boolean;
      markRead?: boolean;
    }) => {
      try {
        const res = await runQueueShow(taskId, {
          db: opts.db,
          raw: opts.raw === true,
          json: opts.json === true,
          markRead: opts.markRead !== false,
        });
        // eslint-disable-next-line no-console
        console.log(res.rendered);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error((err as Error).message);
        process.exit(1);
      }
    });
  queue
    .command("unread <task-id>")
    .description("Mark a task unread again, so it shows in the inbox")
    .option("--db <path>", "SQLite queue path", undefined)
    .action(async (taskId: string, opts: { db?: string }) => {
      try {
        // eslint-disable-next-line no-console
        console.log(await runQueueUnread(taskId, { db: opts.db }));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error((err as Error).message);
        process.exit(1);
      }
    });

  const receipts = program
    .command("receipts")
    .description("Inspect carbon receipts");
  receipts
    .command("list")
    .description("List receipts for completed tasks")
    .option("--db <path>", "SQLite queue path", undefined)
    .option("--since <iso>", "Only receipts at or after this ISO-8601 time")
    .action(async (opts) => {
      try {
        const res = await runReceiptsList({ db: opts.db, since: opts.since });
        // eslint-disable-next-line no-console
        console.log(res.rendered);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error((err as Error).message);
        process.exit(1);
      }
    });

  program
    .command("stats")
    .description("Show local-only personal-impact stats from the queue ledger")
    .option("--db <path>", "SQLite queue path", undefined)
    .option("--json", "Emit JSON instead of the human-readable table")
    .action(async (opts) => {
      try {
        const res = await runStats({ db: opts.db, json: opts.json === true });
        // eslint-disable-next-line no-console
        console.log(res.rendered);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error((err as Error).message);
        process.exit(1);
      }
    });

  program
    .command("verify [task-id]")
    .description(
      "Verify the Ed25519 signature on a carbon receipt — from the ledger by task_id, or from a JSON file via --file",
    )
    .option("--db <path>", "SQLite queue path", undefined)
    .option("--file <path>", "Path to a receipt JSON file (alternative to task_id)", undefined)
    .option(
      "--trusted-public-key <b64>",
      "Pin the expected signer's public key (base64); fail if the receipt was signed by anyone else",
      undefined,
    )
    .option("--json", "Emit JSON instead of the human-readable summary")
    .action(async (taskId: string | undefined, opts: {
      db?: string;
      file?: string;
      trustedPublicKey?: string;
      json?: boolean;
    }) => {
      try {
        const res = await runVerify({
          taskId,
          db: opts.db,
          file: opts.file,
          trustedPublicKey: opts.trustedPublicKey,
          json: opts.json === true,
        });
        // eslint-disable-next-line no-console
        console.log(res.rendered);
        process.exit(res.exitCode);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error((err as Error).message);
        process.exit(4);
      }
    });

  program
    .command("register-wake <task-id>")
    .description("Schedule a macOS wake event 30s before a task's window")
    .option("--db <path>", "SQLite queue path", undefined)
    .option("--dry-run", "Print the pmset command without running it")
    .action(async (taskId: string, opts: { db?: string; dryRun?: boolean }) => {
      try {
        const res = await runRegisterWake({
          taskId,
          db: opts.db,
          dryRun: opts.dryRun === true,
        });
        // eslint-disable-next-line no-console
        console.log(res.message);
        process.exit(res.ok ? 0 : 1);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error((err as Error).message);
        process.exit(1);
      }
    });

  program
    .command("ui")
    .description("Open the local task page: timeline, inbox, task detail (127.0.0.1 only, read-only)")
    .option("--db <path>", "SQLite queue path", undefined)
    .option("--port <port>", "Port on 127.0.0.1 (default: a free port)", (v) => parseInt(v, 10), 0)
    .option("--region <code>", "Region for the forecast curve", undefined)
    .option("--no-open", "Print the URL without opening a browser")
    .action(async (opts: { db?: string; port?: number; region?: string; open?: boolean }) => {
      try {
        const code = await runUi({
          db: opts.db,
          port: opts.port,
          region: opts.region,
          open: opts.open !== false,
        });
        process.exit(code);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error((err as Error).message);
        process.exit(1);
      }
    });

  return program;
}

const isDirect = (() => {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    return import.meta.url.endsWith(argv1) || import.meta.url.includes("/cli/dist/index.js");
  } catch {
    return false;
  }
})();

if (isDirect) {
  buildProgram().parseAsync(process.argv).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
