# -*- coding: utf-8 -*-
"""patch_vatwatchlist_type_abf_back_v1  (BACKEND  src\\app.js)
Popvat A/B/F -> status type_a/type_b/type_f ใน vat_watchlist_report
 1) replace_bu (Upload Incomplete ใหม่): เก็บแถว type_* ไว้ (TEMP table) ไม่ลบ ไม่ซ้ำ -- ถ้าใบกำกับเดียวกันมาในไฟล์ใหม่ ใช้แถว type_* เดิมแทน
 2) sync_draft_status: ไม่แตะแถว type_* (ไม่ดันเป็น draft / ไม่ทำ Aging = Accept)
 3) aging_summary: ไม่นับแถว type_*
ต้องรัน add_type_receive_date_to_vat_watchlist_report.sql ก่อน แล้ว Restart-Service fastapn-backend
รันบน Server ที่โฟลเดอร์ backend (มี src\\app.js)
"""
import os, shutil, sys
TARGET = os.path.join("src", "app.js")
MARKER = "APP_TYPE_ABF_STATUS_V1"
E = []
E.append(('''    const keepSendFp = await client.query("SELECT bu, invoice_ref, supplier_code FROM vat_watchlist_report WHERE bu = ANY($1::text[]) AND status = 'send_fp'", [bus]);
''', '''    const keepSendFp = await client.query("SELECT bu, invoice_ref, supplier_code FROM vat_watchlist_report WHERE bu = ANY($1::text[]) AND status = 'send_fp'", [bus]);
    // MARKER_APP_TYPE_ABF_STATUS_V1 -- เก็บแถว Popvat Type A/B/F ไว้ก่อนลบ (ไม่ถูกล้างเมื่อ Upload Incomplete ใหม่)
    await client.query("CREATE TEMP TABLE _keep_type ON COMMIT DROP AS SELECT * FROM vat_watchlist_report WHERE bu = ANY($1::text[]) AND status IN ('type_a','type_b','type_f')", [bus]);
''', 1))
E.append(('''    await client.query("COMMIT");
    res.json({ success: true, deleted_bu: bus, inserted: rows.length });''', '''    // MARKER_APP_TYPE_ABF_STATUS_V1 -- คืนแถว Type A/B/F (ตัดแถว pending ใหม่ที่ Key ซ้ำออก แล้วใส่แถวเดิมกลับพร้อม id/สถานะ/วันที่ใช้สิทธิ์)
    const keepTypeCnt = await client.query("SELECT COUNT(*)::int AS n FROM _keep_type");
    if (keepTypeCnt.rows[0].n > 0) {
      await client.query("DELETE FROM vat_watchlist_report n USING _keep_type k WHERE n.bu = k.bu AND n.invoice_ref = k.invoice_ref AND n.supplier_code IS NOT DISTINCT FROM k.supplier_code");
      await client.query("INSERT INTO vat_watchlist_report SELECT * FROM _keep_type");
    }
    await client.query("COMMIT");
    res.json({ success: true, deleted_bu: bus, inserted: rows.length, kept_type: keepTypeCnt.rows[0].n });''', 1))
E.append(("         AND r.status != 'draft'\n", "         AND r.status NOT IN ('draft', 'type_a', 'type_b', 'type_f') -- MARKER_APP_TYPE_ABF_STATUS_V1\n", 1))
E.append(("         AND r.aging_label != 'Accept'\n", "         AND r.aging_label != 'Accept'\n         AND r.status NOT IN ('type_a', 'type_b', 'type_f') -- MARKER_APP_TYPE_ABF_STATUS_V1\n", 1))
E.append(("""       FROM vat_watchlist_report
       GROUP BY bu, aging_label""", """       FROM vat_watchlist_report
       WHERE status NOT IN ('type_a', 'type_b', 'type_f') -- MARKER_APP_TYPE_ABF_STATUS_V1
       GROUP BY bu, aging_label""", 1))

def main():
    with open(TARGET, "r", encoding="utf-8", newline="") as f: src = f.read()
    bom = src.startswith("﻿")
    if MARKER in src: print("SKIP: patch นี้ถูกใช้แล้ว (%s)" % MARKER); return
    crlf = "\r\n" in src
    s = src.replace("\r\n", "\n")
    for a, _, n in E:
        if s.count(a) != n: print("ERROR: anchor พบ %d ครั้ง (ต้อง %d) - ไม่เขียนไฟล์\n%s" % (s.count(a), n, a[:90])); sys.exit(1)
    for a, b, n in E: s = s.replace(a, b)
    for o, c in ("{}", "()", "[]"):
        da = sum((x.count(o) - x.count(c)) * n for x, _, n in E); dn = sum((y.count(o) - y.count(c)) * n for _, y, n in E)
        if da != dn: print("ERROR: bracket %s%s ไม่สมดุล - ไม่เขียนไฟล์" % (o, c)); sys.exit(1)
    if crlf: s = s.replace("\n", "\r\n")
    shutil.copyfile(TARGET, TARGET + ".bak")
    with open(TARGET, "w", encoding="utf-8-sig" if bom else "utf-8", newline="") as f: f.write(s)
    print("OK: patched ->", TARGET)
main()
