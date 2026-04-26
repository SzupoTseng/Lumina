#!/usr/bin/env node
// buddy-bridge.mjs — minimal Claude-Code → ChatVRM event bus.
//
// Endpoints (all on http://127.0.0.1:3030 by default):
//   POST /event       Body: JSON. Broadcast as-is to all SSE listeners.
//   GET  /events      Server-Sent Events stream of every broadcast.
//   GET  /health      `{ ok: true, listeners: N }` — used by hooks/tests.
//
// Producer: Claude Code hooks via scripts/buddy-hook.sh (curl POST /event).
// Consumer: ChatVRM client via EventSource('/events').
//
// Zero-deps on purpose — uses only node:http. Run anywhere with Node >= 18.
//
// Env:
//   BUDDY_BRIDGE_PORT   default 3030
//   BUDDY_BRIDGE_HOST   default 127.0.0.1 (localhost only — do not expose)

import http from "node:http";

const PORT = Number(process.env.BUDDY_BRIDGE_PORT || 3030);
const HOST = "127.0.0.1"; // Hard-coded: localhost only, never expose externally
const MAX_BODY = 64 * 1024; // 64 KB cap per event

const listeners = new Set();

// Rate limiter: max 200 events/minute per source IP
const rateLimiter = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimiter.get(ip) ?? { count: 0, start: now };
  if (now - entry.start > 60_000) { rateLimiter.set(ip, { count: 1, start: now }); return false; }
  entry.count++;
  rateLimiter.set(ip, entry);
  return entry.count > 200;
}

// Only accept requests from loopback
function isLocalhost(req) {
  const addr = req.socket?.remoteAddress ?? '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function broadcast(eventStr) {
  const payload = `data: ${eventStr}\n\n`;
  for (const res of listeners) {
    try {
      res.write(payload);
    } catch {
      listeners.delete(res);
    }
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  // Security: reject non-loopback connections
  if (!isLocalhost(req)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }

  // CORS: only allow requests from localhost origins (browser same-origin or localhost)
  const origin = req.headers.origin ?? '';
  const allowedOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    ? origin : 'http://localhost:3000';
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Vary", "Origin");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, listeners: listeners.size }));
    return;
  }

  if (req.method === "GET" && req.url === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(`data: ${JSON.stringify({ type: "hello", ts: Date.now() })}\n\n`);
    listeners.add(res);
    const ka = setInterval(() => {
      try {
        res.write(": keepalive\n\n");
      } catch {}
    }, 15000);
    req.on("close", () => {
      clearInterval(ka);
      listeners.delete(res);
    });
    return;
  }

  if (req.method === "POST" && req.url === "/event") {
    // Rate limit: 200 events/minute per IP
    const ip = req.socket?.remoteAddress ?? '127.0.0.1';
    if (isRateLimited(ip)) {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "rate limit exceeded" }));
      return;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      return;
    }
    const evt = { ts: Date.now(), ...body };
    broadcast(JSON.stringify(evt));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, listeners: listeners.size }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "not found" }));
});

server.listen(PORT, HOST, () => {
  console.log(`[buddy-bridge] listening on http://${HOST}:${PORT}`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`[buddy-bridge] ${sig} — closing`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
