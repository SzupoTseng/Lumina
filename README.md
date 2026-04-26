```
██╗     ██╗   ██╗███╗   ███╗██╗███╗   ██╗ █████╗
██║     ██║   ██║████╗ ████║██║████╗  ██║██╔══██╗
██║     ██║   ██║██╔████╔██║██║██╔██╗ ██║███████║
██║     ██║   ██║██║╚██╔╝██║██║██║╚██╗██║██╔══██║
███████╗╚██████╔╝██║ ╚═╝ ██║██║██║ ╚████║██║  ██║
╚══════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝
        > THE VISUAL LAYER FOR CLAUDE CODE <
```

# Lumina

> A 3D VRM buddy that reacts to your Claude Code session in real time.

**English** &nbsp;·&nbsp; [繁體中文](README.zh-TW.md)

![Lumina — Claude Code meets VRM buddy](Lumina.png)

Hook events from Claude Code → real-time reactions on a 3D character. Pick a model, pick a personality, watch it emote when Claude edits Python vs. Rust, hear it acknowledge `Edit` and `Bash` returns. Built on top of [ChatVRM](https://github.com/zoan37/ChatVRM) (MIT, pixiv Inc.) and Claude Code's hook system.

## What's different about this

Most "AI dev buddy" projects either roleplay through chat or visualize editor state. Lumina hooks into **Claude Code's actual tool execution events** — the same `PreToolUse`/`PostToolUse`/`Stop` callbacks the harness fires — and routes them through a tiny SSE relay into a VRM avatar's expression and speech bubble. The avatar isn't pretending to react; it's reading the wire.

- **Hook-driven, not prompt-driven.** Reactions fire 100% of the time, with sub-100 ms latency, regardless of whether the model "decides" to mention what it's doing.
- **Language-aware.** `Edit` on `app.py` triggers a different emote/line than the same edit on `lib.rs`. Mappings live in one file, easy to fork.
- **Result-aware.** Beyond knowing *what tool ran*, Lumina parses the **actual output** of test runners (`pytest`, `jest`, `cargo test`, `go test`), build commands (`tsc`, `cargo build`), and linters (`eslint`, `ruff`). The avatar emotes on "23 tests passed" vs "5 tests failed" — not just "Bash returned".
- **Personality system.** Drop a JSON file in `public/personalities/`, get a new system prompt + per-event reaction overrides. Three samples ship: 傲嬌助手, 熱血導師, 冷酷黑客.
- **Two architecture modes.** Standalone bridge (default, decoupled) or unified Next.js api routes (one process, one port). Toggle with one env var.
- **Zero-dep core.** The bridge is ~110 lines of `node:http` + SSE. No Express, no `ws`, no `body-parser`.

## Quick start

Requires **WSL2** (Windows), **Node 18+** in WSL, and [**Claude Code**](https://docs.claude.com/en/docs/claude-code) installed in WSL.

### Primary path — `LuminaLauncher.exe`

Double-click `src/launcher/publish/LuminaLauncher.exe`. It:

1. Shows a small dialog to pick your project directory (defaults to the Lumina repo)
2. Starts the dev server, bridge, and terminal server in WSL background (systemd-run, survives window close)
3. Opens a **split window** — left: Claude Code CLI terminal, right: 3D VRM buddy
4. Monitors bridge health every 5 s; auto-reloads the buddy if the bridge restarts

Window position and splitter ratio are saved to `lumina-prefs.json` next to the .exe and restored on next launch.

### Alternative — from a WSL terminal

```bash
cd /path/to/lumina
./scripts/up.sh          # starts bridge (:3030) + dev server (:3000)
# then open http://localhost:3000 in a browser
```

### Requirements

| Requirement | Version |
|---|---|
| WSL2 | any |
| Node.js (WSL) | 18+ |
| .NET 8 Desktop Runtime (Windows) | for LuminaLauncher.exe |
| Claude Code (WSL) | latest |

### Hook setup (first run only)

For Claude Code reactions to reach the VRM, the global hooks must be installed. The Settings panel (right-side purple panel) shows hook status at the bottom:

- 🟢 `Hooks ✓ (7)` — already installed
- 🔴 `Hooks 未安裝` — click **安裝** to install

Hooks write to `~/.claude/settings.json` and point to `scripts/buddy-hook.sh`. They fire for all Claude Code sessions on this machine; events only reach the VRM while Lumina is open.

## Once it's running

The right panel shows the 3D avatar. **Top-right** is the purple **Settings** panel (▾/▸ to collapse) with:

- **角色** — auto-discovered VRM models from `public/models/` and `public/`
- **人格** — auto-discovered personalities from `public/personalities/` (ships with: 傲嬌助手, 熱血導師, 冷酷黑客)
- **效能** — Eco / Balanced / Ultra performance profile
- **語言** — zh-TW / en / ja (all reactions translate)
- **Hooks** — install / uninstall / status
- **Conversation Log** — all VRM reactions with timestamps; clearable

**Top-left** (next to the original ChatVRM buttons) is the **Buddy Log** button showing the same log inline.

**Top-centre** shows the **Status Bar** (Web :3000 and Bridge :3030 live indicators). Below it, a **Status Panel** shows the current `[Task] / [Scope] / [TODO]` from Claude Code's ccusage status line, updated every 5 seconds.

**Bottom-left** is the **互動測試** (Demo Panel) — try all reactions without Claude Code:

Type in Claude Code on the left and the avatar will:

- React on `SessionStart` with memory recall or default greeting
- Switch emotes during tool use (Edit / Write / Bash / Read)
- Show language reactions for `.py` / `.rs` / `.ts` / `.go` / `.sql` files
- Fire test-pass / test-fail / build reactions for `pytest`, `jest`, `cargo test`, `tsc`
- Detect `git push`, `git commit`, `git merge`, conflict, reset and react accordingly
- Show 🌐 cyan particle swarm during `npm install`, `docker build`, `terraform apply`
- Show 🛑 chromatic-glitch overlay on dangerous commands (`rm -rf /`, force-push to main, `DROP TABLE`)
- Render Claude's `TaskCreate` / `TaskUpdate` calls as a live task list panel
- Show `[Task]` / `[Scope]` / `[TODO]` from ccusage status at the top
- Pop achievement toasts on milestones

## Add your own assets

| You want to | Drop file at | Then |
|---|---|---|
| Add a VRM avatar | `src/web/public/models/<name>.vrm` | Refresh tab → pick from **Buddy** dropdown |
| Add a personality | `src/web/public/personalities/<id>.json` | Refresh tab → pick from **Persona** dropdown |

Personality JSON schema and full guide: [`docs/personalities.md`](docs/personalities.md). Quick template in [`CONTRIBUTING.md`](CONTRIBUTING.md).

VRM model swap workflows (drag-drop / drop-in folder / env-pinned URL / IPFS fallback): [`docs/swap-vrm-model.md`](docs/swap-vrm-model.md).

## Troubleshooting

Four health signals to check (in order):

1. Bridge: `curl -s http://127.0.0.1:3030/health` → `{"ok":true,"listeners":N}` with N ≥ 1
2. Dev server: `curl -s http://localhost:3000/ -o /dev/null -w '%{http_code}'` → `200`
3. Browser DevTools console: `[buddy] connected to http://127.0.0.1:3030/events`
4. StatusBar (top-centre of VRM): both dots green

If 1+2 pass but 3 fails → browser-side issue, check DevTools Network tab. If 3 works but reactions don't fire → bug in `REACTIONS` mapping in `buddyEvents.ts`, not infrastructure.

| Symptom | Fix |
|---|---|
| LuminaLauncher exits immediately | Missing .NET 8 Desktop Runtime — install from https://dotnet.microsoft.com/download/dotnet/8.0 |
| Left terminal shows "Unauthorized" | Token mismatch — close and reopen LuminaLauncher |
| VRM shows "⏳ waiting" forever | Dev server not on :3000 — check `ss -tlnp \| grep 3000` in WSL |
| No VRM reactions to Claude Code | Hooks not installed — open Settings panel → click **安裝** |
| Site can't be reached at `localhost:3000` | WSL2 `localhostForwarding` may be disabled — remove `localhostForwarding=false` from `~/.wslconfig`, then `wsl --shutdown` |
| Dev server exits after "ready" | Running from `/mnt/d/` — `start-dev.sh` handles this automatically via rsync |
| Port 3000 or 3030 already in use | From WSL: `pkill -f buddy-bridge.mjs; pkill -f next-server` then relaunch |

Full failure-mode matrix with diagnoses: [`docs/install-flow.md`](docs/install-flow.md) and [`docs/edge-cases.md`](docs/edge-cases.md).

## Architecture

```
WSL bash (or Linux):                       Windows browser:
                                                  │
   Claude Code  ──┐                               │ EventSource
                  │ buddy-hook.sh                 ▼
                  │ POST /event           ChatVRM  ◀── SSE ── buddy-bridge
                  ▼                       (emote + speech bubble)   :3030
                bridge :3030
```

- `scripts/buddy-bridge.mjs` — zero-dep SSE relay (POST `/event`, GET `/events`, GET `/health`).
- `scripts/buddy-hook.sh` — Claude Code hook adapter; reads JSON from stdin, posts to bridge, **always exits 0** so it never blocks tool execution.
- `.claude/settings.json` — wires `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Notification`, `Stop`, `SessionEnd` to the adapter.
- `src/web/src/features/buddyEvents/buddyEvents.ts` — EventSource client + reaction resolution (event → tool → language → personality, last wins).
- `src/web/src/components/{modelSelector,personalitySelector}.tsx` — auto-discovered dropdowns over `public/models/*.vrm` and `public/personalities/*.json`. Selection persists in `localStorage` and syncs across tabs via the `storage` event.

Full pipeline diagram, event taxonomy, endpoints, and extension points: [`docs/buddy-bridge.md`](docs/buddy-bridge.md).

## Customize

| You want to change | Read this |
|--------------------|-----------|
| The avatar | [`docs/swap-vrm-model.md`](docs/swap-vrm-model.md) — drag-drop, drop-in folder, env override, IPFS fallback chain |
| The personality | [`docs/personalities.md`](docs/personalities.md) — drop a JSON file, switch instantly without reconnect |
| What the buddy says/feels per event | `REACTIONS` and `LANGUAGE_REACTIONS` in [`buddyEvents.ts`](src/web/src/features/buddyEvents/buddyEvents.ts) |
| Standalone bridge vs unified Next.js routes | [`docs/bridge-modes.md`](docs/bridge-modes.md) — `BUDDY_MODE=split\|unified`, with tradeoff table |
| The whole thing, from an empty directory | [`docs/bootstrap-prompts.md`](docs/bootstrap-prompts.md) — five sequential prompts a fresh Claude Code session can execute |

## Edge cases & known issues

Honest review of failure modes and what the system does about them: [`docs/edge-cases.md`](docs/edge-cases.md). Highlights:

- **WSL2 with `localhostForwarding=false`** — browser can't reach WSL services. Diagnosis + one-line fix in the doc.
- **`@pixiv/three-vrm-core@1.0.9` ships incomplete `.d.ts` files on npm** — TypeScript build fails, runtime is fine. Workaround in `next.config.js` documented in [`docs/upstream-baseline.md`](docs/upstream-baseline.md).
- **Building from `/mnt/d/` (Windows-mounted drive) under WSL2 is flaky** — bus errors, corrupt JSON in `node_modules`. Move to native WSL FS for production builds.

## Project layout

The repo uses a strict four-bucket layout (`src/`, `scripts/`, `docs/`, `tests/`) plus configuration directories (`.claude/`, `.vscode/`). Conventions and the working rules are in [`CLAUDE.md`](CLAUDE.md).

## License

MIT — this project.

Lumina vendors source from [zoan37/ChatVRM](https://github.com/zoan37/ChatVRM) (MIT, Copyright © 2023 pixiv Inc.) at `src/web/`. The upstream license is preserved at [`src/web/LICENSE`](src/web/LICENSE).

VRM model files placed under `public/` or `public/models/` are governed by their original authors' terms (VRoid Hub / Booth / etc.). They are excluded from the repo by default — see [`.gitignore`](.gitignore) and [`docs/swap-vrm-model.md`](docs/swap-vrm-model.md) for redistribution guidance.

## Status

Pre-1.0. The integration runs end-to-end on WSL2 + Claude Code; treat anything outside that environment as untested. See open issues for what's deliberately not built yet.
