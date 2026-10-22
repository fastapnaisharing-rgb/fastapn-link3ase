# -*- coding: utf-8 -*-
# Connect แล้วไม่มี Backup/Include เลย = ไม่มีก็คือไม่มี: ไม่เปิดหน้าต่าง/Popup ใดๆ (Account ที่ไม่มีข้อมูลคงสถานะ "ไม่พบ Backup")
import os, shutil
MARKER = "MARKER_GL_DOA_CONNECT_NONE_SILENT_V1"
P = os.path.join("src", "pages", "DetailOfAccount.js")
s = open(P, encoding="utf-8").read()
if MARKER in s: print("ข้าม: ลงแล้ว"); raise SystemExit
old = "setDropAcc(''); setDropPop(true); /* MARKER_GL_DOA_RECHECK_NO_STACK_V1 */ return; }"
assert s.count(old) == 1
s = s.replace(old, "/* " + MARKER + " */ return; }")
if not os.path.exists(P + ".bak_nonesilent"): shutil.copy2(P, P + ".bak_nonesilent")
open(P, "w", encoding="utf-8", newline="").write(s); print("OK")
