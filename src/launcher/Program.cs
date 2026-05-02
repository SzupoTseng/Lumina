using System.Diagnostics;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.WinForms;

namespace LuminaLauncher;

internal static class Program
{
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);

    static void BringExistingWindowToFront()
    {
        var current = System.Diagnostics.Process.GetCurrentProcess();
        foreach (var p in System.Diagnostics.Process.GetProcessesByName(current.ProcessName))
        {
            if (p.Id == current.Id) continue;
            var hwnd = p.MainWindowHandle;
            if (hwnd == IntPtr.Zero) continue;
            if (IsIconic(hwnd)) ShowWindow(hwnd, 9); // SW_RESTORE
            SetForegroundWindow(hwnd);
            return;
        }
    }

    [STAThread]
    static void Main()
    {
        // Single-instance guard — only one Lumina window allowed
        using var mutex = new System.Threading.Mutex(true, "LuminaLauncherSingleInstance", out bool isNew);
        if (!isNew)
        {
            // Bring existing window to foreground instead of showing a dialog
            BringExistingWindowToFront();
            return;
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        var prefs = WindowPrefs.Load();
        var repoRoot = FindRepoRoot(AppContext.BaseDirectory) ?? AppContext.BaseDirectory.TrimEnd('\\', '/');
        var defaultDir = !string.IsNullOrEmpty(prefs.LastDir) && Directory.Exists(prefs.LastDir)
            ? prefs.LastDir : repoRoot;

        bool forceSetup = Environment.GetCommandLineArgs().Contains("--setup");
        string chosenDir = defaultDir;
        bool openClaude = prefs.OpenClaude;
        bool skipSetup = prefs.SkipSetup;
        string agent = prefs.Agent;
        string runtime = prefs.Runtime;

        if (forceSetup || !skipSetup || string.IsNullOrEmpty(prefs.LastDir) || !Directory.Exists(prefs.LastDir))
        {
            using var setup = new SetupDialog(defaultDir, prefs.OpenClaude, prefs.SkipSetup, prefs.Agent, prefs.Runtime);
            if (setup.ShowDialog() != DialogResult.OK) return;
            chosenDir = setup.ChosenDir;
            openClaude = setup.OpenClaude;
            skipSetup = setup.SkipSetup;
            agent = setup.Agent;
            runtime = setup.Runtime;
        }

        prefs.LastDir    = chosenDir;
        prefs.OpenClaude = openClaude;
        prefs.SkipSetup  = skipSetup;
        prefs.Agent      = agent;
        prefs.Runtime    = runtime;
        prefs.Save();

        // Best-effort hook install for the chosen agent. Non-fatal: a missing
        // CLI just means the avatar won't react to that agent's events.
        try { InstallHooks(chosenDir, agent, runtime); } catch { }

        StartBackground(chosenDir, agent, runtime, startTerminal: openClaude);
        Application.Run(new SplitWindow(chosenDir, openClaude, prefs));
    }

    internal static void StartBackground(string winDir, string agent = "claude", string runtime = "wsl", bool startTerminal = false)
    {
        if (runtime.Equals("windows", StringComparison.OrdinalIgnoreCase))
        {
            StartBackgroundWindows(winDir, agent, startTerminal);
            return;
        }

        var wslRoot = ToWslPath(winDir);
        if (string.IsNullOrEmpty(wslRoot)) return;

        // Batch-launch in one WSL process to reduce startup overhead.
        var commands = new List<string>
        {
            $"bash '{wslRoot}/scripts/start-bridge.sh' &",
            $"bash '{wslRoot}/scripts/start-dev.sh' &",
            $"nohup bash '{wslRoot}/scripts/status-bridge.sh' >/tmp/lumina-status.log 2>&1 &"
        };
        if (startTerminal)
            // Uses systemd-run so the server survives after this session ends.
            // Second arg is the agent name → start-terminal.sh maps to a CLI binary.
            commands.Add($"bash '{wslRoot}/scripts/start-terminal.sh' '{wslRoot}' '{agent}' &");

        RunWsl($"bash -lc \"{string.Join(" ", commands)}\"");
    }

    static void StartBackgroundWindows(string winDir, string agent, bool startTerminal)
    {
        // Bridge + dev server still run in WSL — those are the Next.js + bridge
        // services, agent-runtime independent. Only the terminal panel is what
        // changes when runtime=windows.
        var wslRoot = ToWslPath(winDir);
        if (!string.IsNullOrEmpty(wslRoot))
        {
            var bridgeCmds = new List<string>
            {
                $"bash '{wslRoot}/scripts/start-bridge.sh' &",
                $"bash '{wslRoot}/scripts/start-dev.sh' &",
                $"nohup bash '{wslRoot}/scripts/status-bridge.sh' >/tmp/lumina-status.log 2>&1 &"
            };
            RunWsl($"bash -lc \"{string.Join(" ", bridgeCmds)}\"");
        }

        if (startTerminal)
        {
            var ps1 = Path.Combine(winDir, "scripts", "start-terminal.ps1");
            if (!File.Exists(ps1)) return;
            try
            {
                Process.Start(new ProcessStartInfo("powershell.exe",
                    $"-NoProfile -ExecutionPolicy Bypass -File \"{ps1}\" -Cwd \"{winDir}\" -Agent \"{agent}\"")
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                });
            }
            catch { }
        }
    }

    static void InstallHooks(string winDir, string agent, string runtime)
    {
        if (runtime.Equals("windows", StringComparison.OrdinalIgnoreCase))
        {
            var ps1 = Path.Combine(winDir, "scripts", "install-hooks.ps1");
            if (!File.Exists(ps1)) return;
            Process.Start(new ProcessStartInfo("powershell.exe",
                $"-NoProfile -ExecutionPolicy Bypass -File \"{ps1}\" -Cwd \"{winDir}\" -Agent \"{agent}\"")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            });
        }
        else
        {
            var wslRoot = ToWslPath(winDir);
            if (string.IsNullOrEmpty(wslRoot)) return;
            RunWsl($"bash -lc \"bash '{wslRoot}/scripts/install-hooks.sh' '{wslRoot}' '{agent}'\"");
        }
    }

    static void RunWsl(string bashCmd) =>
        Process.Start(new ProcessStartInfo("wsl.exe", $"-- {bashCmd}")
        {
            UseShellExecute = true,   // gives the process its own session
            WindowStyle = ProcessWindowStyle.Hidden,
            CreateNoWindow = true
        });

    internal static string ToWslPath(string winPath)
    {
        winPath = winPath.Replace('\\', '/');
        
        // Instant conversion for typical local drives (e.g. D:/path -> /mnt/d/path)
        if (winPath.Length > 2 && winPath[1] == ':' && winPath[2] == '/')
        {
            return $"/mnt/{char.ToLower(winPath[0])}{winPath.Substring(2)}";
        }
        
        // Safe fallback for complex/network paths via wslpath utility
        try
        {
            var psi = new ProcessStartInfo("wsl.exe", $"wslpath -u \"{winPath}\"")
            { RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true };
            using var p = Process.Start(psi)!;
            var r = p.StandardOutput.ReadToEnd().Trim();
            p.WaitForExit();
            return r;
        }
        catch { return string.Empty; }
    }


    internal static string? FindRepoRoot(string start)
    {
        var dir = new DirectoryInfo(start.TrimEnd('\\', '/'));
        for (int i = 0; i < 8 && dir != null; i++, dir = dir.Parent)
            if (File.Exists(Path.Combine(dir.FullName, "CLAUDE.md")) &&
                Directory.Exists(Path.Combine(dir.FullName, "src", "web")))
                return dir.FullName;
        return null;
    }
}

