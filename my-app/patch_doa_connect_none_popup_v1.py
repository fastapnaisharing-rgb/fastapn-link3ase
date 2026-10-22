# -*- coding: utf-8 -*-
# Connect แล้วไม่มี Backup/Include เลย = ขึ้นหน้าต่าง "สร้าง Backup Detail" ให้ใส่ไฟล์ (ไม่ซ้อน Popup แจ้งเตือน) | Recheck ที่เจอข้อมูลยังเงียบ
import os, shutil
MARKER = "MARKER_GL_DOA_CONNECT_NONE_POPUP_V1"
P = os.path.join("src", "pages", "DetailOfAccount.js")
s = open(P, encoding="utf-8").read()
if MARKER in s: print("ข้าม: ลงแล้ว"); raise SystemExit
old = "/* MARKER_GL_DOA_CONNECT_NONE_SILENT_V1 */ return; }"
assert s.count(old) == 1
s = s.replace(old, "setDropAcc(codes.length === 1 ? String(codes[0]) : ''); setDropPop(true); /* " + MARKER + " */ return; }")
if not os.path.exists(P + ".bak_nonepop"): shutil.copy2(P, P + ".bak_nonepop")
open(P, "w", encoding="utf-8", newline="").write(s); print("OK")
