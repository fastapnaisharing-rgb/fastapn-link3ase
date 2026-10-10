# FastAPN Backend - วางไฟล์ขึ้น Production + Restart  (v2: ตรวจ Syntax ก่อนวาง) (รันบน Server ด้วย PowerShell แบบ Run as Administrator)
# วิธีใช้:   .\deploy-backend.ps1                 (วางทุกไฟล์ในโฟลเดอร์ src\routes ที่อยู่ข้างสคริปต์นี้)
#            .\deploy-backend.ps1 -Only fileStorage.js,spHandlerAssets.js
#            .\deploy-backend.ps1 -WhatIf        (ดูว่าจะวางอะไรบ้าง ยังไม่ทำจริง)
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string[]]$Only,
  [string]$Source = (Join-Path $PSScriptRoot 'src\routes'),
  [string]$Dest = 'C:\apps\fastapn-backend\src\routes',
  [string]$Service = 'fastapn-backend'
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Source)) { throw "ไม่พบโฟลเดอร์ต้นทาง: $Source" }
if (-not (Test-Path -LiteralPath $Dest))   { throw "ไม่พบโฟลเดอร์ปลายทาง: $Dest" }

$files = Get-ChildItem -LiteralPath $Source -Filter *.js -File
if ($Only) { $files = $files | Where-Object { $Only -contains $_.Name } }
if (-not $files) { throw 'ไม่มีไฟล์ให้วาง' }

# ตรวจ Syntax ทุกไฟล์ก่อนวาง (ถ้ามี Error หยุดทันที ไม่แตะ Production) -- คัดลอกเป็น .mjs ชั่วคราวเพราะโปรเจกต์ใช้ import/export
if (Get-Command node -ErrorAction SilentlyContinue) {
  foreach ($f in $files) {
    $tmp = Join-Path $env:TEMP ('chk_' + [guid]::NewGuid().ToString('N') + '.mjs')
    Copy-Item -LiteralPath $f.FullName -Destination $tmp -Force
    & node --check $tmp 2>&1 | Out-Host
    $rc = $LASTEXITCODE
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    if ($rc -ne 0) { throw "Syntax Error ในไฟล์ $($f.Name) — ยกเลิกการวาง (ยังไม่ได้แก้ไขอะไรใน Production)" }
  }
  Write-Host "ตรวจ Syntax ผ่านทุกไฟล์ ($($files.Count) ไฟล์)" -ForegroundColor Green
} else { Write-Host 'ไม่พบ node ในเครื่องนี้ ข้ามการตรวจ Syntax' -ForegroundColor Yellow }

$bak = Join-Path $Dest ('_bak_' + (Get-Date -Format 'yyyyMMdd_HHmmss'))
$changed = 0
foreach ($f in $files) {
  $d = Join-Path $Dest $f.Name
  # ข้ามไฟล์ที่เหมือนเดิมเป๊ะ (ไม่ต้องวางซ้ำ)
  if ((Test-Path -LiteralPath $d) -and ((Get-FileHash $d).Hash -eq (Get-FileHash $f.FullName).Hash)) { Write-Host "ข้าม (เหมือนเดิม)  $($f.Name)" -ForegroundColor DarkGray; continue }
  if ($PSCmdlet.ShouldProcess($f.Name, 'วางทับ Production')) {
    if (Test-Path -LiteralPath $d) { New-Item -ItemType Directory -Path $bak -Force | Out-Null; Copy-Item -LiteralPath $d -Destination $bak -Force }
    Copy-Item -LiteralPath $f.FullName -Destination $d -Force
    Write-Host "วางแล้ว           $($f.Name)" -ForegroundColor Green
    $changed++
  }
}
if ($changed -eq 0) { Write-Host 'ไม่มีไฟล์ที่เปลี่ยน ไม่ต้อง Restart' -ForegroundColor Yellow; return }
if ($PSCmdlet.ShouldProcess($Service, 'Restart-Service')) {
  Restart-Service $Service
  Start-Sleep -Seconds 3
  $st = (Get-Service $Service).Status
  Write-Host "Service $Service : $st" -ForegroundColor $(if ($st -eq 'Running') { 'Green' } else { 'Red' })
  if (Test-Path -LiteralPath $bak) { Write-Host "ไฟล์เดิมสำรองไว้ที่ $bak (ถ้ามีปัญหา Copy กลับแล้ว Restart ได้)" }
}
