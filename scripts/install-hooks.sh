#!/usr/bin/env bash
# install-hooks.sh — idempotent hook installer for claude / codex / copilot.
#
# Usage:
#   bash scripts/install-hooks.sh <project-root> [agent]
# If <agent> is given, only that agent's hooks are installed; otherwise we
# install hooks for whichever of {claude, codex, copilot} is on PATH.
#
# What gets written:
#   claude  → ~/.claude/settings.json                     (merged in)
#   codex   → ~/.codex/hooks.json + config.toml flag      (merged in)
#   copilot → <project>/.github/hooks/lumina.json         (overwritten)
#
# Each hook command form is: "<HOOK_SH> <CanonicalEvent> <agent>" — the
# canonical PascalCase event name is what buddy-bridge / buddyEvents.ts
# already understand; the hook script normalizes the per-agent stdin shape.

set -u

PROJECT_ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ONLY_AGENT="${2:-}"
HOOK_SH="$PROJECT_ROOT/scripts/buddy-hook.sh"

if [ ! -x "$HOOK_SH" ]; then
  chmod +x "$HOOK_SH" 2>/dev/null || true
fi

log() { printf '[install-hooks] %s\n' "$*" >&2; }

want_agent() {
  local a="$1"
  [ -z "$ONLY_AGENT" ] && return 0
  [ "$ONLY_AGENT" = "$a" ] && return 0
  return 1
}

# Shared merge logic for Claude- and Codex-shaped configs (same hooks.<event>[]
# nested-groups schema). Caller passes:
#   $1 = path to JSON config file
#   $2 = agent name (claude / codex)
#   $3 = JSON object {raw_event: canonical_event} as a string
#   $4 = JSON object of extra props per hook entry (e.g. {"timeout": 2}); "{}"
#
# Reads $HOOK_SH from the surrounding shell environment.
# Idempotent + repaths existing buddy-hook entries from any source path.
merge_hooks_json() {
  local file="$1" agent="$2" event_map_json="$3" extra_props_json="$4"

  HOOK_SH="$HOOK_SH" AGENT="$agent" EVENT_MAP="$event_map_json" EXTRA="$extra_props_json" \
    python3 - "$file" <<'PY' || log "$agent config merge failed"
import json, os, sys
path = sys.argv[1]
hook_sh = os.environ["HOOK_SH"]
agent   = os.environ["AGENT"]
event_map = json.loads(os.environ["EVENT_MAP"])
extra     = json.loads(os.environ["EXTRA"])

with open(path) as f:
    cfg = json.load(f) if os.path.getsize(path) > 0 else {}
cfg.setdefault("hooks", {})

def is_buddy_hook(cmd):
    """True if cmd looks like our buddy-hook.sh from any path."""
    if not isinstance(cmd, str): return False
    head = cmd.split()[0] if cmd.strip() else ""
    return (head.endswith("/buddy-hook.sh") or
            head.endswith("\\buddy-hook.sh") or
            head == "buddy-hook.sh")

for raw_event, canonical in event_map.items():
    desired = f"{hook_sh} {canonical} {agent}"
    groups = cfg["hooks"].setdefault(raw_event, [])
    found = False
    # Dedupe + repath: any existing buddy-hook entry (regardless of source
    # path) gets rewritten to point at the current launcher's copy. Prevents
    # double-firing when the project moves between checkouts.
    for g in list(groups):
        new_hooks = []
        for h in g.get("hooks", []):
            if h.get("type") == "command" and is_buddy_hook(h.get("command", "")):
                if not found:
                    h["command"] = desired
                    new_hooks.append(h)
                    found = True
                # Else: drop silently — duplicate of the one we just kept.
            else:
                new_hooks.append(h)
        g["hooks"] = new_hooks
    cfg["hooks"][raw_event] = [g for g in groups if g.get("hooks")]
    if not found:
        new_entry = {"type": "command", "command": desired, **extra}
        cfg["hooks"][raw_event].append({"hooks": [new_entry]})

with open(path, "w") as f:
    json.dump(cfg, f, indent=2)
print(f"[install-hooks] merged {agent} hooks into {path}")
PY
}

# --- claude --------------------------------------------------------------
install_claude() {
  command -v claude >/dev/null 2>&1 || { log "claude not on PATH — skipping"; return; }
  local file="$HOME/.claude/settings.json"
  mkdir -p "$(dirname "$file")"
  [ -f "$file" ] || echo '{}' >"$file"

  # Claude's lifecycle uses 1-to-1 names (no remap) and doesn't need timeout.
  merge_hooks_json "$file" "claude" \
    '{"SessionStart":"SessionStart","SessionEnd":"SessionEnd","UserPromptSubmit":"UserPromptSubmit","PreToolUse":"PreToolUse","PostToolUse":"PostToolUse","Notification":"Notification","Stop":"Stop"}' \
    '{}'
}

