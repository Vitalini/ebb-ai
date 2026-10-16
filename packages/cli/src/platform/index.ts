/**
 * Platform-aware loader. Returns the right submodule for the current OS.
 * The submodules expose the same shape (`caffeinateWhilePending`,
 * `pmsetScheduleWake`, etc.); only macOS is fully wired in v0.4.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import * as linux from "./linux.js";
import * as macos from "./macos.js";
import * as windows from "./windows.js";

export type PlatformName = "macos" | "linux" | "windows";

export function currentPlatform(): PlatformName {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  return "linux";
}

export function getPlatform(name?: PlatformName): {
  name: PlatformName;
  caffeinateWhilePending: typeof macos.caffeinateWhilePending;
  pmsetScheduleWake: typeof macos.pmsetScheduleWake;
} {
  const resolved = name ?? currentPlatform();
  if (resolved === "macos") {
    return {
      name: "macos",
      caffeinateWhilePending: macos.caffeinateWhilePending,
      pmsetScheduleWake: macos.pmsetScheduleWake,
    };
  }
  if (resolved === "windows") {
    return {
      name: "windows",
      caffeinateWhilePending: windows.caffeinateWhilePending,
      pmsetScheduleWake: windows.pmsetScheduleWake,
    };
  }
  return {
    name: "linux",
    caffeinateWhilePending: linux.caffeinateWhilePending,
    pmsetScheduleWake: linux.pmsetScheduleWake,
  };
}

export { macos, linux, windows };

/** Whether a tick daemon (`tidegap install`) is set up on this machine. */
export type DaemonStatus = "installed" | "not_installed" | "unknown";

/**
 * Probe for the unit file `tidegap install` writes: the macOS LaunchAgent plist
 * or the Linux systemd user timer. Windows reports `unknown`, because there
 * `tidegap install` only prints a schtasks command and nothing on disk shows
 * whether the user ran it.
 */
export function daemonStatus(
  opts: {
    platform?: NodeJS.Platform;
    home?: string;
    exists?: (path: string) => boolean;
  } = {},
): DaemonStatus {
  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? homedir();
  const exists = opts.exists ?? existsSync;
  // The 0.17 unit counts too: it keeps ticking the same ledger until removed.
  if (platform === "darwin") {
    const agents = join(home, "Library", "LaunchAgents");
    return [macos.LAUNCHD_LABEL, macos.LEGACY_LAUNCHD_LABEL].some((l) => exists(join(agents, `${l}.plist`)))
      ? "installed"
      : "not_installed";
  }
  if (platform === "win32") return "unknown";
  const units = join(home, ".config", "systemd", "user");
  return [linux.SYSTEMD_UNIT, linux.LEGACY_SYSTEMD_UNIT].some((u) => exists(join(units, `${u}.timer`)))
    ? "installed"
    : "not_installed";
}
