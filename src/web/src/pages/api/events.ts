// pages/api/events.ts — unified-mode SSE endpoint.
// GET /api/events streams { ts, type, ... } payloads pushed by /api/event.
//
// Connection lifecycle:
//   - Sets SSE headers via writeHead (Next.js Pages Router needs explicit
//     headers; flushHeaders is implicit in res.writeHead+res.write).
//   - Sends an initial "hello" event so the client can detect liveness.
//   - Adds res to a globalThis-scoped listeners Set (survives Next.js HMR).
//   - Pings ":keepalive\n\n" every 15 s so proxies / browsers don't kill
//     the stream during quiet periods.
//   - Removes res on req.close.
//
// Caveat for unified mode: when you save a TypeScript file and Next.js
// reloads modules, this module's *new* instance points at the same
// globalThis listeners Set, but the *old* response objects in that Set may
// already be closed. We rely on the per-broadcast try/catch in /api/event
// to prune them lazily.

import type { NextApiRequest, NextApiResponse } from "next";

type Listener = NextApiResponse;
type GlobalState = {
  __buddyListeners?: Set<Listener>;
  __buddyKeepalive?: NodeJS.Timeout;
};
const g = globalThis as unknown as GlobalState;
g.__buddyListeners ??= new Set<Listener>();

if (!g.__buddyKeepalive) {
  g.__buddyKeepalive = setInterval(() => {
    if (!g.__buddyListeners) return;
    for (const r of g.__buddyListeners) {
      try {
        r.write(": keepalive\n\n");
      } catch {
        g.__buddyListeners.delete(r);
      }
    }
  }, 15000);
  // Don't keep the process alive just for keepalives.
  g.__buddyKeepalive.unref?.();
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.status(405).end();
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": "*",
  });
  res.write(`data: ${JSON.stringify({ type: "hello", ts: Date.now() })}\n\n`);

  // Disable Node's default socket timeout so the stream doesn't get killed
  // after ~2 minutes of quiet (keepalive comments fire every 15s anyway).
  req.socket?.setTimeout?.(0);

  g.__buddyListeners!.add(res);

  req.on("close", () => {
    g.__buddyListeners?.delete(res);
  });
}

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};
