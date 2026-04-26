# Bootstrap Prompts — Lumina from zero

Five sequential prompts to give a fresh Claude Code session in an empty directory. Each stage is independently verifiable via its **Acceptance** block; if a stage's checks pass, the next stage starts from a known-good state. Encoded the gotchas we hit on the first build so the second build doesn't hit them.

Persona for every stage: **Google L7 staff engineer** — defensive, observability-first, no premature abstractions, no unauthorized destructive ops.

---

## Stage 1 — Repo skeleton & folder contract

**Goal:** turn an empty directory into a four-bucket layout with a `CLAUDE.md` that future sessions will follow.

```
You are a Google L7 staff engineer. The current working directory is empty
and will hold the Lumina project. Do the following, in order:

1. Create top-level dirs: src/, scripts/, docs/, tests/. Nothing else.
2. Write CLAUDE.md at the repo root with these enforced rules:
   - Every new file lands in exactly one of {src, scripts, docs, tests}.
   - src/ is product code only — no scripts, no scratch files.
   - scripts/ holds standalone executables, named verb-object
     (build-release.sh, extract-assets.py). >300 lines or imported by
     another script → graduate to src/.
   - docs/ is markdown only; decisions go in docs/decisions/NNNN-*.md.
   - tests/ mirrors src/ layout.
   - Do NOT add new top-level dirs without updating CLAUDE.md first.
3. Mark CLAUDE.md as the contract: future stages append run commands and
   architecture notes here — do not invent commands until they exist.

Do not initialize git, do not write any product code, do not create
.gitignore yet (we don't know the toolchain). Stop when the four dirs and
CLAUDE.md exist.
```

**Acceptance**
- `ls -1` at root prints exactly `CLAUDE.md docs scripts src tests` (plus any auto-generated dirs like `reasoninghist/`).
- `CLAUDE.md` mentions the four buckets and the "no new top-level dirs" rule.

**Anti-patterns to call out in CLAUDE.md**
- Scratch files at the repo root.
- A generic `scripts/util.py` or `scripts/run.sh`.
- Treating `reasoninghist/` (auto-captured logs) as editable.

---

## Stage 2 — ChatVRM baseline at `src/web/`

**Goal:** seed the product code from the open-source ChatVRM, capture provenance, get `npm run dev` to print `ready`.

```
You are a Google L7 staff engineer continuing the Lumina bootstrap from
Stage 1. The repo skeleton exists. Do the following:

1. git clone --depth 1 https://github.com/zoan37/ChatVRM.git src/web
2. Capture the cloned commit SHA, then remove src/web/.git so we don't
   nest a foreign repo.
3. Read src/web/LICENSE — record the license (expect MIT, pixiv Inc.).
4. cd src/web && npm install (no audit, no fund).
5. Verify the build surface:
   - npm run dev should print "ready - started server on 0.0.0.0:3000".
     If it crashes earlier, capture the exact error and stop.
   - npm run build will fail type-check on
     @pixiv/three-vrm-core@1.0.9 because the published .d.ts files are
     incomplete (only types/lookAt/utils/calcAzimuthAltitude.d.ts ships).
     Runtime is fine. Workaround: add `typescript: { ignoreBuildErrors: true }`
     to src/web/next.config.js with a comment pointing at this stage doc.
     Do NOT upgrade @pixiv/three-vrm to 3.x in this stage — that's a
     separate decision (API changes touch features/vrmViewer + emoteController + lipSync).
6. Write docs/upstream-baseline.md capturing: upstream URL, lineage
   (zoan37 ← zoan37-jp ← pixiv), cloned commit SHA, license, clone date,
   live demo URL, and a section on "What's in src/web/" (high-level
   layout of features/, pages/api/, services/).
7. Append to CLAUDE.md:
   - Run commands rooted at src/web (dev/build/start/lint).
   - Known build issues: the three-vrm-core type defect AND the
     /mnt/d/ flakiness if the host is WSL2 on a Windows-mounted drive
     (symptoms: corrupt JSON in node_modules, "Bus error (core dumped)"
     during next build). Recommend native WSL FS or running from
     Windows-side Node.
   - High-level architecture map of src/web/src/features/ — vrmViewer,
     chat, messages, elevenlabs, lipSync, emoteController.

Hard constraint: do not write tests this stage, do not pick a test
runner, do not commit anything (this repo is not yet a git repo).
```

