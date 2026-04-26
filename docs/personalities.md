# Personalities

Selectable buddy personalities. Each personality is one JSON file under `src/web/public/personalities/`. The API route `pages/api/personalities.ts` discovers them; the `PersonalitySelector` dropdown lists them.

Switching a personality updates two things at once:

1. The **chat system prompt** (`systemPrompt` state in `pages/index.tsx`) — affects how Claude/OpenRouter/etc. roleplay when you talk *to* the buddy via the message input.
2. The **buddy reaction lines** (overlay text from hook events) — overrides the defaults in `LANGUAGE_REACTIONS` and `REACTIONS` per personality.

Selection persists in `localStorage["lumina.selectedPersonality"]`; reloading restores it.

## Schema

```jsonc
{
  "id": "tsundere",                    // optional; defaults to filename stem
  "name": "傲嬌助手",                   // required; shown in dropdown
  "systemPrompt": "...",                // required; pre-fills chat system prompt
  "defaultEmotion": "sad",              // optional; VRM 1.0 preset
                                        //   neutral | happy | angry | sad | relaxed
                                        //   NOTE: "joy"/"sorrow"/"fun"/"relax" are VRM 0.x
                                        //   names and will be silently ignored.
  "reactions": {                        // optional; overrides buddy lines
    "Stop":          "...",             // event-level
    "tool.Edit":     "...",             // tool-level (overrides Stop if event is PostToolUse w/ Edit)
    "lang.python":   "..."              // language-level (highest priority within the personality)
  }
}
```

Reaction key shapes:

| Key prefix | Matches when | Example |
|------------|-------------|---------|
| (bare event name) | `evt.type === "Stop"` | `"Stop"` |
| `tool.<name>` | `evt.tool === "Edit"` for any event | `"tool.Edit"` |
| `lang.<id>` | file extension resolves to that language | `"lang.python"` |
| `git.<op>` | Bash event whose command starts with `git <op>` | `"git.push"` |
| `result.<sub>` | Bash event whose output parsed as a test/build/lint result | `"result.test_pass"` (also `test_fail`, `build_pass`, `build_fail`, `lint_pass`, `lint_warn`) |

## Resolution priority

Per buddy event, in order (last match wins per axis):

**Emotion**: base `REACTIONS[type].emotion` → `LANGUAGE_REACTIONS[lang].emotion` → `GIT_REACTIONS[op].emotion` → `TOOL_RESULT_REACTIONS[result_key].emotion` → `personality.defaultEmotion` (skipped when language/git/result carry semantic intent — those beat a generic default).

**Line**: base `REACTIONS[type].line` → `REACTIONS[type].toolLines[evt.tool]` → `LANGUAGE_REACTIONS[lang].line` → `GIT_REACTIONS[op].line` (with branch / commit-message interpolation, conflict overrides) → `TOOL_RESULT_REACTIONS[result_key].line` (with pass/fail counts, durations) → personality reaction (`result.<sub>` → `git.<op>` → `lang.<id>` → `tool.<name>` → bare event name).

## Adding a personality

1. Drop a new `<id>.json` into `src/web/public/personalities/`.
2. Refresh the tab.

That's it. No build step. The dropdown lists it on next page load.

## Adding more reaction keys

The full list of keys the system understands today:

| Bare event names | Tool keys | Language keys |
|------------------|-----------|---------------|
| `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Notification`, `Stop` | `tool.Bash`, `tool.Edit`, `tool.Write`, `tool.NotebookEdit`, `tool.Read`, `tool.Grep`, `tool.Glob` | `lang.python`, `lang.cpp`, `lang.rust`, `lang.typescript`, `lang.javascript`, `lang.go`, `lang.java`, `lang.ruby`, `lang.shell`, `lang.sql`, `lang.markdown`, `lang.json`, `lang.yaml` |

Personalities can leave any of these unset; the next layer down handles the fallback.

## Notes

- **Personality switches do not reconnect the SSE bridge.** `buddyEvents` reads the current personality from a ref on each event, so switching is instant.
- **Switching also updates the chat system prompt** in `pages/index.tsx`. ChatVRM's existing settings panel still shows the prompt — the user can further edit it after a personality is applied.
- **Cross-tab sync.** Selectors listen on `window.addEventListener("storage", ...)`. Pick a personality in tab A → tab B picks up the change automatically (browser fires `storage` only in *other* tabs, no infinite loop). Same for the model selector. No bridge / config-file / WebSocket round-trip — it's a localStorage-driven primitive.
- **VRM preset name pitfall**: VRM 0.x uses `Joy/Sorrow/Fun/Angry/Neutral`. ChatVRM's `EmotionType` is the VRM 1.0 lowercase set: `neutral|happy|angry|sad|relaxed`. The personality system enforces VRM 1.0 — `defaultEmotion: "joy"` will silently no-op via the `expressionController`.
