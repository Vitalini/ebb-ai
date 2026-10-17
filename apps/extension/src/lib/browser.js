// The extension API namespace. Firefox exposes `browser` (and `chrome`);
// Chrome and Edge expose `chrome`. Both return promises in MV3.
export const ext = globalThis.browser ?? globalThis.chrome;

/** True in Firefox, where host permissions are not granted at install. */
export function isFirefox() {
  return ext?.runtime?.getURL?.("").startsWith("moz-extension:") ?? false;
}