**Acceptance**
- `src/web/node_modules/.bin/next` exists.
- `src/web/.git` does NOT exist.
- `docs/upstream-baseline.md` records a 40-char commit SHA.
- `npm run dev` from `src/web` reaches `ready - started server on 0.0.0.0:3000` within 30s on a real terminal.

**Anti-patterns**
- Keeping the upstream `.git` (creates a nested repo).
- Pre-emptively upgrading three-vrm — defer to a decision record.
- Deleting `package-lock.json` to "force fresh" — that hides supply-chain pinning.

---

## Stage 3 — Event bus: bridge + hooks

**Goal:** stand up a zero-dep Node SSE service, the hook adapter, and `.claude/settings.json` so every Claude Code event fires through to listeners.

```
You are a Google L7 staff engineer continuing the Lumina bootstrap. The
ChatVRM baseline is at src/web/. Now build the deep-integration substrate.

Architecture (do not deviate without a decision record):

  Claude Code  →  hook adapter (sh)  →  POST /event  →  bridge (SSE)
                                                          │
                                              GET /events │
                                                          ▼
                                               browser EventSource

Constraints:
- Bridge is one file, zero npm deps. Use node:http only. Bind 127.0.0.1
  (no public exposure — there is no auth).
- Hook adapter must NEVER block Claude Code. exit 0 always. curl with
  --connect-timeout 0.3 --max-time 1. Stdout silent (Claude reads it).
- Pick SSE over WebSocket. SSE has built-in reconnect, no handshake,
  no extra deps. We don't need bidirectional in this layer.

Implementation:

1. scripts/buddy-bridge.mjs
   - GET /health → {ok, listeners}
   - GET /events → text/event-stream, 15s keepalive comments,
     close-tracking on req.close.
   - POST /event → JSON body, body cap 64 KB, broadcast {ts, ...body}
     as one SSE message. Reject malformed JSON 400.
   - SIGINT/SIGTERM → graceful close.
   - Env: BUDDY_BRIDGE_PORT (default 3030), BUDDY_BRIDGE_HOST (127.0.0.1).
   - chmod +x.

2. scripts/buddy-hook.sh
   - Reads stdin (Claude Code passes hook context as JSON on stdin).
   - First arg is event-type (SessionStart, PostToolUse, etc.).
   - Lifts tool_name and session_id via grep -oE (no jq dep).
   - If python3 is available, builds full envelope including raw context;
     else builds a minimal envelope.
   - curl -sf --connect-timeout 0.3 --max-time 1 ... || true
   - exit 0.
   - chmod +x.

3. .claude/settings.json
   Hooks for: SessionStart (matcher startup|resume), SessionEnd,
   UserPromptSubmit, PreToolUse (matcher Bash|Edit|Write|NotebookEdit),
   PostToolUse (matcher Bash|Edit|Write|NotebookEdit|Read|Grep|Glob),
   Notification, Stop. Each runs:
     "${CLAUDE_PROJECT_DIR}/scripts/buddy-hook.sh <EventName>"

4. Smoke test (must pass before stage is done):
   a. node scripts/buddy-bridge.mjs &  →  curl /health returns ok:true
   b. timeout 3 curl -sN /events &
      echo '{"tool_name":"Edit"}' | scripts/buddy-hook.sh PostToolUse
      Subscriber MUST print: data: {"ts":..., "type":"PostToolUse",
      "tool":"Edit", "session":..., "context":{"tool_name":"Edit"}}

5. Append to CLAUDE.md:
   - Hard rule: scripts/buddy-hook.sh always exit 0. Non-zero in
     PreToolUse blocks Claude's tool call.
   - .claude/ as an allowed top-level dir (project hooks/config).
```

**Acceptance**
- `node scripts/buddy-bridge.mjs` listens on 127.0.0.1:3030.
- The smoke test from step 4 emits the expected SSE line.
- `.claude/settings.json` validates against the Claude Code schema (`$schema` field included).

