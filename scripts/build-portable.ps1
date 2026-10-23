param(
    [string]$NodeVersion = '24.15.0',
    [string]$NodeExecutable,
    [switch]$IncludeConfig
)
$ErrorActionPreference = 'Stop'
if ($NodeVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid Node version' }
$projectRoot = Split-Path $PSScriptRoot -Parent
$buildId = Get-Date -Format 'yyyyMMdd-HHmmss'
$outputRoot = Join-Path $projectRoot 'dist'
$buildRoot = Join-Path $outputRoot "portable-build-$buildId"
$appRoot = Join-Path $buildRoot 'zaban-invoice'
$null = New-Item -ItemType Directory -Path $appRoot
$runtimeDir = Join-Path $appRoot 'runtime'
$null = New-Item -ItemType Directory -Path $runtimeDir

# The official Windows x64 archive contains the executable and distribution license.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if ($NodeExecutable) {
    $signature = Get-AuthenticodeSignature -LiteralPath $NodeExecutable
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=OpenJS Foundation') { throw 'Node executable must have a valid OpenJS signature' }
    $runtimeInfo = & $NodeExecutable -p "process.version + ':' + process.platform + ':' + process.arch"
    if ($runtimeInfo -ne "v${NodeVersion}:win32:x64") { throw 'Node version or architecture does not match' }
    Copy-Item -LiteralPath $NodeExecutable -Destination (Join-Path $runtimeDir 'node.exe')
    Invoke-WebRequest -UseBasicParsing -TimeoutSec 30 -Uri "https://raw.githubusercontent.com/nodejs/node/v$NodeVersion/LICENSE" -OutFile (Join-Path $runtimeDir 'LICENSE.txt')
} else {
$archiveName = "node-v$NodeVersion-win-x64.zip"
$releaseUrl = "https://nodejs.org/dist/v$NodeVersion"
$archivePath = Join-Path $buildRoot $archiveName
Invoke-WebRequest -UseBasicParsing -TimeoutSec 90 -Uri "$releaseUrl/$archiveName" -OutFile $archivePath
$checksums = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 30 -Uri "$releaseUrl/SHASUMS256.txt").Content
$checksumLine = ($checksums -split "`n" | Where-Object { $_.Trim().EndsWith("  $archiveName") })
if (@($checksumLine).Count -ne 1) { throw 'Official checksum not found' }
$expectedHash = ($checksumLine.Trim() -split '\s+')[0]
if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Node archive checksum mismatch' }
Expand-Archive -LiteralPath $archivePath -DestinationPath (Join-Path $buildRoot 'node-source')
$nodeRoot = Join-Path $buildRoot "node-source/node-v$NodeVersion-win-x64"
Copy-Item -LiteralPath (Join-Path $nodeRoot 'node.exe') -Destination $runtimeDir
Copy-Item -LiteralPath (Join-Path $nodeRoot 'LICENSE') -Destination (Join-Path $runtimeDir 'LICENSE.txt')
}
$runtimeHash = (Get-FileHash -LiteralPath (Join-Path $runtimeDir 'node.exe') -Algorithm SHA256).Hash

$files = @('server.js', 'digital-invoice.js', 'original-documents.js', 'priority-sdk.js', 'invoice-payload.js', 'exchange-rates.js', 'gold-rates.js', 'package.json', 'package-lock.json', 'start-server.bat', '.env.example')
foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $appRoot }
Copy-Item -LiteralPath (Join-Path $projectRoot 'public') -Destination $appRoot -Recurse
if ($IncludeConfig) {
    if (!(Test-Path -LiteralPath (Join-Path $projectRoot '.env'))) { throw 'Configured package requested but .env is missing' }
    Copy-Item -LiteralPath (Join-Path $projectRoot '.env') -Destination $appRoot
}

# npm is used only on the build machine. The target server needs no installer or npm.
Push-Location $appRoot
try {
    & npm.cmd ci --omit=dev --ignore-scripts --no-audit --no-fund --prefer-offline --fetch-retries=0 --fetch-timeout=20000
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
    & (Join-Path $runtimeDir 'node.exe') -e "require('priority-web-sdk'); require('./gold-rates'); require('./exchange-rates'); console.log('Portable modules OK')"
    if ($LASTEXITCODE -ne 0) { throw 'Portable runtime verification failed' }
} finally { Pop-Location }

Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'PORTABLE-README.txt') -Destination (Join-Path $appRoot 'START-HERE.txt')
$revision = (& git -C $projectRoot rev-parse --short HEAD)
@{ builtAt = [DateTime]::UtcNow.ToString('o'); node = $NodeVersion; platform = 'win-x64'; sourceRevision = $revision; includesLocalConfig = [bool]$IncludeConfig; nodeExecutableSha256 = $runtimeHash; nodeSigner = 'OpenJS Foundation' } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $appRoot 'build-info.json') -Encoding UTF8
$zipPath = Join-Path $outputRoot "zaban-invoice-portable-win-x64-$buildId.zip"
# ZipFile includes .env and all other files, including hidden files.
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($buildRoot + '/zaban-invoice', $zipPath, [IO.Compression.CompressionLevel]::Optimal, $false)
Write-Output "PORTABLE_FOLDER=$appRoot"
Write-Output "PORTABLE_ZIP=$zipPath"
