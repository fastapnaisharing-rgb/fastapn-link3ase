-- ============================================================================
-- FastAPN Link3ase - แก้ข้อมูล Popvat Cancel ที่ Receipt Date ผิดเดือน (01-Oct-89 ทั้งที่ Period = SEP-26)
-- สาเหตุ: เดิมโค้ดสร้าง Sentinel "01-<เดือนปัจจุบันของเครื่อง>-89" ไม่ได้ใช้เดือนของ Period ที่เปิดอยู่
--         (แก้โค้ดแล้ว VatController.js.bak55) -- สคริปต์นี้แก้เฉพาะข้อมูลเก่าที่บันทึกไปแล้ว
-- ตาราง: vat_upload_popvatdraft   เงื่อนไข: status = 'draft' เท่านั้น (ยังไม่ Upload) + วันที่เป็นรูปแบบ 01-Mon-89
-- กติกา: เดือนที่ถูกต้อง = เดือนจากคอลัมน์ period (รูปแบบ MM-YYYY) เช่น 09-2026 -> 01-Sep-89
-- วิธีรัน: pgAdmin / psql ทีละขั้น (ขั้น 0 -> 1 -> 2 -> 3) ห้ามข้ามขั้น 1 (Preview)
-- ============================================================================

-- ขั้น 0) ตรวจชนิดคอลัมน์ (ต้องเป็น text / character varying ถึงใช้สคริปต์นี้ได้)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'vat_upload_popvatdraft'
  AND column_name IN ('receipt_date', 'tax_invoice_date', 'period', 'status', 'action');

-- ขั้น 1) Preview: แถวที่จะถูกแก้ (ตรวจดูก่อน ว่าตรงกับที่เห็นใน Draft Monitor)
SELECT id, bu, period, draft_id, grt_number, action, status,
       receipt_date,
       '01-' || (ARRAY['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])[split_part(period, '-', 1)::int] || '-89' AS receipt_date_ใหม่,
       tax_invoice_date
FROM vat_upload_popvatdraft
WHERE status = 'draft'
  AND period ~ '^[0-9]{2}-[0-9]{4}$'
  AND receipt_date ~ '^01-[A-Za-z]{3}-89$'
  AND receipt_date <> '01-' || (ARRAY['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])[split_part(period, '-', 1)::int] || '-89'
ORDER BY id;

-- ขั้น 2) สำรองแถวที่จะแก้ไว้ก่อน (ถ้าอยากย้อนกลับ) แล้วแก้ใน Transaction
CREATE TABLE IF NOT EXISTS bak_popvatdraft_receipt_date_20261001 AS
SELECT * FROM vat_upload_popvatdraft
WHERE status = 'draft'
  AND period ~ '^[0-9]{2}-[0-9]{4}$'
  AND (receipt_date ~ '^01-[A-Za-z]{3}-89$' OR tax_invoice_date ~ '^01-[A-Za-z]{3}-89$');

BEGIN;

UPDATE vat_upload_popvatdraft
SET receipt_date = '01-' || (ARRAY['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])[split_part(period, '-', 1)::int] || '-89'
WHERE status = 'draft'
  AND period ~ '^[0-9]{2}-[0-9]{4}$'
  AND receipt_date ~ '^01-[A-Za-z]{3}-89$'
  AND receipt_date <> '01-' || (ARRAY['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])[split_part(period, '-', 1)::int] || '-89';

-- Tax Invoice Date ที่ใช้ Sentinel เป็นค่าสำรอง (กรณี Invoice ไม่มี Payment Date) ก็แก้ให้ตรงเดือน Period เหมือนกัน
UPDATE vat_upload_popvatdraft
SET tax_invoice_date = '01-' || (ARRAY['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])[split_part(period, '-', 1)::int] || '-89'
WHERE status = 'draft'
  AND period ~ '^[0-9]{2}-[0-9]{4}$'
  AND tax_invoice_date ~ '^01-[A-Za-z]{3}-89$'
  AND tax_invoice_date <> '01-' || (ARRAY['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])[split_part(period, '-', 1)::int] || '-89';

-- ขั้น 3) ตรวจผลก่อนยืนยัน: ต้องไม่เหลือแถวที่เดือนไม่ตรง Period (ผลลัพธ์ = 0 แถว)
SELECT count(*) AS ยังผิดอยู่
FROM vat_upload_popvatdraft
WHERE status = 'draft'
  AND period ~ '^[0-9]{2}-[0-9]{4}$'
  AND (receipt_date ~ '^01-[A-Za-z]{3}-89$' OR tax_invoice_date ~ '^01-[A-Za-z]{3}-89$')
  AND (receipt_date <> '01-' || (ARRAY['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])[split_part(period, '-', 1)::int] || '-89'
       OR (tax_invoice_date ~ '^01-[A-Za-z]{3}-89$' AND tax_invoice_date <> '01-' || (ARRAY['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])[split_part(period, '-', 1)::int] || '-89'));

-- ถ้าผลถูกต้อง รัน:   COMMIT;
-- ถ้าไม่ถูกต้อง รัน:  ROLLBACK;
