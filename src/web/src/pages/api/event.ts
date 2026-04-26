// pages/api/event.ts — unified-mode equivalent of scripts/buddy-bridge.mjs
// `POST /event`. POST body is broadcast as-is (with `ts` injected) to every
// SSE listener registered via /api/events.
//
// Used only when BUDDY_MODE=unified. In split mode (default), the standalone
// bridge at scripts/buddy-bridge.mjs handles this — both can coexist on
// different ports if you really want.
//
// State (the listeners Set) lives on globalThis so it survives Next.js HMR
// re-imports of this module during development.

import type { NextApiRequest, NextApiResponse } from "next";

type Listener = NextApiResponse;
type GlobalState = {
  __buddyListeners?: Set<Listener>;
};
const g = globalThis as unknown as GlobalState;
g.__buddyListeners ??= new Set<Listener>();

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  // Permissive CORS — bridge is bound to localhost via Next.js itself.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "POST only" });
    return;
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const evt = { ts: Date.now(), ...body };
  const payload = `data: ${JSON.stringify(evt)}\n\n`;

  const listeners = g.__buddyListeners;
  if (listeners) {
    for (const r of listeners) {
      try {
        r.write(payload);
      } catch {
        listeners.delete(r);
      }
    }
  }

  res.status(200).json({ ok: true, listeners: listeners?.size ?? 0 });
}

// Cap body size; mirrors the standalone bridge's 64 KB cap.
export const config = {
  api: {
    bodyParser: { sizeLimit: "64kb" },
  },
};
