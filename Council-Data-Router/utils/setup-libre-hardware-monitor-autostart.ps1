$ErrorActionPreference = "Stop"

$taskName = "CouncilHUD-LibreHardwareMonitor"
$packageId = "LibreHardwareMonitor.LibreHardwareMonitor"
$packageDir = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\LibreHardwareMonitor.LibreHardwareMonitor_Microsoft.Winget.Source_8wekyb3d8bbwe"
$packageExe = Join-Path $packageDir "LibreHardwareMonitor.exe"
$linkExe = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\LibreHardwareMonitor.exe"

function Test-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Relaunch-AsAdmin {
    $scriptPath = $PSCommandPath
    Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", "`"$scriptPath`""
    )
}

function Resolve-LibreHardwareMonitor {
    if (Test-Path -LiteralPath $packageExe) { return $packageExe }
    if (Test-Path -LiteralPath $linkExe) { return $linkExe }

    $command = Get-Command "LibreHardwareMonitor.exe" -ErrorAction SilentlyContinue
    if ($command?.Source -and (Test-Path -LiteralPath $command.Source)) {
        return $command.Source
    }

    return $null
}

function Install-LibreHardwareMonitor {
    $winget = Get-Command "winget.exe" -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw "winget.exe is not available. Install LibreHardwareMonitor manually, then rerun this script."
    }

    & $winget.Source install --id $packageId -e --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "winget failed to install $packageId."
    }
}

function Set-AppSetting {
    param(
        [xml]$Document,
        [System.Xml.XmlElement]$SettingsNode,
        [string]$Key,
        [string]$Value
    )

    $node = $SettingsNode.SelectSingleNode("add[@key='$Key']")
    if (-not $node) {
        $node = $Document.CreateElement("add")
        $node.SetAttribute("key", $Key)
        [void]$SettingsNode.AppendChild($node)
    }
    $node.SetAttribute("value", $Value)
}

function Enable-LibreHardwareMonitorWebFeed {
    param([string]$ExecutablePath)

    $installDir = Split-Path -Parent $ExecutablePath
    $configPath = Join-Path $installDir "LibreHardwareMonitor.config"

    if (Test-Path -LiteralPath $configPath) {
        [xml]$xml = Get-Content -LiteralPath $configPath
    } else {
        $xml = [xml]"<?xml version=`"1.0`" encoding=`"utf-8`"?><configuration><appSettings /></configuration>"
    }

    if (-not $xml.configuration) {
        $configuration = $xml.CreateElement("configuration")
        [void]$xml.AppendChild($configuration)
    }

    $appSettings = $xml.configuration.appSettings
    if (-not $appSettings) {
        $appSettings = $xml.CreateElement("appSettings")
        [void]$xml.configuration.AppendChild($appSettings)
    }

    Set-AppSetting $xml $appSettings "runWebServerMenuItem" "true"
    Set-AppSetting $xml $appSettings "listenerPort" "8085"
    Set-AppSetting $xml $appSettings "authenticationEnabled" "false"
    Set-AppSetting $xml $appSettings "startMinMenuItem" "true"
    Set-AppSetting $xml $appSettings "minTrayMenuItem" "true"
    Set-AppSetting $xml $appSettings "minCloseMenuItem" "true"
    Set-AppSetting $xml $appSettings "cpuMenuItem" "true"
    Set-AppSetting $xml $appSettings "mainboardMenuItem" "true"

    $xml.Save($configPath)
}

function Register-LibreHardwareMonitorTask {
    param([string]$ExecutablePath)

    $userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $action = New-ScheduledTaskAction -Execute $ExecutablePath
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
    $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit ([TimeSpan]::Zero)

    Register-ScheduledTask `
        -TaskName $taskName `
        -Action $action `
        -Trigger $trigger `
        -Principal $principal `
        -Settings $settings `
        -Description "Starts LibreHardwareMonitor for Council HUD CORE_TEMP telemetry." `
        -Force | Out-Null
}

if (-not (Test-Admin)) {
    Write-Host "Requesting administrator approval for one-time LibreHardwareMonitor autostart setup..."
    Relaunch-AsAdmin
    exit 0
}

$exe = Resolve-LibreHardwareMonitor
if (-not $exe) {
    Install-LibreHardwareMonitor
    $exe = Resolve-LibreHardwareMonitor
}

if (-not $exe) {
    throw "LibreHardwareMonitor.exe was not found after installation."
}

Enable-LibreHardwareMonitorWebFeed -ExecutablePath $exe
Register-LibreHardwareMonitorTask -ExecutablePath $exe

Get-Process -Name "LibreHardwareMonitor" -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue

Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 8

Write-Host "LibreHardwareMonitor autostart task is installed: $taskName"
Write-Host "Sensor feed expected at: http://127.0.0.1:8085/data.json"
