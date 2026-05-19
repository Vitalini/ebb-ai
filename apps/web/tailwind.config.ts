/**
 * Tailwind 4 configuration.
 *
 * In v4 the recommended pattern is to declare theme tokens directly in CSS
 * via `@theme`. This file exists only to pin the content-scan globs and
 * make the config explicit for future-readers / linters.
 */
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx,mdx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
  ],
};

export default config;
