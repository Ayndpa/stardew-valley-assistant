# pack-mod.ps1
# Build and package StardewValleyAssistant mod as zip
# Usage: Run from bundled-mods directory

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ModDir = Join-Path $ScriptDir "StardewValleyAssistant"
$BinDll = Join-Path $ModDir "bin\Release\StardewValleyAssistant.dll"
$Manifest = Join-Path $ModDir "manifest.json"
$OutputZip = Join-Path $ScriptDir "StardewValleyAssistant.zip"

# Game path for build references
$GamePath = "D:\Games\SteamLibrary\steamapps\common\Stardew Valley"

Write-Host "=== Building Mod ===" -ForegroundColor Cyan
dotnet build $ModDir -c Release -p:"GamePath=$GamePath" --nologo -v q
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    exit 1
}
Write-Host "Build succeeded" -ForegroundColor Green

if (-not (Test-Path $BinDll)) {
    Write-Host "DLL not found: $BinDll" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $Manifest)) {
    Write-Host "manifest.json not found: $Manifest" -ForegroundColor Red
    exit 1
}

if (Test-Path $OutputZip) {
    Remove-Item $OutputZip -Force
}

Write-Host "`n=== Packaging ZIP ===" -ForegroundColor Cyan

$TempDir = Join-Path $ScriptDir "_pack_temp"
if (Test-Path $TempDir) { Remove-Item $TempDir -Recurse -Force }
$PackDir = Join-Path $TempDir "StardewValleyAssistant"
New-Item -ItemType Directory -Path $PackDir -Force | Out-Null

Copy-Item $Manifest -Destination $PackDir
Copy-Item $BinDll -Destination $PackDir

Compress-Archive -Path (Join-Path $TempDir "*") -DestinationPath $OutputZip

Remove-Item $TempDir -Recurse -Force

$zipSize = (Get-Item $OutputZip).Length
$msg = "Done: $OutputZip ($zipSize bytes)"
Write-Host $msg -ForegroundColor Green