// ── Window preference persistence ─────────────────────────────────────────────
sealed class WindowPrefs
{
    // Store in user profile — always writable regardless of where exe lives
    private static readonly string _path = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        "lumina-prefs.json");

    public int    Left          { get; set; } = -1;
    public int    Top           { get; set; } = -1;
    public int    Width         { get; set; } = -1;
    public int    Height        { get; set; } = -1;
    public bool   Maximized     { get; set; } = true;
    public int    SplitterDist  { get; set; } = -1;
    public string LastDir       { get; set; } = "";
    public bool   OpenClaude    { get; set; } = true;   // Kept for back-compat: "embed terminal" toggle
    public bool   SkipSetup     { get; set; } = false;
    public string Agent         { get; set; } = "claude";  // claude | copilot | codex
    public string Runtime       { get; set; } = "wsl";     // wsl | windows

    public static WindowPrefs Load()
    {
        try
        {
            if (File.Exists(_path))
            {
                var json = File.ReadAllText(_path);
                return JsonSerializer.Deserialize<WindowPrefs>(json) ?? new WindowPrefs();
            }
        }
        catch { }
        return new WindowPrefs();
    }

    public void Save()
    {
        try
        {
            File.WriteAllText(_path, JsonSerializer.Serialize(this,
                new JsonSerializerOptions { WriteIndented = true }));
        }
        catch { }
    }
}

