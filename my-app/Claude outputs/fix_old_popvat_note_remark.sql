-- fix_old_popvat_note_remark.sql
-- แก้รายการ Popvat A/B/F เก่า: (1) Remark "Part Used" -> "Partial Used"  (2) Note ยาว -> เหลือเฉพาะเหตุผล
-- ขั้นที่ 1: รัน PREVIEW ก่อน (ดูจำนวนแถวที่จะถูกแก้) ขั้นที่ 2: รันส่วน UPDATE ทั้งก้อน แล้วดูผลก่อน COMMIT

-- ===== PREVIEW =====
SELECT 'notes: remark Part Used' AS item, count(*) FROM vat_watchlist_notes WHERE remark LIKE '%Part Used%'
UNION ALL
SELECT 'notes: note ยาว (มี "เหตุผล:")', count(*) FROM vat_watchlist_notes
 WHERE note ~ '^\[[ABF] - [^\]]*\]' AND note LIKE '%เหตุผล: %'
UNION ALL
SELECT 'report: remark Part Used', count(*) FROM vat_watchlist_report WHERE remark LIKE '%Part Used%';

-- ===== UPDATE (รันทั้งก้อนด้านล่าง) =====
BEGIN;

-- Remark: Part Used -> Partial Used (Note + Report)
UPDATE vat_watchlist_notes
   SET remark = replace(remark, 'Part Used', 'Partial Used')
 WHERE remark LIKE '%Part Used%';

UPDATE vat_watchlist_report
   SET remark = replace(remark, 'Part Used', 'Partial Used')
 WHERE remark LIKE '%Part Used%';

-- Note ยาว (สร้างโดย Quick Action Popvat) -> เหลือเฉพาะบรรทัด "เหตุผล: ..." (ตัดคำว่า เหตุผล: ออก)
UPDATE vat_watchlist_notes
   SET note = (regexp_match(note, 'เหตุผล: ([^\n\r]*)'))[1]
 WHERE note ~ '^\[[ABF] - [^\]]*\]'
   AND note LIKE '%เหตุผล: %'
   AND (regexp_match(note, 'เหตุผล: ([^\n\r]*)'))[1] IS NOT NULL;

-- ตรวจผลก่อน COMMIT
SELECT invoice_ref, remark, note FROM vat_watchlist_notes
 WHERE remark LIKE '%Partial Used%' OR remark LIKE 'A - %' OR remark LIKE 'F - %'
 ORDER BY note_at DESC NULLS LAST LIMIT 20;

-- ถ้าผลถูกต้อง:  COMMIT;
-- ถ้าไม่ถูกต้อง: ROLLBACK;
