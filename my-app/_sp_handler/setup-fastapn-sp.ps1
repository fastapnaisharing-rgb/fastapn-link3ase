# FastAPN SharePoint Handler - Setup (ไม่ต้อง Admin)
# วิธีใช้: ดับเบิลคลิก setup-fastapn-sp.bat
$ErrorActionPreference = 'Stop'
$srcDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$base = 'D:\apps'   # เหมือน Outlook Handler
Write-Host '=== FastAPN SharePoint Handler Setup ===' -ForegroundColor Cyan
try {
  if (-not (Test-Path $base)) { New-Item -ItemType Directory -Path $base -Force | Out-Null }
  $src = Join-Path $srcDir 'fastapn-sp.ps1'
  if (-not (Test-Path $src)) { throw "ไม่พบ fastapn-sp.ps1 ที่ $src" }
  Copy-Item $src -Destination (Join-Path $base 'fastapn-sp.ps1') -Force
  Write-Host "[1/3] คัดลอก fastapn-sp.ps1 ไปที่ $base" -ForegroundColor Green

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
    @{ key='recon';  label='Z_Report Reconcile'; required=$true },
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
    # 3) ไม่เจอ -> ให้เลือกเอง (ชื่อโฟลเดอร์ต้องตรง ไม่ตรงให้เลือกใหม่) เฉพาะปลายทางที่จำเป็น
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
  $cfg = [ordered]@{ downloadsDir = $dl; dests = $dests }
  ($cfg | ConvertTo-Json -Depth 4) | Out-File -FilePath $cfgPath -Encoding utf8
  Write-Host "[2/3] บันทึกค่าตั้งค่า $cfgPath" -ForegroundColor Green
  foreach ($k in $dests.Keys) { Write-Host ("      $k = " + $dests[$k]) }

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
