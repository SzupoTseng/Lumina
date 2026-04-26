# Lumina Test Suite

Zero-dependency TDD coverage. Uses Node's built-in `node:test` runner
(Node 18+) for unit tests, and bash for integration tests against the
real bridge / hooks / scripts.

## Running

```bash
# All sections (from repo root):
./scripts/test.sh

# Single section:
./scripts/test.sh detection      # 74 unit tests, ~120 ms
./scripts/test.sh state          # 15 unit tests
./scripts/test.sh bridge         # bridge integration (~5 s)
./scripts/test.sh hook           # hook adapter integration
./scripts/test.sh scripts        # idempotency contracts
./scripts/test.sh web            # web integration (boots dev server if needed)
```

## What's covered

| File | Type | Tests | Covers |
|------|------|-------|--------|
| `detection.test.mjs` | `node:test` unit | 74 | Language extension detection, git op detection (incl. branch/message extraction, conflict detection), tool-result parsing (pytest/jest/cargo test/go test), dangerous-command patterns, slash-command routing, long-task command detection, achievement fix-message regex |
| `state.test.mjs` | `node:test` unit | 15 | Memory-stream reminiscence picker (positive entry, age formatting, 7-day window), achievement threshold + unlock filtering, agent monitor edit-loop / edit-revert detection (including time-window expiry), task tracker upsert + status transitions |
| `bridge.test.sh` | bash integration | 7 | `scripts/buddy-bridge.mjs` end-to-end: `/health`, `POST /event`, SSE delivery (hello + broadcast + full context), listener count, malformed JSON → 400, unknown route → 404, CORS preflight |
| `hook.test.sh` | bash integration | 5 | `scripts/buddy-hook.sh` envelope shape (type/tool/session/context preservation), exit-0 contract when bridge unreachable, empty-stdin handling, max-time 1s adherence |
| `scripts.test.sh` | bash integration | 6 | `start-bridge.sh` and `start-dev.sh` idempotency: fresh start works, second invocation exits 0 quickly with "already responding" message |
| `web.test.sh` | bash integration | 12 | Next.js dev server end-to-end: HTTP 200 on `/`, HTML contains `#__next` + `<canvas>` + M_PLUS_2 font, `/api/models` JSON shape + `Cache-Control: no-store`, `/api/personalities` includes tsundere/mentor/goth, `/idle_loop.vrma` reachable, unknown path → 404. **Verified passing 12/12 against `~/lumina-runtime/` on 2026-04-26** — see CLAUDE.md "Root cause of next dev silently exiting" for why the project must run from native WSL FS for this section to work. |

**Total: 119 tests** when full suite runs.

## Why some tests duplicate regex inline

Files like `detection.test.mjs` and `state.test.mjs` **copy the regex
patterns and core algorithms** from the TypeScript source files
(`buddyEvents.ts`, `agentMonitor.ts`, etc.). This is intentional:

- **Zero deps:** the test runner doesn't need a TypeScript loader (no
  `tsx` / `ts-node` install, no `tsc` build step).
- **Drift detector:** when the source changes, tests will fail (until you
  also update the test). The test thus enforces "thinking twice" before
  altering critical regex.
- **Self-contained:** every test file runs without network or upstream
  resolution.

If you'd rather have direct imports from the source, switch the runner to
`tsx --test` and update the imports — but expect a ~50-package devDep
tree.

## Bug found by this suite

Adding the dangerous-command tests caught a real false-positive in
`agentMonitor.ts`:

> **Before:** `rm -rf /tmp/lumina` was flagged as severity `stop`. The
> regex `\/(?:\s|$|[^/])` matched any `/` followed by a non-slash char,
> so any absolute path triggered.
>
> **After:** regex tightened to `(?:\/(?:\s|$)|~\/?(?:\s|$)|\$HOME(?:\s|$))`
> which only matches bare `/`, bare `~`/`~/`, bare `$HOME`. Targeted
> subdirs (`/tmp/foo`, `~/Documents`, `$HOME/cache`) no longer trigger.

This was a real false-positive that would have annoyed users on
legitimate cleanup commands. The test caught it before it shipped.

## What's NOT covered

These layers are intentionally untested by this suite:

- **React components** (selectors, panels, overlays) — would need a DOM
  environment (`jsdom` or Playwright). Verified manually; visual
  regression caught at first user run.
- **Personality file parsing** — the JSON files in
  `public/personalities/` are validated by the `/api/personalities`
  route at request time; broken files are skipped with a `console.warn`
  (verified by reading the route).
- **VRM model loading** — depends on the Three.js + @pixiv/three-vrm
  runtime, not testable headlessly without a WebGL context.

## Adding a test

1. **Pure function or regex?** Add a `test()` block in
   `detection.test.mjs` or `state.test.mjs`. Copy the source pattern
   inline. Use `assert.equal` / `assert.deepEqual` from `node:assert/strict`.
2. **Real script invocation?** Add a section to one of the `.sh` files,
   following the `pass`/`fail` helper pattern. Always clean up spawned
   processes in a `trap cleanup EXIT`.
3. **Whole new module?** Add `tests/<name>.test.{mjs,sh}` and add a
   matching `run_section` line to `scripts/test.sh`.

## Failure mode reference

| Failure | Most likely cause |
|---------|-------------------|
| `port 3530 already in use` | A previous bridge test died without cleanup. Run `pkill -f buddy-bridge.mjs`. |
| `/health` returns nothing | bridge took >2 s to start (slow disk?). Increase the wait loop in the test. |
| `node: --test not recognized` | Node < 18.6. Upgrade Node. |
| Test passes here but fails on Linux CI | The `set -uo pipefail` may surface variable-init issues that bash on this machine glosses over. Look for unset vars. |
| `web` section: dev server did not respond on $BASE within 60s | First boot of Next.js can take >60s on cold cache. Run `./scripts/start-dev.sh` manually, wait for "ready", then re-run `./scripts/test.sh web`. The test reuses an existing server. |
| `web` section: `next dev` prints `ready` then silently exits with status 0 | **Project is on `/mnt/d/` (Windows DrvFs/9p)** — Next.js's `projectFolderWatcher` (line ~526 of `node_modules/next/dist/cli/next-dev.js`) watches the parent directory, gets spurious filesystem events from 9p, calls `findPagesDir()` which fails or returns falsy, falls into the "Project directory could not be found" branch, and silently `process.exit(0)`s. **Fix:** copy the project to native WSL FS, e.g. `rsync -a --exclude=node_modules --exclude=.next /mnt/d/GameDevZ/Lumina/ ~/lumina-runtime/ && cd ~/lumina-runtime/src/web && npm install`, then run dev server from there. |