sealed class SetupDialog : Form
{
    // The six supported (agent, runtime) combinations. Single dropdown — no
    // fiddling with two ComboBoxes for what is conceptually one choice.
    internal static readonly (string Label, string Agent, string Runtime)[] Options =
    {
        ("Claude  (WSL)",      "claude",  "wsl"),
        ("Claude  (Windows)",  "claude",  "windows"),
        ("Copilot (WSL)",      "copilot", "wsl"),
        ("Copilot (Windows)",  "copilot", "windows"),
        ("Codex   (WSL)",      "codex",   "wsl"),
        ("Codex   (Windows)",  "codex",   "windows"),
    };

    private readonly TextBox _dirBox;
    private readonly CheckBox _claudeCb;
    private readonly CheckBox _skipSetupCb;
    private readonly ComboBox _modeCb;

    public string ChosenDir => _dirBox.Text.Trim();
    public bool OpenClaude => _claudeCb.Checked;
    public bool SkipSetup => _skipSetupCb.Checked;
    public string Agent   => Options[Math.Max(0, _modeCb.SelectedIndex)].Agent;
    public string Runtime => Options[Math.Max(0, _modeCb.SelectedIndex)].Runtime;

    public SetupDialog(string defaultDir, bool claudeDefault = true, bool skipSetupDefault = false,
                       string agentDefault = "claude", string runtimeDefault = "wsl")
    {
        Text = "Lumina"; Size = new Size(500, 240);
        MaximizeBox = false; StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        Font = new Font("Segoe UI", 9.5f);

        _dirBox = new TextBox { Text = defaultDir, Location = new Point(12, 16), Width = 390 };
        var browse = new Button { Text = "…", Location = new Point(408, 14), Width = 36, Height = 28 };
        browse.Click += (_, _) =>
        {
            using var dlg = new FolderBrowserDialog { SelectedPath = _dirBox.Text };
            if (dlg.ShowDialog(this) == DialogResult.OK) _dirBox.Text = dlg.SelectedPath;
        };

        var modeLbl = new Label { Text = "Agent + Runtime:", Location = new Point(12, 56), AutoSize = true };
        _modeCb = new ComboBox
        {
            Location = new Point(124, 52), Width = 280,
            DropDownStyle = ComboBoxStyle.DropDownList,
            Font = new Font("Cascadia Mono, Consolas, monospace", 9.5f),
        };
        foreach (var opt in Options) _modeCb.Items.Add(opt.Label);
        var defaultIdx = Array.FindIndex(Options, o =>
            o.Agent.Equals(agentDefault, StringComparison.OrdinalIgnoreCase) &&
            o.Runtime.Equals(runtimeDefault, StringComparison.OrdinalIgnoreCase));
        _modeCb.SelectedIndex = defaultIdx >= 0 ? defaultIdx : 0;

        _claudeCb = new CheckBox { Text = "Embed terminal on the left", Location = new Point(12, 90), Checked = claudeDefault, AutoSize = true };
        _skipSetupCb = new CheckBox { Text = "Don't ask me again (skip this dialog next time)", Location = new Point(12, 118), Checked = skipSetupDefault, AutoSize = true };

        var ok = new Button { Text = "Start", Location = new Point(304, 152), Width = 70, Height = 28, DialogResult = DialogResult.OK };
        var cancel = new Button { Text = "Cancel", Location = new Point(382, 152), Width = 70, Height = 28, DialogResult = DialogResult.Cancel };
        AcceptButton = ok; CancelButton = cancel;
        Controls.AddRange(new Control[] { _dirBox, browse, modeLbl, _modeCb, _claudeCb, _skipSetupCb, ok, cancel });
    }
}

