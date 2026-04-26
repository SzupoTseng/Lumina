# Edge Cases & Failure Modes

Honest review of what can go wrong and what the system does about it. Severity is "how often this hits a normal user", not "how bad if it hits".

## Network topology — what's actually true

Both the bridge and the Next.js dev server run **inside WSL**. The browser is on Windows. There's no WSL→Windows callback path; everything the browser needs is WSL-side, reached through WSL2's automatic localhost forwarding.

```
WSL bash:                Windows browser:
  Claude Code  ──curl──▶  bridge :3030  ◀──fetch SSE── ChatVRM tab :3000
                           (127.0.0.1)                  (Windows localhost)
```

Implication: the often-cited `cat /etc/resolv.conf | grep nameserver | awk '{print $2}'` to fetch the Windows host IP is **not relevant here** — that's for WSL processes calling out to a service running on Windows. We don't do that.

---

## Severity: high (will hit some users)

### 1. WSL2 localhost forwarding disabled

If `localhostForwarding=false` is set in `~/.wslconfig`, the browser on Windows cannot reach `localhost:3000` or `localhost:3030`. The Next.js dev server prints "ready" but the tab loads nothing.

**Diagnosis**: `cat /mnt/c/Users/<you>/.wslconfig` from WSL. Look for `localhostForwarding`.

**Fix**: remove the line (default is `true`), or `wsl --shutdown` and reopen.

### 2. Bridge dies but cmd window survives (force-closed terminal)

If the user closes the cmd window holding `wsl.exe` via the X button (instead of Ctrl+C), the bash trap may not fire and the bridge orphans as a stranded WSL process. Port 3030 stays held.

**What we do**: the next run of `up.sh` aborts early with `port 3030 already in use — close the other process or set BUDDY_BRIDGE_PORT`. User runs `wsl pkill -f buddy-bridge.mjs` and retries.

**What we don't do**: there's no PID file or watchdog. Adding one introduces its own staleness bug.

### 3. SessionStart event lost on first run (FIXED, see below)

If the user starts Claude Code at the same instant as `up.sh`, the bridge may not be listening yet when the first hook fires. The hook adapter's 0.3s connect timeout means the event is dropped silently. UserPromptSubmit on the first prompt typically succeeds.

**What we do (now)**: `up.sh` polls `/health` until the bridge answers before starting the dev server, so by the time you can open a browser tab the bridge is reachable. Claude Code is usually started by hand after that, so the race is gone in practice.

---

## Severity: medium (hits power users)

### 4. Multiple Claude Code sessions running concurrently

Each `claude` invocation in different terminals fires hooks against the same bridge. The buddy reacts to whichever event arrives most recently — there's no per-session filtering in `REACTIONS`.

**Workaround**: events carry `session` field; if you actually need per-session muting, filter in `buddyEvents.ts` by checking `evt.session` against an allowlist.

### 5. Hook event flood on bulk tool use

If Claude runs a script that does 100+ reads in 2 seconds, that's 100 PostToolUse events. Each hits `playEmotion` + `setAssistantMessage`. Not catastrophic — `expressionController` smooths internally and React batches state updates — but the speech bubble is unreadable during the burst.

**Mitigation if it bites**: add a 100ms throttle in `buddyEvents.ts apply()`. Out of scope until observed in practice.

### 6. Path containing single quotes

`up.sh` is invoked with `bash -lc "cd '$REPO_WSL' && ./scripts/up.sh"` from the .bat. If your repo path contains a single quote (`/home/x/lumina's copy/`), this breaks. Spaces are fine.

**Workaround**: don't. We're not going to fix this — single quotes in a project path are a self-inflicted wound.

---

## Severity: low (cosmetic / theoretical)

### 7. Personality switch mid-line

The 4s auto-clear timer ignores personality changes. If you switch from `tsundere` to `goth` while `🎉 哼，搞定了` is showing, the bubble keeps that line until the timer expires, then clears. New events use the new personality.

### 8. Hot Module Reload during dev

Fast Refresh in Next.js may not call `useEffect` cleanup cleanly when buddyEvents.ts itself changes. EventSource may leak. Refreshing the tab is a no-op fix; in practice you don't edit `buddyEvents.ts` mid-session often enough to care.

### 9. Hook adapter on a system without python3

Falls back to minimal envelope (no `context` field). All current `REACTIONS` work without `context` except `lang.*` overrides — those need `context.tool_input.file_path`. Without python3 you lose language-aware reactions but everything else still fires.

### 10. API key sharing if you `cp -r Lumina`

The paste's worry about API keys leaking when sharing the folder is **misdirected** — keys live in browser localStorage on the original machine, not in the project folder. Copying the folder does not copy the keys. The cloned setup will prompt for keys again on first use.

The actual risk is committing a `.env.local` once you add one. When git lands, `.env.local` and `.env.production` go in `.gitignore`.

---

## Things the paste worried about that aren't real for us

| Paste claim | Reality |
|-------------|---------|
| "WSL localhost doesn't talk to Windows localhost" | False direction — see topology diagram above. |
| "Limit FPS to 30 to free CPU for compile" | Three.js auto-throttles when tab is not visible (rAF skipped). Hard cap not needed. |
| "Implement WSL→Windows IP detection" | We don't communicate WSL→Windows. |
| "Windows Defender Firewall blocks port 3001" | Not a problem for WSL2 localhost forwarding (uses a kernel pipe, not LAN). And our port is 3030, not 3001. |
| "Streaming TTS to fix lip-sync lag" | The 2–3s TTS delay is between *Claude's response and ChatVRM's character voice*, not between *hook events and buddy emotes*. Hook reactions are sub-100ms (verified earlier in the session). Streaming TTS is out of scope here. |

### 11. `next dev` silently exits on `/mnt/d/` (Windows DrvFs/9p)

**Root cause** (traced 2026-04-26): Next.js 13.2.4's `projectFolderWatcher` (line ~526 of `node_modules/next/dist/cli/next-dev.js`) watches the **parent** of the project root via watchpack. On `/mnt/d/` (Windows DrvFs, 9p protocol), watchpack receives spurious "aggregated" events. The handler calls `findPagesDir()` which fails or returns falsy on 9p, then silently calls `process.exit(0)`.

Visible symptom: `next dev` prints `ready - started server on 0.0.0.0:3000` then `[?25h` (cursor restore), then exits with status 0. The exit happens ~9 seconds after "ready". The `[?25h` was previously misdiagnosed as TTY/signal issues — it is not.

**Fix**: `scripts/start-dev.sh` detects `/mnt/d/` and automatically rsyncs to `~/lumina-runtime/` before starting. No user action needed; this is transparent.

**What does NOT fix it**: `nohup`, `setsid`, `tmux`, fake-PTY via `script(1)`, real PTY via Python — all fail because the issue is 9p inotify, not stdio. `next build` has a separate but related `/mnt/d/` failure (Bus error from mmap on DrvFs); same fix applies.

---

## What you should actually monitor

- `[buddy-bridge] listening on http://127.0.0.1:3030` printed in the up.sh terminal — bridge alive
- DevTools → Network tab → `events` request stays in pending state with periodic data lines — SSE healthy
- `[buddy] connected to ...` in browser console — client subscribed
- `curl -s http://127.0.0.1:3030/health` returns `{"ok":true,"listeners":N}` where N ≥ 1 when ChatVRM is open

If all four of those are true and reactions still don't fire, the problem is in `REACTIONS` mapping, not infrastructure.