# --- codex ---------------------------------------------------------------
install_codex() {
  command -v codex >/dev/null 2>&1 || { log "codex not on PATH — skipping"; return; }
  local file="$HOME/.codex/hooks.json"
  local toml="$HOME/.codex/config.toml"
  mkdir -p "$(dirname "$file")"
  [ -f "$file" ] || echo '{}' >"$file"

  # Codex's lifecycle events → canonical event the bridge/REACTIONS use.
  # PermissionRequest is Codex's analog to Claude's Notification (fires when
  # Codex wants user approval); routing it to canonical "Notification" reuses
  # the existing ⚠️ angry-emote reaction. Codex doesn't fire SessionEnd or a
  # native Notification event — those rows just stay silent.
  merge_hooks_json "$file" "codex" \
    '{"SessionStart":"SessionStart","UserPromptSubmit":"UserPromptSubmit","PreToolUse":"PreToolUse","PostToolUse":"PostToolUse","Stop":"Stop","PermissionRequest":"Notification"}' \
    '{"timeout":2}'

  # Codex hooks are gated behind a feature flag in config.toml.
  # Four cases to handle correctly (the previous version only handled 1 + 4):
  #   1. file missing            → create with [features] block
  #   2. file has [features]+true → noop
  #   3. file has [features] but codex_hooks missing OR set to false → insert/update
  #   4. file lacks [features]   → append a new [features] block
  python3 - "$toml" <<'PY' || log "codex toml flag update failed"
import os, re, sys
path = sys.argv[1]

if not os.path.exists(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write("[features]\ncodex_hooks = true\n")
    print(f"[install-hooks] created {path} with codex_hooks = true")
    sys.exit(0)

with open(path) as f:
    text = f.read()

# Find the [features] section's start. TOML allows comments after section
# headers but not on the same line; a simple line-anchored match is enough.
features_re = re.compile(r"(?m)^\[features\][^\n]*\n")
m = features_re.search(text)

if m is None:
    # Case 4: append a new section. Ensure trailing newline before block.
    if text and not text.endswith("\n"):
        text += "\n"
    text += "\n[features]\ncodex_hooks = true\n"
    with open(path, "w") as f:
        f.write(text)
    print(f"[install-hooks] appended [features] block to {path}")
    sys.exit(0)

# Find the end of this [features] section: from end-of-header to either the
# next "[" line at column 0, or end-of-file.
header_end = m.end()
next_section = re.search(r"(?m)^\[", text[header_end:])
section_end = header_end + next_section.start() if next_section else len(text)
section_body = text[header_end:section_end]

# Look for an existing codex_hooks line within this body.
key_re = re.compile(r"(?m)^[[:space:]]*codex_hooks[[:space:]]*=[[:space:]]*([^\n#]+?)[[:space:]]*(#.*)?$")
# Python's regex doesn't recognise [[:space:]] — translate to \s.
key_re = re.compile(r"(?m)^[ \t]*codex_hooks[ \t]*=[ \t]*([^\n#]+?)[ \t]*(#.*)?$")
km = key_re.search(section_body)

if km is None:
    # Case 3a: section exists, line missing. Insert immediately under header.
    new_body = "codex_hooks = true\n" + section_body
    text = text[:header_end] + new_body + text[section_end:]
    with open(path, "w") as f:
        f.write(text)
    print(f"[install-hooks] inserted codex_hooks=true under existing [features] in {path}")
    sys.exit(0)

# Line exists — check value.
val = km.group(1).strip().lower()
if val == "true":
    sys.exit(0)  # case 2: already enabled, noop

# Case 3b: line exists but is false / something else → replace its value.
abs_start = header_end + km.start(1)
abs_end   = header_end + km.end(1)
text = text[:abs_start] + "true" + text[abs_end:]
with open(path, "w") as f:
    f.write(text)
print(f"[install-hooks] flipped codex_hooks from {val!r} to true in {path}")
PY
}

# --- copilot -------------------------------------------------------------
install_copilot() {
  command -v copilot >/dev/null 2>&1 || { log "copilot not on PATH — skipping"; return; }
  local hooks_dir="$PROJECT_ROOT/.github/hooks"
  local file="$hooks_dir/lumina.json"
  mkdir -p "$hooks_dir"

  # Compute absolute Windows path for the .ps1 sibling so the same file works
  # for whichever runtime the user picks. wslpath -w → "C:\…\buddy-hook.ps1".
  local hook_ps1_win=""
  if command -v wslpath >/dev/null 2>&1; then
    hook_ps1_win=$(wslpath -w "$PROJECT_ROOT/scripts/buddy-hook.ps1" 2>/dev/null || true)
  fi

  python3 - "$file" "$HOOK_SH" "$hook_ps1_win" <<'PY' || log "copilot config write failed"
import json, sys
file, hook_sh, hook_ps1_win = sys.argv[1], sys.argv[2], sys.argv[3]

# Copilot lifecycle event names → canonical PascalCase forwarded to the bridge.
event_map = {
    "sessionStart":        "SessionStart",
    "sessionEnd":          "SessionEnd",
    "userPromptSubmitted": "UserPromptSubmit",
    "preToolUse":          "PreToolUse",
    "postToolUse":         "PostToolUse",
    "errorOccurred":       "Notification",
}

def entry(canonical):
    e = {
        "type": "command",
        "bash": f"{hook_sh} {canonical} copilot",
        "timeoutSec": 2,
    }
    if hook_ps1_win:
        e["powershell"] = f"powershell -NoProfile -ExecutionPolicy Bypass -File \"{hook_ps1_win}\" {canonical} copilot"
    return e

cfg = {"version": 1, "hooks": {ce: [entry(canon)] for ce, canon in event_map.items()}}
with open(file, "w") as f:
    json.dump(cfg, f, indent=2)
print(f"[install-hooks] wrote copilot hooks to {file}")
PY
}

want_agent claude  && install_claude
want_agent codex   && install_codex
want_agent copilot && install_copilot

exit 0