sealed class SplitWindow : Form
{
    private readonly WebView2 _leftWv;
    private readonly WebView2 _rightWv;
    private readonly Label _rightStatus;
    private readonly string _winDir;
    private readonly bool _openClaude;
    private readonly string _runtime;
    private readonly WindowPrefs _prefs;
    private SplitContainer? _split;
    private const string BUDDY_URL = "http://localhost:3000";

    // Append ?agent=<chosen> so the web app can show the right agent in the
    // settings panel and demo panel before any hook event has fired. Without
    // this, the panel would keep showing whatever agent was used last (sticky
    // localStorage) until the user actually invokes a tool.
    private string BuddyUrlForAgent => $"{BUDDY_URL}/?agent={Uri.EscapeDataString(_prefs.Agent)}";

    // Full VS Code terminal stack: xterm.js + fit + search + weblinks + unicode11
    // Protocol mirrors VS Code's terminalInstance.ts: raw strings for data/input,
    // JSON {type:'resize',cols,rows} for resize only.
    private const string TERMINAL_HTML = """
        <!DOCTYPE html><html>
        <head><meta charset="utf-8">
        <style>
          *{margin:0;padding:0;box-sizing:border-box}
          html,body{width:100%;height:100%;background:#0d0d0d;overflow:hidden}
          #t{width:100%;height:100%}
        </style>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm/css/xterm.min.css">
        </head>
        <body><div id="t"></div>
        <script src="https://cdn.jsdelivr.net/npm/@xterm/xterm/lib/xterm.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit/lib/addon-fit.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-search/lib/addon-search.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-web-links/lib/addon-web-links.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-unicode11/lib/addon-unicode11.min.js"></script>
        <script>
        const term = new Terminal({
          cursorBlink: true,
          allowProposedApi: true,
          fontFamily: '"Cascadia Code","Cascadia Mono",Consolas,"Courier New",monospace',
          fontSize: 14,
          theme: {
            background:'#0d0d0d', foreground:'#cccccc',
            cursor:'#aeafad', selectionBackground:'#264f78'
          }
        });

        // Load full VS Code addon set
        const fit    = new FitAddon.FitAddon();
        const search = new SearchAddon.SearchAddon();
        const links  = new WebLinksAddon.WebLinksAddon();
        const uni    = new Unicode11Addon.Unicode11Addon();
        term.loadAddon(fit);
        term.loadAddon(search);
        term.loadAddon(links);
        term.loadAddon(uni);
        term.unicode.activeVersion = '11';
        term.open(document.getElementById('t'));
        // Wait for DOM layout to complete before measuring container size
        requestAnimationFrame(() => fit.fit());

        // Detect actual container size first, then connect
        function sendResize(ws) {
          fit.fit(); // recalculate from container pixel dimensions
          ws.send(JSON.stringify({type:'resize', cols:term.cols, rows:term.rows}));
        }

        let onDataDispose, onBinaryDispose, onResizeDispose;
        const TERM_TOKEN = '__TERMINAL_TOKEN__';

        function connect() {
          if (onDataDispose)   { onDataDispose.dispose();   onDataDispose   = null; }
          if (onBinaryDispose) { onBinaryDispose.dispose(); onBinaryDispose = null; }
          if (onResizeDispose) { onResizeDispose.dispose(); onResizeDispose = null; }

          // Pass auth token via query param — prevents other local pages from connecting
          const ws = new WebSocket(`ws://127.0.0.1:3031?token=${encodeURIComponent(TERM_TOKEN)}`);

          ws.addEventListener('open', () => {
            sendResize(ws);  // send detected cols/rows immediately on open
          });

          ws.addEventListener('message', (e) => term.write(e.data));

          ws.addEventListener('close', () => {
            term.write('\r\n\x1b[33m[reconnecting...]\x1b[0m\r\n');
            setTimeout(connect, 2000);
          });

          onDataDispose   = term.onData((d)   => ws.readyState === 1 && ws.send(d));
          onBinaryDispose = term.onBinary((d) => ws.readyState === 1 && ws.send(d));
          onResizeDispose = term.onResize(()  => { if (ws.readyState === 1) sendResize(ws); });
        }
        connect();

        // Ctrl+C / Ctrl+V / Ctrl+X — intercept before WebView2 handles them
        term.attachCustomKeyEventHandler((ev) => {
          if (ev.type !== 'keydown' || !ev.ctrlKey) return true;

          // Ctrl+C: copy selection if any, else send SIGINT (\x03) to PTY
          if (ev.key === 'c' || ev.key === 'C') {
            const sel = term.getSelection();
            if (sel) {
              navigator.clipboard.writeText(sel).catch(() => document.execCommand('copy'));
              term.clearSelection();
              return false; // suppress browser copy, don't send \x03
            }
            return true; // no selection → let xterm send \x03 (SIGINT)
          }

          // Ctrl+V: paste clipboard into PTY
          if (ev.key === 'v' || ev.key === 'V') {
            navigator.clipboard.readText().then(text => {
              if (text && ws && ws.readyState === 1) ws.send(text);
            }).catch(() => {});
            return false; // suppress browser paste
          }

          // Ctrl+X: copy selection (no cut in terminal)
          if (ev.key === 'x' || ev.key === 'X') {
            const sel = term.getSelection();
            if (sel) {
              navigator.clipboard.writeText(sel).catch(() => {});
              return false;
            }
          }

          return true;
        });

        // Refit whenever the panel is resized (splitter drag, window resize)
        new ResizeObserver(() => fit.fit()).observe(document.getElementById('t'));
        </script></body></html>
        """;

