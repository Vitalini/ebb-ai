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
 */

import { Command } from "commander";
import { runInstall, type InstallMode } from "./commands/install.js";
import { runQueueList } from "./commands/queue.js";
import { runReceiptsList } from "./commands/receipts.js";
import { runRegisterWake } from "./commands/register-wake.js";
import { runStats } from "./commands/stats.js";
import { runTick } from "./commands/tick.js";

/** CLI version — keep in sync with `package.json`. Sole source of truth for
 * what `ebb --version` prints. */
const CLI_VERSION = "0.10.0";

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
    .action(async (opts) => {
      const code = await runTick({
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
    .action(async (opts) => {
      try {
        const res = await runQueueList({ db: opts.db, status: opts.status });
        // eslint-disable-next-line no-console
        console.log(res.rendered);
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
