# FastAPN SharePoint Handler (fastapn-sp://)
# รับคำสั่งจาก Link3ase หลังผู้ใช้กด Confirm -> หาไฟล์ที่เพิ่งดาวน์โหลดในโฟลเดอร์ Downloads
# -> ย้ายไปโฟลเดอร์ SharePoint (ซิงก์ผ่าน OneDrive):  <ปลายทาง>\<รหัส BU>\<YYYY.MM>\<ชื่อไฟล์>
# ไม่ใช้ Token Login / ไม่เรียก Backend เลย  |  ติดตั้งที่ D:\apps\fastapn-sp.ps1 (ไม่ต้อง Admin)
# URI: fastapn-sp://send?name=<ชื่อไฟล์>&bu=<รหัสBU>&period=<YYYY.MM>[&dest=recon|upload]  (ไม่ส่ง dest = recon)
# dest: recon = Z_Report Reconcile, upload = Z_AllSystemUpload, ap = Z_Report Reconcile - Account Payable (v8) (โครงสร้างโฟลเดอร์ <BU>\<YYYY.MM> เหมือนกัน)
# MARKER_SP_HANDLER_PUT_LIST_V1 -- v3: เพิ่ม put (โยนไฟล์ที่เว็บดาวน์โหลดไว้ใน Downloads ไปวางที่ <ปลายทาง>\<path> ตามชื่อโฟลเดอร์ ชื่อซ้ำ=ทับ) และ list (อ่านโครงสร้างโฟลเดอร์ที่ซิงก์ ส่งกลับ Backend เป็น Cache) | open/delete รับ path ได้ด้วย
# URI: fastapn-sp://put?name=<ไฟล์>&path=<โฟลเดอร์ย่อย เช่น 2026.09 หรือ 0560/2026.09>&dest=recon  |  fastapn-sp://list?dest=recon&api=..&token=..
# MARKER_SP_HANDLER_V6_FILEOPS -- v6: เพิ่ม mkdir (สร้างโฟลเดอร์) / rename (เปลี่ยนชื่อ) / move (ย้าย ครั้งละหลายรายการด้วย items=a|b) / delete แบบ items (ลบหลายรายการ ยืนยันครั้งเดียว โฟลเดอร์ลบได้เฉพาะที่ว่าง) / open ใช้เปิดโฟลเดอร์ใน Explorer ได้ | ทุกคำสั่งที่เปลี่ยนแปลงจะสแกน list ส่ง Backend ให้เองถ้ามี api+token
# URI: fastapn-sp://mkdir?name=<ชื่อ>&path=<โฟลเดอร์แม่>  |  rename?name=<ชื่อเดิม>&newname=<ชื่อใหม่>&path=<โฟลเดอร์แม่>  |  move?items=<a/b|c/d>&to=<โฟลเดอร์ปลายทาง>  |  delete?items=<a/b|c/d>
# MARKER_SP_HANDLER_V6 -- v6: คำสั่ง update ที่ไม่ต้องอัปเดต (เวอร์ชันเท่าเดิม) ยังรายงานเวอร์ชันกลับ Backend ด้วย (ใช้ยืนยันว่าติดตั้งแล้ว)
# MARKER_SP_HANDLER_V5 -- v5: Log ปิดบัง token | ข้อความยืนยันลบแบบ path แสดงพาธถูกต้อง | ไม่มีคำสั่งที่ส่งไฟล์ผ่าน Backend (ไฟล์ไม่ผ่าน Backend)
# MARKER_SP_HANDLER_DELETE_V1 -- เพิ่มคำสั่ง delete: fastapn-sp://delete?name=<ชื่อไฟล์>&bu=<รหัสBU>&period=<YYYY.MM>[&dest=recon|upload]  -> ลบไฟล์ในโฟลเดอร์ SharePoint ที่ซิงก์ไว้ (OneDrive ส่งต่อไปลบใน SharePoint / อยู่ในถังขยะกู้คืนได้) | มีกล่องยืนยันก่อนลบทุกครั้ง
# MARKER_SP_HANDLER_V7_HIDDEN -- v7: ไม่ให้หน้าต่าง cmd/PowerShell เด้ง: ติดตั้ง fastapn-run-hidden.vbs และปรับคำสั่ง Registry (fastapn-sp:// และ fastapn:// ถ้ามี) ให้เปิดผ่าน wscript //B อัตโนมัติ + อัปเดตตัวเองแบบไม่เปิดหน้าต่าง
# MARKER_SP_HANDLER_V10_AUTO_DEST -- v10: หาโฟลเดอร์ปลายทาง (Z_Report Reconcile / Z_AllSystemUpload / ... ) ของเครื่องนั้นเองอัตโนมัติทุกครั้งที่ส่ง ถ้าค่าใน config ไม่มี/พาธเปลี่ยน/ผิดชื่อ (ค้นจากชื่อโฟลเดอร์ที่ล็อคตายตัวใต้ OneDrive ทุกบัญชี/ทุกไดรฟ์) แล้วจำพาธใหม่ลง config ให้ -- ไม่ต้องรัน setup ใหม่
# MARKER_SP_HANDLER_V9_MULTI_SEND -- v9: send รับหลายไฟล์ใน URI เดียว: fastapn-sp://send?name=<ไฟล์แรก>&names=<a.xlsx|b.xlsx|...>&bu=..&period=..&dest=.. (ยิงครั้งเดียวต่อชุด ไม่โดนเบราว์เซอร์ทิ้งคำสั่ง) | ไม่ส่ง names = ทำงานเหมือน v8 ทุกอย่าง
param([string]$Uri)
$HandlerVersion = 10   # MARKER_SP_HANDLER_VERSION_V1 -- เลขเวอร์ชัน (ต้องตรงกับ SP_HANDLER_VERSION ใน spHandlerAssets.js) ใช้กับคำสั่ง update
$base = Split-Path -Parent $MyInvocation.MyCommand.Path   # = D:\apps
$log  = Join-Path $base 'fastapn-sp.log'
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
function Get-OneDriveRoots {
  $r = @()
  foreach ($e in @($env:OneDriveCommercial, $env:OneDrive, $env:OneDriveConsumer)) { if ($e -and (Test-Path -LiteralPath $e -PathType Container) -and ($r -notcontains $e)) { $r += $e } }
  try {
    foreach ($k in (Get-ChildItem 'HKCU:\Software\Microsoft\OneDrive\Accounts' -ErrorAction Stop)) {
      $uf = [string](Get-ItemProperty -LiteralPath $k.PSPath -ErrorAction SilentlyContinue).UserFolder
      if ($uf -and (Test-Path -LiteralPath $uf -PathType Container) -and ($r -notcontains $uf)) { $r += $uf }
      try { $mp = Get-ItemProperty -LiteralPath ($k.PSPath + '\ScopeIdToMountPointPathCache') -ErrorAction Stop; foreach ($pr in $mp.PSObject.Properties) { $v = [string]$pr.Value; if ($pr.Name -notlike 'PS*' -and $v -and (Test-Path -LiteralPath $v -PathType Container) -and ($r -notcontains $v)) { $r += $v } } } catch {}
    }
  } catch {}
  try { foreach ($d in (Get-ChildItem -LiteralPath $env:USERPROFILE -Directory -Filter 'OneDrive*' -ErrorAction SilentlyContinue)) { if ($r -notcontains $d.FullName) { $r += $d.FullName } } } catch {}
  return $r
}
# MARKER_SP_HANDLER_V10_AUTO_DEST -- หาโฟลเดอร์ชื่อ $label (ชื่อล็อคตายตัว) ในเครื่องนี้: ลองพาธมาตรฐาน <OneDrive>\VAT Controller\My System\<ชื่อ> ก่อน แล้วค่อยค้นใต้ OneDrive ลึกไม่เกิน 4 ชั้น
function Find-DestRoot([string]$label) {
  if (-not $label) { return $null }
  $roots = @(Get-OneDriveRoots)
  foreach ($r in $roots) { $c = Join-Path (Join-Path $r 'VAT Controller\My System') $label; if (Test-Path -LiteralPath $c -PathType Container) { return $c } }
  foreach ($r in $roots) {
    try { $f = Get-ChildItem -LiteralPath $r -Directory -Recurse -Depth 4 -Filter $label -ErrorAction SilentlyContinue | Where-Object { $_.Name -ieq $label } | Select-Object -First 1; if ($f) { return $f.FullName } } catch {}
  }
  return $null
}
function Get-DownloadsDir($cfg) {
  if ($cfg.downloadsDir -and (Test-Path -LiteralPath $cfg.downloadsDir -PathType Container)) { return $cfg.downloadsDir }
  try {
    $v = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders' -ErrorAction Stop).'{374DE290-123F-4565-9164-39C4925E467B}'
    if ($v) { $v = [Environment]::ExpandEnvironmentVariables($v); if (Test-Path -LiteralPath $v -PathType Container) { return $v } }
  } catch {}
  return (Join-Path $env:USERPROFILE 'Downloads')
}
# MARKER_SP_HANDLER_V7_HIDDEN -- เขียน fastapn-run-hidden.vbs + ตั้งคำสั่ง Registry ให้เปิดแบบไม่มีหน้าต่าง (HKCU ไม่ต้อง Admin | ล้มเหลว = เงียบ ไม่กระทบงานหลัก)
function Ensure-HiddenLauncher {
  try {
    $vbs = Join-Path $base 'fastapn-run-hidden.vbs'
    $vbsText = @'
' FastAPN run-hidden launcher: starts a PowerShell script with NO console window.
' Usage: wscript.exe //B //Nologo fastapn-run-hidden.vbs "<script.ps1>" [args...]
Option Explicit
Dim sh, q, cmd, i
If WScript.Arguments.Count < 1 Then WScript.Quit 1
Set sh = CreateObject("WScript.Shell")
q = Chr(34)
cmd = "powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & q & WScript.Arguments(0) & q
For i = 1 To WScript.Arguments.Count - 1
  cmd = cmd & " " & q & WScript.Arguments(i) & q
Next
sh.Run cmd, 0, False
'@
    $curTxt = ''; if (Test-Path -LiteralPath $vbs) { $curTxt = [System.IO.File]::ReadAllText($vbs) }
    if ($curTxt.Trim() -ne $vbsText.Trim()) { [System.IO.File]::WriteAllText($vbs, ((($vbsText -replace "`r`n", "`n") -replace "`n", "`r`n") + "`r`n"), [System.Text.Encoding]::ASCII); Log 'HIDDEN vbs written' }
    $map = @(
      @{ key = 'HKCU:\Software\Classes\fastapn-sp'; ps1 = (Join-Path $base 'fastapn-sp.ps1') },
      @{ key = 'HKCU:\Software\Classes\fastapn';    ps1 = (Join-Path $base 'fastapn-outlook.ps1') }
    )
    foreach ($m in $map) {
      $ck = $m.key + '\shell\open\command'
      if (-not (Test-Path -LiteralPath $ck)) { continue }
      if (-not (Test-Path -LiteralPath $m.ps1)) { continue }
      $have = [string](Get-ItemProperty -LiteralPath $ck -ErrorAction Stop).'(default)'
      if ($have -notmatch [regex]::Escape((Split-Path -Leaf $m.ps1))) { continue }   # แตะเฉพาะคำสั่งของ FastAPN เท่านั้น
      $want = 'wscript.exe //B //Nologo "' + $vbs + '" "' + $m.ps1 + '" "%1"'
      if ($have -ne $want) { Set-ItemProperty -LiteralPath $ck -Name '(default)' -Value $want; Log ("HIDDEN launcher set: " + $m.key) }
    }
  } catch { Log "hidden launcher skip: $($_.Exception.Message)" }
}
try {
  # ── parse URI (Browser อาจเติม "/" ท้าย URI -> ตัดทิ้ง) ──
  Log ("URI: " + ($Uri -replace '(token=)[^&]+', '$1***'))
  Ensure-HiddenLauncher
  $action = 'send'
  if ($Uri -match '^fastapn-sp://([A-Za-z]+)') { $action = $Matches[1].ToLower() }
  if ($action -notin @('send','delete','open','update','put','list','mkdir','rename','move')) { Fail "คำสั่งไม่รู้จัก: '$action'" }
  # เอาเฉพาะส่วนหลังเครื่องหมาย ? (กรณี Windows/Browser ใส่ "/" คั่นเป็น send/?name=... หรือท้าย URI)
  $raw = ''
  $qi = $Uri.IndexOf('?')
  if ($qi -ge 0) { $raw = $Uri.Substring($qi + 1).TrimEnd('/') }
  $p = @{}
  foreach ($x in $raw -split '&') { $kv = $x -split '=', 2; if ($kv.Count -eq 2) { $p[$kv[0]] = [System.Uri]::UnescapeDataString($kv[1]) } }
  # ── คำสั่ง update: fastapn-sp://update?v=<เลขเวอร์ชัน>&api=<https://...>&token=<token> -> โหลด .ps1 ใหม่จาก Backend มาแทนตัวเอง (ทำครั้งเดียวต่อเวอร์ชัน) ──
  # MARKER_SP_HANDLER_REPORT_V1 -- ถ้าเว็บส่ง api+token มา (ทุกคำสั่ง) รายงานเวอร์ชันของเครื่องนี้กลับ Backend (ใช้แจ้งเตือนบน Home ว่าใคร Handler เก่า) | ล้มเหลว = เงียบ ไม่กระทบงานหลัก
  function Send-VersionReport($ver) {
    try {
      $rapi = ([string]$p['api']).TrimEnd('/'); $rtok = [string]$p['token']
      if ($rapi -match '^https?://[A-Za-z0-9.:_-]+(/[A-Za-z0-9._/-]*)?$' -and $rtok) {
        $body = (@{ version = [int]$ver; machine = $env:COMPUTERNAME } | ConvertTo-Json -Compress)
        Invoke-RestMethod -Uri "$rapi/api/file-storage/sp-handler/report" -Method Post -Headers @{ Authorization = "Bearer $rtok" } -ContentType 'application/json' -Body $body -TimeoutSec 6 | Out-Null
      }
    } catch { Log "report skip: $($_.Exception.Message)" }
  }
  if ($action -eq 'update') {
    $newVer = 0; [void][int]::TryParse([string]$p['v'], [ref]$newVer)
    if ($newVer -le $HandlerVersion) { Log "UPDATE skip (เครื่องนี้ v$HandlerVersion >= v$newVer)"; Send-VersionReport $HandlerVersion; exit 0 }   # v6: ข้ามอัปเดตแล้วยังรายงานเวอร์ชันให้ Backend (ปุ่ม "ตรวจสอบ" ที่ Home / เครื่องที่เพิ่งติดตั้ง)
    $api = ([string]$p['api']).TrimEnd('/'); $tok = [string]$p['token']
    if ($api -notmatch '^https?://[A-Za-z0-9.:_-]+(/[A-Za-z0-9._/-]*)?$') { Fail "api ไม่ถูกต้อง: '$api'" }
    if (-not $tok) { Fail 'คำสั่ง update ไม่มี token' }
    $self = $MyInvocation.MyCommand.Path
    $tmpNew = Join-Path $base 'fastapn-sp.ps1.new'
    Invoke-WebRequest -Uri "$api/api/file-storage/sp-handler/ps1-only" -Headers @{ Authorization = "Bearer $tok" } -OutFile $tmpNew -UseBasicParsing
    $txt = Get-Content -LiteralPath $tmpNew -Raw -Encoding UTF8
    if ($txt -notmatch 'param\(\[string\]\$Uri\)' -or $txt -notmatch '\$HandlerVersion\s*=\s*(\d+)') { Remove-Item -LiteralPath $tmpNew -Force -ErrorAction SilentlyContinue; Fail 'ไฟล์ที่ดาวน์โหลดไม่ใช่ Handler ที่ถูกต้อง ยกเลิกการอัปเดต' }
    $gotVer = [int]$Matches[1]
    if ($gotVer -lt $newVer) { Remove-Item -LiteralPath $tmpNew -Force -ErrorAction SilentlyContinue; Fail "Backend ยังเป็นเวอร์ชัน v$gotVer (ต้องการ v$newVer)" }
    # คัดลอกทับตัวเองผ่าน Process แยก (รอให้ตัวนี้จบก่อน)
    $cmd = "Start-Sleep -Seconds 2; Copy-Item -LiteralPath '$tmpNew' -Destination '$self' -Force; Remove-Item -LiteralPath '$tmpNew' -Force"
    Start-Process -FilePath 'powershell.exe' -NoNewWindow -ArgumentList @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-Command',$cmd)
    Log "UPDATE v$HandlerVersion -> v$gotVer"
    Send-VersionReport $gotVer
    Notify 'FastAPN: อัปเดต Handler แล้ว' "SharePoint Handler เป็นเวอร์ชัน v$gotVer"
    exit 0
  }
  if ($action -ne 'update') { Send-VersionReport $HandlerVersion }
  $fname = [System.IO.Path]::GetFileName([string]$p['name']); $bu = [string]$p['bu']; $period = [string]$p['period']
  # MARKER_SP_HANDLER_V9_MULTI_SEND -- รายชื่อไฟล์ที่จะส่ง (send เท่านั้น): names=a|b|c ถ้าไม่มี = name เดี่ยวเหมือน v8
  $fnameList = @()
  if ($action -eq 'send' -and $p.ContainsKey('names') -and $p['names']) { $fnameList = @(($p['names'] -split '\|') | ForEach-Object { [System.IO.Path]::GetFileName($_.Trim()) } | Where-Object { $_ }) }
  if ($fnameList.Count -eq 0 -and $fname) { $fnameList = @($fname) }
  if ($action -eq 'send' -and $fnameList.Count -gt 0) { $fname = $fnameList[0] }
  $dest = [string]$p['dest']; if (-not $dest) { $dest = 'recon' }
  if ($dest -notmatch '^[a-z]{2,12}$') { Fail "ปลายทางไม่ถูกต้อง: '$dest'" }
  # path (โฟลเดอร์ย่อยแบบ a/b/c) ใช้กับ put/list และ open/delete แบบ Clone | ห้าม .. / ไดรฟ์ / อักขระต้องห้าม
  $rel = ([string]$p['path']).Replace('/', '\').Trim('\')
  if ($rel -and ($rel -match '(^|\\)\.\.(\\|$)' -or $rel -match '[:*?"<>|]')) { Fail "path ไม่ถูกต้อง: '$rel'" }
  $usePath = ($action -in @('put','list')) -or ($action -in @('open','delete') -and $p.ContainsKey('path')) -or ($action -eq 'delete' -and $p.ContainsKey('items'))
  if ($action -in @('send','delete','open') -and -not $usePath) {
    if (-not $fname -or -not $bu -or -not $period) { Fail 'คำสั่งไม่ครบ (ต้องมี name / bu / period)' }
    # รหัส BU ต้องเป็นรหัสแบบตัวเลข/ตัวอักษร (เช่น 0568, 055Z) และงวดต้องเป็น YYYY.MM -> กัน Path แปลกๆ
    if ($bu -notmatch '^[0-9][0-9A-Za-z]{2,7}$') { Fail "รหัส BU ไม่ถูกต้อง: '$bu'" }
    if ($period -notmatch '^\d{4}\.(0[1-9]|1[0-2])$') { Fail "งวดไม่ถูกต้อง: '$period' (ต้องเป็น YYYY.MM)" }
    if ($fname -match '[\\/:*?"<>|]') { Fail 'ชื่อไฟล์มีอักขระที่ใช้ไม่ได้' }
  }
  if ($action -eq 'put' -and -not $fname) { Fail 'คำสั่ง put ไม่มี name' }
  if ($action -eq 'send') { foreach ($nm in $fnameList) { if ((-not $nm) -or $nm -match '[\\/:*?"<>|]') { Fail "ชื่อไฟล์ใช้ไม่ได้: '$nm'" } } }
  if ($usePath -and $fname -match '[\\/:*?"<>|]') { Fail 'ชื่อไฟล์มีอักขระที่ใช้ไม่ได้' }

  # ── config ──
  # MARKER_SP_HANDLER_V10_AUTO_DEST -- config เป็นแค่ค่าที่จำไว้: ไม่มีไฟล์ / ไม่มีปลายทางนี้ / พาธไม่มีจริง / ชื่อโฟลเดอร์ไม่ตรง => หาใหม่เองจากชื่อโฟลเดอร์ แล้วบันทึกลง config (ไม่ Fail ให้ผู้ใช้ไปรัน setup)
  $cfgPath = Join-Path $base 'fastapn-sp-config.json'
  $cfg = $null
  if (Test-Path -LiteralPath $cfgPath) { try { $cfg = Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { Log "config อ่านไม่ได้ ($($_.Exception.Message)) -> ใช้ค่าเริ่มต้น + หาโฟลเดอร์เอง" } }
  if (-not $cfg) { $cfg = [pscustomobject]@{ downloadsDir = ''; dests = [pscustomobject]@{} } }
  # ปลายทาง: config ใหม่ { dests: { recon: '...', upload: '...' } } / config เก่า { destRoot } = recon
  $root = $null; $rootCfg = $null
  if ($cfg.dests -and $cfg.dests.PSObject.Properties[$dest]) { $rootCfg = [string]$cfg.dests.$dest }
  elseif ($dest -eq 'recon' -and $cfg.destRoot) { $rootCfg = [string]$cfg.destRoot }
  # ล็อคชื่อโฟลเดอร์ปลายทางให้ตรงกับชนิด (กันตั้งค่าผิดที่)
  $expect = @{ recon = 'Z_Report Reconcile'; upload = 'Z_AllSystemUpload'; ap = 'Z_Report Reconcile - Account Payable' }[$dest]  # v8: ap = ไฟล์ AP Recon (GL Report) ล็อคชื่อโฟลเดอร์ตายตัวเหมือนกัน
  if ($rootCfg -and (Test-Path -LiteralPath $rootCfg -PathType Container) -and ((-not $expect) -or ((Split-Path -Leaf $rootCfg.TrimEnd('\')) -ieq $expect))) { $root = $rootCfg }
  if (-not $root -and $expect) {
    $found = Find-DestRoot $expect
    if ($found) {
      $root = $found
      Log "AUTO-DETECT dest=$dest -> $found (config เดิม: '$rootCfg')"
      try {
        $dobj = [ordered]@{}
        if ($cfg.dests) { foreach ($pr in $cfg.dests.PSObject.Properties) { $dobj[$pr.Name] = [string]$pr.Value } }
        $dobj[$dest] = $found
        ([ordered]@{ downloadsDir = [string]$cfg.downloadsDir; dests = $dobj } | ConvertTo-Json -Depth 4) | Out-File -FilePath $cfgPath -Encoding utf8
      } catch { Log "บันทึก config ไม่ได้: $($_.Exception.Message)" }
    }
  }
  if (-not $root) { Fail "ไม่พบโฟลเดอร์ปลายทาง '$expect' ในเครื่องนี้ (ค้นใน OneDrive ทุกบัญชีแล้ว)`nตรวจว่าโฟลเดอร์ SharePoint ซิงก์ลงเครื่องแล้ว (VAT Controller\My System\$expect) หรือรัน setup-fastapn-sp.bat เพื่อเลือกเอง" }

  # ── ตัวช่วย (v6): แปลง path สัมพัทธ์เป็นพาธเต็ม + ตรวจว่าอยู่ใต้โฟลเดอร์ปลายทาง ──
  $rootFull2 = [System.IO.Path]::GetFullPath($root).TrimEnd('\')
  function Resolve-InRoot([string]$relp) {
    $r = ([string]$relp).Replace('/', '\').Trim('\')
    if ($r -and ($r -match '(^|\\)\.\.(\\|$)' -or $r -match '[:*?"<>|]')) { Fail "path ไม่ถูกต้อง: '$r'" }
    $f = [System.IO.Path]::GetFullPath($(if ($r) { Join-Path $rootFull2 $r } else { $rootFull2 }))
    if ($f -ne $rootFull2 -and -not $f.StartsWith($rootFull2 + '\', [System.StringComparison]::OrdinalIgnoreCase)) { Fail "path อยู่นอกโฟลเดอร์ปลายทาง: '$r'" }
    return $f
  }
  function Test-BadName([string]$n) { return ((-not $n) -or ($n -eq '.') -or ($n -eq '..') -or ($n -match '[\\/:*?"<>|]')) }
  function Split-Items([string]$s) { return @(($s -split '\|') | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }
  function Get-ParentRel([string]$relp) {
    $q = ([string]$relp).Replace('/', '\').Trim('\') -split '\\'
    if ($q.Count -gt 1) { return ($q[0..($q.Count - 2)] -join '\') } else { return '' }
  }

  # MARKER_SP_HANDLER_PUT_LIST_V1 -- list: สแกนโฟลเดอร์ที่ซิงก์ (ลึกสุด 5 ชั้น, สูงสุด 20000 รายการ) ส่งเป็นชุดละ 200 รายการ กลับ Backend (ใช้ซ้ำหลังคำสั่งที่เปลี่ยนแปลง)
  function Send-Tree([string]$relDir) {
    $api2 = ([string]$p['api']).TrimEnd('/'); $tok2 = [string]$p['token']
    if ($api2 -notmatch '^https?://[A-Za-z0-9.:_-]+(/[A-Za-z0-9._/-]*)?$' -or -not $tok2) { return $false }
    $rd = ([string]$relDir).Replace('/', '\').Trim('\')
    while ($rd -and -not (Test-Path -LiteralPath (Resolve-InRoot $rd) -PathType Container)) { $rd = Get-ParentRel $rd }   # โฟลเดอร์หายไป (เช่นเพิ่งลบ) -> สแกนชั้นแม่แทน
    $startDir = Resolve-InRoot $rd
    $all = New-Object System.Collections.ArrayList
    foreach ($it in (Get-ChildItem -LiteralPath $startDir -Recurse -Force -ErrorAction SilentlyContinue)) {
      if ($all.Count -ge 20000) { break }
      if ($it.Name.StartsWith('~$') -or $it.Name.StartsWith('.') -or $it.Name -ieq 'desktop.ini' -or $it.Name -ieq 'Thumbs.db') { continue }
      $relp = $it.FullName.Substring($rootFull2.Length).TrimStart('\')
      if (($relp.Split('\')).Count -gt 5) { continue }
      [void]$all.Add(@{ path = $relp.Replace('\','/'); dir = [bool]$it.PSIsContainer; size = $(if ($it.PSIsContainer) { 0 } else { [long]$it.Length }); mtime = $it.LastWriteTimeUtc.ToString('o') })
    }
    $syncId = [guid]::NewGuid().ToString('N'); $n = $all.Count; $chunk = 200; $sent = 0
    $hdr = @{ Authorization = "Bearer $tok2" }
    do {
      $take = [Math]::Min($chunk, $n - $sent)
      $part = if ($take -gt 0) { @($all.GetRange($sent, $take)) } else { @() }
      $sent += $take
      $body = (@{ dest = $dest; machine = $env:COMPUTERNAME; syncId = $syncId; root = $rd; done = ($sent -ge $n); total = $n; items = $part } | ConvertTo-Json -Depth 4 -Compress)
      Invoke-RestMethod -Uri "$api2/api/file-storage/sp-handler/tree" -Method Post -Headers $hdr -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 30 | Out-Null
    } while ($sent -lt $n)
    Log "LIST OK dest=$dest rel='$rd' items=$n"
    return $true
  }
  if ($action -eq 'list') {
    if (-not (Send-Tree $rel)) { Fail 'คำสั่ง list ต้องมี api และ token' }
    exit 0
  }

  # ── mkdir: สร้างโฟลเดอร์ใหม่ใต้ path (มีอยู่แล้วไม่สร้างซ้ำ) ──
  if ($action -eq 'mkdir') {
    $nm = ([string]$p['name']).Trim()
    if (Test-BadName $nm) { Fail "ชื่อโฟลเดอร์ไม่ถูกต้อง: '$nm'" }
    $parent = Resolve-InRoot $rel
    $newDir = Join-Path $parent $nm
    if (Test-Path -LiteralPath $newDir) { $mm = "มี '$nm' อยู่แล้ว (ไม่สร้างซ้ำ)"; Log "MKDIR exists $newDir" }
    else { New-Item -ItemType Directory -Path $newDir -Force | Out-Null; $mm = "สร้างโฟลเดอร์ '$nm' แล้ว รอ OneDrive ซิงก์ขึ้น SharePoint"; Log "MKDIR OK $newDir" }
    [void](Send-Tree $rel)
    Notify 'FastAPN: สร้างโฟลเดอร์' $mm
    exit 0
  }

  # ── rename: เปลี่ยนชื่อไฟล์/โฟลเดอร์ใน path (ชื่อใหม่ซ้ำกับของเดิม = ไม่เปลี่ยน) ──
  if ($action -eq 'rename') {
    $old = ([string]$p['name']).Trim(); $nw = ([string]$p['newname']).Trim()
    if (Test-BadName $old) { Fail "ชื่อเดิมไม่ถูกต้อง: '$old'" }
    if (Test-BadName $nw) { Fail "ชื่อใหม่ไม่ถูกต้อง: '$nw'" }
    $parent = Resolve-InRoot $rel
    $srcItem = Join-Path $parent $old; $dstItem = Join-Path $parent $nw
    if (-not (Test-Path -LiteralPath $srcItem)) { Notify 'FastAPN: เปลี่ยนชื่อ' "ไม่พบ '$old' ในโฟลเดอร์ที่ซิงก์ไว้"; exit 0 }
    if ((Test-Path -LiteralPath $dstItem) -and ($old -ine $nw)) { Notify 'FastAPN: เปลี่ยนชื่อ' "มีชื่อ '$nw' อยู่แล้ว ไม่เปลี่ยนชื่อ"; exit 0 }
    Rename-Item -LiteralPath $srcItem -NewName $nw
    Log "RENAME OK $srcItem -> $nw"
    [void](Send-Tree $rel)
    Notify 'FastAPN: เปลี่ยนชื่อแล้ว' "'$old' -> '$nw' รอ OneDrive ซิงก์ขึ้น SharePoint"
    exit 0
  }

  # ── move: ย้ายหลายรายการ (items=a/b|c/d) ไปโฟลเดอร์ to (ว่าง = โฟลเดอร์หลัก) | ชื่อซ้ำที่ปลายทาง = ข้าม ไม่ทับ ──
  if ($action -eq 'move') {
    $rels = Split-Items ([string]$p['items'])
    if ($rels.Count -eq 0) { Fail 'ไม่มีรายการที่จะย้าย' }
    if ($rels.Count -gt 200) { Fail 'ย้ายได้ครั้งละไม่เกิน 200 รายการ' }
    $toFull = Resolve-InRoot ([string]$p['to'])
    if (-not (Test-Path -LiteralPath $toFull -PathType Container)) { Fail 'ไม่พบโฟลเดอร์ปลายทาง (ยังไม่ซิงก์ลงเครื่อง?)' }
    Add-Type -AssemblyName System.Windows.Forms
    $toShown = if ([string]$p['to']) { [string]$p['to'] } else { '(โฟลเดอร์หลัก)' }
    $pv = (($rels | Select-Object -First 8) -join "`n"); if ($rels.Count -gt 8) { $pv += "`n... และอีก $($rels.Count - 8) รายการ" }
    $ans = [System.Windows.Forms.MessageBox]::Show("ย้าย $($rels.Count) รายการ ไปที่`n$toShown ?`n`n$pv", 'FastAPN SharePoint Handler', 'YesNo', 'Question', 'Button1')
    if ($ans -ne 'Yes') { Log 'MOVE cancelled'; exit 0 }
    $ok = 0; $skip = @()
    foreach ($r in $rels) {
      try {
        $f = Resolve-InRoot $r
        if ($f -eq $rootFull2) { $skip += 'โฟลเดอร์หลัก (ย้ายไม่ได้)'; continue }
        $leaf = Split-Path -Leaf $f
        $dst = Join-Path $toFull $leaf
        if (-not (Test-Path -LiteralPath $f)) { $skip += "$leaf (ไม่พบ)"; continue }
        if ((Split-Path -Parent $f) -ieq $toFull) { $skip += "$leaf (อยู่ที่นี่อยู่แล้ว)"; continue }
        if ((Test-Path -LiteralPath $f -PathType Container) -and (($toFull + '\').StartsWith($f + '\', [System.StringComparison]::OrdinalIgnoreCase))) { $skip += "$leaf (ย้ายเข้าตัวเองไม่ได้)"; continue }
        if (Test-Path -LiteralPath $dst) { $skip += "$leaf (ปลายทางมีชื่อนี้แล้ว)"; continue }
        Move-Item -LiteralPath $f -Destination $dst
        $ok++
      } catch { $skip += "$r ($($_.Exception.Message))" }
    }
    Log "MOVE ok=$ok skip=$($skip.Count) to='$($p['to'])'"
    [void](Send-Tree '')
    $mm = "ย้ายแล้ว $ok รายการ"; if ($skip.Count) { $mm += "`nข้าม: " + (($skip | Select-Object -First 5) -join ', ') }
    Notify 'FastAPN: ย้ายไฟล์' $mm
    exit 0
  }

  # ── delete แบบหลายรายการ (items=a/b|c/d): ยืนยันครั้งเดียว | ไฟล์ลบได้ โฟลเดอร์ลบได้เฉพาะที่ว่างเปล่า ──
  if ($action -eq 'delete' -and $p.ContainsKey('items')) {
    $rels = Split-Items ([string]$p['items'])
    if ($rels.Count -eq 0) { Fail 'ไม่มีรายการที่จะลบ' }
    if ($rels.Count -gt 200) { Fail 'ลบได้ครั้งละไม่เกิน 200 รายการ' }
    $fulls = @()
    foreach ($r in $rels) { $f = Resolve-InRoot $r; if ($f -eq $rootFull2) { Fail 'ห้ามลบโฟลเดอร์หลัก' }; $fulls += $f }
    # MARKER_SP_HANDLER_DELETE_SILENT_V1 -- ลบเงียบ ไม่มีกล่องยืนยัน/ไม่มีแจ้งเตือน (กู้คืนจากถังขยะ SharePoint ได้ชั่วคราว) | แจ้งเฉพาะกรณีมีรายการถูกข้าม
    $ok = 0; $skip = @()
    foreach ($f in $fulls) {
      $leaf = Split-Path -Leaf $f
      try {
        if (Test-Path -LiteralPath $f -PathType Leaf) { Remove-Item -LiteralPath $f -Force; $ok++ }
        elseif (Test-Path -LiteralPath $f -PathType Container) {
          if (@(Get-ChildItem -LiteralPath $f -Force -ErrorAction SilentlyContinue).Count -eq 0) { Remove-Item -LiteralPath $f -Force; $ok++ } else { $skip += "$leaf (โฟลเดอร์ไม่ว่าง)" }
        } else { $skip += "$leaf (ไม่พบ)" }
      } catch { $skip += "$leaf ($($_.Exception.Message))" }
    }
    Log "DELETE items ok=$ok skip=$($skip.Count)"
    $parents = @($rels | ForEach-Object { Get-ParentRel $_ } | Select-Object -Unique)
    [void](Send-Tree $(if ($parents.Count -eq 1) { $parents[0] } else { '' }))
    $mm = "ลบแล้ว $ok รายการ"; if ($skip.Count) { $mm += "`nข้าม: " + (($skip | Select-Object -First 5) -join ', ') }
    if ($skip.Count) { Notify 'FastAPN: ลบจาก SharePoint' $mm }
    exit 0
  }

  # ── คำสั่ง delete: ลบไฟล์ <ปลายทาง>\<BU>\<YYYY.MM>\<ชื่อไฟล์> (ไม่ลบโฟลเดอร์) ──
  if ($action -eq 'delete') {
    $target = if ($usePath) { Join-Path (Join-Path $root $rel) $fname } else { Join-Path (Join-Path (Join-Path $root $bu) $period) $fname }
    $full = [System.IO.Path]::GetFullPath($target)
    if (-not $full.StartsWith([System.IO.Path]::GetFullPath($root).TrimEnd('\') + '\', [System.StringComparison]::OrdinalIgnoreCase)) { Fail 'Path ลบไม่ถูกต้อง (อยู่นอกโฟลเดอร์ปลายทาง)' }
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
      Log "DELETE not found $full"
      exit 0
    }
    # MARKER_SP_HANDLER_DELETE_SILENT_V1 -- ลบเงียบ ไม่มีกล่องยืนยัน (ไฟล์ยังกู้คืนจากถังขยะ SharePoint ได้ชั่วคราว) | delete แบบหลายรายการ (items=) ยังมีกล่องยืนยัน
    Remove-Item -LiteralPath $full -Force
    Log "DELETE OK $full"
    exit 0
  }

  # ── คำสั่ง open: เปิดไฟล์ในโฟลเดอร์ SharePoint ที่ซิงก์ไว้ ด้วยโปรแกรมเริ่มต้นของเครื่อง (Excel) ──
  if ($action -eq 'open') {
    $target = if ($usePath) { Join-Path (Join-Path $root $rel) $fname } else { Join-Path (Join-Path (Join-Path $root $bu) $period) $fname }
    $full = [System.IO.Path]::GetFullPath($target)
    if (-not $full.StartsWith([System.IO.Path]::GetFullPath($root).TrimEnd('\') + '\', [System.StringComparison]::OrdinalIgnoreCase)) { Fail 'Path ไม่ถูกต้อง (อยู่นอกโฟลเดอร์ปลายทาง)' }
    if (Test-Path -LiteralPath $full -PathType Container) { Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $full + '"'); Log "OPEN folder $full"; exit 0 }   # v6: เปิดโฟลเดอร์ใน Explorer
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
      Log "OPEN not found $full"
      Notify 'FastAPN: เปิดไฟล์' ("ไม่พบไฟล์ในโฟลเดอร์ SharePoint ที่ซิงก์ไว้ (ยังซิงก์ไม่เสร็จ หรือยังไม่เคยส่ง)`n[$dest] $bu \ $period \ $fname")
      exit 0
    }
    Start-Process -FilePath $full
    Log "OPEN OK $full"
    exit 0
  }

  # ── หาไฟล์ที่เพิ่งดาวน์โหลด (รอได้ถึง 45 วินาที/ไฟล์) ──
  # MARKER_SP_HANDLER_V9_MULTI_SEND -- วนทีละไฟล์ใน names (send) | put / send เดี่ยว = 1 ไฟล์เหมือนเดิม | ไฟล์ไหนไม่เจอ = ข้ามไปทำไฟล์ต่อไป แล้วแจ้งสรุปตอนท้าย
  $dlDir = Get-DownloadsDir $cfg
  if ($action -ne 'send' -or $fnameList.Count -lt 1) { $fnameList = @($fname) }
  $okNames = @(); $missNames = @(); $finalDir = ''
  foreach ($fname in $fnameList) {
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
    if (-not $src) { Log "ERROR: ไม่พบไฟล์ '$fname' ใน Downloads ($dlDir)"; $missNames += $fname; continue }

    # ── โฟลเดอร์ปลายทาง: <ปลายทาง>\<รหัส BU>\<YYYY.MM> (ใช้ของเดิมถ้ามี ไม่มีค่อยสร้าง) ──
    if ($action -eq 'put') {
      $monthDir = if ($rel) { Join-Path $root $rel } else { $root }
      $mdFull = [System.IO.Path]::GetFullPath($monthDir).TrimEnd('\')
      if ($mdFull -ne [System.IO.Path]::GetFullPath($root).TrimEnd('\') -and -not $mdFull.StartsWith([System.IO.Path]::GetFullPath($root).TrimEnd('\') + '\', [System.StringComparison]::OrdinalIgnoreCase)) { Fail 'Path ปลายทางไม่ถูกต้อง (อยู่นอกโฟลเดอร์ปลายทาง)' }
    } else {
      $buDir = Join-Path $root $bu
      $monthDir = Join-Path $buDir $period
    }
    if (-not (Test-Path -LiteralPath $monthDir)) { New-Item -ItemType Directory -Path $monthDir -Force | Out-Null }
    $final = Join-Path $monthDir $fname
    Move-Item -LiteralPath $src.FullName -Destination $final -Force   # ชื่อซ้ำ = ทับ (SharePoint เก็บ Version History ให้)
    Log "OK $final"
    $okNames += $fname
  }
  if ($missNames.Count -gt 0) {
    $lst = ($missNames | ForEach-Object { "- $_" }) -join "`n"
    if ($okNames.Count -gt 0) { Notify 'FastAPN: ส่งไป SharePoint' ("[$dest] $bu \ $period : ส่งแล้ว $($okNames.Count) ไฟล์`nแต่ยังไม่พบ $($missNames.Count) ไฟล์ใน Downloads") }
    Fail "ไม่พบไฟล์ใน Downloads ($dlDir):`n$lst`nตรวจว่า Browser ดาวน์โหลดโดยไม่ถามที่เก็บ (ปิด 'Ask where to save each file')`nหรือตั้ง downloadsDir ใน $cfgPath"
  }
  if ($action -eq 'put') { Notify 'FastAPN: ส่งไป SharePoint' ("[$dest] $rel \ $($okNames[0])`nรอ OneDrive ซิงก์ขึ้น SharePoint") }
  elseif ($okNames.Count -gt 1) { Notify 'FastAPN: ส่งไป SharePoint' ("[$dest] $bu \ $period : $($okNames.Count) ไฟล์`nรอ OneDrive ซิงก์ขึ้น SharePoint") }
  else { Notify 'FastAPN: ส่งไป SharePoint' ("[$dest] $bu \ $period \ $($okNames[0])`nรอ OneDrive ซิงก์ขึ้น SharePoint") }
} catch {
  Fail ("เกิดข้อผิดพลาด: " + $_.Exception.Message)
}
