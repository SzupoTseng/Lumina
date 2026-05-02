// buddyEvents — listen to scripts/buddy-bridge.mjs over SSE and translate
// each event into a VRM emote (and an optional transient overlay message).
//
// Wire-up: pages/index.tsx mounts a useEffect that calls connectBuddyEvents
// once the viewer is ready. The bridge is expected at localhost:3030; if it
// is not running, the EventSource fails silently and we periodically retry.
//
// Event taxonomy (must mirror scripts/buddy-hook.sh + .claude/settings.json):
//   SessionStart, SessionEnd, UserPromptSubmit,
//   PreToolUse, PostToolUse, Notification, Stop
// Each event also carries `tool` (for ToolUse events) and `context` (raw
// hook payload from Claude Code) — surface anything you need from there.
//
// Resolution order for a single event:
//   1. Base reaction = REACTIONS[evt.type]
//   2. Tool override = reaction.toolLines?.[evt.tool]   (overrides line)
//   3. Language override = LANGUAGE_REACTIONS[lang]     (overrides emotion+line)
// Language is derived from evt.context.tool_input.file_path's extension —
// no manual tagging by Claude or hook scripts. Keeping detection client-side
// keeps the bridge a dumb relay; one source of reaction truth lives here.

import type { Viewer } from "@/features/vrmViewer/viewer";
import { getLocale } from "@/features/i18n/i18n";

// Helper: pick the right locale string at runtime (no React hook needed).
function L(zh: string, en: string, ja: string): string {
  const loc = getLocale();
  if (loc === "en") return en;
  if (loc === "ja") return ja;
  return zh;
}

type EmotionPreset = "neutral" | "happy" | "angry" | "sad" | "relaxed";

// AgentId now lives in src/features/agents/agents.ts. Re-exported here for
// back-compat with existing imports of `BuddyEvent['agent']`.
export type { AgentId } from "@/features/agents/agents";
import type { AgentId } from "@/features/agents/agents";

export type BuddyEvent = {
  type: string;
  ts?: number;
  tool?: string | null;
  session?: string | null;
  // agent: which CLI fired this event. Optional for back-compat with hook
  // payloads from before multi-agent support; defaults to "claude" when read.
  agent?: AgentId;
  context?: unknown;
};

// Per-agent tool-name → canonical tool key. The reaction tables (toolLines,
// LANGUAGE_REACTIONS gate, GIT_OPS gate, TOOL_RESULT_REACTIONS) all key on
// Claude's tool taxonomy (Bash | Edit | Write | Read | NotebookEdit). When
// codex or copilot fires an event with a different tool name, normalize it
// here so downstream resolution is agent-agnostic.
//
// Codex uses the same names as Claude for the common tools, plus apply_patch
// for file edits — map that to "Edit". Copilot uses lowercase variants.
const TOOL_NORMALIZE: Record<AgentId, Record<string, string>> = {
  claude: {},
  codex: {
    apply_patch: "Edit",
  },
  copilot: {
    bash: "Bash",
    shell: "Bash",
    edit: "Edit",
    write: "Write",
    read: "Read",
    str_replace: "Edit",
    str_replace_based_edit_tool: "Edit",
  },
};

const normalizeTool = (agent: AgentId, tool: string | null | undefined): string | null => {
  if (!tool) return null;
  const map = TOOL_NORMALIZE[agent] ?? {};
  return map[tool] ?? tool;
};

// Welcome line per agent. Falls back to claude for any unrecognized agent id.
const AGENT_WELCOME: Record<AgentId, () => string> = {
  claude:  () => L("👋 Claude 來上班了。",  "👋 Claude is here.",  "👋 クロードが来た。"),
  copilot: () => L("👋 Copilot 來上班了。", "👋 Copilot is here.", "👋 Copilotが来た。"),
  codex:   () => L("👋 Codex 來上班了。",   "👋 Codex is here.",   "👋 Codexが来た。"),
};

// Personality override layer. Highest priority on resolution; reactions map
// uses the same flat-key shape as public/personalities/*.json:
//   "Stop" | "tool.Edit" | "lang.python".
export type PersonalityOverride = {
  defaultEmotion?: EmotionPreset;
  reactions?: Record<string, string>;
};

export type StatusInfo = { task?: string; scope?: string; todo?: string; line?: string };

