$cert = Get-ChildItem -Path Cert:\CurrentUser\My | Where-Object { $_.DnsNameList -contains "localhost" } | Select-Object -First 1
if ($cert) {
    $tempPfx = "$env:TEMP\localhost.pfx"
    $password = ConvertTo-SecureString -String "password" -Force -AsPlainText
    Export-PfxCertificate -Cert $cert -FilePath $tempPfx -Password $password
    
    $certBytes = [System.IO.File]::ReadAllBytes($tempPfx)
    $base64 = [Convert]::ToBase64String($certBytes)
    
    $pemContent = "-----BEGIN CERTIFICATE-----`n"
    $pemContent += ($base64 -replace '.{64}', '$0`n')
    $pemContent += "-----END CERTIFICATE-----`n"
    
    [System.IO.File]::WriteAllText("C:\Users\princeton\Projects\chat\server\cert.pem", $pemContent)
    
    $keyBytes = $cert.PrivateKey.ExportPkcs8PrivateKey()
    $keyBase64 = [Convert]::ToBase64String($keyBytes)
    
    $keyContent = "-----BEGIN PRIVATE KEY-----`n"
    $keyContent += ($keyBase64 -replace '.{64}', '$0`n')
    $keyContent += "-----END PRIVATE KEY-----`n"
    
    [System.IO.File]::WriteAllText("C:\Users\princeton\Projects\chat\server\cert.key", $keyContent)
    
    Write-Host "Certificate exported successfully"
} else {
    Write-Host "No certificate found"
}
