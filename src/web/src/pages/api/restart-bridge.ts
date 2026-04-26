// POST /api/restart-bridge — shells out to start-bridge.sh
// Rate-limited: 1 restart per 30 seconds to prevent abuse.
import type { NextApiRequest, NextApiResponse } from "next";
import { execFile } from "node:child_process";
import path from "node:path";

let lastRestart = 0;
const COOLDOWN_MS = 30_000;

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") { res.status(405).end(); return; }

  // Only allow loopback callers (WebView2 on localhost)
  const addr = req.socket?.remoteAddress ?? '';
  if (addr !== '127.0.0.1' && addr !== '::1' && addr !== '::ffff:127.0.0.1') {
    res.status(403).json({ ok: false, error: 'forbidden' }); return;
  }

  // Rate limit: one restart per 30 seconds
  const now = Date.now();
  if (now - lastRestart < COOLDOWN_MS) {
    const retryAfter = Math.ceil((COOLDOWN_MS - (now - lastRestart)) / 1000);
    res.setHeader('Retry-After', retryAfter);
    res.status(429).json({ ok: false, error: `retry after ${retryAfter}s` }); return;
  }
  lastRestart = now;

  const script = path.join(process.cwd(), "..", "..", "scripts", "start-bridge.sh");
  execFile("bash", [script], { timeout: 8000 }, (err) => {
    if (err) {
      console.error("[restart-bridge]", err.message);
      res.status(500).json({ ok: false, error: err.message });
    } else {
      res.status(200).json({ ok: true });
    }
  });
}
