#!/usr/bin/env bash
# buddy-hook.sh — Claude Code hook adapter that forwards to buddy-bridge.
#
# Usage (from .claude/settings.json):
#   command: "${CLAUDE_PROJECT_DIR}/scripts/buddy-hook.sh <event-type>"
#
# Reads the hook's JSON context from stdin (Claude Code passes it on stdin
# for every hook invocation), extracts the bits the buddy cares about, and
# POSTs a small JSON envelope to the bridge.
#
# Hard guarantees (do not break these — they protect Claude Code itself):
#   1. Always exit 0. A non-zero exit in PreToolUse blocks the tool call.
#   2. Never write to stdout (Claude Code may interpret it as additional
#      context). All chatter goes to stderr; we keep stderr quiet too.
#   3. Cap network wait at 1s. Bridge being down must not slow Claude.
#
# Bridge URL is fixed to 127.0.0.1:3030. If you move it, update this file
# and scripts/buddy-bridge.mjs together.

set -u

EVENT_TYPE="${1:-unknown}"
BRIDGE_URL="${BUDDY_BRIDGE_URL:-http://127.0.0.1:3030/event}"

# Read full hook JSON from stdin (may be empty for some events).
context=""
if [ ! -t 0 ]; then
  context=$(cat 2>/dev/null || true)
fi
[ -z "$context" ] && context="{}"

# Lift a couple of useful fields without requiring jq. Best-effort regex —
# if a field isn't present, we just send the whole context.
tool=$(printf '%s' "$context" | grep -oE '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"([^"]+)"$/\1/')
session=$(printf '%s' "$context" | grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"([^"]+)"$/\1/')

# Build envelope. Use python if available (handles JSON escaping for the
# raw context safely); otherwise fall back to a minimal payload.
envelope=""
if command -v python3 >/dev/null 2>&1; then
  envelope=$(EVENT_TYPE="$EVENT_TYPE" TOOL_NAME="$tool" SESSION_ID="$session" \
    python3 -c '
import json, sys, os
ctx_raw = sys.stdin.read()
try:
    ctx = json.loads(ctx_raw) if ctx_raw.strip() else {}
except Exception:
    ctx = {"_raw": ctx_raw[:1024]}
print(json.dumps({
    "type": os.environ.get("EVENT_TYPE", "unknown"),
    "tool": os.environ.get("TOOL_NAME") or None,
    "session": os.environ.get("SESSION_ID") or None,
    "context": ctx,
}, ensure_ascii=False, separators=(",", ":")))
' <<<"$context" 2>/dev/null) || envelope=""
fi

# If python failed or absent, build minimally (no nested context).
if [ -z "$envelope" ]; then
  esc_tool=$(printf '%s' "$tool" | sed 's/"/\\"/g')
  esc_session=$(printf '%s' "$session" | sed 's/"/\\"/g')
  envelope=$(printf '{"type":"%s","tool":"%s","session":"%s"}' \
    "$EVENT_TYPE" "$esc_tool" "$esc_session")
fi

# Fire and forget. Connect timeout 0.3s, total timeout 1s.
curl -sf --connect-timeout 0.3 --max-time 1 \
  -H 'Content-Type: application/json' \
  -X POST --data "$envelope" \
  "$BRIDGE_URL" >/dev/null 2>&1 || true

exit 0
