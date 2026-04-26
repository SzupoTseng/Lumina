// slashRoute — maps Claude Code slash commands typed by the user to the
// existing cinematic overlay components. Pure pattern matching on the
// prompt text from UserPromptSubmit hook events. No new visuals — every
// route reuses an effect we already have.
//
// IP-safe by design: command keywords are generic English/dev verbs
// (effort, think, focus, review, audit, compact, clear). No anime
// references, no signature visuals, no copyrighted line text.
//
// Adding a new route: append a CommandRoute. Don't add new effect kinds
// without first writing the corresponding component — keep the kind
// space narrow.

export type EffectKind =
  | "energy_gather" // long-task swarm (EnergyGathering)
  | "triumph"       // dark vignette + warm spotlight (TriumphMoment)
  | "flash"         // short fade — reuses CrisisGlitch with brief duration
  | "crisis";       // longer alarming fade — reuses CrisisGlitch with full duration

export type SlashRoute = {
  pattern: RegExp;
  kind: EffectKind;
  line: string;
  durationMs?: number; // override default for this kind
};

// Order matters: first match wins. More specific patterns first.
//
// Bubble lines are deliberately generic — no anime quotes, no copyrighted
// phrases. A personality JSON (`public/personalities/*.json`) can override
// any of these via `reactions["UserPromptSubmit"]` if the user wants
// flavor on a private fork.
const ROUTES: ReadonlyArray<SlashRoute> = [
  // Concentration / boost commands → energy gather
  {
    pattern: /^\/(effort|focus|concentrate|think|deep)\b/i,
    kind: "energy_gather",
    line: "🔥 集中精神中…",
    durationMs: 6000,
  },
  // Project init / bootstrap → energy gather
  {
    pattern: /^\/(init|setup|bootstrap|boot)\b/i,
    kind: "energy_gather",
    line: "🌐 啟動中…",
    durationMs: 5000,
  },
  // Review / audit / inspect → triumph
  {
    pattern: /^\/(review|audit|inspect|scan)\b/i,
    kind: "triumph",
    line: "🔍 仔細看每一行。",
    durationMs: 4000,
  },
  // Refactor / fix → triumph (success-flavored cinematic for completion)
  {
    pattern: /^\/(fix|refactor|rewrite|cleanup)\b/i,
    kind: "triumph",
    line: "🔧 重構這段邏輯。",
    durationMs: 4000,
  },
  // Explanation / walkthrough → triumph
  {
    pattern: /^\/(explain|why|walkthrough|describe)\b/i,
    kind: "triumph",
    line: "💡 來推理一下。",
    durationMs: 3500,
  },
  // Test runs → short flash
  {
    pattern: /^\/(test|run|verify)\b/i,
    kind: "flash",
    line: "🎯 開始跑測試。",
    durationMs: 1500,
  },
  // Cleanup commands → short flash
  {
    pattern: /^\/(compact|clear|tidy|reset)\b/i,
    kind: "flash",
    line: "✨ 清乾淨。",
    durationMs: 1200,
  },
  // Adding new things → short flash
  {
    pattern: /^\/(add|new|create|make)\b/i,
    kind: "flash",
    line: "➕ 加進來。",
    durationMs: 1500,
  },
  // Bug / error / diagnose → longer crisis flavor
  {
    pattern: /^\/(bug|error|diagnose|debug|fault)\b/i,
    kind: "crisis",
    line: "🐛 發現異常…",
    durationMs: 3200,
  },
  // Search / find / grep / lookup → focus vignette (triumph reused)
  {
    pattern: /^\/(search|find|grep|lookup|locate)\b/i,
    kind: "triumph",
    line: "🔎 找找看…",
    durationMs: 3500,
  },
  // Delete / remove / nuke → alarming crisis flavor
  {
    pattern: /^\/(delete|remove|nuke|destroy|drop)\b/i,
    kind: "crisis",
    line: "💥 移除中…",
    durationMs: 3200,
  },
];

export type RouteResult = {
  kind: EffectKind;
  line: string;
  durationMs: number;
};

const DEFAULT_DURATION_MS: Record<EffectKind, number> = {
  energy_gather: 6000,
  triumph: 4000,
  flash: 1200,
  crisis: 3200,
};

export function routeSlashCommand(prompt: string): RouteResult | null {
  if (typeof prompt !== "string") return null;
  const trimmed = prompt.trimStart();
  if (!trimmed.startsWith("/")) return null;
  for (const route of ROUTES) {
    if (route.pattern.test(trimmed)) {
      return {
        kind: route.kind,
        line: route.line,
        durationMs: route.durationMs ?? DEFAULT_DURATION_MS[route.kind],
      };
    }
  }
  return null;
}
