# Achievements

Counter-driven unlocks derived from the same buddy event stream that drives reactions. Pure client-side: no bridge involvement, no server state, no API. State lives in `localStorage["lumina.achievements"]`.

## Where the code lives

| File | Role |
|------|------|
| `src/web/src/features/achievements/achievements.ts` | Definitions, counter logic, threshold checks, localStorage round-trip — all pure functions. |
| `src/web/src/components/achievementToast.tsx` | Gold-bordered top-center notification, auto-dismisses after 5 s, click-to-dismiss-early. |
| `src/web/src/pages/index.tsx` | Wires `feedEvent` into the buddy event stream via `connectBuddyEvents`'s `onAfterApply` callback; renders the toast. |
| `src/web/src/features/buddyEvents/buddyEvents.ts` | Exports `detectGit` and `detectLanguage` so achievements reuse the same parsing logic. |

## Default achievements (10)

| Icon | Name | Counter | Threshold |
|------|------|---------|-----------|
| 👋 | 初次見面 | `sessions` | 1 |
| 🌱 | 第一個 commit | `git_commits` | 1 |
| 🚀 | 送上線 | `git_pushes` | 1 |
| 🏅 | Git 達人 | `git_commits` | 50 |
| 🦉 | 深夜貓頭鷹 | `late_night_pushes` (push between 00–04) | 1 |
| 🔍 | Bug 獵人 | `fix_commits` (commit message matches `fix\|bug\|patch\|hotfix\|repair\|resolve`) | 10 |
| 🔧 | 工具大師 | `tool_uses` (any PostToolUse) | 100 |
| 🐍 | Python 愛好者 | `python_edits` | 20 |
| 🦀 | Rust 戰士 | `rust_edits` | 20 |
| 🔷 | TS 原住民 | `typescript_edits` | 50 |

## Adding an achievement

1. Append a new `AchievementDef` to `ACHIEVEMENTS` in `achievements.ts` with a unique `id`, a counter key, threshold, icon (single emoji), and description.
2. If your achievement uses a counter that doesn't exist yet, add a branch in `bumpCounters` that increments it on the right event(s). Reuse `detectGit(evt)` and `detectLanguage(evt)` for parsed event metadata.
3. That's it — the threshold check runs over every counter mutation; the toast renders on first crossing.

Example: an achievement for opening 100 files via `Read`:

```ts
// In ACHIEVEMENTS:
{
  id: "speed_reader",
  name: "速讀王",
  description: "讀取 100 個檔案",
  icon: "📚",
  counterKey: "reads",
  threshold: 100,
},

// In bumpCounters, inside the PostToolUse branch:
if (evt.tool === "Read") bump("reads");
```

## Persistence behavior

- **Schema versioned** (`SCHEMA_VERSION = 1`). On version mismatch, `loadState` returns a fresh empty state — no migrations attempted. Bump the version when you change counter semantics.
- **Write strategy**: every unlock writes immediately. Plain counter ticks write every 10 events to limit localStorage write pressure during bursts of `PostToolUse` (a single Claude session can fire 100+ events).
- **Reset**: `reset()` exported from the module, or just `localStorage.removeItem("lumina.achievements")` from DevTools.

## Why client-side, not in the bridge

Bridge stays a dumb event relay. Putting achievement state in the bridge would:
- Couple the bridge to a feature that's purely cosmetic for the user
- Break the "bridge survives Next.js dev-server restarts" invariant (achievement state would survive too long, missing events the user would want counted on the original session)
- Add a write surface that races between the bridge writing config and the user inspecting it

Achievement state is per-user-per-browser-profile (where the user actually sees the unlocks); localStorage is the right home.

## Multi-tab behavior

Currently no cross-tab sync (unlike model/personality selection). If you have two ChatVRM tabs open and Claude Code fires an event, both tabs increment their own copy independently — the user might see the same unlock toast twice. Acceptable cost for the simpler model; if it becomes a problem, add a `storage`-event listener (same pattern as `modelSelector.tsx`) and merge counters by max value.

## Out of scope (deliberately)

- **3D mesh accessories on the avatar.** Would require an accessory-mounting system that doesn't exist in `@pixiv/three-vrm`'s API. Animation-only emote/expression layer covers the user-visible "unlock" feel without asset dependencies.
- **Twitter / X share buttons.** Premature pre-launch and adds a third-party endpoint dependency.
- **Achievement wall in Settings.** `Menu.tsx` is upstream-complex; toast covers MVP feedback. The state is queryable from DevTools (`JSON.parse(localStorage["lumina.achievements"])`) if you want to inspect it.
- **Hidden Easter eggs from chat input** (e.g., "我想放棄" → unlock). Different code path through `handleSendChat`, not the hook stream. Separate feature when warranted.