**Anti-patterns**
- Using `express`, `ws`, or any npm dep — defeats the "zero attack surface" goal.
- Reading stdin in the bridge — bridge is a server, hook adapter is the only stdin consumer.
- Hook scripts that exit non-zero on transient failure (bridge down, network glitch) — Claude will refuse to run tools.
- Binding to `0.0.0.0` — no auth on the bridge.

---

## Stage 4 — ChatVRM client integration

**Goal:** ChatVRM's avatar reacts to bridge events. Single source of truth for the event→emote map.

```
You are a Google L7 staff engineer continuing the Lumina bootstrap. The
bridge from Stage 3 is up. Now wire the ChatVRM client to react.

Discovery first (don't skip — the upstream code is what it is):

1. The viewer is a class at src/web/src/features/vrmViewer/viewer.ts.
   The Model on it (viewer.model) exposes
   model.emoteController.playEmotion(preset) where preset is one of
   "neutral" | "happy" | "angry" | "sad" | "relaxed". This is the ONLY
   API you need for visual reactions in this stage. Do not touch
   speakCharacter — spoken reactions require an LLM/TTS key and belong
   in a follow-on.
2. The current overlay text (the speech bubble) is the assistantMessage
   state in src/web/src/pages/index.tsx, set via setAssistantMessage.

Implementation:

1. New file src/web/src/features/buddyEvents/buddyEvents.ts:
   - export type BuddyEvent = { type, ts?, tool?, session?, context? }.
   - export connectBuddyEvents(viewer, { url?, onMessage? }) returns a
     disconnect function. Default url: http://127.0.0.1:3030/events.
   - Internal REACTIONS map keyed by event type, each entry:
     { emotion: EmotionPreset, line?: string, toolLines?: Record<string,string> }.
     Defaults:
       SessionStart        → relaxed, "Claude 來上班了。"
       SessionEnd          → neutral, "下次見～"
       UserPromptSubmit    → neutral, no line
       PreToolUse          → neutral, toolLines per tool ("跑指令中…", "改 code 中…", "寫新檔中…")
       PostToolUse         → happy,   toolLines per tool ("指令跑完。", "改完了。", "存檔完成。", "讀完了。")
       Notification        → angry,   "需要你回覆一下！"
       Stop                → relaxed, "好了。"
   - Hello messages from the bridge ({type:"hello"}) are ignored.
   - On EventSource error: close, back off 5s, retry. Do not let Chrome's
     auto-retry hammer when the bridge is fully down.
   - Wrap playEmotion in try/catch; warn to console — model may not be
     loaded yet on early events.

2. Edit src/web/src/pages/index.tsx:
   - import { connectBuddyEvents } from "@/features/buddyEvents/buddyEvents".
   - Add a useEffect keyed on [viewer]:
       const disconnect = connectBuddyEvents(viewer, {
         onMessage: (text) => setAssistantMessage(text),
       });
       return disconnect;
   - Place it next to the other viewer-dependent useEffects, not at top.

3. Acceptance test (run with bridge up):
   - Open http://localhost:3000 in a browser, wait for the model.
   - From a terminal: echo '{"tool_name":"Edit"}' | scripts/buddy-hook.sh PostToolUse
   - Browser console should log "[buddy] connected to ...". Avatar
     should switch to "happy". The speech bubble should read "改完了。".
   - Close the bridge. The client should log a single onerror,
     back off 5s, then attempt reconnect — not a flood.

4. Append to CLAUDE.md:
   - Single source of truth for reactions: REACTIONS in buddyEvents.ts.
   - To add tool-specific lines, extend toolLines, not REACTIONS keys.
   - Spoken reactions are out of scope here; see "Extending" in
     docs/buddy-bridge.md (Stage 5).
```

**Acceptance**
- `connectBuddyEvents` is called exactly once per viewer instance and is correctly cleaned up.
- Avatar visibly emotes in response to a `curl POST /event` from a third terminal.
- Bridge-down state does not cause an EventSource reconnect storm.

