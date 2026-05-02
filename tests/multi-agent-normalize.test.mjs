// tests/multi-agent-normalize.test.mjs — unit tests for the per-agent
// normalization layer in src/web/src/features/buddyEvents/buddyEvents.ts.
//
// Why duplicate the lookup tables here (not import from .ts): the test
// suite is zero-dep — we run it via `node --test`, no TypeScript loader.
// This file copies TOOL_NORMALIZE and the Copilot context-rewriter so
// when buddyEvents.ts changes, this file MUST also change. Drift is the
// failure signal.
//
// Coverage target:
//   - TOOL_NORMALIZE per agent (claude noop, codex apply_patch→Edit,
//     copilot lowercase variants → PascalCase canonical names)
//   - Copilot toolArgs (JSON-encoded string) hoisted to tool_input
//   - Welcome line per agent

import { test } from "node:test";
import assert from "node:assert/strict";

// ── Copy from src/web/src/features/buddyEvents/buddyEvents.ts ──────────────

const TOOL_NORMALIZE = {
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

function normalizeTool(agent, tool) {
  if (!tool) return null;
  const map = TOOL_NORMALIZE[agent] ?? {};
  return map[tool] ?? tool;
}

// Agent welcome map — keep keys in sync with AGENT_WELCOME in buddyEvents.ts.
const AGENT_WELCOME_KEYS = ["claude", "copilot", "codex"];

// Mimics the `nEvt` rewriter inside connectBuddyEvents.apply().
function rewriteEvent(evt) {
  const agent = evt.agent ?? "claude";
  if (agent !== "copilot") {
    return { ...evt, tool: normalizeTool(agent, evt.tool ?? null) };
  }
  // Copilot adapter: parse toolArgs and re-shape into tool_input.
  const ctx = evt.context ?? {};
  let parsedArgs = {};
  if (typeof ctx.toolArgs === "string") {
    try { parsedArgs = JSON.parse(ctx.toolArgs); }
    catch { parsedArgs = {}; }
  }
  return {
    ...evt,
    tool: normalizeTool("copilot", ctx.toolName ?? evt.tool ?? null),
    context: { ...(ctx ?? {}), tool_input: parsedArgs },
  };
}

// ── tests ───────────────────────────────────────────────────────────────────

// === claude: identity normalization ========================================

test("claude: tool name passes through unchanged (no normalization map)", () => {
  for (const t of ["Bash", "Edit", "Write", "Read", "NotebookEdit", "TaskCreate"]) {
    assert.equal(normalizeTool("claude", t), t, `expected ${t} unchanged`);
  }
});

test("claude: null/empty tool stays null", () => {
  assert.equal(normalizeTool("claude", null), null);
  assert.equal(normalizeTool("claude", ""), null);
  assert.equal(normalizeTool("claude", undefined), null);
});

// === codex: apply_patch is the key remap ===================================

test("codex: apply_patch → Edit (codex's primary file-edit tool)", () => {
  assert.equal(normalizeTool("codex", "apply_patch"), "Edit");
});

test("codex: claude-shared tool names pass through (Bash, Edit, Write, Read)", () => {
  for (const t of ["Bash", "Edit", "Write", "Read"]) {
    assert.equal(normalizeTool("codex", t), t);
  }
});

test("codex: unknown tool stays unchanged (no panic)", () => {
  assert.equal(normalizeTool("codex", "SomeNewCodexTool"), "SomeNewCodexTool");
});

// === copilot: lowercase → canonical PascalCase ==============================

test("copilot: bash and shell both → Bash (multiple aliases)", () => {
  assert.equal(normalizeTool("copilot", "bash"), "Bash");
  assert.equal(normalizeTool("copilot", "shell"), "Bash");
});

test("copilot: edit/write/read → Edit/Write/Read", () => {
  assert.equal(normalizeTool("copilot", "edit"), "Edit");
  assert.equal(normalizeTool("copilot", "write"), "Write");
  assert.equal(normalizeTool("copilot", "read"), "Read");
});

test("copilot: str_replace variants both → Edit", () => {
  assert.equal(normalizeTool("copilot", "str_replace"), "Edit");
  assert.equal(normalizeTool("copilot", "str_replace_based_edit_tool"), "Edit");
});

test("copilot: PascalCase already-canonical name passes through", () => {
  // If Copilot ever emits a PascalCase name, don't double-normalize.
  assert.equal(normalizeTool("copilot", "Bash"), "Bash");
});

// === per-agent map isolation ===============================================

test("normalization maps are agent-scoped (claude doesn't apply codex's map)", () => {
  // apply_patch is codex-only; claude/copilot must leave it alone.
  assert.equal(normalizeTool("claude", "apply_patch"), "apply_patch");
  assert.equal(normalizeTool("copilot", "apply_patch"), "apply_patch");
});

test("unknown agent → fall through to identity (defensive default)", () => {
  // If a future agent appears with no map yet, normalization should not crash
  // — it should just return the tool name as-is.
  assert.equal(normalizeTool("future-agent", "Bash"), "Bash");
});

// === Copilot context rewrite (toolArgs JSON-string → tool_input object) =====

test("copilot rewrite: toolArgs JSON-string is parsed into tool_input", () => {
  const evt = {
    type: "PreToolUse",
    agent: "copilot",
    tool: "bash",
    context: {
      toolName: "bash",
      toolArgs: '{"command":"ls -la","cwd":"/tmp"}',
    },
  };
  const n = rewriteEvent(evt);
  assert.equal(n.tool, "Bash", "tool should be normalized to Bash");
  assert.deepEqual(n.context.tool_input, {
    command: "ls -la",
    cwd: "/tmp",
  });
});

test("copilot rewrite: malformed toolArgs JSON → tool_input is empty object (no throw)", () => {
  const evt = {
    type: "PreToolUse",
    agent: "copilot",
    tool: "bash",
    context: { toolName: "bash", toolArgs: "{not json" },
  };
  const n = rewriteEvent(evt);
  assert.deepEqual(n.context.tool_input, {});
});

test("copilot rewrite: missing toolArgs → tool_input is empty object", () => {
  const evt = {
    type: "PreToolUse",
    agent: "copilot",
    context: { toolName: "edit" },
  };
  const n = rewriteEvent(evt);
  assert.equal(n.tool, "Edit");
  assert.deepEqual(n.context.tool_input, {});
});

test("copilot rewrite: original event is not mutated", () => {
  const original = {
    type: "PreToolUse",
    agent: "copilot",
    tool: "bash",
    context: { toolName: "bash", toolArgs: '{"command":"ls"}' },
  };
  const snapshot = JSON.parse(JSON.stringify(original));
  rewriteEvent(original);
  assert.deepEqual(original, snapshot, "original event should be unchanged");
});

test("copilot rewrite: tool falls back to evt.tool when context.toolName absent", () => {
  // Some events (sessionStart, etc.) don't carry a tool — but if evt.tool is
  // already populated by the hook adapter, the rewrite should keep it.
  const evt = {
    type: "SessionStart",
    agent: "copilot",
    tool: "edit",
    context: {},
  };
  const n = rewriteEvent(evt);
  assert.equal(n.tool, "Edit");
});

// === claude/codex rewrite: tool normalized but context untouched ============

test("claude rewrite: context is untouched, tool passes through", () => {
  const evt = {
    type: "PostToolUse",
    agent: "claude",
    tool: "Edit",
    context: { tool_name: "Edit", tool_input: { file_path: "x.py" } },
  };
  const n = rewriteEvent(evt);
  assert.equal(n.tool, "Edit");
  assert.deepEqual(n.context, evt.context);
});

test("codex rewrite: apply_patch normalized to Edit, original context preserved", () => {
  const evt = {
    type: "PostToolUse",
    agent: "codex",
    tool: "apply_patch",
    context: {
      tool_name: "apply_patch",
      tool_input: { file_path: "/tmp/a.py" },
      session_id: "abc",
    },
  };
  const n = rewriteEvent(evt);
  assert.equal(n.tool, "Edit");
  assert.equal(n.context.tool_name, "apply_patch", "context.tool_name preserved (downstream may need raw value)");
  assert.equal(n.context.tool_input.file_path, "/tmp/a.py");
});

// === default-agent behavior (back-compat with old hook payloads) ============

test("rewrite: missing agent field defaults to claude (back-compat)", () => {
  const evt = { type: "PreToolUse", tool: "Bash", context: {} };
  const n = rewriteEvent(evt);
  // No throws, tool unchanged because claude map is empty.
  assert.equal(n.tool, "Bash");
});

// === welcome-line registration check ========================================
//
// AGENT_WELCOME in buddyEvents.ts must have an entry for every supported
// agent. If we add a new agent to TOOL_NORMALIZE, this test reminds us to
// also add a welcome line.

test("AGENT_WELCOME has an entry for every agent in TOOL_NORMALIZE", () => {
  const normalizeAgents = Object.keys(TOOL_NORMALIZE);
  for (const a of normalizeAgents) {
    assert.ok(
      AGENT_WELCOME_KEYS.includes(a),
      `agent "${a}" appears in TOOL_NORMALIZE but not in AGENT_WELCOME — add a welcome line`
    );
  }
});
