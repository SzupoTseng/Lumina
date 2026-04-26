using System.Net;
using System.Net.WebSockets;
using System.Text;

namespace LuminaLauncher;

// WebSocket server that bridges a ConPTY process to xterm.js in WebView2.
// Listens on http://localhost:3031/ — one client at a time.
sealed class TerminalWs : IDisposable
{
    private readonly PseudoConsole _pty;
    private readonly HttpListener _http;

    public TerminalWs(string command, int port = 3031)
    {
        _pty = new PseudoConsole(command);
        _http = new HttpListener();
        _http.Prefixes.Add($"http://localhost:{port}/");
        _http.Start();
        _ = AcceptLoop();
    }

    async Task AcceptLoop()
    {
        while (_http.IsListening)
        {
            HttpListenerContext ctx;
            try { ctx = await _http.GetContextAsync(); }
            catch { break; }

            if (!ctx.Request.IsWebSocketRequest)
            {
                ctx.Response.StatusCode = 400;
                ctx.Response.Close();
                continue;
            }
            var wctx = await ctx.AcceptWebSocketAsync(null!);
            _ = Bridge(wctx.WebSocket);
        }
    }

    async Task Bridge(WebSocket ws)
    {
        using var cts = new CancellationTokenSource();

        // PTY stdout → WebSocket (sync read in Task.Run — pipes don't support async)
        var toClient = Task.Run(async () =>
        {
            var buf = new byte[4096];
            try
            {
                while (ws.State == WebSocketState.Open && !cts.Token.IsCancellationRequested)
                {
                    int n = await Task.Run(() => _pty.StdoutStream.Read(buf, 0, buf.Length), cts.Token);
                    if (n <= 0) break;
                    await ws.SendAsync(new ArraySegment<byte>(buf, 0, n),
                        WebSocketMessageType.Binary, true, cts.Token);
                }
            }
            catch { }
            cts.Cancel();
        });

        // WebSocket → PTY stdin (or resize)
        var toProcess = Task.Run(async () =>
        {
            var buf = new byte[4096];
            try
            {
                while (ws.State == WebSocketState.Open && !cts.Token.IsCancellationRequested)
                {
                    var result = await ws.ReceiveAsync(new ArraySegment<byte>(buf), cts.Token);
                    if (result.MessageType == WebSocketMessageType.Close) break;

                    if (result.MessageType == WebSocketMessageType.Text)
                    {
                        var msg = Encoding.UTF8.GetString(buf, 0, result.Count);
                        if (msg.StartsWith("{\"type\":\"resize\""))
                        {
                            var cols = short.Parse(ExtractJson(msg, "cols") ?? "220");
                            var rows = short.Parse(ExtractJson(msg, "rows") ?? "50");
                            _pty.Resize(cols, rows);
                            continue;
                        }
                    }
                    await Task.Run(() => { _pty.StdinStream.Write(buf, 0, result.Count); _pty.StdinStream.Flush(); }, cts.Token);
                }
            }
            catch { }
            cts.Cancel();
        });

        await Task.WhenAny(toClient, toProcess);
        try { await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "", default); } catch { }
    }

    static string? ExtractJson(string json, string key)
    {
        var marker = $"\"{key}\":";
        int i = json.IndexOf(marker, StringComparison.Ordinal);
        if (i < 0) return null;
        i += marker.Length;
        int j = json.IndexOfAny(new[] { ',', '}' }, i);
        return j < 0 ? null : json[i..j].Trim();
    }

    public void Dispose()
    {
        try { _http.Stop(); } catch { }
        _pty.Dispose();
    }
}
