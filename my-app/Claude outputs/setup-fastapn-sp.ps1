# FastAPN SharePoint Handler - Setup (ไม่ต้อง Admin)
# วิธีใช้: ดับเบิลคลิก setup-fastapn-sp.bat
$ErrorActionPreference = 'Stop'
$srcDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$base = Join-Path $env:LOCALAPPDATA 'FastAPN'
Write-Host '=== FastAPN SharePoint Handler Setup ===' -ForegroundColor Cyan
try {
  if (-not (Test-Path $base)) { New-Item -ItemType Directory -Path $base -Force | Out-Null }
  $src = Join-Path $srcDir 'fastapn-sp.ps1'
  if (-not (Test-Path $src)) { throw "ไม่พบ fastapn-sp.ps1 ที่ $src" }
  Copy-Item $src -Destination (Join-Path $base 'fastapn-sp.ps1') -Force
  Write-Host "[1/3] คัดลอก fastapn-sp.ps1 ไปที่ $base" -ForegroundColor Green

  $cfgPath = Join-Path $base 'sp-config.json'
  $curRoot = ''
  if (Test-Path $cfgPath) { try { $c = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json; $curRoot = $c.destRoot } catch {} }

  # เลือกโฟลเดอร์ปลายทาง (Z_Report Reconcile ที่ซิงก์ลงเครื่องแล้ว) ด้วยหน้าต่างเลือกโฟลเดอร์
  Add-Type -AssemblyName System.Windows.Forms
  $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
  $dlg.Description = 'เลือกโฟลเดอร์ Z_Report Reconcile ที่ซิงก์ลงเครื่องนี้แล้ว (ภายใต้ OneDrive - Central Group\VAT Controller\My System) ไฟล์จะถูกวางที่ <รหัส BU>\<YYYY.MM>'
  $dlg.ShowNewFolderButton = $false
  $od = $env:OneDriveCommercial; if (-not $od) { $od = $env:OneDrive }
  if ($curRoot -and (Test-Path -LiteralPath $curRoot)) { $dlg.SelectedPath = $curRoot } elseif ($od) { $dlg.SelectedPath = $od }
  $destRoot = ''
  Write-Host 'กำลังเปิดหน้าต่างเลือกโฟลเดอร์... (ถ้าไม่เห็น ให้ดูที่ Taskbar)' -ForegroundColor Yellow
  if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $destRoot = $dlg.SelectedPath }
  elseif ($curRoot) { $destRoot = $curRoot }
  if (-not $destRoot) { throw 'ต้องเลือกโฟลเดอร์ปลายทาง (เช่น ...\VAT Controller\My System\Z_Report Reconcile)' }
  $cfg = [ordered]@{ destRoot = $destRoot; downloadsDir = '' }
  ($cfg | ConvertTo-Json) | Out-File -FilePath $cfgPath -Encoding utf8
  Write-Host "[2/3] บันทึกค่าตั้งค่า $cfgPath" -ForegroundColor Green

  $key = 'HKCU:\Software\Classes\fastapn-sp'
  New-Item -Path $key -Force | Out-Null
  Set-ItemProperty -Path $key -Name '(default)' -Value 'FastAPN SharePoint Handler'
  New-ItemProperty -Path $key -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
  New-Item -Path "$key\shell\open\command" -Force | Out-Null
  $cmd = 'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $base 'fastapn-sp.ps1') + '" "%1"'
  Set-ItemProperty -Path "$key\shell\open\command" -Name '(default)' -Value $cmd
  Write-Host '[3/3] ลงทะเบียน fastapn-sp:// (HKCU) เรียบร้อย' -ForegroundColor Green
  Write-Host ''
  Write-Host '=== ติดตั้งสำเร็จ! กลับไปกด "ส่งไป SharePoint" ใน Link3ase ได้เลย ===' -ForegroundColor Cyan
} catch {
  Write-Host ''; Write-Host '=== เกิดข้อผิดพลาด ===' -ForegroundColor Red; Write-Host $_.Exception.Message -ForegroundColor Red
}
Write-Host ''
Read-Host 'กด Enter เพื่อปิดหน้าต่างนี้'
