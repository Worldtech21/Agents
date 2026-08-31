#!/usr/bin/env bash
#
# Reproduce the GKE stream truncation locally, then prove the fix.
#
#   ./mocks/repro.sh
#
# Case A runs a 60s stream through a proxy that enforces the GCP default
# timeoutSec of 30 — the connection is severed mid-response, which is the
# ERR_INCOMPLETE_CHUNKED_ENCODING the browser reports.
# Case B raises that budget to 3600, which is what k8s/gcp-backend-policy.yaml
# does in the cluster, and the same run completes.
#
# Needs no API key, no MCP server and no cluster: the upstream is a mock.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${PYTHON:-$ROOT/.venv/bin/python}"
API_PORT="${API_PORT:-8011}"
PROXY_PORT="${PROXY_PORT:-9090}"
STREAM_SECONDS="${STREAM_SECONDS:-60}"

[[ -x "$PYTHON" ]] || PYTHON="$(command -v python3)"

PIDS=()
cleanup() {
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null; done
  wait 2>/dev/null
}
trap cleanup EXIT

# The mock upstream outlives both cases; only the proxy's budget changes.
"$PYTHON" "$ROOT/mocks/fake_stream_api.py" --port "$API_PORT" --duration "$STREAM_SECONDS" &
PIDS+=($!)

for _ in $(seq 40); do
  curl -sf -m 2 "http://127.0.0.1:$API_PORT/api/v1/health" >/dev/null && break
  sleep 0.25
done

# Run one case: start the proxy with $1 as its budget, stream through it, and
# report whether the terminal control.stream.end frame ever arrived.
run_case() {
  local label="$1" timeout="$2"

  "$PYTHON" "$ROOT/mocks/gclb_timeout_proxy.py" \
    --listen "$PROXY_PORT" --upstream "127.0.0.1:$API_PORT" --timeout "$timeout" \
    2>/dev/null &
  local proxy_pid=$!
  PIDS+=("$proxy_pid")
  sleep 1

  echo
  echo "=============================================================="
  echo "$label  (backend-service timeoutSec = ${timeout}s)"
  echo "=============================================================="

  local body status start elapsed
  start=$(date +%s)
  body=$(curl -sS -N -m 180 \
    -H 'Content-Type: application/json' -H 'Accept: text/event-stream' \
    -d '{"message":"Recommend entitlements for employee NJ1002.","thread_id":"repro"}' \
    "http://127.0.0.1:$PROXY_PORT/api/v1/chat/stream" 2>&1)
  status=$?
  elapsed=$(( $(date +%s) - start ))

  local frames
  frames=$(grep -c '^data:' <<<"$body")

  echo "curl exit ......... $status$([[ $status -eq 18 ]] && echo '  (18 = transfer closed with outstanding read data remaining)')"
  echo "elapsed ........... ${elapsed}s"
  echo "envelopes received  $frames"

  if grep -q 'stream.end' <<<"$body"; then
    echo "RESULT ............ COMPLETE — the terminal control.stream.end frame arrived"
  else
    echo "RESULT ............ TRUNCATED — stream cut before control.stream.end"
    echo "                    this is what the browser shows as"
    echo "                    net::ERR_INCOMPLETE_CHUNKED_ENCODING"
  fi

  kill "$proxy_pid" 2>/dev/null
  wait "$proxy_pid" 2>/dev/null
}

echo "Streaming a ${STREAM_SECONDS}s supervisor run through a mock GKE Gateway."

run_case "CASE A — as deployed today" 30
run_case "CASE B — with GCPBackendPolicy applied" 3600

echo
echo "Case A is the deployed bug; Case B is what k8s/gcp-backend-policy.yaml buys."
