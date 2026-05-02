#!/usr/bin/env bash
# tests/install-hooks.test.sh — verifies scripts/install-hooks.sh writes the
# correct hook config per agent and is idempotent across runs.
#
# Strategy: redirect $HOME and $PROJECT_ROOT to throwaway temp dirs, then
# stub out claude/codex/copilot binaries by prepending a tmp dir to PATH
# that contains shell scripts named after each CLI. The installer's
# `command -v` checks then succeed without us actually installing GitHub
# Copilot CLI, etc.
#
# Coverage:
#   1. Skip when CLI not on PATH
#   2. Write correct file paths per agent
#   3. Codex enables [features] codex_hooks=true in config.toml
#   4. Copilot config has both bash and powershell command keys
#   5. Idempotent: re-run produces identical files
#   6. Dedupe: existing entry from a different path gets repathed (not duplicated)
#   7. Doesn't clobber unrelated user keys (preserves "permissions" etc.)
#   8. ONLY_AGENT filter installs just one agent

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="$ROOT/scripts/install-hooks.sh"

PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); printf '  ✓ %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); printf '  ✗ %s\n      %s\n' "$1" "${2:-}"; }

# Each test runs in a fresh sandbox.
mk_sandbox() {
  local sb="$(mktemp -d -t lumina-install-hooks-XXXXXX)"
  mkdir -p "$sb/home" "$sb/project/scripts" "$sb/stub-bin"
  # Stub the real buddy-hook.sh path so the installer's existence check passes
  # (the installer chmod +x's it on first run).
  cp "$ROOT/scripts/buddy-hook.sh" "$sb/project/scripts/buddy-hook.sh"
  chmod +x "$sb/project/scripts/buddy-hook.sh"
  echo "$sb"
}

# Add a stub binary for the given CLI name to the sandbox PATH.
stub_cli() {
  local sb="$1" name="$2"
  printf '#!/usr/bin/env bash\nexit 0\n' >"$sb/stub-bin/$name"
  chmod +x "$sb/stub-bin/$name"
}

# Run installer in the sandbox.
# Important: PATH is *fully replaced* (not prepended) so the test isolates
# from the host's installed CLIs. Only $sb/stub-bin contains claude/codex/
# copilot stubs, plus the system bin paths needed by the installer itself
# (bash, python3, mkdir, grep, etc.).
run_installer() {
  local sb="$1" agent_filter="${2:-}"
  HOME="$sb/home" PATH="$sb/stub-bin:/usr/local/bin:/usr/bin:/bin" \
    bash "$INSTALLER" "$sb/project" "$agent_filter" >/dev/null 2>&1
}

cleanup_all() { :; }  # mktemp dirs cleaned by OS; keep empty for visibility on failure

trap cleanup_all EXIT

echo "=== install-hooks.test.sh — install-hooks.sh contracts ==="

# --- 1. Skip when CLI not on PATH ----------------------------------------
SB=$(mk_sandbox)
# No stubs — none of the three should be installed.
run_installer "$SB"
[ ! -f "$SB/home/.claude/settings.json" ] \
  && [ ! -f "$SB/home/.codex/hooks.json" ] \
  && [ ! -f "$SB/project/.github/hooks/lumina.json" ] \
  && pass "skips all agents when none on PATH" \
  || fail "skip-when-absent" "some config got written despite no stubs"
rm -rf "$SB"

# --- 2. Each agent writes to its expected path --------------------------
SB=$(mk_sandbox)
stub_cli "$SB" claude
stub_cli "$SB" codex
stub_cli "$SB" copilot
run_installer "$SB"
[ -f "$SB/home/.claude/settings.json" ] \
  && pass "claude → ~/.claude/settings.json written" \
  || fail "claude path" "missing $SB/home/.claude/settings.json"
[ -f "$SB/home/.codex/hooks.json" ] \
  && pass "codex → ~/.codex/hooks.json written" \
  || fail "codex path" "missing $SB/home/.codex/hooks.json"
[ -f "$SB/project/.github/hooks/lumina.json" ] \
  && pass "copilot → <project>/.github/hooks/lumina.json written" \
  || fail "copilot path" "missing $SB/project/.github/hooks/lumina.json"

