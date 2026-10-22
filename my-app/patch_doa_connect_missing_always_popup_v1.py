# -*- coding: utf-8 -*-
# Connect ทั้งหมด: มี Account ที่ไม่พบ Backup/Include แม้แต่ตัวเดียว = เปิดหน้าต่างสร้าง Backup ทุกครั้ง
import os, shutil
MARKER = "MARKER_GL_DOA_CONNECT_MISSING_POPUP_V1"
P = os.path.join("src", "pages", "DetailOfAccount.js")
s = open(P, encoding="utf-8").read()
if MARKER in s: print("ข้าม: ลงแล้ว"); raise SystemExit
old = "{ const okC = codes.filter(hasD); const noC = codes.filter(c => !hasD(c));"
assert s.count(old) == 1
s = s.replace(old, old + " if (noC.length) { setDropAcc(noC.length === 1 ? String(noC[0]) : ''); setDropPop(true); } /* " + MARKER + " */")
if not os.path.exists(P + ".bak_misspop"): shutil.copy2(P, P + ".bak_misspop")
open(P, "w", encoding="utf-8", newline="").write(s); print("OK")
