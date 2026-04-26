// memoryStream — append-only log of significant events derived from the
// hook stream, capped at MAX_ENTRIES. The buddy uses this to surface a
// "remember when..." line on SessionStart, giving Lumina the same
// continuity-of-companionship feel that Project Airi has, but built on a
// rolling localStorage buffer instead of a database.
//
// What counts as a "memory" (kept narrow on purpose):
//   - achievement unlocks (always positive)
//   - test_pass / test_fail with counts (positive / mixed)
//   - git push (positive)
//   - git commit with fix-pattern message (positive — "we fixed something")
//   - SessionStart / SessionEnd (neutral session boundaries)
//
// Storage key: lumina.memoryStream. Schema-versioned. Per-user-per-browser.
//
// What this is NOT:
//   - A filesystem log. Per-user state belongs in localStorage.
//   - An idle-reminiscence trigger. Bridge stays dumb; the only recall
//     point is SessionStart, which is deterministic and rare.
//   - A growth/unlock system. Achievements already cover that.

import {
  detectGit,
  detectToolResult,
  type BuddyEvent,
} from "@/features/buddyEvents/buddyEvents";
import { getLocale } from "@/features/i18n/i18n";

function L(zh: string, en: string, ja: string): string {
  const l = getLocale();
  return l === "en" ? en : l === "ja" ? ja : zh;
}

const STORAGE_KEY = "lumina.memoryStream";
const SCHEMA_VERSION = 1;
const MAX_ENTRIES = 200;
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const FIX_PATTERN = /\b(fix|bug|patch|hotfix|repair|resolve)\b/i;

export type Sentiment = "positive" | "neutral" | "negative";

export type MemoryEntry = {
  ts: number;
  kind: string;
  summary: string;
  sentiment: Sentiment;
};

export type MemoryState = {
  version: number;
  entries: MemoryEntry[];
};

function emptyState(): MemoryState {
  return { version: SCHEMA_VERSION, entries: [] };
}

export function loadMemory(): MemoryState {
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<MemoryState>;
    if (parsed.version !== SCHEMA_VERSION) return emptyState();
    return {
      version: SCHEMA_VERSION,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch {
    return emptyState();
  }
}

export function saveMemory(state: MemoryState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function clearMemory(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

function append(state: MemoryState, entry: MemoryEntry): MemoryState {
  const entries = state.entries.concat(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  return { version: state.version, entries };
}

// Derive at most one memory entry per event. Returns null if the event
// isn't memorable. Achievement unlocks are recorded by the achievement
// system and *also* fed in here from index.tsx via recordAchievementMemory.
export function memoryFromEvent(evt: BuddyEvent): MemoryEntry | null {
  const ts = typeof evt.ts === "number" ? evt.ts : Date.now();

  if (evt.type === "SessionStart") {
    return { ts, kind: "session_start", summary: L("開始一段 session", "started a session", "セッションを開始"), sentiment: "neutral" };
  }
  if (evt.type === "SessionEnd") {
    return { ts, kind: "session_end", summary: L("結束一段 session", "ended a session", "セッションを終了"), sentiment: "neutral" };
  }

  if (evt.type === "PostToolUse" && evt.tool === "Bash") {
    const git = detectGit(evt);
    if (git) {
      if (git.op === "push") {
        return { ts, kind: "git_push", summary: L("推上去了", "pushed to remote", "プッシュしました"), sentiment: "positive" };
      }
      if (git.op === "commit" && git.message && FIX_PATTERN.test(git.message)) {
        const msg = git.message.length > 30 ? git.message.slice(0, 28) + "…" : git.message;
        return { ts, kind: "git_fix_commit", summary: L(`修了 ${msg}`, `fixed: ${msg}`, `修正: ${msg}`), sentiment: "positive" };
      }
    }
    const result = detectToolResult(evt);
    if (result?.kind === "test") {
      if (result.succeeded) {
        return {
          ts,
          kind: "test_pass",
          summary: result.passed != null
            ? L(`${result.passed} 個測試通過`, `${result.passed} tests passed`, `${result.passed}個テスト通過`)
            : L("測試通過", "tests passed", "テスト通過"),
          sentiment: "positive",
        };
      } else if (result.failed != null && result.failed > 0) {
        return {
          ts,
          kind: "test_fail",
          summary: L(`${result.failed} 個測試失敗`, `${result.failed} tests failed`, `${result.failed}個テスト失敗`),
          sentiment: "negative",
        };
      }
    }
  }

  return null;
}

// Single entry point for the hook stream. Returns the new state and
// whether it changed.
export function feedEvent(
  state: MemoryState,
  evt: BuddyEvent,
): { state: MemoryState; changed: boolean } {
  const entry = memoryFromEvent(evt);
  if (!entry) return { state, changed: false };
  return { state: append(state, entry), changed: true };
}

// Achievement unlocks aren't on the BuddyEvent stream — they're computed
// client-side. This lets index.tsx push them through the same memory
// pipeline so reminiscences can include "你解鎖了 X".
export function recordAchievementMemory(
  state: MemoryState,
  achievementName: string,
): MemoryState {
  return append(state, {
    ts: Date.now(),
    kind: "achievement_unlock",
    summary: `解鎖 ${achievementName}`,
    sentiment: "positive",
  });
}

// Pick a positive memory from the last RECENT_WINDOW_MS to surface as a
// SessionStart greeting. Excludes anything older than the window so the
// buddy doesn't reminisce about ancient stuff. Returns null if nothing
// fitting exists — caller falls back to the default "Claude 來上班了"
// greeting.
export function pickReminiscence(
  state: MemoryState,
  now: number = Date.now(),
): string | null {
  const cutoff = now - RECENT_WINDOW_MS;
  const candidates = state.entries.filter(
    (e) => e.ts >= cutoff && e.sentiment === "positive",
  );
  if (candidates.length === 0) return null;
  // Bias toward more recent memories (last 25% of the window). Picks the
  // last entry from the candidate slice — Claude tends to land here on
  // session resume after a real activity gap.
  const pick = candidates[candidates.length - 1];
  // Phrase by kind — short, evocative, no LLM call required.
  const ageMin = Math.max(1, Math.round((now - pick.ts) / 60000));
  const ageStr = ageMin < 60
    ? L(`${ageMin} 分鐘前`, `${ageMin}m ago`, `${ageMin}分前`)
    : ageMin < 60 * 24
    ? L(`${Math.round(ageMin / 60)} 小時前`, `${Math.round(ageMin / 60)}h ago`, `${Math.round(ageMin / 60)}時間前`)
    : L(`${Math.round(ageMin / (60 * 24))} 天前`, `${Math.round(ageMin / (60 * 24))}d ago`, `${Math.round(ageMin / (60 * 24))}日前`);
  return L(
    `💭 ${ageStr}我們${pick.summary}，記得嗎？`,
    `💭 ${ageStr} we ${pick.summary}, remember?`,
    `💭 ${ageStr}に${pick.summary}しましたね。`,
  );
}
