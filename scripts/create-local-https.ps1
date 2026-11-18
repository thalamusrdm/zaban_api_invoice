param([string]$Address = '10.0.0.2')
$ErrorActionPreference = 'Stop'
$targetDir = Join-Path $PSScriptRoot '../.local-https'
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
$caKey = [System.Security.Cryptography.RSA]::Create(2048)
$leafKey = [System.Security.Cryptography.RSA]::Create(2048)
$hash = [System.Security.Cryptography.HashAlgorithmName]::SHA256
$padding = [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
$now = [DateTimeOffset]::UtcNow.AddMinutes(-5)
try {
  $caRequest = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=Zaban Local Camera Test', $caKey, $hash, $padding)
  $caRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true,$true,0,$true))
  $caRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign,$true))
  $ca = $caRequest.CreateSelfSigned($now,$now.AddDays(7))
  $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new("CN=$Address",$leafKey,$hash,$padding)
  $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false,$false,0,$true))
  $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment,$true))
  $oids = [System.Security.Cryptography.OidCollection]::new()
  $oids.Add([System.Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1')) | Out-Null
  $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($oids,$false))
  $san = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
  $san.AddIpAddress([System.Net.IPAddress]::Parse($Address))
  $request.CertificateExtensions.Add($san.Build())
  $serial = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(16)
  $leafPublic = $request.Create($ca,$now,$now.AddDays(6),$serial)
  $leaf = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::CopyWithPrivateKey($leafPublic,$leafKey)
  [System.IO.File]::WriteAllBytes((Join-Path $targetDir 'server.pfx'),$leaf.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx,''))
  [System.IO.File]::WriteAllBytes((Join-Path $targetDir 'zaban-camera-test.cer'),$ca.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert))
  Write-Host "Created local certificate for $Address; valid for 6 days. CA private key is not saved."
} finally {
  if ($leaf) { $leaf.Dispose() }; if ($leafPublic) { $leafPublic.Dispose() }; if ($ca) { $ca.Dispose() }
  $leafKey.Dispose();$caKey.Dispose()
}
