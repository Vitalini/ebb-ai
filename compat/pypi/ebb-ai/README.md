# ebb-ai (renamed)

This project is now **[`tidegap`](https://pypi.org/project/tidegap/)**.

Ebb AI was renamed to Tidegap in 0.18.0. `ebb-ai` 0.17.1 depends on `tidegap`, so `pip install ebb-ai` installs it. `import ebb_ai` (and `ebb_ai.grid` and the other submodules) still works: it is the `tidegap` package under the old name, and it prints one deprecation line to stderr. This project receives no further updates.

```bash
pip uninstall ebb-ai
pip install tidegap
```

Then change `import ebb_ai` to `import tidegap`. What else changes: <https://github.com/tidegap/tidegap#renamed-from-ebb-ai>.
