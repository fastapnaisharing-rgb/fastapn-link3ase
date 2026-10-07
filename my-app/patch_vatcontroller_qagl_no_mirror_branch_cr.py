# -*- coding: utf-8 -*-
# Patch: GL-TransferVat -- เลิก Auto คัดลอก Ofin Code ฝั่ง Debit ไปทับ Credit ตอนพิมพ์ (ทำให้ใบที่ Add ตอนนั้น Dr=Cr -> YNY ทั้งที่ควรเป็น IB/NNN)
# usage: python patch_vatcontroller_qagl_no_mirror_branch_cr.py <in> <out>
import sys
src, dst = sys.argv[1], sys.argv[2]
txt = open(src, 'rb').read().decode('utf-8')
old = "['Ofin Code', qaGlBranchDr, (v) => { if (qaGlBranchCr === qaGlBranchDr) setQaGlBranchCr(v); setQaGlBranchDr(v); }],"
new = "['Ofin Code', qaGlBranchDr, setQaGlBranchDr], // MARKER_QA_GL_NO_MIRROR_BRANCH_CR_V1 -- แก้ Dr แล้วไม่ไปเปลี่ยน Cr (Cr = Branch ของ Invoice ตาม Default)"
assert txt.count(old) == 1, txt.count(old)
txt = txt.replace(old, new)
open(dst, 'wb').write(txt.encode('utf-8'))
print('ok')
