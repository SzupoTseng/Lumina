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

        using var setup = new SetupDialog(defaultDir, prefs.OpenClaude);
        if (setup.ShowDialog() != DialogResult.OK) return;

        prefs.LastDir    = setup.ChosenDir;
        prefs.OpenClaude = setup.OpenClaude;

        StartBackground(setup.ChosenDir, startTerminal: setup.OpenClaude);
        Application.Run(new SplitWindow(setup.ChosenDir, setup.OpenClaude, prefs));
    }

    internal static void StartBackground(string winDir, bool startTerminal = false)
    {
        var wslRoot = ToWslPath(winDir);
        if (string.IsNullOrEmpty(wslRoot)) return;

        // Each script is idempotent — safe to call even if already running
        RunWsl($"bash -lc \"bash '{wslRoot}/scripts/start-bridge.sh' &\"");
        RunWsl($"bash -lc \"bash '{wslRoot}/scripts/start-dev.sh' &\"");
        RunWsl($"bash -lc \"nohup bash '{wslRoot}/scripts/status-bridge.sh' >/tmp/lumina-status.log 2>&1 &\"");
        if (startTerminal)
            // Uses systemd-run so the server survives after this session ends
            RunWsl($"bash -lc \"bash '{wslRoot}/scripts/start-terminal.sh' '{wslRoot}'\"");
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
        try
        {
            var psi = new ProcessStartInfo("wsl.exe", $"wslpath -u \"{winPath.Replace('\\', '/')}\"")
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
    public bool   OpenClaude    { get; set; } = true;

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
    private readonly TextBox _dirBox;
    private readonly CheckBox _claudeCb;
    public string ChosenDir => _dirBox.Text.Trim();
    public bool OpenClaude => _claudeCb.Checked;

    public SetupDialog(string defaultDir, bool claudeDefault = true)
    {
        Text = "Lumina"; Size = new Size(500, 160);
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
        _claudeCb = new CheckBox { Text = "左側嵌入 Claude Code CLI", Location = new Point(12, 54), Checked = claudeDefault, AutoSize = true };
        var ok = new Button { Text = "啟動", Location = new Point(304, 90), Width = 70, Height = 28, DialogResult = DialogResult.OK };
        var cancel = new Button { Text = "取消", Location = new Point(382, 90), Width = 70, Height = 28, DialogResult = DialogResult.Cancel };
        AcceptButton = ok; CancelButton = cancel;
        Controls.AddRange(new Control[] { _dirBox, browse, _claudeCb, ok, cancel });
    }
}

sealed class SplitWindow : Form
{
    private readonly WebView2 _leftWv;
    private readonly WebView2 _rightWv;
    private readonly Label _rightStatus;
    private readonly string _winDir;
    private readonly bool _openClaude;
    private readonly WindowPrefs _prefs;
    private SplitContainer? _split;
    private const string BUDDY_URL = "http://localhost:3000";

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
        _winDir = winDir; _openClaude = openClaude; _prefs = prefs;
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
            Text = "⏳ 等待 dev server…",
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

        await _leftWv.EnsureCoreWebView2Async();
        await _rightWv.EnsureCoreWebView2Async();

        // Allow clipboard read/write so Ctrl+C and Ctrl+V work in the terminal
        _leftWv.CoreWebView2.PermissionRequested += (_, a) => {
            if (a.PermissionKind == Microsoft.Web.WebView2.Core.CoreWebView2PermissionKind.ClipboardRead)
                a.State = Microsoft.Web.WebView2.Core.CoreWebView2PermissionState.Allow;
        };

        _rightWv.CoreWebView2.NewWindowRequested += (_, a) => { a.Handled = true; _rightWv.CoreWebView2.Navigate(a.Uri); };

        if (_openClaude)
        {
            // Fetch the auth token that terminal server printed to stdout
            var token = await GetTerminalToken();
            var html = TERMINAL_HTML.Replace("__TERMINAL_TOKEN__", token);
            _leftWv.CoreWebView2.NavigateToString(html);
        }
        else
        {
            _leftWv.CoreWebView2.NavigateToString(
                "<html><body style='background:#0d0d0d;color:#555;display:flex;align-items:center;justify-content:center;height:100vh;font:14px Consolas'>terminal disabled</body></html>");
        }

        _ = WaitAndNavigateBuddy();
    }

    // Read the auth token that the terminal server printed to its log on startup
    private static async Task<string> GetTerminalToken()
    {
        for (int i = 0; i < 30; i++)
        {
            await Task.Delay(500);
            try
            {
                var log = File.ReadAllText("/tmp/lumina-terminal.log");
                var match = System.Text.RegularExpressions.Regex.Match(log, @"LUMINA_TOKEN=([0-9a-f]{32})");
                if (match.Success) return match.Groups[1].Value;
            }
            catch { }
        }
        return ""; // fallback: no token (server will reject, but shows error gracefully)
    }

    private async Task WaitAndNavigateBuddy()
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        for (int i = 0; i < 120; i++)
        {
            try { var r = await http.GetAsync(BUDDY_URL); if ((int)r.StatusCode < 500) { NavigateBuddy(); return; } }
            catch { }
            await Task.Delay(1000);
            Invoke(() => _rightStatus.Text = $"⏳ 等待 dev server… ({i + 1}s)");
        }
        NavigateBuddy();
    }

    private void NavigateBuddy()
    {
        if (InvokeRequired) { Invoke(NavigateBuddy); return; }
        _rightWv.CoreWebView2.Navigate(BUDDY_URL);
        _rightWv.NavigationCompleted += (_, _) =>
        {
            _rightStatus.Visible = false;
            _rightWv.Visible = true;
            _rightWv.BringToFront();
        };
    }
}
