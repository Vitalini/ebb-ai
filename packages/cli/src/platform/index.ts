/**
 * Platform-aware loader. Returns the right submodule for the current OS.
 * The submodules expose the same shape (`caffeinateWhilePending`,
 * `pmsetScheduleWake`, etc.); only macOS is fully wired in v0.4.
 */

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