# --- 3. Codex flips [features] codex_hooks=true in config.toml ----------
[ -f "$SB/home/.codex/config.toml" ] \
  && grep -qE '^\s*codex_hooks\s*=\s*true' "$SB/home/.codex/config.toml" \
  && pass "codex: config.toml has codex_hooks = true (feature flag enabled)" \
  || fail "codex feature flag" "config.toml missing codex_hooks=true"

# --- 4. Copilot config has both bash and powershell keys ----------------
COPILOT_FILE="$SB/project/.github/hooks/lumina.json"
python3 -c "
import json
with open('$COPILOT_FILE') as f:
    cfg = json.load(f)
assert cfg['version'] == 1, 'version field missing'
hooks = cfg['hooks']
required_events = ['sessionStart','sessionEnd','userPromptSubmitted','preToolUse','postToolUse','errorOccurred']
for e in required_events:
    assert e in hooks, f'missing event: {e}'
    entry = hooks[e][0]
    assert entry['type'] == 'command', f'{e}: type should be command'
    assert 'bash' in entry, f'{e}: missing bash key'
    assert 'powershell' in entry, f'{e}: missing powershell key'
    assert 'copilot' in entry['bash'], f'{e}: bash command missing agent arg'
print('OK')
" >/dev/null 2>&1 \
  && pass "copilot: lumina.json has bash + powershell for all 6 lifecycle events" \
  || fail "copilot config shape" "see $COPILOT_FILE"
rm -rf "$SB"

# --- 5. Idempotent: re-run produces identical config --------------------
SB=$(mk_sandbox)
stub_cli "$SB" claude
run_installer "$SB"
SUM_BEFORE=$(sha256sum "$SB/home/.claude/settings.json" | awk '{print $1}')
run_installer "$SB"
SUM_AFTER=$(sha256sum "$SB/home/.claude/settings.json" | awk '{print $1}')
[ "$SUM_BEFORE" = "$SUM_AFTER" ] \
  && pass "claude install is idempotent (sha256 stable across runs)" \
  || fail "idempotence" "before=$SUM_BEFORE after=$SUM_AFTER"

