# -*- coding: utf-8 -*-
# patch_sp_handler_v19_clean_downloads_v1.py  -- ใช้: python patch_sp_handler_v19_clean_downloads_v1.py <path>\spHandlerAssets.js
# Handler v19: หลังย้ายไฟล์เสร็จ ลบไฟล์ชื่อเดียวกันที่ค้างใน Downloads (name.ext / name (n).ext) ให้ไฟล์ล่าสุดทับของเดิม
import sys, re, base64, shutil, os, datetime
p = sys.argv[1]
t = open(p, encoding='utf-8', newline='').read()
M = 'MARKER_SP_HANDLER_V19_CLEAN_DL'
m = re.search(r'("fastapn-sp\.ps1": ")([A-Za-z0-9+/=]+)(")', t)
assert m, 'ไม่พบ fastapn-sp.ps1 ใน assets'
raw = base64.b64decode(m.group(2)); txt = raw.decode('utf-8-sig')
if M in txt: print('already v19'); sys.exit(0)
bak = p + '.bak'
if not os.path.exists(bak): shutil.copy(p, bak)   # หนึ่งไฟล์ .bak = ต้นฉบับ
assert txt.count('$HandlerVersion = 18') == 1, 'ต้องเป็น v18'
txt = txt.replace('$HandlerVersion = 18', '$HandlerVersion = 19', 1)
anchor = '    Log "OK $final"\r\n' if '    Log "OK $final"\r\n' in txt else '    Log "OK $final"\n'
assert txt.count(anchor) == 1, 'ไม่พบ anchor Log OK'
nl = '\r\n' if '\r\n' in anchor else '\n'
add = ('    # ' + M + ' -- v19: ลบไฟล์ชื่อเดียวกันที่ค้างใน Downloads (name.ext / name (n).ext) ให้ไฟล์ล่าสุดทับของเดิม ไม่เหลือ (1) (2)' + nl +
       "    try { Get-ChildItem -LiteralPath $dlDir -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -ieq $ext -and ($_.Name -ieq $fname -or $_.Name -match ('^' + [regex]::Escape($stem) + ' \\(\\d+\\)' + [regex]::Escape($ext) + '$')) } | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue } } catch { }" + nl)
txt = txt.replace(anchor, add + anchor, 1)
b64 = base64.b64encode(('﻿' + txt).encode('utf-8')).decode('ascii')
t = t[:m.start(2)] + b64 + t[m.end(2):]
now = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:00Z')
t, n = re.subn(r'(SP_HANDLER_RELEASED_AT = ")[^"]+(")', r'\g<1>' + now + r'\g<2>', t, count=1)
open(p, 'w', encoding='utf-8', newline='').write(t)
print('OK v19 | released', now)
