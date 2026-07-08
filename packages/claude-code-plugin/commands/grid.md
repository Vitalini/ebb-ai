---
description: Show current and 24-hour carbon intensity for a grid region
---

Show current grid carbon intensity plus the next 24-hour forecast so the user
can decide whether to run a workload now or wait.

## Arguments

`$ARGUMENTS`

- Electricity Maps zone code. Common values: `US-CAL-CISO`, `US-TEX-ERCO`,
  `US-NE-ISNE`, `US-MIDA-PJM`, `GB`, `FR`, `DE`.
- `get_grid_forecast` requires an explicit `region`. If the user gives none,
  derive one the same way the server derives its default: from the user's
  timezone (`Europe/London`→`GB`, `Europe/Paris`→`FR`, `Europe/Berlin`→`DE`,
  `America/Los_Angeles`→`US-CAL-CISO`, `America/New_York`→`US-MIDA-PJM`),
  falling back to `GB` — and tell the user which zone you used so they can
  correct it.
- If the user gives a country name (e.g. "France"), translate to the zone code
  before calling the tool. Do not pass free-form names to the MCP server.

## What to do

1. Call the `ebb-ai` MCP server's **`get_grid_forecast`** tool with:
   - `region` — the parsed zone code
   - `hours` — 24
2. The tool returns a **plain-text report**, not JSON. Its shape:

   ```
   Region: <zone>
   Source: <source>
   Generated: <iso timestamp>

   Hour | gCO2/kWh | band
   ---  | ---      | ---
   HH:MM |  <n> | <band>
   ... one row per hour ...

   Cleanest hour: <iso> (<n> gCO2/kWh, <band>)
   Dirtiest hour: <iso> (<n> gCO2/kWh, <band>)
   ```

   From it, compute:
   - **Now** — the first table row (intensity + band)
   - **Cleanest / dirtiest hour** — read the summary lines verbatim,
     converted to a time-from-now offset
   - **Average over 24h** — mean of the table rows
3. Render as:

   ```
   <zone> · <data source>
     now         <intensity> g/kWh  (<band>)
     cleanest    <intensity> g/kWh  (in <Xh>, <band>)
     dirtiest    <intensity> g/kWh  (in <Xh>, <band>)
     average     <intensity> g/kWh
   ```

   `<data source>` is the `Source:` line — one of `electricityMaps` /
   `ukCarbonIntensity` / `eia` / `entsoe` / `mock`. Be honest with the
   user: `mock` means synthetic data (no live feed for the zone), so
   present the numbers as an illustrative baseline, not a measurement.
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
