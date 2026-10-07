# -*- coding: utf-8 -*-
# Patch v7: (1) วันที่ Default ของแถว = วันที่ที่กรอกไว้ที่ Tab 1 (Tax invoice Date) ก่อน -> แถวบน -> Add ล่าสุด -> Receive Date
#           (2) วันที่ในตารางแสดงเป็น dd-Mmm-yyyy (เช่น 07-Sep-2026) ไม่กำกวมกับ MM/DD ของ Tab 1 | รับพิมพ์/วางได้ทั้ง d/m/yyyy, yyyy-mm-dd, dd-Mmm-yyyy (พ.ศ. ได้)
# usage: python patch_vatcontroller_qagl_taxgrid_v7.py <in> <out>
import sys
src, dst = sys.argv[1], sys.argv[2]
txt = open(src, 'rb').read().decode('utf-8')
def rep(old, new):
    global txt
    assert txt.count(old) == 1, (txt.count(old), old[:90])
    txt = txt.replace(old, new)

# Parse / detect dd-Mmm-yyyy
rep("  const qaGlIsDateLike = (x) => /^\\d{1,2}[\\/\\-]\\d{1,2}[\\/\\-]\\d{4}/.test(qaGlCl(x)) || /^\\d{4}-\\d{2}-\\d{2}/.test(qaGlCl(x));",
    "  const qaGlIsDateLike = (x) => /^\\d{1,2}[\\/\\-]\\d{1,2}[\\/\\-]\\d{4}/.test(qaGlCl(x)) || /^\\d{4}-\\d{2}-\\d{2}/.test(qaGlCl(x)) || /^\\d{1,2}[\\- ][A-Za-z]{3}[\\- ]\\d{2,4}/.test(qaGlCl(x)); // MARKER_QA_GL_TAXGRID_V7")
rep("return `${y}${s2.slice(4, 10)}`; } return amagnoParseDate(s2); };",
    "return `${y}${s2.slice(4, 10)}`; } const mm = s2.match(/^(\\d{1,2})[\\- ]([A-Za-z]{3})[A-Za-z]*[\\- ](\\d{2,4})/); if (mm) { const mi = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(mm[2].toLowerCase()); if (mi >= 0) { let y2 = +mm[3]; if (y2 < 100) y2 += 2000; if (y2 > 2400) y2 -= 543; return `${y2}-${String(mi + 1).padStart(2, '0')}-${String(+mm[1]).padStart(2, '0')}`; } } return amagnoParseDate(s2); };\n  const qaGlFmtDate = (iso) => (iso && /^\\d{4}-\\d{2}-\\d{2}/.test(iso) ? `${iso.slice(8, 10)}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][parseInt(iso.slice(5, 7), 10) - 1]}-${iso.slice(0, 4)}` : '');")

# แสดงผลวันที่ในเซลล์
rep("return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : s2; }", "return iso ? qaGlFmtDate(iso) : s2; }")
rep("(k === 'date' && itAuto.date ? `${String(itAuto.date).slice(8, 10)}/${String(itAuto.date).slice(5, 7)}/${String(itAuto.date).slice(0, 4)}` : '')", "(k === 'date' && itAuto.date ? qaGlFmtDate(String(itAuto.date)) : '')")
rep("const defDateTxt = defDateIso ? `${defDateIso.slice(8, 10)}/${defDateIso.slice(5, 7)}/${defDateIso.slice(0, 4)}` : 'วว/ดด/ปปปป';", "const defDateTxt = defDateIso ? qaGlFmtDate(defDateIso) : 'วว-ดดด-ปปปป';")

# วันที่ Default: Tab 1 ก่อน
rep("let prevDate = qaGlParseDateAny(qaGlLastDateRef.current) || qaGlParseDateAny(quickActionReceiveDate) || null;",
    "let prevDate = qaGlParseDateAny(qaGlDate) || qaGlParseDateAny(qaGlLastDateRef.current) || qaGlParseDateAny(quickActionReceiveDate) || null;")
rep("qaGlSubCr, quickActionReceiveDate]); // eslint-disable-line react-hooks/exhaustive-deps", "qaGlSubCr, quickActionReceiveDate, qaGlDate]); // eslint-disable-line react-hooks/exhaustive-deps")
rep("return qaGlParseDateAny(qaGlLastDateRef.current) || qaGlParseDateAny(quickActionReceiveDate) || ''; })();", "return qaGlParseDateAny(qaGlDate) || qaGlParseDateAny(qaGlLastDateRef.current) || qaGlParseDateAny(quickActionReceiveDate) || ''; })();")
open(dst, 'wb').write(txt.encode('utf-8'))
print('ok')
