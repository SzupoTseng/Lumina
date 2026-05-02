#!/usr/bin/env bash
# tests/multi-agent-hook.test.sh — verifies scripts/buddy-hook.sh emits the
# correct envelope for each of the three coding-AI agents (claude, copilot,
# codex). Each agent has a different stdin shape (snake_case vs camelCase,
# tool_input vs toolArgs-JSON-string, with/without session id) — this suite
# pins the per-agent extraction rules.
#
# Pattern: spin up a tiny capture server on $PORT, fire the hook with the
# agent's expected stdin shape, assert the captured POST body has the right
# fields. Same shape as hook.test.sh.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK="$ROOT/scripts/buddy-hook.sh"
PORT="${HOOK_TEST_PORT:-3532}"
URL="http://127.0.0.1:$PORT/event"
CAP="/tmp/lumina-multi-agent-cap.log"

PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); printf '  ✓ %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); printf '  ✗ %s\n      %s\n' "$1" "${2:-}"; }

# Tiny Node capture server — appends each POST body to $CAP.
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

echo "=== multi-agent-hook.test.sh — per-agent envelope shape ==="

: > "$CAP"
node --input-type=module -e "$SERVER" >/dev/null 2>&1 &
SPID=$!
for i in $(seq 1 10); do
  curl -sf --max-time 0.3 -X POST -d '{}' "$URL" >/dev/null 2>&1 && break
  sleep 0.1
done

# Helper: post stdin to hook and return the most recent capture line.
post_and_grab() {
  local payload="$1" event="$2" agent="$3"
  : > "$CAP"
  echo "$payload" | BUDDY_BRIDGE_URL="$URL" "$HOOK" "$event" "$agent"
  sleep 0.3
  tail -1 "$CAP"
}

# --- 1. claude: tool_name + session_id (PascalCase + snake_case) ----------
LAST=$(post_and_grab \
  '{"tool_name":"Bash","session_id":"sess-claude","tool_input":{"command":"ls"}}' \
  PreToolUse claude)
case "$LAST" in
  *'"type":"PreToolUse"'*'"tool":"Bash"'*'"session":"sess-claude"'*'"agent":"claude"'*)
    pass "claude: envelope has type/tool/session/agent" ;;
  *) fail "claude envelope shape" "got: $LAST" ;;
esac
echo "$LAST" | grep -q '"command":"ls"' \
  && pass "claude: nested tool_input.command preserved in context" \
  || fail "claude context preservation" "got: $LAST"

# --- 2. codex: same shape as claude (tool_name + session_id) -------------
# Codex uses Claude-compatible field names but its own tool taxonomy
# (apply_patch is its primary edit tool — normalization to "Edit" happens
# downstream in buddyEvents.ts, not in the hook adapter).
LAST=$(post_and_grab \
  '{"tool_name":"apply_patch","session_id":"sess-codex","tool_input":{"file_path":"/tmp/x.py"}}' \
  PostToolUse codex)
case "$LAST" in
  *'"type":"PostToolUse"'*'"tool":"apply_patch"'*'"session":"sess-codex"'*'"agent":"codex"'*)
    pass "codex: passes apply_patch through (downstream normalizes)" ;;
  *) fail "codex envelope shape" "got: $LAST" ;;
esac

# --- 3. copilot: toolName (camelCase) + no session field ------------------
LAST=$(post_and_grab \
  '{"toolName":"bash","toolArgs":"{\"command\":\"npm test\"}"}' \
  PreToolUse copilot)
case "$LAST" in
  *'"type":"PreToolUse"'*'"tool":"bash"'*'"agent":"copilot"'*)
    pass "copilot: extracts camelCase toolName" ;;
  *) fail "copilot tool extraction" "got: $LAST" ;;
esac
case "$LAST" in
  *'"session":null'*) pass "copilot: session field is null (no session_id in stdin)" ;;
  *) fail "copilot session=null" "got: $LAST" ;;
esac
echo "$LAST" | grep -q '"toolArgs":"{\\"command\\":\\"npm test\\"}"' \
  && pass "copilot: raw toolArgs JSON-string preserved in context (downstream parses)" \
  || fail "copilot context preservation" "got: $LAST"

# --- 4. Back-compat: missing agent arg defaults to claude -----------------
LAST=$(post_and_grab \
  '{"tool_name":"Edit","session_id":"sess-default"}' \
  Stop "")
# When the agent arg is empty, the script falls back to BUDDY_AGENT or "claude".
case "$LAST" in
  *'"agent":"claude"'*) pass "missing agent arg → defaults to claude (back-compat)" ;;
  *) fail "back-compat default" "got: $LAST" ;;
esac

# --- 5. exit-0 contract per agent (the hard rule) -------------------------
# A non-zero exit on PreToolUse blocks the agent's tool call. Test all three
# agents against an unreachable bridge — they MUST all exit 0.
for AGENT in claude copilot codex; do
  echo '{}' | BUDDY_BRIDGE_URL="http://127.0.0.1:65530/event" "$HOOK" PreToolUse "$AGENT"
  RC=$?
  [ "$RC" = "0" ] \
    && pass "$AGENT: exits 0 when bridge down (never blocks the agent)" \
    || fail "$AGENT exit-0 contract" "got rc=$RC"
done

# --- 6. 1s timeout cap holds for every agent ------------------------------
# Bridge being down should never make the hook slower than ~1s. Tested per
# agent because the python normalizer branch differs by agent and could in
# principle hold the curl call open longer.
for AGENT in claude copilot codex; do
  START=$(date +%s%N)
  echo '{}' | BUDDY_BRIDGE_URL="http://127.0.0.1:65530/event" "$HOOK" Stop "$AGENT"
  END=$(date +%s%N)
  ELAPSED_MS=$(( (END - START) / 1000000 ))
  [ "$ELAPSED_MS" -lt 2000 ] \
    && pass "$AGENT: hook completes in <2s when bridge down (took ${ELAPSED_MS}ms)" \
    || fail "$AGENT max-time" "took ${ELAPSED_MS}ms"
done

# --- 7. agent field always populated --------------------------------------
# Even with empty stdin, the agent field must be present so the SSE consumer
# can branch on it.
: > "$CAP"
: | BUDDY_BRIDGE_URL="$URL" "$HOOK" SessionStart codex
sleep 0.3
LAST=$(tail -1 "$CAP")
case "$LAST" in
  *'"agent":"codex"'*) pass "agent field present even on empty-stdin events" ;;
  *) fail "agent field presence" "got: $LAST" ;;
esac

# --- 8. Codex PermissionRequest payload normalizes correctly --------------
# Codex's PermissionRequest stdin carries tool_name + tool_use_id + tool_input
# (same shape as PreToolUse). install-hooks invokes the adapter with canonical
# "Notification codex" args, so the envelope must surface as type=Notification
# with the originating tool name preserved for downstream context.
LAST=$(post_and_grab \
  '{"tool_name":"Bash","session_id":"sess-perm","tool_use_id":"call_123","tool_input":{"command":"rm -rf /"}}' \
  Notification codex)
case "$LAST" in
  *'"type":"Notification"'*'"tool":"Bash"'*'"session":"sess-perm"'*'"agent":"codex"'*)
    pass "codex PermissionRequest → Notification envelope (tool_name preserved as Bash)" ;;
  *) fail "codex permission envelope" "got: $LAST" ;;
esac
echo "$LAST" | grep -q '"command":"rm -rf /"' \
  && pass "codex PermissionRequest preserves tool_input.command in context (downstream can show what the user is being asked to approve)" \
  || fail "codex permission context" "got: $LAST"

echo
echo "  multi-agent hooks: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
