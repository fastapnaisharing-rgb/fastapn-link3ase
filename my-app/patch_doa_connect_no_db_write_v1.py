# -*- coding: utf-8 -*-
# Connect (ดึง Backup M-1) ต้องไม่เขียน Backup/Detail ของงวดปัจจุบันลง DB — ดึงมาแสดง/ตั้ง Include เท่านั้น
import os, shutil
MARKER = "MARKER_GL_DOA_CONNECT_NO_DB_WRITE_V1"
P = os.path.join("src", "pages", "DetailOfAccount.js")
s = open(P, encoding="utf-8").read()
if MARKER in s: print("ข้าม: ลงแล้ว"); raise SystemExit
old = "const mg = await prepBackupMerge(period, detailMatrixFromRows(rows), true); if (!mg.changed) return;\n      await saveDetBk(period, mg.matrix);\n"
assert s.count(old) == 1
s = s.replace(old, "/* " + MARKER + " -- ไม่เขียน Backup งวดปัจจุบันตอน Connect */\n")
if not os.path.exists(P + ".bak_nowrite"): shutil.copy2(P, P + ".bak_nowrite")
open(P, "w", encoding="utf-8", newline="").write(s); print("OK")
