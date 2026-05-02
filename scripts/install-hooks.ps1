# install-hooks.ps1 — Windows-native hook installer for claude / codex / copilot.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File install-hooks.ps1 -Cwd <project> [-Agent <name>]
#
# Layout written:
#   claude  → %USERPROFILE%\.claude\settings.json                (merged in)
#   codex   → %USERPROFILE%\.codex\hooks.json + config.toml flag (merged in)
#   copilot → <project>\.github\hooks\lumina.json                (overwritten)

[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)] [string] $Cwd,
  [string] $Agent = ""
)

$ErrorActionPreference = 'Continue'

$ProjectRoot = $Cwd
$HookPs1 = Join-Path $ProjectRoot 'scripts\buddy-hook.ps1'
if (-not (Test-Path $HookPs1)) {
  Write-Output "[install-hooks.ps1] $HookPs1 not found — aborting"
  exit 1
}

$HookCmdPrefix = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$HookPs1`""

function Want-Agent([string]$a) {
  if ([string]::IsNullOrEmpty($Agent)) { return $true }
  return $Agent -eq $a
}

function Has-Cli([string]$name) {
  return $null -ne (Get-Command $name -ErrorAction SilentlyContinue)
}

# Detect a buddy-hook command regardless of its source path. Mirrors the
# bash version's is_buddy_hook so that moving the project between checkouts
# repaths the existing entry instead of adding a second one.
function Test-IsBuddyHook([string]$cmd) {
  if ([string]::IsNullOrWhiteSpace($cmd)) { return $false }
  # The .ps1 hook command always starts with `powershell ... -File "<path>\buddy-hook.ps1"`
  # — dedupe on the file name regardless of leading flags or prefix variations.
  if ($cmd -match 'buddy-hook\.ps1') { return $true }
  if ($cmd -match 'buddy-hook\.sh')  { return $true }   # cross-runtime safety
  return $false
}

# Merge a desired buddy-hook entry into an existing event group list,
# rewriting any existing buddy-hook entry's command + dropping duplicates.
# Returns the (possibly mutated) group list.
function Merge-HookGroups($groups, [string]$desired, [hashtable]$extraProps) {
  $result = @()
  $found  = $false
  foreach ($g in $groups) {
    $newHooks = @()
    if ($g.hooks) {
      foreach ($h in $g.hooks) {
        $isOurs = ($h.type -eq 'command') -and (Test-IsBuddyHook $h.command)
        if ($isOurs) {
          if (-not $found) {
            $h.command = $desired
            $newHooks += $h
            $found = $true
          }
          # else: drop silently (duplicate of the one we just kept)
        } else {
          $newHooks += $h
        }
      }
    }
    if ($newHooks.Count -gt 0) {
      $g.hooks = $newHooks
      $result += $g
    }
  }
  if (-not $found) {
    $entry = [pscustomobject]@{ type = 'command'; command = $desired }
    if ($extraProps) {
      foreach ($k in $extraProps.Keys) { $entry | Add-Member -NotePropertyName $k -NotePropertyValue $extraProps[$k] -Force }
    }
    $result += [pscustomobject]@{ hooks = @($entry) }
  }
  return ,$result
}

# --- claude --------------------------------------------------------------
function Install-Claude {
  if (-not (Has-Cli 'claude')) { Write-Output "[install-hooks.ps1] claude not on PATH — skipping"; return }
  $dir = Join-Path $env:USERPROFILE '.claude'
  $file = Join-Path $dir 'settings.json'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  if (-not (Test-Path $file)) { Set-Content -Path $file -Value '{}' -NoNewline }

  $cfg = Get-Content -Raw $file | ConvertFrom-Json
  if (-not $cfg.PSObject.Properties.Name -contains 'hooks') {
    $cfg | Add-Member -NotePropertyName hooks -NotePropertyValue (@{})
  }
  $events = @('SessionStart','SessionEnd','UserPromptSubmit','PreToolUse','PostToolUse','Notification','Stop')

  # Convert hooks to a hashtable for easy mutation, then back to PSCustomObject.
  $hooks = @{}
  if ($cfg.hooks) {
    foreach ($p in $cfg.hooks.PSObject.Properties) { $hooks[$p.Name] = $p.Value }
  }

  foreach ($evt in $events) {
    $desired = "$HookCmdPrefix $evt claude"
    $groups = @()
    if ($hooks.ContainsKey($evt)) { $groups = @($hooks[$evt]) }
    $hooks[$evt] = Merge-HookGroups -groups $groups -desired $desired -extraProps $null
  }

  $cfg.hooks = [pscustomobject]$hooks
  $cfg | ConvertTo-Json -Depth 12 | Set-Content -Path $file
  Write-Output "[install-hooks.ps1] merged claude hooks into $file"
}

# --- codex ---------------------------------------------------------------
function Install-Codex {
  if (-not (Has-Cli 'codex')) { Write-Output "[install-hooks.ps1] codex not on PATH — skipping"; return }
  $dir = Join-Path $env:USERPROFILE '.codex'
  $file = Join-Path $dir 'hooks.json'
  $toml = Join-Path $dir 'config.toml'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  if (-not (Test-Path $file)) { Set-Content -Path $file -Value '{}' -NoNewline }

  $cfg = Get-Content -Raw $file | ConvertFrom-Json
  if (-not $cfg.PSObject.Properties.Name -contains 'hooks') {
    $cfg | Add-Member -NotePropertyName hooks -NotePropertyValue (@{})
  }
  # Codex raw event → canonical event the bridge/REACTIONS use.
  # PermissionRequest is Codex's analog to Claude's Notification (fires when
  # Codex wants user approval); routing it to "Notification" reuses the same
  # ⚠️ avatar reaction across agents.
  $eventMap = [ordered]@{
    'SessionStart'      = 'SessionStart'
    'UserPromptSubmit'  = 'UserPromptSubmit'
    'PreToolUse'        = 'PreToolUse'
    'PostToolUse'       = 'PostToolUse'
    'Stop'              = 'Stop'
    'PermissionRequest' = 'Notification'
  }

  $hooks = @{}
  if ($cfg.hooks) {
    foreach ($p in $cfg.hooks.PSObject.Properties) { $hooks[$p.Name] = $p.Value }
  }

  foreach ($rawEvt in $eventMap.Keys) {
    $canonical = $eventMap[$rawEvt]
    $desired = "$HookCmdPrefix $canonical codex"
    $groups = @()
    if ($hooks.ContainsKey($rawEvt)) { $groups = @($hooks[$rawEvt]) }
    $hooks[$rawEvt] = Merge-HookGroups -groups $groups -desired $desired -extraProps @{ timeout = 2 }
  }

  $cfg.hooks = [pscustomobject]$hooks
  $cfg | ConvertTo-Json -Depth 12 | Set-Content -Path $file
  Write-Output "[install-hooks.ps1] merged codex hooks into $file"

  # Enable codex_hooks feature flag.
  if (-not (Test-Path $toml)) {
    Set-Content -Path $toml -Value "[features]`ncodex_hooks = true`n"
    Write-Output "[install-hooks.ps1] created $toml with codex_hooks = true"
  } else {
    $contents = Get-Content -Raw $toml
    if ($contents -notmatch '(?m)^\s*codex_hooks\s*=\s*true') {
      Add-Content -Path $toml -Value "`n[features]`ncodex_hooks = true`n"
      Write-Output "[install-hooks.ps1] appended codex_hooks=true to $toml"
    }
  }
}

