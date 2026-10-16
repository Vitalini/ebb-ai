import corePackage from "@tidegap/core/package.json";

/** Released version of the Tidegap packages, read from `@tidegap/core` so the site never drifts from npm. */
export const VERSION: string = corePackage.version;
