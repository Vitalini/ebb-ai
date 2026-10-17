# @vitalini/ebb (renamed)

This plugin is now **[`@vitalini/tidegap`](https://clawhub.ai/vitalini/plugins/tidegap)**, plugin id `tidegap`.

Ebb AI was renamed to Tidegap in 0.18.0. `@vitalini/ebb` 0.17.1 is a pointer release: it keeps the plugin id `ebb`, registers no tools, and logs one warning when the gateway starts. It accepts your existing `plugins.entries.ebb` config block unchanged. This plugin receives no further updates.

Move over:

```bash
openclaw plugins install clawhub:@vitalini/tidegap
# move your config block from plugins.entries.ebb to plugins.entries.tidegap
# (the keys are the same), then remove the old plugin
```

Your task queue stays: Tidegap moves `~/.ebb-ai` to `~/.tidegap` on first run and leaves a link behind. Nothing else to migrate.

What else changes: <https://github.com/tidegap/tidegap#renamed-from-ebb-ai>.
