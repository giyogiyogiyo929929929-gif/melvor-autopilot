$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $project 'dist'
if (-not (Test-Path $dist)) { New-Item -ItemType Directory $dist | Out-Null }
$destination = Join-Path $dist 'melvor-autopilot-local-mod.zip'
$files = @('manifest.json', 'setup.mjs') | ForEach-Object { Join-Path $project $_ }
Compress-Archive -LiteralPath $files -DestinationPath $destination -Force
Write-Host "Created: $destination"