# Also verify no double-entries appeared.
ENTRY_COUNT=$(python3 -c "
import json
with open('$SB/home/.claude/settings.json') as f: cfg = json.load(f)
total = sum(len(g.get('hooks',[])) for evt in cfg.get('hooks',{}).values() for g in evt)
print(total)
")
# 7 events × 1 hook each = 7 entries.
[ "$ENTRY_COUNT" = "7" ] \
  && pass "claude: re-run leaves exactly 7 hook entries (no duplicates)" \
  || fail "duplicate-check" "got $ENTRY_COUNT entries (expected 7)"
rm -rf "$SB"

# --- 6. Dedupe by trailing filename: existing entry at a DIFFERENT path
#       gets repathed, not duplicated. This is the killer feature — when
#       the project moves between checkouts, hooks must consolidate.
SB=$(mk_sandbox)
stub_cli "$SB" claude
mkdir -p "$SB/home/.claude"
# Pre-seed settings.json with an entry pointing at an OLD/DIFFERENT path.
cat >"$SB/home/.claude/settings.json" <<JSON
{
  "hooks": {
    "PreToolUse": [
      { "hooks": [
          { "type": "command", "command": "/old/elsewhere/scripts/buddy-hook.sh PreToolUse claude" }
      ]}
    ]
  }
}
JSON
run_installer "$SB"
PRE_TOOL_COUNT=$(python3 -c "
import json
with open('$SB/home/.claude/settings.json') as f: cfg = json.load(f)
total = sum(len(g.get('hooks',[])) for g in cfg['hooks'].get('PreToolUse',[]))
print(total)
")
[ "$PRE_TOOL_COUNT" = "1" ] \
  && pass "dedupe: pre-existing buddy-hook entry at OLD path gets repathed (not duplicated)" \
  || fail "dedupe-old-path" "PreToolUse has $PRE_TOOL_COUNT entries (expected 1)"

# Verify the path was actually rewritten to the current sandbox project.
NEW_CMD=$(python3 -c "
import json
with open('$SB/home/.claude/settings.json') as f: cfg = json.load(f)
print(cfg['hooks']['PreToolUse'][0]['hooks'][0]['command'])
")
case "$NEW_CMD" in
  *"$SB/project/scripts/buddy-hook.sh"*) pass "dedupe: command path was rewritten to current launcher copy" ;;
  *) fail "dedupe-repath" "command is: $NEW_CMD" ;;
esac
rm -rf "$SB"

# --- 7. Preserves unrelated user keys (permissions, statusLine, env) -----
SB=$(mk_sandbox)
stub_cli "$SB" claude
mkdir -p "$SB/home/.claude"
cat >"$SB/home/.claude/settings.json" <<'JSON'
{
  "permissions": { "defaultMode": "auto", "allow": ["WebSearch"] },
  "statusLine": { "type": "command", "command": "ccusage statusline" },
  "skipDangerousModePermissionPrompt": true
}
JSON
run_installer "$SB"
PRESERVED=$(python3 -c "
import json
with open('$SB/home/.claude/settings.json') as f: cfg = json.load(f)
ok = (cfg.get('permissions',{}).get('defaultMode') == 'auto'
      and cfg.get('statusLine',{}).get('type') == 'command'
      and cfg.get('skipDangerousModePermissionPrompt') is True
      and 'hooks' in cfg)
print('yes' if ok else 'no')
")
[ "$PRESERVED" = "yes" ] \
  && pass "preserves unrelated user keys (permissions, statusLine, etc.)" \
  || fail "user-key-preservation" "settings.json corrupted user content"
rm -rf "$SB"

# --- 8. ONLY_AGENT filter installs just one agent ------------------------
SB=$(mk_sandbox)
stub_cli "$SB" claude
stub_cli "$SB" codex
stub_cli "$SB" copilot
run_installer "$SB" copilot
[ ! -f "$SB/home/.claude/settings.json" ] \
  && [ ! -f "$SB/home/.codex/hooks.json" ] \
  && [ -f "$SB/project/.github/hooks/lumina.json" ] \
  && pass "ONLY_AGENT=copilot installs only copilot (skips claude/codex)" \
  || fail "agent-filter" "filter ignored — multiple agents installed"
rm -rf "$SB"

# --- 9. Codex events: no SessionEnd, no Notification (Codex doesn't fire those)
SB=$(mk_sandbox)
stub_cli "$SB" codex
run_installer "$SB"
EVENT_LIST=$(python3 -c "
import json
with open('$SB/home/.codex/hooks.json') as f: cfg = json.load(f)
print(','.join(sorted(cfg.get('hooks',{}).keys())))
")
case "$EVENT_LIST" in
  *SessionEnd*)   fail "codex events" "should NOT include SessionEnd (got $EVENT_LIST)" ;;
  *Notification*) fail "codex events" "should NOT include Notification raw key (got $EVENT_LIST)" ;;
  *) pass "codex hooks.json omits SessionEnd + raw Notification (Codex doesn't fire those)" ;;
esac
# Should include exactly the 6 supported codex lifecycle events including
# PermissionRequest (which is Codex's equivalent of Claude's Notification).
EXPECTED="PermissionRequest,PostToolUse,PreToolUse,SessionStart,Stop,UserPromptSubmit"
[ "$EVENT_LIST" = "$EXPECTED" ] \
  && pass "codex: exactly the 6 supported lifecycle events (incl. PermissionRequest)" \
  || fail "codex events" "got $EVENT_LIST (expected $EXPECTED)"

# --- 10. Codex PermissionRequest is mapped to canonical Notification -----
# The hook command should call buddy-hook.sh with "Notification codex" args
# so the existing ⚠️ angry emote and bubble line fire uniformly with Claude.
PERM_CMD=$(python3 -c "
import json
with open('$SB/home/.codex/hooks.json') as f: cfg = json.load(f)
print(cfg['hooks']['PermissionRequest'][0]['hooks'][0]['command'])
")
case "$PERM_CMD" in
  *"buddy-hook.sh Notification codex"*)
    pass "codex PermissionRequest → buddy-hook.sh with canonical 'Notification' arg" ;;
  *) fail "codex permission canonical" "command was: $PERM_CMD" ;;
