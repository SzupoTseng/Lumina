# Install Flow

How Lumina goes from zero to a running split-window buddy.

## Prerequisites

| Requirement | Where |
|---|---|
| WSL2 | Windows feature — enable in Settings → Optional Features |
| Node.js 18+ | Inside WSL: `nvm install 18` or `apt install nodejs` |
| Claude Code | Inside WSL: `npm install -g @anthropic-ai/claude-code` |
| .NET 8 Desktop Runtime | Windows: https://dotnet.microsoft.com/download/dotnet/8.0 |

## Happy Path — LuminaLauncher.exe

```
Double-click  src/launcher/publish/LuminaLauncher.exe
      │
      ▼
┌─────────────────────────────────────────┐
│  SetupDialog: pick project directory    │  ← defaults to Lumina repo
│  ☑ 左側嵌入 Claude Code CLI             │
└─────────────────┬───────────────────────┘
                  │ click 啟動
                  ▼
  ┌───────────────────────────────────────────────────────┐
  │  C# starts background WSL services (systemd-run)      │
  │    • scripts/start-bridge.sh  → bridge  :3030         │
  │    • scripts/start-dev.sh     → Next.js :3000         │
  │    • scripts/start-terminal.sh → node-pty :3031       │
  │    • scripts/status-bridge.sh → ccusage poller        │
  └───────────────────────────────────────────────────────┘
                  │
                  ▼
  ┌──────────────────────┬──────────────────────────────┐
  │  LEFT panel          │  RIGHT panel                 │
  │  xterm.js terminal   │  WebView2 → localhost:3000   │
  │  (node-pty via       │  ChatVRM + VRM buddy         │
  │   ws://localhost:    │                              │
  │   3031)              │                              │
  │                      │                              │
  │  type `claude`       │  ● VRM reacts to hooks       │
  │  to start Claude Code│  ● Settings panel (purple)  │
  └──────────────────────┴──────────────────────────────┘
```

Services use `systemd-run --user --no-block` — they **survive** after the launcher window closes and are reused on the next launch (idempotent scripts check the port first).

## Hook Installation (first run only)

Claude Code reactions need global hooks. Open the Settings panel (▾ top-right) → scroll to bottom → see Hooks status:

- 🟢 **Hooks ✓ (7)** — already installed, skip
- 🔴 **Hooks 未安裝** — click **安裝**

This writes absolute-path hook commands to `~/.claude/settings.json`. They fire for **all** Claude Code sessions on this machine; events only reach the VRM while the bridge is running.

## Dev Server Note — /mnt/d/ vs Native FS

The dev server **must** run from native WSL ext4, not `/mnt/d/` (Windows DrvFs/9p). `start-dev.sh` detects `/mnt/d/` automatically and rsyncs to `~/lumina-runtime/` before starting Next.js. First run ~30 s; subsequent runs skip the rsync if files are unchanged. See `docs/edge-cases.md` for the root cause.

## Alternative — WSL terminal only

```bash
cd /path/to/lumina
./scripts/up.sh        # bridge :3030 + Next.js :3000 (foreground; Ctrl+C stops both)
# open http://localhost:3000 in a browser
# run `claude` in another terminal
```

## Window Preferences

LuminaLauncher saves window geometry to `lumina-prefs.json` next to the `.exe` (auto-saved on move/resize). Delete it to reset to defaults.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Left terminal shows connection refused | terminal server not started | check `ss -tlnp \| grep 3031` |
| VRM shows "⏳ waiting" indefinitely | dev server not on :3000 | check `ss -tlnp \| grep 3000` |
| No VRM reactions to Claude Code | bridge down or hooks not installed | Settings → Hooks → 安裝 |
| Bridge stops working | bridge crashed | watchdog auto-reloads right panel on next start |
| Dev server exits after "ready" | running from /mnt/d/ | `start-dev.sh` handles this automatically |
