# -*- coding: utf-8 -*-
# patch_vatcontroller_gl_adjust_save_condition.py
# GL-TransferVat: เงื่อนไขกดบันทึก = (Vat ใบกำกับที่ Add + Vat ที่ Adjust ด้วย ADI) เท่า Invoice (±1 บาท) / Simple ตามใบกำกับ ADI ตาม Config
import sys, io, shutil
P = r'src\pages\VatController.js' if len(sys.argv) < 2 else sys.argv[1]
MARK = 'MARKER_VATCONTROLLER_GL_ADJUST_SAVE_CONDITION_V1'
s = io.open(P, encoding='utf-8').read()
if MARK in s:
    print('already patched'); sys.exit(0)
def rep1(old, new, label):
    global s
    assert s.count(old) == 1, '%s count=%d' % (label, s.count(old))
    s = s.replace(old, new)

rep1("""    const okG = hasI ? Math.abs(dg) <= 1 : !!qaGlAdj;
    const okV = qaGlAdj ? Math.abs(roundMoney2(dv - qaGlAdj.cover)) <= 1 : Math.abs(dv) <= 1;
    return { invG, invV, sg, sv, dg, dv, ok: (hasI || !!qaGlAdj) && okG && okV };""",
"""    const adjV = qaGlAdj ? qaGlAdj.cover : 0; // """ + MARK + """ -- Vat ที่ ADI Adjust ครอบ (ติดลบได้)
    const restV = roundMoney2(dv - adjV); // Vat ที่ยังไม่ครอบ = Invoice - ใบกำกับ - ADI
    const okG = qaGlAdj ? true : (hasI && Math.abs(dg) <= 1); // มี ADI Adjust เทียบเฉพาะ Vat (ADI ไม่มียอด Gross)
    const okV = Math.abs(restV) <= 1;
    return { invG, invV, sg, sv, dg, dv, adjV, restV, ok: (hasI || !!qaGlAdj) && okG && okV };""", 'totals')

rep1("`ใบกำกับ ${listGl.length} ใบ · ส่วนต่าง ${fm2(tGl.dg)} / ${fm2(tGl.dv)} (ต้องไม่เกิน ±1 บาท)`",
     "(qaGlAdj ? `ใบกำกับ ${listGl.length} ใบ (Vat ${fm2(tGl.sv)}) + ADI ${fm2(qaGlAdj.total)} · Vat ที่ยังไม่ครอบ ${fm2(tGl.restV)} (ต้องไม่เกิน ±1 บาท)` : `ใบกำกับ ${listGl.length} ใบ · ส่วนต่าง ${fm2(tGl.dg)} / ${fm2(tGl.dv)} (ต้องไม่เกิน ±1 บาท)`)", 'footmsg')

rep1("const tivItemsFP = qaGlAllItems.map((it) => ({ ...it, simType: qaGlSimOf(it), adiOn: qaGlAdiOf(it) }));",
     "const tivItemsFP = qaGlAllItems.map((it) => ({ ...it, simType: qaGlSimOf(it), adiOn: qaGlAdj ? false : qaGlAdiOf(it) })); // " + MARK + " -- มี Config ADI: ADI ออกตาม Config เท่านั้น (Simple ตามใบกำกับที่ Add)", 'adion')

# ---- บัญชี ADI Adjust = คู่ VAT ตามกลุ่ม (ไม่ใช้บัญชี SM-Code) ----
rep1("    const taxRows = [qaGlAdjMk('main', qaGlBranchDr, qaGlCpcDr, qaGlAccDr, qaGlSubDr)];\n    if (avg && nonRecov > 0) taxRows.push(qaGlAdjMk('avg', qaGlBranchDr, '45700', '63050000', qaGlSubDr, nonRecov));\n    const invRows = [qaGlAdjMk('main', qaGlBranchCr, qaGlCpcCr, qaGlAccCr, qaGlSubCr)];",
     "    const [vatDrAcc, vatCrAcc] = qaGlDefaultAcc(); // " + MARK + " -- ADI โอนภาษี = คู่ VAT ตามกลุ่ม (11610752/11630052, Asset 11610755/11630055, M 11610751/11630051) ไม่ใช้บัญชีค่าใช้จ่ายจาก SM-Code\n    const taxRows = [qaGlAdjMk('main', qaGlBranchDr, '99999', vatDrAcc, '999999')];\n    if (avg && nonRecov > 0) taxRows.push(qaGlAdjMk('avg', qaGlBranchDr, '45700', '63050000', '999999', nonRecov));\n    const invRows = [qaGlAdjMk('main', qaGlBranchCr, '99999', vatCrAcc, '999999')];", 'vatacc')

shutil.copyfile(P, P + '.bak')
io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('patched')
