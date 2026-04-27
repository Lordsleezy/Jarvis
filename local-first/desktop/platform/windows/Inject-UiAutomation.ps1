# Windows: UI Automation on the focused element (ValuePattern), then clipboard + SendKeys fallback.
param(
  [Parameter(Mandatory = $true)]
  [string]$PayloadPath
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $PayloadPath)) {
  exit 1
}

$text = [System.IO.File]::ReadAllText($PayloadPath, [System.Text.UTF8Encoding]::new($false))

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

function Try-ValuePattern {
  param([System.Windows.Automation.AutomationElement]$El, [string]$Value)
  try {
    $vp = $El.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    if ($null -ne $vp) {
      $vp.SetValue($Value)
      return $true
    }
  } catch {
  }
  return $false
}

$focused = [System.Windows.Automation.AutomationElement]::FocusedElement
if ($null -eq $focused) {
  exit 10
}

if (Try-ValuePattern -El $focused -Value $text) {
  exit 0
}

# Some hosts expose a child edit with ValuePattern — shallow search
try {
  $cond = [System.Windows.Automation.Condition]::TrueCondition
  $children = $focused.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
  foreach ($c in $children) {
    if (Try-ValuePattern -El $c -Value $text) {
      exit 0
    }
  }
} catch {
}

# Fallback: Accessibility-adjacent input path used by many UIA clients — clipboard paste
[System.Windows.Forms.Clipboard]::SetText($text)
Start-Sleep -Milliseconds 150
$shell = New-Object -ComObject WScript.Shell
$shell.SendKeys('^v')
exit 0
