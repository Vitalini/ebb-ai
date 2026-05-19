# v0.9 — Global Counter & Opt-in Leaderboard

> **Status:** design doc + reference implementation sketch.
> **Author:** Vitalii Borovyk
> **Date drafted:** 2026-05-17
> **Target release:** v0.9.0 (no firm date; gated on real adoption + privacy review)

## Why this exists

The v0.8 personal-impact surface (`ebb stats` CLI + `/stats`
dashboard route) is local-only. Useful for the individual user;
silent on the aggregate. Two things the v0.8 surface cannot
answer:

- *Aggregate impact* — "how much CO2e has the `ebb-ai`
  community avoided in total this month?"
- *Comparative motivation* — "where do I rank within my grid
  zone? in my city? globally?"

Both are gamification features. Both materially increase user
engagement (the literature on persuasive sustainability
interfaces is consistent on this point). Neither can be
delivered without a shared backend, which v0.8 deliberately
omits.

This doc specifies the minimum-viable backend for v0.9, with a
hard line on privacy: nothing crosses the wire that the
individual user didn't explicitly opt in to send.

## Architecture

```
┌───────────────────────────┐         ┌──────────────────────────┐
│  ebb-mcp / ebb-tick       │         │  ebb-ai.com edge function│
│  (per-user machine)       │ ──POST──► /api/ping                 │
│                           │         │                          │
│  every completed task →   │         │  validates signature     │
│  signed anonymous event   │         │  appends to KV bucket    │
│                           │         │                          │
└───────────────────────────┘         └──────────────────────────┘
                                                  │
                                                  ▼
                                      ┌──────────────────────────┐
                                      │  daily rollup job        │
                                      │  reads bucket → totals   │
                                      │  writes /api/global-stats│
                                      └──────────────────────────┘
                                                  │
                                                  ▼
                                      ┌──────────────────────────┐
                                      │  dashboard /stats reads  │
                                      │  totals + per-user rank  │
                                      └──────────────────────────┘
```

Three components:

1. **Telemetry endpoint** — single HTTPS `POST /api/ping` Vercel
   edge function. Accepts a small anonymised event per completed
   task. Stores in Vercel KV (Upstash Redis) keyed by day.
2. **Daily rollup** — Vercel cron at 00:05 UTC reads the
   previous day's events, computes totals, writes to a separate
   read-optimised KV entry the dashboard reads.
3. **Dashboard widget** — `/stats` page reads
   `GET /api/global-stats` for the aggregate counters and
   `GET /api/rank/:hash` for the user's percentile in their zone.

## Privacy model

**Opt-in only.** Users must explicitly enable telemetry via
`ebb config set telemetry on` (off by default). The CLI prints
a one-paragraph privacy summary the first time it's enabled,
and offers `ebb config set telemetry off` at any time.

**What's sent per task:**

```json
{
  "v": 1,
  "userHash": "ab12cd34...",   // 64-bit hex, sha256(machine_id + opt-in_token), stable per user
  "region": "US-CAL-CISO",       // grid region, no city / no IP-derived geo
  "carbonG": 0.34,               // estimated grams CO2e for this task
  "scoredHit": true,             // boolean: did scheduler honour its chosen window?
  "completedAt": "2026-05-17T...", // ISO-8601, hour-truncated
  "sig": "ed25519:..."            // Ed25519 signature over the above with the user's local key
}
```

**What's NOT sent:**

- The prompt content. The model name. The provider name.
- The IP address (Vercel edge does not log per-event; the
  rollup operates on aggregates only).
- Any task ID that could correlate a sent event back to a
  specific task locally.
- Any timestamp finer than the hour (no minute-level temporal
  fingerprinting).
- Any combination of fields that uniquely identifies a user
  per day. The userHash is stable per user but a daily
  aggregator sees ~1 event per active user per day, indistinguishable
  from any other active user.

**`userHash` generation:** at first opt-in, the CLI generates a
random 256-bit token, stores it in `~/.ebb-ai/telemetry.key`,
and computes `userHash = sha256(token).slice(0, 16)`. The token
never leaves the machine. Rotating the token via
`ebb config telemetry rotate` produces a new userHash and
invalidates the user's existing rank attribution.

**Ed25519 signature:** the same `~/.ebb-ai/telemetry.key` is
expanded into an Ed25519 keypair. The CLI signs every event
with the private key; the server verifies against the public
key that was registered at first opt-in. This makes spoofing
events against another user's rank computationally expensive,
without requiring server-side authentication.

**Right to be forgotten:** `ebb config telemetry forget` rotates
the local key AND posts a tombstone request to
`POST /api/forget/:hash`. The server purges the userHash from
all stored aggregates within 24 hours (and zeroes its rank
attribution immediately).

