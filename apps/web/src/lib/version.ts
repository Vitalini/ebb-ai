import corePackage from "@ebb-ai/core/package.json";

/** Released version of the ebb-ai packages, read from `@ebb-ai/core` so the site never drifts from npm. */
export const VERSION: string = corePackage.version;
