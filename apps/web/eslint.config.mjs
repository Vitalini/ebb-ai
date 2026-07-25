import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Next.js 16 removed `next lint`; linting now runs through the ESLint CLI
 * (`pnpm -C apps/web lint` -> `eslint .`). `eslint-config-next` 16 ships native
 * flat configs, so the old `FlatCompat`/`@eslint/eslintrc` shim around
 * `next/core-web-vitals` + `next/typescript` is gone — same two rule-sets, now
 * imported directly.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // The recharts default-export pattern produces a few any-casts at the
      // component boundary that aren't worth fighting; keep the rest strict.
      "@typescript-eslint/no-explicit-any": "warn",

      // Two React Compiler rules arrived enabled-as-errors with
      // eslint-config-next 16 (eslint-plugin-react-hooks 6). They fire on
      // pre-existing, deliberate code — no product change came with the
      // upgrade — so they are demoted to warnings rather than silenced, and
      // rather than rewriting working components inside a dependency bump.
      //
      // react-hooks/purity: flags `Date.now()` in `app/plan/page.tsx` and
      //   `components/grid-greeting.tsx`. Both are Server Components (no
      //   "use client"), which render once per request — "now" is exactly
      //   what they mean, and there is no re-render for it to destabilize.
      //   The rule is modelling client-render semantics here.
      // react-hooks/set-state-in-effect: flags the hydration-safety
      //   `useEffect(() => setMounted(true), [])` in
      //   `components/best-window.tsx` and the initial timezone-local sync in
      //   `components/deadline-field.tsx`. Both exist precisely so server and
      //   first client render agree; "fixing" them would reintroduce the
      //   hydration mismatch they were written to avoid.
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // Default ignores of eslint-config-next, plus this app's build output.
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
