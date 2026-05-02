# buddy-hook.ps1 — Windows-native counterpart of buddy-hook.sh.
# Usage (from each agent's hook config on Windows):
#   command: "powershell -NoProfile -ExecutionPolicy Bypass -File C:\…\buddy-hook.ps1 <event-type> <agent>"
#
# Same contract, hard rules, and envelope shape as buddy-hook.sh:
#   1. Always exit 0 — non-zero in PreToolUse blocks the agent's tool call.
#   2. Never write to stdout — agents may interpret it as injected context.
#   3. Cap network wait at 1s.

[CmdletBinding()]
param(
  [string] $EventType = "unknown",
  [string] $Agent = "claude"
)

# Hard rule: swallow all errors, always exit 0.
trap { exit 0 }
$ErrorActionPreference = 'SilentlyContinue'

$BridgeUrl = if ($env:BUDDY_BRIDGE_URL) { $env:BUDDY_BRIDGE_URL } else { 'http://127.0.0.1:3030/event' }

# Read full hook JSON from stdin.
$contextRaw = ''
if (-not [Console]::IsInputRedirected) {
  # No stdin attached — leave context empty.
} else {
  $contextRaw = [Console]::In.ReadToEnd()
}
if ([string]::IsNullOrWhiteSpace($contextRaw)) { $contextRaw = '{}' }

# Parse + extract per-agent fields.
$tool = $null
$session = $null
try {
  $ctx = $contextRaw | ConvertFrom-Json -ErrorAction Stop
  if ($Agent -eq 'copilot') {
    $tool = $ctx.toolName
    $session = $null  # Copilot stdin has no session id field
  } else {
    # claude, codex, future PascalCase agents
    $tool = $ctx.tool_name
    $session = $ctx.session_id
  }
} catch {
  # Bad JSON — fall through with nulls. Wrap raw in a stub object so downstream
  # debugging still has something.
  $ctx = @{ _raw = $contextRaw.Substring(0, [Math]::Min(1024, $contextRaw.Length)) }
}

if ([string]::IsNullOrWhiteSpace($tool))    { $tool = $null }
if ([string]::IsNullOrWhiteSpace($session)) { $session = $null }

$envelope = @{
  type    = $EventType
  tool    = $tool
  session = $session
  agent   = $Agent
  context = $ctx
} | ConvertTo-Json -Depth 12 -Compress

try {
  Invoke-WebRequest -Uri $BridgeUrl `
    -Method POST `
    -ContentType 'application/json' `
    -Body $envelope `
    -TimeoutSec 1 `
    -UseBasicParsing | Out-Null
} catch {
  # Bridge down or rate-limited — silently swallow.
}

exit 0
