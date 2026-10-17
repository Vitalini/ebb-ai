/**
 * Client token registry for `tidegap ui` (native clients, KTD2).
 *
 * A client token (`tgc_…`) lets a browser extension or the Mac app call the
 * local API across `tidegap ui` restarts. The registry file
 * `<tidegap home>/ui-clients.json` (mode 0600, written atomically) stores
 * only the SHA-256 of each token, never the token itself. The server re-reads
 * the file when it changes on disk, so `tidegap clients add` and `revoke`
 * apply without a restart.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { resolveTidegapHome, stripControlChars } from "@tidegap/core";

export const CLIENTS_FILE = "ui-clients.json";
export const CLIENT_TOKEN_PREFIX = "tgc_";
export const CLIENT_KINDS = ["extension", "macos"] as const;
export type ClientKind = (typeof CLIENT_KINDS)[number];
/** Longest client name, in characters. */
export const CLIENT_NAME_MAX = 64;

/** One registry entry, as stored. */
export interface ClientEntry {
  id: string;
  name: string;
  kind: ClientKind;
  token_sha256: string;
  created_at: string;
}

/** What `list` and the API show: the entry without its hash. */
export type ClientInfo = Omit<ClientEntry, "token_sha256">;

/** The registry file is unreadable or malformed, or the input is invalid. */
export class ClientRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientRegistryError";
  }
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function info(e: ClientEntry): ClientInfo {
  return { id: e.id, name: e.name, kind: e.kind, created_at: e.created_at };
}

function isEntry(v: unknown): v is ClientEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.name === "string" &&
    typeof e.created_at === "string" &&
    typeof e.token_sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(e.token_sha256) &&
    (CLIENT_KINDS as readonly string[]).includes(e.kind as string)
  );
}

/** A clean client name, or the error message. */
export function cleanClientName(raw: unknown): string | ClientRegistryError {
  const name = typeof raw === "string" ? stripControlChars(raw).trim() : "";
  if (name.length === 0 || name.length > CLIENT_NAME_MAX) {
    return new ClientRegistryError(`name must be 1 to ${CLIENT_NAME_MAX} characters`);
  }
  return name;
}

export function isClientKind(v: unknown): v is ClientKind {
  return (CLIENT_KINDS as readonly unknown[]).includes(v);
}

export class ClientRegistry {
  readonly path: string;
  private cache: { key: string; entries: ClientEntry[] } | undefined;

  constructor(stateDir: string = resolveTidegapHome()) {
    this.path = join(stateDir, CLIENTS_FILE);
  }

  /**
   * Every entry. A missing file is zero clients; a malformed one throws
   * `ClientRegistryError` (the CLI reports it, the server treats it as zero).
   */
  load(): ClientEntry[] {
    let text: string;
    try {
      text = readFileSync(this.path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new ClientRegistryError(`cannot read ${this.path}: ${(err as Error).message}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ClientRegistryError(`${this.path} is not valid JSON; fix or delete it`);
    }
    const clients = (parsed as { version?: unknown; clients?: unknown } | null)?.clients;
    if ((parsed as { version?: unknown } | null)?.version !== 1 || !Array.isArray(clients) || !clients.every(isEntry)) {
      throw new ClientRegistryError(`${this.path} is malformed; fix or delete it`);
    }
    return clients;
  }

  list(): ClientInfo[] {
    return this.load().map(info);
  }

  /** Mint a client token. The token is returned once and never stored. */
  add(input: { name: unknown; kind: unknown }, now: Date = new Date()): { client: ClientInfo; token: string } {
    const name = cleanClientName(input.name);
    if (name instanceof ClientRegistryError) throw name;
    if (!isClientKind(input.kind)) throw new ClientRegistryError(`kind must be one of ${CLIENT_KINDS.join(", ")}`);
    const entries = this.load();
    const token = `${CLIENT_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const entry: ClientEntry = {
      id: randomBytes(6).toString("hex"),
      name,
      kind: input.kind,
      token_sha256: sha256Hex(token),
      created_at: now.toISOString(),
    };
    this.write([...entries, entry]);
    return { client: info(entry), token };
  }

  /** Remove a client; false when no client has that id. */
  revoke(id: string): boolean {
    const entries = this.load();
    const rest = entries.filter((e) => e.id !== id);
    if (rest.length === entries.length) return false;
    this.write(rest);
    return true;
  }

  /**
   * The client a bearer token belongs to, or `undefined`. Hashes the bearer
   * once and compares it with every stored hash in constant time, without
   * stopping at the first match. Never throws: a bad registry means no
   * clients, so the server stays up.
   */
  verify(bearer: string): ClientInfo | undefined {
    if (!bearer.startsWith(CLIENT_TOKEN_PREFIX)) return undefined;
    const presented = createHash("sha256").update(bearer).digest();
    let match: ClientEntry | undefined;
    for (const e of this.cached()) {
      if (timingSafeEqual(presented, Buffer.from(e.token_sha256, "hex")) && !match) match = e;
    }
    return match ? info(match) : undefined;
  }

  /** Entries re-read only when the file changes (inode, mtime or size). */
  private cached(): ClientEntry[] {
    let key: string;
    try {
      const st = statSync(this.path);
      key = `${st.ino}:${st.mtimeMs}:${st.size}`;
    } catch {
      this.cache = undefined;
      return [];
    }
    if (this.cache?.key === key) return this.cache.entries;
    let entries: ClientEntry[];
    try {
      entries = this.load();
    } catch {
      entries = [];
    }
    this.cache = { key, entries };
    return entries;
  }

  private write(clients: ClientEntry[]): void {
    const dir = join(this.path, "..");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    try {
      writeFileSync(tmp, `${JSON.stringify({ version: 1, clients }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, this.path);
    } catch (err) {
      try {
        unlinkSync(tmp);
      } catch {
        // nothing to clean up
      }
      throw err;
    }
  }
}
