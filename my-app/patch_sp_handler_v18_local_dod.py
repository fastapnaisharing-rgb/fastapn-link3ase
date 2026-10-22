# -*- coding: utf-8 -*-
"""
patch_sp_handler_v18_local_dod.py   (วางข้าง fastapn-sp.ps1 แล้วรัน: python patch_sp_handler_v18_local_dod.py)
MARKER: MARKER_SP_HANDLER_V18_LOCAL_DOD

Handler v18 -- Drive D (โฟลเดอร์ในเครื่องผู้ใช้ D:\\apps\\Backup_DOH):
  - dest=dod  : โฟลเดอร์ Backup ในเครื่อง (สร้างให้เองถ้ายังไม่มี) โครงสร้าง <BU>\\<YYYY.MM>\\<ชื่อไฟล์>
  - backup    : เก็บ (ทับไฟล์ชื่อเดิมไปเรื่อยๆ ไม่ลบ) ลง Drive D + ส่งต่อ SharePoint Z_Backup_DOH ถ้ามี (scope=local = เก็บเฉพาะ Drive D)
  - list dest=dod : ส่งรายการไฟล์ให้ Backend แบบพักชั่วคราวตาม req (ไม่ปนกับ Cache ของ SharePoint)
  - pull      : ดึงไฟล์ใน Drive D ส่งขึ้น Backend ชั่วคราวตาม req ให้หน้าเว็บอ่านต่อ
"""
import os
import shutil, sys


def die(msg):
    print("[ABORT] " + msg)
    sys.exit(1)


def load(path):
    if not os.path.isfile(path):
        die("ไม่พบไฟล์: " + path)
    with open(path, "r", encoding="utf-8", newline="") as f:
        s = f.read()
    nl = "\r\n" if "\r\n" in s else "\n"
    return s, nl


def apply(src, nl, marker, edits):
    """edits = [(label, old, new)] ; old ต้องพบ 1 ครั้งพอดี ; \\n ใน old/new ถูกแปลงเป็นรูปแบบขึ้นบรรทัดของไฟล์"""
    if marker in src:
        print("[SKIP] พบ " + marker + " แล้ว (Idempotent) ไม่เขียนไฟล์")
        sys.exit(0)
    out = src
    for label, old, new in edits:
        o = old.replace("\n", nl)
        n = new.replace("\n", nl)
        c = out.count(o)
        if c != 1:
            die("Anchor '%s' พบ %d ครั้ง (ต้อง 1) -- ไม่เขียนไฟล์ ไฟล์อาจไม่ตรงเวอร์ชัน ให้ส่งไฟล์ปัจจุบันมาตรวจ" % (label, c))
        out = out.replace(o, n, 1)
    return out


def save(path, out):
    shutil.copyfile(path, path + ".bak")  # .bak ไฟล์เดียว ทับของเดิมทุกครั้ง
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(out)


def same_balance(src, out):
    """เทียบความสมดุลวงเล็บ 'เฉพาะส่วนที่เพิ่ม' (นับดิบในไฟล์ต้นฉบับอาจไม่สมดุลเพราะอยู่ใน String/Regex)"""
    return all((out.count(a) - out.count(b)) == (src.count(a) - src.count(b)) for a, b in (("{", "}"), ("(", ")"), ("[", "]")))


HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.join(HERE, "fastapn-sp.ps1")
MARKER = "MARKER_SP_HANDLER_V18_LOCAL_DOD"

src, nl = load(TARGET)

E = []

E.append(("version+header",
"param([string]$Uri)\n$HandlerVersion = 17",
"# MARKER_SP_HANDLER_V18_LOCAL_DOD -- v18: Drive D ในเครื่อง (dest=dod = D:\\apps\\Backup_DOH) | backup = เก็บลง Drive D (ทับไฟล์ชื่อเดิม) + SharePoint Z_Backup_DOH ถ้ามี (scope=local = เฉพาะ Drive D) | list dest=dod ส่งรายการให้ Backend ชั่วคราวตาม req | pull = ดึงไฟล์ใน Drive D ขึ้น Backend ชั่วคราวตาม req\n"
"# URI: fastapn-sp://backup?name=<ไฟล์>&bu=<COM>&period=<YYYY.MM>[&scope=local]  |  fastapn-sp://list?dest=dod&path=&req=<id>&api=..&token=..  |  fastapn-sp://pull?dest=dod&path=<BU/YYYY.MM/ไฟล์>&req=<id>&api=..&token=..\n"
"param([string]$Uri)\n$HandlerVersion = 18"))

