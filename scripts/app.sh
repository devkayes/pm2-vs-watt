#!/usr/bin/env bash
# Run on the APP instance. Starts/stops one runner at a time.
#   ./scripts/app.sh start pm2|watt
#   ./scripts/app.sh stop
#   ./scripts/app.sh status
set -euo pipefail
cd "$(dirname "$0")/../app"

WORKERS="${WORKERS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu)}"
export WORKERS PLT_WORKERS="$WORKERS"

stop_all() {
  npx pm2 delete bench >/dev/null 2>&1 || true
  npx pm2 kill >/dev/null 2>&1 || true
  pkill -f "[w]attpm start" >/dev/null 2>&1 || true
  # wait until port 3000 is free
  for _ in $(seq 30); do
    curl -s -o /dev/null localhost:3000/ping || return 0
    sleep 1
  done
}

wait_up() {
  for _ in $(seq 60); do
    curl -sf -o /dev/null localhost:3000/ping && return 0
    sleep 1
  done
  echo "app did not come up" >&2; exit 1
}

case "${1:-}" in
  start)
    stop_all
    case "${2:-}" in
      pm2)  ./node_modules/.bin/pm2 start ecosystem.config.js >/dev/null ;;
      watt) nohup ./node_modules/.bin/wattpm start > /tmp/watt.log 2>&1 & ;;  # direct binary: no extra npm process in memory numbers
      *) echo "usage: $0 start pm2|watt"; exit 1 ;;
    esac
    wait_up
    echo "$2 is up with $WORKERS workers"
    ;;
  stop)   stop_all; echo "stopped" ;;
  status) curl -s localhost:3000/whoami; echo ;;
  *) echo "usage: $0 start pm2|watt | stop | status"; exit 1 ;;
esac
