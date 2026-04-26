#!/usr/bin/env bash
# tests/web.test.sh — verifies the Next.js dev server actually serves
# Lumina UI: homepage HTML, auto-discovery API routes, static assets.
#
# Doesn't render WebGL or run the React tree (that needs a browser).
# What it CAN prove:
#   - Dev server boots and responds 200 on /
#   - HTML payload contains Lumina-specific markers (canvas, scripts,
#     ChatVRM tags) — i.e., "the page isn't an empty 404"
#   - /api/models returns the expected JSON shape
#   - /api/personalities returns the expected JSON shape
#   - VRMA asset (idle_loop.vrma) is reachable
#
# Idempotent: uses scripts/start-dev.sh which no-ops if :3000 is already
# serving. Will start a fresh dev server only if needed.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${LUMINA_WEB_PORT:-3000}"
BASE="http://localhost:$PORT"
START_DEV="$ROOT/scripts/start-dev.sh"

PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); printf '  ✓ %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); printf '  ✗ %s\n      %s\n' "$1" "${2:-}"; }

DEV_PID=""
cleanup() {
  # Only kill the dev server WE started (not pre-existing one).
  [ -n "$DEV_PID" ] && kill "$DEV_PID" 2>/dev/null
  wait "$DEV_PID" 2>/dev/null
}
trap cleanup EXIT

echo "=== web.test.sh — Next.js + API routes + assets ==="

# 0. Bring dev server up (idempotent)
if ! curl -sf --max-time 1 "$BASE/" >/dev/null 2>&1; then
  echo "  [setup] dev server not responding — starting it (~30 s on first run)"
  "$START_DEV" > /tmp/lumina-web-test.log 2>&1 &
  DEV_PID=$!
  for i in $(seq 1 60); do
    curl -sf --max-time 1 "$BASE/" >/dev/null 2>&1 && break
    sleep 1
  done
fi

if ! curl -sf --max-time 2 "$BASE/" >/dev/null 2>&1; then
  fail "dev server boot" "did not respond on $BASE within 60s, see /tmp/lumina-web-test.log"
  echo
  echo "  web: $PASS passed, $FAIL failed"
  exit 1
fi

# 1. Homepage HTML payload
HTML=$(curl -s --max-time 5 "$BASE/")
[ -n "$HTML" ] && pass "GET / returns non-empty HTML" || fail "homepage payload" "empty"

# 2. Next.js root mount point
echo "$HTML" | grep -q 'id="__next"' \
  && pass "homepage contains Next.js root mount (#__next)" \
  || fail "Next root" "no #__next in HTML"

# 3. ChatVRM canvas — present in the rendered DOM (server-side it's there)
echo "$HTML" | grep -qi '<canvas' \
  && pass "homepage contains <canvas> for VRM" \
  || fail "VRM canvas" "no canvas tag in HTML"

# 4. Critical Lumina text markers (settings panel labels, system prompt)
# Server-rendered text may differ, but at minimum the M_PLUS_2 font import
# from ChatVRM should be in the head.
echo "$HTML" | grep -q 'M_PLUS_2\|M-PLUS-2\|m_plus_2' \
  && pass "homepage links the M_PLUS_2 font (ChatVRM markup intact)" \
  || fail "ChatVRM markup" "M_PLUS_2 font not found"

# Note: next.config.js sets `trailingSlash: true`, so /api/models (no slash)
# returns a 308 redirect. Use -L to follow, and probe canonical paths directly
# for header checks.

# 5. /api/models returns JSON with a "models" key
J=$(curl -sL --max-time 5 "$BASE/api/models")
echo "$J" | grep -q '"models"' \
  && pass "/api/models returns {\"models\": [...]}" \
  || fail "/api/models JSON shape" "got: $(echo $J | head -c 200)"

# 6. /api/personalities returns JSON with "personalities" key, has the 3 samples
J=$(curl -sL --max-time 5 "$BASE/api/personalities")
echo "$J" | grep -q '"personalities"' \
  && pass "/api/personalities returns {\"personalities\": [...]}" \
  || fail "/api/personalities JSON shape" "got: $(echo $J | head -c 200)"

for sample in tsundere mentor goth; do
  echo "$J" | grep -q "\"id\":\"$sample\"" \
    && pass "/api/personalities includes '$sample'" \
    || fail "/api/personalities sample $sample" "not in response"
done

# 7. VRMA default idle animation reachable
RC=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BASE/idle_loop.vrma")
[ "$RC" = "200" ] && pass "GET /idle_loop.vrma → 200 (default animation present)" \
  || fail "idle_loop.vrma" "got HTTP $RC"

# 8. Cache-Control on /api/models/ (canonical path, no-store so newly-dropped VRMs surface)
H=$(curl -sI --max-time 5 "$BASE/api/models/")
echo "$H" | grep -qi 'cache-control: no-store' \
  && pass "/api/models has Cache-Control: no-store" \
  || fail "/api/models cache header" "headers:\n$H"

# 9. Reaching a guaranteed-to-be-404 path returns 404 (with trailingSlash: true,
# Next first 308s to add the slash, then returns 404 on the canonical form).
RC=$(curl -sL -o /dev/null -w '%{http_code}' --max-time 5 "$BASE/no-such-path-9999")
[ "$RC" = "404" ] && pass "GET /no-such-path-9999 → 404" \
  || fail "404 handling" "got HTTP $RC"

echo
echo "  web: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
