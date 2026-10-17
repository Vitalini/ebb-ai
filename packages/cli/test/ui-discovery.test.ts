/**
 * `tidegap ui` discovery file and default port (native clients U2, KTD4).
 */

import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startUi } from "../src/commands/ui.js";
import { discoveryPath, readDiscovery, removeDiscovery } from "../src/ui/discovery.js";

/** Hold a port on 127.0.0.1, standing in for whatever already uses 47821. */
function squat(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === "object" && addr ? addr.port : 0 });
    });
  });
}

describe("tidegap ui discovery and default port", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tidegap-ui-disc-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes ui.json (pid, port, mode 0600, no token) on start and removes it on close", async () => {
    const { server, link } = await startUi({ db: join(dir, "queue.db"), stateDir: dir, port: 0, cliVersion: "9.9.9" });
    try {
      const d = readDiscovery(dir);
      expect(d).toMatchObject({ version: 1, pid: process.pid, port: server.port, url: server.url, cli_version: "9.9.9" });
      expect(Date.parse(d!.started_at)).not.toBeNaN();
      const token = link.split("#token=")[1]!;
      expect(JSON.stringify(d)).not.toContain(token);
      if (process.platform !== "win32") expect(statSync(discoveryPath(dir)).mode & 0o777).toBe(0o600);
    } finally {
      await server.close();
    }
    expect(readDiscovery(dir)).toBeUndefined();
  });

  it("leaves a ui.json that names another pid in place", () => {
    const other = { version: 1, pid: process.pid + 1, port: 1234, url: "http://127.0.0.1:1234/", started_at: "x", cli_version: "1" };
    writeFileSync(discoveryPath(dir), JSON.stringify(other));
    removeDiscovery(dir, process.pid);
    expect(readDiscovery(dir)).toEqual(other);
  });

  it("tries the default port first", async () => {
    const probe = await squat();
    const free = probe.port;
    await new Promise<void>((r) => probe.server.close(() => r()));
    const { server, warning } = await startUi({ db: join(dir, "queue.db"), stateDir: dir, defaultPort: free });
    try {
      expect(server.port).toBe(free);
      expect(warning).toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it("falls back to a free port with a warning when the default port is taken", async () => {
    const held = await squat();
    try {
      const { server, warning } = await startUi({ db: join(dir, "queue.db"), stateDir: dir, defaultPort: held.port });
      try {
        expect(server.port).not.toBe(held.port);
        expect(warning).toMatch(new RegExp(`port ${held.port} is in use, serving on ${server.port}`));
        expect(readDiscovery(dir)?.port).toBe(server.port);
      } finally {
        await server.close();
      }
    } finally {
      await new Promise<void>((r) => held.server.close(() => r()));
    }
  });

  it("an explicit --port that is taken fails instead of falling back", async () => {
    const held = await squat();
    try {
      await expect(startUi({ db: join(dir, "queue.db"), stateDir: dir, port: held.port })).rejects.toMatchObject({
        code: "EADDRINUSE",
      });
      expect(readDiscovery(dir)).toBeUndefined();
    } finally {
      await new Promise<void>((r) => held.server.close(() => r()));
    }
  });
});
