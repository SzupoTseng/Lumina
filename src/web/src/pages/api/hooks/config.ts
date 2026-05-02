// GET /api/hooks/config?agent=claude|copilot|codex
//
// Read-only inspector for the hook config files install-hooks.{sh,ps1}
// writes for each agent. Returns:
//   { agent, path, exists: true,  content: <pretty-printed-json>, parsed: <object> }
//   { agent, path, exists: false, content: null,                  parsed: null    }
//
// Codex's accompanying [features] codex_hooks=true flag in config.toml is
// surfaced as a separate field so the UI can show "feature flag enabled"
// without parsing TOML.
//
// Strictly read-only — install/uninstall lives at the existing /api/hooks
// route (claude-only, kept for back-compat with the old Settings UI). The
// canonical multi-agent installer is scripts/install-hooks.{sh,ps1} which
// the launcher runs on every startup.

import type { NextApiRequest, NextApiResponse } from "next";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

type AgentId = "claude" | "copilot" | "codex";

// Walk up from cwd looking for the repo's root marker (CLAUDE.md +
// src/web). Same heuristic Program.cs uses (FindRepoRoot). Robust against
// cwd shifts that the previous "../../"-based path math wouldn't survive.
//
// Memoized per `start` because cwd doesn't change at runtime in a Next.js
// server process. Saves 8×2 fs.existsSync syscalls per hooks-config request.
const _repoRootCache = new Map<string, string | null>();
function findRepoRoot(start: string): string | null {
  const key = path.resolve(start);
  const hit = _repoRootCache.get(key);
  if (hit !== undefined) return hit;

  let dir = key;
  for (let i = 0; i < 8; i++) {
    if (
      fs.existsSync(path.join(dir, "CLAUDE.md")) &&
      fs.existsSync(path.join(dir, "src", "web"))
    ) {
      _repoRootCache.set(key, dir);
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // hit filesystem root
    dir = parent;
  }
  _repoRootCache.set(key, null);
  return null;
}

function configPathFor(agent: AgentId): string {
  switch (agent) {
    case "claude":
      return path.join(os.homedir(), ".claude", "settings.json");
    case "codex":
      return path.join(os.homedir(), ".codex", "hooks.json");
    case "copilot": {
      // Project-local file. Walk up to the repo root rather than relying on
      // cwd being src/web (which it is in `next dev`/`next start` but not
      // necessarily in unit tests, custom servers, or future Next versions).
      // Falls back to the old "../.." math if the marker isn't found.
      const root = findRepoRoot(process.cwd()) ??
                   path.resolve(process.cwd(), "..", "..");
      return path.join(root, ".github", "hooks", "lumina.json");
    }
  }
}

function readFile(p: string) {
  try { return fs.readFileSync(p, "utf8"); }
  catch { return null; }
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end();

  const raw = String(req.query.agent ?? "claude").toLowerCase();
  if (raw !== "claude" && raw !== "copilot" && raw !== "codex") {
    return res.status(400).json({ error: "agent must be claude|copilot|codex" });
  }
  const agent = raw as AgentId;
  const filePath = configPathFor(agent);
  const content = readFile(filePath);

  if (content == null) {
    return res.json({
      agent,
      path: filePath,
      exists: false,
      content: null,
      parsed: null,
      codexFeatureEnabled: null,
    });
  }

  let parsed: unknown = null;
  try { parsed = JSON.parse(content); } catch { /* not json: leave parsed null, content still surfaced */ }

  // Codex add-on: surface whether [features] codex_hooks=true is enabled in
  // ~/.codex/config.toml. Without this flag, codex won't actually fire any
  // hooks even though hooks.json exists. UI uses this to warn the user.
  let codexFeatureEnabled: boolean | null = null;
  if (agent === "codex") {
    const toml = readFile(path.join(os.homedir(), ".codex", "config.toml"));
    codexFeatureEnabled = !!toml && /(?:^|\n)\s*codex_hooks\s*=\s*true/m.test(toml);
  }

  res.setHeader("Cache-Control", "no-store");
  res.json({
    agent,
    path: filePath,
    exists: true,
    content: parsed != null ? JSON.stringify(parsed, null, 2) : content,
    parsed,
    codexFeatureEnabled,
  });
}
