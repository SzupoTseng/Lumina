#!/usr/bin/env bash
# buddy-hook.sh — agent-agnostic hook adapter forwarding to buddy-bridge.
#
# Usage (from each agent's hook config):
#   command: "${LUMINA_HOOK} <event-type> <agent>"
# where <agent> ∈ {claude, copilot, codex}. Defaults to "claude" if omitted
# (preserves the original single-agent behavior).
#
# Reads the hook's JSON context from stdin and POSTs a normalized envelope
# to the bridge. Each agent's stdin shape differs; we extract tool/session
# names from the right fields per agent and emit a uniform envelope:
#   {"type":"PreToolUse","tool":"Bash","session":"…","agent":"claude","context":{…}}
#
# Hard guarantees (do not break — they protect each agent's CLI):
#   1. Always exit 0. Non-zero in PreToolUse blocks the tool call.
#   2. Never write to stdout — agents may interpret it as injected context.
#   3. Cap network wait at 1s. Bridge being down must not slow the agent.

set -u

EVENT_TYPE="${1:-unknown}"
AGENT="${2:-${BUDDY_AGENT:-claude}}"
BRIDGE_URL="${BUDDY_BRIDGE_URL:-http://127.0.0.1:3030/event}"

# Read full hook JSON from stdin (may be empty for some events).
context=""
if [ ! -t 0 ]; then
  context=$(cat 2>/dev/null || true)
fi
[ -z "$context" ] && context="{}"

# Build envelope. Use python3 for safe JSON handling. Per-agent extraction:
#   - claude:  tool_name + session_id (snake_case)
#   - codex:   tool_name + session_id (snake_case, same shape as claude)
#   - copilot: toolName  + (no session id; pass null)
envelope=""
if command -v python3 >/dev/null 2>&1; then
  envelope=$(EVENT_TYPE="$EVENT_TYPE" AGENT="$AGENT" python3 -c '
import json, sys, os
agent = os.environ.get("AGENT", "claude")
event = os.environ.get("EVENT_TYPE", "unknown")
ctx_raw = sys.stdin.read()
try:
    ctx = json.loads(ctx_raw) if ctx_raw.strip() else {}
except Exception:
    ctx = {"_raw": ctx_raw[:1024]}

# Per-agent field extraction. Lookups silently degrade to None.
if agent == "copilot":
    tool = ctx.get("toolName") if isinstance(ctx, dict) else None
    session = None  # Copilot stdin has no session id field
else:  # claude, codex, future PascalCase agents
    tool = ctx.get("tool_name") if isinstance(ctx, dict) else None
    session = ctx.get("session_id") if isinstance(ctx, dict) else None

print(json.dumps({
    "type": event,
    "tool": tool or None,
    "session": session or None,
    "agent": agent,
    "context": ctx,
}, ensure_ascii=False, separators=(",", ":")))
' <<<"$context" 2>/dev/null) || envelope=""
fi

# Fallback if python failed/absent — minimal envelope, no nested context.
if [ -z "$envelope" ]; then
  if [ "$AGENT" = "copilot" ]; then
    tool=$(printf '%s' "$context" | grep -oE '"toolName"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"([^"]+)"$/\1/')
    session=""
  else
    tool=$(printf '%s' "$context" | grep -oE '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"([^"]+)"$/\1/')
    session=$(printf '%s' "$context" | grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"([^"]+)"$/\1/')
  fi
  esc_tool=$(printf '%s' "$tool" | sed 's/"/\\"/g')
  esc_session=$(printf '%s' "$session" | sed 's/"/\\"/g')
  envelope=$(printf '{"type":"%s","tool":"%s","session":"%s","agent":"%s"}' \
    "$EVENT_TYPE" "$esc_tool" "$esc_session" "$AGENT")
fi

# Fire and forget. Connect timeout 0.3s, total timeout 1s.
curl -sf --connect-timeout 0.3 --max-time 1 \
  -H 'Content-Type: application/json' \
  -X POST --data "$envelope" \
  "$BRIDGE_URL" >/dev/null 2>&1 || true

exit 0
