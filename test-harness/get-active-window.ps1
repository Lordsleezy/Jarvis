param()

$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class Win32 {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

  [DllImport("user32.dll", SetLastError=true)]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@

$hwnd = [Win32]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) {
  @{ owner = @{ name = "" }; title = "" } | ConvertTo-Json -Compress
  exit 0
}

$sb = New-Object System.Text.StringBuilder 2048
[void][Win32]::GetWindowText($hwnd, $sb, $sb.Capacity)
$title = $sb.ToString()

$processPid = 0
[void][Win32]::GetWindowThreadProcessId($hwnd, [ref]$processPid)
$procName = ""
if ($processPid -gt 0) {
  try {
    $p = Get-Process -Id $processPid -ErrorAction Stop
    $procName = $p.ProcessName
  } catch {
    $procName = ""
  }
}

@{
  owner = @{ name = $procName }
  title = $title
} | ConvertTo-Json -Compress
