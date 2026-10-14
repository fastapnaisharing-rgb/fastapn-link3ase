# FastAPN SharePoint Handler - Setup (ไม่ต้อง Admin)
# วิธีใช้: ดับเบิลคลิก setup-fastapn-sp.bat  (ใช้ได้ทั้งติดตั้งครั้งแรกและอัปเดต: รันซ้ำได้ ไม่ทับค่าตั้งค่าเดิม)
# IT ส่งอัตโนมัติ: powershell -ExecutionPolicy Bypass -File setup-fastapn-sp.ps1 -Silent  (ไม่ถามอะไร ไม่รอกด Enter)
# MARKER_SP_SETUP_UPDATE_V1
param([switch]$Silent)
$ErrorActionPreference = 'Stop'
$srcDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$base = 'D:\apps'   # เหมือน Outlook Handler
Write-Host '=== FastAPN SharePoint Handler Setup ===' -ForegroundColor Cyan
try {
  $oldVer = ''
  try { $oldTxt = Get-Content -LiteralPath (Join-Path $base 'fastapn-sp.ps1') -Raw -Encoding UTF8 -ErrorAction Stop; if ($oldTxt -match '\$HandlerVersion\s*=\s*(\d+)') { $oldVer = $Matches[1] } } catch {}
  if (-not (Test-Path $base)) { New-Item -ItemType Directory -Path $base -Force | Out-Null }
  $src = Join-Path $srcDir 'fastapn-sp.ps1'
  if (-not (Test-Path $src)) { throw "ไม่พบ fastapn-sp.ps1 ที่ $src" }
  Copy-Item $src -Destination (Join-Path $base 'fastapn-sp.ps1') -Force
  $newVer = ''
  try { if ((Get-Content -LiteralPath $src -Raw -Encoding UTF8) -match '\$HandlerVersion\s*=\s*(\d+)') { $newVer = $Matches[1] } } catch {}
  if ($oldVer) { Write-Host "[1/3] อัปเดต fastapn-sp.ps1 v$oldVer -> v$newVer ที่ $base" -ForegroundColor Green } else { Write-Host "[1/3] ติดตั้ง fastapn-sp.ps1 v$newVer ที่ $base" -ForegroundColor Green }

  $cfgPath = Join-Path $base 'fastapn-sp-config.json'
  # อ่านค่าเดิม (รองรับ config เก่าที่มีแค่ destRoot = recon)
  $cur = @{}
  $dl = ''
  if (Test-Path $cfgPath) {
    try {
      $c = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($c.downloadsDir) { $dl = [string]$c.downloadsDir }
      if ($c.destRoot) { $cur['recon'] = [string]$c.destRoot }
      if ($c.dests) { foreach ($pr in $c.dests.PSObject.Properties) { $cur[$pr.Name] = [string]$pr.Value } }
    } catch {}
  }
  Add-Type -AssemblyName System.Windows.Forms
  # ── หาโฟลเดอร์ OneDrive ของบริษัทบนเครื่องนี้ (ชื่อต่างกันตามเครื่อง เช่น "OneDrive - Central Group") ──
  $odRoots = @()
  foreach ($e in @($env:OneDriveCommercial, $env:OneDrive)) { if ($e -and (Test-Path -LiteralPath $e) -and ($odRoots -notcontains $e)) { $odRoots += $e } }
  try { foreach ($d in (Get-ChildItem -LiteralPath $env:USERPROFILE -Directory -Filter 'OneDrive*' -ErrorAction SilentlyContinue)) { if ($odRoots -notcontains $d.FullName) { $odRoots += $d.FullName } } } catch {}
  $rel = 'VAT Controller\My System'
  # ปลายทางที่รองรับ: ชื่อโฟลเดอร์ถูกล็อคตายตัว (เลือกผิดชื่อไม่ได้)  recon = จำเป็น, upload = ไม่บังคับ
  $targets = @(
    @{ key='recon';  label='Z_Report Reconcile'; required=$false },   # v8: ไม่บังคับต่อปลายทางแล้ว (ผู้ใช้ฝั่ง AP อาจมีแต่โฟลเดอร์ AP) -- ต้องพบอย่างน้อย 1 ปลายทาง
    @{ key='ap';     label='Z_Report Reconcile - Account Payable'; required=$false },
    @{ key='upload'; label='Z_AllSystemUpload';  required=$false }
  )
  $dests = [ordered]@{}
  foreach ($tg in $targets) {
    $k = $tg.key; $label = $tg.label; $picked = ''
    # 1) ค่าเดิมที่ยังใช้ได้ (ชื่อโฟลเดอร์ต้องตรง)
    if ($cur.ContainsKey($k) -and $cur[$k] -and (Test-Path -LiteralPath $cur[$k] -PathType Container) -and ((Split-Path -Leaf $cur[$k]) -eq $label)) { $picked = $cur[$k] }
    # 2) หาอัตโนมัติจาก OneDrive: <OneDrive>\VAT Controller\My System\<label>
    if (-not $picked) {
      foreach ($r in $odRoots) { $cand = Join-Path (Join-Path $r $rel) $label; if (Test-Path -LiteralPath $cand -PathType Container) { $picked = $cand; Write-Host ("พบ $label อัตโนมัติ: $cand") -ForegroundColor Green; break } }
    }
    # 2.1) v8: โฟลเดอร์ AP ไม่ได้อยู่ใต้ VAT Controller\My System แน่นอน -> ค้นใต้ OneDrive ลึกไม่เกิน 4 ชั้น
    if (-not $picked -and $k -eq 'ap') {
      foreach ($r in $odRoots) { try { $f = Get-ChildItem -LiteralPath $r -Directory -Recurse -Depth 4 -Filter $label -ErrorAction SilentlyContinue | Select-Object -First 1; if ($f) { $picked = $f.FullName; Write-Host ("พบ $label อัตโนมัติ: $picked") -ForegroundColor Green; break } } catch {} }
    }
    # 3) ไม่เจอ -> ให้เลือกเอง (ชื่อโฟลเดอร์ต้องตรง ไม่ตรงให้เลือกใหม่) เฉพาะปลายทางที่จำเป็น
    if (-not $picked -and $tg.required -and $Silent) { throw "ไม่พบโฟลเดอร์ $label ในเครื่องนี้ (โหมด -Silent ไม่เปิดหน้าต่างเลือก) ให้ซิงก์จาก SharePoint ก่อนแล้วรันใหม่" }
    if (-not $picked -and $tg.required) {
      while (-not $picked) {
        $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
        $dlg.Description = "ไม่พบโฟลเดอร์ $label อัตโนมัติ กรุณาเลือกโฟลเดอร์ชื่อ $label ที่ซิงก์ลงเครื่องแล้ว (OneDrive - Central Group\VAT Controller\My System)"
        $dlg.ShowNewFolderButton = $false
        if ($odRoots.Count -gt 0) { $dlg.SelectedPath = $odRoots[0] }
        Write-Host "กำลังเปิดหน้าต่างเลือกโฟลเดอร์ $label... (ถ้าไม่เห็น ให้ดูที่ Taskbar)" -ForegroundColor Yellow
        if ($dlg.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { throw "ต้องเลือกโฟลเดอร์ $label" }
        if ((Split-Path -Leaf $dlg.SelectedPath) -eq $label) { $picked = $dlg.SelectedPath }
        else { [System.Windows.Forms.MessageBox]::Show("ต้องเลือกโฟลเดอร์ชื่อ '$label' เท่านั้น (ที่เลือก: '" + (Split-Path -Leaf $dlg.SelectedPath) + "')", 'FastAPN SharePoint Handler', 'OK', 'Warning') | Out-Null }
      }
    }
    if ($picked) { $dests[$k] = $picked } elseif (-not $tg.required) { Write-Host "ข้าม $label (ไม่พบโฟลเดอร์ที่ซิงก์ในเครื่องนี้ ถ้าจะใช้ภายหลังให้ซิงก์แล้วรัน setup ใหม่)" -ForegroundColor DarkYellow }
  }
  # v8: ต้องมีปลายทางอย่างน้อย 1 ที่ -- ถ้าไม่เจอเลย ให้เลือกเอง (ชื่อโฟลเดอร์ต้องเป็น Z_Report Reconcile หรือ Z_Report Reconcile - Account Payable)
  if ($dests.Count -eq 0) {
    if ($Silent) { throw 'ไม่พบโฟลเดอร์ปลายทาง SharePoint (Z_Report Reconcile / Z_Report Reconcile - Account Payable) ในเครื่องนี้ (โหมด -Silent ไม่เปิดหน้าต่างเลือก)' }
    while ($dests.Count -eq 0) {
      $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
      $dlg.Description = 'ไม่พบโฟลเดอร์ SharePoint อัตโนมัติ กรุณาเลือกโฟลเดอร์ชื่อ Z_Report Reconcile (VAT) หรือ Z_Report Reconcile - Account Payable (AP) ที่ซิงก์ลงเครื่อง'
      $dlg.ShowNewFolderButton = $false
      if ($odRoots.Count -gt 0) { $dlg.SelectedPath = $odRoots[0] }
      Write-Host 'กำลังเปิดหน้าต่างเลือกโฟลเดอร์... (ถ้าไม่เห็น ให้ดูที่ Taskbar)' -ForegroundColor Yellow
      if ($dlg.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { throw 'ต้องเลือกโฟลเดอร์ปลายทางอย่างน้อย 1 ที่' }
      $leaf = Split-Path -Leaf $dlg.SelectedPath
      $hit = $targets | Where-Object { $_.label -eq $leaf } | Select-Object -First 1
      if ($hit) { $dests[$hit.key] = $dlg.SelectedPath }
      else { [System.Windows.Forms.MessageBox]::Show("ต้องเลือกโฟลเดอร์ชื่อ 'Z_Report Reconcile' หรือ 'Z_Report Reconcile - Account Payable' เท่านั้น (ที่เลือก: '$leaf')", 'FastAPN SharePoint Handler', 'OK', 'Warning') | Out-Null }
    }
  }
  $cfg = [ordered]@{ downloadsDir = $dl; dests = $dests }
  ($cfg | ConvertTo-Json -Depth 4) | Out-File -FilePath $cfgPath -Encoding utf8
  Write-Host "[2/3] บันทึกค่าตั้งค่า $cfgPath" -ForegroundColor Green
  foreach ($k in $dests.Keys) { Write-Host ("      $k = " + $dests[$k]) }

  $key = 'HKCU:\Software\Classes\fastapn-sp'
  New-Item -Path $key -Force | Out-Null
  Set-ItemProperty -Path $key -Name '(default)' -Value 'FastAPN SharePoint Handler'
  New-ItemProperty -Path $key -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
  New-Item -Path "$key\shell\open\command" -Force | Out-Null
  # v7: เปิดผ่าน wscript //B + fastapn-run-hidden.vbs เพื่อไม่ให้หน้าต่าง cmd/PowerShell เด้งเลย
  $vbsSrc = Join-Path $srcDir 'fastapn-run-hidden.vbs'
  if (-not (Test-Path $vbsSrc)) { throw "ไม่พบ fastapn-run-hidden.vbs ที่ $vbsSrc" }
  $vbsDst = Join-Path $base 'fastapn-run-hidden.vbs'
  Copy-Item $vbsSrc -Destination $vbsDst -Force
  $cmd = 'wscript.exe //B //Nologo "' + $vbsDst + '" "' + (Join-Path $base 'fastapn-sp.ps1') + '" "%1"'
  Set-ItemProperty -Path "$key\shell\open\command" -Name '(default)' -Value $cmd
  Write-Host '[3/3] ลงทะเบียน fastapn-sp:// (HKCU) เรียบร้อย' -ForegroundColor Green
  Write-Host ''
  Write-Host '=== สำเร็จ! (v$newVer) กลับไป Link3ase แล้วใช้งานได้เลย ===' -ForegroundColor Cyan
} catch {
  Write-Host ''; Write-Host '=== เกิดข้อผิดพลาด ===' -ForegroundColor Red; Write-Host $_.Exception.Message -ForegroundColor Red
}
Write-Host ''
if (-not $Silent) { Read-Host 'กด Enter เพื่อปิดหน้าต่างนี้' }
