param(
    [string]$NodeVersion = '24.15.0',
    [string]$NodeExecutable,
    [string]$NodeLicenseFile,
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
    if ($NodeLicenseFile) {
        Copy-Item -LiteralPath $NodeLicenseFile -Destination (Join-Path $runtimeDir 'LICENSE.txt')
    } else {
        Invoke-WebRequest -UseBasicParsing -TimeoutSec 30 -Uri "https://raw.githubusercontent.com/nodejs/node/v$NodeVersion/LICENSE" -OutFile (Join-Path $runtimeDir 'LICENSE.txt')
    }
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

$files = @('server.js', 'digital-invoice.js', 'invoice-mail.js', 'n8n-mail.js', 'signature-fields.js', 'original-documents.js', 'priority-sdk.js', 'invoice-payload.js', 'exchange-rates.js', 'gold-rates.js', 'package.json', 'package-lock.json', 'start-server.bat', '.env.example')
foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $appRoot }
Copy-Item -LiteralPath (Join-Path $projectRoot 'public') -Destination $appRoot -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md') -Destination $appRoot
foreach ($directory in @('test', 'scripts', 'priority', 'n8n', 'workflows')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $directory) -Destination $appRoot -Recurse
}
$docsRoot = Join-Path $appRoot 'docs'
$null = New-Item -ItemType Directory -Path $docsRoot
Get-ChildItem -LiteralPath (Join-Path $projectRoot 'docs') -File -Filter '*.md' | Copy-Item -Destination $docsRoot
# The included scanner tests read these generated barcode fixtures. Copy only
# these fixtures, rather than development screenshots or customer documents.
$cameraFixturesRoot = Join-Path $docsRoot 'camera-scan'
$null = New-Item -ItemType Directory -Path $cameraFixturesRoot
foreach ($fixture in @('product-qr.png', 'product-code128.png')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "docs/camera-scan/$fixture") -Destination $cameraFixturesRoot
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'DEPLOY.he.md') -Destination (Join-Path $appRoot 'START-HERE.he.md')
Write-Output 'Application, source tests, procedures and workflow files copied. Private data and logs excluded.'
if ($IncludeConfig) {
    if (!(Test-Path -LiteralPath (Join-Path $projectRoot '.env'))) { throw 'Configured package requested but .env is missing' }
    Copy-Item -LiteralPath (Join-Path $projectRoot '.env') -Destination $appRoot
}

# npm is used only on the build machine. The target server needs no installer or npm.
Push-Location $appRoot
try {
    & npm.cmd ci --omit=dev --ignore-scripts --no-audit --no-fund --prefer-offline --fetch-retries=0 --fetch-timeout=20000
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
    & (Join-Path $runtimeDir 'node.exe') -e "require('priority-web-sdk'); require('./gold-rates'); require('./exchange-rates'); require('./digital-invoice'); require('./invoice-mail'); require('./n8n-mail'); if(!require('fs').existsSync('public/fonts/NotoSansHebrew-Regular.ttf')) throw Error('Hebrew signature font missing'); console.log('Portable modules OK')"
    if ($LASTEXITCODE -ne 0) { throw 'Portable runtime verification failed' }
} finally { Pop-Location }

Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'PORTABLE-README.txt') -Destination (Join-Path $appRoot 'START-HERE.txt')
$revision = (& git -C $projectRoot rev-parse --short HEAD)
@{ builtAt = [DateTime]::UtcNow.ToString('o'); node = $NodeVersion; platform = 'win-x64'; sourceRevision = $revision; includesLocalConfig = [bool]$IncludeConfig; sourceIncludesWorkingTree = $true; includesServerData = $false; nodeExecutableSha256 = $runtimeHash; nodeSigner = 'OpenJS Foundation' } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $appRoot 'build-info.json') -Encoding UTF8
Write-Output 'Creating checksums for the complete package...'
$manifest = Get-ChildItem -LiteralPath $appRoot -File -Recurse | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($appRoot.Length + 1).Replace('\', '/')
    $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $relative"
}
$manifest | Set-Content -LiteralPath (Join-Path $appRoot 'PACKAGE-SHA256.txt') -Encoding UTF8
$zipPath = Join-Path $outputRoot "zaban-invoice-portable-win-x64-$buildId.zip"
# ZipFile includes .env and all other files, including hidden files.
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($buildRoot + '/zaban-invoice', $zipPath, [IO.Compression.CompressionLevel]::Optimal, $false)
Write-Output "PORTABLE_FOLDER=$appRoot"
Write-Output "PORTABLE_ZIP=$zipPath"
