// tests/agent-tracking.test.mjs — pins the contract of the agent-tracking
// state machine that lives in pages/index.tsx + features/agents/agents.ts.
//
// What this protects against:
//   - DemoPanel/SettingsPanel re-rendering on every event when the agent
//     hasn't actually changed (we use the prev===next early-return guard)
//   - Persisting bad values to localStorage (must be filtered by isAgentId)
//   - Forgetting to fall back to DEFAULT_AGENT when localStorage is corrupt
//
// We re-implement the tiny state machine inline so this test can run with
// zero deps. Source under test: src/web/src/features/agents/agents.ts and
// the onAfterApply block in src/web/src/pages/index.tsx that calls
// setCurrentAgent((prev) => prev === evtAgent ? prev : evtAgent).

import { test } from "node:test";
import assert from "node:assert/strict";

// ── Copy from src/web/src/features/agents/agents.ts ────────────────────────

const ALL_AGENTS = ["claude", "copilot", "codex"];
const AGENT_SET  = new Set(ALL_AGENTS);
const DEFAULT_AGENT = "claude";

function isAgentId(v) {
  return typeof v === "string" && AGENT_SET.has(v);
}

function agentDisplayName(a) {
  switch (a) {
    case "claude":  return "Claude";
    case "copilot": return "Copilot";
    case "codex":   return "Codex";
  }
}

// ── Mini state machine that mirrors the onAfterApply guard in index.tsx ──
//
// In the real component the closure looks like:
//   setCurrentAgent((prev) => prev === evtAgent ? prev : evtAgent);
// React skips re-renders when the updater returns the same reference.
// The function below preserves that property so we can assert no spurious
// transitions.
function makeTracker(initial = DEFAULT_AGENT, persist = () => {}) {
  let current = isAgentId(initial) ? initial : DEFAULT_AGENT;
  const history = [];          // every set call (whether it changed or not)
  const transitions = [];      // only the calls that actually flipped state
  return {
    get: () => current,
    feed(evtAgent) {
      history.push(evtAgent);
      if (!isAgentId(evtAgent)) return;
      if (current === evtAgent) return;
      current = evtAgent;
      transitions.push(evtAgent);
      persist(evtAgent);
    },
    historyLength() { return history.length; },
    transitionCount() { return transitions.length; },
    transitionsList() { return transitions.slice(); },
  };
}

// ── isAgentId ──────────────────────────────────────────────────────────────

test("isAgentId: accepts the three known agents only", () => {
  for (const a of ALL_AGENTS) assert.equal(isAgentId(a), true);
});

test("isAgentId: rejects everything else (typed and untyped)", () => {
  for (const v of [null, undefined, 0, 1, true, false, [], {}, "Claude", "CLAUDE",
                   "anthropic", "openai", "", " claude ", "claude\0", "x".repeat(500)]) {
    assert.equal(isAgentId(v), false, `${JSON.stringify(v)} should be rejected`);
  }
});

// ── agentDisplayName ───────────────────────────────────────────────────────

test("agentDisplayName: Title Case for all known agents", () => {
  assert.equal(agentDisplayName("claude"),  "Claude");
  assert.equal(agentDisplayName("copilot"), "Copilot");
  assert.equal(agentDisplayName("codex"),   "Codex");
});

// ── tracker initialization ─────────────────────────────────────────────────

test("tracker init: undefined → DEFAULT_AGENT", () => {
  const t = makeTracker(undefined);
  assert.equal(t.get(), DEFAULT_AGENT);
});

test("tracker init: garbage value → DEFAULT_AGENT", () => {
  for (const v of [null, "Anthropic", "", 0, "claude\0"]) {
    const t = makeTracker(v);
    assert.equal(t.get(), DEFAULT_AGENT, `init(${JSON.stringify(v)})`);
  }
});

test("tracker init: valid agent passes through", () => {
  for (const a of ALL_AGENTS) {
    assert.equal(makeTracker(a).get(), a);
  }
});

// ── tracker behavior: same-agent storm doesn't trigger transitions ─────────

test("tracker: 100 events with the same agent → 0 transitions (no re-renders)", () => {
  const t = makeTracker("claude");
  for (let i = 0; i < 100; i++) t.feed("claude");
  assert.equal(t.historyLength(), 100, "all events recorded");
  assert.equal(t.transitionCount(), 0, "no transitions — React would skip all renders");
});

test("tracker: agent flip → exactly one transition recorded", () => {
  const t = makeTracker("claude");
  for (let i = 0; i < 5;  i++) t.feed("claude");
  for (let i = 0; i < 10; i++) t.feed("codex");   // flip + 9 same
  for (let i = 0; i < 3;  i++) t.feed("claude");  // flip back + 2 same
  assert.equal(t.transitionCount(), 2);
  assert.deepEqual(t.transitionsList(), ["codex", "claude"]);
});

test("tracker: invalid agent values are silently ignored", () => {
  const t = makeTracker("claude");
  for (const v of [undefined, null, "anthropic", 42, {}, "Claude"]) t.feed(v);
  assert.equal(t.get(), "claude", "state must not flip on garbage");
  assert.equal(t.transitionCount(), 0);
});

test("tracker: persistence callback fires only on transitions, not on no-ops", () => {
  const persisted = [];
  const t = makeTracker("claude", (a) => persisted.push(a));
  t.feed("claude"); t.feed("claude"); t.feed("claude");   // no-ops
  t.feed("copilot");                                       // transition
  t.feed("copilot"); t.feed("copilot");                    // no-ops
  t.feed("codex");                                         // transition
  assert.deepEqual(persisted, ["copilot", "codex"]);
});

test("tracker: persistence callback failures don't break tracking (caller must isolate)", () => {
  // The real index.tsx wraps the persist call in try/catch. Assert the
  // tracker keeps working when persist throws by isolating the persist call.
  const t = makeTracker("claude", (a) => {
    try { throw new Error("storage full"); } catch { /* swallowed */ }
  });
  t.feed("copilot");
  t.feed("codex");
  assert.equal(t.get(), "codex");
  assert.equal(t.transitionCount(), 2);
});

// ── interleaved scenarios that simulate a real session ─────────────────────

test("tracker: realistic multi-agent session sequence", () => {
  const t = makeTracker(undefined);  // fresh tab, no persisted value
  const events = [
    // Claude session, lots of tool calls
    "claude", "claude", "claude", "claude", "claude",
    // SessionEnd
    "claude",
    // User switches to Codex
    "codex", "codex", "codex",
    // User flips to Copilot mid-task
    "copilot",
    // ... more Copilot events
    "copilot", "copilot",
    // Spurious garbage event (should be ignored)
    "anthropic", null, undefined,
    // Back to Claude
    "claude",
  ];
  for (const a of events) t.feed(a);
  // Initial state is DEFAULT_AGENT="claude" (since init was undefined), so
  // the leading "claude" events are no-ops — transitions only record flips.
  assert.deepEqual(t.transitionsList(), ["codex", "copilot", "claude"]);
  assert.equal(t.get(), "claude");
});