export type BuddyEventOptions = {
  url?: string;
  onMessage?: (text: string) => void;
  onStatusUpdate?: (info: StatusInfo) => void;
  // Pass a ref-like object so updating .current swaps personality without
  // reconnecting the EventSource. Read at apply() time, never cached.
  personalityRef?: { current: PersonalityOverride | null };
  // Fires after each event has been processed (emote applied, line emitted).
  // Used by the achievement system to feed counters off the same stream
  // without re-implementing the EventSource client.
  onAfterApply?: (evt: BuddyEvent) => void;
};

// File extension → canonical language id. Lower-case keys, leading dot.
const LANGUAGE_BY_EXT: Record<string, string> = {
  ".py": "python",
  ".pyw": "python",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".h": "cpp",
  ".hpp": "cpp",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".rb": "ruby",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".md": "markdown",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".sql": "sql",
};

// Fires only on PostToolUse for now (PreToolUse keeps the neutral "改 code 中…"
// vibe regardless of language). Override emotion + line when a known language
// is detected. Stay within the legal EmotionPreset set; ChatVRM's
// expressionController will silently no-op on unknown presets.
//
// Lines lead with a unicode emoji glyph as a poor-man's status icon. No
// markdown renderer is involved — AssistantText just prints the string.
const LANGUAGE_REACTIONS: Record<string, { emotion: EmotionPreset; line: () => string }> = {
  python:     { emotion: "relaxed", line: () => L("🐍 Python — 寫起來舒服。",      "🐍 Python — feels good.",         "🐍 Python — 気持ちいい。") },
  cpp:        { emotion: "sad",     line: () => L("💢 C++ — 小心 pointer…",        "💢 C++ — watch the pointers…",    "💢 C++ — ポインタ注意…") },
  rust:       { emotion: "happy",   line: () => L("🦀 Rust — borrow checker 開心。","🦀 Rust — borrow checker happy.", "🦀 Rust — 安全！") },
  typescript: { emotion: "happy",   line: () => L("🔷 TypeScript — 型別護航。",    "🔷 TypeScript — types protect.",  "🔷 TypeScript — 型安全。") },
  javascript: { emotion: "happy",   line: () => L("🟨 JavaScript — 跳一段。",      "🟨 JavaScript — let's go.",       "🟨 JavaScript — やってみよう。") },
  go:         { emotion: "neutral", line: () => L("🐹 Go — 簡潔。",                "🐹 Go — clean and simple.",       "🐹 Go — シンプル。") },
  java:       { emotion: "neutral", line: () => L("☕ Java — 一切照規矩。",         "☕ Java — by the book.",           "☕ Java — 規則通り。") },
  ruby:       { emotion: "happy",   line: () => L("💎 Ruby — 優雅。",               "💎 Ruby — elegant.",              "💎 Ruby — エレガント。") },
  shell:      { emotion: "neutral", line: () => L("🐚 Shell — 小心引號。",          "🐚 Shell — watch the quotes.",    "🐚 Shell — クォート注意。") },
  sql:        { emotion: "neutral", line: () => L("🗃️ SQL — 別忘了 WHERE。",       "🗃️ SQL — don't forget WHERE.",   "🗃️ SQL — WHERE忘れずに。") },
  markdown:   { emotion: "relaxed", line: () => L("📝 Markdown — 寫文件中。",      "📝 Markdown — writing docs.",     "📝 Markdown — ドキュメント中。") },
  json:       { emotion: "neutral", line: () => L("🧾 JSON — 注意逗號。",           "🧾 JSON — mind the commas.",      "🧾 JSON — カンマ注意。") },
  yaml:       { emotion: "neutral", line: () => L("🧶 YAML — 注意縮排。",           "🧶 YAML — check the indents.",    "🧶 YAML — インデント注意。") },
};

// Exported so adjacent modules (achievements, future tracking) can reuse the
// same detection logic without duplicating regex.
export const detectLanguage = (evt: BuddyEvent): string | null => {
  if (evt.type !== "PostToolUse") return null;
  const ctx = evt.context as { tool_input?: { file_path?: string } } | undefined;
  const path = ctx?.tool_input?.file_path;
  if (typeof path !== "string") return null;
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return null;
  return LANGUAGE_BY_EXT[lower.slice(dot)] ?? null;
};

