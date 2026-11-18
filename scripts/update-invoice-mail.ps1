param([Parameter(Mandatory=$true)][string]$TargetPath)
$ErrorActionPreference = 'Stop'
$target = (Resolve-Path -LiteralPath $TargetPath).Path
$patchRoot = $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $patchRoot 'patch-manifest.json') -Raw | ConvertFrom-Json
$settings = Get-Content -LiteralPath (Join-Path $patchRoot 'invoice-mail-settings.json') -Raw | ConvertFrom-Json
$nodePath = Join-Path $target 'runtime\node.exe'
$envPath = Join-Path $target '.env'
if (!(Test-Path -LiteralPath $nodePath) -or !(Test-Path -LiteralPath $envPath)) { throw 'Target is not a configured invoice installation' }
foreach ($file in $manifest.files) {
    $source = Join-Path $patchRoot $file.name
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $file.newHash) { throw "Patch checksum mismatch: $($file.name)" }
    $destination = Join-Path $target $file.name
    if (Test-Path -LiteralPath $destination) {
        $currentHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
        if ($currentHash -ne $file.oldHash -and $currentHash -ne $file.newHash) { throw "Installation has other changes; nothing was stopped: $($file.name)" }
    } elseif ($file.oldHash) { throw "Missing installed file: $($file.name)" }
}
if ($settings.url -ne 'https://n8n.zaban.pro/webhook/invoice-original-email' -or $settings.from -ne 'sales@zaban-bechor.co.il' -or $settings.key -notmatch '^[a-f0-9]{64}$') { throw 'Invalid mail settings' }
$ready = Invoke-RestMethod -Uri $settings.url -Method Post -ContentType 'application/json' -Headers @{'X-Zaban-Invoice-Key'=$settings.key} -Body '{"action":"check"}' -TimeoutSec 30
if (!$ready.ready -or $ready.protocol -ne 'zaban-original-v1' -or $ready.from -ne $settings.from) { throw 'n8n is not ready; nothing was stopped' }
$envText = [IO.File]::ReadAllText($envPath)
$portMatch = [regex]::Match($envText,'(?m)^PORT=(\d+)\s*$')
$port = if ($portMatch.Success) { [int]$portMatch.Groups[1].Value } else { 18473 }
$listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
if ($listeners.Count -gt 1) { throw 'Multiple server processes; nothing was stopped' }
foreach ($processId in $listeners) {
    $process = Get-Process -Id $processId
    if ($process.Path -ne $nodePath) { throw 'Port belongs to another application; nothing was stopped' }
}
$backup = Join-Path $target ('mail-update-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$null = New-Item -ItemType Directory -Path $backup
Copy-Item -LiteralPath $envPath -Destination (Join-Path $backup '.env')
foreach ($file in $manifest.files) {
    $destination = Join-Path $target $file.name
    if (Test-Path -LiteralPath $destination) { Copy-Item -LiteralPath $destination -Destination (Join-Path $backup $file.name) }
}
function Start-InvoiceServer {
    Start-Process -FilePath $nodePath -ArgumentList @('server.js') -WorkingDirectory $target -WindowStyle Hidden
}
try {
    foreach ($processId in $listeners) { Stop-Process -Id $processId -ErrorAction Stop }
    foreach ($file in $manifest.files) { Copy-Item -LiteralPath (Join-Path $patchRoot $file.name) -Destination (Join-Path $target $file.name) -Force }
    $config = @{N8N_INVOICE_MAIL_URL=$settings.url;N8N_INVOICE_MAIL_FROM=$settings.from;N8N_INVOICE_MAIL_KEY=$settings.key}
    foreach ($name in $config.Keys) {
        $line = $name + '=' + $config[$name]
        if ([regex]::IsMatch($envText,'(?m)^'+$name+'=.*$')) { $envText = [regex]::Replace($envText,'(?m)^'+$name+'=.*$',$line) }
        else { $envText += "`r`n" + $line }
    }
    [IO.File]::WriteAllText($envPath,$envText,(New-Object Text.UTF8Encoding($false)))
    Start-InvoiceServer
    $status = $null
    for ($attempt=0;$attempt -lt 20;$attempt++) {
        Start-Sleep -Milliseconds 500
        try { $status = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/mail/status" -TimeoutSec 2; if ($status.configured -and $status.from -eq $settings.from) { break } } catch {}
    }
    if (!$status.configured -or $status.from -ne $settings.from) { throw 'Updated server did not become ready' }
    Write-Host 'SUCCESS: original download + Sales email through n8n are configured.'
    Write-Host "Backup: $backup"
    Write-Host 'No invoice was created or emailed by this update.'
} catch {
    $failure = $_
    $currentListeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
    foreach ($processId in $currentListeners) { if ((Get-Process -Id $processId).Path -eq $nodePath) { Stop-Process -Id $processId } }
    Copy-Item -LiteralPath (Join-Path $backup '.env') -Destination $envPath -Force
    foreach ($file in $manifest.files) {
        $saved = Join-Path $backup $file.name
        if (Test-Path -LiteralPath $saved) { Copy-Item -LiteralPath $saved -Destination (Join-Path $target $file.name) -Force }
    }
    Start-InvoiceServer
    throw $failure
}
