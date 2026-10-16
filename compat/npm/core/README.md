# @ebb-ai/core (renamed)

This package is now **[`@tidegap/core`](https://www.npmjs.com/package/@tidegap/core)**.

Ebb AI was renamed to Tidegap in 0.18.0. `@ebb-ai/core` 0.17.1 re-exports `@tidegap/core` (and its `grid`, `energy` and `types` subpaths), prints one deprecation line to stderr when imported, and receives no further updates.

```bash
npm uninstall @ebb-ai/core
npm install @tidegap/core
```

Then change `from "@ebb-ai/core"` to `from "@tidegap/core"`. What else changes: <https://github.com/tidegap/tidegap#renamed-from-ebb-ai>.
