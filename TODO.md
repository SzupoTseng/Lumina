# TODO

Items deliberately NOT built during the v0.1 development arc, organized
by why. Recorded so future contributors can see the engineering judgment
without spelunking commit history. **Not all of these should be built**
— several are explicit decisions to keep the codebase honest and small.

If you disagree with one, open an issue first; don't open a PR until the
design conversation has happened.

---

## Open known issues (real follow-ups)

| # | Issue | Tracked since |
|---|-------|---------------|
| 1 | `@pixiv/three-vrm-core@1.0.9` ships incomplete `.d.ts` files on npm. Bypassed with `typescript.ignoreBuildErrors: true` in `next.config.js`. Should be resolved by upgrading `@pixiv/three-vrm` 1.x → 3.x, but the API change touches `features/vrmViewer`, `emoteController`, `lipSync`. | Task #7 |
| 2 | Building from `/mnt/d/` (Windows-mounted drive) under WSL2 produces corrupt JSON in `node_modules/language-subtag-registry/` and `Bus error (core dumped)` during `next build`. Move project to native WSL FS for production builds. | Task #6 |
| 3 | Reaction lines (`REACTIONS`, `LANGUAGE_REACTIONS`, `GIT_REACTIONS`, `TOOL_RESULT_REACTIONS`) are still Chinese-only. The i18n table is wired to accept `en` / `ja` translations; the strings just haven't been translated yet. | new |
| 4 | Test coverage % parsing — extending `detectToolResult` to capture `Coverage: XX%` from pytest/jest/cargo/go-test output. ~30 LOC. Useful demo signal. | new |

---

## Deliberately rejected — architecture / dependencies

These were proposed (often multiple times) and rejected for stated
engineering reasons. Reopening any of these requires a written rationale
that addresses the original objection.

| Proposal | Why rejected |
|----------|--------------|
| Express + ws + body-parser as the bridge stack | Zero-dep `node:http` + SSE delivers the same contract in ~110 lines with no transitive supply-chain surface. EventSource has built-in browser reconnect. SSE wins for unidirectional event streams. |
| `buddy-config.json` filesystem state | localStorage + cross-tab `storage` event already provides this with no write-race risk. Filesystem state would need an API write surface, schema versioning, and break "selections live where the user sees them" invariant. **Rejected ~15 times across the session.** |
| `CLAUDE.md` curl protocol for emitting status events | CLAUDE.md is prose context the model reads, not a hook configuration. `.claude/settings.json` hooks fire deterministically with zero token cost. Prose protocols are non-deterministic, get diluted/dropped by compaction. |
| `get-host-ip.sh` (cat /etc/resolv.conf) for WSL→Windows IP | Wrong direction — Lumina's bridge runs in WSL; the browser reaches it via WSL2's localhost forwarding. We never initiate WSL→Windows traffic. |
| Windows Firewall rule (`New-NetFirewallRule`) for port 3001/3030 | Security regression — bridge has no auth; opening LAN port = anyone on Wi-Fi can drive the buddy. Also unnecessary: WSL2 localhost forwarding is a kernel pipe, not LAN traffic. |
| `setup-and-run.js` Node-based interactive installer | `scripts/up.sh` + `start-Lumina.bat` already cover the launcher path with sanity checks and cleanup traps. Adding a Node layer with `enquirer`/`inquirer` deps duplicates what bash already does cleanly. |
| `scan-models.js` writing `src/models-config.json` | `pages/api/models.ts` reads `public/models/` per request — drop a `.vrm`, refresh, it's there. Build-time scanning would couple the model list to the build artifact. |
| `concurrently` + `predev` script | `.vscode/tasks.json` `runOn: folderOpen` already starts both services. `up.sh` handles non-VS-Code use. Adding `concurrently` is a third mechanism with its own dep weight. |
| `react-i18next` + `i18next` | At Lumina's UI string scale (~30 keys) the library would drag in ~50 transitive packages. The custom `useT()` hook in `features/i18n/i18n.ts` provides the same UX in 80 LOC. |
| `react-markdown` + syntax highlighter for the speech bubble | ~70 KB gzipped + ~50 transitive packages for cosmetic gain on 5–15 character status lines. Emoji prefixes deliver the visual signal. |
| `EffectComposer` / `BloomPass` / `SMAA` / `postprocessing` | Adds the `postprocessing` npm dep + multiple GPU shader passes for a project whose visual layer is intentionally pure DOM/CSS. |
| New parallel `SpeechBubble.tsx` component | `AssistantText` already exists upstream and renders `assistantMessage`. A parallel bubble would race for the same overlay text. |
| MCP server / "V-Map Protocol" — Claude deliberately calls avatar tools | Strictly worse than hook-driven for ambient feedback. Wastes tokens, requires system-prompt opt-in, dilutes model attention. Hooks are passive observation; MCP is for tools the model deliberately invokes. Different problem class. |
| `SceneController.ts` central scene controller | Duplicates the slash-routing already in `pages/index.tsx` + `features/slashRoute/`. Adds an abstraction layer with no new behavior. |
| GPU instanced particle systems via Three.js (`THREE.Points` + custom Shader) | Touches the VRM rendering scene — high risk of breaking upstream. Our DOM/CSS particles are GPU-composited by the browser and cost ~0% CPU. |
| Vertex glitch shader on the VRM model | High-risk modification of the upstream rendering path. Could cause permanent visual corruption, looking like a render bug rather than an effect. |
| Auto-detect battery mode (Battery API) | `navigator.getBattery()` is deprecated/restricted in Chrome and Firefox for privacy reasons. Don't rely on it. |
| FPS cap on the VRM scene | Browser auto-throttles `requestAnimationFrame` on hidden tabs. Three.js update loop already pauses correctly. Adding manual time-based gating touches upstream `viewer.ts` for marginal win. |
| Auto-pause rAF on 60s idle | Browser already handles this on hidden tabs. Active-tab idle detection adds complexity. |
| `lumina start` global CLI via `npm publish` | Real distribution commitment (versioning, breaking-change policy). Premature pre-launch. |

