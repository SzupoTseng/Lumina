#!/usr/bin/env bash
# tests/bridge.test.sh — end-to-end test of scripts/buddy-bridge.mjs.
# Spins up a real bridge on a free port, exercises every endpoint, asserts
# behavior on the wire. No mocks.
#
# Exit 0 = all pass. Exit 1 = a check failed (with which check noted).

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRIDGE="$ROOT/scripts/buddy-bridge.mjs"
PORT="${BRIDGE_TEST_PORT:-3530}"
BASE="http://127.0.0.1:$PORT"
LOG="/tmp/lumina-bridge-test.log"

PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); printf '  ✓ %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); printf '  ✗ %s\n      %s\n' "$1" "${2:-}"; }

cleanup() {
  [ -n "${BPID:-}" ] && kill "$BPID" 2>/dev/null
  wait "${BPID:-}" 2>/dev/null
  rm -f /tmp/lumina-sse-cap.log "$LOG"
}
trap cleanup EXIT

echo "=== bridge.test.sh — bridge integration ==="

BUDDY_BRIDGE_PORT="$PORT" node "$BRIDGE" > "$LOG" 2>&1 &
BPID=$!
# wait for listening
for i in $(seq 1 20); do
  curl -sf --max-time 0.3 "$BASE/health" >/dev/null 2>&1 && break
  sleep 0.1
done

# 1. /health returns ok:true with listeners count
H=$(curl -s --max-time 2 "$BASE/health")
case "$H" in
  *'"ok":true'*'"listeners":0'*) pass "/health → ok:true, listeners=0" ;;
  *) fail "/health JSON" "got: $H" ;;
esac

# 2. POST /event returns ok and broadcast count
R=$(curl -s --max-time 2 -X POST -H 'Content-Type: application/json' \
       -d '{"type":"PING"}' "$BASE/event")
case "$R" in
  *'"ok":true'*) pass "POST /event → ok:true" ;;
  *) fail "POST /event" "got: $R" ;;
esac

# 3. SSE subscriber receives broadcast (with hello + the event we POST)
( timeout 2 curl -sN "$BASE/events" > /tmp/lumina-sse-cap.log 2>&1 ) &
SUB_PID=$!
sleep 0.2
curl -s -X POST -H 'Content-Type: application/json' \
     -d '{"type":"PostToolUse","tool":"Edit","context":{"tool_input":{"file_path":"foo.py"}}}' \
     "$BASE/event" >/dev/null
sleep 1.0
wait $SUB_PID 2>/dev/null

if grep -q '"type":"hello"' /tmp/lumina-sse-cap.log \
   && grep -q '"type":"PostToolUse"' /tmp/lumina-sse-cap.log \
   && grep -q '"tool":"Edit"' /tmp/lumina-sse-cap.log \
   && grep -q '"file_path":"foo.py"' /tmp/lumina-sse-cap.log; then
  pass "SSE delivers hello + broadcast event with full context"
else
  fail "SSE stream content" "captured:\n$(cat /tmp/lumina-sse-cap.log | head -5)"
fi

# 4. /health listeners count incremented during subscribe (small race window).
# Important: wait specifically for the SSE curl PID, NOT bare `wait` — that
# would also block on BPID (the bridge daemon) which never exits, hanging
# the test indefinitely.
( timeout 1 curl -sN "$BASE/events" >/dev/null 2>&1 ) &
SSE_PID=$!
sleep 0.2
H2=$(curl -s --max-time 1 "$BASE/health")
wait "$SSE_PID" 2>/dev/null
case "$H2" in
  *'"listeners":1'*) pass "/health reports listeners=1 during subscribe" ;;
  *)                  fail "/health listener count" "got: $H2" ;;
esac

# 5. Invalid JSON body rejected with 400
RC=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 -X POST \
       -H 'Content-Type: application/json' -d 'NOT JSON' "$BASE/event")
[ "$RC" = "400" ] && pass "POST /event with malformed body → 400" \
  || fail "malformed body rejection" "got HTTP $RC"

# 6. Unknown route → 404
RC=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$BASE/no-such-route")
[ "$RC" = "404" ] && pass "GET /no-such-route → 404" || fail "404 handling" "got HTTP $RC"

# 7. CORS preflight allowed
H=$(curl -sI -X OPTIONS \
      -H "Origin: http://localhost:3000" \
      -H "Access-Control-Request-Method: POST" \
      "$BASE/event")
echo "$H" | grep -qi 'access-control-allow-origin: \*' \
  && pass "OPTIONS preflight allows cross-origin" \
  || fail "CORS preflight" "got headers:\n$H"

echo
echo "  bridge: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
