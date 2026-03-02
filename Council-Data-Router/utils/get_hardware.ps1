# Council HUD Hardware Probe V16
$cpu = [math]::Round((Get-Counter -Counter '\Processor(_Total)\% Processor Time' -ErrorAction SilentlyContinue).CounterSamples[0].CookedValue)
if (!$cpu) { $cpu = (Get-WmiObject Win32_Processor).LoadPercentage }

$mem = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory -ErrorAction SilentlyContinue
$ram = $mem.PercentCommittedBytesInUse
if (!$ram) {
    $os = Get-CimInstance Win32_OperatingSystem
    $ram = [math]::Round((($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / $os.TotalVisibleMemorySize) * 100)
}

$uptime = [math]::Round(((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalSeconds)

# Output as a single piped string for fast parsing
Write-Output "$cpu|$ram|$uptime"
