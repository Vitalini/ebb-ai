# @ebb-ai/cli (renamed)

This package is now **[`@tidegap/cli`](https://www.npmjs.com/package/@tidegap/cli)**, and the command is `tidegap`.

Ebb AI was renamed to Tidegap in 0.18.0. `@ebb-ai/cli` 0.17.1 keeps the `ebb` command and the `dist/index.js` path that a 0.17 daemon unit runs. Both print one deprecation line to stderr and run `@tidegap/cli`. This package receives no further updates.

Both packages own an `ebb` bin, so npm refuses to install them side by side (`EEXIST`). Move over in this order:

```bash
npm uninstall -g @ebb-ai/cli
npm install -g @tidegap/cli
tidegap install --laptop   # or --server; writes the new daemon unit
# run the unload/remove commands that `tidegap install` prints for the old unit
```

What else changes: <https://github.com/tidegap/tidegap#renamed-from-ebb-ai>.
