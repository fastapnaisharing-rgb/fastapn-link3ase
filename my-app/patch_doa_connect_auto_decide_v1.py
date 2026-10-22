# -*- coding: utf-8 -*-
# กด Connect = ระบบตัดสินเอง: มีข้อมูลในไฟล์ Backup/Include/Below ของ Account นี้ -> Connect (ดึงเฉพาะแถวที่ยังไม่มี) เงียบๆ | ไม่มีเลย -> เด้งหน้าต่างใส่ Backup | กดได้ตลอด (ไม่มี Disconnect)
import os, shutil
MARKER = "MARKER_GL_DOA_CONNECT_AUTO_DECIDE_V1"
P = os.path.join("src", "pages", "DetailOfAccount.js")
s = open(P, encoding="utf-8").read()
if MARKER in s: print("ข้าม: ลงแล้ว"); raise SystemExit
def rep(old, new):
    global s
    assert s.count(old) == 1, ("anchor", s.count(old), old[:80]); s = s.replace(old, new)
rep("    if (code) { setDropAcc(String(code)); setDropPop(true); return; } /* MARKER_GL_DOA_CONNECT_ICON_POPUP_RECHECK_V1 -- กดได้ตลอด เด้งหน้าต่างใส่ Backup ทุกครั้ง */\n", "")
rep("    if (cur.conn === 'on') { bkSet(code, { conn: 'off', sel: '' }); return; }\n", "    /* " + MARKER + " */\n")
if not os.path.exists(P + ".bak_autodecide"): shutil.copy2(P, P + ".bak_autodecide")
open(P, "w", encoding="utf-8", newline="").write(s); print("OK")
