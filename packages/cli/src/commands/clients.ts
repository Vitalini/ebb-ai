/**
 * `tidegap clients add | list | revoke` — manage the long-lived tokens that
 * let the browser extension and the Mac app call `tidegap ui` (KTD2). The
 * token is printed once by `add`; the registry keeps only its SHA-256.
 */

import { ClientRegistry, type ClientInfo } from "../ui/clients.js";

export interface ClientsOptions {
  /** Directory of `ui-clients.json`; default: the Tidegap home. */
  stateDir?: string;
}

function registry(opts: ClientsOptions): ClientRegistry {
  return new ClientRegistry(opts.stateDir);
}

export function runClientsAdd(
  input: { name: string; kind: string; json?: boolean },
  opts: ClientsOptions = {},
): string {
  const { client, token } = registry(opts).add({ name: input.name, kind: input.kind });
  if (input.json) return JSON.stringify({ client_id: client.id, token });
  return (
    `Added client ${client.id} (${client.kind}, "${client.name}").\n` +
    `Token: ${token}\n` +
    `Store it now: it is shown only once. Revoke it with \`tidegap clients revoke ${client.id}\`.`
  );
}

function renderClients(clients: ClientInfo[]): string {
  if (clients.length === 0) return "No clients. Add one with `tidegap clients add --name <name> --kind extension|macos`.";
  const rows = clients.map((c) => [c.id, c.kind, c.created_at, c.name]);
  const header = ["ID", "KIND", "CREATED", "NAME"];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  return [header, ...rows].map((r) => r.map((cell, i) => (i < 3 ? cell.padEnd(widths[i]!) : cell)).join("  ")).join("\n");
}

export function runClientsList(input: { json?: boolean } = {}, opts: ClientsOptions = {}): string {
  const clients = registry(opts).list();
  return input.json ? JSON.stringify({ clients }) : renderClients(clients);
}

/** Throws when no client has that id. */
export function runClientsRevoke(id: string, opts: ClientsOptions = {}): string {
  if (!registry(opts).revoke(id)) throw new Error(`no client with id ${id}`);
  return `Revoked client ${id}. Its token stops working on the next request.`;
}
