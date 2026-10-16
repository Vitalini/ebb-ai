// Imported by every entry of this shim; ES modules run once, so the line prints once.
const line = "@ebb-ai/core is now @tidegap/core; install @tidegap/core (this package stops receiving updates).";
if (typeof process !== "undefined" && process.stderr && typeof process.stderr.write === "function") {
  process.stderr.write(`${line}\n`);
} else if (typeof console !== "undefined") {
  console.warn(line);
}
