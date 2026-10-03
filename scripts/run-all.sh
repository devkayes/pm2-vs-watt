#!/usr/bin/env bash
# Run on the LOAD-GENERATOR instance. Runs the full test matrix:
#   runners x endpoints x connection modes x repeats
# alternating pm2/watt so neither always runs on a "warmer" machine.
#
#   cp .env.example .env   # fill in APP_HOST, then:
#   ./scripts/run-all.sh          # full run, about 20 minutes
#   ./scripts/run-all.sh quick    # pipeline check, about 2 minutes
#
# Settings come from .env; anything passed on the command line wins,
# e.g. REPEATS=1 ./scripts/run-all.sh
#
# APP_HOST empty : everything runs on this machine (pipeline check only: k6
#                  and the app then share CPU, so the numbers are not meaningful).
# APP_HOST set   : runners are switched over SSH as APP_USER
#                  (repo must be at ~/pm2-vs-watt on the app instance).
# PROM_URL       : if set, every measured k6 run is pushed to Prometheus live, tagged
#                  with runner/endpoint/conn/rep, for the Grafana "pm2 vs Watt" dashboard.
set -euo pipefail
export K6_NO_USAGE_REPORT=true
cd "$(dirname "$0")/.."

if [[ "${1:-}" == "quick" ]]; then REPEATS=1 WARMUP=3s DURATION=7s; fi

if [[ -f .env ]]; then
  while IFS='=' read -r key value || [[ -n "$key" ]]; do
    [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ && -z "${!key:-}" ]] && export "$key=$value"
  done < .env
fi

if [[ -z "${APP_HOST:-}" ]]; then
  TARGET="${TARGET:-http://localhost:3000}"
  APP_SSH="${APP_SSH:-local}"
else
  TARGET="${TARGET:-http://$APP_HOST:3000}"
  APP_SSH="${APP_SSH:-${APP_USER:-$USER}@$APP_HOST}"
fi
ENDPOINTS="${ENDPOINTS:-ping cpu io}"
MODES="${MODES:-ka new}"           # ka = keep-alive, new = new connection per request
REPEATS="${REPEATS:-2}"
VUS="${VUS:-100}"
WARMUP="${WARMUP:-20s}"
DURATION="${DURATION:-70s}"
OUT="${OUT:-results/$(date +%Y%m%d-%H%M)}"
mkdir -p "$OUT"
RUN_ID="$(basename "$OUT")"

# k6 -> Prometheus (live view in Grafana)
K6_OUT=()
if [[ -n "${PROM_URL:-}" ]]; then
  export K6_PROMETHEUS_RW_SERVER_URL="$PROM_URL/api/v1/write"
  export K6_PROMETHEUS_RW_TREND_STATS="p(50),p(95),p(99),avg"
  export K6_PROMETHEUS_RW_PUSH_INTERVAL="5s"
  K6_OUT=(-o experimental-prometheus-rw)
  echo "Pushing k6 metrics to $PROM_URL (run_id=$RUN_ID)"
fi

on_app() {
  if [[ "$APP_SSH" == "local" ]]; then bash -c "cd '$PWD'; $1"
  else ssh "$APP_SSH" "cd ~/pm2-vs-watt; $1"; fi
}

switch_runner() {
  local r="$1"
  if [[ -n "${APP_SSH:-}" ]]; then
    on_app "./scripts/app.sh start $r"
    on_app "nohup node scripts/collect-metrics.mjs /tmp/$r.procs.csv >/dev/null 2>&1 & echo \$! > /tmp/collect-metrics.pid"
  else
    read -rp ">>> Start '$r' on the app instance (./scripts/app.sh start $r), then press Enter "
  fi
}

fetch_procs() {
  local r="$1" tag="$2"
  [[ -n "${APP_SSH:-}" ]] || return 0
  on_app "kill \$(cat /tmp/collect-metrics.pid) 2>/dev/null || true"
  if [[ "$APP_SSH" == "local" ]]; then cp "/tmp/$r.procs.csv" "$OUT/$tag.procs.csv" || true
  else scp -q "$APP_SSH:/tmp/$r.procs.csv" "$OUT/$tag.procs.csv" || true; fi
}

if [[ -n "${APP_SSH:-}" ]]; then on_app "./scripts/app.sh stop" >/dev/null; fi

for rep in $(seq "$REPEATS"); do
  # alternate order each repeat: pm2,watt then watt,pm2 ...
  if (( rep % 2 )); then order="pm2 watt"; else order="watt pm2"; fi
  for runner in $order; do
    switch_runner "$runner"
    for ep in $ENDPOINTS; do
      for mode in $MODES; do
        reuse=1; [[ "$mode" == "new" ]] && reuse=0
        tag="${runner}_${ep}_${mode}_r${rep}"
        echo "=== $tag ==="
        # warmup (JIT, connection pools); results discarded
        k6 run --quiet -e TARGET="$TARGET" -e ENDPOINT="$ep" -e REUSE="$reuse" \
          -e VUS="$VUS" -e DURATION="$WARMUP" k6/throughput.js > /dev/null 2>&1 || true
        k6 run --quiet \
          -e TARGET="$TARGET" -e ENDPOINT="$ep" -e REUSE="$reuse" \
          -e VUS="$VUS" -e DURATION="$DURATION" \
          ${K6_OUT[@]+"${K6_OUT[@]}"} \
          --tag run_id="$RUN_ID" --tag runner="$runner" --tag endpoint="$ep" --tag conn="$mode" --tag rep="$rep" \
          --summary-export "$OUT/$tag.json" k6/throughput.js > "$OUT/$tag.log" 2>&1 || true
      done
    done
    node scripts/balance.mjs "$TARGET" --new --out "$OUT/${runner}_balance_r${rep}.json" \
      | tee "$OUT/${runner}_balance_r${rep}.txt"
    fetch_procs "$runner" "${runner}_r${rep}"
  done
done

node scripts/summarize.js "$OUT" | tee "$OUT/SUMMARY.md"
node scripts/report.mjs "$OUT"
[[ -n "${APP_SSH:-}" ]] && on_app "./scripts/app.sh stop" >/dev/null
echo "Results in $OUT"
