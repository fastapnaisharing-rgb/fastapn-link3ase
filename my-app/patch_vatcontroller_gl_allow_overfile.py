# -*- coding: utf-8 -*-
# patch_vatcontroller_gl_allow_overfile.py
# GL-TransferVat: ยื่นเกิน Invoice ได้ (กดบันทึกได้) / ยื่นขาดกดไม่ได้ (ยกเว้น Accept With Remark เดิม) / มี ADI Adjust เทียบเฉพาะ Vat
import sys, io, shutil
P = r'src\pages\VatController.js' if len(sys.argv) < 2 else sys.argv[1]
MARK = 'MARKER_VATCONTROLLER_GL_ALLOW_OVERFILE_V1'
s = io.open(P, encoding='utf-8').read()
if MARK in s:
    print('already patched'); sys.exit(0)
def rep1(old, new, label):
    global s
    assert s.count(old) == 1, '%s count=%d' % (label, s.count(old))
    s = s.replace(old, new)

# เงื่อนไข: ห้ามขาด (Gross/Vat เหลือ > 1) เกินได้
rep1("const okG = qaGlAdj ? true : (hasI && Math.abs(dg) <= 1);", "const okG = qaGlAdj ? true : (hasI && dg <= 1); // " + MARK + " -- ห้ามขาด เกินได้", 'okG')
rep1("const okV = Math.abs(restV) <= 1;", "const okV = restV <= 1;", 'okV')

# ข้อความ Hint ใต้ Add
rep1("'ยอดครบแล้ว — บันทึกได้เลย'", "(overGl ? 'ยื่นเกิน Invoice (Vat ' + fm2(remV) + ') — บันทึกได้เลย (หรือใช้ Adjust Diff by ADI ปรับส่วนต่าง)' : 'ยอดครบแล้ว — บันทึกได้เลย')", 'hint-ok1')
rep1("'ยอดตรงกับ Invoice แล้ว (±1 บาท) — บันทึกได้ เลย ไม่ต้อง Add'".replace('บันทึกได้ เลย', 'บันทึกได้เลย'),
     "(overGl ? 'ยื่นเกิน Invoice (Vat ' + fm2(remV) + ') — บันทึกได้เลย ไม่ต้อง Add (หรือใช้ Adjust Diff by ADI ปรับส่วนต่าง)' : 'ยอดตรงกับ Invoice แล้ว (±1 บาท) — บันทึกได้เลย ไม่ต้อง Add')", 'hint-ok2')
rep1("(overGl ? 'ยอดเกิน Invoice — ตรวจสอบจำนวนเงิน' :",
     "(overGl ? 'ยอดไม่ตรง: เกินบางรายการแต่ยังขาด (Gross ' + fm2(remG) + ' / Vat ' + fm2(remV) + ') — ยื่นเกินได้ แต่ห้ามขาด' :", 'hint-bad')
rep1("const addHintColorGl = tGl.ok ? '#2e7d32' : ((overGl || qaGlPendingMissing.length > 0) ? '#e5484d' : '#b26a00');",
     "const addHintColorGl = tGl.ok ? (overGl ? '#b26a00' : '#2e7d32') : ((overGl || qaGlPendingMissing.length > 0) ? '#e5484d' : '#b26a00');", 'color')

# ข้อความท้ายกรอบ
rep1("'ยอดใบกำกับตรงกับ Invoice แล้ว พร้อมบันทึก')",
     "(overGl ? `ใบกำกับยื่นเกิน Invoice (Gross ${fm2(tGl.dg)} / Vat ${fm2(tGl.dv)}) · บันทึกได้` : 'ยอดใบกำกับตรงกับ Invoice แล้ว พร้อมบันทึก'))", 'foot')
# วงเล็บเปิดของ (qaGlAdj ? ... : ( ... ) -- ตรวจ syntax ด้วย esbuild
shutil.copyfile(P, P + '.bak')
io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('patched')
