# Changelog

All notable changes to Lumina. This project follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- ASCII logo in `README.md` and `README.zh-TW.md`.
- This `CHANGELOG.md`.

## [0.1.0] — pre-launch (2026-04)

The initial development arc, organized by feature area. No git history yet
— v0.1.0 is the first commit-worthy state, captured here so the next
contributor sees the shape of the system without spelunking the diff.

### Hook substrate (the deep-integration core)

- `scripts/buddy-bridge.mjs` — zero-dep SSE relay (`POST /event`, `GET /events`,
  `GET /health`, 64 KB body cap, 15 s keepalive, graceful shutdown). Bound
  to `127.0.0.1` only. ~110 lines, `node:http` only.
- `scripts/buddy-hook.sh` — Claude Code hook adapter. Reads JSON from stdin,
  lifts `tool_name` and `session_id` (no jq dep), forwards via 1 s-capped
  curl. **Always exits 0** — non-zero in `PreToolUse` blocks Claude's tool
  execution.
- `.claude/settings.json` — wires `SessionStart`, `SessionEnd`,
  `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Notification`, `Stop`
  to the adapter. PostToolUse matcher includes `Bash | Edit | Write |
  NotebookEdit | Read | Grep | Glob | TaskCreate | TaskUpdate | TaskList`.

### Reaction core

- `src/web/src/features/buddyEvents/buddyEvents.ts` — EventSource client
  with auto-reconnect (5 s explicit backoff) and a 5-layer reaction
  resolution chain:
  1. base `REACTIONS[evt.type]` — emote + line per event type
  2. tool override (`reaction.toolLines[evt.tool]`)
  3. language override (`LANGUAGE_REACTIONS[lang]`) from file extension
  4. git override (`GIT_REACTIONS[op]`) with branch/message interpolation
     and merge/rebase conflict detection
  5. tool-result override (`TOOL_RESULT_REACTIONS[result_key]`) parsing
     pytest/jest/vitest/cargo/go test summaries plus tsc/cargo build
     errors and eslint/ruff lint warnings
  6. personality override at the deepest layer (`git.<op>` →
     `lang.<id>` → `tool.<name>` → bare event name)

### Visual overlays (DOM/CSS, no Three.js scene mutation)

- `EnergyGathering` — cyan particle swarm during long bash tasks (npm/yarn/pnpm
  install, pip install, cargo build, docker build, terraform apply,
  kubectl apply, helm install, mvn package, apt/brew install). Triggered
  on `PreToolUse` matching `isLongTaskCommand`, cleared on matching
  `PostToolUse` or 60 s safety timeout.
- `TriumphMoment` — dark vignette + warm radial spotlight on big clean
  test pass (passed ≥ 10).
- `CrisisGlitch` — chromatic-aberration screen edges + scanlines on
  high-severity `agentMonitor` alerts. Periphery only — avatar itself
  never visually corrupts.
- `AchievementToast` — gold-bordered top-center notification on unlock.

### Derived state systems

- `features/achievements/` — 10 starter achievements counting sessions,
  git activity, tool use, per-language editing. localStorage-persisted,
  schema-versioned, 10-tick batched writes.
- `features/agentMonitor/` — three "anti-hype" detectors: edit loops
  (3+ edits to same file in 60 s), edit reversions (palindromic edit
  pairs), dangerous commands (`rm -rf /`, force-push to main, `DROP
  TABLE`, `mkfs`, `dd of=/dev/`, `chmod 777 -R`, `sudo rm`, fork bomb).
  8 s cooldown between alerts. In-memory only.
- `features/memoryStream/` — append-only log of significant events
  (capped at 200). On `SessionStart`, `pickReminiscence` surfaces a
  positive memory from the last 7 days as the welcome line.
- `features/taskTracker/` — listens to `PostToolUse` for `TaskCreate` /
  `TaskUpdate` / `TaskList`. Renders structured task list panel
  top-right with status glyphs (○ pending / ◐ in_progress / ● completed).
- `features/powerMode/` — Eco / Balanced / Ultra profile. Eco skips
  overlay activation entirely; Ultra doubles particle count and
  lengthens overlay durations. `POWER_TUNING` table is the single
  retuning surface.

### Selectors + i18n

- Unified `SettingsPanel` (top-right glassmorphic) holds all four
  Lumina-scope controls: Buddy (model), Persona (personality), Power
  (eco/balanced/ultra), Language (zh-TW/en/ja). Collapsible to a single
  ⚙ icon; collapse state persists.
