```
██╗     ██╗   ██╗███╗   ███╗██╗███╗   ██╗ █████╗
██║     ██║   ██║████╗ ████║██║████╗  ██║██╔══██╗
██║     ██║   ██║██╔████╔██║██║██╔██╗ ██║███████║
██║     ██║   ██║██║╚██╔╝██║██║██║╚██╗██║██╔══██║
███████╗╚██████╔╝██║ ╚═╝ ██║██║██║ ╚████║██║  ██║
╚══════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝
        > THE VISUAL LAYER FOR CLAUDE CODE <
```

# Lumina

> 在 Claude Code 開發時即時做出反應的 3D VRM 桌面伴侶。

[English](README.md) &nbsp;·&nbsp; **繁體中文**

![Lumina — Claude Code meets VRM buddy](Lumina.png)

把 Claude Code 的 hook 事件接到 3D 角色身上：模型可換，人格可換，當 Claude 編 Python 時跟編 Rust 時表情不一樣，每次 `Edit`/`Bash` 完成都有對應反應。基於 [ChatVRM](https://github.com/zoan37/ChatVRM)（MIT, pixiv Inc.）與 Claude Code 的 hook 系統。

## 跟其他「AI 開發伴侶」差在哪

大部分類似專案靠 chat 角色扮演或視覺化編輯器狀態。Lumina 直接接進 **Claude Code 真正的工具執行事件** — 也就是 harness 觸發的 `PreToolUse`/`PostToolUse`/`Stop` 等 callback — 透過一個極小的 SSE relay 傳到 VRM 角色的表情與對話框。角色不是「假裝」在反應，而是讀真實的 wire。

- **Hook 驅動，非 prompt 驅動。** 反應 100% 觸發、延遲 < 100ms，與 LLM 是否決定要說都無關。
- **語言敏感。** Edit `app.py` 跟 Edit `lib.rs` 觸發不同的 emote/台詞。映射在單一檔案裡，好 fork。
- **人格系統。** 在 `public/personalities/` 丟一個 JSON 就多一個人格（system prompt + 每事件台詞 override）。內建三種：傲嬌助手、熱血導師、冷酷黑客。
- **兩種架構模式可切換。** Standalone bridge（預設、解耦）或 unified Next.js api routes（單一程序、單一 port）。一個環境變數切換。
- **核心零依賴。** Bridge 是 ~110 行的 `node:http` + SSE。沒有 Express、沒有 `ws`、沒有 `body-parser`。

## 快速開始

需要 **WSL2**（Windows）、WSL 裡的 **Node 18+**，以及裝在 WSL 的 [**Claude Code**](https://docs.claude.com/en/docs/claude-code)。

### 主要流程 — 雙擊 `LuminaLauncher.exe`

雙擊 `src/launcher/publish/LuminaLauncher.exe`：

1. 彈出小視窗選擇專案目錄（預設 Lumina repo）
2. 在 WSL 背景啟動 dev server、bridge、terminal server（systemd-run，關閉視窗也不死）
3. 開啟**分割視窗** — 左側：Claude Code CLI terminal；右側：3D VRM buddy
4. 每 5 秒監控 bridge 健康；bridge 重啟時自動 reload buddy

視窗位置與分割線比例儲存在 exe 旁的 `lumina-prefs.json`，下次開啟自動還原。

### Hook 安裝（第一次）

Settings 面板底部顯示 hook 狀態：
- 🟢 `Hooks ✓ (7)` — 已安裝
- 🔴 `Hooks 未安裝` — 點 **安裝** 即可

### 需求

| 需求 | 版本 |
|---|---|
| WSL2 | 任意 |
| Node.js（WSL） | 18+ |
| .NET 8 Desktop Runtime（Windows） | 執行 LuminaLauncher.exe |
| Claude Code（WSL） | 最新版 |

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

在另一個 terminal 在專案根目錄跑 `claude`，然後發任意 prompt，角色會：

- 在 `SessionStart` 時，如果 memory stream 有正面記錄會放回憶（`💭 1 天前我們...`），否則放預設打招呼
- 在 tool use（Edit/Write/Bash/Read）時切換表情
- 對 `.py` vs `.rs` vs `.ts` 顯示不同的台詞
- 跑 `pytest` / `jest` / `cargo test` / `tsc` 時，根據結果觸發 test-pass / test-fail / build-fail 反應
- 跑 `npm install`、`docker build`、`terraform apply` 等長任務時，畫面飄出 🌐 青色粒子
- Claude 嘗試 `rm -rf /`、force-push 到 main、`DROP TABLE` 等危險指令時，畫面出現 🛑 chromatic-glitch overlay 警告
- 把 Claude 的 `TaskCreate` / `TaskUpdate` 渲染成右上角的結構化任務面板
- 達到里程碑（第一次 commit、累計 50 commit、深夜 push、100 次 tool 呼叫、20 次 Python 編輯…）時跳金色成就 toast

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
| `localhost:3000` 連不到 | WSL2 的 `localhostForwarding` 可能被關掉。`cat /mnt/c/Users/<you>/.wslconfig` 看一下，把 `localhostForwarding=false` 移掉，然後 `wsl --shutdown` 重開。 |
| Dev server 噴 bus error 或 `node_modules` JSON 壞掉 | WSL2 從 `/mnt/d/` build 不穩。把專案搬到原生 WSL FS（`~/lumina`）做 production build。Dev server 在 `/mnt/d/` 通常還是能跑。 |
| Port 3000 或 3030 被佔用 | `pkill -f buddy-bridge.mjs`（或 `pkill -f next-server`）後重跑，或在 `up.sh` 前設 `LUMINA_WEB_PORT=3001` / `BUDDY_BRIDGE_PORT=3031` 環境變數。 |
| Claude 在跑但角色沒反應 | 看上面的四個訊號。最常見：瀏覽器分頁沒在 `localhost:3000`，或你 `claude` 是在專案外執行（hook 只在 Claude 的 working dir 對應 `.claude/settings.json` 位置時才會觸發）。 |

完整失效模式對照表：[`docs/install-flow.md`](docs/install-flow.md) 與 [`docs/edge-cases.md`](docs/edge-cases.md)。

## 系統架構

```
WSL bash（或 Linux）：                       Windows 瀏覽器：
                                                  │
   Claude Code  ──┐                               │ EventSource
                  │ buddy-hook.sh                 ▼
                  │ POST /event           ChatVRM  ◀── SSE ── buddy-bridge
                  ▼                       (表情 + 對話框)         :3030
                bridge :3030
```

- `scripts/buddy-bridge.mjs` — 零依賴 SSE relay（POST `/event`, GET `/events`, GET `/health`）。
- `scripts/buddy-hook.sh` — Claude Code hook 接線；從 stdin 讀 JSON，POST 給 bridge，**永遠 exit 0** 確保不會卡住 tool 執行。
- `.claude/settings.json` — 把 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Notification`、`Stop`、`SessionEnd` 接到 hook 接線。
- `src/web/src/features/buddyEvents/buddyEvents.ts` — EventSource client + 反應解析（event → tool → language → personality，last wins）。
- `src/web/src/components/{modelSelector,personalitySelector}.tsx` — 自動掃描 `public/models/*.vrm` 與 `public/personalities/*.json` 的下拉選單。選擇存 `localStorage`，跨分頁透過 `storage` event 同步。

完整 pipeline 圖、事件分類、端點、擴充點：[`docs/buddy-bridge.md`](docs/buddy-bridge.md)。

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
