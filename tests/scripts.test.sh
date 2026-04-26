#!/usr/bin/env bash
# tests/scripts.test.sh — verifies start-bridge.sh and start-dev.sh are
# idempotent (return 0 with "already responding" when the service is
# already up). This guarantees VS Code's folderOpen tasks can re-run
# without errors when .bat already started services.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); printf '  ✓ %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); printf '  ✗ %s\n      %s\n' "$1" "${2:-}"; }

cleanup() {
  pkill -f buddy-bridge.mjs 2>/dev/null || true
  sleep 0.3
}
trap cleanup EXIT

echo "=== scripts.test.sh — idempotency contracts ==="

# 1. start-bridge.sh launches the bridge fresh (port 3030 free → start)
pkill -f buddy-bridge.mjs 2>/dev/null || true
sleep 0.3
"$ROOT/scripts/start-bridge.sh" > /tmp/lumina-sb.log 2>&1 &
BPID=$!
for i in $(seq 1 15); do
  curl -sf --max-time 0.3 http://127.0.0.1:3030/health >/dev/null && break
  sleep 0.2
done
H=$(curl -s --max-time 1 http://127.0.0.1:3030/health || true)
case "$H" in
  *'"ok":true'*) pass "start-bridge.sh starts bridge fresh and /health responds" ;;
  *) fail "start-bridge fresh" "got /health: $H" ;;
esac

# 2. start-bridge.sh idempotent — second invocation exits 0 quickly
START=$(date +%s%N)
"$ROOT/scripts/start-bridge.sh" > /tmp/lumina-sb2.log 2>&1
RC=$?
END=$(date +%s%N)
ELAPSED_MS=$(( (END - START) / 1000000 ))
[ "$RC" = "0" ] && pass "start-bridge.sh second call exits 0 (rc=$RC)" \
  || fail "start-bridge idempotency" "rc=$RC, log:\n$(cat /tmp/lumina-sb2.log)"
grep -q "already responding" /tmp/lumina-sb2.log \
  && pass "start-bridge.sh prints 'already responding' on second call" \
  || fail "start-bridge already-running message" "log:\n$(cat /tmp/lumina-sb2.log)"
[ "$ELAPSED_MS" -lt 1500 ] && pass "start-bridge.sh idempotent path is fast (${ELAPSED_MS}ms)" \
  || fail "start-bridge fast path" "took ${ELAPSED_MS}ms"

# Cleanup before testing start-dev
kill "$BPID" 2>/dev/null
pkill -f buddy-bridge.mjs 2>/dev/null || true
sleep 0.3

# 3. start-dev.sh idempotent path: when port 3000 already busy, skip
# Stand up a tiny dummy server on 3000 first to simulate "already running"
node -e "require('http').createServer((q,r)=>{r.writeHead(200);r.end('ok')}).listen(3000,'127.0.0.1')" &
DPID=$!
for i in $(seq 1 10); do
  curl -sf --max-time 0.2 http://localhost:3000 >/dev/null && break
  sleep 0.1
done
START=$(date +%s%N)
timeout 5 "$ROOT/scripts/start-dev.sh" > /tmp/lumina-sd.log 2>&1
RC=$?
END=$(date +%s%N)
ELAPSED_MS=$(( (END - START) / 1000000 ))
kill "$DPID" 2>/dev/null
wait "$DPID" 2>/dev/null

[ "$RC" = "0" ] && pass "start-dev.sh skips when :3000 already responding (rc=$RC)" \
  || fail "start-dev idempotency" "rc=$RC, log:\n$(cat /tmp/lumina-sd.log)"
grep -q "already responding" /tmp/lumina-sd.log \
  && pass "start-dev.sh prints 'already responding' on skip" \
  || fail "start-dev message" "log:\n$(cat /tmp/lumina-sd.log)"
[ "$ELAPSED_MS" -lt 2000 ] && pass "start-dev.sh fast path took ${ELAPSED_MS}ms" \
  || fail "start-dev fast path" "took ${ELAPSED_MS}ms"

echo
echo "  scripts: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
