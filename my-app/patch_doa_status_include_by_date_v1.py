# -*- coding: utf-8 -*-
"""Patch: DetailOfAccount.js -- คอลัมน์ Status ใน Preview / Mode Edit: แถวที่ Transaction Date ต่ำกว่างวดปัจจุบัน (Below) = Include
เดิม: Include เฉพาะแถวที่อยู่ใน DB (incKeys) -> แถว Mar-26..Aug-26 และปี 2025 ขึ้น Pending
ใหม่: Include = อยู่ใน DB (incKeys) หรือ Transaction Date < งวดปัจจุบัน | นอกนั้น Pending
Run จากโฟลเดอร์ my-app:  python patch_doa_status_include_by_date_v1.py"""
import shutil, sys
P = r'src/pages/DetailOfAccount.js'
s = open(P, encoding='utf-8').read()
if 'MARKER_GL_DOA_STATUS_INCLUDE_BY_DATE_V1' in s:
    print('already patched'); sys.exit(0)
shutil.copy(P, P + '.bak_status_date_v1')
def rep(old, new):
    global s
    assert s.count(old) == 1, ('not unique/found', old[:90], s.count(old))
    s = s.replace(old, new)

# 1) Sheet: รับ curPeriod + คำนวณ Status
rep("function DoaDetSheet({ matrix, code, only, ctx, sel, onTog, onAll, totals, stat, incKeys, q })",
    "function DoaDetSheet({ matrix, code, only, ctx, sel, onTog, onAll, totals, stat, incKeys, q, curPeriod })")
rep("return o && incKeys.has(detKey(o)) ? 'Include' : 'Pending'; }) : null, [body, incKeys, stat]);",
    "return o && (incKeys.has(detKey(o)) || (pYM0 && txnYM(o) > 0 && txnYM(o) < pYM0)) ? 'Include' : 'Pending'; }) : null, [body, incKeys, stat, pYM0]); /* MARKER_GL_DOA_STATUS_INCLUDE_BY_DATE_V1 -- Include = อยู่ใน DB หรือ Transaction Date < งวดปัจจุบัน */")
rep("  const pst = React.useMemo(() => (incKeys && !stat)",
    "  const pYM0 = (() => { const pm = /^(\\d{4})\\.(\\d{2})$/.exec(curPeriod || ''); return pm ? Number(pm[1]) * 100 + Number(pm[2]) : 0; })();\n  const pst = React.useMemo(() => (incKeys && !stat)")

# 2) Modal: รับ curPeriod แล้วส่งต่อ
rep("function DoaPreviewModal({ kind, matrix, code, fileName, ctx, onClose, embed, onClear, incKeys })",
    "function DoaPreviewModal({ kind, matrix, code, fileName, ctx, onClose, embed, onClear, incKeys, curPeriod })")
rep("q={pageMode ? q : ''} />", "q={pageMode ? q : ''} curPeriod={curPeriod} />")

# 3) ผู้เรียก: ส่งงวดปัจจุบัน
rep("incKeys={prevw.kind === 'Detail' ? incKeys : undefined} onClose={() => setPrevw(null)} />",
    "incKeys={prevw.kind === 'Detail' ? incKeys : undefined} curPeriod={period} onClose={() => setPrevw(null)} />")
open(P, 'w', encoding='utf-8', newline='').write(s)
print('OK')
