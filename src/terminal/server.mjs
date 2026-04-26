// Lumina terminal server — VS Code protocol (terminalInstance.ts pattern).
// Security: binds to 127.0.0.1 only; token-based auth prevents any other
// webpage on localhost from hijacking the PTY.

import { WebSocketServer } from 'ws';
import * as nodePty from 'node-pty';
import { randomBytes } from 'crypto';

const PORT  = parseInt(process.argv[2] ?? '3031', 10);
const CWD   = process.argv[3] ?? process.env.HOME ?? '/';
const CMD   = process.argv[4] ?? 'bash';
const ARGS  = process.argv.slice(5);

// One-time random token generated at startup.
// The C# launcher reads it from stdout and injects it into the xterm.js page.
// Without the token, WebSocket connections are rejected immediately.
const TOKEN = process.env.LUMINA_TERMINAL_TOKEN || randomBytes(16).toString('hex');

// Ensure ~/.local/bin is in PATH (claude install location)
const extraPaths = [`${process.env.HOME}/.local/bin`, '/usr/local/bin', '/usr/bin', '/bin'];
process.env.PATH = [...extraPaths, ...(process.env.PATH ?? '').split(':')].filter(Boolean).join(':');

// Rate limiting: max connections per minute from a single address
const RATE_LIMIT = { windowMs: 60_000, maxConnections: 10 };
const connAttempts = new Map();
function isRateLimited(addr) {
  const now = Date.now();
  const prev = connAttempts.get(addr) ?? { count: 0, windowStart: now };
  if (now - prev.windowStart > RATE_LIMIT.windowMs) {
    connAttempts.set(addr, { count: 1, windowStart: now });
    return false;
  }
  prev.count++;
  connAttempts.set(addr, prev);
  return prev.count > RATE_LIMIT.maxConnections;
}

const wss = new WebSocketServer({
  port: PORT,
  host: '127.0.0.1',    // localhost only — never expose externally
  verifyClient: ({ req }, done) => {
    const addr = req.socket.remoteAddress ?? '';

    // Only accept connections from loopback
    if (addr !== '127.0.0.1' && addr !== '::1' && addr !== '::ffff:127.0.0.1') {
      return done(false, 403, 'Forbidden');
    }

    // Rate limit
    if (isRateLimited(addr)) {
      return done(false, 429, 'Too Many Requests');
    }

    // Token validation via Sec-WebSocket-Protocol header (xterm.js sends it as subprotocol)
    // or via ?token= query param
    const url = new URL(req.url ?? '/', `http://127.0.0.1`);
    const queryToken = url.searchParams.get('token') ?? '';
    const headerToken = (req.headers['sec-websocket-protocol'] ?? '').split(',')
      .map(s => s.trim()).find(s => s.startsWith('token.'))?.slice(6) ?? '';
    const provided = queryToken || headerToken;

    if (!provided || provided !== TOKEN) {
      return done(false, 401, 'Unauthorized');
    }

    done(true);
  },
});

wss.on('connection', (ws) => {
  const pty = nodePty.spawn(CMD, ARGS, {
    name: 'xterm-256color',
    cols: 220,
    rows: 50,
    cwd: CWD,
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
  });

  // PTY → WebSocket: raw string (VS Code ptyService pattern)
  pty.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });

  pty.onExit(({ exitCode }) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(`\r\n\x1b[31m[process exited: ${exitCode}]\x1b[0m\r\n`);
      ws.close();
    }
  });

  // WebSocket → PTY: raw input or JSON resize
  ws.on('message', (raw) => {
    const msg = raw.toString();
    try {
      const obj = JSON.parse(msg);
      if (obj.type === 'resize') {
        pty.resize(Math.max(1, obj.cols), Math.max(1, obj.rows));
        return;
      }
    } catch { /* not JSON → raw terminal input */ }
    pty.write(msg);
  });

  ws.on('close', () => pty.kill());
  ws.on('error', () => pty.kill());
});

process.on('SIGTERM', () => { wss.close(); process.exit(0); });
process.on('SIGINT',  () => { wss.close(); process.exit(0); });

// Print token to stdout — C# launcher captures this and injects into xterm.js URL
console.log(`LUMINA_TOKEN=${TOKEN}`);
console.log(`[terminal-server] ws://127.0.0.1:${PORT} (auth required) | cmd:${CMD} cwd:${CWD}`);
