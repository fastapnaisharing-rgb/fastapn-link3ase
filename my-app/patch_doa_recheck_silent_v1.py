# -*- coding: utf-8 -*-
# Recheck / Connect ทำเงียบๆ: ไม่เด้ง Popup สรุปผล เด้งเฉพาะกรณีไม่พบ Backup/Include เลย (เปิดหน้าต่างสร้าง Backup) หรือเกิด Error
import os, shutil
MARKER = "MARKER_GL_DOA_RECHECK_SILENT_V1"
P = os.path.join("src", "pages", "DetailOfAccount.js")
s = open(P, encoding="utf-8").read()
if MARKER in s: print("ข้าม: ลงแล้ว"); raise SystemExit
a = "setDbMsg(`✓ Recheck BU ${bu}:"
b = "setDbMsg(`✓ Connect: เปลี่ยน Pending เป็น Include ${rsP.length} แถว`);"
assert s.count(a) == 1 and s.count(b) == 1
s = s.replace(a, "(() => {})(/* " + MARKER + " */`✓ Recheck BU ${bu}:")
s = s.replace(b, "/* " + MARKER + " */")
if not os.path.exists(P + ".bak_silent"): shutil.copy2(P, P + ".bak_silent")
open(P, "w", encoding="utf-8", newline="").write(s); print("OK")