**Anti-patterns**
- Polling the bridge from React (use SSE, not setInterval).
- Multiple `useEffect`s subscribing to the same EventSource.
- Putting reaction definitions in `pages/index.tsx` — single source rule.
- Calling `speakCharacter` here — that requires keys and audio playback approval; out of scope.

---

## Stage 5 — Launcher, split-window UX & verification

**Goal:** `LuminaLauncher.exe` provides a one-double-click experience: left terminal with Claude Code CLI, right WebView2 with VRM buddy, all services auto-managed, window geometry persisted.

```
You are a Google L7 staff engineer delivering the final Lumina experience.
Bridge and client integration work. Now build the Windows C# launcher.

1. src/launcher/LuminaLauncher.csproj — WinForms + WebView2 (.NET 8 win-x64)
   - Package: Microsoft.Web.WebView2
   - OutputType: WinExe

2. src/launcher/Program.cs — split window:
   - SetupDialog: directory picker + "左側嵌入 Claude Code CLI" checkbox
   - SplitWindow: SplitContainer with left=WebView2(xterm.js) right=WebView2(localhost:3000)
   - StartBackground(): systemd-run start-bridge.sh, start-dev.sh, start-terminal.sh, status-bridge.sh
   - BridgeWatchdog(): poll /health every 5s; reload right WebView2 when bridge comes back up
   - CaptureAndSave(): save window prefs on ResizeEnd + SplitterMoved + FormClosing

3. src/terminal/server.mjs — node-pty WebSocket server:
   - node-pty spawns bash/claude with TERM=xterm-256color
   - WebSocket :3031; bridge stdin/stdout; resize via JSON {type:"resize",cols,rows}
   - Extends PATH with ~/.local/bin for Claude Code discovery

4. Global hooks in ~/.claude/settings.json:
   - Absolute paths to scripts/buddy-hook.sh for all 7 events
   - Works across ALL Claude Code sessions; events are no-ops when bridge is down
   - Install/uninstall UI in Settings panel via /api/hooks endpoint

5. docs/install-flow.md — updated diagram showing LuminaLauncher flow
6. docs/vscode-setup.md — demoted to "Optional: editing source while Lumina runs"
7. docs/buddy-bridge.md — add StatusUpdate event for ccusage [Task]/[Scope]/[TODO]

Latency budget (unchanged):
- Hook POST to VRM emote: < 200 ms p50, < 500 ms p99 on localhost
- Bridge watchdog reload: < 6s after bridge restart (5s poll + 1s wait)
```

**Acceptance**
- Double-click LuminaLauncher.exe → split window appears with xterm.js left, ChatVRM right
- Type `claude` in left terminal → Claude Code starts with hooks loaded
- Submit a prompt → bridge receives event → VRM reacts within 500 ms
- Kill bridge → wait 6s → right WebView2 auto-reloads, SSE reconnects
- Close and reopen launcher → window size/splitter position restored from prefs

**Anti-patterns**
- Requiring VS Code for the split-window experience — LuminaLauncher is the primary launcher
- Using ConPTY in C# for the terminal — too complex; node-pty + xterm.js is the VS Code pattern
- Embedding Windows Terminal via SetParent — WinUI 3 windows are not embeddable
- Depending on Simple Browser for WebGL — it disables WebGL; WebView2 supports it fully

---

## Cross-stage architectural notes

- **Decoupling boundary** is the bridge's POST `/event` shape. Anything that can curl can be a producer (CI, git hooks, the nol5 dashboard). If Claude Code's hook protocol changes, only the adapter shell script needs updating.
- **No MCP server.** MCP is for tools Claude calls deliberately. We want passive observation of Claude's actions. Hooks are the right primitive; MCP would be over-engineering.
- **Why SSE not WebSocket:** unidirectional, built-in browser reconnect, no handshake, no deps. The day we need C→S messages from the buddy back to Claude, swap to WS — until then, don't pay the cost.
- **Why no `express` / `ws` deps:** every npm dep is a supply-chain risk and a future advisory. The bridge is ~110 lines of stdlib code. Worth maintaining ourselves.
- **Hard constraint** on hooks: `exit 0` always. The substrate runs in your interactive loop; it cannot be allowed to fail.
