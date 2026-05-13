import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // The recharts default-export pattern produces a few any-casts at the
      // component boundary that aren't worth fighting; keep the rest strict.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
];

export default eslintConfig;