# --- copilot -------------------------------------------------------------
function Install-Copilot {
  if (-not (Has-Cli 'copilot')) { Write-Output "[install-hooks.ps1] copilot not on PATH — skipping"; return }
  $hooksDir = Join-Path $ProjectRoot '.github\hooks'
  $file = Join-Path $hooksDir 'lumina.json'
  New-Item -ItemType Directory -Force -Path $hooksDir | Out-Null

  # WSL-side bash path for cross-runtime sharing. Best-effort.
  $hookShWsl = ''
  try { $hookShWsl = (& wsl wslpath -u ((Join-Path $ProjectRoot 'scripts\buddy-hook.sh'))) 2>$null } catch { }
  if (-not $hookShWsl) { $hookShWsl = '/mnt/c/Lumina/scripts/buddy-hook.sh' }  # placeholder; user-edited if wsl absent

  $eventMap = [ordered]@{
    'sessionStart'        = 'SessionStart'
    'sessionEnd'          = 'SessionEnd'
    'userPromptSubmitted' = 'UserPromptSubmit'
    'preToolUse'          = 'PreToolUse'
    'postToolUse'         = 'PostToolUse'
    'errorOccurred'       = 'Notification'
  }

  $hooks = [ordered]@{}
  foreach ($k in $eventMap.Keys) {
    $canon = $eventMap[$k]
    $hooks[$k] = @([pscustomobject]@{
      type       = 'command'
      bash       = "$hookShWsl $canon copilot"
      powershell = "$HookCmdPrefix $canon copilot"
      timeoutSec = 2
    })
  }

  $cfg = [pscustomobject]@{
    version = 1
    hooks   = [pscustomobject]$hooks
  }
  $cfg | ConvertTo-Json -Depth 12 | Set-Content -Path $file
  Write-Output "[install-hooks.ps1] wrote copilot hooks to $file"
}

if (Want-Agent 'claude')  { Install-Claude }
if (Want-Agent 'codex')   { Install-Codex }
if (Want-Agent 'copilot') { Install-Copilot }

exit 0
