#!/usr/bin/env python3
# patch_sp_handler_v22.py -- อัปเดต Backend ให้แจก SharePoint Handler v22 (open ไม่ต้องมี name + สร้างโฟลเดอร์ให้เอง)
# ใช้:  python patch_sp_handler_v22.py <โฟลเดอร์ fastapn-backend> [path ของ fastapn-sp.ps1 v22]
#   ถ้าไม่ระบุ ps1 จะใช้ fastapn-sp.ps1 ที่วางไว้ข้างสคริปต์นี้
# ทำอะไร: หา spHandlerAssets.js -> สำรอง .bak_v22 -> เลข SP_HANDLER_VERSION = 22 -> ถ้าไฟล์ฝังสคริปต์ Handler ไว้ (template literal / base64) จะแทนที่ด้วย v22
#         ถ้า Backend อ่านสคริปต์จากไฟล์ .ps1 อยู่แล้ว จะคัดลอก v22 ทับไฟล์นั้น (สำรองก่อน) -> node --check -> restart service เอง
import sys, os, re, shutil, subprocess, base64
MARK = 'MARKER_SP_HANDLER_V22_BACKEND'
here = os.path.dirname(os.path.abspath(__file__))
root = sys.argv[1] if len(sys.argv) > 1 else '.'
ps1 = sys.argv[2] if len(sys.argv) > 2 else os.path.join(here, 'fastapn-sp.ps1')
if not os.path.isfile(ps1): sys.exit('ไม่พบ ' + ps1)
new = open(ps1, 'rb').read().decode('utf-8')
if new.startswith('﻿'): bom = True
else: bom = False
if not re.search(r'\$HandlerVersion\s*=\s*22\b', new): sys.exit('ไฟล์ ps1 ไม่ใช่ v22')
cands = []
for d, _, fs in os.walk(root):
    if 'node_modules' in d or '.git' in d: continue
    for f in fs:
        if f.lower() == 'sphandlerassets.js': cands.append(os.path.join(d, f))
if not cands: sys.exit('ไม่พบ spHandlerAssets.js ใต้ ' + root)
p = cands[0]; src = open(p, 'rb').read().decode('utf-8')
if MARK in src: sys.exit('เคยแพตช์แล้ว')
shutil.copy2(p, p + '.bak_v22'); out = src; done = []
# 1) เลขเวอร์ชัน
out, n = re.subn(r'(SP_HANDLER_VERSION\s*=\s*)\d+', r'\g<1>22', out)
if n: done.append('SP_HANDLER_VERSION=22')
# 2) ฝังเป็น template literal ที่มี param([string]$Uri)
m = re.search(r'`[^`]*param\(\[string\]\\?\$Uri\)(?:[^`\\]|\\.)*`', out, re.S)
if m:
    esc = new.replace('\\', '\\\\').replace('`', '\\`').replace('${', '\\${')
    out = out[:m.start()] + '`' + esc + '`' + out[m.end():]; done.append('ฝังสคริปต์ (template literal)')
else:
    # 3) ฝังเป็น base64
    m64 = re.search(r"(['\"])([A-Za-z0-9+/=\s]{2000,})\1", out)
    if m64 and b'param(' in base64.b64decode(re.sub(r'\s', '', m64.group(2)) + '==', validate=False)[:20000].replace(b'\x00', b''):
        b = base64.b64encode(new.encode('utf-8')).decode()
        out = out[:m64.start(2)] + b + out[m64.end(2):]; done.append('ฝังสคริปต์ (base64)')
if not any('ฝัง' in x for x in done):
    # 4) อ่านจากไฟล์ .ps1 ในเครื่อง
    for d, _, fs in os.walk(root):
        if 'node_modules' in d or '.git' in d: continue
        for f in fs:
            if f.lower() == 'fastapn-sp.ps1':
                t = os.path.join(d, f); shutil.copy2(t, t + '.bak_v22'); shutil.copy2(ps1, t); done.append('คัดลอก v22 ทับ ' + t)
out = out.rstrip('\n') + '\n// ' + MARK + '\n'
open(p, 'wb').write(out.encode('utf-8'))
r = subprocess.run(['node', '--check', p], capture_output=True, text=True)
if r.returncode:
    shutil.copy2(p + '.bak_v22', p); sys.exit('node --check ไม่ผ่าน คืนไฟล์เดิมแล้ว\n' + r.stderr)
print('OK', p); print('\n'.join(' - ' + x for x in done))
if not done or all('คัดลอก' in x for x in done) and 'SP_HANDLER_VERSION=22' not in done: print('คำเตือน: ตรวจ spHandlerAssets.js ด้วยตา')
print('ต่อไป: restart service fastapn-backend (เช่น: net stop fastapn-backend && net start fastapn-backend)')
