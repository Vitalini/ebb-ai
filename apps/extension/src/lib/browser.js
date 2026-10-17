// The extension API namespace. Firefox exposes `browser` (and `chrome`);
// Chrome and Edge expose `chrome`. Both return promises in MV3.
export const ext = globalThis.browser ?? globalThis.chrome;

/** True in Firefox and Safari, where host permissions are not granted at install. */
export function needsHostGrant(extensionUrl = ext?.runtime?.getURL?.("") ?? "") {
  return /^(?:moz|safari-web)-extension:/.test(extensionUrl);
}
