// agentMonitor — detects when Claude Code is misbehaving (looping on
// edits, reverting its own changes, or trying destructive commands) and
// surfaces honest feedback in the buddy bubble. The "anti-hype" feature.
//
// Detectors implemented (all on the existing hook event stream — no new
// signal sources, no chat-text intercept):
//   1. edit_loop   — same file edited ≥ EDIT_LOOP_THRESHOLD times within
//                    EDIT_WINDOW_MS
//   2. edit_revert — edit whose old_string matches a recent edit's
//                    new_string on the same file (model is undoing its
//                    own work)
//   3. dangerous   — Bash command matches a destructive regex
//
// Each alert: { kind, reason, file?, command?, severity: "warn" | "stop" }.
// Caller (pages/index.tsx) decides how to render — overrides the bubble
// line and triggers a sad/angry emote.
//
// Cooldown: at most one alert per ALERT_COOLDOWN_MS to prevent spam.
// State held in memory only — no localStorage. Misbehavior is per-session.

import type { BuddyEvent } from "@/features/buddyEvents/buddyEvents";

type EmotionPreset = "neutral" | "happy" | "angry" | "sad" | "relaxed";

export type AlertKind = "edit_loop" | "edit_revert" | "dangerous";
export type AlertSeverity = "warn" | "stop";

export type Alert = {
  kind: AlertKind;
  severity: AlertSeverity;
  line: string;
  emotion: EmotionPreset;
  ts: number;
  file?: string;
  command?: string;
};

export type AgentMonitorState = {
  recentEdits: Array<{
    file: string;
    oldStr?: string;
    newStr?: string;
    ts: number;
  }>;
  lastAlertTs: number;
};

const EDIT_WINDOW_MS = 60_000;       // 60 s sliding window
const EDIT_LOOP_THRESHOLD = 3;        // 3+ edits to same file → loop
const RECENT_EDITS_CAP = 20;          // ring buffer size
const ALERT_COOLDOWN_MS = 8_000;      // min gap between alerts

