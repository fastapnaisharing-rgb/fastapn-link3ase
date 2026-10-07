# -*- coding: utf-8 -*-
# Patch: GL-TransferVat -- Ofin Code/CPC/Account/Sub Acc ของ Debit/Credit: ตอนเปิด Auto ได้ แต่เมื่อผู้ใช้พิมพ์แก้ช่องใดช่องหนึ่ง (On Change) ระบบเลิก Auto (Autofill จาก Supplier / Reset ตอน quickActionRows เปลี่ยน) ทันที
# usage: python patch_vatcontroller_qagl_drcr_freeze_on_edit.py <in> <out>
import sys
src, dst = sys.argv[1], sys.argv[2]
txt = open(src, 'rb').read().decode('utf-8')
def rep(old, new):
    global txt
    assert txt.count(old) == 1, ('anchor count', txt.count(old), old[:80])
    txt = txt.replace(old, new)

# 1) Autofill จาก SM-Code: ข้ามถ้าผู้ใช้แก้ Dr/Cr เองแล้ว
rep("""  React.useEffect(() => { if (qaGlOpen && qaGlSupplier) qaGlApplyFill(qaGlSupplier); }, [qaGlOpen, qaGlSupplier?.['SM-Code']]);""",
"""  const qaGlDrCrTouchedRef = React.useRef(false); // MARKER_QA_GL_DRCR_FREEZE_ON_EDIT_V1 -- true เมื่อผู้ใช้พิมพ์แก้ช่อง Dr/Cr เอง -> เลิก Auto (Autofill/Reset) จนกว่าจะเปิด Popup ใหม่
  React.useEffect(() => { if (qaGlOpen && qaGlSupplier && !qaGlDrCrTouchedRef.current) qaGlApplyFill(qaGlSupplier); }, [qaGlOpen, qaGlSupplier?.['SM-Code']]); // MARKER_QA_GL_DRCR_FREEZE_ON_EDIT_V1""")

# 2) Effect เปิด Popup: ปิด Popup -> ล้างสถานะ / เปิดซ้ำระหว่างที่ผู้ใช้แก้แล้ว -> ไม่ทับ Dr/Cr
rep("""    if (!qaGlOpen) return;
    const [aDr, aCr] = qaGlDefaultAcc();""",
"""    if (!qaGlOpen) { qaGlDrCrTouchedRef.current = false; return; } // MARKER_QA_GL_DRCR_FREEZE_ON_EDIT_V1
    const [aDr, aCr] = qaGlDefaultAcc();""")
rep("""    setQaGlBranchDr(qaGlDefaultBranch()); setQaGlBranchCr(qaGlDefaultBranch());
    setQaGlCpcDr('99999'); setQaGlSubDr('999999'); setQaGlCpcCr('99999'); setQaGlSubCr('999999');
    setQaGlAccDr(aDr); setQaGlAccCr(aCr); setQaGlFormKey((k) => k + 1);""",
"""    if (qaGlDrCrTouchedRef.current) return; // MARKER_QA_GL_DRCR_FREEZE_ON_EDIT_V1 -- ผู้ใช้แก้ Dr/Cr เองแล้ว ไม่ Reset ทับ
    setQaGlBranchDr(qaGlDefaultBranch()); setQaGlBranchCr(qaGlDefaultBranch());
    setQaGlCpcDr('99999'); setQaGlSubDr('999999'); setQaGlCpcCr('99999'); setQaGlSubCr('999999');
    setQaGlAccDr(aDr); setQaGlAccCr(aCr); setQaGlFormKey((k) => k + 1);""")

# 3) ช่อง Input ทั้ง 8: พิมพ์แก้ = ติดธง
rep("""<input key={i} value={val} onChange={(e) => setter(e.target.value)} placeholder={ph} title={ph}""",
    """<input key={i} value={val} onChange={(e) => { qaGlDrCrTouchedRef.current = true; setter(e.target.value); }} placeholder={ph} title={ph}""")
open(dst, 'wb').write(txt.encode('utf-8'))
print('ok')
