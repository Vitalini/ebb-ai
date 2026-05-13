import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Pin the file-tracing root to the workspace root so Next stops warning
  // about multiple lockfiles (the repo has its own pnpm lockfile in the
  // monorepo root; the user may also have a stray ~/package-lock.json).
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  // The dashboard runs read-only on the public grid feeds (with mock fallback).
  // No image domains needed; charts are SVG via recharts.
};

export default config;
