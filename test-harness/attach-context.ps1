# Attach a file to the focused browser/app via UI Automation: find an attach/upload control, invoke it, then fill the Windows Open dialog.
param(
  [Parameter(Mandatory = $true)]
  [string]$FilePath
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $FilePath)) {
  exit 2
}

$resolved = (Resolve-Path -LiteralPath $FilePath).Path

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Native {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
}
"@

function Test-NameMatch {
  param([string]$Name)
  if ([string]::IsNullOrWhiteSpace($Name)) { return $false }
  return $Name -match '(?i)(attach|upload|add images|add files|paperclip|\+)'
}

function Invoke-Element {
  param([System.Windows.Automation.AutomationElement]$El)
  try {
    $ip = $El.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    if ($null -ne $ip) {
      $ip.Invoke()
      return $true
    }
  } catch {}
  try {
    $ep = $El.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
    if ($null -ne $ep) {
      $ep.Expand()
      return $true
    }
  } catch {}
  return $false
}

function Try-FindAndInvokeAttach {
  param(
    [System.Windows.Automation.AutomationElement]$Root,
    [int]$MaxDepth
  )
  $queue = New-Object System.Collections.Generic.Queue[object]
  $null = $queue.Enqueue(@($Root, 0))
  $best = $null
  $bestScore = -1

  while ($queue.Count -gt 0) {
    $pair = $queue.Dequeue()
    $el = $pair[0]
    $depth = $pair[1]
    if ($depth -gt $MaxDepth) { continue }

    try {
      $t = $el.Current.ControlType
      $name = $el.Current.Name
      if (Test-NameMatch $name) {
        $score = $depth
        if ($name -match '(?i)attach') { $score -= 2 }
        if ($t -eq [System.Windows.Automation.ControlType]::Button) { $score -= 1 }
        if ($null -eq $best -or $score -lt $bestScore) {
          $best = $el
          $bestScore = $score
        }
      }
    } catch {}

    try {
      $children = $el.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
      if ($null -ne $children) {
        foreach ($c in $children) {
          $null = $queue.Enqueue(@($c, $depth + 1))
        }
      }
    } catch {}
  }

  if ($null -ne $best) {
    return (Invoke-Element -El $best)
  }
  return $false
}

function Try-SetOpenDialogPath {
  param([string]$PathText)

  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  if ($null -eq $all) { return $false }

  foreach ($win in $all) {
    try {
      if ($win.Current.ClassName -ne '#32770') { continue }
    } catch { continue }

    $candidates = @(
      @{ Id = '1148' },
      @{ Id = '1001' },
      @{ Id = '40965' }
    )

    foreach ($c in $candidates) {
      try {
        $cond = New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::AutomationIdProperty, $c.Id)
        $edit = $win.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
        if ($null -eq $edit) { continue }
        $vp = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        if ($null -ne $vp) {
          $vp.SetValue($PathText)
          Start-Sleep -Milliseconds 200
          $btnCond = New-Object System.Windows.Automation.PropertyCondition (
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Button
          )
          $buttons = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $btnCond)
          if ($null -ne $buttons) {
            foreach ($b in $buttons) {
              try {
                $bn = $b.Current.Name
                if ($bn -eq 'Open' -or $bn -eq '&Open') {
                  if (Invoke-Element -El $b) { return $true }
                }
              } catch {}
            }
          }
          [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
          return $true
        }
      } catch {}
    }
  }

  return $false
}

$hwnd = [Native]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) { exit 10 }

$aeRoot = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
if ($null -eq $aeRoot) { exit 11 }

$clicked = Try-FindAndInvokeAttach -Root $aeRoot -MaxDepth 40
if (-not $clicked) { exit 20 }

Start-Sleep -Milliseconds 900

$deadline = [DateTime]::UtcNow.AddSeconds(12)
$set = $false
while ([DateTime]::UtcNow -lt $deadline) {
  if (Try-SetOpenDialogPath -PathText $resolved) {
    $set = $true
    break
  }
  Start-Sleep -Milliseconds 250
}

if (-not $set) { exit 30 }

Start-Sleep -Milliseconds 400
exit 0
