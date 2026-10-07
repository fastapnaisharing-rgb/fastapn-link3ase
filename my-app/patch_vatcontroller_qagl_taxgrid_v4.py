# -*- coding: utf-8 -*-
# Patch v4: Tax Invoice List -- (1) เอาแถวข้อความแนะนำออก (2) เรียงคอลัมน์ใหม่ Branch Dr. | GRN | Tax Invoice Date | TIV number | Amount | Vat
#  (3) วาง/กรอก Vat -> Amount (Gross) คำนวณให้ (x100/7) | วาง/กรอก Amount -> Vat คำนวณให้ (x7%) | ฝั่งที่ผู้ใช้กรอกเองไม่ถูกทับ | ถ้ากรอกทั้งคู่แล้วสลับกัน ระบบสลับให้ถูก
# usage: python patch_vatcontroller_qagl_taxgrid_v4.py <in> <out>
import re, sys
src, dst = sys.argv[1], sys.argv[2]
txt = open(src, 'rb').read().decode('utf-8')
def rep(old, new):
    global txt
    assert txt.count(old) == 1, (txt.count(old), old[:90])
    txt = txt.replace(old, new)

# ---- 1) ลำดับคอลัมน์ ----
rep("const QA_GL_GRID_COLS = ['date', 'tiv', 'br', 'g', 'v'];", "const QA_GL_GRID_COLS = ['br', 'date', 'tiv', 'g', 'v'];")

# ---- 2) Helper คำนวณ Amount <-> Vat ----
anchor = "  const qaGlSmartRec = (cells) =>"
rep(anchor, """  const qaGlFmt2 = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); // MARKER_QA_GL_TAXGRID_V4
  const qaGlRowApply = (row, col, val) => { // กรอก Amount -> Vat ออโต้ (7%) | กรอก Vat -> Amount ออโต้ (x100/7) | ฝั่งที่ผู้ใช้กรอกเองไม่ถูกทับ | กรอกทั้งคู่แต่สลับ -> สลับให้ถูก
    const n = { ...row, [col]: val };
    if (col === 'g') { n.gm = !!val; if (!n.vm) { const x = qaGlNm(val); n.v = x > 0 ? qaGlFmt2(roundMoney2(x * 0.07)) : ''; } }
    else if (col === 'v') { n.vm = !!val; if (!n.gm) { const x = qaGlNm(val); n.g = x > 0 ? qaGlFmt2(roundMoney2(x * 100 / 7)) : ''; } }
    if (n.gm && n.vm) { const g1 = qaGlNm(n.g); const v1 = qaGlNm(n.v); if (g1 > 0 && v1 > 0) { const a = vatTaxNormalizeAmounts({ gross_value: g1, vat_value: v1 }); if (!a.suspicious && (Math.abs(a.amount - g1) > 0.004 || Math.abs(a.vat - v1) > 0.004)) { n.g = qaGlFmt2(roundMoney2(a.amount)); n.v = qaGlFmt2(roundMoney2(a.vat)); } } }
    return n;
  };
  const qaGlRowSmart = (row, rec) => { let n = { ...row, date: rec.date || '', tiv: rec.tiv || '', g: '', v: '', gm: false, vm: false }; if (rec.g) n = qaGlRowApply(n, 'g', rec.g); if (rec.v) n = qaGlRowApply(n, 'v', rec.v); return n; };
""" + anchor)

# ---- 3) จุดเขียนค่าลงเซลล์ ใช้ qaGlRowApply ----
rep("for (let i = rect.r1; i <= rect.r2; i++) for (let j = rect.c1; j <= rect.c2; j++) next[i][QA_GL_GRID_COLS[j]] = qaGlCleanCell(QA_GL_GRID_COLS[j], matrix[0][0]);",
    "for (let i = rect.r1; i <= rect.r2; i++) for (let j = rect.c1; j <= rect.c2; j++) next[i] = qaGlRowApply(next[i], QA_GL_GRID_COLS[j], qaGlCleanCell(QA_GL_GRID_COLS[j], matrix[0][0]));")
rep("Object.assign(next[r0 + i], qaGlSmartRec(cells));", "next[r0 + i] = qaGlRowSmart(next[r0 + i], qaGlSmartRec(cells));")
rep("if (col) next[r0 + i][col] = qaGlCleanCell(col, v); });", "if (col) next[r0 + i] = qaGlRowApply(next[r0 + i], col, qaGlCleanCell(col, v)); });")
rep("const n = { ...x }; for (let j = rc.c1; j <= rc.c2; j++) n[QA_GL_GRID_COLS[j]] = ''; return n; })));",
    "let n = x; for (let j = rc.c1; j <= rc.c2; j++) n = qaGlRowApply(n, QA_GL_GRID_COLS[j], ''); return n; })));")
