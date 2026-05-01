!macro customInstall
  ${if} ${RunningX64}
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { $ok = (Invoke-WebRequest -Uri ''http://localhost:11434'' -UseBasicParsing -TimeoutSec 2).StatusCode -ge 200 } catch { $ok = $false }; if (-not $ok) { $installer = Join-Path $env:TEMP ''ollama-installer.exe''; Invoke-WebRequest -Uri ''https://ollama.com/download/windows'' -OutFile $installer; Start-Process -FilePath $installer -ArgumentList ''/S'' -Wait }"'
  ${endif}
!macroend