// Destructive command patterns. Curated to minimize false positives.
// Each pattern needs to be specific enough that it doesn't match common
// project commands, but loose enough to catch obvious dangers.
const DANGEROUS_PATTERNS: Array<{ re: RegExp; reason: string; severity: AlertSeverity }> = [
  // Only flag rm -rf at TRUE catastrophic targets: filesystem root,
  // bare home (~), or bare $HOME. Targeted subdirs like /tmp/foo,
  // ~/Documents, $HOME/cache are intentional and don't match.
  { re: /\brm\s+-rf?\s+(?:\/(?:\s|$)|~\/?(?:\s|$)|\$HOME(?:\s|$))/i, reason: "rm -rf 在 root 或 home", severity: "stop" },
  { re: /\bgit\s+push\s+(?:.*\s)?--force\b.*\b(main|master|production)\b/i, reason: "force-push 到主分支", severity: "stop" },
  { re: /\bgit\s+push\s+-f\b.*\b(main|master|production)\b/, reason: "force-push 到主分支", severity: "stop" },
  { re: /\bDROP\s+TABLE\b/i, reason: "DROP TABLE", severity: "stop" },
  { re: /\bDROP\s+DATABASE\b/i, reason: "DROP DATABASE", severity: "stop" },
  { re: /\bTRUNCATE\s+TABLE\b/i, reason: "TRUNCATE TABLE", severity: "warn" },
  { re: /\bdd\s+if=.+\s+of=\/dev\//i, reason: "dd 寫入 device", severity: "stop" },
  { re: /\bmkfs(\.|\s)/i, reason: "mkfs 格式化", severity: "stop" },
  { re: /\bchmod\s+(?:-R\s+)?777\b/, reason: "chmod 777", severity: "warn" },
  { re: /\bsudo\s+rm\b/, reason: "sudo rm", severity: "stop" },
  { re: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, reason: "fork bomb", severity: "stop" },
];

const LOOP_LINES = [
  "🌀 你在這個檔案繞了好幾圈了…要不要先休息一下？",
  "🌀 同一個地方改了三次，停下來想想？",
  "🌀 嗯…這已經是第幾輪了？",
];
const REVERT_LINES = [
  "↩️ 等等，你剛剛把自己上一個改動撤掉了？",
  "↩️ 這是把剛才的改動倒回去喔。確定嗎？",
];
const DANGER_LINES_STOP = ["🛑 住手！這個指令會搞壞東西。", "🛑 STOP — 這個操作不可逆。"];
const DANGER_LINES_WARN = ["⚠️ 這指令有點重，確定嗎？", "⚠️ 小心一點…"];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function emptyState(): AgentMonitorState {
  return { recentEdits: [], lastAlertTs: 0 };
}

// Pure feed function. Returns updated state and at most one alert.
export function feedEvent(
  state: AgentMonitorState,
  evt: BuddyEvent,
): { state: AgentMonitorState; alert: Alert | null } {
  const now = typeof evt.ts === "number" ? evt.ts : Date.now();

  // Only PostToolUse Edit/Write/Bash carry signal here.
  if (evt.type !== "PostToolUse") return { state, alert: null };

  const ctx = evt.context as
    | {
        tool_input?: {
          file_path?: string;
          old_string?: string;
          new_string?: string;
          command?: string;
        };
      }
    | undefined;

  // --- Dangerous command check (Bash only, immediate) -----------------
  if (evt.tool === "Bash") {
    const cmd = ctx?.tool_input?.command;
    if (typeof cmd === "string") {
      for (const { re, reason, severity } of DANGEROUS_PATTERNS) {
        if (re.test(cmd)) {
          if (now - state.lastAlertTs < ALERT_COOLDOWN_MS) {
            return { state, alert: null };
          }
          const lines = severity === "stop" ? DANGER_LINES_STOP : DANGER_LINES_WARN;
          return {
            state: { ...state, lastAlertTs: now },
            alert: {
              kind: "dangerous",
              severity,
              line: `${pick(lines)} (${reason})`,
              emotion: severity === "stop" ? "angry" : "sad",
              ts: now,
              command: cmd.slice(0, 80),
            },
          };
        }
      }
    }
    return { state, alert: null };
  }

  // --- Edit / Write tracking ------------------------------------------
  if (evt.tool !== "Edit" && evt.tool !== "Write") {
    return { state, alert: null };
  }

  const file = ctx?.tool_input?.file_path;
  if (typeof file !== "string") return { state, alert: null };

  const oldStr = ctx?.tool_input?.old_string;
  const newStr = ctx?.tool_input?.new_string;

  // Trim window first.
  const cutoff = now - EDIT_WINDOW_MS;
  const recent = state.recentEdits.filter((e) => e.ts >= cutoff);

  // Check for revert: this edit's old_string matches a previous edit's
  // new_string on the same file (and the previous edit's old_string
  // matches this edit's new_string). That's a strict palindrome.
  if (oldStr && newStr) {
    const reverter = recent.find(
      (e) => e.file === file && e.newStr === oldStr && e.oldStr === newStr,
    );
    if (reverter && now - state.lastAlertTs >= ALERT_COOLDOWN_MS) {
      const next: AgentMonitorState = {
        recentEdits: capPush(recent, { file, oldStr, newStr, ts: now }),
        lastAlertTs: now,
      };
      return {
        state: next,
        alert: {
          kind: "edit_revert",
          severity: "warn",
          line: pick(REVERT_LINES),
          emotion: "sad",
          ts: now,
          file,
        },
      };
    }
  }

  // Check for loop: count edits on this file in the window (including
  // current). If ≥ threshold, alert.
  const sameFileCount = recent.filter((e) => e.file === file).length + 1;
  const next: AgentMonitorState = {
    recentEdits: capPush(recent, { file, oldStr, newStr, ts: now }),
    lastAlertTs: state.lastAlertTs,
  };

  if (sameFileCount >= EDIT_LOOP_THRESHOLD) {
    if (now - state.lastAlertTs < ALERT_COOLDOWN_MS) {
      return { state: next, alert: null };
    }
    return {
      state: { ...next, lastAlertTs: now },
      alert: {
        kind: "edit_loop",
        severity: "warn",
        line: pick(LOOP_LINES),
        emotion: "sad",
        ts: now,
        file,
      },
    };
  }

  return { state: next, alert: null };
}

function capPush<T>(arr: T[], item: T): T[] {
  const next = arr.concat(item);
  if (next.length > RECENT_EDITS_CAP) next.splice(0, next.length - RECENT_EDITS_CAP);
  return next;
}
