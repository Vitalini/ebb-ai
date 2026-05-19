# Vercel Deployment Guide

`ebb-ai.com` is hosted on Vercel from `apps/web`. The dashboard
runs end-to-end out of the box on the deterministic mock grid feed.
To unlock live carbon-intensity data for more than just GB, three
environment variables need to be added in the Vercel project settings.

## Live-data status

| Region | Source | Key required? |
|---|---|---|
| `GB` | UK National Grid ESO Carbon Intensity API | **No.** Always live. |
| `US-CAL-CISO`, `US-TEX-ERCO`, `US-NE-ISNE`, `US-MIDA-PJM`, `US-NY-NYIS`, `US-MIDW-MISO` | U.S. Energy Information Administration (EIA) | `EBB_EIA_API_KEY` |
| `FR`, `DE`, `ES`, `IT`, `NL` | European Network of Transmission System Operators for Electricity (ENTSO-E) | `EBB_ENTSOE_SECURITY_TOKEN` |
| Anything else | Electricity Maps free tier | `EBB_ELECTRICITY_MAPS_API_KEY` |

Without these keys, the corresponding regions silently fall back to
the deterministic mock curve (and the dashboard region card displays
the `mock feed` badge).

## How to get the keys

### EIA (United States, free)

1. Open <https://www.eia.gov/opendata/register.php>
2. Fill the registration form — name + email is sufficient. No payment.
3. The API key arrives in your inbox immediately. Format: 40
   alphanumeric characters.

### ENTSO-E (Europe, free)

1. Open <https://transparency.entsoe.eu/> and create an account.
2. After log-in: **My Account → Web API Security Token**.
3. Click **Generate**. The token is a UUID-style string. Copy it.

### Electricity Maps (universal fallback, free tier)

1. Open <https://www.electricitymaps.com/free-tier-api>
2. Sign up for the free developer tier. Free tier allows 100 requests
   per day, which is more than enough for a dashboard.
3. The token is shown in the developer-portal dashboard. Format:
   alphanumeric, ~40 characters.

## Adding the keys to Vercel

1. Open the Vercel project: <https://vercel.com/vitalini/ebb-ai/settings/environment-variables>
2. For each of the three variables:
   - **Key:** the name from the table above (e.g. `EBB_EIA_API_KEY`).
   - **Value:** the secret from the step above.
   - **Environments:** check **Production**, **Preview**, **Development**
     (all three — the dashboard's `apps/web/src/lib/grid.ts`
     reads the same names everywhere).
   - **Sensitive:** check **Yes**.
3. Click **Save** for each.
4. Trigger a redeploy: either push a no-op commit, or open
   <https://vercel.com/vitalini/ebb-ai/deployments> and click the
   three-dot menu on the latest deployment → **Redeploy**.

After the redeploy completes, every region card on `ebb-ai.com`
should show its source as `eia`, `entsoe`, or `electricityMaps`
instead of `mock`.

## Verifying

```bash
# Each of these should return source: <provider-name>, not "mock".
curl -s https://www.ebb-ai.com/api/grid/US-CAL-CISO | jq '.source'
curl -s https://www.ebb-ai.com/api/grid/FR          | jq '.source'
curl -s https://www.ebb-ai.com/api/grid/GB          | jq '.source'  # already live without any key
```

## Local development

For local development the same env-var names are read from a
`.env.local` file in `apps/web/`. Copy `.env.example` to
`.env.local` and paste the secrets. Never commit `.env.local`.
