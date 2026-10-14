# -*- coding: utf-8 -*-
"""Patch fileStorage.js (ไฟล์จริงบน Server): เปิด dest=ap (Z_Report Reconcile - Account Payable) + สิทธิ์ GL Override รายคน
ใช้: python patch_filestorage_dest_ap.py <path ของ fileStorage.js>      (สำรองเป็น .bak_ap ให้อัตโนมัติ)
แก้เฉพาะจุดที่จำเป็น ไม่แตะส่วนอื่น | รันซ้ำได้ | จุดไหนไม่เจอจะบอกชัด ๆ และไม่เขียนทับมั่ว"""
import sys, re, shutil
p = sys.argv[1]
s = open(p, encoding='utf-8', newline='').read()
orig = s
nl = '\r\n' if '\r\n' in s else '\n'
done, skipped = [], []

# 1) SP_DESTS ต้องมี "ap"  (จำเป็น: ไม่มี = Server ตอบ 400 หน้า SharePoint ฝั่ง AP ไม่ขึ้นข้อมูล)
m = re.search(r'const SP_DESTS = \[([^\]]*)\];', s)
if not m: skipped.append('SP_DESTS (ไม่พบบรรทัด const SP_DESTS = [...])')
elif '"ap"' in m.group(1) or "'ap'" in m.group(1): done.append('SP_DESTS มี ap อยู่แล้ว')
else:
    s = s.replace(m.group(0), 'const SP_DESTS = [' + m.group(1).rstrip() + ', "ap"]; // MARKER_SP_HANDLER_DEST_AP_V1 -- ap = Z_Report Reconcile - Account Payable (GL Report)', 1)
    done.append('SP_DESTS + "ap"')

# 2) spWebBase ให้ dest=ap อ่าน SP_WEB_BASE_AP  (ไม่ตั้ง = ปุ่มเปิด Excel Online ใช้ไม่ได้ แต่หน้ายังขึ้น)
if 'SP_WEB_BASE_AP' in s: done.append('spWebBase มี ap อยู่แล้ว')
else:
    old = 'process.env.SP_WEB_BASE_UPLOAD : process.env.SP_WEB_BASE_RECON)'
    if s.count(old) == 1:
        s = s.replace(old, 'process.env.SP_WEB_BASE_UPLOAD : dest === "ap" ? process.env.SP_WEB_BASE_AP : process.env.SP_WEB_BASE_RECON)')
        done.append('spWebBase + SP_WEB_BASE_AP')
    else: skipped.append('spWebBase (รูปแบบบรรทัดไม่ตรง — ต้องแก้มือ: dest==="ap" ? process.env.SP_WEB_BASE_AP)')

# 3) spCanUse: ให้คนที่มีสิทธิ์ GL (Permission ใน GL Access / Override รายคน) ใช้ Handler ฝั่ง AP ได้ (Owner ผ่านอยู่แล้ว ไม่ต้องใช้ก็ได้)
if 'glAccessFor' in s: done.append('spCanUse ใช้ glAccessFor อยู่แล้ว')
elif 'menuPermissions.js' not in s and not re.search(r'from "\./menuPermissions\.js"', s):
    skipped.append('spCanUse (ไฟล์ยังไม่ผูกกับ menuPermissions.js — Owner ใช้ได้ปกติ ผู้ใช้อื่นเรื่องสิทธิ์ GL ค่อยทำทีหลัง)')
else:
    m2 = re.search(r'import \{ glAllowedPerms \} from "\./menuPermissions\.js";[^\n\r]*', s)
    m3 = re.search(r'const allowed = await glAllowedPerms\(\);\s*return allowed\.some\(\(k\) => p\[k\] === true\);', s)
    if m2 and m3:
        s = s.replace(m2.group(0), m2.group(0).replace('{ glAllowedPerms }', '{ glAllowedPerms, glAccessFor }'), 1)
        s = s.replace(m3.group(0), 'return await glAccessFor(u); // MARKER_GL_REPORT_OVERRIDE_V1 -- Override รายคนของ GL + Permission ใน GL Access', 1)
        done.append('spCanUse -> glAccessFor')
    else: skipped.append('spCanUse (รูปแบบโค้ดไม่ตรง — ไม่ได้แก้ ไม่กระทบการเปิดหน้า)')

if s != orig:
    shutil.copyfile(p, p + '.bak_ap')
    open(p, 'w', encoding='utf-8', newline='').write(s)
print('แก้แล้ว/มีอยู่แล้ว:'); [print('  +', d) for d in done]
if skipped: print('ข้าม:'); [print('  -', d) for d in skipped]
print('เสร็จ -> restart fastapn-backend')