E.append(("actions",
"if ($action -notin @('send','delete','open','update','put','list','mkdir','rename','move')) {",
"if ($action -notin @('send','delete','open','update','put','list','mkdir','rename','move','backup','pull')) {"))

E.append(("dest-force",
"  if ($dest -notmatch '^[a-z]{2,12}$') { Fail \"ปลายทางไม่ถูกต้อง: '$dest'\" }",
"  if ($dest -notmatch '^[a-z]{2,12}$') { Fail \"ปลายทางไม่ถูกต้อง: '$dest'\" }\n"
"  if ($action -eq 'backup') { $dest = 'dod' }   # MARKER_SP_HANDLER_V18_LOCAL_DOD -- backup เก็บลง Drive D เสมอ"))

E.append(("validate-backup",
"  if ($action -in @('send','delete','open') -and -not $usePath) {",
"  if ($action -in @('send','delete','open','backup') -and -not $usePath) {"))

E.append(("root-dod",
"  if (-not $root) { Fail \"ไม่พบโฟลเดอร์ปลายทาง '$expect'",
"  if (-not $root -and $dest -eq 'dod') {   # MARKER_SP_HANDLER_V18_LOCAL_DOD -- Drive D ในเครื่อง: <โฟลเดอร์สคริปต์>\\Backup_DOH (D:\\apps\\Backup_DOH) สร้างให้เองถ้ายังไม่มี\n"
"    $root = Join-Path $base 'Backup_DOH'\n"
"    if (-not (Test-Path -LiteralPath $root)) { New-Item -ItemType Directory -Path $root -Force | Out-Null; Log \"CREATE dod root $root\" }\n"
"  }\n"
"  if (-not $root) { Fail \"ไม่พบโฟลเดอร์ปลายทาง '$expect'"))

E.append(("send-tree-dod",
"    $syncId = [guid]::NewGuid().ToString('N'); $n = $all.Count; $chunk = 200; $sent = 0",
"    if ($dest -eq 'dod') {   # MARKER_SP_HANDLER_V18_LOCAL_DOD -- รายการใน Drive D ส่งเป็นชุดเดียวตาม req (พักชั่วคราวบน Backend ไม่เข้า Cache SharePoint)\n"
"      $reqId = [string]$p['req']; if (-not $reqId) { $reqId = [guid]::NewGuid().ToString('N') }\n"
"      $lim = @($all | Select-Object -First 1500)\n"
"      $lb = (@{ req = $reqId; machine = $env:COMPUTERNAME; root = $rd; total = $all.Count; items = $lim } | ConvertTo-Json -Depth 4 -Compress)\n"
"      Invoke-RestMethod -Uri \"$api2/api/file-storage/sp-handler/local/list\" -Method Post -Headers @{ Authorization = \"Bearer $tok2\" } -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($lb)) -TimeoutSec 30 | Out-Null\n"
"      Log \"LIST(local) OK dest=dod rel='$rd' items=$($all.Count)\"\n"
"      return $true\n"
"    }\n"
"    $syncId = [guid]::NewGuid().ToString('N'); $n = $all.Count; $chunk = 200; $sent = 0"))

E.append(("pull-action",
"  if ($action -eq 'list') {\n    if (-not (Send-Tree $rel)) { Fail 'คำสั่ง list ต้องมี api และ token' }\n    exit 0\n  }",
"  if ($action -eq 'list') {\n    if (-not (Send-Tree $rel)) { Fail 'คำสั่ง list ต้องมี api และ token' }\n    exit 0\n  }\n"
"\n"
"  # MARKER_SP_HANDLER_V18_LOCAL_DOD -- pull: อ่านไฟล์ใน Drive D (ไม่เกิน 25 MB) ส่งขึ้น Backend พักชั่วคราวตาม req ให้หน้าเว็บอ่านต่อ (หน้าเว็บอ่านไฟล์ในเครื่องเองไม่ได้)\n"
"  if ($action -eq 'pull') {\n"
"    $api3 = ([string]$p['api']).TrimEnd('/'); $tok3 = [string]$p['token']; $req3 = [string]$p['req']\n"
"    if ($api3 -notmatch '^https?://[A-Za-z0-9.:_-]+(/[A-Za-z0-9._/-]*)?$' -or -not $tok3 -or $req3 -notmatch '^[A-Za-z0-9]{8,64}$') { Fail 'คำสั่ง pull ต้องมี api / token / req' }\n"
"    if ($dest -ne 'dod') { Fail 'คำสั่ง pull ใช้ได้เฉพาะ Drive D (dest=dod)' }\n"
"    $pf = Resolve-InRoot $rel\n"
"    if (-not (Test-Path -LiteralPath $pf -PathType Leaf)) { Log \"PULL not found $pf\"; Notify 'FastAPN: ดึงไฟล์จาก Drive D' \"ไม่พบไฟล์: $rel\"; exit 0 }\n"
"    $pi = Get-Item -LiteralPath $pf\n"
"    if ($pi.Length -gt 25MB) { Fail 'ไฟล์ใหญ่เกิน 25 MB' }\n"
"    $qn = [System.Uri]::EscapeDataString($pi.Name)\n"
"    Invoke-RestMethod -Uri \"$api3/api/file-storage/sp-handler/local/pull?req=$req3&name=$qn\" -Method Post -Headers @{ Authorization = \"Bearer $tok3\" } -ContentType 'application/octet-stream' -InFile $pf -TimeoutSec 120 | Out-Null\n"
"    Log \"PULL OK $pf ($($pi.Length) bytes)\"\n"
"    exit 0\n"
"  }"))

