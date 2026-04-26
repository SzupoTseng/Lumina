#!/usr/bin/env bash
# tests/pipeline.test.sh — full end-to-end: buddy-hook.sh → buddy-bridge.mjs → SSE
#
# What this covers that the other tests don't:
#   hook.test.sh    — uses a mock capture server, never touches the real bridge
#   bridge.test.sh  — posts directly via curl, never exercises buddy-hook.sh
#   THIS FILE       — runs buddy-hook.sh against a real bridge, reads back from
#                     the SSE stream, verifies the event shape that buddyEvents.ts
#                     (ChatVRM side) needs: type + tool + context.tool_input hierarchy
#
# Specific paths exercised per test:
#   SessionStart          → buddyEvents.ts REACTIONS["SessionStart"]
#   PreToolUse + Edit     → buddyEvents.ts REACTIONS["PreToolUse"] tool override
#   PostToolUse + Edit    → detectLanguage() reads context.tool_input.file_path
#   PostToolUse + Bash    → detectGit() reads context.tool_input.command + tool_response
#   PostToolUse + Bash    → detectToolResult() reads pytest summary from tool_response
#   UserPromptSubmit      → buddyEvents.ts REACTIONS["UserPromptSubmit"]
#   Stop                  → buddyEvents.ts REACTIONS["Stop"]
#   all SSE data lines    → each must be valid JSON with a 'type' field
#   bridge listeners      → listener count increments while SSE client is connected

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRIDGE="$ROOT/scripts/buddy-bridge.mjs"
HOOK="$ROOT/scripts/buddy-hook.sh"
PORT="${PIPELINE_TEST_PORT:-3538}"
BASE="http://127.0.0.1:$PORT"
SSE_LOG="/tmp/lumina-pipeline-sse.log"
BPID=""

PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); printf '  ✓ %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); printf '  ✗ %s\n      %s\n' "$1" "${2:-}"; }

cleanup() {
  [ -n "${BPID:-}" ] && kill "$BPID" 2>/dev/null; wait "${BPID:-}" 2>/dev/null
  rm -f "$SSE_LOG"
}
trap cleanup EXIT

echo "=== pipeline.test.sh — hook → bridge → SSE (ChatVRM) ==="

# --- start real bridge ---
BUDDY_BRIDGE_PORT="$PORT" node "$BRIDGE" >/dev/null 2>&1 &
BPID=$!
for i in $(seq 1 20); do
  curl -sf --max-time 0.3 "$BASE/health" >/dev/null 2>&1 && break
  sleep 0.1
done

# --- open SSE subscriber before firing any events ---
: > "$SSE_LOG"
( timeout 8 curl -sN "$BASE/events" >> "$SSE_LOG" 2>&1 ) &
SSE_PID=$!
sleep 0.2  # let the subscriber register so listener count is non-zero

# --- verify listener count incremented ---
H=$(curl -s --max-time 2 "$BASE/health")
case "$H" in
  *'"listeners":1'*) pass "/health: listener count = 1 while SSE client connected" ;;
  *)                  fail "/health listener count during subscribe" "got: $H" ;;
esac

# --- fire events through the real hook script (not direct curl) ---

# 1. SessionStart — minimal stdin
: | BUDDY_BRIDGE_URL="$BASE/event" "$HOOK" SessionStart
sleep 0.2

# 2. PreToolUse + Edit on a TypeScript file
printf '{"tool_name":"Edit","session_id":"ses-pipeline","tool_input":{"file_path":"src/web/src/features/buddyEvents/buddyEvents.ts","old_string":"a","new_string":"b"}}' \
  | BUDDY_BRIDGE_URL="$BASE/event" "$HOOK" PreToolUse
sleep 0.2

# 3. PostToolUse + Edit on a TypeScript file
#    buddyEvents.ts detectLanguage reads context.tool_input.file_path
printf '{"tool_name":"Edit","session_id":"ses-pipeline","tool_input":{"file_path":"src/web/src/features/buddyEvents/buddyEvents.ts","old_string":"a","new_string":"b"},"tool_response":{"output":"","isError":false}}' \
  | BUDDY_BRIDGE_URL="$BASE/event" "$HOOK" PostToolUse
