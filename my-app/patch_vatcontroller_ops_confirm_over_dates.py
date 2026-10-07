# -*- coding: utf-8 -*-
# patch: Simple Input Ops -> Confirm แถว Over (fu-draft) ปรับ Receive Date / ADI acc_date / adi_period / period ให้เป็นเดือนถัดไปของ Period ด้วย
#        (เดิมแก้แค่ period ของ Simple) -- Asset (วันที่ 15) คงวันที่ 15 / อื่นๆ = วันสุดท้ายของเดือน; เรียกซ้ำได้ ไม่เลื่อนซ้ำ (คำนวณจาก overPeriodText ตรงๆ)
import sys
p = sys.argv[1]; o = sys.argv[2]
s = open(p, encoding='utf-8-sig').read()
def rep(a, b):
    global s
    assert s.count(a) == 1, (s.count(a), a[:80])
    s = s.replace(a, b)
rep("      const overPeriodText = popvatPeriodMMYYYY(vatShiftYm(cfg.effMonth, 1));\n",
"""      const overPeriodText = popvatPeriodMMYYYY(vatShiftYm(cfg.effMonth, 1));
      // MARKER_OPS_CONFIRM_OVER_DATES_V1 -- วันที่ของแถว Over = เดือนของ overPeriodText (Asset วันที่ 15 / อื่นๆ วันสุดท้ายของเดือน)
      const overYm = (() => { const mm = String(overPeriodText || '').split('-'); return mm.length === 2 ? `${mm[1]}-${mm[0]}` : null; })();
      const overDateFor = (cur) => { const m = /^(\\d{4})-(\\d{2})-(\\d{2})/.exec(String(cur || '').trim()); if (!m || !overYm) return null; const [yy, mo] = overYm.split('-').map(Number); const day = Number(m[3]) === 15 ? 15 : new Date(yy, mo, 0).getDate(); return `${overYm}-${String(day).padStart(2, '0')}`; };
      const overAdiPeriod = overYm ? `${['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][Number(overYm.slice(5)) - 1]}-${overYm.slice(2, 4)}` : null;
""")
rep("""body: JSON.stringify({ status: vatDraftStatus(g.over), tax_invoice_number: g.grn, ...(g.over ? { period: overPeriodText } : {}) }) });
          done.push({ url: `/vat_simpleinputdraft/${r.id}`, prev: { status: r.status || 'pre-draft', tax_invoice_number: r.tax_invoice_number || '', ...(g.over ? { period: r.period || null } : {}) } });""",
"""body: JSON.stringify({ status: vatDraftStatus(g.over), tax_invoice_number: g.grn, ...(g.over ? { period: overPeriodText } : {}), ...((g.over && overDateFor(r.receive_date)) ? { receive_date: overDateFor(r.receive_date) } : {}) }) });
          done.push({ url: `/vat_simpleinputdraft/${r.id}`, prev: { status: r.status || 'pre-draft', tax_invoice_number: r.tax_invoice_number || '', ...(g.over ? { period: r.period || null } : {}), ...((g.over && overDateFor(r.receive_date)) ? { receive_date: r.receive_date } : {}) } });""")
rep("""body: JSON.stringify({ status: vatDraftStatus(aOver) }) });
        done.push({ url: `/vat_adi_transferdraft/${r.id}`, prev: { status: r.status || 'pre-draft' } });""",
"""body: JSON.stringify({ status: vatDraftStatus(aOver), ...(aOver ? { period: overPeriodText, ...(overAdiPeriod ? { adi_period: overAdiPeriod } : {}), ...(overDateFor(r.acc_date) ? { acc_date: overDateFor(r.acc_date) } : {}) } : {}) }) });
        done.push({ url: `/vat_adi_transferdraft/${r.id}`, prev: { status: r.status || 'pre-draft', ...(aOver ? { period: r.period || null, adi_period: r.adi_period || null, acc_date: r.acc_date || null } : {}) } });""")
open(o, 'w', encoding='utf-8-sig', newline='').write(s)
