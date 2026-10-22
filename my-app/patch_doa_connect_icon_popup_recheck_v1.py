# -*- coding: utf-8 -*-
# 1) ไอคอน Connect = มีข้อมูล Include ของ Account นี้ใน DB  2) กดได้ตลอด เด้งหน้าต่างใส่ Backup ทุกครั้ง
# 3) โยน Backup เข้าไปแล้ว Recheck กับ DB ทันที (แถวที่มี Include อยู่แล้วไม่ถูกเอาเข้าซ้ำ)
import os, shutil
MARKER = "MARKER_GL_DOA_CONNECT_ICON_POPUP_RECHECK_V1"
P = os.path.join("src", "pages", "DetailOfAccount.js")
s = open(P, encoding="utf-8").read()
if MARKER in s: print("ข้าม: ลงแล้ว"); raise SystemExit
def rep(old, new):
    global s
    assert s.count(old) == 1, ("anchor", s.count(old), old[:80]); s = s.replace(old, new)
rep("const isCn = (c) => { const b = bkAcc[c]; return (b && b.conn === 'on') || (!b && ((incByAcc.get(String(c)) || 0) > 0 || !!bkHaveMap[String(c)])); };",
    "const isCn = (c) => (incByAcc.get(String(c)) || 0) > 0; /* " + MARKER + " -- ไอคอนเปลี่ยน = มี Include ใน DB */")
rep("  const toggleBk = async (code) => {\n", "  const toggleBk = async (code) => {\n    if (code) { setDropAcc(String(code)); setDropPop(true); return; } /* " + MARKER + " -- กดได้ตลอด เด้งหน้าต่างใส่ Backup ทุกครั้ง */\n")
rep("      setBkTick(t => t + 1); setDropPop(false); setDbMsg(`✓ สร้าง Backup Detail แล้ว",
    "      try { const csR = [...accN].filter(c => (shownAcc || []).some(x => String(x.code) === c)); for (const c of csR) { const dfn = it.find(x => x.period === per && String(x.account) === c) || it.find(x => x.period === per && !x.account); if (dfn) await carryM1(dfn, [c]); } } catch (eR) { /* Recheck กับ DB ไม่สำเร็จ ไม่กระทบการสร้าง Backup */ } /* " + MARKER + " -- โยน Backup แล้ว Recheck กับ DB: เอาเข้าเฉพาะแถวที่ยังไม่มี Include */\n      setBkTick(t => t + 1); setDropPop(false); setDbMsg(`✓ สร้าง Backup Detail แล้ว")
if not os.path.exists(P + ".bak_iconpop"): shutil.copy2(P, P + ".bak_iconpop")
open(P, "w", encoding="utf-8", newline="").write(s); print("OK")
