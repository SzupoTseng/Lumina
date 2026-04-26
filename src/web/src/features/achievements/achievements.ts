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
import { getLocale } from "@/features/i18n/i18n";

function L(zh: string, en: string, ja: string): string {
  const l = getLocale();
  return l === "en" ? en : l === "ja" ? ja : zh;
}

const STORAGE_KEY = "lumina.achievements";
const SCHEMA_VERSION = 1;

export type AchievementDef = {
  id: string;
  name: () => string;
  description: () => string;
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
  { id: "first_session",    icon: "👋", counterKey: "sessions",          threshold: 1,
    name: () => L("初次見面",    "Hello World",        "はじめまして"),
    description: () => L("啟動 Claude Code 一次", "Start Claude Code once", "Claude Codeを一度起動する") },
  { id: "first_commit",     icon: "🌱", counterKey: "git_commits",        threshold: 1,
    name: () => L("第一個 commit", "First Commit",       "最初のコミット"),
    description: () => L("完成第一次 git commit", "First git commit", "最初のgitコミット") },
  { id: "first_push",       icon: "🚀", counterKey: "git_pushes",         threshold: 1,
    name: () => L("送上線",       "First Push",         "初プッシュ"),
    description: () => L("完成第一次 git push", "First git push", "最初のgitプッシュ") },
  { id: "git_master",       icon: "🏅", counterKey: "git_commits",        threshold: 50,
    name: () => L("Git 達人",     "Git Master",         "Git達人"),
    description: () => L("累計 50 次 commit", "50 total commits", "累計50コミット") },
  { id: "late_night_owl",   icon: "🦉", counterKey: "late_night_pushes",  threshold: 1,
    name: () => L("深夜貓頭鷹",   "Night Owl",          "深夜のフクロウ"),
    description: () => L("在 00:00–04:00 期間 push", "Push between 00:00–04:00", "00:00〜04:00にプッシュ") },
  { id: "bug_hunter",       icon: "🔍", counterKey: "fix_commits",        threshold: 10,
    name: () => L("Bug 獵人",     "Bug Hunter",         "バグハンター"),
    description: () => L("10 個含 fix/bug/patch 的 commit", "10 commits with fix/bug/patch", "fix/bug/patchを含むコミット10個") },
  { id: "tool_master",      icon: "🔧", counterKey: "tool_uses",          threshold: 100,
    name: () => L("工具大師",     "Tool Master",        "ツールマスター"),
    description: () => L("100 次工具呼叫", "100 tool calls", "100回ツール呼び出し") },
  { id: "python_lover",     icon: "🐍", counterKey: "python_edits",       threshold: 20,
    name: () => L("Python 愛好者","Python Lover",       "Python愛好者"),
    description: () => L("編輯 .py 檔 20 次", "Edit .py files 20 times", ".pyファイルを20回編集") },
  { id: "rust_warrior",     icon: "🦀", counterKey: "rust_edits",         threshold: 20,
    name: () => L("Rust 戰士",    "Rust Warrior",       "Rust戦士"),
    description: () => L("編輯 .rs 檔 20 次", "Edit .rs files 20 times", ".rsファイルを20回編集") },
  { id: "ts_native",        icon: "🔷", counterKey: "typescript_edits",   threshold: 50,
    name: () => L("TS 原住民",    "TS Native",          "TS原住民"),
    description: () => L("編輯 .ts/.tsx 檔 50 次", "Edit .ts/.tsx files 50 times", ".ts/.tsxファイルを50回編集") },
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
