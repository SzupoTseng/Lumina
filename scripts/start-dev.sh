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
    WEB_DIR="$RUNTIME/src/web"

    # Always sync first - backgrounding this creates a race condition yielding Next.js 404
    if [ -d "$WEB_DIR/node_modules" ]; then
      echo "[start-dev] /mnt/ detected → syncing to $RUNTIME (fast start)"
    else
      echo "[start-dev] /mnt/ detected → initial sync to $RUNTIME (avoiding 9p bug)"
    fi
    rsync -a --delete \
      --exclude='node_modules' \
      --exclude='.next' \
      --exclude='.git' \
      --exclude='reasoninghist' \
      --exclude='src/web/public' \
      "$LUMINA_ROOT/" "$RUNTIME/"

    # Live-link public/ to source so newly added .vrm / personalities/*.json
    # appear in /api/models and /api/personalities without re-running rsync.
    # Next dev serves public/ on-demand from disk, so the symlink is read on
    # every request. The 9p watchpack bug only affects the project root's
    # parent, so a symlink inside src/web/ is safe.
    SOURCE_PUBLIC="$LUMINA_ROOT/src/web/public"
    RUNTIME_PUBLIC="$WEB_DIR/public"
    if [ ! -L "$RUNTIME_PUBLIC" ] || [ "$(readlink "$RUNTIME_PUBLIC")" != "$SOURCE_PUBLIC" ]; then
      rm -rf "$RUNTIME_PUBLIC"
      ln -s "$SOURCE_PUBLIC" "$RUNTIME_PUBLIC"
    fi

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
