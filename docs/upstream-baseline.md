# Upstream Baseline

The contents of `src/web/` were seeded from the open-source **ChatVRM** project as a working baseline. Lumina will diverge from here.

## Provenance

| Field | Value |
|-------|-------|
| Upstream repo | https://github.com/zoan37/ChatVRM |
| Upstream lineage | zoan37/ChatVRM ← zoan37/ChatVRM-jp ← pixiv/ChatVRM |
| Cloned commit | `931505fddae9a133e1f5f6b42373f7c06963a635` (subject: "ipfs") |
| Cloned branch | `main` |
| Clone date | 2026-04-25 |
| License | MIT — Copyright (c) 2023 pixiv Inc. |
| Live demo | https://chat-vrm-window.vercel.app/ |

The upstream `.git` directory was removed after clone; the SHA above is the only link back. To diff against upstream, fetch a fresh clone elsewhere and compare against this snapshot.

## What's in `src/web/`

Next.js 13 + TypeScript + Tailwind app. Layout (high level):

- `src/pages/` — Next.js routes. `index.tsx` is the single-page UI; `api/chat.ts`, `api/tts.ts`, `api/refresh-token.ts` are server routes.
- `src/features/` — domain logic: `vrmViewer` (Three.js + @pixiv/three-vrm scene), `chat` (LLM call orchestration), `messages` (prompt/turn shaping), `elevenlabs` (TTS), `lipSync` (audio analysis → mouth blendshapes), `emoteController` (emotion → expression mapping), `constants`.
- `src/components/` — React UI (settings panel, message log, mic button, VRM canvas mount).
- `src/services/` — external integrations: Restream WebSocket listener, OAuth token refresh.
- `src/lib/`, `src/utils/`, `src/styles/` — shared helpers and Tailwind/global CSS.
- `public/idle_loop.vrma` — default idle animation (VRMA format).

## External services the baseline talks to

- **OpenRouter** (LLM, swappable for OpenAI) — used by `api/chat.ts`.
- **ElevenLabs** (TTS) — primary voice. Koeiro / OpenAI TTS paths also exist in features.
- **Web Speech API** (browser STT) — no server component.
- **Restream** (livestream chat ingestion) — optional, via `services/websocketService.ts`.

API keys are entered in the UI and stored in browser localStorage; nothing is committed.

## What we plan to keep vs replace

_TBD — fill in as decisions are made. Use `docs/decisions/NNNN-*.md` for anything load-bearing._

Open questions to resolve before deep customization:
- Keep Next.js Pages Router or migrate to App Router?
- Keep ElevenLabs as default TTS or swap to a self-hosted engine?
- Strip Restream/livestream features, or keep as optional module?
- Rename package (`chat-vrm` → `lumina`) and rebrand UI strings.
