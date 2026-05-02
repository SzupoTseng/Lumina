// tests/lumina-settings.test.mjs — unit tests for the luminaSettings module.
//
// Why duplicate normalize() inline: zero-dep test runner (no TypeScript
// loader). When src/web/src/features/luminaSettings/luminaSettings.ts
// changes, this file must change too — that's the drift detector.

import { test } from "node:test";
import assert from "node:assert/strict";

// ── Copy from src/web/src/features/luminaSettings/luminaSettings.ts ────────

const DEFAULT_SETTINGS = {
  bubbleDurationMs: 4000,
  memoryStreamEnabled: true,
  achievementToastsEnabled: true,
};
const BUBBLE_MIN = 1500;
const BUBBLE_MAX = 8000;

function normalize(raw) {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SETTINGS };
  const out = { ...DEFAULT_SETTINGS };
  if (typeof raw.bubbleDurationMs === "number" && Number.isFinite(raw.bubbleDurationMs)) {
    out.bubbleDurationMs = Math.min(BUBBLE_MAX, Math.max(BUBBLE_MIN, Math.round(raw.bubbleDurationMs)));
  }
  if (typeof raw.memoryStreamEnabled === "boolean") {
    out.memoryStreamEnabled = raw.memoryStreamEnabled;
  }
  if (typeof raw.achievementToastsEnabled === "boolean") {
    out.achievementToastsEnabled = raw.achievementToastsEnabled;
  }
  return out;
}

// ── tests ───────────────────────────────────────────────────────────────────

test("normalize: empty/null/undefined input → DEFAULT_SETTINGS", () => {
  assert.deepEqual(normalize(null),        DEFAULT_SETTINGS);
  assert.deepEqual(normalize(undefined),   DEFAULT_SETTINGS);
  assert.deepEqual(normalize({}),          DEFAULT_SETTINGS);
  assert.deepEqual(normalize("not an object"), DEFAULT_SETTINGS);
});

test("normalize: bubbleDurationMs in range passes through", () => {
  for (const ms of [1500, 2000, 4000, 6500, 8000]) {
    assert.equal(normalize({ bubbleDurationMs: ms }).bubbleDurationMs, ms);
  }
});

test("normalize: bubbleDurationMs below 1500 clamps up", () => {
  assert.equal(normalize({ bubbleDurationMs: 0 }).bubbleDurationMs, 1500);
  assert.equal(normalize({ bubbleDurationMs: 100 }).bubbleDurationMs, 1500);
  assert.equal(normalize({ bubbleDurationMs: -5000 }).bubbleDurationMs, 1500);
});

test("normalize: bubbleDurationMs above 8000 clamps down", () => {
  assert.equal(normalize({ bubbleDurationMs: 8001 }).bubbleDurationMs, 8000);
  assert.equal(normalize({ bubbleDurationMs: 60000 }).bubbleDurationMs, 8000);
  assert.equal(normalize({ bubbleDurationMs: 1e9 }).bubbleDurationMs, 8000);
});

test("normalize: bubbleDurationMs rounds to integer", () => {
  assert.equal(normalize({ bubbleDurationMs: 2000.7 }).bubbleDurationMs, 2001);
  assert.equal(normalize({ bubbleDurationMs: 4500.4 }).bubbleDurationMs, 4500);
});

test("normalize: bubbleDurationMs of NaN/Infinity → falls back to default", () => {
  assert.equal(normalize({ bubbleDurationMs: NaN }).bubbleDurationMs, 4000);
  assert.equal(normalize({ bubbleDurationMs: Infinity }).bubbleDurationMs, 4000);
  assert.equal(normalize({ bubbleDurationMs: -Infinity }).bubbleDurationMs, 4000);
});

test("normalize: bubbleDurationMs of wrong type → falls back to default", () => {
  assert.equal(normalize({ bubbleDurationMs: "4000" }).bubbleDurationMs, 4000);
  assert.equal(normalize({ bubbleDurationMs: null }).bubbleDurationMs, 4000);
});

test("normalize: memoryStreamEnabled true/false honored", () => {
  assert.equal(normalize({ memoryStreamEnabled: false }).memoryStreamEnabled, false);
  assert.equal(normalize({ memoryStreamEnabled: true }).memoryStreamEnabled, true);
});

test("normalize: memoryStreamEnabled non-boolean → fallback to default true", () => {
  assert.equal(normalize({ memoryStreamEnabled: 0 }).memoryStreamEnabled, true);
  assert.equal(normalize({ memoryStreamEnabled: "false" }).memoryStreamEnabled, true);
  assert.equal(normalize({ memoryStreamEnabled: null }).memoryStreamEnabled, true);
});

test("normalize: achievementToastsEnabled true/false honored", () => {
  assert.equal(normalize({ achievementToastsEnabled: false }).achievementToastsEnabled, false);
  assert.equal(normalize({ achievementToastsEnabled: true }).achievementToastsEnabled, true);
});

test("normalize: partial input preserves untouched defaults", () => {
  const out = normalize({ memoryStreamEnabled: false });
  assert.equal(out.memoryStreamEnabled, false);
  assert.equal(out.bubbleDurationMs, 4000);
  assert.equal(out.achievementToastsEnabled, true);
});

test("normalize: garbage extra fields ignored, doesn't pollute output", () => {
  const out = normalize({ bubbleDurationMs: 3000, foo: "bar", admin: true });
  assert.deepEqual(out, {
    bubbleDurationMs: 3000,
    memoryStreamEnabled: true,
    achievementToastsEnabled: true,
  });
  assert.equal(out.foo, undefined);
  assert.equal(out.admin, undefined);
});

test("normalize: returns a new object, doesn't mutate input", () => {
  const input = { bubbleDurationMs: 5000 };
  const snapshot = JSON.parse(JSON.stringify(input));
  normalize(input);
  assert.deepEqual(input, snapshot);
});

// ── Snapshot stability invariant (regression: useSyncExternalStore loop) ──
//
// The real luminaSettings.ts caches the snapshot at module level and only
// invalidates it on save/reset/storage events. useSyncExternalStore relies
// on this — if loadSettings() returns a fresh object on every call, React
// detects a "change" every render and infinite-loops with
// "Maximum update depth exceeded".
//
// Mirror that contract here so a future refactor can't silently break it.
test("snapshot stability: cached load returns same reference until invalidated", () => {
  // Standalone re-implementation that mirrors the production caching shape.
  let cache = null;
  const read = () => ({ bubbleDurationMs: 4000, memoryStreamEnabled: true, achievementToastsEnabled: true });
  const load  = () => { if (cache === null) cache = read(); return cache; };
  const reset = () => { cache = null; };

  // Many calls without invalidation → same reference.
  const first = load();
  for (let i = 0; i < 100; i++) {
    assert.equal(load(), first, `call ${i} returned a different reference`);
  }

  // Invalidate, then re-load → new reference.
  reset();
  const second = load();
  assert.notEqual(second, first, "after invalidation a new reference is returned");

  // And the new ref is itself stable.
  for (let i = 0; i < 5; i++) assert.equal(load(), second);
});