---

## Deliberately rejected — copyrighted IP

Every visual or naming reference to copyrighted media was declined for
DMCA / trademark risk. Lumina ships **IP-safe abstractions** of the same
emotional beats — generic vignettes, particles, scanlines, and bland
bubble lines that a personality JSON can override on a private fork.

| Reference | Owner | Lumina-safe equivalent that ships |
|-----------|-------|-----------------------------------|
| Dragon Ball "Super Saiyan" / 超級賽亞人 | Shueisha / Toei | `energy_gather` overlay, `🔥 集中精神中…` |
| Naruto "Sharingan" / 寫輪眼 | Shueisha | `triumph` overlay, `🔍 仔細看每一行。` |
| Marvel/Disney "Thanos snap" | Disney | `crisis` overlay, `💥 移除中…` |
| Warner "Matrix code rain" | Warner | `triumph` overlay, `🔎 找找看…` |
| Khara "Evangelion sync 400% / NERV" | Khara | `energy_gather`, `🌐 啟動中…` |
| Square Enix "FMA transmutation circle" | Square Enix | `triumph`, `🔧 重構這段邏輯。` |
| Shogakukan "Detective Conan" | Shogakukan | `triumph`, `💡 來推理一下。` |
| Houbunsha "Bocchi glitch dissolve" | Houbunsha | `crisis` overlay, no shader |
| Shueisha "JJK domain expansion" | Shueisha | (no equivalent shipped) |
| Lucasfilm "Force lift / May the Force..." | Disney/Lucasfilm | `triumph` |
| Skydance "Terminator I'll be back / red eye" | Skydance | `energy_gather` |
| Warner "Inception folding city" | Warner | `flash` |
| DC "Batman bat-signal logo" | DC/Warner | (utility commands silent by design) |
| Paramount "Forrest Gump running" | Paramount | `flash` |
| Death Note "計画通り / Keikaku doori" | Shueisha | `triumph` ("一切都在計畫之中") |
| AoT "Sasageyo / 獻出心臟" salute | Kodansha | (covered by `agentMonitor` warnings) |

To use the IP-named flavor on a private fork, edit
`public/personalities/<id>.json`:

```jsonc
{
  "reactions": {
    "git.push": "🔥 SUPER SAIYAN PUSH ENERGY!"
  }
}
```

Public repo never ships those quotes. Private forks are the user's risk.

---

## Premature / YAGNI — defer until traction

These would be reasonable to build at some point but were rejected as
premature for v0.1 (pre-launch). Build them when there's evidence of
demand from real users.

- **Onboarding wizard** — ChatVRM's existing Introduction modal handles
  first-run. Adding a separate Lumina wizard duplicates UX surface.
- **Settings backup/export to file** — Chrome Sync, browser profile
  copying, and DevTools localStorage copy already provide migration.
  Building a custom export format is a maintenance burden (versioning,
  encryption-or-not bikeshedding) for marginal value.
- **"Test connection" button in settings** — log signals are
  sufficient (`up.sh` terminal, browser console `[buddy] connected`,
  `curl /health`).
- **GitHub Actions CI matrix (`.github/workflows/ci.yml`)** — only
  worth setting up after external contributors arrive.
- **Issue templates (`.github/ISSUE_TEMPLATE/`)** — write them when
  the repo is public and bug reports start flowing.
