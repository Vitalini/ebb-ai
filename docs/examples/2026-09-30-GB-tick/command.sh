#!/usr/bin/env bash
# Reproduces the committed GB `ebb tick` run end to end.
#
#   bash docs/examples/2026-09-30-GB-tick/command.sh [OUT_DIR]
#
# Needs: a built repo (`pnpm build`), network access to
# api.carbonintensity.org.uk (keyless), and a local Ollama with the model
# pulled (`ollama serve`, `ollama pull llama3.2:1b`). The ledger is a fresh
# temp file passed via --db, so ~/.ebb-ai/queue.db is never read or written.
# The receipt is signed with this machine's key (~/.ebb-ai/signing.key).
# The ledger's temp directory is printed as <tmp> in output.txt and
# verify.txt. Without OUT_DIR the outputs go to a temp directory; timestamps, task id,
# intensities and the signature differ on every run, the field set does not.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
OUT="${1:-$(mktemp -d)}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
DBDIR="$(mktemp -d)"
DB="$DBDIR/queue.db"
cd "$REPO"
EX="docs/examples/2026-09-30-GB-tick"
CLI="packages/cli/dist/index.js"
export OLLAMA_HOST="${OLLAMA_HOST:-http://localhost:11434}"

curl -sf "$OLLAMA_HOST/api/tags" >/dev/null || {
  echo "Ollama is not reachable at $OLLAMA_HOST (run: ollama serve; ollama pull llama3.2:1b)" >&2
  exit 1
}

run() { echo "\$ $*"; "$@"; echo; }

{
  echo "# ebb-ai example run"
  echo "# date (UTC):  $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "# region:      GB"
  echo "# grid feed:   ukCarbonIntensity (National Grid ESO Carbon Intensity API, live, keyless)"
  echo "# provider:    ollama / llama3.2:1b (local)"
  echo "# commit:      $(git -C "$REPO" rev-parse --short HEAD)"
  echo
  run node "$EX/run.mjs" "$DB" "$OUT/forecast.json"
  run node "$CLI" queue list --db "$DB"
  run node "$CLI" tick --db "$DB" --region GB
  run node "$CLI" receipts list --db "$DB"
  run node "$CLI" stats --db "$DB"
} 2>&1 | sed -e "s#$REPO/##g" -e "s#$DBDIR#<tmp>#g" | tee "$OUT/output.txt"

TASK_ID="$(sed -n 's/^task_id=//p' "$OUT/output.txt")"

node --input-type=module -e "
const { TaskStore } = await import('./packages/core-ts/dist/index.js');
const store = new TaskStore({ dbPath: process.argv[1] });
console.log(JSON.stringify(store.get(process.argv[2]).receipt, null, 2));
store.close();
" "$DB" "$TASK_ID" > "$OUT/receipt.json"

{
  run node "$CLI" verify "$TASK_ID" --db "$DB"
  run node "$CLI" verify --file "$OUT/receipt.json" --json
} 2>&1 | sed -e "s#$REPO/##g" -e "s#$DBDIR#<tmp>#g" | tee "$OUT/verify.txt" >> "$OUT/output.txt"

# Provenance, read back from the files this run wrote (not asserted).
node -e '
const [f, r] = process.argv.slice(1).map((p) => require(p));
console.log(`# provenance: forecast.source=${f.source}, receipt.gridSource=${r.gridSource}`);
' "$OUT/forecast.json" "$OUT/receipt.json" | tee -a "$OUT/output.txt"

echo "outputs: $OUT"
