param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRoot,

  [string]$NvidiaApiKey
)

$ErrorActionPreference = 'Stop'

function ConvertFrom-SecureStringPlainText {
  param([securestring]$SecureValue)

  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try {
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

$resolvedRoot = Resolve-Path -LiteralPath $ProjectRoot
$envFile = Join-Path $resolvedRoot '.env.local'

if ([string]::IsNullOrWhiteSpace($NvidiaApiKey)) {
  $secureKey = Read-Host 'Paste NVIDIA API key' -AsSecureString
  $NvidiaApiKey = ConvertFrom-SecureStringPlainText -SecureValue $secureKey
}

$NvidiaApiKey = $NvidiaApiKey.Trim()
if ([string]::IsNullOrWhiteSpace($NvidiaApiKey)) {
  throw 'NVIDIA API key cannot be empty.'
}

if (-not $NvidiaApiKey.StartsWith('nvapi-')) {
  throw 'NVIDIA API key should start with nvapi-.'
}

if ($NvidiaApiKey -match "[`r`n]") {
  throw 'NVIDIA API key cannot contain newlines.'
}

$nextLine = "NVIDIA_API_KEY=$NvidiaApiKey"

if (Test-Path -LiteralPath $envFile) {
  $lines = Get-Content -LiteralPath $envFile
} else {
  $lines = @()
}

$found = $false
$updated = foreach ($line in $lines) {
  if ($line -match '^\s*NVIDIA_API_KEY\s*=') {
    $found = $true
    $nextLine
  } else {
    $line
  }
}

if (-not $found) {
  if ($updated.Count -gt 0 -and $updated[-1] -ne '') {
    $updated += ''
  }
  $updated += $nextLine
}

Set-Content -LiteralPath $envFile -Value $updated -Encoding UTF8
Write-Host 'NVIDIA_API_KEY saved to .env.local'
