# -*- coding: utf-8 -*-
# patch: Draft เก่าที่ไม่มี sm_code -> จับด้วย Tax ID + สาขา; ถ้าไม่ตรงสาขาใช้ Tax ID อย่างเดียว; ถ้าได้หลาย SM-Code แสดงทุกตัวให้เลือก (ไม่ทิ้งเป็น "ไม่มี Code")
import sys
p = sys.argv[1]; o = sys.argv[2]
s = open(p, encoding='utf-8-sig').read()
a_start = s.index("          let code = String(r.sm_code || '').trim(); const nm0 = String(r.supplier_name || '').trim();")
a_end = s.index("        setQaGlDrRows(", a_start)
new = """          let code = String(r.sm_code || '').trim(); const nm0 = String(r.supplier_name || '').trim(); let cands = [];
          if (!code) { // Draft เก่าที่ยังไม่มี sm_code -> หาจาก Tax ID + สาขา (ข้อมูลของแถว Draft เอง)
            const tx = String(r.tax_id || '').trim(); const br = String(r.branch_no || '').trim();
            if (tx) {
              const pool = [...(addTaxInvoiceSmCodeListData || []), ...(smCodes || [])].filter((x) => String(x['Tax ID'] || '').trim() === tx);
              const byBr = br ? pool.filter((x) => String(x['Branch'] || '').trim() === br) : [];
              cands = [...new Set((byBr.length ? byBr : pool).map((x) => String(x['SM-Code'] || '').trim()).filter(Boolean))].slice(0, 8);
              if (cands.length === 1) { code = cands[0]; cands = []; }
            }
          }
          if (cands.length > 1) { cands.forEach((c) => { const cur = m.get(c) || { code: c, name: nm0, n: 1, sub: 'เลือกให้ตรง' }; m.set(c, cur); }); return; }
          const key = code || `name:${nm0}`; if (!code && !nm0) return;
          const cur = m.get(key) || { code, name: nm0, n: 0 };
          if (!cur.name) cur.name = nm0;
          cur.n += 1; m.set(key, cur);
        });
"""
s = s[:a_start] + new + s[a_end:]
open(o, 'w', encoding='utf-8-sig', newline='').write(s)
