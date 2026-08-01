$ErrorActionPreference = "Stop"

$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$launcherPath = Join-Path $PSScriptRoot "Start-PiWeb.ps1"
$iconPath = Join-Path $PSScriptRoot "assets\pi-web.ico"
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "Pi Web.lnk"

foreach ($path in @($projectRoot, $launcherPath, $iconPath)) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Required Pi Web launcher path was not found: $path"
  }
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherPath`""
$shortcut.WorkingDirectory = $projectRoot
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = "Start local Pi Web and open it in the browser"
$shortcut.Save()

Write-Output "Desktop shortcut created or updated: $shortcutPath"
