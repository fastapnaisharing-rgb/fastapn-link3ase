# -*- coding: utf-8 -*-
"""
patch_global_search_filters_v1.py -- global_search รองรับ Filter (BU / Type / Period ชำระเงิน) โดยไม่ต้องพิมพ์คำค้น + meta ให้ Dropdown
เพิ่ม Query: bu=A,B | bus_type=X,Y ("(ว่าง)" = ว่าง) | sub_key=Type|||Sub,... | pay_from=YYYY-MM | pay_to=YYYY-MM | meta=1 (คืน {rows} ของรายการที่มีวันที่ชำระ ตาม status) | summary=1 (เมื่อไม่มี q: คืน {summary:[สรุปต่อ BU+Supplier]})
ถ้าไม่พิมพ์ q (<2 ตัวอักษร) แต่มี Filter อย่างน้อย 1 ตัว -> ดึงตาม Filter ล้วน (เฉพาะแถวที่มีวันที่ชำระเงิน)
วิธีรัน (บน Server): วางไฟล์นี้โฟลเดอร์เดียวกับ app.js -> python patch_global_search_filters_v1.py -> Restart-Service fastapn-backend
Idempotent: มี MARKER_APP_VAT_GLOBAL_SEARCH_FILTERS_V1 แล้วข้าม | สำรอง app.js.bak_global_search_filters_v1
"""
import os, shutil, subprocess, sys

MARKER = 'MARKER_APP_VAT_GLOBAL_SEARCH_FILTERS_V1'
TARGET = sys.argv[1] if len(sys.argv) > 1 else 'app.js'

OLD_Q = '    if (q.length < 2) return res.json([]);\n    const values = [];\n    const statusSql = status ? (values.push(status), ` AND status = $${values.length}`) : "";\n'
NEW_Q = '''    // ''' + MARKER + ''' -- Filter BU / Type / Period (YYYY-MM ของ payment_date) + meta สำหรับ Dropdown
    const csv = (v) => String(v || "").split(",").map((t) => t.trim()).filter(Boolean);
    const fBu = csv(req.query.bu); const fType = csv(req.query.bus_type); const fSub = csv(req.query.sub_key); // sub_key = 'Type|||SubType' (เลือกระดับ Sub Type)
    const ymOk = (v) => /^\\d{4}-\\d{2}$/.test(String(v || ""));
    const payFrom = ymOk(req.query.pay_from) ? String(req.query.pay_from) : ""; const payTo = ymOk(req.query.pay_to) ? String(req.query.pay_to) : "";
    if (String(req.query.meta || "") === "1") {
      const mv = []; const ms = status ? (mv.push(status), ` AND status = $${mv.length}`) : "";
      const mr = await pool.query(`SELECT bu, COALESCE(NULLIF(TRIM(bus_type), ''), '(ว่าง)') AS bus_type, COALESCE(NULLIF(TRIM(sub_type), ''), '(ว่าง)') AS sub_type, to_char(payment_date::date, 'YYYY-MM') AS ym, COUNT(*)::int AS n FROM vat_watchlist_report WHERE payment_date IS NOT NULL${ms} GROUP BY 1, 2, 3, 4`, mv);
      return res.json({ rows: mr.rows });
    }
    const hasFilter = fBu.length > 0 || fType.length > 0 || fSub.length > 0 || !!payFrom || !!payTo;
    if (q.length < 2 && !hasFilter) return res.json([]);
    const values = [];
    let statusSql = status ? (values.push(status), ` AND status = $${values.length}`) : "";
    if (fBu.length) { values.push(fBu); statusSql += ` AND bu = ANY($${values.length}::text[])`; }
    if (fType.length || fSub.length) { // Type เต็ม OR Sub Type ที่เลือก
      const tX = "COALESCE(NULLIF(TRIM(bus_type), ''), '(ว่าง)')"; const sX = "COALESCE(NULLIF(TRIM(sub_type), ''), '(ว่าง)')"; const parts = [];
      if (fType.length) { values.push(fType); parts.push(`${tX} = ANY($${values.length}::text[])`); }
      if (fSub.length) { values.push(fSub); parts.push(`(${tX} || '|||' || ${sX}) = ANY($${values.length}::text[])`); }
      statusSql += ` AND (${parts.join(" OR ")})`;
    }
    if (payFrom) { values.push(payFrom); statusSql += ` AND to_char(payment_date::date, 'YYYY-MM') >= $${values.length}`; }
    if (payTo) { values.push(payTo); statusSql += ` AND to_char(payment_date::date, 'YYYY-MM') <= $${values.length}`; }
    if (q.length < 2 && String(req.query.summary || "") === "1") { // สรุปต่อ BU+Supplier ฝั่ง Server (ไม่ต้องดึงทุกแถวมารวมที่หน้าจอ)
      const sr = await pool.query(`SELECT bu, supplier_code, MAX(vendor_name) AS vendor_name, COUNT(*)::int AS count, MIN(payment_date) AS min_pay, MAX(payment_date) AS max_pay, COALESCE(SUM(exp_amount), 0) AS exp_amount, COALESCE(SUM(exp_vat), 0) AS exp_vat, COALESCE(SUM(avg_amount), 0) AS avg_amount, COALESCE(SUM(avg_vat), 0) AS avg_vat FROM vat_watchlist_report WHERE payment_date IS NOT NULL${statusSql} GROUP BY bu, supplier_code ORDER BY bu, supplier_code LIMIT 5000`, values);
      return res.json({ summary: sr.rows });
    }
    if (q.length < 2) {
      const r0 = await pool.query(`SELECT * FROM vat_watchlist_report WHERE payment_date IS NOT NULL${statusSql} ORDER BY bu, supplier_code, invoice_ref LIMIT ${limit}`, values);
      return res.json(r0.rows);
    }
'''

def balance_ok(s):
    return s.count('{') == s.count('}') and s.count('(') == s.count(')')

def main():
    if not os.path.isfile(TARGET):
        print('ไม่พบไฟล์', TARGET); sys.exit(1)
    src = open(TARGET, encoding='utf-8').read()
    if MARKER in src:
        print('SKIP: มี', MARKER, 'แล้ว'); return
    if src.count(OLD_Q) != 1:
        print('ERROR: หา Anchor ใน global_search ไม่เจอ/เจอมากกว่า 1 จุด'); sys.exit(1)
    new = src.replace(OLD_Q, NEW_Q)
    if not balance_ok(new) and balance_ok(src):
        print('ERROR: Bracket ไม่สมดุลหลัง Patch'); sys.exit(1)
    bak = TARGET + '.bak_global_search_filters_v1'
    if not os.path.exists(bak):
        shutil.copy2(TARGET, bak)
    tmp = TARGET + '.tmp_patch.js'
    open(tmp, 'w', encoding='utf-8', newline='').write(new)
    try:
        subprocess.run(['node', '--check', tmp], check=True)
    except Exception as e:
        os.remove(tmp); print('ERROR: node --check ไม่ผ่าน', e); sys.exit(1)
    os.replace(tmp, TARGET)
    print('OK: Patch สำเร็จ ->', TARGET, '(สำรอง', bak + ')')
    print('ขั้นต่อไป: Restart-Service fastapn-backend')

main()
