# Descarga la versión oficial de scrcpy (incluye adb y sus bibliotecas) desde GitHub
# y la deja en ..\bin. NovaCam Pro no redistribuye estos binarios: los baja el usuario
# directamente del proyecto original (licencias en THIRD_PARTY_NOTICES.md).
param(
    [string]$Version = "3.3.4",
    [string]$Dest = (Join-Path $PSScriptRoot "..\bin")
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$url = "https://github.com/Genymobile/scrcpy/releases/download/v$Version/scrcpy-win64-v$Version.zip"
$zip = Join-Path $env:TEMP "scrcpy-win64-v$Version.zip"
$tmp = Join-Path $env:TEMP "novacam_scrcpy_extract"

Write-Host "Descargando scrcpy v$Version desde GitHub..."
Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing

if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $tmp -Force

$src = (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName
if (-not $src -or -not (Test-Path (Join-Path $src "scrcpy.exe"))) {
    throw "El archivo descargado no contiene scrcpy.exe"
}

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Copy-Item -Path (Join-Path $src "*") -Destination $Dest -Recurse -Force

Remove-Item $zip -Force
Remove-Item $tmp -Recurse -Force
Write-Host "scrcpy y adb instalados en $Dest"
