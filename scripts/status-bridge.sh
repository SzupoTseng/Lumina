#!/usr/bin/env bash
# status-bridge.sh — reads ccusage statusline and forwards [Task]/[Scope]/[TODO]
# to the Lumina bridge so the VRM shows current task context.
# Run in background: bash scripts/status-bridge.sh &
#
# Security: uses Node.js for JSON construction (safe escaping, no shell injection).

BRIDGE="${BUDDY_BRIDGE_URL:-http://127.0.0.1:3030/event}"
CCUSAGE="$(which ccusage 2>/dev/null || echo "$HOME/.npm-global/bin/ccusage")"
INTERVAL=5

prev_combined=""

while true; do
  sleep "$INTERVAL"

  # Run ccusage statusline
  if ! command -v "$CCUSAGE" &>/dev/null && [ ! -x "$CCUSAGE" ]; then
    continue
  fi

  raw=$("$CCUSAGE" statusline 2>/dev/null) || continue

  # Extract [Task], [Scope], [TODO] lines
  task_line=$(printf '%s' "$raw" | grep -o '\[Task\][^|]*' | head -1 | sed 's/\[Task\] *//')
  scope_line=$(printf '%s' "$raw" | grep -o '\[Scope\][^\n]*' | head -1 | sed 's/\[Scope\] *//')
  todo_line=$(printf '%s' "$raw" | grep -o '\[TODO\][^\n]*' | head -1 | sed 's/\[TODO\] *//')

  # Skip if unchanged or both empty
  combined="${task_line}||${scope_line}||${todo_line}"
  [ "$combined" = "$prev_combined" ] && continue
  [ -z "$task_line" ] && [ -z "$todo_line" ] && continue
  prev_combined="$combined"

  # Build JSON safely using Node.js (avoids shell quoting injection)
  payload=$(node -e "
    const task  = process.argv[1] || '';
    const scope = process.argv[2] || '';
    const todo  = process.argv[3] || '';
    const line  = [task ? '🎯 '+task+(scope?' ['+scope+']':'') : '',
                   todo ? '📋 '+todo : ''].filter(Boolean).join('\n');
    console.log(JSON.stringify({
      type: 'StatusUpdate', tool: null, session: 'status',
      ts: Date.now(),
      context: { task, scope, todo, line }
    }));
  " "$task_line" "$scope_line" "$todo_line" 2>/dev/null) || continue

  curl -sf --max-time 1 -X POST "$BRIDGE" \
    -H 'Content-Type: application/json' \
    -d "$payload" \
    >/dev/null 2>&1 || true
done