E.append(("backup-move",
"    Move-Item -LiteralPath $src.FullName -Destination $final -Force   # ชื่อซ้ำ = ทับ (SharePoint เก็บ Version History ให้)",
"    if ($action -eq 'backup') {   # MARKER_SP_HANDLER_V18_LOCAL_DOD -- เก็บลง Drive D (ทับไฟล์ชื่อเดิม) แล้วส่งต่อ SharePoint Z_Backup_DOH ถ้ามี (ยกเว้น scope=local) | ไม่มีให้ส่งต่อ = ลบไฟล์ค้างใน Downloads\n"
"      Copy-Item -LiteralPath $src.FullName -Destination $final -Force\n"
"      $sentSp = $false\n"
"      if ([string]$p['scope'] -ne 'local') {\n"
"        $dohRoot = $null; try { $dohRoot = Find-DestRoot 'Z_Backup_DOH' } catch { $dohRoot = $null }\n"
"        if ($dohRoot) {\n"
"          $spDir = Join-Path (Join-Path $dohRoot $bu) $period\n"
"          if (-not (Test-Path -LiteralPath $spDir)) { New-Item -ItemType Directory -Path $spDir -Force | Out-Null }\n"
"          Move-Item -LiteralPath $src.FullName -Destination (Join-Path $spDir $fname) -Force; $sentSp = $true; Log \"BACKUP SP OK $spDir\\$fname\"\n"
"        }\n"
"      }\n"
"      if (-not $sentSp) { Remove-Item -LiteralPath $src.FullName -Force -ErrorAction SilentlyContinue }\n"
"      Log \"BACKUP OK $final\"\n"
"    } else {\n"
"    Move-Item -LiteralPath $src.FullName -Destination $final -Force   # ชื่อซ้ำ = ทับ (SharePoint เก็บ Version History ให้)\n"
"    }"))

E.append(("notify-text",
"  } else { $sumMsg += \"`nรอ OneDrive ซิงก์ขึ้น SharePoint\" }",
"  } else { $sumMsg += $(if ($action -eq 'backup') { \"`nเก็บที่ Drive D: $root\" } else { \"`nรอ OneDrive ซิงก์ขึ้น SharePoint\" }) }"))

E.append(("notify-title",
"  Notify $(if ($missNames.Count -gt 0) { 'FastAPN: ส่งไป SharePoint (มีไฟล์ไม่สำเร็จ)' } else { 'FastAPN: ส่งไป SharePoint สำเร็จ' }) $sumMsg",
"  Notify $(if ($action -eq 'backup') { if ($missNames.Count -gt 0) { 'FastAPN: Backup ลง Drive D (มีไฟล์ไม่สำเร็จ)' } else { 'FastAPN: Backup ลง Drive D สำเร็จ' } } elseif ($missNames.Count -gt 0) { 'FastAPN: ส่งไป SharePoint (มีไฟล์ไม่สำเร็จ)' } else { 'FastAPN: ส่งไป SharePoint สำเร็จ' }) $sumMsg"))

out = apply(src, nl, MARKER, E)
if not same_balance(src, out):
    die("Bracket ไม่สมดุลหลัง Patch (ไม่เขียนไฟล์)")
save(TARGET, out)
print("[OK] fastapn-sp.ps1 -> v18 (Drive D: backup / list / pull) | สำรอง .bak แล้ว")
print("     ต่อไป: ฝังไฟล์นี้ลง Backend ด้วย patch_sp_handler_assets_v17.py แล้ว Restart-Service fastapn-backend (เครื่องผู้ใช้จะ Update เองจากหน้า Setup - Tools)")
