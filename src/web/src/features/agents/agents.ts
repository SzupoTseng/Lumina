// Single source of truth for the agent identifier type and helpers.
//
// Lumina supports three coding-AI CLIs (claude, copilot, codex). The
// agent flows from the launcher's setup-dialog choice → through
// scripts/buddy-hook.{sh,ps1} as the second arg → into every event
// envelope's `agent` field → into UI components (DemoPanel, SettingsPanel,
// HookStatus) that adapt their behavior per agent.
//
// Until this module existed, the same union type was redeclared in 4+
// places. Centralizing it here means adding a new agent (or removing one)
// is a single-file change for the type system.

export type AgentId = "claude" | "copilot" | "codex";

export const ALL_AGENTS: ReadonlyArray<AgentId> = ["claude", "copilot", "codex"];
const AGENT_SET: ReadonlySet<string> = new Set(ALL_AGENTS);

export const DEFAULT_AGENT: AgentId = "claude";

// Type guard for arbitrary input (URL params, localStorage values, hook
// stdin agent fields). Use at every untrusted boundary.
export function isAgentId(v: unknown): v is AgentId {
  return typeof v === "string" && AGENT_SET.has(v);
}

// Display name (Title Case). UI components should call this instead of
// using raw lowercase ids — keeps capitalization consistent everywhere.
export function agentDisplayName(a: AgentId): string {
  // Capitalised forms are stable English brand names — not localized.
  switch (a) {
    case "claude":  return "Claude";
    case "copilot": return "Copilot";
    case "codex":   return "Codex";
  }
}