    public SplitWindow(string winDir, bool openClaude, WindowPrefs prefs)
    {
        _winDir = winDir; _openClaude = openClaude; _prefs = prefs; _runtime = prefs.Runtime;
        Text = "✦ Lumina";

        // Restore previous window state
        var screen = Screen.PrimaryScreen!.WorkingArea;
        if (prefs.Maximized)
        {
            // Maximized: restore any saved normal bounds first so un-maximize
            // goes back to a sensible size, then maximize.
            if (prefs.Width > 100 && prefs.Height > 100 && prefs.Left >= 0)
            {
                StartPosition = FormStartPosition.Manual;
                Location = new Point(prefs.Left, prefs.Top);
                Size = new Size(prefs.Width, prefs.Height);
            }
            WindowState = FormWindowState.Maximized;
        }
        else if (prefs.Width > 100 && prefs.Height > 100 && prefs.Left >= 0)
        {
            StartPosition = FormStartPosition.Manual;
            Location = new Point(prefs.Left, prefs.Top);
            Size = new Size(prefs.Width, prefs.Height);
        }
        else
        {
            Location = new Point(screen.Left, screen.Top);
            Size = new Size(screen.Width, screen.Height);
            WindowState = FormWindowState.Maximized;
        }

        _split = new SplitContainer
        {
            Dock = DockStyle.Fill,
            BackColor = Color.Black
            // SplitterDistance is set in Load after window reaches final size
        };

        _leftWv = new WebView2 { Dock = DockStyle.Fill };
        _split.Panel1.Controls.Add(_leftWv);

        _rightStatus = new Label
        {
            Text = "⏳ Waiting for dev server…",
            Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter,
            Font = new Font("Segoe UI", 13f),
            ForeColor = Color.FromArgb(160, 160, 160),
            BackColor = Color.FromArgb(15, 15, 15)
        };
        _rightWv = new WebView2 { Dock = DockStyle.Fill, Visible = false };
        _split.Panel2.Controls.Add(_rightWv);
        _split.Panel2.Controls.Add(_rightStatus);
        _rightStatus.BringToFront();

        Controls.Add(_split);

        ResizeEnd        += (_, _) => CaptureAndSave();
        _split.SplitterMoved += (_, _) => CaptureAndSave();
        FormClosing      += (_, _) => CaptureAndSave();
        Application.ApplicationExit += (_, _) => CaptureAndSave();

        Load += OnLoad;

        // Bridge watchdog: when bridge comes back up after being down,
        // reload the right WebView2 so SSE reconnects immediately
        _ = Task.Run(BridgeWatchdog);
    }

