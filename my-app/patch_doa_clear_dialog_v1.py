# -*- coding: utf-8 -*-
# ปรับข้อความ Dialog ล้างข้อมูล (ราย Account / ทั้งหมด) ให้อ่านง่าย — ไม่เปลี่ยนการทำงาน
import os, shutil
MARKER = "MARKER_GL_DOA_CLEAR_DIALOG_TEXT_V1"
P = os.path.join("src", "pages", "DetailOfAccount.js")
s = open(P, encoding="utf-8").read()
if MARKER in s: print("ข้าม: ลงแล้ว"); raise SystemExit
o1 = "if (!await askDoa(`ล้างข้อมูล ${kind} ของ Account ${a.code} (BU ${bu || '-'})?${kind !== 'TB' ? `\\nจะตัด Account นี้ออกจากไฟล์ Backup งวด ${period || '-'} ด้วย` : ''}\\nล้างแล้วต้องโยนไฟล์ใหม่`)) return;"
n1 = "if (!await askDoa(`ล้าง ${kind} ของ Account ${a.code}?\\n\\nBU ${bu || '-'} · งวด ${period || '-'}\\n\\n• ลบเฉพาะข้อมูลของ Account ${a.code} — Account อื่นไม่ถูกแตะ\\n• ล้างแล้วต้องโยนไฟล์ ${kind} ใหม่`)) return; /* " + MARKER + " */"
o2 = "if (!await askDoa(`ล้างข้อมูล ${kind} ทั้งหมด (${n} Account) ของ BU ${bu || '-'}?${kind ? `\\nจะตัดเฉพาะ ${n} Account ของคุณ (ตาม Config) ออกจากไฟล์ Backup ${kind} ของงวด ${period || '-'} — Account อื่นไม่ถูกลบ (ถ้าไม่เหลือข้อมูลเลย จึงลบทั้งไฟล์)` : ''}\\nล้างแล้วต้องโยนไฟล์ใหม่`)) return;"
n2 = "if (!await askDoa(`ล้าง ${kind} ทั้งหมดของคุณ?\\n\\nBU ${bu || '-'} · งวด ${period || '-'}\\nAccount ที่จะล้าง: ${n} Account (ตาม Config ของคุณ)\\n\\n• ลบเฉพาะข้อมูลของ ${n} Account นี้ — Account ของคนอื่นไม่ถูกแตะ\\n• ไฟล์ใน DB จะถูกลบทั้งไฟล์ก็ต่อเมื่อไม่เหลือข้อมูลของใครเลย\\n• ล้างแล้วต้องโยนไฟล์ ${kind} ใหม่`)) return;"
for o in (o1, o2): assert s.count(o) == 1, o[:60]
s = s.replace(o1, n1).replace(o2, n2)
if not os.path.exists(P + ".bak_dlg"): shutil.copy2(P, P + ".bak_dlg")
open(P, "w", encoding="utf-8", newline="").write(s); print("OK")