esac
rm -rf "$SB"

# --- 11. Codex TOML: file missing → created with [features]+true ----------
SB=$(mk_sandbox)
stub_cli "$SB" codex
run_installer "$SB"
TOML="$SB/home/.codex/config.toml"
[ -f "$TOML" ] && grep -qE '^\[features\]' "$TOML" && grep -qE '^[ \t]*codex_hooks[ \t]*=[ \t]*true' "$TOML" \
  && pass "codex toml: missing file → created with [features] + codex_hooks=true" \
  || fail "toml-create" "$TOML missing or malformed"
rm -rf "$SB"

# --- 12. Codex TOML: [features] exists + codex_hooks=true → noop (idempotent)
SB=$(mk_sandbox)
stub_cli "$SB" codex
mkdir -p "$SB/home/.codex"
cat >"$SB/home/.codex/config.toml" <<'TOML'
[features]
codex_hooks = true
something_else = "preserved"
TOML
SUM_BEFORE=$(sha256sum "$SB/home/.codex/config.toml" | awk '{print $1}')
run_installer "$SB"
SUM_AFTER=$(sha256sum "$SB/home/.codex/config.toml" | awk '{print $1}')
[ "$SUM_BEFORE" = "$SUM_AFTER" ] \
  && pass "codex toml: existing codex_hooks=true preserved (idempotent, no rewrite)" \
  || fail "toml-idempotent" "config.toml was modified despite already correct"
rm -rf "$SB"

# --- 13. Codex TOML: [features] exists but codex_hooks missing → inserted --
SB=$(mk_sandbox)
stub_cli "$SB" codex
mkdir -p "$SB/home/.codex"
cat >"$SB/home/.codex/config.toml" <<'TOML'
[features]
existing_flag = true
TOML
run_installer "$SB"
TOML="$SB/home/.codex/config.toml"
# Must contain BOTH the existing flag and the new codex_hooks line.
grep -q 'existing_flag = true' "$TOML" \
  && grep -qE '^[ \t]*codex_hooks[ \t]*=[ \t]*true' "$TOML" \
  && [ "$(grep -cE '^\[features\]' "$TOML")" = "1" ] \
  && pass "codex toml: codex_hooks inserted under existing [features] (no duplicate section)" \
  || fail "toml-insert-under-features" "expected existing_flag preserved + single [features] block"
rm -rf "$SB"

# --- 14. Codex TOML: codex_hooks=false → flipped to true ------------------
SB=$(mk_sandbox)
stub_cli "$SB" codex
mkdir -p "$SB/home/.codex"
cat >"$SB/home/.codex/config.toml" <<'TOML'
[features]
codex_hooks = false
TOML
run_installer "$SB"
TOML="$SB/home/.codex/config.toml"
grep -qE '^[ \t]*codex_hooks[ \t]*=[ \t]*true' "$TOML" \
  && ! grep -qE '^[ \t]*codex_hooks[ \t]*=[ \t]*false' "$TOML" \
  && pass "codex toml: flipped codex_hooks=false → true (no duplicate keys)" \
  || fail "toml-flip" "expected codex_hooks=true, no leftover false"
rm -rf "$SB"

# --- 15. Codex TOML: existing file without [features] → block appended ----
SB=$(mk_sandbox)
stub_cli "$SB" codex
mkdir -p "$SB/home/.codex"
cat >"$SB/home/.codex/config.toml" <<'TOML'
[other_section]
foo = "bar"
TOML
run_installer "$SB"
TOML="$SB/home/.codex/config.toml"
grep -q 'foo = "bar"' "$TOML" \
  && grep -qE '^\[features\]' "$TOML" \
  && grep -qE '^[ \t]*codex_hooks[ \t]*=[ \t]*true' "$TOML" \
  && pass "codex toml: appended new [features] block when absent (other sections preserved)" \
  || fail "toml-append-section" "expected [other_section] preserved + new [features] appended"
rm -rf "$SB"

echo
echo "  install-hooks: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