sleep 0.2

# 4. PostToolUse + Bash git commit
#    buddyEvents.ts detectGit reads context.tool_input.command
printf '{"tool_name":"Bash","session_id":"ses-pipeline","tool_input":{"command":"git commit -m \"add pipeline test\""},"tool_response":{"output":"[main abc1234] add pipeline test\n 1 file changed","isError":false}}' \
  | BUDDY_BRIDGE_URL="$BASE/event" "$HOOK" PostToolUse
sleep 0.2

# 5. PostToolUse + Bash pytest
#    buddyEvents.ts detectToolResult reads context.tool_response.output for summary
printf '{"tool_name":"Bash","session_id":"ses-pipeline","tool_input":{"command":"pytest tests/"},"tool_response":{"output":"===== 23 passed in 1.45s =====","isError":false}}' \
  | BUDDY_BRIDGE_URL="$BASE/event" "$HOOK" PostToolUse
sleep 0.2

# 6. UserPromptSubmit
printf '{"session_id":"ses-pipeline","prompt":"/test run all"}' \
  | BUDDY_BRIDGE_URL="$BASE/event" "$HOOK" UserPromptSubmit
sleep 0.2

# 7. Stop
printf '{"session_id":"ses-pipeline"}' \
  | BUDDY_BRIDGE_URL="$BASE/event" "$HOOK" Stop
sleep 0.5

wait "$SSE_PID" 2>/dev/null || true
LOG=$(cat "$SSE_LOG")

# === assertions ===

# hello sent on connect
echo "$LOG" | grep -q '"type":"hello"' \
  && pass "SSE: hello event sent on connect" \
  || fail "SSE hello" "log:\n$(echo "$LOG" | head -3)"

# SessionStart
echo "$LOG" | grep -q '"type":"SessionStart"' \
  && pass "SessionStart flows hook → bridge → SSE" \
  || fail "SessionStart not in SSE log" ""

# PreToolUse + Edit tool override
echo "$LOG" | grep -q '"type":"PreToolUse"' && echo "$LOG" | grep -q '"tool":"Edit"' \
  && pass "PreToolUse+Edit: type and tool field present (ChatVRM tool override path)" \
  || fail "PreToolUse+Edit delivery" "$(echo "$LOG" | grep -o '"type":"[^"]*"' | sort -u)"

# PostToolUse + Edit: file_path must survive hook→bridge→SSE for language detection
echo "$LOG" | grep -q 'buddyEvents\.ts' \
  && pass "PostToolUse+Edit: .ts file_path in context (buddyEvents.detectLanguage path)" \
  || fail "file_path not found in SSE log" ""

# PostToolUse + Bash git commit: command must survive for git detection
echo "$LOG" | grep -q 'git commit' \
  && pass "PostToolUse+Bash: git commit command in context (buddyEvents.detectGit path)" \
  || fail "git commit command not in SSE log" ""

# PostToolUse + Bash pytest: tool_response output must survive for result detection
echo "$LOG" | grep -q '23 passed' \
  && pass "PostToolUse+Bash: pytest output in context (buddyEvents.detectToolResult path)" \
  || fail "pytest output not in SSE log" ""

# UserPromptSubmit
echo "$LOG" | grep -q '"type":"UserPromptSubmit"' \
  && pass "UserPromptSubmit flows hook → bridge → SSE" \
  || fail "UserPromptSubmit not in SSE log" ""

# Stop
echo "$LOG" | grep -q '"type":"Stop"' \
  && pass "Stop flows hook → bridge → SSE" \
  || fail "Stop not in SSE log" ""

# Every data: line must be valid JSON with a 'type' field (buddyEvents.ts switch)
BAD=0
while IFS= read -r line; do
  [[ "$line" == data:* ]] || continue
  json="${line#data: }"
  [[ "$json" == *'"type"'* ]] || BAD=$((BAD + 1))
done <<< "$LOG"
[ "$BAD" -eq 0 ] \
  && pass "all SSE data lines carry 'type' field (buddyEvents.ts EventSource parser)" \
  || fail "SSE data lines missing 'type'" "$BAD line(s) without type"

echo
echo "  pipeline: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