    private async Task BridgeWatchdog()
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        bool wasDown = false;
        while (true)
        {
            await Task.Delay(5000);
            bool isDown;
            try
            {
                var r = await http.GetAsync("http://127.0.0.1:3030/health");
                var json = await r.Content.ReadAsStringAsync();
                isDown = !json.Contains("\"ok\":true");
            }
            catch { isDown = true; }

            if (wasDown && !isDown)
            {
                // Bridge just came back — reload VRM to reconnect SSE
                await Task.Delay(1000); // give bridge a moment to fully start
                Invoke(() =>
                {
                    try { _rightWv.CoreWebView2?.Reload(); } catch { }
                });
            }
            wasDown = isDown;
        }
    }

    private void CaptureAndSave()
    {
        _prefs.Maximized    = WindowState == FormWindowState.Maximized;
        _prefs.SplitterDist = _split?.SplitterDistance ?? -1;
        // Only save position/size when in Normal state — RestoreBounds is
        // unreliable when the window has never been un-maximized.
        if (WindowState == FormWindowState.Normal)
        {
            _prefs.Left   = Location.X;
            _prefs.Top    = Location.Y;
            _prefs.Width  = Size.Width;
            _prefs.Height = Size.Height;
        }
        _prefs.Save();
    }

    private async void OnLoad(object? sender, EventArgs e)
    {
        // Restore splitter AFTER window reaches its final size (maximized/normal)
        if (_prefs.SplitterDist > 0 && _prefs.SplitterDist < _split!.Width - 10)
            _split.SplitterDistance = _prefs.SplitterDist;
        else
            _split!.SplitterDistance = _split.Width / 2;

        await Task.WhenAll(_leftWv.EnsureCoreWebView2Async(), _rightWv.EnsureCoreWebView2Async());

        // Allow clipboard read/write so Ctrl+C and Ctrl+V work in the terminal
        _leftWv.CoreWebView2.PermissionRequested += (_, a) => {
            if (a.PermissionKind == Microsoft.Web.WebView2.Core.CoreWebView2PermissionKind.ClipboardRead)
                a.State = Microsoft.Web.WebView2.Core.CoreWebView2PermissionState.Allow;
        };

        _rightWv.CoreWebView2.NewWindowRequested += (_, a) => { a.Handled = true; _rightWv.CoreWebView2.Navigate(a.Uri); };

        if (_openClaude)
        {
            _leftWv.CoreWebView2.NavigateToString(
                "<html><body style='background:#0d0d0d;color:#999;display:flex;align-items:center;justify-content:center;height:100vh;font:14px Segoe UI'>Starting Claude Terminal…</body></html>");
            _ = InitializeTerminalViewAsync();
        }
        else
        {
            _leftWv.CoreWebView2.NavigateToString(
                "<html><body style='background:#0d0d0d;color:#555;display:flex;align-items:center;justify-content:center;height:100vh;font:14px Consolas'>terminal disabled</body></html>");
        }

        _ = WaitAndNavigateBuddy();
    }

    private async Task InitializeTerminalViewAsync()
    {
        var token = await GetTerminalToken();
        if (string.IsNullOrEmpty(token))
        {
            var diag = await ReadTerminalDiagnosticAsync();
            _leftWv.CoreWebView2.NavigateToString(BuildTerminalErrorHtml(diag));
            return;
        }

        var html = TERMINAL_HTML.Replace("__TERMINAL_TOKEN__", token);
        _leftWv.CoreWebView2.NavigateToString(html);
    }

    // Read terminal auth token. WSL runtime → ~/.cache/lumina/terminal.token via wsl.exe;
    // Windows runtime → %LOCALAPPDATA%\Lumina\terminal.token directly.
    private async Task<string> GetTerminalToken()
    {
        for (int i = 0; i < 20; i++)
        {
            try
            {
                string token = _runtime.Equals("windows", StringComparison.OrdinalIgnoreCase)
                    ? ReadWindowsCacheFile("terminal.token")
                    : await ReadWslCacheFile("terminal.token");
                if (System.Text.RegularExpressions.Regex.IsMatch(token, "^[0-9a-f]{32}$"))
                    return token;
            }
            catch { }
            await Task.Delay(200);
        }
        return "";
    }

    // start-terminal.{sh,ps1} writes a diagnostic code (DEPS_MISSING / PTY_ABI_MISMATCH /
    // PTY_LOAD_FAIL / SERVER_NOT_STARTED / AGENT_MISSING:<name>) when a pre-install check
    // fails. Empty string means file absent or read failed.
    private async Task<string> ReadTerminalDiagnosticAsync()
    {
        try
        {
            return _runtime.Equals("windows", StringComparison.OrdinalIgnoreCase)
                ? ReadWindowsCacheFile("terminal.error")
                : (await ReadWslCacheFile("terminal.error"));
        }
        catch { return ""; }
    }

    private static async Task<string> ReadWslCacheFile(string name)
    {
        var psi = new ProcessStartInfo("wsl.exe",
            $"-- bash -c \"cat ${{XDG_CACHE_HOME:-$HOME/.cache}}/lumina/{name} 2>/dev/null || true\"")
        {
            RedirectStandardOutput = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        using var p = Process.Start(psi);
        if (p == null) return "";
        var s = (await p.StandardOutput.ReadToEndAsync()).Trim();
        await p.WaitForExitAsync();
        return s;
    }

    private static string ReadWindowsCacheFile(string name)
    {
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Lumina");
        var path = Path.Combine(dir, name);
        if (!File.Exists(path)) return "";
        try { return File.ReadAllText(path).Trim(); }
        catch { return ""; }
    }

    private static string BuildTerminalErrorHtml(string diagCode)
    {
        // AGENT_MISSING:<name> — extract the agent and synthesize an install hint.
        if (diagCode.StartsWith("AGENT_MISSING:"))
        {
            var agent = diagCode.Substring("AGENT_MISSING:".Length).Trim();
            var (atitle, adetail, afix) = agent switch
            {
                "claude" => (
                    "claude not found on PATH",
                    "The Claude Code CLI isn't installed in this runtime.",
                    "curl -fsSL claude.ai/install.sh | bash   # or: npm install -g @anthropic-ai/claude-code"),
                "copilot" => (
                    "copilot not found on PATH",
                    "The GitHub Copilot CLI isn't installed in this runtime.",
                    "npm install -g @github/copilot"),
                "codex" => (
                    "codex not found on PATH",
                    "The OpenAI Codex CLI isn't installed in this runtime.",
                    "npm install -g @openai/codex   # or build from github.com/openai/codex"),
                _ => (
                    $"Agent '{agent}' not found",
                    "The selected agent binary isn't installed in this runtime.",
                    $"Install '{agent}' or pick a different agent in the setup dialog (--setup)")
            };
            var t1 = System.Net.WebUtility.HtmlEncode(atitle);
            var d1 = System.Net.WebUtility.HtmlEncode(adetail);
            var f1 = System.Net.WebUtility.HtmlEncode(afix);
            return "<html><body style='background:#0d0d0d;color:#ddd;font:14px Segoe UI;padding:24px;line-height:1.5'>" +
                   $"<h2 style='color:#b55;margin:0 0 8px'>{t1}</h2>" +
                   $"<p style='color:#888;margin:0 0 16px'>{d1}</p>" +
                   "<p style='color:#888;margin:0 0 6px'>Install the CLI, then close and reopen Lumina:</p>" +
                   $"<pre style='background:#000;color:#ffe;padding:12px;border-radius:4px;margin:0'>{f1}</pre>" +
                   "</body></html>";
        }

        var (title, detail, fix) = diagCode switch
        {
            "DEPS_MISSING" => (
                "Terminal dependencies not installed",
                "First-run setup hasn't been completed for the terminal server.",
                "cd src/terminal && npm install"),
            "PTY_ABI_MISMATCH" => (
                "node-pty built against a different Node version",
                "The shipped native binary doesn't match the Node currently in PATH (libnode.so version differs).",
                "cd src/terminal && npm rebuild node-pty"),
            "PTY_LOAD_FAIL" => (
                "node-pty native binary failed to load",
                "The native module for the current platform couldn't be loaded. Check /tmp/lumina-terminal.log for details.",
                "cd src/terminal && npm rebuild node-pty"),
            "SERVER_NOT_STARTED" => (
                "Terminal server failed to start",
                "Pre-install checks passed but the server didn't bind :3031. Check /tmp/lumina-terminal.log for details.",
                "tail -n 50 /tmp/lumina-terminal.log"),
            _ => (
                "Terminal token unavailable",
                "The terminal server may not have been started yet.",
                "bash scripts/start-terminal.sh \"$(pwd)\"")
        };
        var t = System.Net.WebUtility.HtmlEncode(title);
        var d = System.Net.WebUtility.HtmlEncode(detail);
        var f = System.Net.WebUtility.HtmlEncode(fix);
        return "<html><body style='background:#0d0d0d;color:#ddd;font:14px Segoe UI;padding:24px;line-height:1.5'>" +
               $"<h2 style='color:#b55;margin:0 0 8px'>{t}</h2>" +
               $"<p style='color:#888;margin:0 0 16px'>{d}</p>" +
               "<p style='color:#888;margin:0 0 6px'>Run this in a WSL terminal, then close and reopen Lumina:</p>" +
               $"<pre style='background:#000;color:#ffe;padding:12px;border-radius:4px;margin:0'>{f}</pre>" +
               "</body></html>";
    }

    private async Task WaitAndNavigateBuddy()
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        for (int i = 0; i < 150; i++)
        {
            try { var r = await http.GetAsync(BUDDY_URL); if ((int)r.StatusCode < 500) { NavigateBuddy(); return; } }
            catch { }
            await Task.Delay(200);
            if (i % 5 == 0) // only update UI every second
                Invoke(() => _rightStatus.Text = $"⏳ Waiting for dev server… ({(i * 200) / 1000}s)");
        }
        NavigateBuddy();
    }

    private void NavigateBuddy()
    {
        if (InvokeRequired) { Invoke(NavigateBuddy); return; }
        _rightWv.CoreWebView2.Navigate(BuddyUrlForAgent);
        _rightWv.NavigationCompleted += (_, _) =>
        {
            _rightStatus.Visible = false;
            _rightWv.Visible = true;
            _rightWv.BringToFront();
        };
    }
}
