# Runs hidden from the NSIS installer: ensure Ollama is listening, then pull llama3.
$ErrorActionPreference = 'Stop'

$pf = Join-Path $env:ProgramFiles 'Ollama\ollama.exe'
$la = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
$exe = $null
if (Test-Path -LiteralPath $pf) { $exe = $pf }
elseif (Test-Path -LiteralPath $la) { $exe = $la }

if (-not $exe) {
  Write-Error 'Ollama executable not found under Program Files or Local AppData.'
}

function Test-OllamaUp {
  try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:11434' -UseBasicParsing -TimeoutSec 2
    return $r.StatusCode -ge 200
  } catch {
    return $false
  }
}

if (-not (Test-OllamaUp)) {
  Start-Process -FilePath $exe -WindowStyle Hidden -ErrorAction SilentlyContinue | Out-Null
}

$deadline = (Get-Date).AddMinutes(15)
while ((Get-Date) -lt $deadline) {
  if (Test-OllamaUp) { break }
  Start-Sleep -Seconds 2
}

if (-not (Test-OllamaUp)) {
  Write-Error 'Ollama API did not become reachable at http://127.0.0.1:11434.'
}

$ProgressPreference = 'SilentlyContinue'
$body = '{"name":"llama3","stream":false}'
Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/pull' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 7200
