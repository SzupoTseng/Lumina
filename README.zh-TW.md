```
██╗     ██╗   ██╗███╗   ███╗██╗███╗   ██╗ █████╗
██║     ██║   ██║████╗ ████║██║████╗  ██║██╔══██╗
██║     ██║   ██║██╔████╔██║██║██╔██╗ ██║███████║
██║     ██║   ██║██║╚██╔╝██║██║██║╚██╗██║██╔══██║
███████╗╚██████╔╝██║ ╚═╝ ██║██║██║ ╚████║██║  ██║
╚══════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝
        > THE VISUAL LAYER FOR YOUR CODING AGENT <
```

# Lumina

> 在你的 coding agent —— **Claude Code、GitHub Copilot CLI、或 OpenAI Codex CLI** —— 開發時即時做出反應的 3D VRM 桌面伴侶。WSL 或 Windows 原生都能跑。

[English](README.md) &nbsp;·&nbsp; **繁體中文**

![Lumina — coding agents meet VRM buddy](Lumina.png)

把三種 coding-AI CLI 任意一種的 hook 事件接到 3D 角色身上：選 agent、選 runtime、選模型、選人格。當 agent 編 Python 跟編 Rust 時表情不一樣，每次 `Edit`/`Bash` 完成都有對應反應。基於 [ChatVRM](https://github.com/zoan37/ChatVRM)（MIT, pixiv Inc.）並用統一的 hook adapter 把 Claude / Copilot / Codex 三種 stdin 形狀正規化成同一套事件 taxonomy。

## 跟其他「AI 開發伴侶」差在哪

大部分類似專案靠 chat 角色扮演或視覺化編輯器狀態。Lumina 直接接進 **agent 真正的工具執行事件** — 也就是各家 CLI 觸發的 `PreToolUse`/`PostToolUse`/`Stop` 等 callback — 透過一個極小的 SSE relay 傳到 VRM 角色的表情與對話框。角色不是「假裝」在反應，而是讀真實的 wire。

- **三個 agent，同一個角色。** Claude Code、GitHub Copilot CLI、OpenAI Codex CLI 三家都有原生 hook event；單一 adapter（`buddy-hook.{sh,ps1}`）把各家 stdin 形狀正規化成單一 envelope。在啟動時的 6 選 1 設定對話框（3 種 agent × 2 種 runtime — WSL 或 Windows 原生）選一次即可。
- **Hook 驅動，非 prompt 驅動。** 反應 100% 觸發、延遲 < 100ms，與 LLM 是否決定要說都無關。
- **語言敏感。** Edit `app.py` 跟 Edit `lib.rs` 觸發不同的 emote/台詞。映射在單一檔案裡，好 fork。
- **人格系統。** 在 `public/personalities/` 丟一個 JSON 就多一個人格（system prompt + 每事件台詞 override）。內建三種：傲嬌助手、熱血導師、冷酷黑客。
- **兩種架構模式可切換。** Standalone bridge（預設、解耦）或 unified Next.js api routes（單一程序、單一 port）。一個環境變數切換。
- **核心零依賴。** Bridge 是 ~110 行的 `node:http` + SSE。沒有 Express、沒有 `ws`、沒有 `body-parser`。

## 快速開始

需要 **WSL2**（Windows）、**Node 18+**，以及**至少一個** coding-AI CLI：
- [**Claude Code**](https://docs.claude.com/en/docs/claude-code)，或
- [**GitHub Copilot CLI**](https://docs.github.com/en/copilot/how-tos/copilot-cli/install-copilot-cli)（`npm install -g @github/copilot`），或
- [**OpenAI Codex CLI**](https://developers.openai.com/codex/cli)（`npm install -g @openai/codex`）

裝你有 access 的就好（也可以三個都裝、隨時切換）。

### 主要流程 — 雙擊 `LuminaLauncher.exe`

雙擊 `src/launcher/publish/LuminaLauncher.exe`：

1. 彈出設定對話框，**6 選 1** 挑你的專案目錄與 **agent + runtime** 組合：
   - `Claude (WSL)` · `Claude (Windows)`
   - `Copilot (WSL)` · `Copilot (Windows)`
   - `Codex (WSL)` · `Codex (Windows)`
2. 自動安裝該 agent 的 hook 設定（Claude → `~/.claude/settings.json`、Codex → `~/.codex/hooks.json`、Copilot → `<project>/.github/hooks/lumina.json`）。Idempotent，且以檔名結尾 dedupe — 把專案搬到別的 checkout 也不會 double-fire。
3. 在背景啟動 dev server、bridge、terminal server（WSL 用 systemd-run / Windows 用背景行程，看你選的 runtime）。視窗關閉也不死。
4. 開啟**分割視窗** — 左側：選定 agent 的 CLI terminal；右側：3D VRM buddy
5. 每 5 秒監控 bridge 健康；bridge 重啟時自動 reload buddy

視窗位置、分割線比例、agent、runtime 都儲存在 `lumina-prefs.json`，下次開啟自動還原。勾「下次不要問」可以跳過對話框；要再叫出來用 `--setup` 啟動。

### Hook 安裝（自動）

Launcher 啟動時會自動跑 `scripts/install-hooks.sh`（Windows runtime 跑 `install-hooks.ps1`）。對 PATH 上找得到的每個 agent CLI，把 buddy 條目 merge 進對應設定：

| Agent | 設定檔位置 | 安裝事件數 |
|---|---|---|
| Claude Code | `~/.claude/settings.json` | 7（完整生命週期） |
| Codex CLI | `~/.codex/hooks.json`（並在 `~/.codex/config.toml` 加 `[features] codex_hooks = true`） | 6（含 `PermissionRequest`，map 到 canonical `Notification`） |
| Copilot CLI | `<project>/.github/hooks/lumina.json` | 6（同檔同時帶 `bash` 與 `powershell` key，跨 runtime 共用） |

安裝器是 idempotent 的，並以結尾檔名（`*/buddy-hook.sh`）dedupe，所以重跑或搬專案都不會 double-fire。各家 stdin 形狀的差異吃在 hook adapter 裡，完整對照表在 [`docs/buddy-bridge.md`](docs/buddy-bridge.md)。

該 agent 在這台機器上的所有 session 都會觸發 hook；事件只有在 Lumina 開著的時候才會抵達 VRM。

### 需求

| 需求 | 版本 | 備註 |
|---|---|---|
| WSL2 | 任意 | 只有 WSL runtime 需要；Windows 原生 runtime 不需要 |
| Node.js（WSL **或** Windows，看你選哪個 runtime） | 18+ | 跑 agent 的那邊要有 |
| .NET 8 Desktop Runtime（Windows） | 執行 LuminaLauncher.exe | |
| 至少一個 agent CLI | 最新版 | `claude`、`copilot`、或 `codex` — 裝在你選的 runtime（WSL 或 Windows）裡 |
| PowerShell 5.1+（Windows） | 只有 Windows runtime 需要 | Win10/11 內建 |
| 編譯工具（WSL） | `g++`、`python3`、`make` | 只有跑 `npm rebuild node-pty`（升級 Node 主版本後）時才需要 |

### 第一次設定（一次性）

`scripts/up.sh` 第一次跑時會自動 `npm install` 安裝 `src/web/node_modules`。**有兩件事不會自動裝**，缺了的話 launcher 會在左側 terminal 面板顯示對應錯誤：

```bash
cd src/terminal && npm install   # 左側 terminal 面板需要（node-pty + ws）
```

如果哪天升級 Node 主版本（例如 18 → 20），`node-pty` 的內建 prebuilt 二進位會跟新的 `libnode.so` 對不起來。Launcher 會顯示 `PTY_ABI_MISMATCH` 並提示：

```bash
cd src/terminal && npm rebuild node-pty
```

### 替代流程 — 從 WSL terminal

```bash
cd /path/to/lumina
./scripts/up.sh
# 開瀏覽器到 http://localhost:3000，另一個 terminal 跑 claude
```

## 啟動之後

瀏覽器分頁顯示 3D 角色。右上角是 **Settings** 面板（可以收合成 ⚙），有四個下拉選單：

- **Buddy** — 自動掃描 `public/models/` 下的 VRM 模型
- **Persona** — 自動掃描 `public/personalities/` 下的人格（內建三種：傲嬌助手、熱血導師、冷酷黑客）
- **Power** — Eco / Balanced / Ultra 效能模式
- **Language** — zh-TW / en / ja 介面語言

在左側 terminal 跑你選的 agent CLI，然後發任意 prompt，角色會：

- 在 `SessionStart` 時，如果 memory stream 有正面記錄會放回憶（`💭 1 天前我們...`），否則放 agent 對應的打招呼台詞（`👋 Claude/Copilot/Codex 來上班了`）
- 在 tool use（Edit/Write/Bash/Read）時切換表情（Codex 的 `apply_patch`、Copilot 的小寫 `bash`/`shell` 都會被正規化成 canonical 名稱）
- 對 `.py` vs `.rs` vs `.ts` 顯示不同的台詞
- 跑 `pytest` / `jest` / `cargo test` / `tsc` 時，根據結果觸發 test-pass / test-fail / build-fail 反應
- 跑 `npm install`、`docker build`、`terraform apply` 等長任務時，畫面飄出 🌐 青色粒子
- agent 嘗試 `rm -rf /`、force-push 到 main、`DROP TABLE` 等危險指令時，畫面出現 🛑 chromatic-glitch overlay 警告
- 把 Claude 的 `TaskCreate` / `TaskUpdate` 渲染成右上角的結構化任務面板（**只 Claude 有 TaskCreate 工具**；Codex/Copilot 沒有對應工具，面板會自動隱藏）
- 顯示 `[Task]` / `[Scope]` / `[TODO]` 等 ccusage 狀態（**只 Claude 有 ccusage**）
- 達到里程碑（第一次 commit、累計 50 commit、深夜 push、100 次 tool 呼叫、20 次 Python 編輯…）時跳金色成就 toast（三家 agent 都會觸發）

**Per-agent 限制**（agent 本身的限制，非 Lumina 設計問題）：
- Codex 不會觸發 `SessionEnd` → Codex session 結束時不會出現 🌙 再見台詞
- Copilot 不會觸發 `Stop` → Copilot 每回合結束不會出現 🎉 完成台詞

## 加入自己的素材

| 想做的事 | 把檔案放在 | 然後 |
|---|---|---|
| 加 VRM 角色 | `src/web/public/models/<name>.vrm` | 重新整理分頁 → 從 **Buddy** 下拉選單選 |
| 加新人格 | `src/web/public/personalities/<id>.json` | 重新整理分頁 → 從 **Persona** 下拉選單選 |

人格 JSON schema 與完整指引：[`docs/personalities.md`](docs/personalities.md)。快速範本在 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

VRM 模型替換的四種工作流（拖放 / 放資料夾 / env 變數釘住 / IPFS fallback）：[`docs/swap-vrm-model.md`](docs/swap-vrm-model.md)。

## 排錯

健康狀態的四個訊號：

1. up.sh terminal：`[buddy-bridge] listening on http://127.0.0.1:3030`
2. up.sh terminal：`ready - started server on 0.0.0.0:3000`
3. 瀏覽器 console：`[buddy] connected to http://127.0.0.1:3030/events`
4. `curl -s http://127.0.0.1:3030/health` 回 `{"ok":true,"listeners":N}` 且 N ≥ 1

如果 1、2 通過但 3 不行 → 瀏覽器端問題，看 DevTools Network 分頁。如果 3 通了但反應沒觸發 → bug 在 `src/web/src/features/buddyEvents/buddyEvents.ts` 的 `REACTIONS` 對映表，不是基礎建設。

| 症狀 | 修法 |
|---|---|
| 左側 terminal 顯示「Terminal dependencies not installed」 | 第一次設定還沒做完 — `cd src/terminal && npm install`，然後關掉重開 Lumina |
| 左側 terminal 顯示「node-pty built against a different Node version」 | `cd src/terminal && npm rebuild node-pty`，然後關掉重開 Lumina |
| `localhost:3000` 連不到 | WSL2 的 `localhostForwarding` 可能被關掉。`cat /mnt/c/Users/<you>/.wslconfig` 看一下，把 `localhostForwarding=false` 移掉，然後 `wsl --shutdown` 重開。 |
| Dev server 噴 bus error 或 `node_modules` JSON 壞掉 | WSL2 從 `/mnt/d/` build 不穩。把專案搬到原生 WSL FS（`~/lumina`）做 production build。Dev server 在 `/mnt/d/` 通常還是能跑。 |
| Port 3000 或 3030 被佔用 | `pkill -f buddy-bridge.mjs`（或 `pkill -f next-server`）後重跑，或在 `up.sh` 前設 `LUMINA_WEB_PORT=3001` / `BUDDY_BRIDGE_PORT=3031` 環境變數。 |
| Claude 在跑但角色沒反應 | 看上面的四個訊號。最常見：瀏覽器分頁沒在 `localhost:3000`，或你 `claude` 是在專案外執行（hook 只在 Claude 的 working dir 對應 `.claude/settings.json` 位置時才會觸發）。 |

完整失效模式對照表：[`docs/install-flow.md`](docs/install-flow.md) 與 [`docs/edge-cases.md`](docs/edge-cases.md)。

## 系統架構

```
WSL bash 或 Windows PowerShell：                 Windows 瀏覽器：
                                                       │
   Claude Code  ──┐                                    │ EventSource
   Copilot CLI  ──┤  buddy-hook.{sh,ps1}               ▼
   Codex CLI    ──┘  POST /event           ChatVRM  ◀── SSE ── buddy-bridge
                     (per-agent normalize) (表情 + 對話框)        :3030
                            ▼
                       bridge :3030
```

- `scripts/buddy-bridge.mjs` — 零依賴 SSE relay（POST `/event`, GET `/events`, GET `/health`）。Agent 無關的 dumb relay。
- `scripts/buddy-hook.{sh,ps1}` — 多 agent 的 hook adapter。Signature 為 `<canonical-event> <agent>`。讀各 agent 的 stdin 形狀（Claude/Codex 用 `tool_name`+`session_id`、Copilot 用 `toolName`+null），輸出統一的 envelope `{type, tool, session, agent, context}`。**永遠 exit 0** 確保不會卡住 tool 執行。
- `scripts/install-hooks.{sh,ps1}` — Idempotent 安裝器。偵測 PATH 上有哪些 agent CLI，逐一寫對應設定檔。
- `src/web/src/features/buddyEvents/buddyEvents.ts` — EventSource client + per-agent tool name 正規化（`TOOL_NORMALIZE`）+ 反應解析（event → tool → language → personality，last wins）。Copilot 的 JSON 編碼字串 `toolArgs` 會被 hoist 成 `tool_input` object，讓 language/git/result detector 可以維持 agent 無關。
- `src/web/src/components/{modelSelector,personalitySelector}.tsx` — 自動掃描 `public/models/*.vrm` 與 `public/personalities/*.json` 的下拉選單。選擇存 `localStorage`，跨分頁透過 `storage` event 同步。

完整 pipeline 圖、各 agent stdin/event 對照表、端點、擴充點：[`docs/buddy-bridge.md`](docs/buddy-bridge.md)。

## 客製

| 你想改 | 看哪 |
|--------|------|
| 角色模型 | [`docs/swap-vrm-model.md`](docs/swap-vrm-model.md) — 拖放、放資料夾、env 覆蓋、IPFS fallback chain |
| 人格 | [`docs/personalities.md`](docs/personalities.md) — 放個 JSON、切換不需重連 |
| 每個事件下角色說什麼/做什麼表情 | `buddyEvents.ts` 裡的 `REACTIONS` 與 `LANGUAGE_REACTIONS` |
| Standalone bridge vs unified Next.js routes | [`docs/bridge-modes.md`](docs/bridge-modes.md) — `BUDDY_MODE=split\|unified`，附 tradeoff 表 |
| 從空資料夾完整重建 | [`docs/bootstrap-prompts.md`](docs/bootstrap-prompts.md) — 五階段 prompt，給一個全新的 Claude Code session 用 |

## Edge case 與已知問題

誠實的失效模式檢視：[`docs/edge-cases.md`](docs/edge-cases.md)。重點：

- **WSL2 `localhostForwarding=false`** — 瀏覽器到不了 WSL 服務。診斷與一行修法在 doc。
- **`@pixiv/three-vrm-core@1.0.9` 的 `.d.ts` 不完整** — TypeScript build 會錯，runtime 沒事。已在 `next.config.js` 用 `ignoreBuildErrors` 繞過，記在 [`docs/upstream-baseline.md`](docs/upstream-baseline.md)。
- **WSL2 從 `/mnt/d/`（Windows 掛載碟）build 不穩** — 會 bus error、`node_modules` JSON 損毀。要做 production build 請把專案搬到原生 WSL filesystem。

## 專案結構

repo 採用嚴格的四桶結構（`src/`、`scripts/`、`docs/`、`tests/`）加上設定資料夾（`.claude/`、`.vscode/`）。慣例與工作守則在 [`CLAUDE.md`](CLAUDE.md)。

## 授權

MIT — 本專案。

Lumina 在 `src/web/` 內含了 [zoan37/ChatVRM](https://github.com/zoan37/ChatVRM)（MIT, Copyright © 2023 pixiv Inc.）的原始碼。上游授權保留在 [`src/web/LICENSE`](src/web/LICENSE)。

放在 `public/` 或 `public/models/` 下的 VRM 模型檔依其作者的條款（VRoid Hub / Booth 等）為準。預設不入 git — 見 [`.gitignore`](.gitignore) 與 [`docs/swap-vrm-model.md`](docs/swap-vrm-model.md) 對再散布的指引。

## 狀態

Pre-1.0。整套 integration 在 WSL2 + Claude Code 上跑得通；其他環境視為未測。Open issues 列出有意未做的部分。
