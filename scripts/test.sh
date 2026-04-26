#!/usr/bin/env bash
# scripts/test.sh — Lumina TDD runner. Zero npm deps; uses bash + node:test.
#
# Runs in this order:
#   1. Bridge integration tests (real bridge, real curl, real SSE)
#   2. Hook adapter tests (real bridge capture, real stdin)
#   3. Idempotent-script tests (start-bridge.sh / start-dev.sh)
#   4. Detection regex unit tests (git, language, dangerous, slash, results)
#   5. State-system unit tests (memory, achievements, monitor, taskTracker)
#   6. Web integration tests (Next.js dev server, /api/*, static assets)
#
# Usage:
#   ./scripts/test.sh             # run all
#   ./scripts/test.sh bridge      # run only bridge tests
#   ./scripts/test.sh detection   # run only detection tests
#   ./scripts/test.sh state       # only state tests
#   ./scripts/test.sh web         # only web integration (boots dev server if needed)
#
# Requires Node 18+ (node:test built in).

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TESTS_DIR="$ROOT/tests"
FILTER="${1:-all}"

# Sanity: node available?
if ! command -v node >/dev/null 2>&1; then
  echo "[test] error: node not found" >&2
  exit 1
fi
NV=$(node -p 'process.versions.node.split(".")[0]')
[ "$NV" -ge 18 ] || { echo "[test] error: node 18+ required (found $NV)" >&2; exit 1; }

# Pre-cleanup any stale processes from previous test runs
pkill -f buddy-bridge.mjs 2>/dev/null || true
sleep 0.2

declare -i FAIL_COUNT=0

run_section() {
  local name="$1" cmd="$2"
  if [ "$FILTER" = "all" ] || [ "$FILTER" = "$name" ]; then
    echo
    echo "==== [$name] $cmd ===="
    if eval "$cmd"; then
      echo "[$name] OK"
    else
      echo "[$name] FAILED"
      FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
  fi
}

run_section bridge    "bash '$TESTS_DIR/bridge.test.sh'"
run_section hook      "bash '$TESTS_DIR/hook.test.sh'"
run_section scripts   "bash '$TESTS_DIR/scripts.test.sh'"
run_section detection "node --test '$TESTS_DIR/detection.test.mjs'"
run_section state     "node --test '$TESTS_DIR/state.test.mjs'"
run_section web       "bash '$TESTS_DIR/web.test.sh'"

echo
echo "===================================================="
if [ "$FAIL_COUNT" -eq 0 ]; then
  echo "  All sections passed."
  exit 0
else
  echo "  $FAIL_COUNT section(s) FAILED."
  exit 1
fi
