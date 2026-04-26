// Achievements — counter-driven unlocks derived from the same buddy event
// stream that drives reactions. Pure functions; no React imports, no global
// state. Caller (pages/index.tsx) owns the localStorage round-trip and
// re-renders on unlock.
//
// Data model in localStorage (`lumina.achievements`):
//   {
//     version: 1,
//     counters: { git_commits: 23, tool_uses: 412, ... },
//     unlocked: ["first_commit", "tool_master"],     // ordered by unlock
//     unlockTimes: { first_commit: 1730000000000, ... }
//   }
//
// To add an achievement:
//   1. Append an entry to ACHIEVEMENTS below with a unique id, a counter
//      key, and a threshold.
//   2. Make sure bumpCounters bumps that counter on the right event(s).
//      For new event types (different counter), add a branch there.
//   3. That's it — checkUnlocks runs over every counter mutation.

import type { BuddyEvent } from "@/features/buddyEvents/buddyEvents";
import { detectGit, detectLanguage } from "@/features/buddyEvents/buddyEvents";

const STORAGE_KEY = "lumina.achievements";
const SCHEMA_VERSION = 1;

export type AchievementDef = {
  id: string;
  name: string;
  description: string;
  icon: string;       // single emoji
  counterKey: string;
  threshold: number;
};

export type AchievementState = {
  version: number;
  counters: Record<string, number>;
  unlocked: string[];
  unlockTimes: Record<string, number>;
};

export const ACHIEVEMENTS: ReadonlyArray<AchievementDef> = [
  {
    id: "first_session",
    name: "初次見面",
    description: "啟動 Claude Code 一次",
    icon: "👋",
    counterKey: "sessions",
    threshold: 1,
  },
  {
    id: "first_commit",
    name: "第一個 commit",
    description: "完成第一次 git commit",
    icon: "🌱",
    counterKey: "git_commits",
    threshold: 1,
  },
  {
    id: "first_push",
    name: "送上線",
    description: "完成第一次 git push",
    icon: "🚀",
    counterKey: "git_pushes",
    threshold: 1,
  },
  {
    id: "git_master",
    name: "Git 達人",
    description: "累計 50 次 commit",
    icon: "🏅",
    counterKey: "git_commits",
    threshold: 50,
  },
  {
    id: "late_night_owl",
    name: "深夜貓頭鷹",
    description: "在 00:00–04:00 期間 push",
    icon: "🦉",
    counterKey: "late_night_pushes",
    threshold: 1,
  },
  {
    id: "bug_hunter",
    name: "Bug 獵人",
    description: "10 個含 fix/bug/patch 的 commit",
    icon: "🔍",
    counterKey: "fix_commits",
    threshold: 10,
  },
  {
    id: "tool_master",
    name: "工具大師",
    description: "100 次工具呼叫（Edit/Bash/Read/...）",
    icon: "🔧",
    counterKey: "tool_uses",
    threshold: 100,
  },
  {
    id: "python_lover",
    name: "Python 愛好者",
    description: "編輯 .py 檔 20 次",
    icon: "🐍",
    counterKey: "python_edits",
    threshold: 20,
  },
  {
    id: "rust_warrior",
    name: "Rust 戰士",
    description: "編輯 .rs 檔 20 次",
    icon: "🦀",
    counterKey: "rust_edits",
    threshold: 20,
  },
  {
    id: "ts_native",
    name: "TS 原住民",
    description: "編輯 .ts/.tsx 檔 50 次",
    icon: "🔷",
    counterKey: "typescript_edits",
    threshold: 50,
  },
];

const FIX_PATTERN = /\b(fix|bug|patch|hotfix|repair|resolve)\b/i;

function emptyState(): AchievementState {
  return {
    version: SCHEMA_VERSION,
    counters: {},
    unlocked: [],
    unlockTimes: {},
  };
}

export function loadState(): AchievementState {
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<AchievementState>;
    if (parsed.version !== SCHEMA_VERSION) return emptyState();
    return {
      version: SCHEMA_VERSION,
      counters: parsed.counters ?? {},
      unlocked: Array.isArray(parsed.unlocked) ? parsed.unlocked : [],
      unlockTimes: parsed.unlockTimes ?? {},
    };
  } catch {
    return emptyState();
  }
}

export function saveState(state: AchievementState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage full or disabled — silent.
  }
}

export function reset(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

// Mutates `state` in place. Returns the list of counter keys that changed,
// so the unlock check only walks relevant achievements.
function bumpCounters(state: AchievementState, evt: BuddyEvent): string[] {
  const bumped: string[] = [];
  const bump = (key: string, by = 1) => {
    state.counters[key] = (state.counters[key] ?? 0) + by;
    bumped.push(key);
  };

  if (evt.type === "SessionStart") {
    bump("sessions");
  }

  if (evt.type === "PostToolUse") {
    bump("tool_uses");

    const lang = detectLanguage(evt);
    if (lang) bump(`${lang}_edits`);

    const git = detectGit(evt);
    if (git) {
      if (git.op === "commit") {
        bump("git_commits");
        if (git.message && FIX_PATTERN.test(git.message)) {
          bump("fix_commits");
        }
      } else if (git.op === "push") {
        bump("git_pushes");
        const hour = new Date().getHours();
        if (hour >= 0 && hour < 4) bump("late_night_pushes");
      }
    }
  }

  return bumped;
}

function checkUnlocks(
  state: AchievementState,
  bumpedKeys: string[],
): AchievementDef[] {
  if (bumpedKeys.length === 0) return [];
  const newlyUnlocked: AchievementDef[] = [];
  const bumpedSet = new Set(bumpedKeys);
  const now = Date.now();
  for (const a of ACHIEVEMENTS) {
    if (state.unlocked.includes(a.id)) continue;
    if (!bumpedSet.has(a.counterKey)) continue;
    if ((state.counters[a.counterKey] ?? 0) >= a.threshold) {
      state.unlocked.push(a.id);
      state.unlockTimes[a.id] = now;
      newlyUnlocked.push(a);
    }
  }
  return newlyUnlocked;
}

// Single entry point. Caller passes in a fresh-loaded state (or carries one
// across calls) and writes the result back to localStorage when unlocks > 0.
//
// Returns a NEW state object (immutable from the caller's perspective), so
// React's setState({...result.state}) triggers a re-render correctly.
export function feedEvent(
  state: AchievementState,
  evt: BuddyEvent,
): { state: AchievementState; unlocked: AchievementDef[] } {
  // Clone to keep React happy.
  const next: AchievementState = {
    version: state.version,
    counters: { ...state.counters },
    unlocked: state.unlocked.slice(),
    unlockTimes: { ...state.unlockTimes },
  };
  const bumped = bumpCounters(next, evt);
  const unlocked = checkUnlocks(next, bumped);
  return { state: next, unlocked };
}
