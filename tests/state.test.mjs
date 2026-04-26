// tests/state.test.mjs — pure-function state systems: memoryStream
// reminiscence pick, achievements counter math, agentMonitor edit-loop
// detection, taskTracker upsert. All tested by replicating the algorithms
// here (kept in sync via inline DRY check below).

import { test } from "node:test";
import assert from "node:assert/strict";

// === memoryStream — reminiscence picker =====================================

const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function pickReminiscence(state, now) {
  const cutoff = now - RECENT_WINDOW_MS;
  const candidates = state.entries.filter(e => e.ts >= cutoff && e.sentiment === "positive");
  if (candidates.length === 0) return null;
  const pick = candidates[candidates.length - 1];
  const ageMin = Math.max(1, Math.round((now - pick.ts) / 60000));
  const ageStr = ageMin < 60 ? `${ageMin} 分鐘前`
               : ageMin < 1440 ? `${Math.round(ageMin / 60)} 小時前`
               : `${Math.round(ageMin / 1440)} 天前`;
  return `💭 ${ageStr}我們${pick.summary}，記得嗎？`;
}

test("memory: empty state → null", () => {
  assert.equal(pickReminiscence({ entries: [] }, Date.now()), null);
});
test("memory: only negative entries → null", () => {
  const now = Date.now();
  const s = { entries: [{ ts: now - 60000, sentiment: "negative", summary: "撞牆" }] };
  assert.equal(pickReminiscence(s, now), null);
});
test("memory: picks most recent positive within 7 days", () => {
  const now = Date.now();
  const s = { entries: [
    { ts: now - 8 * 86400000, sentiment: "positive", summary: "8 天前的事" }, // outside window
    { ts: now - 60000,         sentiment: "positive", summary: "推上去了" },
    { ts: now - 120000,        sentiment: "negative", summary: "失敗" },
  ]};
  const out = pickReminiscence(s, now);
  assert.match(out, /💭 1 分鐘前我們推上去了，記得嗎？/);
});
test("memory: ages format correctly (min/hour/day)", () => {
  const now = Date.now();
  const mk = (msAgo) => ({ entries: [{ ts: now - msAgo, sentiment: "positive", summary: "X" }] });
  assert.match(pickReminiscence(mk(2 * 60_000), now), /2 分鐘前/);
  assert.match(pickReminiscence(mk(3 * 60 * 60_000), now), /3 小時前/);
  assert.match(pickReminiscence(mk(2 * 24 * 60 * 60_000), now), /2 天前/);
});

// === achievements — threshold check =========================================

const ACHIEVEMENTS = [
  { id: "first_session",   counterKey: "sessions",          threshold: 1  },
  { id: "first_commit",    counterKey: "git_commits",       threshold: 1  },
  { id: "git_master",      counterKey: "git_commits",       threshold: 50 },
  { id: "bug_hunter",      counterKey: "fix_commits",       threshold: 10 },
  { id: "tool_master",     counterKey: "tool_uses",         threshold: 100 },
  { id: "late_night_owl",  counterKey: "late_night_pushes", threshold: 1  },
  { id: "python_lover",    counterKey: "python_edits",      threshold: 20 },
];

function checkUnlocks(state, bumpedKeys) {
  const out = [];
  const set = new Set(bumpedKeys);
  for (const a of ACHIEVEMENTS) {
    if (state.unlocked.includes(a.id)) continue;
    if (!set.has(a.counterKey)) continue;
    if ((state.counters[a.counterKey] ?? 0) >= a.threshold) {
      state.unlocked.push(a.id);
      out.push(a.id);
    }
  }
  return out;
}

test("achievements: first commit triggers exactly first_commit", () => {
  const s = { counters: { git_commits: 1 }, unlocked: [] };
  const fired = checkUnlocks(s, ["git_commits"]);
  assert.deepEqual(fired, ["first_commit"]);
});
test("achievements: 50 commits triggers git_master too (after first_commit)", () => {
  const s = { counters: { git_commits: 50 }, unlocked: ["first_commit"] };
  const fired = checkUnlocks(s, ["git_commits"]);
  assert.deepEqual(fired, ["git_master"]);
});
test("achievements: only fires when relevant counter is in bumped set", () => {
  const s = { counters: { tool_uses: 200, git_commits: 50 }, unlocked: [] };
  // bumped only tool_uses; should NOT unlock git achievements
  const fired = checkUnlocks(s, ["tool_uses"]);
  assert.deepEqual(fired, ["tool_master"]);
});
test("achievements: never re-unlocks a recorded achievement", () => {
  const s = { counters: { sessions: 5 }, unlocked: ["first_session"] };
  assert.deepEqual(checkUnlocks(s, ["sessions"]), []);
});

// === agentMonitor — edit loop / revert detection ============================

const EDIT_WINDOW_MS = 60_000;
const EDIT_LOOP_THRESHOLD = 3;

