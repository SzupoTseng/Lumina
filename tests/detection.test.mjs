// tests/detection.test.mjs — Node built-in test runner for the
// regex-driven detection logic in buddyEvents.ts, agentMonitor.ts,
// slashRoute.ts, achievements.ts.
//
// Why test the regex directly here (not via TS imports): the detection
// patterns are the most failure-prone part of the system (false matches
// on user content can mis-emote or, worse, trigger a "dangerous command"
// alert on a benign command). A regression suite catches that without
// requiring a TS toolchain.
//
// The PATTERNS objects below are kept in sync with the source by
// COPY-PASTE — when you update a regex in src/web/src/features/, also
// update the matching const here. This is intentional duplication: the
// test detects drift if both move out of sync.

import { test } from "node:test";
import assert from "node:assert/strict";

// === buddyEvents.ts — language detection ====================================

const LANGUAGE_BY_EXT = {
  ".py": "python", ".pyw": "python",
  ".cpp": "cpp", ".cc": "cpp", ".cxx": "cpp", ".h": "cpp", ".hpp": "cpp",
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".ts": "typescript", ".tsx": "typescript",
  ".rs": "rust", ".go": "go", ".java": "java", ".rb": "ruby",
  ".sh": "shell", ".bash": "shell", ".zsh": "shell",
  ".md": "markdown", ".json": "json", ".yaml": "yaml", ".yml": "yaml", ".sql": "sql",
};
function detectLanguage(path) {
  if (typeof path !== "string") return null;
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return null;
  return LANGUAGE_BY_EXT[lower.slice(dot)] ?? null;
}

test("language: .py and .pyw → python", () => {
  assert.equal(detectLanguage("/x/foo.py"), "python");
  assert.equal(detectLanguage("script.PYW"), "python");
});
test("language: cpp family → cpp", () => {
  for (const ext of [".cpp", ".cc", ".cxx", ".h", ".hpp"]) {
    assert.equal(detectLanguage(`a${ext}`), "cpp", `failed on ${ext}`);
  }
});
test("language: ts/tsx → typescript (not javascript)", () => {
  assert.equal(detectLanguage("a.ts"), "typescript");
  assert.equal(detectLanguage("a.tsx"), "typescript");
});
test("language: unknown extension → null", () => {
  assert.equal(detectLanguage("a.zz"), null);
  assert.equal(detectLanguage("noext"), null);
  assert.equal(detectLanguage(""), null);
});
test("language: handles non-string inputs", () => {
  assert.equal(detectLanguage(undefined), null);
  assert.equal(detectLanguage(null), null);
  assert.equal(detectLanguage(123), null);
});

// === buddyEvents.ts — git operation detection ================================

