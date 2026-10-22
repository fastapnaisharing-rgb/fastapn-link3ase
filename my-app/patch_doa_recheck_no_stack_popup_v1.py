# -*- coding: utf-8 -*-
# Recheck ไม่พบ Backup/Include: เปิดหน้าต่าง "สร้าง Backup Detail" อย่างเดียว ไม่ซ้อน Popup แจ้งเตือนทับ (ข้อความอธิบายอยู่ในหน้าต่างนั้นแล้ว)
import os, shutil
MARKER = "MARKER_GL_DOA_RECHECK_NO_STACK_V1"
P = os.path.join("src", "pages", "DetailOfAccount.js")
s = open(P, encoding="utf-8").read()
if MARKER in s: print("ข้าม: ลงแล้ว"); raise SystemExit
old = "setDropAcc(''); setDropPop(true); setDbMsg('Recheck: ไม่พบข้อมูล Backup / Include ของ Account ใดเลย — โยนไฟล์ Backup (Detail งวดก่อน) เพื่อสร้าง'); return; }"
assert s.count(old) == 1
s = s.replace(old, "setDropAcc(''); setDropPop(true); /* " + MARKER + " */ return; }")
if not os.path.exists(P + ".bak_nostack"): shutil.copy2(P, P + ".bak_nostack")
open(P, "w", encoding="utf-8", newline="").write(s); print("OK")
