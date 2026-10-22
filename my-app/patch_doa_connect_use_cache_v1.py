# -*- coding: utf-8 -*-
# Connect รายแถว: ใช้ผลที่เช็คไว้แล้วตอนเปิดหน้า (bkHaveMap) ไม่ Recheck ทั้ง BU กลับ DB ทุกครั้งที่กด
import os, shutil
MARKER = "MARKER_GL_DOA_CONNECT_USE_CACHE_V1"
P = os.path.join("src", "pages", "DetailOfAccount.js")
s = open(P, encoding="utf-8").read()
if MARKER in s: print("ข้าม: ลงแล้ว"); raise SystemExit
a = "    { await connectAll([{ code }]); return; } /* MARKER_GL_DOA_CONNECT_CHECK_DB_V1"
assert s.count(a) == 1
new = "    { const hv = bkHaveMap[String(code)]; if (bkHave && hv) { bkSet(code, { conn: 'on', sel: String(hv.id) }); await carryM1({ id: hv.id, period: hv.period, file_name: hv.name }, [code]); return; } } /* " + MARKER + " */\n" + a
s = s.replace(a, new)
if not os.path.exists(P + ".bak_cache"): shutil.copy2(P, P + ".bak_cache")
open(P, "w", encoding="utf-8", newline="").write(s); print("OK")