rep("setQaGlGrid((prev) => qaGlGridFit(prev.map((x, i) => (i === ed.r ? { ...x, [col]: cv } : x))));",
    "setQaGlGrid((prev) => qaGlGridFit(prev.map((x, i) => (i === ed.r ? qaGlRowApply(x, col, cv) : x))));")
rep("...recs.map((r, i) => ({ id: `gp${Date.now()}-${i}`, ...r }))]));",
    "...recs.map((r, i) => qaGlRowSmart({ id: `gp${Date.now()}-${i}`, br: '' }, r))]));")
rep("{ ...x, date: '', tiv: '', br: '', g: '', v: '' } : x))); });", "{ ...x, date: '', tiv: '', br: '', g: '', v: '', gm: false, vm: false } : x))); });")

# ---- 4) เอาแถวข้อความแนะนำออก ----
s = txt.index("                    {listGl.length === 0 && (<tr><td colSpan={7}")
e = txt.index("\n", s) + 1
txt = txt[:s] + txt[e:]

# ---- 5) หัวตาราง + ความกว้าง ----
rep("<colgroup><col style={{ width: '5%' }} /><col style={{ width: '16%' }} /><col style={{ width: '22%' }} /><col style={{ width: '18%' }} /><col style={{ width: '13%' }} /><col style={{ width: '13%' }} /><col style={{ width: '13%' }} /></colgroup>\n                  <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}><tr><th style={{ ...thS, textAlign: 'center' }}>#</th><th style={thS}>Tax Invoice Date</th><th style={thS}>TIV number</th><th style={thS}>GRN</th><th style={thS}>Branch Dr.</th>",
    "<colgroup><col style={{ width: '5%' }} /><col style={{ width: '13%' }} /><col style={{ width: '15%' }} /><col style={{ width: '16%' }} /><col style={{ width: '22%' }} /><col style={{ width: '15%' }} /><col style={{ width: '14%' }} /></colgroup>\n                  <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}><tr><th style={{ ...thS, textAlign: 'center' }}>#</th><th style={thS}>Branch Dr.</th><th style={thS}>GRN</th><th style={thS}>Tax Invoice Date</th><th style={thS}>TIV number</th>")

# ---- 6) แถวรายการเดิม (จาก Tab 1 Add) เรียงใหม่ ----
rs = txt.index("                        <td style={{ ...tdS, textAlign: 'center' }}>{i + 1}</td><td style={tdS}>{formatQuickActionReceiveDateText(it.date)}</td>")
re_ = txt.index("                        <td style={{ ...tdS, textAlign: 'right' }}>{fm2(it.g)}</td>", rs)
block = txt[rs:re_]
m_num = re.search(r"<td style=\{\{ \.\.\.tdS, textAlign: 'center' \}\}>\{i \+ 1\}</td>", block).group(0)
m_date = re.search(r"<td style=\{tdS\}>\{formatQuickActionReceiveDateText\(it\.date\)\}</td>", block).group(0)
m_tiv = re.search(r"<td style=\{tdS\} title=\{it\.tiv\}>.*?</span>\}</td>", block, re.S).group(0)
m_grn = re.search(r"<td style=\{tdS\}>\{grnOfGl\(i\) \|\| '—'\}</td>", block).group(0)
m_br = re.search(r"<td style=\{tdS\}>\{it\.brDr\}.*?</span>\}</td>", block, re.S).group(0)
new_block = "                        " + m_num + m_br + "\n                        " + m_grn + m_date + m_tiv + "\n"
txt = txt[:rs] + new_block + txt[re_:]

# ---- 7) แถว Grid: เรียงใหม่ ----
rep("                          {cell(0, 'วว/ดด/ปปปป')}{cell(1, 'TIV number')}\n",
    "                          {cell(0, String(qaGlBranchDr || '') || 'auto')}\n")
old_tail = "                          {cell(2, String(qaGlBranchDr || '') || 'auto')}{cell(3, 'Amount', true)}{cell(4, 'Vat (ว่าง = 7%)', true)}\n"
rep(old_tail, "                          {cell(1, 'วว/ดด/ปปปป')}{cell(2, 'TIV number')}{cell(3, 'Amount', true)}{cell(4, 'Vat', true)}\n")
# GRN td ต้องอยู่ถัดจาก Branch: ย้ายบรรทัด GRN ขึ้นมา
gs = txt.index("                          <td style={{ ...tdS, color: ok ? '#1a3a5c' : '#bbb' }}>{ok ? (grnOfGl(itIdx)")
ge = txt.index("\n", gs) + 1
grn_line = txt[gs:ge]
txt = txt[:gs] + txt[ge:]
ins = txt.index("                          {cell(0, String(qaGlBranchDr || '') || 'auto')}\n") + len("                          {cell(0, String(qaGlBranchDr || '') || 'auto')}\n")
txt = txt[:ins] + grn_line + txt[ins:]
open(dst, 'wb').write(txt.encode('utf-8'))
print('ok')
