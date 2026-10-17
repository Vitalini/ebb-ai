// Settings and poll state in storage.local. The token is a long-lived client
// token (`tgc_…`) the user pastes once in the options page (KTD2).

import { ext } from "./browser.js";

export const DEFAULT_PORT = 47821;

export const DEFAULTS = Object.freeze({
  port: DEFAULT_PORT,
  token: "",
  notify: { finished: true, cleanWindow: true },
  // Server cursor for /api/summary?since= (KTD5). null until the first poll.
  cursor: null,
  // Ids of the last finished tasks already notified (a repeat answer sends nothing).
  seen: [],
  // The clean window from the last summary, and the start already notified.
  lastWindow: null,
  region: null,
  notifiedStart: null,
});

/** A port number 1-65535, or null. */
export function parsePort(value) {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

/** Fill defaults and drop malformed values. */
export function normalize(raw = {}) {
  const notify = raw.notify && typeof raw.notify === "object" ? raw.notify : {};
  return {
    port: parsePort(raw.port) ?? DEFAULT_PORT,
    token: typeof raw.token === "string" ? raw.token.trim() : "",
    notify: {
      finished: notify.finished !== false,
      cleanWindow: notify.cleanWindow !== false,
    },
    cursor: typeof raw.cursor === "string" ? raw.cursor : null,
    seen: Array.isArray(raw.seen) ? raw.seen.filter((id) => typeof id === "string") : [],
    lastWindow: raw.lastWindow && typeof raw.lastWindow === "object" ? raw.lastWindow : null,
    region: typeof raw.region === "string" ? raw.region : null,
    notifiedStart: typeof raw.notifiedStart === "string" ? raw.notifiedStart : null,
  };
}

export async function loadSettings(storage = ext.storage.local) {
  return normalize(await storage.get(Object.keys(DEFAULTS)));
}

export function saveSettings(patch, storage = ext.storage.local) {
  return storage.set(patch);
}

/**
 * The patch for a new port or token. A new token starts a fresh cursor, so
 * the first poll after pairing stores the cursor without notifying.
 */
export function connectionPatch(current, { port, token, notify }) {
  const patch = { port, token, notify };
  if (token !== current.token) Object.assign(patch, { cursor: null, seen: [], notifiedStart: null });
  return patch;
}
