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

  // Pretty-URL rewrites for the static-site pages bundled under `public/`.
  // Visitors get /architecture, /docs, /roadmap instead of the .html
  // variants. Filed under "polish #3" in v0.8.x — closes the 404 on
  // www.ebb-ai.com that the global test pass found.
  async rewrites() {
    return [
      // /docs is now a real Next.js route.
      // /architecture stays as a static .html page in public/.
      // /roadmap was removed — that content is now private planning, kept
      // in ROADMAP.md outside git rather than published.
      { source: "/architecture", destination: "/architecture.html" },
    ];
  },
};

export default config;
