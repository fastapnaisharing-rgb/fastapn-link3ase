# FastAPN SharePoint Handler (fastapn-sp://)
# รับคำสั่งจาก Link3ase หลังผู้ใช้กด Confirm -> หาไฟล์ที่เพิ่งดาวน์โหลดในโฟลเดอร์ Downloads
# -> ย้ายไปโฟลเดอร์ SharePoint (ซิงก์ผ่าน OneDrive):  <ปลายทาง>\<รหัส BU>\<YYYY.MM>\<ชื่อไฟล์>
# ไม่ใช้ Token Login / ไม่เรียก Backend เลย  |  ติดตั้งที่ %LOCALAPPDATA%\FastAPN\fastapn-sp.ps1 (ไม่ต้อง Admin)
# URI: fastapn-sp://send?name=<ชื่อไฟล์>&bu=<รหัสBU>&period=<YYYY.MM>
param([string]$Uri)
$base = Join-Path $env:LOCALAPPDATA 'FastAPN'
$log  = Join-Path $base 'sp-handler.log'
function Log($m) { try { if (-not (Test-Path $base)) { New-Item -ItemType Directory -Path $base -Force | Out-Null }; "$(Get-Date -Format s) $m" | Out-File -FilePath $log -Append -Encoding utf8 } catch {} }
function Notify($title, $msg) {
  try {
    Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing
    $n = New-Object System.Windows.Forms.NotifyIcon
    $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true
    $n.BalloonTipTitle = $title; $n.BalloonTipText = $msg; $n.BalloonTipIcon = 'Info'
    $n.ShowBalloonTip(8000); Start-Sleep -Seconds 7; $n.Dispose()
  } catch {}
}
function Fail($msg) {
  Log "ERROR: $msg"
  try { Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show($msg, 'FastAPN SharePoint Handler', 'OK', 'Error') | Out-Null } catch {}
  exit 1
}
function Get-DownloadsDir($cfg) {
  if ($cfg.downloadsDir -and (Test-Path -LiteralPath $cfg.downloadsDir -PathType Container)) { return $cfg.downloadsDir }
  try {
    $v = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders' -ErrorAction Stop).'{374DE290-123F-4565-9164-39C4925E467B}'
    if ($v) { $v = [Environment]::ExpandEnvironmentVariables($v); if (Test-Path -LiteralPath $v -PathType Container) { return $v } }
  } catch {}
  return (Join-Path $env:USERPROFILE 'Downloads')
}
try {
  # ── parse URI (Browser อาจเติม "/" ท้าย URI -> ตัดทิ้ง) ──
  $raw = ($Uri -replace '^fastapn-sp://', '') -replace '/$', ''
  $raw = $raw -replace '^send\??', ''
  $p = @{}
  foreach ($x in $raw -split '&') { $kv = $x -split '=', 2; if ($kv.Count -eq 2) { $p[$kv[0]] = [System.Uri]::UnescapeDataString($kv[1]) } }
  $fname = [System.IO.Path]::GetFileName([string]$p['name']); $bu = [string]$p['bu']; $period = [string]$p['period']
  if (-not $fname -or -not $bu -or -not $period) { Fail 'คำสั่งไม่ครบ (ต้องมี name / bu / period)' }
  # รหัส BU ต้องเป็นรหัสแบบตัวเลข/ตัวอักษร (เช่น 0568, 055Z) และงวดต้องเป็น YYYY.MM -> กัน Path แปลกๆ
  if ($bu -notmatch '^[0-9][0-9A-Za-z]{2,7}$') { Fail "รหัส BU ไม่ถูกต้อง: '$bu'" }
  if ($period -notmatch '^\d{4}\.(0[1-9]|1[0-2])$') { Fail "งวดไม่ถูกต้อง: '$period' (ต้องเป็น YYYY.MM)" }
  if ($fname -match '[\\/:*?"<>|]') { Fail 'ชื่อไฟล์มีอักขระที่ใช้ไม่ได้' }

  # ── config ──
  $cfgPath = Join-Path $base 'sp-config.json'
  if (-not (Test-Path -LiteralPath $cfgPath)) { Fail "ไม่พบไฟล์ตั้งค่า $cfgPath กรุณารัน setup-fastapn-sp.bat ใหม่" }
  $cfg = Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $root = $null
  if ($cfg.destRoot -and (Test-Path -LiteralPath $cfg.destRoot -PathType Container)) { $root = $cfg.destRoot }
  if (-not $root) { Fail "ไม่พบโฟลเดอร์ปลายทาง '$($cfg.destRoot)' บนเครื่องนี้`nตรวจว่าโฟลเดอร์ SharePoint ซิงก์ลงเครื่องแล้ว หรือรัน setup-fastapn-sp.bat เพื่อเลือกใหม่" }

  # ── หาไฟล์ที่เพิ่งดาวน์โหลด (รอได้ถึง 45 วินาที) ──
  $dlDir = Get-DownloadsDir $cfg
  $stem = [System.IO.Path]::GetFileNameWithoutExtension($fname); $ext = [System.IO.Path]::GetExtension($fname)
  $since = (Get-Date).AddMinutes(-3)
  $src = $null; $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline -and -not $src) {
    $cand = Get-ChildItem -LiteralPath $dlDir -File -ErrorAction SilentlyContinue |
      Where-Object { $_.LastWriteTime -ge $since -and $_.Extension -ieq $ext -and ($_.Name -ieq $fname -or $_.Name -match ('^' + [regex]::Escape($stem) + ' \(\d+\)' + [regex]::Escape($ext) + '$')) } |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($cand) {
      # ไฟล์ต้องโหลดเสร็จ: ขนาดนิ่ง 2 รอบ และเปิดอ่านได้
      $s1 = $cand.Length; Start-Sleep -Milliseconds 1200; $cand.Refresh()
      if ($cand.Length -eq $s1 -and $s1 -gt 0) {
        try { $fs = [System.IO.File]::Open($cand.FullName, 'Open', 'Read', 'ReadWrite'); $fs.Close(); $src = $cand } catch {}
      }
    }
    if (-not $src) { Start-Sleep -Milliseconds 800 }
  }
  if (-not $src) { Fail "ไม่พบไฟล์ '$fname' ในโฟลเดอร์ Downloads ($dlDir)`nตรวจว่า Browser ดาวน์โหลดโดยไม่ถามที่เก็บ (ปิด 'Ask where to save each file')`nหรือตั้ง downloadsDir ใน $cfgPath" }

  # ── โฟลเดอร์ปลายทาง: <ปลายทาง>\<รหัส BU>\<YYYY.MM> (ใช้ของเดิมถ้ามี ไม่มีค่อยสร้าง) ──
  $buDir = Join-Path $root $bu
  $monthDir = Join-Path $buDir $period
  if (-not (Test-Path -LiteralPath $monthDir)) { New-Item -ItemType Directory -Path $monthDir -Force | Out-Null }
  $final = Join-Path $monthDir $fname
  Move-Item -LiteralPath $src.FullName -Destination $final -Force   # ชื่อซ้ำ = ทับ (SharePoint เก็บ Version History ให้)

  Log "OK $final"
  Notify 'FastAPN: ส่งไป SharePoint' ("$bu \ $period \ $fname`nรอ OneDrive ซิงก์ขึ้น SharePoint")
} catch {
  Fail ("เกิดข้อผิดพลาด: " + $_.Exception.Message)
}