// Git operation detection. Parses Bash tool calls — same source as language
// detection (PostToolUse + context.tool_input + context.tool_response), no
// new event taxonomy, no bridge changes, no hook changes.
export type GitInfo = {
  op: string;          // "commit" | "push" | "pull" | …
  branch?: string;     // for checkout/switch/branch
  message?: string;    // for commit -m "..."
  failed?: boolean;    // merge/rebase conflict, or tool_response.isError
};

const GIT_OPS: ReadonlySet<string> = new Set([
  "commit", "push", "pull", "fetch", "merge", "rebase",
  "checkout", "switch", "branch", "stash", "tag",
  "reset", "revert", "clone", "status", "log", "diff",
  "add", "rm", "mv", "remote", "cherry-pick", "bisect",
]);

export const detectGit = (evt: BuddyEvent): GitInfo | null => {
  if (evt.tool !== "Bash") return null;
  if (evt.type !== "PostToolUse" && evt.type !== "PreToolUse") return null;
  const ctx = evt.context as
    | {
        tool_input?: { command?: string };
        tool_response?: { output?: string; error?: string; isError?: boolean };
      }
    | undefined;
  const cmd = ctx?.tool_input?.command;
  if (typeof cmd !== "string") return null;

  // Match `git <op>` at command start or after a shell separator. Avoids
  // false positives like `cd github && ...` or `gitignore`.
  const m = cmd.match(/(?:^|[;&|]\s*)git\s+([a-z][a-z-]*)\b/);
  if (!m) return null;
  const op = m[1];
  if (!GIT_OPS.has(op)) return null;

  // Best-effort field extraction. Branch from checkout/switch/branch.
  let branch: string | undefined;
  const branchMatch = cmd.match(
    /git\s+(?:checkout|switch|branch)\s+(?:-[bB]\s+)?([^\s;&|"'-][^\s;&|]*)/,
  );
  if (branchMatch) branch = branchMatch[1];

  // Commit message from -m "..." or -m '...'.
  let message: string | undefined;
  const msgMatch = cmd.match(/-m\s+(?:"([^"]*)"|'([^']*)')/);
  if (msgMatch) message = msgMatch[1] ?? msgMatch[2];

  // Failure detection. PreToolUse has no result yet — treat as not-failed.
  let failed = false;
  if (evt.type === "PostToolUse") {
    const out =
      String(ctx?.tool_response?.output ?? "") +
      String(ctx?.tool_response?.error ?? "");
    failed =
      ctx?.tool_response?.isError === true ||
      /CONFLICT|fatal:|^error:/im.test(out);
  }

  return { op, branch, message, failed };
};

// Tool-result interpretation. Goes one layer deeper than command parsing:
// we look at the actual stdout/stderr and pull out test pass/fail counts,
// compile error counts, lint warnings, etc.
//
// This is the layer that distinguishes Lumina from "decorative AI buddy"
// projects. Hook events tell us *what tool ran*; result parsing tells us
// *what happened*. The avatar can therefore react to "27 tests passed in
// 1.2 s" rather than just "Bash returned".
//
// Bounded scan: only the last 4 KB of output is searched. Test runners put
// their summary at the end; this avoids regex-bombs on giant tsc output.
export type ToolResultInfo = {
  kind: "test" | "build" | "lint";
  passed?: number;
  failed?: number;
  errors?: number;
  warnings?: number;
  duration_ms?: number;
  succeeded: boolean;
};

const TEST_COMMAND = /\b(pytest|jest|vitest|mocha|cargo\s+test|go\s+test|deno\s+test|npm\s+(?:run\s+)?test|yarn\s+test|pnpm\s+test)\b/;
const BUILD_COMMAND = /\b(tsc|next\s+build|cargo\s+build|go\s+build|webpack|rollup|vite\s+build|esbuild|swc\s+build)\b/;
const LINT_COMMAND = /\b(eslint|biome|cargo\s+clippy|ruff\s+check|flake8|golangci-lint)\b/;

const SCAN_TAIL = 4096;

export const detectToolResult = (evt: BuddyEvent): ToolResultInfo | null => {
  if (evt.type !== "PostToolUse") return null;
  if (evt.tool !== "Bash") return null;
  const ctx = evt.context as
    | {
        tool_input?: { command?: string };
        tool_response?: { output?: string; error?: string; isError?: boolean };
      }
    | undefined;
  const cmd = ctx?.tool_input?.command;
  if (typeof cmd !== "string") return null;

  const isTest = TEST_COMMAND.test(cmd);
  const isBuild = BUILD_COMMAND.test(cmd);
  const isLint = LINT_COMMAND.test(cmd);
  if (!isTest && !isBuild && !isLint) return null;

  // Combine stdout + stderr for parsing (test runners often write summaries
  // to stderr). Cap to last SCAN_TAIL bytes so we don't regex over megabytes.
  const raw =
    String(ctx?.tool_response?.output ?? "") +
    String(ctx?.tool_response?.error ?? "");
  const tail = raw.length > SCAN_TAIL ? raw.slice(-SCAN_TAIL) : raw;

  if (isTest) {
    // pytest:    "===== 23 passed, 1 failed, 2 errors in 1.45s ====="
    //            "===== 23 passed in 1.45s ====="
    let m = tail.match(
      /=+\s*(\d+)\s+passed(?:,\s*(\d+)\s+failed)?(?:,\s*(\d+)\s+errors?)?\s+in\s+([\d.]+)s/i,
    );
    if (m) {
      const passed = Number(m[1]);
      const failed = m[2] ? Number(m[2]) : 0;
      const errors = m[3] ? Number(m[3]) : 0;
      return {
        kind: "test",
        passed,
        failed,
        errors,
        duration_ms: Math.round(Number(m[4]) * 1000),
        succeeded: failed === 0 && errors === 0,
      };
    }
    // jest:      "Tests:       1 failed, 23 passed, 24 total"
    //            "Tests:       23 passed, 23 total"
    m = tail.match(
      /Tests:\s*(?:(\d+)\s+failed,\s*)?(?:(\d+)\s+passed,?\s*)?(\d+)\s+total/i,
    );
    if (m) {
      const failed = m[1] ? Number(m[1]) : 0;
      const passed = m[2] ? Number(m[2]) : 0;
      return { kind: "test", passed, failed, succeeded: failed === 0 };
    }
    // cargo test: "test result: ok. 23 passed; 0 failed; 0 ignored; ..."
    //             "test result: FAILED. 1 passed; 22 failed; 0 ignored; ..."
    m = tail.match(/test result: (ok|FAILED)\.\s*(\d+)\s+passed;\s*(\d+)\s+failed/);
    if (m) {
      return {
        kind: "test",
        passed: Number(m[2]),
        failed: Number(m[3]),
        succeeded: m[1] === "ok",
      };
    }
    // go test:    "ok    pkg    1.234s"  /  "FAIL    pkg    1.234s"
    m = tail.match(/^(ok|FAIL)\s+\S+\s+([\d.]+)s/m);
    if (m) {
      return {
        kind: "test",
        succeeded: m[1] === "ok",
        duration_ms: Math.round(Number(m[2]) * 1000),
      };
    }
    // Generic fallback: tool_response.isError flag.
    if (ctx?.tool_response?.isError === true) {
      return { kind: "test", succeeded: false };
    }
    return null;
  }

  if (isBuild) {
    // tsc: count "error TSnnnn:" lines
    const tsErrors = (tail.match(/error TS\d+:/g) ?? []).length;
    if (tsErrors > 0) {
      return { kind: "build", errors: tsErrors, succeeded: false };
    }
    // cargo: "error[E0xxx]:"
    const rustErrors = (tail.match(/^error(?:\[\w+\])?:/gm) ?? []).length;
    if (rustErrors > 0) {
      return { kind: "build", errors: rustErrors, succeeded: false };
    }
    // Generic: look for "error:" or "Error:" and isError flag
    if (ctx?.tool_response?.isError === true) {
      return { kind: "build", succeeded: false };
    }
    // Build apparently succeeded (no errors detected, no isError).
    return { kind: "build", succeeded: true };
  }

  if (isLint) {
    // eslint: "✖ 5 problems (2 errors, 3 warnings)"
    let m = tail.match(/(\d+)\s+problems?\s*\((\d+)\s+errors?,\s*(\d+)\s+warnings?\)/);
    if (m) {
      const errors = Number(m[2]);
      const warnings = Number(m[3]);
      return { kind: "lint", errors, warnings, succeeded: errors === 0 };
    }
    // ruff: "Found N errors."
    m = tail.match(/Found\s+(\d+)\s+errors?\b/i);
    if (m) {
      const errors = Number(m[1]);
      return { kind: "lint", errors, succeeded: errors === 0 };
    }
    if (ctx?.tool_response?.isError === true) {
      return { kind: "lint", succeeded: false };
    }
    return { kind: "lint", succeeded: true };
  }

  return null;
};

// Maps tool result → emote/line. Personality override key: `result.<sub>`,
// where <sub> is "test_pass" | "test_fail" | "build_fail" | "build_pass" |
// "lint_warn" | "lint_pass". Personalities can react snarky/cheerful/cold.
type ResultReactionKey = "test_pass" | "test_fail" | "build_pass" | "build_fail" | "lint_pass" | "lint_warn";

const TOOL_RESULT_REACTIONS: Record<
  ResultReactionKey,
  (info: ToolResultInfo) => { emotion: EmotionPreset; line: string }
> = {
  test_pass: (i) => ({
    emotion: "happy",
    line: i.passed != null
      ? L(
          `✅ ${i.passed} 個測試通過。${i.duration_ms ? ` (${(i.duration_ms/1000).toFixed(1)}s)` : ""}`,
          `✅ ${i.passed} tests passed.${i.duration_ms ? ` (${(i.duration_ms/1000).toFixed(1)}s)` : ""}`,
          `✅ ${i.passed}個テスト通過。${i.duration_ms ? ` (${(i.duration_ms/1000).toFixed(1)}s)` : ""}`
        )
      : L("✅ 測試通過。", "✅ Tests passed.", "✅ テスト通過。"),
  }),
  test_fail: (i) => ({
    emotion: "sad",
    line: i.failed && i.failed > 0
      ? L(`❌ ${i.failed} 個測試失敗…`, `❌ ${i.failed} tests failed…`, `❌ ${i.failed}個のテストが失敗…`)
      : L("❌ 測試紅了。", "❌ Tests failed.", "❌ テスト失敗。"),
  }),
  build_pass: () => ({ emotion: "happy",   line: L("✅ 編譯通過。",           "✅ Build passed.",   "✅ ビルド成功。") }),
  build_fail: (i) => ({ emotion: "sad",    line: i.errors
    ? L(`🔥 ${i.errors} 個錯。`, `🔥 ${i.errors} errors.`, `🔥 ${i.errors}個のエラー。`)
    : L("🔥 編譯失敗。", "🔥 Build failed.", "🔥 ビルド失敗。") }),
  lint_pass: ()  => ({ emotion: "relaxed", line: L("🧹 整潔。",               "🧹 Clean.",          "🧹 きれい。") }),
  lint_warn: (i) => ({
    emotion: "neutral",
    line: i.warnings != null
      ? L(`⚠️ ${i.warnings} 個警告。`,   `⚠️ ${i.warnings} warnings.`,   `⚠️ ${i.warnings}個の警告。`)
      : i.errors != null
      ? L(`⚠️ ${i.errors} 個 lint 錯。`, `⚠️ ${i.errors} lint errors.`,  `⚠️ ${i.errors}個のlintエラー。`)
      : L("⚠️ Lint 有意見。",             "⚠️ Lint issues.",              "⚠️ Lintの指摘。"),
  }),
};

const resultReactionKeyFor = (info: ToolResultInfo): ResultReactionKey | null => {
  if (info.kind === "test") return info.succeeded ? "test_pass" : "test_fail";
  if (info.kind === "build") return info.succeeded ? "build_pass" : "build_fail";
  if (info.kind === "lint")
    return info.warnings && info.warnings > 0
      ? "lint_warn"
      : info.succeeded
      ? "lint_pass"
      : "lint_warn";
  return null;
};

const GIT_REACTIONS: Record<string, { emotion: EmotionPreset; line: () => string }> = {
  commit:      { emotion: "neutral", line: () => L("📝 紀錄存下來了。",    "📝 Commit recorded.",      "📝 コミット完了。") },
  push:        { emotion: "happy",   line: () => L("🚀 推到雲端了。",      "🚀 Pushed to remote.",     "🚀 プッシュ完了。") },
  pull:        { emotion: "relaxed", line: () => L("📥 拉夥伴的進度…",    "📥 Pulling changes…",      "📥 プル中…") },
  fetch:       { emotion: "relaxed", line: () => L("📥 取最新狀態…",      "📥 Fetching latest…",      "📥 フェッチ中…") },
  merge:       { emotion: "happy",   line: () => L("🤝 合好了。",          "🤝 Merged.",               "🤝 マージ完了。") },
  rebase:      { emotion: "neutral", line: () => L("♻️ 重整完成。",        "♻️ Rebased.",              "♻️ リベース完了。") },
  checkout:    { emotion: "neutral", line: () => L("🔀 切換分支。",        "🔀 Branch switched.",      "🔀 ブランチ切替。") },
  switch:      { emotion: "neutral", line: () => L("🔀 切換分支。",        "🔀 Branch switched.",      "🔀 ブランチ切替。") },
  branch:      { emotion: "neutral", line: () => L("🌿 分支操作。",        "🌿 Branch operation.",     "🌿 ブランチ操作。") },
  stash:       { emotion: "neutral", line: () => L("📦 暫存起來。",        "📦 Stashed.",              "📦 スタッシュ。") },
  tag:         { emotion: "happy",   line: () => L("🏷️ 打 tag。",         "🏷️ Tagged.",               "🏷️ タグ付け。") },
  reset:       { emotion: "sad",     line: () => L("↩️ 退回去了。",        "↩️ Rolled back.",          "↩️ リセットした。") },
  revert:      { emotion: "sad",     line: () => L("↩️ 撤銷這個 commit。", "↩️ Commit reverted.",      "↩️ コミット取消。") },
  clone:       { emotion: "happy",   line: () => L("📥 把專案抓回來了。",  "📥 Repository cloned.",    "📥 クローン完了。") },
  status:      { emotion: "neutral", line: () => L("👀 看狀態。",          "👀 Checking status.",      "👀 状態確認。") },
  log:         { emotion: "neutral", line: () => L("📜 看歷史。",          "📜 Viewing history.",      "📜 履歴確認。") },
  diff:        { emotion: "neutral", line: () => L("🔍 比對差異。",        "🔍 Comparing changes.",    "🔍 差分確認。") },
  add:         { emotion: "neutral", line: () => L("➕ 進 staging。",      "➕ Staging files.",        "➕ ステージング。") },
  remote:      { emotion: "neutral", line: () => L("🔗 遠端設定。",        "🔗 Remote config.",        "🔗 リモート設定。") },
  "cherry-pick": { emotion: "happy", line: () => L("🍒 摘 commit。",       "🍒 Cherry-picked.",        "🍒 チェリーピック。") },
  bisect:      { emotion: "neutral", line: () => L("🩺 二分查 bug。",      "🩺 Binary search debug.",  "🩺 バイセクト。") },
};

// Event type → emote preset + short overlay line. Tweak freely; this is the
// single place that decides how the buddy reacts.
const REACTIONS: Record<
  string,
  { emotion: EmotionPreset; line?: () => string; toolLines?: Record<string, () => string> }
> = {
  SessionStart:     { emotion: "relaxed", line: () => L("👋 Claude 來上班了。", "👋 Claude is here.",      "👋 クロードが来た。") },
  SessionEnd:       { emotion: "neutral",  line: () => L("🌙 下次見～",           "🌙 See you next time~",  "🌙 またね～") },
  UserPromptSubmit: { emotion: "neutral" },
  PreToolUse: {
    emotion: "neutral",
    toolLines: {
      Bash:         () => L("⚙️ 跑指令中…",      "⚙️ Running command…",   "⚙️ コマンド実行中…"),
      Edit:         () => L("✏️ 改 code 中…",    "✏️ Editing code…",      "✏️ コード編集中…"),
      Write:        () => L("📝 寫新檔中…",       "📝 Writing file…",      "📝 ファイル書込中…"),
      NotebookEdit: () => L("📓 改 notebook 中…","📓 Editing notebook…",   "📓 ノート編集中…"),
    },
  },
  PostToolUse: {
    emotion: "happy",
    toolLines: {
      Bash:  () => L("✅ 指令跑完。", "✅ Command done.",   "✅ コマンド完了。"),
      Edit:  () => L("✅ 改完了。",   "✅ Edit complete.",  "✅ 編集完了。"),
      Write: () => L("💾 存檔完成。", "💾 File saved.",     "💾 ファイル保存。"),
      Read:  () => L("👀 讀完了。",   "👀 File read.",      "👀 読込完了。"),
    },
  },
  Notification: { emotion: "angry",   line: () => L("⚠️ 需要你回覆一下！", "⚠️ Your reply needed!", "⚠️ 返信が必要！") },
  Stop:         { emotion: "relaxed", line: () => L("🎉 好了。",            "🎉 Done.",               "🎉 完了。") },
};

// Default subscribe URL. Resolution order:
//   1. options.url (caller override — wins)
//   2. NEXT_PUBLIC_BUDDY_BRIDGE_URL env (build-time inlined by Next; lets you
//      switch modes without code edits — set to "/api/events" for unified
//      mode, leave unset for split mode).
//   3. http://127.0.0.1:3030/events — standalone bridge (split mode default).
const DEFAULT_BRIDGE_URL =
  process.env.NEXT_PUBLIC_BUDDY_BRIDGE_URL ||
  "http://127.0.0.1:3030/events";

export function connectBuddyEvents(
  viewer: Viewer,
  options: BuddyEventOptions = {}
): () => void {
  const url = options.url ?? DEFAULT_BRIDGE_URL;
  let source: EventSource | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const emit = (msg: string) => {
    if (options.onMessage) options.onMessage(msg);
  };

  const apply = (evt: BuddyEvent) => {
    if (evt.type === "hello") return;

    // StatusUpdate: ccusage status-bridge sends Task/Scope/TODO
    if (evt.type === "StatusUpdate") {
      const ctx = evt.context as { task?: string; scope?: string; todo?: string; line?: string } | undefined;
      if (ctx && options.onStatusUpdate) {
        options.onStatusUpdate({ task: ctx.task, scope: ctx.scope, todo: ctx.todo, line: ctx.line });
      }
      // Surface as VRM bubble + neutral emote (mirrors all other event types)
      const bubbleLine = ctx?.line ??
        (ctx?.task
          ? `🎯 ${ctx.task}${ctx.scope ? ` [${ctx.scope}]` : ""}${ctx.todo ? `  📋 ${ctx.todo}` : ""}`
          : undefined);
      if (bubbleLine) {
        try { viewer.model?.emoteController?.playEmotion("neutral"); } catch (_) {}
        emit(bubbleLine);
      }
      return;
    }

    const reaction = REACTIONS[evt.type];
    if (!reaction) return;

    // Normalize per-agent tool name + stdin shape into Claude's canonical
    // taxonomy so the reaction tables and detectors work uniformly. The
    // detectors read evt.context.tool_input.{file_path,command} — Copilot
    // uses toolArgs (JSON-encoded string) and toolName, so we hoist its
    // fields here once. Local clone, original unchanged.
    const agent: AgentId = (evt.agent as AgentId) ?? "claude";
    const nEvt: BuddyEvent = (() => {
      if (agent !== "copilot") {
        return { ...evt, tool: normalizeTool(agent, evt.tool ?? null) };
      }
      // Copilot adapter: parse toolArgs and re-shape into Claude's tool_input.
      const ctx = (evt.context as { toolName?: string; toolArgs?: string }) ?? {};
      let parsedArgs: Record<string, unknown> = {};
      if (typeof ctx.toolArgs === "string") {
        try { parsedArgs = JSON.parse(ctx.toolArgs); }
        catch { parsedArgs = {}; }
      }
      return {
        ...evt,
        tool: normalizeTool("copilot", ctx.toolName ?? evt.tool ?? null),
        context: {
          ...(evt.context as object | null ?? {}),
          tool_input: parsedArgs,
        },
      };
    })();

    // Resolution order (last wins on each axis):
    //   emotion: base → language → git → personality.defaultEmotion
    //            (default skipped when language or git carry semantic intent)
    //   line:    base → tool → language → git → personality
    //            (personality keys: git.<op> > lang.<id> > tool.<name> > event)
    let emotion = reaction.emotion;
    // All line fields are now () => string for locale-awareness; call them to get the string.
    let line: string | undefined = reaction.line?.();
    // Agent-specific welcome on SessionStart.
    if (nEvt.type === "SessionStart" && AGENT_WELCOME[agent]) {
      line = AGENT_WELCOME[agent]();
    }
    if (reaction.toolLines && nEvt.tool && reaction.toolLines[nEvt.tool]) {
      line = reaction.toolLines[nEvt.tool]();
    }

    const lang = detectLanguage(nEvt);
    if (lang && LANGUAGE_REACTIONS[lang]) {
      emotion = LANGUAGE_REACTIONS[lang].emotion;
      line = LANGUAGE_REACTIONS[lang].line();
    }

    const git = detectGit(nEvt);
    if (git && GIT_REACTIONS[git.op]) {
      const r = GIT_REACTIONS[git.op];
      emotion = r.emotion;
      line = r.line();
      if (git.failed && (git.op === "merge" || git.op === "rebase")) {
        emotion = "sad";
        line = git.op === "merge"
          ? L("😱 Merge conflict！", "😱 Merge conflict!", "😱 マージコンフリクト！")
          : L("😱 Rebase 衝突。",    "😱 Rebase conflict.", "😱 リベースコンフリクト。");
      } else if (git.op === "commit" && git.message) {
        const msg = git.message.length > 28 ? git.message.slice(0, 27) + "…" : git.message;
        line = `📝 ${msg}`;
      } else if ((git.op === "checkout" || git.op === "switch") && git.branch) {
        line = L(`🔀 切到 ${git.branch}。`, `🔀 Switched to ${git.branch}.`, `🔀 ${git.branch}に切替。`);
      } else if (git.op === "branch" && git.branch) {
        line = `🌿 ${git.branch}`;
      }
    }

    // Tool-result interpretation: more specific than git/lang/tool, since it
    // reflects the *outcome* of what just ran. Wins over those layers.
    const result = detectToolResult(nEvt);
    let resultKey: ResultReactionKey | null = null;
    if (result) {
      resultKey = resultReactionKeyFor(result);
      if (resultKey) {
        const r = TOOL_RESULT_REACTIONS[resultKey](result);
        emotion = r.emotion;
        line = r.line;
      }
    }

    const personality = options.personalityRef?.current ?? null;
    if (personality) {
      if (!lang && !git && !resultKey && personality.defaultEmotion) {
        emotion = personality.defaultEmotion;
      }
      const r = personality.reactions;
      if (r) {
        const resultPersonalityKey = resultKey ? `result.${resultKey}` : null;
        const gitKey = git ? `git.${git.op}` : null;
        const langKey = lang ? `lang.${lang}` : null;
        // Personality keys use the canonical (normalized) tool name so a single
        // personality file works across all three agents.
        const toolKey = nEvt.tool ? `tool.${nEvt.tool}` : null;
        const agentKey = `agent.${agent}`;
        const override =
          (resultPersonalityKey && r[resultPersonalityKey]) ||
          (gitKey && r[gitKey]) ||
          (langKey && r[langKey]) ||
          (toolKey && r[toolKey]) ||
          r[`${nEvt.type}.${agent}`] ||
          r[agentKey] ||
          r[nEvt.type] ||
          null;
        if (override) line = override;
      }
    }

    try {
      viewer.model?.emoteController?.playEmotion(emotion);
    } catch (err) {
      console.warn("[buddy] playEmotion failed", err);
    }

    if (line) emit(line);

    if (options.onAfterApply) {
      try {
        options.onAfterApply(evt);
      } catch (err) {
        console.warn("[buddy] onAfterApply failed", err);
      }
    }
  };

  const open = () => {
    if (stopped) return;
    try {
      source = new EventSource(url);
    } catch (err) {
      console.warn("[buddy] EventSource construction failed", err);
      schedule(5000);
      return;
    }

    source.onopen = () => {
      console.log("[buddy] connected to", url);
    };

    source.onmessage = (ev) => {
      let parsed: BuddyEvent | null = null;
      try {
        parsed = JSON.parse(ev.data) as BuddyEvent;
      } catch {
        return;
      }
      if (parsed) apply(parsed);
    };

    source.onerror = () => {
      // Browser auto-retries SSE, but if the bridge is fully down it will
      // hammer; close and back off ourselves.
      if (source) {
        source.close();
        source = null;
      }
      schedule(5000);
    };
  };

  const schedule = (ms: number) => {
    if (stopped || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      open();
    }, ms);
  };

  open();

  return () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    if (source) source.close();
  };
}
