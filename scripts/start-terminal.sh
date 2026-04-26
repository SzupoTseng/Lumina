#!/usr/bin/env bash
# start-terminal.sh — idempotent node-pty WebSocket terminal server.
# Uses systemd-run (WSL2 has systemd=true) so the process survives
# after the launching bash session ends — same guarantee as a systemd service.

set -u
LUMINA_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER="$LUMINA_ROOT/src/terminal/server.mjs"
PORT=3031
CWD="${1:-$LUMINA_ROOT}"
TOKEN_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/lumina"
TOKEN_FILE="$TOKEN_DIR/terminal.token"

mkdir -p "$TOKEN_DIR"

if ss -tlnp 2>/dev/null | grep -q ":$PORT"; then
  if [ -s "$TOKEN_FILE" ]; then
    echo "[start-terminal] already listening on :$PORT"
    exit 0
  else
    # Server running but no stable token file found (legacy mode). Kill to restart correctly.
    echo "[start-terminal] killing legacy server to establish stable token."
    fuser -k "${PORT}/tcp" 2>/dev/null || true
    sleep 1
  fi
fi

if [ ! -s "$TOKEN_FILE" ]; then
  # Stable token avoids startup races where launcher waits for server logs.
  head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n' >"$TOKEN_FILE"
fi
TOKEN="$(cat "$TOKEN_FILE" 2>/dev/null)"
if ! printf '%s' "$TOKEN" | grep -Eq '^[0-9a-f]{32}$'; then
  head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n' >"$TOKEN_FILE"
  TOKEN="$(cat "$TOKEN_FILE" 2>/dev/null)"
fi

# Free port if something else has it
fuser -k "${PORT}/tcp" 2>/dev/null || true
sleep 0.2

echo "[start-terminal] starting terminal server on :$PORT (cwd: $CWD)"

# Prefer systemd-run (survives parent session exit)
if command -v systemd-run >/dev/null 2>&1 && systemctl --user status >/dev/null 2>&1; then
  systemd-run --user --no-block \
    --setenv=HOME="$HOME" \
    --setenv=PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin" \
    --setenv=LUMINA_TERMINAL_TOKEN="$TOKEN" \
    --property=StandardOutput=file:/tmp/lumina-terminal.log \
    --property=StandardError=file:/tmp/lumina-terminal.log \
    node "$SERVER" "$PORT" "$CWD" bash
else
  # Fallback: setsid + nohup (detach from session, ignore SIGHUP)
  setsid nohup env LUMINA_TERMINAL_TOKEN="$TOKEN" node "$SERVER" "$PORT" "$CWD" bash \
    >/tmp/lumina-terminal.log 2>&1 </dev/null &
  disown
fi

# Wait up to 5s for port to open
for i in $(seq 1 10); do
  sleep 0.5
  if ss -tlnp 2>/dev/null | grep -q ":$PORT"; then
    echo "[start-terminal] ready on :$PORT"
    exit 0
  fi
done
echo "[start-terminal] warning: port $PORT not responding after 5s"
exit 1