- **Twitter share button on achievement unlock** — adds third-party
  endpoint dependency; `#growth-hack` patterns get downranked on
  Reddit/HN.
- **"Persona marketplace" / community scene packs** — premature
  community infrastructure before there's a community.
- **Achievement wall in Settings** — toast covers MVP feedback. State
  is queryable from DevTools today.
- **3D character animation on settings change** — gimmicky overhead
  for cosmetic value.
- **Hidden Easter egg detection from chat input** ("永不言棄" → unlock) —
  different code path through `handleSendChat`, not the hook stream.
- **5+ additional preinstalled personalities** — three samples are
  enough to demonstrate the pattern; more is dilution before any user
  has tried any.
- **"Lumina Control Center" panel renaming** — "Settings" / "設定" is
  honest and less marketing-y. The user can rename on a fork.

---

## Cool ideas that don't fit our hook surface

These were proposed but cannot be implemented without infrastructure
beyond Claude Code's hook system. Each would be a separate sub-project.

- **Cursor eye-tracking** — would need a VS Code extension reporting
  cursor position to the bridge, plus screen-coordinate → 3D lookAt
  mapping. Significant scope (extension publishing pipeline, layout
  assumptions about pane positions).
- **Variable watch "puppet"** (right-click in editor → buddy holds the
  value) — same VS Code extension requirement, plus Three.js text
  geometry rendering pipeline.
- **Hallucination text detection** ("I apologize", repeated phrases) —
  chat-response text isn't in hook events. Would require harness
  modification or wrapping the `claude` CLI.
- **"STOP AI" panic button → SIGINT to Claude** — bridge can't signal
  Claude's process; would need OS-level ptrace or a wrapper script
  around `claude`.
- **Token cost / API spend tracking** — Claude Code's hooks don't
  expose API token counts in events.
- **Real cyclomatic complexity** → avatar weight — needs per-language
  analyzers (radon, complexity-report, gocyclo, lizard) running per
  edit. Heavy and per-language.
- **Editor-overlay coverage heatmap** on lines of code — needs editor
  extension; outside the buddy's display scope.
- **Latent state prediction / token-bucket predictor** — requires
  streaming access to Claude's response tokens, which hooks don't
  expose.
- **NVIDIA ACE Audio2Face** / HeyGen-style emotion-from-voice —
  different product class; cloud TTS round-trip + lip-sync model.
- **Cross-platform identity** (Ready Player Me sync) — needs a
  backend account system.
- **VR/AR support** (Apple Vision Pro / Quest) — different rendering
  pipeline.
- **Physical hardware buddy** (ESP32, mechanical arm) — separate
  product.

---

## Small additions worth ~1 hour each

If you want low-cost incremental wins post-launch:

- **Test coverage % parsing** in `detectToolResult` (~30 LOC). Honest
  signal, demoable.
- **`buildPerf` module** tracking `tsc`/`cargo build` durations,
  alerting on regressions.
- **Bash command re-run loop detection** in `agentMonitor` (Claude
  rerunning the same test 5+ times in 10 min).
- **Linter-error count delta** between consecutive `eslint`/`tsc` runs
  (`⬇ 12 errors gone` / `⬆ 5 new errors`).
- **Weekly digest** (`weeklyDigest(state, now)` in `memoryStream.ts`,
  ~35 LOC, surfaced on Friday `SessionStart`).
- **Letterbox / cinema bars** CSS effect during triumph/crisis
  overlays — generic, no IP, ~30 LOC.
- **Bug-shooter mini-game** as DOM overlay on test_fail — ~70 LOC,
  shareable demo footage.
- **Translation of reaction lines** to en / ja — pure data work.

---

## Operating principles (don't violate without writing why)

These principles emerged from the v0.1 build and shaped many of the
above rejections. Treat them as the project's invariants.

1. **Per-user state lives in `localStorage`**, not the filesystem. The
   bridge stays a dumb relay. Cross-tab sync via the `storage` event.
2. **Hooks > prompts** for ambient observation. CLAUDE.md is context,
   not a hook config.
3. **Zero npm deps in the bridge layer.** `node:http` only.
4. **DOM/CSS overlays > Three.js scene mutation** for visual effects.
   Scene mutation risks upstream rendering breakage.
5. **No copyrighted IP in the public repo.** IP-safe abstractions ship;
   personality JSONs let users add flavor on private forks.
6. **Hooks must always exit 0.** Non-zero in `PreToolUse` blocks
   Claude's tool execution.
7. **One source of truth per axis.** Reactions live in one map,
   personalities in one folder, power tuning in one table.
8. **Don't add features without a real signal of demand.** "Could be
   built" is not "should be built."
