# -*- coding: utf-8 -*-
# patch: Draft Monitor -- แถว fu-draft (Over Period) แสดงสีจางแบบ Disable (มีแต่ไม่ Active) และ Receive Date / Acc Date แสดงเป็นเดือนของ Period (เช่น 10-2026)
#        (แสดงผลอย่างเดียว ไม่แก้ข้อมูลในฐานข้อมูล -- แถวเก่าที่ยังบันทึกเดือนเดิมจะเห็นเป็นเดือน Period)
import sys
p = sys.argv[1]; o = sys.argv[2]
s = open(p, encoding='utf-8-sig').read()
def rep(a, b, n=2):
    global s
    assert s.count(a) == n, (s.count(a), a[:80])
    s = s.replace(a, b)
helper = """const vatShiftYm = (ym, n) => {"""
assert s.count(helper) == 1
s = s.replace(helper, """// MARKER_DRAFTMONITOR_FU_DISPLAY_V1 -- แถว fu-draft: ถ้าวันที่ไม่อยู่ในเดือนของ row.period (MM-YYYY) ให้แสดงเป็นเดือนนั้น (วันที่ 15 คงเดิม / อื่นๆ = วันสุดท้ายของเดือน)
const vatFuDisplayDate = (row, val) => {
  try {
    if (!row || row.status !== 'fu-draft' || !val) return val;
    const pm = /^(\\d{2})-(\\d{4})$/.exec(String(row.period || '').trim()); if (!pm) return val;
    const py = Number(pm[2]); const pmo = Number(pm[1]);
    const t = String(val).trim(); let y; let m; let d;
    let mm = /^(\\d{4})-(\\d{2})-(\\d{2})/.exec(t);
    if (mm) { y = +mm[1]; m = +mm[2]; d = +mm[3]; } else {
      mm = /^(\\d{1,2})-([A-Za-z]{3})-(\\d{2,4})$/.exec(t); const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
      if (!mm || !MON[mm[2].toLowerCase()]) return val; d = +mm[1]; m = MON[mm[2].toLowerCase()]; y = +mm[3] < 100 ? 2000 + +mm[3] : +mm[3];
    }
    if (y === py && m === pmo) return val;
    const day = d === 15 ? 15 : new Date(py, pmo, 0).getDate();
    return `${py}-${String(pmo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  } catch (_) { return val; }
};
const vatFuRowStyle = (row) => (row && row.status === 'fu-draft' ? { opacity: 0.5, background: '#f4f5f7' } : {});
""" + helper)
rep("<tr key={row.id} title={draftPopvatTooltip(row)} style={{ borderTop: '0.5px solid #e8e8e8' }}>",
    "<tr key={row.id} title={draftPopvatTooltip(row)} style={{ borderTop: '0.5px solid #e8e8e8', ...vatFuRowStyle(row) }}>")
rep("<tr key={row.id} style={{ borderTop: '0.5px solid #e8e8e8', background: rowBgFP }}>",
    "<tr key={row.id} style={{ borderTop: '0.5px solid #e8e8e8', background: rowBgFP, ...vatFuRowStyle(row) }}>")
rep("<tr key={row.id} style={{ borderTop: '0.5px solid #e8e8e8', background: bgAdiFP }}>",
    "<tr key={row.id} style={{ borderTop: '0.5px solid #e8e8e8', background: bgAdiFP, ...vatFuRowStyle(row) }}>")
rep("? (formatQuickActionReceiveDateText(row[c.key]) || '')",
    "? (formatQuickActionReceiveDateText(c.key === 'receive_date' ? vatFuDisplayDate(row, row[c.key]) : row[c.key]) || '')")
rep("{c.key === 'acc_date' ? (formatDateDDMMMYY(row[c.key]) || '')",
    "{c.key === 'acc_date' ? (formatDateDDMMMYY(vatFuDisplayDate(row, row[c.key])) || '')")
open(o, 'w', encoding='utf-8-sig', newline='').write(s)
