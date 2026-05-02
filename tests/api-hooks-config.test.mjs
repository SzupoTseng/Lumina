// tests/api-hooks-config.test.mjs — pins the contract of /api/hooks/config.
//
// We don't spin up Next.js — instead we duplicate the route's two pure
// pieces (path resolution + codex feature-flag detection) and exercise the
// agent allowlist + edge cases against a tmp filesystem. Same drift-detector
// pattern as the other unit tests: when the route changes, this file must
// change too.
//
// Source under test: src/web/src/pages/api/hooks/config.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── duplicate the route's pure pieces ──────────────────────────────────────

const VALID_AGENTS = new Set(["claude", "copilot", "codex"]);

function configPathFor(agent, homedir, projectCwd) {
  switch (agent) {
    case "claude":
      return path.join(homedir, ".claude", "settings.json");
    case "codex":
      return path.join(homedir, ".codex", "hooks.json");
    case "copilot":
      // Route uses process.cwd() at runtime which is src/web; the resolution
      // walks up two levels to the repo root. Duplicate that math here.
      return path.join(projectCwd, "..", "..", ".github", "hooks", "lumina.json");
  }
}

function detectCodexFlag(toml) {
  if (typeof toml !== "string") return false;
  return /(?:^|\n)\s*codex_hooks\s*=\s*true/m.test(toml);
}

// ── tests: agent allowlist ─────────────────────────────────────────────────

test("agent allowlist: only claude/copilot/codex accepted", () => {
  for (const a of ["claude", "copilot", "codex"]) {
    assert.equal(VALID_AGENTS.has(a), true, `${a} should be allowed`);
  }
});

test("agent allowlist: rejects unknown values (path-traversal guard)", () => {
  const bad = [
    "",
    "claude/../etc",
    "../../../../etc/passwd",
    "CLAUDE",            // case-sensitive on the route (raw is lowercased first)
    "claude\0",
    "claude;rm -rf /",
    "anthropic",
    "openai",
    "{{template}}",
    null,
    undefined,
    "x".repeat(1000),
  ];
  for (const a of bad) {
    assert.equal(VALID_AGENTS.has(a), false, `${a} should be rejected`);
  }
});

// ── tests: per-agent path resolution ───────────────────────────────────────

test("paths: claude → ~/.claude/settings.json under homedir", () => {
  const home = "/tmp/fake-home";
  assert.equal(
    configPathFor("claude", home, "/cwd"),
    path.join(home, ".claude", "settings.json"),
  );
});

test("paths: codex → ~/.codex/hooks.json under homedir", () => {
  const home = "/tmp/fake-home";
  assert.equal(
    configPathFor("codex", home, "/cwd"),
    path.join(home, ".codex", "hooks.json"),
  );
});

test("paths: copilot → walks up two levels from cwd to repo root", () => {
  // Mimic the runtime situation: cwd = <repo>/src/web
  const cwd = "/proj/src/web";
  const got = configPathFor("copilot", "/tmp/fake-home", cwd);
  // path.join collapses the .. components to the repo root.
  assert.equal(path.normalize(got), path.normalize("/proj/.github/hooks/lumina.json"));
});

test("paths: claude/codex paths never escape homedir (dirname ⊆ homedir)", () => {
  const home = "/safe/home";
  for (const a of ["claude", "codex"]) {
    const p = configPathFor(a, home, "/anywhere");
    assert.ok(p.startsWith(home + path.sep), `${a} path "${p}" escaped homedir`);
  }
});

// ── tests: codex feature-flag detection ────────────────────────────────────

test("codex flag: missing toml → false", () => {
  assert.equal(detectCodexFlag(null), false);
  assert.equal(detectCodexFlag(undefined), false);
  assert.equal(detectCodexFlag(""), false);
});

test("codex flag: explicit true → true", () => {
  assert.equal(detectCodexFlag("[features]\ncodex_hooks = true\n"), true);
  assert.equal(detectCodexFlag("[features]\ncodex_hooks=true"), true);  // no spaces
  assert.equal(detectCodexFlag("[features]\n  codex_hooks =  true"), true);  // mixed whitespace
});

test("codex flag: explicit false → false", () => {
  assert.equal(detectCodexFlag("[features]\ncodex_hooks = false"), false);
});

test("codex flag: missing key in [features] → false", () => {
  assert.equal(detectCodexFlag("[features]\nother_flag = true"), false);
});

test("codex flag: matches even when [features] is not the first section", () => {
  const toml = "[other]\nfoo = 1\n\n[features]\ncodex_hooks = true";
  assert.equal(detectCodexFlag(toml), true);
});

test("codex flag: does NOT match a substring (e.g. 'not_codex_hooks')", () => {
  // The regex anchors on \s before codex_hooks, so a key like
  // "extra_codex_hooks = true" must NOT trigger.
  const toml = "[features]\nextra_codex_hooks = true";
  assert.equal(detectCodexFlag(toml), false);
});

// ── tests: real-filesystem read behavior (round-trip) ─────────────────────

test("filesystem: missing config file → readFile returns null", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lumina-config-test-"));
  try {
    const p = path.join(tmp, "does-not-exist.json");
    let content = null;
    try { content = fs.readFileSync(p, "utf8"); } catch { content = null; }
    assert.equal(content, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("filesystem: present config file → JSON parse round-trips", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lumina-config-test-"));
  try {
    const p = path.join(tmp, "settings.json");
    const original = { hooks: { SessionStart: [{ hooks: [{ type: "command", command: "/x/buddy-hook.sh SessionStart claude" }] }] } };
    fs.writeFileSync(p, JSON.stringify(original));
    const text = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(text);
    assert.deepEqual(parsed, original);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