## Anti-abuse

Three concerns:

1. **Spam / inflation.** A bad actor scripts millions of fake
   events to spike their rank. *Mitigation:* per-userHash rate
   limit of 500 events/day at the edge; Ed25519 signature
   requirement makes single-user spam expensive (must roll
   millions of keypairs); Sybil-resistance via opt-in-only
   means cost-of-spam ≈ cost-of-installing-and-opt-in-from-
   each-VM.
2. **Sniping competitors.** A bad actor floods other users'
   ranks. *Mitigation:* the userHash is not predictable
   externally (it's `sha256(local-random-256-bit)`), so an
   attacker cannot target another user's hash without that
   user's local key.
3. **Leaderboard gaming.** A user games their rank by routing
   trivial dispatches. *Mitigation:* the leaderboard ranks
   *avoided* carbon (counterfactual minus actual), so
   scheduling against the cleanest hour earns less rank than
   the same task at a dirty hour. Hard to game without
   exporting real-cost dispatches the user is paying for
   anyway.

None of the three mitigations is perfect. The product framing
should treat the leaderboard as a *fun* indicator, not a
high-stakes ranking.

## Data shape

### Per-event row in Vercel KV

Key: `event:{YYYYMMDD}:{userHash}:{taskCounter}`
Value: the signed JSON event payload above.

TTL: 60 days from event timestamp.

### Daily rollup

Key: `rollup:{YYYYMMDD}`
Value:
```json
{
  "date": "2026-05-17",
  "uniqueUsers": 142,
  "totalTasks": 3812,
  "totalCarbonAccountedG": 1289.4,
  "totalCarbonAvoidedG": 4128.6,
  "byRegion": {
    "GB":          { "users": 38, "tasks": 1042, "carbonG": 354.2 },
    "US-CAL-CISO": { "users": 22, "tasks": 612,  "carbonG": 220.1 },
    "FR":          { "users": 18, "tasks": 380,  "carbonG": 91.3 }
  },
  "topRanks": [
    { "userHash": "ab12cd34", "scoreThisMonth": 412.3 },
    { "userHash": "ef56gh78", "scoreThisMonth": 388.7 }
  ]
}
```

TTL: indefinite (cheap to keep).

### Public read endpoints

- `GET /api/global-stats` → most recent `rollup:*` plus a 30-day
  trend array. Cached at edge for 5 minutes.
- `GET /api/rank/:userHash` → `{ regionalRank, globalRank, score, percentile }`. Cached at edge for 15 minutes per hash.

## Reference implementation sketch

### Edge function

```typescript
// apps/web/src/app/api/ping/route.ts

import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { verify } from "@noble/ed25519";

interface PingEvent {
  v: 1;
  userHash: string;
  region: string;
  carbonG: number;
  scoredHit: boolean;
  completedAt: string;
  sig: string; // base64(ed25519 signature)
  pubKey: string; // base64(public key)
}

export const runtime = "edge";

export async function POST(req: Request) {
  const event = (await req.json()) as PingEvent;

  if (event.v !== 1) return NextResponse.json({ ok: false, reason: "bad-version" }, { status: 400 });
  if (!/^[0-9a-f]{16}$/.test(event.userHash)) return NextResponse.json({ ok: false, reason: "bad-hash" }, { status: 400 });

  // Rate limit: 500/day per hash.
  const day = event.completedAt.slice(0, 10).replace(/-/g, "");
  const rateKey = `rate:${day}:${event.userHash}`;
  const count = await kv.incr(rateKey);
  if (count === 1) await kv.expire(rateKey, 86400);
  if (count > 500) return NextResponse.json({ ok: false, reason: "rate-limit" }, { status: 429 });

  // Verify signature.
  const payload = canonicalize(event);
  const ok = await verify(
    base64decode(event.sig),
    new TextEncoder().encode(payload),
    base64decode(event.pubKey),
  );
  if (!ok) return NextResponse.json({ ok: false, reason: "bad-sig" }, { status: 401 });

  // Pin the pubkey to the userHash on first event.
  const pubKeyKey = `pubkey:${event.userHash}`;
  const existing = await kv.get(pubKeyKey);
  if (existing && existing !== event.pubKey) {
    return NextResponse.json({ ok: false, reason: "pubkey-mismatch" }, { status: 401 });
  }
  if (!existing) await kv.set(pubKeyKey, event.pubKey, { ex: 60 * 86400 });

  // Append to the day's bucket.
  const eventKey = `event:${day}:${event.userHash}:${count}`;
  await kv.set(eventKey, event, { ex: 60 * 86400 });

  return NextResponse.json({ ok: true });
}

function canonicalize(e: PingEvent): string {
  // Stable JSON for signature: sorted keys, no sig field.
  const { sig, ...rest } = e;
  return JSON.stringify(rest, Object.keys(rest).sort());
}
```

### Daily rollup cron

```typescript
// apps/web/src/app/api/cron/rollup/route.ts
// vercel.json crons: [ { "path": "/api/cron/rollup", "schedule": "5 0 * * *" } ]

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("unauthorized", { status: 401 });
  }

  const yesterday = new Date(Date.now() - 86400_000);
  const day = yesterday.toISOString().slice(0, 10).replace(/-/g, "");

  let cursor = "0";
  const events: PingEvent[] = [];
  do {
    const [next, keys] = await kv.scan(cursor, { match: `event:${day}:*`, count: 1000 });
    cursor = next;
    for (const k of keys) {
      const e = await kv.get(k);
      if (e) events.push(e as PingEvent);
    }
  } while (cursor !== "0");

  const rollup = aggregateEvents(events);
  await kv.set(`rollup:${day}`, rollup);

  return NextResponse.json({ ok: true, day, events: events.length });
}
```

(See full sketch under `packages/telemetry/` in the v0.9 branch.)

### CLI opt-in

```typescript
// packages/cli/src/commands/telemetry.ts

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { generateKeyPair } from "@noble/ed25519";

const KEY_PATH = join(homedir(), ".ebb-ai", "telemetry.key");
const URL = process.env.EBB_TELEMETRY_URL ?? "https://www.ebb-ai.com/api/ping";

export async function enable() {
  const token = randomBytes(32);
  const userHash = createHash("sha256").update(token).digest("hex").slice(0, 16);
  const { privateKey, publicKey } = await generateKeyPair(token);
  await fs.mkdir(join(homedir(), ".ebb-ai"), { recursive: true });
  await fs.writeFile(KEY_PATH, JSON.stringify({ token: token.toString("hex"), userHash, publicKey: Buffer.from(publicKey).toString("base64") }), { mode: 0o600 });
  console.log(`Telemetry enabled. Your userHash is ${userHash}.\nRotate any time with: ebb config telemetry rotate`);
}

export async function disable() {
  try { await fs.rm(KEY_PATH); } catch {}
  console.log("Telemetry disabled. Local key removed. Existing aggregated data will roll off the server within 60 days; use 'ebb config telemetry forget' to request immediate removal.");
}
```

## Open questions for the v0.9 design review

1. **Should the userHash leak the user's grid region?** Currently
   yes (region is sent unhashed), which lets the server compute
   per-region ranks. Alternative: hash the region too and accept
   that per-region ranks become impossible. Argued: per-region
   rank is useful and grid region is not personally identifying.
2. **Should aggregates be private or public?** Currently public
   (`GET /api/global-stats` is open). Alternative: cap at
   "number of opted-in users" and a single global counter, with
   per-region detail behind a token. Argued: keeping it public
   keeps the gamification honest.
3. **What's the rank score formula?** Proposal:
   `score = sum(estimatedCarbonAvoidedG per task)`, where
   `avoided = (median grid intensity for region) - (chosen-window intensity) × 0.0015 kWh`. Defensible but rewards users in dirty grids
   disproportionately (more headroom to avoid). Alternative:
   percentile rank against own region's median. Avoids the
   dirty-grid bias.

These three need product-team review before the implementation
starts.

## Filing checklist

- [ ] Privacy-policy review for legal implications
      (California CCPA, GDPR — opt-in helps; data-residency
      doesn't apply to anonymised aggregates).
- [ ] Write the public privacy policy at `ebb-ai.com/privacy`.
- [ ] Implement and test the reference edge function in a v0.9-pre branch.
- [ ] Soft-launch with a 50-user beta from the existing Show HN audience.
- [ ] Monitor for spam / abuse over 30 days before public launch.
- [ ] Update the project's evidence log with the production telemetry URL once live.

## Non-goals

- **Real-time leaderboard updates.** Day-grain is sufficient
  and dramatically simpler to operate.
- **Per-tenant scoping** (one organisation's users seeing only
  their org's aggregates). Useful but not in the v0.9 cut;
  defer to v1.0 if there's enterprise pull.
- **Cross-language client.** v0.9 ships the telemetry hook in
  `@ebb-ai/cli` only. Python `core-py` parity can wait.

---

*Authoritative source:* `docs/spec/proposal/v09-leaderboard.md` in `github.com/Vitalini/ebb-ai`. Implementation sketch will live under `packages/telemetry/` in the v0.9 branch when development starts.
