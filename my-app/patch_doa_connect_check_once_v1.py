# -*- coding: utf-8 -*-
# เช็ค/แทรกแถวจาก Backup ตอน Connect ทำครั้งเดียวต่อการ Connect (ไม่เช็คซ้ำทุกครั้งที่ข้อมูลในหน้าเปลี่ยน)
import os, shutil
MARKER = "MARKER_GL_DOA_CONNECT_CHECK_ONCE_V1"
P = os.path.join("src", "pages", "DetailOfAccount.js")
s = open(P, encoding="utf-8").read()
if MARKER in s: print("ข้าม: ลงแล้ว"); raise SystemExit
old = "`${bkAcc[c].sel}|${detMatrix.length}|${bkTick}|${clrKeys.size}`"
assert s.count(old) == 2
s = s.replace(old, "`${bkAcc[c].sel}` /* " + MARKER + " */")
if not os.path.exists(P + ".bak_once2"): shutil.copy2(P, P + ".bak_once2")
open(P, "w", encoding="utf-8", newline="").write(s); print("OK")
