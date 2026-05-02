#!/usr/bin/env bash
# start-terminal.sh — idempotent node-pty WebSocket terminal server.
# Uses systemd-run (WSL2 has systemd=true) so the process survives
# after the launching bash session ends — same guarantee as a systemd service.

set -u
LUMINA_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER="$LUMINA_ROOT/src/terminal/server.mjs"
PORT=3031
CWD="${1:-$LUMINA_ROOT}"
AGENT="${2:-bash}"
TOKEN_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/lumina"
TOKEN_FILE="$TOKEN_DIR/terminal.token"
ERR_FILE="$TOKEN_DIR/terminal.error"
# Tracks which agent the currently-running PTY server was launched with.
# When the user picks a different agent in the setup dialog, we detect the
# mismatch here and kill+restart instead of silently reusing the old PTY.
AGENT_FILE="$TOKEN_DIR/terminal.agent"

mkdir -p "$TOKEN_DIR"
# Reset diagnostic from a previous run — set fresh on each failure path below.
rm -f "$ERR_FILE"
write_err() { printf '%s\n' "$1" >"$ERR_FILE"; }

# Map agent name → command. "bash" stays as-is for back-compat (user types `claude`/etc.
# manually); claude/copilot/codex spawn the CLI directly so the right hook events fire
# from session start.
case "$AGENT" in
  claude)  CMD="claude" ;;
  copilot) CMD="copilot" ;;
  codex)   CMD="codex" ;;
  bash|"") CMD="bash" ;;
  *)       CMD="$AGENT" ;;
esac

# Existence check — only enforced when the user explicitly picked a CLI agent.
# (Skipped for bash, which is always present.)
if [ "$CMD" != "bash" ] && ! command -v "$CMD" >/dev/null 2>&1; then
  write_err "AGENT_MISSING:$AGENT"
  echo "[start-terminal] error: '$CMD' not found on PATH" >&2
  exit 1
fi

if ss -tlnp 2>/dev/null | grep -q ":$PORT"; then
  if [ -s "$TOKEN_FILE" ]; then
    # Idempotent reuse only when the running PTY was launched for the SAME
    # agent. Otherwise switching agents in the setup dialog would do nothing.
    PREV_AGENT=""
    [ -f "$AGENT_FILE" ] && PREV_AGENT=$(cat "$AGENT_FILE" 2>/dev/null || true)
    if [ "$PREV_AGENT" = "$AGENT" ]; then
      echo "[start-terminal] already listening on :$PORT (agent=$AGENT, reusing)"
      exit 0
    else
      echo "[start-terminal] agent change detected (was='$PREV_AGENT', want='$AGENT') — restarting server"
      fuser -k "${PORT}/tcp" 2>/dev/null || true
      sleep 1
    fi
  else
    # Server running but no stable token file found (legacy mode). Kill to restart correctly.
    echo "[start-terminal] killing legacy server to establish stable token."
    fuser -k "${PORT}/tcp" 2>/dev/null || true
    sleep 1
  fi
fi

# --- Pre-install checks -------------------------------------------------
# Each writes a code to $ERR_FILE and exits non-zero. The C# launcher reads
# the code and shows an actionable hint instead of "terminal token unavailable".
PTY_DIR="$LUMINA_ROOT/src/terminal/node_modules/node-pty"
if [ ! -d "$PTY_DIR" ]; then
  write_err "DEPS_MISSING"
  echo "[start-terminal] error: src/terminal/node_modules missing — run 'npm install' in src/terminal" >&2
  exit 1
fi
# node-pty's prebuilt binary may target a different libnode version than the
# Node currently in PATH. Catch that here rather than failing inside server.mjs.
if ! node -e "require('$PTY_DIR/lib/index.js')" 2>"$TOKEN_DIR/pty-load.err"; then
  if grep -q libnode "$TOKEN_DIR/pty-load.err"; then
    write_err "PTY_ABI_MISMATCH"
  else
    write_err "PTY_LOAD_FAIL"
  fi
  echo "[start-terminal] error: node-pty native binary failed to load — run 'npm rebuild node-pty' in src/terminal" >&2
  exit 1
fi
rm -f "$TOKEN_DIR/pty-load.err"

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
    node "$SERVER" "$PORT" "$CWD" "$CMD"
else
  # Fallback: setsid + nohup (detach from session, ignore SIGHUP)
  setsid nohup env LUMINA_TERMINAL_TOKEN="$TOKEN" node "$SERVER" "$PORT" "$CWD" "$CMD" \
    >/tmp/lumina-terminal.log 2>&1 </dev/null &
  disown
fi

# Wait up to 5s for port to open
for i in $(seq 1 10); do
  sleep 0.5
  if ss -tlnp 2>/dev/null | grep -q ":$PORT"; then
    # Record which agent this PTY was launched with so the next invocation
    # of this script can detect agent-switch and restart instead of reusing.
    printf '%s' "$AGENT" >"$AGENT_FILE"
    echo "[start-terminal] ready on :$PORT (agent=$AGENT)"
    exit 0
  fi
done
echo "[start-terminal] warning: port $PORT not responding after 5s"
write_err "SERVER_NOT_STARTED"
exit 1
