# -*- coding: utf-8 -*-
# Patch v5: Tax Invoice List -- กรอกแค่ TIV number + Amount ก็ครบ: Branch Dr. / GRN / Tax Invoice Date ไม่ได้กรอก = Auto ตาม Default
#  Branch Dr. = Default Dr. ต้นทาง (Tab 1) | GRN = Running ตามลำดับ | Tax Invoice Date = วันที่ของแถวบน (ที่กรอกไว้) -> ไม่มี = วันที่ใบกำกับล่าสุดที่ Add -> ไม่มี = Receive Date
# usage: python patch_vatcontroller_qagl_taxgrid_v5.py <in> <out>
import sys
src, dst = sys.argv[1], sys.argv[2]
txt = open(src, 'rb').read().decode('utf-8')
def rep(old, new):
    global txt
    assert txt.count(old) == 1, (txt.count(old), old[:90])
    txt = txt.replace(old, new)

# 1) buildItem รับ defDate
rep("const qaGlBuildItem = (r, seq) => {", "const qaGlBuildItem = (r, seq, defDate) => {")
rep("const date = qaGlParseDateAny(r.date); const tiv = qaGlCl(r.tiv);", "const date = qaGlParseDateAny(r.date) || defDate || null; const tiv = qaGlCl(r.tiv);")

# 2) Memo: ส่งวันที่ Default (แถวบน -> Add ล่าสุด -> Receive Date)
rep("    qaGlGrid.forEach((r, i) => { const b = qaGlBuildItem(r, `g${i}`); if (!b.item || seen.has(b.item.tiv)) return; seen.add(b.item.tiv); out.push({ ...b.item, id: `grid-${r.id}` }); });",
    "    let prevDate = qaGlParseDateAny(qaGlLastDateRef.current) || qaGlParseDateAny(quickActionReceiveDate) || null; // MARKER_QA_GL_TAXGRID_V5 -- Default วันที่\n    qaGlGrid.forEach((r, i) => { const b = qaGlBuildItem(r, `g${i}`, prevDate); const d0 = qaGlParseDateAny(r.date); if (d0) prevDate = d0; if (!b.item || seen.has(b.item.tiv)) return; seen.add(b.item.tiv); out.push({ ...b.item, id: `grid-${r.id}` }); });")
rep("}, [qaGlGrid, qaGlTivList, qaGlBranchDr, qaGlBranchCr, qaGlCpcDr, qaGlAccDr, qaGlSubDr, qaGlCpcCr, qaGlAccCr, qaGlSubCr]); // eslint-disable-line react-hooks/exhaustive-deps",
    "}, [qaGlGrid, qaGlTivList, qaGlBranchDr, qaGlBranchCr, qaGlCpcDr, qaGlAccDr, qaGlSubDr, qaGlCpcCr, qaGlAccCr, qaGlSubCr, quickActionReceiveDate]); // eslint-disable-line react-hooks/exhaustive-deps")

# 3) Placeholder วันที่ในช่อง = วันที่ Default ของแถวนั้น
rep("                      const rcSel = qaGlSelRect(qaGlSel);\n",
"""                      const rcSel = qaGlSelRect(qaGlSel);
                      const defDateIso = (() => { for (let q = gi - 1; q >= 0; q--) { const d1 = qaGlParseDateAny(qaGlGrid[q].date); if (d1) return d1; } return qaGlParseDateAny(qaGlLastDateRef.current) || qaGlParseDateAny(quickActionReceiveDate) || ''; })(); // MARKER_QA_GL_TAXGRID_V5
                      const defDateTxt = defDateIso ? `${defDateIso.slice(8, 10)}/${defDateIso.slice(5, 7)}/${defDateIso.slice(0, 4)}` : 'วว/ดด/ปปปป';
""")
rep("{cell(1, 'วว/ดด/ปปปป')}", "{cell(1, defDateTxt)}")
open(dst, 'wb').write(txt.encode('utf-8'))
print('ok')
