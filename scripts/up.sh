#!/usr/bin/env bash
# up.sh — single-command starter for the full Lumina dev stack.
#
# What it starts:
#   - scripts/buddy-bridge.mjs      on :3030 (background)
#   - src/web/ `npm run dev`        on :3000 (foreground; Ctrl+C kills both)
#
# Use this when you're NOT in VS Code (`.vscode/tasks.json` already auto-
# starts both on folderOpen). Path-relative: invoke from anywhere — the
# script resolves its own location, so `cp -r Lumina /tmp/elsewhere &&
# /tmp/elsewhere/scripts/up.sh` works without env changes.
#
# Sanity checks abort early with a clear message rather than producing
# obscure failures deep in npm/next.

set -uo pipefail

LUMINA_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$LUMINA_ROOT/src/web"
BRIDGE="$LUMINA_ROOT/scripts/buddy-bridge.mjs"
BRIDGE_PORT="${BUDDY_BRIDGE_PORT:-3030}"
WEB_PORT="${LUMINA_WEB_PORT:-3000}"
# split = standalone bridge on $BRIDGE_PORT (decoupled, HMR-immune, default)
# unified = bridge endpoints in Next.js api routes (one process, one port)
BUDDY_MODE="${BUDDY_MODE:-split}"

log() { printf '[up] %s\n' "$*"; }
die() { printf '[up] error: %s\n' "$*" >&2; exit 1; }

# --- Pre-flight ---------------------------------------------------------

command -v node >/dev/null 2>&1 || die "node not found in PATH (need 18+)"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
[ "${NODE_MAJOR:-0}" -ge 18 ] || die "node 18+ required (found ${NODE_MAJOR:-unknown})"

[ -f "$BRIDGE" ]                || die "missing $BRIDGE — repo layout corrupt?"
[ -f "$WEB_DIR/package.json" ]  || die "missing $WEB_DIR/package.json — repo layout corrupt?"

case "$LUMINA_ROOT" in
  /mnt/[a-z]/*)
    log "WARNING: project is on a Windows-mounted drive ($LUMINA_ROOT)"
    log "         Next.js dev server will silently self-exit on this filesystem."
    log "         Either:"
    log "           1) accept it (HMR + dev server unreliable), or"
    log "           2) copy to native WSL FS:"
    log "                rsync -a --exclude=node_modules --exclude=.next $LUMINA_ROOT/ ~/lumina-runtime/"
    log "                cd ~/lumina-runtime && ./scripts/up.sh"
    log "         See CLAUDE.md 'Root cause of next dev silently exiting'."
    ;;
esac

port_in_use() {
  if command -v ss >/dev/null 2>&1; then
    ss -tln 2>/dev/null | awk '{print $4}' | grep -qE ":$1$"
  elif command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else
    return 1  # can't tell, assume free
  fi
}

if port_in_use "$WEB_PORT"; then
  die "port $WEB_PORT already in use — close the other process or set LUMINA_WEB_PORT (note: most ChatVRM links assume 3000)"
fi
if [ "$BUDDY_MODE" = "split" ] && port_in_use "$BRIDGE_PORT"; then
  die "port $BRIDGE_PORT already in use — close the other process or set BUDDY_BRIDGE_PORT (note: ChatVRM client assumes 3030)"
fi

# --- First-run install --------------------------------------------------

if [ ! -d "$WEB_DIR/node_modules" ]; then
  log "node_modules missing in src/web — running npm install (one-time, ~1 min)"
  ( cd "$WEB_DIR" && npm install --no-audit --no-fund ) || die "npm install failed"
fi

# --- Start bridge in background (split mode only) -----------------------

if [ "$BUDDY_MODE" = "split" ]; then
  log "BUDDY_MODE=split — starting standalone bridge on :$BRIDGE_PORT"
  BUDDY_BRIDGE_PORT="$BRIDGE_PORT" node "$BRIDGE" &
  BRIDGE_PID=$!

  cleanup() {
    log "stopping bridge (pid $BRIDGE_PID)"
    kill "$BRIDGE_PID" 2>/dev/null || true
    wait "$BRIDGE_PID" 2>/dev/null || true
  }
  trap cleanup EXIT INT TERM

  # Wait until /health answers — prevents SessionStart race.
  for i in $(seq 1 50); do
    if curl -sf --max-time 0.5 "http://127.0.0.1:$BRIDGE_PORT/health" >/dev/null 2>&1; then
      log "bridge ready after ~$(( (i - 1) * 100 ))ms"
      break
    fi
    sleep 0.1
    if [ "$i" -eq 50 ]; then
      log "warning: bridge did not answer /health within 5 s — continuing anyway"
    fi
  done
else
  log "BUDDY_MODE=$BUDDY_MODE — bridge endpoints live in Next.js api routes"
  log "(set BUDDY_BRIDGE_URL=http://127.0.0.1:$WEB_PORT/api/event in your shell"
  log " so hooks fire to the right place; client uses NEXT_PUBLIC_BUDDY_BRIDGE_URL=/api/events)"
fi

# --- Foreground: dev server --------------------------------------------

log "starting next dev on :$WEB_PORT — open http://localhost:$WEB_PORT"
log "Ctrl+C stops both processes"
cd "$WEB_DIR"
exec npm run dev
