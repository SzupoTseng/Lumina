# start-terminal.ps1 — Windows-native counterpart of start-terminal.sh.
# Same contract: launch the node-pty WebSocket terminal server on :3031,
# write its auth token to %LOCALAPPDATA%\Lumina\terminal.token, and emit
# diagnostic codes to terminal.error so the C# launcher can show actionable
# error UI instead of "token unavailable".

[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)] [string] $Cwd,
  [string] $Agent = "bash"
)

$ErrorActionPreference = 'Stop'

$LuminaRoot = Split-Path -Parent $PSScriptRoot
$Server = Join-Path $LuminaRoot 'src\terminal\server.mjs'
$Port = 3031

$CacheDir = Join-Path $env:LOCALAPPDATA 'Lumina'
$TokenFile = Join-Path $CacheDir 'terminal.token'
$ErrFile   = Join-Path $CacheDir 'terminal.error'
$LogFile   = Join-Path $CacheDir 'terminal.log'
# Tracks which agent the running PTY server was launched with — see the
# matching block in start-terminal.sh for the reasoning. Without this,
# switching agents in the setup dialog has no visible effect because the
# old server keeps the port and the launcher just re-attaches to it.
$AgentFile = Join-Path $CacheDir 'terminal.agent'

New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null
Remove-Item -Force -ErrorAction SilentlyContinue $ErrFile
function Write-Diag([string] $code) { Set-Content -Path $ErrFile -Value $code -NoNewline }

# Map agent name → command. bash on Windows isn't standard; for that case we
# fall back to powershell to keep the panel usable.
switch ($Agent) {
  'claude'  { $Cmd = 'claude' }
  'copilot' { $Cmd = 'copilot' }
  'codex'   { $Cmd = 'codex' }
  'bash'    { $Cmd = 'powershell' }
  ''        { $Cmd = 'powershell' }
  default   { $Cmd = $Agent }
}

# Existence check (skipped for powershell — always available)
if ($Cmd -ne 'powershell' -and -not (Get-Command $Cmd -ErrorAction SilentlyContinue)) {
  Write-Diag "AGENT_MISSING:$Agent"
  exit 1
}

# node-pty deps check
$PtyDir = Join-Path $LuminaRoot 'src\terminal\node_modules\node-pty'
if (-not (Test-Path $PtyDir)) {
  Write-Diag "DEPS_MISSING"
  exit 1
}

# If the port is already taken and we have a stable token, reuse it ONLY when
# the running PTY was launched with the same agent. Different agent → kill +
# restart so the user actually sees the agent they just picked.
$portTaken = $null -ne (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
if ($portTaken -and (Test-Path $TokenFile) -and ((Get-Item $TokenFile).Length -gt 0)) {
  $prevAgent = ''
  if (Test-Path $AgentFile) { $prevAgent = (Get-Content -Raw $AgentFile -ErrorAction SilentlyContinue).Trim() }
  if ($prevAgent -eq $Agent) {
    Write-Output "[start-terminal.ps1] already listening on :$Port (agent=$Agent, reusing)"
    exit 0
  }
  Write-Output "[start-terminal.ps1] agent change detected (was='$prevAgent', want='$Agent') — restarting server"
  Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 500
}

# Generate / reuse token
if (-not (Test-Path $TokenFile) -or (Get-Item $TokenFile).Length -eq 0) {
  $bytes = New-Object byte[] 16
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $hex = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  Set-Content -Path $TokenFile -Value $hex -NoNewline
}
$Token = (Get-Content -Raw $TokenFile).Trim()
if ($Token -notmatch '^[0-9a-f]{32}$') {
  $bytes = New-Object byte[] 16
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $hex = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  Set-Content -Path $TokenFile -Value $hex -NoNewline
  $Token = $hex
}

# Free the port if anything else is squatting on it.
if ($portTaken) {
  Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 300
}

# Spawn detached: PowerShell child process with hidden window, env var injects token.
$env:LUMINA_TERMINAL_TOKEN = $Token
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'node'
$psi.ArgumentList.Add($Server)
$psi.ArgumentList.Add($Port.ToString())
$psi.ArgumentList.Add($Cwd)
$psi.ArgumentList.Add($Cmd)
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.WindowStyle = 'Hidden'
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.EnvironmentVariables['LUMINA_TERMINAL_TOKEN'] = $Token

try {
  $proc = [System.Diagnostics.Process]::Start($psi)
} catch {
  Write-Diag "SERVER_NOT_STARTED"
  exit 1
}

# Best-effort log — async copy stdout/stderr to log file. The process is detached
# so we don't await it.
Start-Job -ScriptBlock {
  param($p, $log)
  while (-not $p.HasExited) {
    $p.StandardOutput.ReadLine() | Add-Content -Path $log -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 100
  }
} -ArgumentList $proc, $LogFile | Out-Null

# Wait up to 5s for the port to open.
for ($i = 0; $i -lt 10; $i++) {
  Start-Sleep -Milliseconds 500
  $listening = $null -ne (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
  if ($listening) {
    # Persist the agent so the next invocation can detect agent-switch.
    Set-Content -Path $AgentFile -Value $Agent -NoNewline
    Write-Output "[start-terminal.ps1] ready on :$Port (agent=$Agent)"
    exit 0
  }
}

Write-Diag "SERVER_NOT_STARTED"
exit 1
