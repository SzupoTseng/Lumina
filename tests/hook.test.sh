#!/usr/bin/env bash
# tests/hook.test.sh — verifies scripts/buddy-hook.sh forwards hook
# payloads correctly. Sets BUDDY_BRIDGE_URL to a tiny capture server, then
# inspects what the hook POSTs.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK="$ROOT/scripts/buddy-hook.sh"
PORT="${HOOK_TEST_PORT:-3531}"
URL="http://127.0.0.1:$PORT/event"
CAP="/tmp/lumina-hook-cap.log"

PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); printf '  ✓ %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); printf '  ✗ %s\n      %s\n' "$1" "${2:-}"; }

# Tiny Node capture server: writes each POST body to $CAP, returns 200.
SERVER=$(cat <<EOF
import http from 'node:http';
import fs from 'node:fs';
const PORT = $PORT;
const CAP = '$CAP';
http.createServer((req, res) => {
  if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    fs.appendFileSync(CAP, body + '\n');
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end('{"ok":true}');
  });
}).listen(PORT, '127.0.0.1');
EOF
)

cleanup() { [ -n "${SPID:-}" ] && kill "$SPID" 2>/dev/null; wait "${SPID:-}" 2>/dev/null; rm -f "$CAP"; }
trap cleanup EXIT

echo "=== hook.test.sh — hook adapter ==="

: > "$CAP"
node --input-type=module -e "$SERVER" >/dev/null 2>&1 &
SPID=$!
for i in $(seq 1 10); do
  curl -sf --max-time 0.3 -X POST -d '{}' "$URL" >/dev/null 2>&1 && break
  sleep 0.1
done

# 1. Hook with full PostToolUse JSON forwards extracted fields
echo '{"tool_name":"Edit","session_id":"abc-123","tool_input":{"file_path":"foo.py","old_string":"a","new_string":"b"}}' \
  | BUDDY_BRIDGE_URL="$URL" "$HOOK" PostToolUse
sleep 0.3
LAST=$(tail -1 "$CAP")
case "$LAST" in
  *'"type":"PostToolUse"'*'"tool":"Edit"'*'"session":"abc-123"'*)
    pass "hook forwards type+tool+session correctly" ;;
  *) fail "hook envelope shape" "got: $LAST" ;;
esac

# 2. Hook preserves nested context (tool_input + tool_response)
echo "$LAST" | grep -q '"file_path":"foo.py"' \
  && pass "hook preserves nested context.tool_input.file_path" \
  || fail "context preservation" "got: $LAST"

# 3. Hook always exits 0 even when bridge is unreachable
echo '{}' | BUDDY_BRIDGE_URL="http://127.0.0.1:65530/event" "$HOOK" Stop
RC=$?
[ "$RC" = "0" ] && pass "hook exits 0 when bridge down (never blocks Claude)" \
  || fail "exit-0 contract" "got rc=$RC"

# 4. Hook with empty stdin still posts a minimal envelope
: > "$CAP"
: | BUDDY_BRIDGE_URL="$URL" "$HOOK" SessionStart
sleep 0.3
LAST=$(tail -1 "$CAP")
[ -n "$LAST" ] && case "$LAST" in
  *'"type":"SessionStart"'*) pass "hook handles empty stdin (minimal envelope)" ;;
  *) fail "empty-stdin envelope" "got: $LAST" ;;
esac

# 5. Hook respects 1s timeout (bridge unreachable shouldn't hang)
START=$(date +%s%N)
echo '{}' | BUDDY_BRIDGE_URL="http://127.0.0.1:65530/event" "$HOOK" Stop
END=$(date +%s%N)
ELAPSED_MS=$(( (END - START) / 1000000 ))
[ "$ELAPSED_MS" -lt 2000 ] && pass "hook respects max-time 1s (took ${ELAPSED_MS}ms)" \
  || fail "max-time" "took ${ELAPSED_MS}ms (expected <2000)"

echo
echo "  hooks: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