const GIT_OPS = new Set([
  "commit","push","pull","fetch","merge","rebase","checkout","switch","branch",
  "stash","tag","reset","revert","clone","status","log","diff","add","rm","mv",
  "remote","cherry-pick","bisect",
]);
function detectGit(cmd, output = "", isError = false) {
  if (typeof cmd !== "string") return null;
  const m = cmd.match(/(?:^|[;&|]\s*)git\s+([a-z][a-z-]*)\b/);
  if (!m) return null;
  const op = m[1];
  if (!GIT_OPS.has(op)) return null;
  const branchMatch = cmd.match(/git\s+(?:checkout|switch|branch)\s+(?:-[bB]\s+)?([^\s;&|"'-][^\s;&|]*)/);
  const msgMatch = cmd.match(/-m\s+(?:"([^"]*)"|'([^']*)')/);
  const failed = isError === true || /CONFLICT|fatal:|^error:/im.test(output);
  return { op, branch: branchMatch?.[1], message: msgMatch?.[1] ?? msgMatch?.[2], failed };
}

test("git: detects commit + extracts message", () => {
  const r = detectGit('git commit -m "fix: typo"');
  assert.equal(r.op, "commit");
  assert.equal(r.message, "fix: typo");
});
test("git: detects checkout + extracts branch", () => {
  const r = detectGit("git checkout -b feature/buddy");
  assert.equal(r.op, "checkout");
  assert.equal(r.branch, "feature/buddy");
});
test("git: 'gitignore' is NOT a false match", () => {
  assert.equal(detectGit("gitignore"), null);
  assert.equal(detectGit("ls .gitignore"), null);
});
test("git: detects op past shell separator", () => {
  assert.equal(detectGit("cd /tmp && git pull").op, "pull");
  assert.equal(detectGit("test -f x.txt; git status").op, "status");
});
test("git: hyphenated ops (cherry-pick, bisect)", () => {
  assert.equal(detectGit("git cherry-pick abc123").op, "cherry-pick");
  assert.equal(detectGit("git bisect start").op, "bisect");
});
test("git: failure detection from output (CONFLICT, fatal:, error:)", () => {
  assert.equal(detectGit("git merge develop", "CONFLICT (content): Merge").failed, true);
  assert.equal(detectGit("git pull", "fatal: Need to specify").failed, true);
  assert.equal(detectGit("git rebase", "", true).failed, true);
  assert.equal(detectGit("git status", "On branch main").failed, false);
});

// === buddyEvents.ts — tool result parsing (test runners) =====================

function detectToolResult(cmd, output = "") {
  if (typeof cmd !== "string") return null;
  const isTest = /\b(pytest|jest|vitest|mocha|cargo\s+test|go\s+test|deno\s+test|npm\s+(?:run\s+)?test|yarn\s+test|pnpm\s+test)\b/.test(cmd);
  if (!isTest) return null;
  const tail = output.length > 4096 ? output.slice(-4096) : output;
  // pytest
  let m = tail.match(/=+\s*(\d+)\s+passed(?:,\s*(\d+)\s+failed)?(?:,\s*(\d+)\s+errors?)?\s+in\s+([\d.]+)s/i);
  if (m) {
    const passed = +m[1], failed = m[2] ? +m[2] : 0, errors = m[3] ? +m[3] : 0;
    return { kind: "test", passed, failed, succeeded: failed === 0 && errors === 0 };
  }
  // jest
  m = tail.match(/Tests:\s*(?:(\d+)\s+failed,\s*)?(?:(\d+)\s+passed,?\s*)?(\d+)\s+total/i);
  if (m) {
    const failed = m[1] ? +m[1] : 0, passed = m[2] ? +m[2] : 0;
    return { kind: "test", passed, failed, succeeded: failed === 0 };
  }
  // cargo test
  m = tail.match(/test result: (ok|FAILED)\.\s*(\d+)\s+passed;\s*(\d+)\s+failed/);
  if (m) return { kind: "test", passed: +m[2], failed: +m[3], succeeded: m[1] === "ok" };
  // go test
  m = tail.match(/^(ok|FAIL)\s+\S+\s+([\d.]+)s/m);
  if (m) return { kind: "test", succeeded: m[1] === "ok" };
  return null;
}

test("toolResult: pytest all-pass", () => {
  const r = detectToolResult("pytest", "===== 23 passed in 1.45s =====");
  assert.deepEqual({ kind: r.kind, passed: r.passed, failed: r.failed, ok: r.succeeded },
                   { kind: "test", passed: 23, failed: 0, ok: true });
});
test("toolResult: pytest mixed fails", () => {
  const r = detectToolResult("pytest", "===== 18 passed, 5 failed in 2.10s =====");
  assert.equal(r.passed, 18);
  assert.equal(r.failed, 5);
  assert.equal(r.succeeded, false);
});
test("toolResult: jest", () => {
  const r = detectToolResult("npm test", "Tests:       1 failed, 22 passed, 23 total");
  assert.equal(r.passed, 22);
  assert.equal(r.failed, 1);
  assert.equal(r.succeeded, false);
});
test("toolResult: cargo test ok / FAILED", () => {
  let r = detectToolResult("cargo test", "test result: ok. 23 passed; 0 failed; 0 ignored");
  assert.equal(r.succeeded, true);
  r = detectToolResult("cargo test", "test result: FAILED. 1 passed; 22 failed; 0 ignored");
  assert.equal(r.succeeded, false);
  assert.equal(r.failed, 22);
});
test("toolResult: go test", () => {
  assert.equal(detectToolResult("go test ./...", "ok      pkg     1.234s").succeeded, true);
  assert.equal(detectToolResult("go test ./...", "FAIL    pkg     1.234s").succeeded, false);
});
test("toolResult: non-test command returns null", () => {
  assert.equal(detectToolResult("ls -la"), null);
  assert.equal(detectToolResult("git status"), null);
});

// === agentMonitor.ts — dangerous command patterns ============================

const DANGEROUS_PATTERNS = [
  { re: /\brm\s+-rf?\s+(?:\/(?:\s|$)|~\/?(?:\s|$)|\$HOME(?:\s|$))/i, sev: "stop" },
  { re: /\bgit\s+push\s+(?:.*\s)?--force\b.*\b(main|master|production)\b/i, sev: "stop" },
  { re: /\bgit\s+push\s+-f\b.*\b(main|master|production)\b/, sev: "stop" },
  { re: /\bDROP\s+TABLE\b/i, sev: "stop" },
  { re: /\bDROP\s+DATABASE\b/i, sev: "stop" },
  { re: /\bTRUNCATE\s+TABLE\b/i, sev: "warn" },
  { re: /\bdd\s+if=.+\s+of=\/dev\//i, sev: "stop" },
  { re: /\bmkfs(\.|\s)/i, sev: "stop" },
  { re: /\bchmod\s+(?:-R\s+)?777\b/, sev: "warn" },
  { re: /\bsudo\s+rm\b/, sev: "stop" },
  { re: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, sev: "stop" },
];
function detectDangerous(cmd) {
  for (const { re, sev } of DANGEROUS_PATTERNS) if (re.test(cmd)) return sev;
  return null;
}

test("dangerous: rm -rf catastrophic targets (root/bare home) → stop", () => {
  // Bare /, ~, ~/, $HOME — all delete everything under that root.
  assert.equal(detectDangerous("rm -rf /"), "stop");
  assert.equal(detectDangerous("rm -rf ~"), "stop");
  assert.equal(detectDangerous("rm -rf ~/"), "stop");
  assert.equal(detectDangerous("rm -rf $HOME"), "stop");
});
test("dangerous: rm -rf TARGETED subdirs → no match (intentional cleanup)", () => {
  // These are common, intentional, NOT catastrophic.
  assert.equal(detectDangerous("rm -rf ./build"), null);
  assert.equal(detectDangerous("rm -rf /tmp/lumina"), null);
  assert.equal(detectDangerous("rm -rf ~/Documents/old"), null);
  assert.equal(detectDangerous("rm -rf $HOME/cache"), null);
  assert.equal(detectDangerous("rm -rf node_modules"), null);
});
test("dangerous: force-push to main → stop", () => {
  assert.equal(detectDangerous("git push --force origin main"), "stop");
  assert.equal(detectDangerous("git push -f origin main"), "stop");
});
test("dangerous: force-push to feature branch → no match", () => {
  assert.equal(detectDangerous("git push --force origin feature/foo"), null);
});
test("dangerous: DROP TABLE / DATABASE → stop", () => {
  assert.equal(detectDangerous("DROP TABLE users;"), "stop");
  assert.equal(detectDangerous("DROP DATABASE prod;"), "stop");
});
test("dangerous: chmod 777 → warn", () => {
  assert.equal(detectDangerous("chmod -R 777 /var/www"), "warn");
});
test("dangerous: fork bomb → stop", () => {
  assert.equal(detectDangerous(":(){ :|:& };:"), "stop");
});
test("dangerous: safe commands → null", () => {
  for (const safe of ["ls -la", "git status", "git push origin main", "echo hello", "rm file.txt"]) {
    assert.equal(detectDangerous(safe), null, `false positive on: ${safe}`);
  }
});

// === slashRoute.ts ===========================================================

const SLASH_ROUTES = [
  { p: /^\/(effort|focus|concentrate|think|deep)\b/i, k: "energy_gather" },
  { p: /^\/(init|setup|bootstrap|boot)\b/i, k: "energy_gather" },
  { p: /^\/(review|audit|inspect|scan)\b/i, k: "triumph" },
  { p: /^\/(fix|refactor|rewrite|cleanup)\b/i, k: "triumph" },
  { p: /^\/(explain|why|walkthrough|describe)\b/i, k: "triumph" },
  { p: /^\/(test|run|verify)\b/i, k: "flash" },
  { p: /^\/(compact|clear|tidy|reset)\b/i, k: "flash" },
  { p: /^\/(add|new|create|make)\b/i, k: "flash" },
  { p: /^\/(bug|error|diagnose|debug|fault)\b/i, k: "crisis" },
  { p: /^\/(search|find|grep|lookup|locate)\b/i, k: "triumph" },
  { p: /^\/(delete|remove|nuke|destroy|drop)\b/i, k: "crisis" },
];
function routeSlash(prompt) {
  if (typeof prompt !== "string") return null;
  const t = prompt.trimStart();
  if (!t.startsWith("/")) return null;
  for (const r of SLASH_ROUTES) if (r.p.test(t)) return r.k;
  return null;
}

const SLASH_CASES = [
  ["/effort max", "energy_gather"], ["/focus", "energy_gather"], ["/think", "energy_gather"],
  ["/init", "energy_gather"], ["/setup", "energy_gather"],
  ["/review", "triumph"], ["/audit", "triumph"], ["/fix bug", "triumph"], ["/refactor", "triumph"],
  ["/explain", "triumph"], ["/search", "triumph"],
  ["/test", "flash"], ["/compact", "flash"], ["/clear", "flash"], ["/add foo", "flash"],
  ["/bug", "crisis"], ["/debug", "crisis"], ["/delete legacy", "crisis"], ["/drop", "crisis"],
  // Untouched (Claude Code utility commands)
  ["/help", null], ["/cost", null], ["/permissions", null], ["/exit", null], ["/release-notes", null],
  // Plain text / non-slash
  ["effortless", null], ["please review", null], ["", null],
  // Whitespace handling
  ["  /focus  ", "energy_gather"],
];
for (const [prompt, expected] of SLASH_CASES) {
  test(`slash: ${JSON.stringify(prompt)} → ${expected}`, () => {
    assert.equal(routeSlash(prompt), expected);
  });
}

// === achievements.ts — counter logic =========================================

const FIX_PATTERN = /\b(fix|bug|patch|hotfix|repair|resolve)\b/i;

test("achievements: fix-pattern matches case-insensitively", () => {
  assert.equal(FIX_PATTERN.test("fix: login bug"), true);
  assert.equal(FIX_PATTERN.test("Hotfix release"), true);
  assert.equal(FIX_PATTERN.test("BUG REPAIR"), true);
  assert.equal(FIX_PATTERN.test("add new feature"), false);
  assert.equal(FIX_PATTERN.test("refactor only"), false);
});

// === long-task command detection =============================================

const LONG_TASK_RE = /\b(?:npm|yarn|pnpm)\s+(?:install|ci)\b|\bpip\s+install\b|\bcargo\s+(?:build|fetch|update)\b|\bdocker\s+(?:build|push|pull|compose\s+up)\b|\bterraform\s+(?:apply|init|plan)\b|\bkubectl\s+apply\b|\bhelm\s+(?:install|upgrade)\b|\bnext\s+build\b|\bgo\s+build\b|\bbazel\s+build\b|\bgradle(?:w)?\s+build\b|\bmvn\s+(?:install|package)\b|\bbrew\s+install\b|\bapt(?:-get)?\s+install\b/;

const LONG_TASK_CASES = [
  ["npm install", true], ["npm install --no-audit", true],
  ["pnpm install", true], ["yarn install", true],
  ["pip install -r reqs.txt", true],
  ["cargo build --release", true], ["docker build -t x .", true],
  ["docker compose up -d", true], ["terraform apply -auto-approve", true],
  ["next build", true], ["sudo apt install vim", true], ["mvn package", true],
  // Should NOT match
  ["ls -la", false], ["cd /tmp", false], ["git status", false],
  ["echo install", false], ["uninstall npm", false],
  ["pytest", false], ["npm test", false], ["npm run dev", false],
];
for (const [cmd, expected] of LONG_TASK_CASES) {
  test(`long-task: ${JSON.stringify(cmd)} → ${expected}`, () => {
    assert.equal(LONG_TASK_RE.test(cmd), expected);
  });
}
