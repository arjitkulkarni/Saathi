# Builds the Saathi interactive-session lock helper with the .NET Framework compiler that
# ships with Windows. Output: windows-helper\bin\SaathiLockHelper.exe
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File apps\agent\windows-helper\build.ps1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe not found at $csc" }
$outDir = Join-Path $here 'bin'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$exe = Join-Path $outDir 'SaathiLockHelper.exe'
$src = Join-Path $here 'LockHelper.cs'
$cscArgs = @('/nologo', '/target:winexe', '/optimize+', '/platform:anycpu', "/out:$exe", '/reference:System.dll', '/reference:System.Core.dll', '/reference:System.Windows.Forms.dll', $src)
& $csc @cscArgs
if ($LASTEXITCODE -ne 0) { throw "csc failed with exit code $LASTEXITCODE" }
Write-Output "Built $exe"
