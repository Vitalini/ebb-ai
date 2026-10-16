// @vitalini/ebb 0.17.1: the last release under the old ClawHub name.
// Ebb AI was renamed to Tidegap in 0.18.0. This plugin keeps the runtime id
// `ebb`, registers no tools, and logs one warning per gateway start that
// points at clawhub:@vitalini/tidegap. Hand-written and dependency-free.

const RENAMED_MESSAGE =
  "ebb was renamed to Tidegap. Install clawhub:@vitalini/tidegap and move your " +
  "plugins.entries.ebb config block to plugins.entries.tidegap. Tidegap moves " +
  "your ~/.ebb-ai queue to ~/.tidegap on first run; nothing else to migrate.";

let warned = false;

export default {
  id: "ebb",
  name: "ebb — renamed to Tidegap",
  description: "Renamed to @vitalini/tidegap — https://github.com/tidegap/tidegap",
  // Accept any existing plugins.entries.ebb block, so a 0.17 config still loads.
  configSchema: {
    safeParse(value) {
      if (value === undefined) return { success: true, data: undefined };
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        return { success: true, data: value };
      }
      return { success: false, error: { issues: [{ path: [], message: "expected config object" }] } };
    },
    jsonSchema: { type: "object", properties: {}, additionalProperties: true },
  },
  register(api) {
    if (warned || (api.registrationMode && api.registrationMode !== "full")) return;
    warned = true;
    api.logger.warn(RENAMED_MESSAGE);
  },
};
