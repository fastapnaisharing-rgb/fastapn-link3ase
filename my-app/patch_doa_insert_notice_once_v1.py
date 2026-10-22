# -*- coding: utf-8 -*-
# Popup "แทรก N รายการจาก Backup" เด้งเฉพาะเมื่อมีแถวที่ยังไม่เคยถูก Include (แถวที่ Include ไว้แล้วแทรกเงียบๆ ไม่เด้งซ้ำ)
import os, shutil
MARKER = "MARKER_GL_DOA_INSERT_NOTICE_ONCE_V1"
P = os.path.join("src", "pages", "DetailOfAccount.js")
s = open(P, encoding="utf-8").read()
if MARKER in s: print("ข้าม: ลงแล้ว"); raise SystemExit
a = "setNotice({ tone: 'warn', title: `แทรก ${miss.length} รายการจาก Backup"
assert s.count(a) == 1
s = s.replace(a, "if (miss.some(x => !incKeys.has(detKey(x[1])))) /* " + MARKER + " */ " + a)
if not os.path.exists(P + ".bak_once"): shutil.copy2(P, P + ".bak_once")
open(P, "w", encoding="utf-8", newline="").write(s); print("OK")
