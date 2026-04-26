# Contributing to Lumina

Thanks for your interest. Lumina is intentionally small — pick one thing, do it well, ship a PR. The four sections below cover the realistic contribution surfaces in order of friction (lowest first).

---

## 1. Add a personality (lowest friction — 5 minutes)

The personality system is the easiest place to land a first PR. Each personality is **one JSON file** under `src/web/public/personalities/`. No code changes, no build step.

**Schema** (full reference in [`docs/personalities.md`](docs/personalities.md)):

```jsonc
{
  "id": "your_id",                  // optional; defaults to filename stem
  "name": "顯示名稱 / Display Name", // required
  "systemPrompt": "...",             // required; pre-fills chat system prompt
  "defaultEmotion": "neutral",       // optional; one of:
                                     //   neutral | happy | angry | sad | relaxed
                                     //   (VRM 1.0 names; "joy"/"sorrow"/"fun"/"relax"
                                     //    are VRM 0.x and will be silently ignored)
  "reactions": {                     // optional; line overrides keyed by:
    "Stop":         "...",           //   bare event name
    "tool.Edit":    "...",           //   tool.<name>
    "lang.python":  "..."            //   lang.<id> — highest priority
  }
}
```

### Working example — Sarcastic Reviewer

`src/web/public/personalities/sarcastic.json`:

```jsonc
{
  "id": "sarcastic",
  "name": "毒舌審核官 / Sarcastic Reviewer",
  "systemPrompt": "你是極度挑剔的資深開發者，回應簡短、刻薄、技術正確。看到問題會說『這種 code 也能跑？』。情緒標記用 [angry] / [sad] / [neutral]。",
  "defaultEmotion": "angry",
  "reactions": {
    "Stop":        "🙄 …能跑就行了，你開心就好。",
    "tool.Edit":   "🙄 又改？上次的版本錯在哪你還沒搞清楚吧。",
    "lang.python": "🐍 動態型別。一看就知道你愛偷懶。"
  }
}
```

Drop the file, refresh the tab, pick it from the **PERSONA** dropdown.

### Tips that actually matter

- **Keep `systemPrompt` short** — under 300 characters. Long prompts dilute Claude's attention to the user's real task.
- **Use the inline emotion tags ChatVRM already supports** — `[happy]`, `[sad]`, etc. — in your `systemPrompt`. They tell Claude *when* to switch emotion within a single response.
- **Reaction lines should be 1–10 characters** of visible Chinese/English plus an emoji prefix. They show in the speech bubble for 4 seconds; long lines truncate visually.
- **Test the full path** — drop the file, refresh, switch to your personality, run `claude` in another terminal, type a prompt, watch the bubble + emote.

### Naming a PR

`[persona] add <id>: <one-line tagline>` — e.g. `[persona] add sarcastic: 毒舌 reviewer`.

Include in the PR description: any recommended VRM models that pair well, and the license those models are under (so users can find them legitimately).

---

## 2. Add a language (next-lowest friction — 30 minutes)

To add a language to the language-aware reaction layer:

1. Add extension(s) to `LANGUAGE_BY_EXT` in `src/web/src/features/buddyEvents/buddyEvents.ts`. Lower-case keys, leading dot.
2. Add an entry to `LANGUAGE_REACTIONS` in the same file. Use the VRM 1.0 emotion presets only.
3. Update the `personalities.md` "supported languages" list.

Done in one commit. Test by editing a file with that extension during a Claude Code session — the buddy should pick it up via `PostToolUse.context.tool_input.file_path`.

---

## 3. Code PRs

Architecture is documented in [`docs/architecture.md`](docs/architecture.md). Read it before opening a PR that touches the bridge, the hook adapter, or the SSE wiring — the design has been examined and a few common refactors have been deliberately rejected with reasoning recorded in [`docs/bridge-modes.md`](docs/bridge-modes.md), [`docs/edge-cases.md`](docs/edge-cases.md), and [`docs/bootstrap-prompts.md`](docs/bootstrap-prompts.md).

**Before opening a PR:**

- Run `./scripts/up.sh`, send at least one Claude prompt, confirm the buddy reacts. PRs that don't run end-to-end will be asked to.
- Type-check passes are not enforced (`typescript.ignoreBuildErrors` is set due to the upstream `@pixiv/three-vrm-core@1.0.9` packaging defect — see [`docs/upstream-baseline.md`](docs/upstream-baseline.md)). If your PR upgrades `three-vrm` to 3.x and removes the bypass, that's a wholly welcome change.
- No new npm dependencies in the bridge layer. Bridge is `node:http` only by design.

**Architectural choices we don't accept:**

- Replacing the SSE bridge with Express + ws + body-parser. Decoupling, zero-deps, and CORS simplicity argued for in [`docs/bridge-modes.md`](docs/bridge-modes.md).
- Adding a `buddy-config.json` (or any filesystem config) for selections. Selections live in browser `localStorage` with `storage`-event cross-tab sync.
- Adding curl protocols to `CLAUDE.md` to drive Claude into emitting status events. Hooks via `.claude/settings.json` are the only deterministic mechanism.
- Adding firewall rules to `start-Lumina.bat`. WSL2 localhost forwarding handles browser→WSL traffic without any LAN exposure.

If you want to challenge any of these, open an issue first — don't open a PR until the design conversation has happened.

---

## 4. Documentation

The `docs/` folder is markdown only, grouped by topic. Decisions go in `docs/decisions/NNNN-short-title.md` (sequential). Don't duplicate content — cross-link instead.

For translations, the convention is `<original>.zh-TW.md`, `<original>.ja.md`, etc. — see `README.md` ↔ `README.zh-TW.md` for the cross-link pattern at the top of each file.

---

## License

By contributing, you agree that your contributions are licensed under the MIT License (see [`LICENSE`](LICENSE)).

VRM model files are NEVER committed to this repo, regardless of the author's stated permissions. The `.gitignore` excludes them by default; please don't `git add -f` to override unless you have explicit redistribution rights AND have updated `docs/swap-vrm-model.md` with a clear attribution block.
