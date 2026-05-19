---
description: Show current and 24-hour carbon intensity for a grid region
---

Show current grid carbon intensity plus the next 24-hour forecast so the user
can decide whether to run a workload now or wait.

## Arguments

`$ARGUMENTS`

- Electricity Maps zone code. Default `US-CAL-CISO`. Common values:
  `US-CAL-CISO`, `US-TEX-ERCO`, `US-NE-ISNE`, `US-MIDA-PJM`, `GB`, `FR`, `DE`.
- If the user gives a country name (e.g. "France"), translate to the zone code
  before calling the tool. Do not pass free-form names to the MCP server.

## What to do

1. Call the `ebb-ai` MCP server's **`get_grid_forecast`** tool with:
   - `region` — the parsed zone code
   - `hours` — 24
2. From the response, compute:
   - **Now** — `entries[0].carbon_intensity_g_co2_per_kwh` + `band`
   - **Cleanest hour in next 24h** — `min(entries)` by intensity, with its
     time-from-now offset
   - **Dirtiest hour** — `max(entries)`, same shape
   - **Average over 24h**
3. Render as:

   ```
   <zone> · <data source>
     now         <intensity> g/kWh  (<band>)
     cleanest    <intensity> g/kWh  (in <Xh>, <band>)
     dirtiest    <intensity> g/kWh  (in <Xh>, <band>)
     average     <intensity> g/kWh
   ```

   `<data source>` is `electricity-maps` / `uk-carbon-intensity` / `mock`
   depending on the `source` field in the response — be honest with the
   user about whether they are looking at real or synthetic data.
4. End with a one-line recommendation:
   - If `now` is in `clean` or `very_clean` band: "Run now — grid is already
     clean."
   - If `cleanest_hour < now * 0.7`: "Defer if you can — <X>% cleaner in <Yh>."
   - Otherwise: "No meaningful intraday variation — run when convenient."

## Examples

```
/ebb-ai:grid
/ebb-ai:grid GB
/ebb-ai:grid US-TEX-ERCO
```
