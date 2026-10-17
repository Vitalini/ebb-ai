/**
 * Client token registry and `tidegap clients` (native clients U1, KTD2).
 */

import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runClientsAdd, runClientsList, runClientsRevoke } from "../src/commands/clients.js";
import { ClientRegistry, CLIENTS_FILE } from "../src/ui/clients.js";

describe("client token registry", () => {
  let dir: string;
  let reg: ClientRegistry;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tidegap-clients-"));
    reg = new ClientRegistry(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const file = () => join(dir, CLIENTS_FILE);

  it("add writes one entry with a SHA-256 hash, no plaintext, mode 0600", () => {
    const { client, token } = reg.add({ name: "Chrome", kind: "extension" });
    expect(token).toMatch(/^tgc_[A-Za-z0-9_-]{43}$/);
    const text = readFileSync(file(), "utf8");
    expect(text).not.toContain(token);
    expect(text).not.toContain(token.slice(4));
    const parsed = JSON.parse(text) as { version: number; clients: Array<Record<string, string>> };
    expect(parsed.version).toBe(1);
    expect(parsed.clients).toHaveLength(1);
    expect(parsed.clients[0]).toMatchObject({ id: client.id, name: "Chrome", kind: "extension" });
    expect(parsed.clients[0]!.token_sha256).toMatch(/^[0-9a-f]{64}$/);
    if (process.platform !== "win32") expect(statSync(file()).mode & 0o777).toBe(0o600);
  });

  it("the minted token verifies; a token with one changed character does not", () => {
    const { client, token } = reg.add({ name: "Mac", kind: "macos" });
    expect(reg.verify(token)).toEqual(client);
    const last = token.at(-1) === "A" ? "B" : "A";
    expect(reg.verify(token.slice(0, -1) + last)).toBeUndefined();
    expect(reg.verify("not-a-client-token")).toBeUndefined();
  });

  it("revoke removes the entry; a cached registry sees it without a restart", () => {
    const server = new ClientRegistry(dir);
    const { client, token } = reg.add({ name: "Chrome", kind: "extension" });
    expect(server.verify(token)).toBeDefined();
    expect(reg.revoke(client.id)).toBe(true);
    expect(server.verify(token)).toBeUndefined();
    expect(reg.revoke(client.id)).toBe(false);
  });

  it("re-reads after an in-place edit that keeps the inode (mtime change)", () => {
    const server = new ClientRegistry(dir);
    const { token } = reg.add({ name: "Chrome", kind: "extension" });
    expect(server.verify(token)).toBeDefined();
    writeFileSync(file(), JSON.stringify({ version: 1, clients: [] }));
    const future = new Date(Date.now() + 5_000);
    utimesSync(file(), future, future);
    expect(server.verify(token)).toBeUndefined();
  });

  it("two adds give distinct ids and tokens, and both verify", () => {
    const a = reg.add({ name: "one", kind: "extension" });
    const b = reg.add({ name: "two", kind: "extension" });
    expect(a.client.id).not.toBe(b.client.id);
    expect(a.token).not.toBe(b.token);
    expect(reg.verify(a.token)?.id).toBe(a.client.id);
    expect(reg.verify(b.token)?.id).toBe(b.client.id);
  });

  it("a missing file is zero clients; a corrupt file throws on list and verifies nothing", () => {
    expect(reg.list()).toEqual([]);
    const { token } = reg.add({ name: "x", kind: "extension" });
    writeFileSync(file(), "{not json");
    expect(() => reg.list()).toThrow(/not valid JSON/);
    expect(reg.verify(token)).toBeUndefined();
    writeFileSync(file(), JSON.stringify({ version: 1, clients: [{ id: "x" }] }));
    expect(() => reg.list()).toThrow(/malformed/);
  });

  it("refuses an empty name and an unknown kind", () => {
    expect(() => reg.add({ name: "  ", kind: "extension" })).toThrow(/name must be/);
    expect(() => reg.add({ name: "x", kind: "phone" })).toThrow(/kind must be/);
  });
});

describe("tidegap clients", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tidegap-clients-cli-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("add --json prints parseable JSON with client_id and a tgc_ token", () => {
    const out = JSON.parse(runClientsAdd({ name: "Mac", kind: "macos", json: true }, { stateDir: dir })) as {
      client_id: string;
      token: string;
    };
    expect(out.client_id).toMatch(/^[0-9a-f]{12}$/);
    expect(out.token).toMatch(/^tgc_/);
    expect(new ClientRegistry(dir).verify(out.token)?.id).toBe(out.client_id);
  });

  it("add prints the token once with a store-it-now line; list never prints hashes", () => {
    const text = runClientsAdd({ name: "Chrome", kind: "extension" }, { stateDir: dir });
    expect(text).toMatch(/Token: tgc_/);
    expect(text).toMatch(/Store it now/);
    const { token_sha256: hash } = (
      JSON.parse(readFileSync(join(dir, CLIENTS_FILE), "utf8")) as { clients: Array<{ token_sha256: string }> }
    ).clients[0]!;
    const table = runClientsList({}, { stateDir: dir });
    expect(table).toContain("Chrome");
    expect(table).not.toContain(hash);
    expect(runClientsList({ json: true }, { stateDir: dir })).not.toContain(hash);
  });

  it("revoke of an unknown id throws (exit 1 in the CLI)", () => {
    expect(() => runClientsRevoke("nope", { stateDir: dir })).toThrow(/no client with id nope/);
  });

  it("list on a corrupt registry throws with a message", () => {
    writeFileSync(join(dir, CLIENTS_FILE), "[]");
    expect(() => runClientsList({}, { stateDir: dir })).toThrow(/malformed/);
  });
});
