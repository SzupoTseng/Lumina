#!/usr/bin/env bash
# start-dev.sh — idempotent Lumina dev-server starter.
#
# If project is on /mnt/<letter>/ (Windows DrvFs/9p), automatically syncs
# to ~/lumina-runtime and runs from there — avoids Next.js projectFolderWatcher
# silent self-exit bug. See CLAUDE.md "Root cause of next dev silently exiting".

set -u

LUMINA_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
URL="http://localhost:${LUMINA_WEB_PORT:-3000}"

if curl -sf --max-time 1 "$URL" >/dev/null 2>&1; then
  echo "[start-dev] dev server already responding at $URL — nothing to do."
  exit 0
fi

# On /mnt/<letter>/ (DrvFs): auto-relocate to native WSL FS to avoid the
# Next.js projectFolderWatcher silent exit bug.
case "$LUMINA_ROOT" in
  /mnt/[a-z]/*)
    RUNTIME="$HOME/lumina-runtime"
    echo "[start-dev] /mnt/ detected → syncing to $RUNTIME (avoiding 9p bug)"
    rsync -a --delete \
      --exclude='node_modules' \
      --exclude='.next' \
      --exclude='.git' \
      --exclude='reasoninghist' \
      "$LUMINA_ROOT/" "$RUNTIME/"
    WEB_DIR="$RUNTIME/src/web"
    if [ ! -d "$WEB_DIR/node_modules" ]; then
      echo "[start-dev] running npm install in $WEB_DIR"
      (cd "$WEB_DIR" && npm install --no-audit --no-fund)
    fi
    echo "[start-dev] starting next dev from $WEB_DIR"
    cd "$WEB_DIR"
    exec npm run dev
    ;;
esac

# Native FS path — run directly.
WEB_DIR="$LUMINA_ROOT/src/web"
if [ ! -d "$WEB_DIR/node_modules" ]; then
  echo "[start-dev] running npm install in $WEB_DIR"
  (cd "$WEB_DIR" && npm install --no-audit --no-fund)
fi
echo "[start-dev] starting next dev in $WEB_DIR"
cd "$WEB_DIR"
exec npm run dev
