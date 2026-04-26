// GET  /api/hooks → { installed: boolean, count: number }
// POST /api/hooks  { action: "install" | "uninstall" }
import type { NextApiRequest, NextApiResponse } from "next";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");
const HOOK_SCRIPT   = path.join(process.cwd(), "..", "..", "scripts", "buddy-hook.sh");
const EVENTS = ["SessionStart","SessionEnd","UserPromptSubmit","PreToolUse","PostToolUse","Notification","Stop"];

function isLuminaHook(cmd: string) {
  return cmd.includes("buddy-hook.sh");
}

function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8")); }
  catch { return {}; }
}

function writeSettings(cfg: unknown) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(cfg, null, 2), "utf8");
}

function countInstalled(hooks: Record<string, unknown[]>) {
  let n = 0;
  for (const groups of Object.values(hooks)) {
    for (const g of groups as any[]) {
      const cmds = (g.hooks ?? [g]) as any[];
      if (cmds.some((h: any) => isLuminaHook(h.command ?? ""))) n++;
    }
  }
  return n;
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const cfg = readSettings();
  const hooks = cfg.hooks ?? {};

  if (req.method === "GET") {
    const count = countInstalled(hooks);
    return res.json({ installed: count > 0, count, expected: EVENTS.length });
  }

  if (req.method === "POST") {
    const body = req.body as Record<string, unknown> | null;
    const action = typeof body?.action === 'string' ? body.action : '';
    if (!action) return res.status(400).json({ error: "missing action" });

    if (action === "install") {
      for (const evt of EVENTS) {
        const existing = (hooks[evt] ?? []) as any[];
        const clean = existing.filter(
          (g: any) => !(g.hooks ?? [g]).some((h: any) => isLuminaHook(h.command ?? ""))
        );
        hooks[evt] = [{ hooks: [{ type: "command", command: `${HOOK_SCRIPT} ${evt}` }] }, ...clean];
      }
      cfg.hooks = hooks;
      writeSettings(cfg);
      return res.json({ ok: true, action: "installed" });
    }

    if (action === "uninstall") {
      for (const evt of EVENTS) {
        const existing = (hooks[evt] ?? []) as any[];
        const clean = existing.filter(
          (g: any) => !(g.hooks ?? [g]).some((h: any) => isLuminaHook(h.command ?? ""))
        );
        if (clean.length === 0) delete hooks[evt];
        else hooks[evt] = clean;
      }
      cfg.hooks = hooks;
      writeSettings(cfg);
      return res.json({ ok: true, action: "uninstalled" });
    }

    return res.status(400).json({ error: "unknown action" });
  }

  res.status(405).end();
}
