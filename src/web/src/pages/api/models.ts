// Auto-discovery of VRM files in public/models/. The ModelSelector component
// fetches this on mount and renders one entry per .vrm file. Drop a new
// model into public/models/ and it appears on the next page refresh — no
// code edits.
//
// Read-only by design. We never write to the filesystem from this route.
//
// Returns: { models: [{ name, path }] } where path is a public-URL path
// (no basePath; the client wraps it with buildUrl).

import type { NextApiRequest, NextApiResponse } from "next";
import fs from "node:fs";
import path from "node:path";

type ModelEntry = { name: string; path: string };

const MODELS_DIR = "models";

export default function handler(
  _req: NextApiRequest,
  res: NextApiResponse<{ models: ModelEntry[] }>
) {
  const publicRoot = path.join(process.cwd(), "public");
  const modelsDir = path.join(publicRoot, MODELS_DIR);

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(modelsDir);
  } catch {
    // Directory missing — that's fine, fall through with empty list.
  }

  const models: ModelEntry[] = entries
    .filter((name) => name.toLowerCase().endsWith(".vrm"))
    .sort()
    .map((name) => ({
      // Friendlier display name: strip ".vrm", normalize - and _ to spaces.
      // "cool-vroid.vrm" → "cool vroid"; "helper_bot.vrm" → "helper bot".
      name: name.replace(/\.vrm$/i, "").replace(/[-_]+/g, " "),
      path: `/${MODELS_DIR}/${name}`,
    }));

  // Also surface .vrm files dropped at the root of public/. Many users put
  // models there before discovering the models/ convention; rather than
  // making them rename, we list both locations.
  try {
    const rootEntries = fs.readdirSync(publicRoot);
    for (const name of rootEntries.sort()) {
      if (!name.toLowerCase().endsWith(".vrm")) continue;
      const display = name === "avatar.vrm"
        ? "avatar (legacy)"
        : name.replace(/\.vrm$/i, "").replace(/[-_]+/g, " ");
      models.unshift({ name: display, path: `/${name}` });
    }
  } catch {
    // ignore — public/ should always exist in a Next.js project, but a
    // missing dir is not fatal here.
  }

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ models });
}
