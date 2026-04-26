#!/usr/bin/env bash
# start-bridge.sh — idempotent bridge starter for VS Code's folderOpen task.
#
# Behavior:
#   - If something is already responding on http://127.0.0.1:3030/health,
#     exit 0 silently (the .bat already started the bridge).
#   - Otherwise, exec node scripts/buddy-bridge.mjs in the foreground.
#
# This mirrors scripts/start-dev.sh's idempotency pattern so the .bat and
# VS Code's folderOpen tasks can both fire without racing on the port.

set -u

LUMINA_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRIDGE="$LUMINA_ROOT/scripts/buddy-bridge.mjs"
URL="http://127.0.0.1:${BUDDY_BRIDGE_PORT:-3030}/health"

if curl -sf --max-time 1 "$URL" >/dev/null 2>&1; then
  echo "[start-bridge] bridge already responding at $URL — nothing to do."
  exit 0
fi

echo "[start-bridge] starting bridge on :${BUDDY_BRIDGE_PORT:-3030}"

# Use systemd-run so the bridge survives after the launching session ends
if command -v systemd-run >/dev/null 2>&1 && systemctl --user status >/dev/null 2>&1; then
  systemd-run --user --no-block \
    --setenv=HOME="$HOME" \
    --setenv=BUDDY_BRIDGE_PORT="${BUDDY_BRIDGE_PORT:-3030}" \
    node "$BRIDGE"
else
  setsid nohup node "$BRIDGE" >/tmp/lumina-bridge.log 2>&1 </dev/null &
  disown
fi
