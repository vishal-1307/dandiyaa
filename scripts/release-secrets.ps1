# Windows-only, user-local DPAPI storage. No secret values are written to source
# or printed. Run Admin/Copy actions yourself in an interactive local terminal.
[CmdletBinding()]
param(
  [ValidateSet('Initialize','Admin','CopyAdmin','CopySession','CopyWebhook')]
  [string]$Action = 'Admin',
  [string]$VaultPath
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This helper requires Windows user-bound DPAPI encryption.' }
$taskVaultDirectory = Join-Path $env:LOCALAPPDATA 'JMU'
if ($Action -eq 'Initialize') {
  New-Item -ItemType Directory -Path $taskVaultDirectory -Force | Out-Null
  $taskVaultAcl = New-Object System.Security.AccessControl.DirectorySecurity
  $taskVaultAcl.SetAccessRuleProtection($true,$false)
  foreach ($taskSid in @([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544')) {
    $taskRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
      (New-Object System.Security.Principal.SecurityIdentifier($taskSid)), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $taskVaultAcl.AddAccessRule($taskRule)
  }
  Set-Acl -LiteralPath $taskVaultDirectory -AclObject $taskVaultAcl
  $taskSuffix = [Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(8)).ToLowerInvariant()
  $VaultPath = Join-Path $taskVaultDirectory ("release-secrets-$(Get-Date -Format yyyyMMdd-HHmmss)-$taskSuffix.clixml")
  $taskData = @{}
  foreach ($taskName in @('ADMIN_SESSION_SECRET','RAZORPAY_WEBHOOK_SECRET')) {
    $taskValue = [Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
    $taskData[$taskName] = ConvertTo-SecureString $taskValue -AsPlainText -Force
    $taskValue = $null
  }
  $taskData | Export-Clixml -LiteralPath $VaultPath
  Write-Host 'New session and webhook secrets generated and DPAPI-encrypted outside the repository.'
  Write-Host "Private vault: $VaultPath"
  exit 0
}
if (-not $VaultPath) {
  $taskLatest = Get-ChildItem -LiteralPath $taskVaultDirectory -Filter 'release-secrets-*.clixml' | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  if (-not $taskLatest) { throw 'Run Initialize first.' }
  $VaultPath = $taskLatest.FullName
}
$taskData = Import-Clixml -LiteralPath $VaultPath
if ($Action -eq 'Admin') {
  $taskPassword = Read-Host 'Choose a NEW unique organizer password (16-256 characters)' -AsSecureString
  $taskConfirmation = Read-Host 'Confirm the new password' -AsSecureString
  $taskPlain = [System.Net.NetworkCredential]::new('', $taskPassword).Password
  $taskConfirmed = [System.Net.NetworkCredential]::new('', $taskConfirmation).Password
  try {
    if ($taskPlain -cne $taskConfirmed) { throw 'Passwords did not match. Nothing changed.' }
    if ($taskPlain.Length -lt 16 -or $taskPlain.Length -gt 256 -or $taskPlain -match '[\r\n\x00]') { throw 'Use 16-256 characters without line breaks. Nothing changed.' }
    $taskHashUtility = Join-Path $PSScriptRoot 'hash-admin-password.js'
    $taskHash = $taskPlain | & node $taskHashUtility
    if ($LASTEXITCODE -ne 0 -or $taskHash -notmatch '^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$') { throw 'Hash generation failed. Nothing changed.' }
    $taskData['ADMIN_PASSWORD_HASH'] = ConvertTo-SecureString $taskHash -AsPlainText -Force
    $taskData | Export-Clixml -LiteralPath $VaultPath
    Set-Clipboard -Value $taskHash
    Write-Host 'Compatible hash copied privately. Paste into Vercel ADMIN_PASSWORD_HASH, then clear the clipboard.'
  } finally {
    $taskPlain = $null; $taskConfirmed = $null; $taskHash = $null
    $taskPassword.Dispose(); $taskConfirmation.Dispose()
  }
} else {
  $taskKey = @{CopyAdmin='ADMIN_PASSWORD_HASH';CopySession='ADMIN_SESSION_SECRET';CopyWebhook='RAZORPAY_WEBHOOK_SECRET'}[$Action]
  if (-not $taskData.ContainsKey($taskKey)) { throw 'Generate the administrator hash with the Admin action first.' }
  $taskCopy = [System.Net.NetworkCredential]::new('', $taskData[$taskKey]).Password
  try { Set-Clipboard -Value $taskCopy } finally { $taskCopy = $null }
  Write-Host "$taskKey copied privately. Paste only into the intended provider setting, then clear the clipboard."
  if ($Action -eq 'CopyWebhook') { Write-Host 'Use this SAME value in the existing Razorpay webhook Secret field and Vercel RAZORPAY_WEBHOOK_SECRET. Do not add a duplicate webhook.' }
}