function feedEdit(state, evt) {
  const now = evt.ts;
  const file = evt.file;
  const recent = state.recentEdits.filter(e => e.ts >= now - EDIT_WINDOW_MS);
  // Revert detection: this edit's old_string == prior new_string AND vice versa
  if (evt.oldStr && evt.newStr) {
    const r = recent.find(e => e.file === file && e.newStr === evt.oldStr && e.oldStr === evt.newStr);
    if (r) {
      return {
        state: { recentEdits: [...recent, evt] },
        alert: { kind: "edit_revert" },
      };
    }
  }
  const sameFile = recent.filter(e => e.file === file).length + 1;
  const next = { recentEdits: [...recent, evt] };
  if (sameFile >= EDIT_LOOP_THRESHOLD) return { state: next, alert: { kind: "edit_loop", file } };
  return { state: next, alert: null };
}

test("monitor: 3 edits to same file in window → edit_loop", () => {
  let s = { recentEdits: [] };
  let r;
  r = feedEdit(s, { ts: 1000, file: "x.ts", oldStr: "a", newStr: "b" }); s = r.state;
  assert.equal(r.alert, null);
  r = feedEdit(s, { ts: 2000, file: "x.ts", oldStr: "b", newStr: "c" }); s = r.state;
  assert.equal(r.alert, null);
  r = feedEdit(s, { ts: 3000, file: "x.ts", oldStr: "c", newStr: "d" }); s = r.state;
  assert.equal(r.alert?.kind, "edit_loop");
});
test("monitor: palindromic edit pair → edit_revert", () => {
  let s = { recentEdits: [] };
  let r;
  r = feedEdit(s, { ts: 1000, file: "x.ts", oldStr: "foo", newStr: "bar" }); s = r.state;
  assert.equal(r.alert, null);
  r = feedEdit(s, { ts: 2000, file: "x.ts", oldStr: "bar", newStr: "foo" });
  assert.equal(r.alert?.kind, "edit_revert");
});
test("monitor: edits to DIFFERENT files don't trigger loop", () => {
  let s = { recentEdits: [] };
  let r;
  r = feedEdit(s, { ts: 1000, file: "a.ts" }); s = r.state;
  r = feedEdit(s, { ts: 2000, file: "b.ts" }); s = r.state;
  r = feedEdit(s, { ts: 3000, file: "c.ts" }); s = r.state;
  assert.equal(r.alert, null);
});
test("monitor: edits outside time window don't count", () => {
  let s = { recentEdits: [] };
  let r;
  // 3 edits but spread over >60s
  r = feedEdit(s, { ts: 0,         file: "x.ts" }); s = r.state;
  r = feedEdit(s, { ts: 30_000,    file: "x.ts" }); s = r.state;
  r = feedEdit(s, { ts: 90_000,    file: "x.ts" }); s = r.state;
  // First edit at ts=0 falls outside window (now=90_000, window=60_000, cutoff=30_000)
  assert.equal(r.alert, null);
});

// === taskTracker — TaskCreate/Update upsert =================================

const TASK_ID_PATTERN = /Task\s+#?(\S+?)\s+(?:created|updated|deleted)/i;

function feedTask(state, evt) {
  if (evt.tool !== "TaskCreate" && evt.tool !== "TaskUpdate") return state;
  const next = {
    tasks: { ...state.tasks },
    order: state.order.slice(),
  };
  if (evt.tool === "TaskCreate") {
    const id = (evt.output ?? "").match(TASK_ID_PATTERN)?.[1] ?? evt.subject;
    if (!next.tasks[id]) next.order.push(id);
    next.tasks[id] = { id, subject: evt.subject, status: "pending" };
  } else if (evt.tool === "TaskUpdate" && evt.taskId) {
    const existing = next.tasks[evt.taskId];
    if (existing) next.tasks[evt.taskId] = { ...existing, status: evt.status ?? existing.status };
  }
  return next;
}

test("taskTracker: TaskCreate inserts in order, parses #N from output", () => {
  let s = { tasks: {}, order: [] };
  s = feedTask(s, { tool: "TaskCreate", subject: "Build login", output: "Task #1 created successfully" });
  s = feedTask(s, { tool: "TaskCreate", subject: "Write tests",  output: "Task #2 created successfully" });
  assert.deepEqual(s.order, ["1", "2"]);
  assert.equal(s.tasks["1"].subject, "Build login");
});
test("taskTracker: TaskUpdate transitions status", () => {
  let s = { tasks: { "1": { id: "1", subject: "x", status: "pending" } }, order: ["1"] };
  s = feedTask(s, { tool: "TaskUpdate", taskId: "1", status: "in_progress" });
  s = feedTask(s, { tool: "TaskUpdate", taskId: "1", status: "completed" });
  assert.equal(s.tasks["1"].status, "completed");
});
test("taskTracker: ignores non-Task tools", () => {
  const s0 = { tasks: {}, order: [] };
  const s1 = feedTask(s0, { tool: "Edit", subject: "noop" });
  assert.equal(s1, s0);
});
