# Buddy Bridge — Claude Code → ChatVRM events

Pipeline:

```
Claude Code  →  hook script  →  POST /event  →  buddy-bridge (SSE)  →  ChatVRM client  →  VRM emote
   (CLI)       (buddy-hook.sh)   (HTTP)        (scripts/buddy-bridge.mjs)   (buddyEvents.ts)
```

## Components

| Layer | File | Role |
|-------|------|------|
| Hook config | `~/.claude/settings.json` (global) | Absolute-path hooks fire for **all** Claude Code sessions on this machine. |
| Hook adapter | `scripts/buddy-hook.sh` | Reads hook JSON from stdin, POSTs compact JSON envelope to bridge. **Must always exit 0.** |
| Bridge | `scripts/buddy-bridge.mjs` | Standalone Node service on `127.0.0.1:3030`. POST broadcasts to SSE. Zero deps. |
| Client | `src/web/src/features/buddyEvents/buddyEvents.ts` | EventSource on `/events`; REACTIONS/GIT_REACTIONS/LANGUAGE_REACTIONS/TOOL_RESULT_REACTIONS all locale-aware. |
| Mount | `src/web/src/pages/index.tsx` | `useEffect` calls `connectBuddyEvents(viewer, { onMessage, onStatusUpdate, onAfterApply })` once viewer is ready. |
| Status poller | `scripts/status-bridge.sh` | Reads ccusage statusline every 5s; posts `StatusUpdate` event with [Task]/[Scope]/[TODO]. |

## Event taxonomy

All events POSTed to the bridge carry: `{ type, ts, tool?, session?, context }`.

| `type` | When fired | Default emote | Default overlay (EN) |
|--------|-----------|---------------|-----------------|
| `SessionStart` | Claude Code starts/resumes a session | `relaxed` | "👋 Claude is here." |
| `SessionEnd` | Session ends | `neutral` | "🌙 See you next time~" |
| `UserPromptSubmit` | You submit a prompt | `neutral` | (silent — slash commands route to cinematic effects) |
| `PreToolUse` | Claude is about to run Bash/Edit/Write/NotebookEdit | `neutral` | "⚙️ Running command…" / "✏️ Editing code…" |
| `PostToolUse` | Tool returned (Bash/Edit/Write/Read) | `happy` | "✅ Command done." / "✅ Edit complete." |
| `Notification` | Permission prompt or other Claude notification | `angry` | "⚠️ Your reply needed!" |
| `Stop` | Claude finished a turn | `relaxed` | "🎉 Done." |
| `StatusUpdate` | ccusage status-bridge.sh polls every 5s | — | shown in StatusPanel; logged to Buddy Log |

All reaction strings are **locale-aware** — `L(zh, en, ja)` is called at event time, not at startup. Switch language in Settings → all future reactions use the new locale immediately.

Reactions are defined in `REACTIONS`, `GIT_REACTIONS`, `LANGUAGE_REACTIONS`, `TOOL_RESULT_REACTIONS` in `src/web/src/features/buddyEvents/buddyEvents.ts`.

### Speech-bubble behavior

Buddy lines display in the existing `AssistantText` bubble (`src/web/src/components/assistantText.tsx`) — same component ChatVRM uses for character utterances. Wiring lives in the `useEffect` keyed on `viewer` in `pages/index.tsx`:

- **Auto-clear**: each buddy line is cleared after 4s, so transient status chatter doesn't linger.
- **Gating**: if `chatProcessing` or `isAISpeaking` is true (Claude mid-utterance), buddy lines are dropped entirely — the character keeps the floor.
- **Implementation note**: gates use refs so the SSE connection isn't torn down on every chat-state change.

If you want a visually distinct buddy bubble (top-corner, neobrutalist, whatever), build a separate component that subscribes to a new state slot — don't fork `AssistantText`. The bridge contract stays the same.

### Language-aware overrides

`PostToolUse` events that touch a file (Edit/Write/Read carry `tool_input.file_path`) get an additional override layer driven by file extension. Resolution order per event:

1. `REACTIONS[evt.type]` — base emotion + line.
2. `reaction.toolLines[evt.tool]` — overrides line if defined.
3. `LANGUAGE_REACTIONS[lang]` — overrides emotion **and** line if extension is recognised.

Detection is purely client-side from `evt.context.tool_input.file_path` — the bridge stays a dumb relay and Claude does not need to tag `lang` manually. Extension table is `LANGUAGE_BY_EXT` in the same file. Currently mapped: python, cpp, javascript, typescript, rust, go, java, ruby, shell, sql, markdown, json, yaml. Add more by editing the two maps; no other layer changes.

## Bridge endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | `{ ok, listeners }` |
| GET | `/events` | Server-Sent Events stream of every broadcast |
| POST | `/event` | Body is JSON; broadcast as-is (with `ts` injected) |

Bound to `127.0.0.1` only. Override with `BUDDY_BRIDGE_PORT` / `BUDDY_BRIDGE_HOST` env vars. Do not expose publicly — there is no auth.

## Verifying end-to-end

```bash
# 1. Start the bridge
node scripts/buddy-bridge.mjs &

# 2. In another terminal, subscribe
curl -sN http://127.0.0.1:3030/events

# 3. From a third terminal, fire a test event the way Claude would
echo '{"tool_name":"Edit","session_id":"test"}' | scripts/buddy-hook.sh PostToolUse

# Subscriber should print:
# data: {"ts":..., "type":"PostToolUse", "tool":"Edit", "session":"test", "context":{...}}
```

If the subscriber gets the event but the VRM doesn't react, open the browser console — `buddyEvents.ts` logs `[buddy] connected to ...` on success and `[buddy] playEmotion failed` if the model isn't loaded yet.

## Extending

- **More tools, finer reactions** — add entries to `REACTIONS` in `buddyEvents.ts`. The `tool` field on every event lets you key off `Read`/`Grep`/`Glob`/`WebFetch`/etc.
- **Spoken reactions** — instead of `setAssistantMessage`, build a `Screenplay` and call `speakCharacter(screenplay, …)` from `features/messages/speakCharacter.ts`. Requires an ElevenLabs / OpenAI key in the ChatVRM settings panel.
- **Conditional reactions** — the full hook context (Claude's tool input + tool result) rides on `evt.context`. E.g. detect `Edit` failures via `context.tool_response.error` and route to `sad` instead of `happy`.
- **External producers** — anything that can `curl POST` is a valid producer. CI failures, git hooks, the nol5 server's log dashboard — all welcome on `/event`.

## Failure modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| Hooks fire but bridge `/health` shows 0 listeners | Browser tab not open / not on `localhost:3000` | Open ChatVRM and check console for `[buddy] connected`. |
| Buddy doesn't react despite events arriving | Viewer/model not yet loaded | Race — buddyEvents will keep reconnecting; emote calls just no-op until model loads. |
| Hooks slow down Claude perceptibly | Bridge unreachable, curl waiting | `buddy-hook.sh` already caps at 1s and never blocks (`exit 0`). If you see slowdown, check `--max-time` and `--connect-timeout` in the script. |
| Port 3030 in use | Another bridge instance, or a conflict | `pkill -f buddy-bridge.mjs` or set `BUDDY_BRIDGE_PORT` and update `buddyEvents.ts` to match. |
