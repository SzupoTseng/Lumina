// Auto-discovery of personality profiles in public/personalities/.
//
// Each *.json file is a Personality record:
//   {
//     id: string,                  // unique key, defaults to filename stem
//     name: string,                // display name shown in selector
//     systemPrompt: string,        // pre-fills ChatVRM's chat system prompt
//     defaultEmotion?: EmotionPreset,
//     reactions?: { [key]: string } // overrides for buddyEvents lines.
//                                   // Key shapes: "Stop" | "tool.Edit" | "lang.python".
//   }
//
// Read-only. Returns { personalities: Personality[] } sorted by id.

import type { NextApiRequest, NextApiResponse } from "next";
import fs from "node:fs";
import path from "node:path";

type EmotionPreset = "neutral" | "happy" | "angry" | "sad" | "relaxed";

export type Personality = {
  id: string;
  name: string;
  name_en?: string;
  name_ja?: string;
  systemPrompt: string;
  defaultEmotion?: EmotionPreset;
  reactions?: Record<string, string>;
};

const DIR = "personalities";

export default function handler(
  _req: NextApiRequest,
  res: NextApiResponse<{ personalities: Personality[] }>
) {
  const dir = path.join(process.cwd(), "public", DIR);
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    res.status(200).json({ personalities: [] });
    return;
  }

  const personalities: Personality[] = entries
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .map((name) => {
      const full = path.join(dir, name);
      try {
        const raw = fs.readFileSync(full, "utf8");
        const parsed = JSON.parse(raw) as Partial<Personality>;
        const id = parsed.id ?? name.replace(/\.json$/i, "");
        if (typeof parsed.name !== "string" || typeof parsed.systemPrompt !== "string") {
          console.warn(`[api/personalities] skipping ${name}: missing name/systemPrompt`);
          return null;
        }
        return {
          id,
          name: parsed.name,
          name_en: parsed.name_en,
          name_ja: parsed.name_ja,
          systemPrompt: parsed.systemPrompt,
          defaultEmotion: parsed.defaultEmotion,
          reactions: parsed.reactions ?? {},
        } as Personality;
      } catch (err) {
        console.warn(`[api/personalities] failed to read ${name}`, err);
        return null;
      }
    })
    .filter((p): p is Personality => p !== null)
    .sort((a, b) => a.id.localeCompare(b.id));

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ personalities });
}
