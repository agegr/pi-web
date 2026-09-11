$ErrorActionPreference = 'Stop'

$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $project 'start-pi-web.cmd'
$icon = Join-Path $project 'public\pi-launcher.ico'
$programs = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'
$shortcutPath = Join-Path $programs 'Pi Web.lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $env:ComSpec
$shortcut.Arguments = "/c `"`"$launcher`"`""
$shortcut.WorkingDirectory = $project
$shortcut.Description = 'Launch local Pi Web source'
if (Test-Path $icon) { $shortcut.IconLocation = "$icon,0" }
$shortcut.Save()

Write-Host "Created Start Menu shortcut: $shortcutPath"
