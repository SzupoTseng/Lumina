# VS Code Setup (Optional — for editing Lumina source)

> **Primary launcher is `LuminaLauncher.exe`** (see `docs/install-flow.md`), which provides the split-window experience automatically. This page is for developers who want to **edit Lumina's source code** while the buddy is running.

## Typical Workflow

1. **Run LuminaLauncher.exe** — starts the split window (left: Claude Code CLI, right: VRM buddy) and all background services
2. **Open VS Code separately** as a code editor: `cd /mnt/d/GameDevZ/Lumina && code .`
3. Edit source in VS Code; changes hot-reload into the running buddy via HMR

The two windows coexist. LuminaLauncher owns the buddy experience; VS Code is just an editor.

## If You Want VS Code to Run Everything (legacy)

The `.vscode/tasks.json` still has `folderOpen` tasks for bridge and dev server, so you can also open VS Code and use it as the orchestrator. The `task.allowAutomaticTasks: "on"` setting in `.vscode/settings.json` auto-starts them.

```
┌──────────────────────┬──────────────────┐
│ VS Code (editor)     │  Browser window  │
│                      │  localhost:3000  │
├──────────────────────┤  (VRM buddy)     │
│ Terminal (Claude)    │                  │
└──────────────────────┴──────────────────┘
```

**Limitation**: VS Code's Simple Browser / Live Preview cannot render WebGL (VRM 3D models). Open `http://localhost:3000` in Chrome or Edge instead.

## Source Editing Notes

| File | What it does |
|---|---|
| `src/web/src/features/buddyEvents/buddyEvents.ts` | All reaction strings — edit here for new languages or tweaks |
| `src/web/src/components/demoPanel.tsx` | Interactive demo panel items |
| `src/web/public/personalities/*.json` | Personality definitions |
| `src/web/public/models/*.vrm` | VRM models (gitignored — add your own) |
| `src/launcher/Program.cs` | C# launcher — rebuild after changes |

After editing TypeScript files, the dev server's HMR auto-reloads the WebView2 in LuminaLauncher. After editing C#, rebuild: `cd src/launcher && dotnet publish -c Release -r win-x64`.

## Without VS Code

```bash
cd /path/to/Lumina
./scripts/up.sh        # bridge :3030 + dev server :3000 (Ctrl+C stops both)
# open http://localhost:3000 in Chrome/Edge
# run `claude` in another terminal
```
