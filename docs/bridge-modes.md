# Bridge Modes — split vs unified

The bridge layer can run in two modes. Pick by the trade-offs in the table; both ship in the codebase. Switch anytime by setting one env var. No interactive installer, no config file, no rebuild.

## Mode comparison

| | `split` (default) | `unified` |
|---|---|---|
| Processes | 2 (Next.js + standalone bridge) | 1 (Next.js only) |
| Ports | 3000 + 3030 | 3000 only |
| Bridge endpoints | `http://127.0.0.1:3030/{health,event,events}` | `http://127.0.0.1:3000/api/{event,events}` |
| Decoupling | Bridge survives dev-server crashes | Bridge dies when Next.js dies |
| HMR behavior | SSE clients unaffected when you save a `.ts` | Saving certain files **drops SSE clients**; they auto-reconnect on next event |
| Producer-agnostic? | Yes — anything can `curl POST /event` | Same, but only when Next.js is up |
| Startup time | <100 ms (zero-deps `node:http`) | Inherits full Next.js boot (~3–8 s on `/mnt/d/`) |
| Boot order | Bridge ready before dev server (`/health` poll in `up.sh`) | Single boot |
| Files involved | `scripts/buddy-bridge.mjs` | `src/web/src/pages/api/{event,events}.ts` |

**Default is `split`** because decoupling beats simplicity for an integration meant to survive everyday edit churn. **Choose `unified`** if you want one process, one port, and don't mind reconnects on file save.

## Switching

Set `BUDDY_MODE` and the matching URL env vars in your shell, then restart `up.sh`.

### Switch to unified

```bash
# In your WSL shell (~/.bashrc or just for this session):
export BUDDY_MODE=unified
export BUDDY_BRIDGE_URL=http://127.0.0.1:3000/api/event   # where hooks POST
# Plus, in src/web/.env.local for the client:
echo 'NEXT_PUBLIC_BUDDY_BRIDGE_URL=/api/events' > src/web/.env.local
```

Then:

```bash
./scripts/up.sh
```

`up.sh` notices `BUDDY_MODE=unified` and skips starting the standalone bridge. The Next.js api routes in `pages/api/event.ts` and `pages/api/events.ts` handle the same protocol via a `globalThis`-scoped listeners Set.

### Switch back to split

```bash
unset BUDDY_MODE BUDDY_BRIDGE_URL
rm src/web/.env.local   # or remove the NEXT_PUBLIC_BUDDY_BRIDGE_URL line
./scripts/up.sh
```

Defaults take over: standalone bridge on `:3030`, client subscribes there.

## What's on disk for each mode

| File | Used in `split` | Used in `unified` |
|------|-----------------|-------------------|
| `scripts/buddy-bridge.mjs` | yes (started by `up.sh`) | dormant |
| `src/web/src/pages/api/event.ts` | dormant (Next.js still serves it, just no traffic) | yes |
| `src/web/src/pages/api/events.ts` | dormant | yes |
| `scripts/buddy-hook.sh` | reads `BUDDY_BRIDGE_URL` (default `:3030/event`) | reads `BUDDY_BRIDGE_URL` (set to `:3000/api/event`) |
| `src/web/src/features/buddyEvents/buddyEvents.ts` | uses `:3030/events` | uses `/api/events` (relative — same origin) |
| `.claude/settings.json` | unchanged | unchanged |

The hook adapter and the React client both read environment variables at the right layer (server-side env / `NEXT_PUBLIC_` env). No code edits to switch.

## Caveats specific to `unified`

- **HMR drops SSE listeners**: when Next.js fast-refreshes, modules re-import. Old `NextApiResponse` objects stay in `globalThis.__buddyListeners` until the next broadcast, where the per-listener `try/write/catch` prunes the dead ones. Worst case: the user-visible buddy goes briefly silent for one event after a code save. The browser-side `EventSource` reconnects automatically.
- **Boot cost**: in `split` mode, the bridge accepts `POST /event` within ~100 ms of `up.sh` starting. In `unified` mode, hooks that fire during the Next.js boot window will see the api route 404 or 503; the hook adapter's 1 s curl cap means these events are silently dropped. SessionStart is the most common victim. UserPromptSubmit and later events work fine once Next.js is fully up.
- **No `/health`**: `unified` mode doesn't expose `/health`. If you depend on it for monitoring, hit `/api/event` with a no-op POST and check for 200.

## Why I default to `split`

For a development environment where you save TypeScript files dozens of times per session, "buddy briefly silent after every save" is a worse UX than "two processes to manage." The launcher (`up.sh` and `start-Lumina.bat`) makes the two-process cost effectively zero from the user's perspective.

If your workflow is more bursty (long edits between runs), `unified` is fine and saves you a port. The mode choice is reversible in seconds, so try both.
