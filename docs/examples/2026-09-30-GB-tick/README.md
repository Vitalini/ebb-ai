# Real `ebb tick` run: GB, 2026-09-30

One run, recorded 2026-09-30T21:03:30Z on region **GB**.

- **Grid feed:** `ukCarbonIntensity`, the National Grid ESO Carbon Intensity API. Live data, no API key. Scheduling and the receipt both used it: `forecast.json` has `"source": "ukCarbonIntensity"` and `receipt.json` has `"gridSource": "ukCarbonIntensity"`. No mock data.
- **Provider:** `ollama` / `llama3.2:1b`, running locally.
- **Code:** commit `0fa4476` (recorded as `a099280` in `output.txt`: the same code before this unpushed branch was rebased), the first commit where `ebb tick` uses the region's feed for receipts. Before that commit the receipt came from the mock curve.

## Files

| File | Content |
|---|---|
| `command.sh` | Reproduces the whole run. Every ledger command uses `--db` with a fresh temp file. |
| `run.mjs` | Covers what the CLI has no subcommand for: fetches the live forecast, calls `recommendWindow()`, and enqueues one Ollama call (what the MCP tools `recommend_window` and `schedule_task` do). |
| `forecast.json` | The live forecast horizon used for the recommendation. |
| `output.txt` | Full stdout and stderr of the run, including the verify step, unedited apart from stripping the local repo path and printing the temp ledger directory as `<tmp>`. The last line reads the feed provenance back from `forecast.json` and `receipt.json`. |
| `receipt.json` | The signed receipt from the ledger. |
| `verify.txt` | `ebb verify` against the ledger and against `receipt.json`. |

## Results

Peak and recommended window are forecast values (projected), from one GB run on 2026-09-30. The 158 gCO2/kWh at the hour of the run is measured: the live feed's value, recorded in the receipt at dispatch.

| | UTC hour | gCO2/kWh | Source line |
|---|---|---|---|
| Forecast peak (projected) | 2026-10-01T17:00 | 183 | `forecast peak:` in `output.txt` |
| Recommended window, 72h deadline (projected) | 2026-10-02T09:00 | 88 | `recommendWindow(...)` in `output.txt` |
| Hour of the run (measured, at dispatch) | 2026-09-30T21:00 | 158 | `forecast now:` in `output.txt` |

- **Peak** is the highest-intensity hour in `forecast.json`. The UK API returned 51 hourly entries for the 72h request.
- **Recommended window** is `scheduledFor` from `recommendWindow()`. It picks one of several near-equal clean hours to spread grid load, so a rerun on the same forecast can pick a different hour.
- **The dispatched task** had a 5-minute deadline, so `ebb tick` ran it at once. Its receipt records the dispatch-hour intensity (158 gCO2/kWh from the live feed), not the recommended window.
- **Receipt:** `t-ef2354ee-eff0-431c-b11e-6edfcb8299b0`, signer `tTpsWuAS…`, and `ebb verify` prints `✓ VALID`.
- **Price:** not available for this run. The CLI has no electricity-price feed, and the routing preview (sync vs Batch list price) needs at least two candidate models; this run used a single, unpriced local Ollama model. The `reasoning` string's "Batch API saves an additional 50%" clause is generic and does not apply here: Ollama has no Batch API.

## Reproduce

```bash
pnpm build
ollama serve &            # if not already running
ollama pull llama3.2:1b
bash docs/examples/2026-09-30-GB-tick/command.sh    # outputs go to a temp dir
```

A rerun differs in timestamps, task id, intensities, the chosen window and the signature. The field set and the `✓ VALID` result stay the same. The receipt is signed with the key at `~/.ebb-ai/signing.key` on the machine that runs it.
