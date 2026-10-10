-- fix_report_remark_remove_type_label.sql
-- ตัดชื่อประเภท (เช่น "B - Partial Used") ออกจาก Remark ใน vat_watchlist_report
-- ให้เหลือเฉพาะเหตุผล (ดึงจาก vat_watchlist_notes.remark ที่แก้เป็นเหตุผลแล้ว) ถ้าไม่มีเหตุผลให้เป็น NULL

-- ===== PREVIEW =====
SELECT r.id, r.invoice_ref, r.remark AS report_remark, n.remark AS note_remark
  FROM vat_watchlist_report r
  LEFT JOIN vat_watchlist_notes n
    ON n.bu = r.bu AND n.invoice_ref = r.invoice_ref AND n.supplier_code = r.supplier_code
 WHERE r.remark ~ '^[ABF] - (Partial Used|Submit with Condition|Expired Balance)\s*$';

-- ===== UPDATE =====
BEGIN;

UPDATE vat_watchlist_report r
   SET remark = NULLIF(trim(coalesce(
         (SELECT n.remark FROM vat_watchlist_notes n
           WHERE n.bu = r.bu AND n.invoice_ref = r.invoice_ref AND n.supplier_code = r.supplier_code
             AND n.remark !~ '^[ABF] - (Partial Used|Submit with Condition|Expired Balance)\s*$'
           LIMIT 1), '')), '')
 WHERE r.remark ~ '^[ABF] - (Partial Used|Submit with Condition|Expired Balance)\s*$';

-- ตรวจผล
SELECT id, invoice_ref, remark FROM vat_watchlist_report
 WHERE invoice_ref IN ('517010005711','517010005695');

-- ถูกต้อง: COMMIT;   ไม่ถูก: ROLLBACK;