- Auto-discovery via `pages/api/models.ts` (scans `public/models/` and
  root `public/`) and `pages/api/personalities.ts` (scans
  `public/personalities/*.json`).
- `features/i18n/i18n.ts` — dep-free localization for ~17 UI keys in
  zh-TW / en / ja. `useSyncExternalStore` subscriber pattern; storage
  event cross-tab sync.
- All selectors localStorage-persisted (`lumina.selectedVrmModel`,
  `lumina.selectedPersonality`, `lumina.powerMode`, `lumina.locale`,
  `lumina.settingsPanel.collapsed`) with cross-tab `storage` events.

### Slash-command routing

- `features/slashRoute/` — 11 command families routed to the four
  IP-safe overlay kinds (energy_gather / triumph / flash / crisis):
  - `/effort /focus /think /deep`, `/init /setup /bootstrap`,
    `/review /audit /inspect`, `/fix /refactor /rewrite`,
    `/explain /why /walkthrough`, `/test /run /verify`,
    `/compact /clear /tidy`, `/add /new /create`,
    `/bug /error /diagnose /debug`, `/search /find /grep /lookup`,
    `/delete /remove /nuke /destroy /drop`.
- Generic English/dev verbs only — **no anime IP, no copyrighted
  command names or quotes**.
- Untouched: `/help`, `/cost`, `/permissions`, `/exit`, `/release-notes`
  (Claude Code utility commands — silent by design).

### Two architecture modes

- **`split` (default)** — standalone bridge on `:3030`. Decoupled
  from Next.js dev server; survives HMR, restartable independently.
- **`unified`** — bridge endpoints `/api/event` + `/api/events`
  embedded in Next.js api routes via `globalThis`-scoped listener
  set. One process, one port. Trade-off: HMR can drop SSE listeners.
- Toggle via `BUDDY_MODE=split|unified` env var. Tradeoff table in
  `docs/bridge-modes.md`.

### Launchers

- `scripts/up.sh` — single-command starter, sanity-checks Node ≥ 18 +
  port availability, runs `npm install` on first run, polls `/health`
  before starting the dev server. Path-relative. Cleanup trap on
  Ctrl+C / EXIT / TERM.
- `start-Lumina.bat` — Windows launcher. Resolves repo via `wslpath -u`,
  opens VS Code if `code.cmd` is on PATH, runs `up.sh` inside WSL
  with stdio bridged.
- `scripts/start-dev.sh` — dev-server-only launcher used by VS Code's
  `tasks.json` `folderOpen` hook.

### Documentation

- `README.md` (English) + `README.zh-TW.md` (繁體中文) with cross-links
- `LICENSE` — MIT, with explicit ChatVRM upstream attribution
- `CONTRIBUTING.md` — schema-correct personality contribution guide
- `CLAUDE.md` — internal architecture + working rules
- `docs/architecture.md` — runtime topology + event sequence diagrams
- `docs/install-flow.md` — happy path + failure branches
- `docs/bridge-modes.md` — split vs unified
- `docs/edge-cases.md` — 10 real failure modes, severity-classified
- `docs/personalities.md` — schema, override priority, key shapes
- `docs/achievements.md` — 10 starter achievements + extension recipe
- `docs/buddy-bridge.md` — pipeline reference
- `docs/swap-vrm-model.md` — 4 model-swap workflows
- `docs/upstream-baseline.md` — ChatVRM provenance, license, gotchas
- `docs/bootstrap-prompts.md` — 5 sequential prompts to recreate from
  empty directory
- `docs/vscode-setup.md` — one-time VS Code workspace positioning

### Personalities (sample data)

- 傲嬌助手 (`tsundere.json`) — sad default emotion, 9 reaction overrides
- 熱血導師 (`mentor.json`) — happy default, encouraging
- 冷酷黑客 (`goth.json`) — neutral default,极簡 reactions

### Compatibility / known issues

- `@pixiv/three-vrm-core@1.0.9` ships incomplete `.d.ts` files on npm
  (only `types/lookAt/utils/calcAzimuthAltitude.d.ts` is present).
  Workaround: `typescript: { ignoreBuildErrors: true }` in
  `next.config.js`. Tracked as Task #7.
- Building from `/mnt/d/` (Windows-mounted drive) under WSL2 is flaky:
  observed corrupt JSON in `node_modules/language-subtag-registry/`
  and `Bus error (core dumped)` during `next build`. Move to native
  WSL FS for production builds. Tracked as Task #6.

[Unreleased]: https://github.com/example/lumina/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/example/lumina/releases/tag/v0.1.0
