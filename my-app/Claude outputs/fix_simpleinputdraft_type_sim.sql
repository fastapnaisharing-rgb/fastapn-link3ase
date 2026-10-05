-- แก้ type_sim ของแถว Simple Input Ops (menu_source='sm-vat') ที่บันทึกไปก่อนแก้ Frontend แล้ว type_sim เป็น NULL
-- รันทีละ Step ใน DB Client (Production) -- ห้ามรันทั้งไฟล์รวดเดียวก่อนดูผล Step 1

-- STEP 1: ดูก่อนว่ามีกี่แถวที่ type_sim ว่าง (แยก BU / invoice_ref / status)
SELECT bu, invoice_ref, status, COUNT(*) AS n
FROM vat_simpleinputdraft
WHERE menu_source = 'sm-vat' AND (type_sim IS NULL OR type_sim = '')
GROUP BY bu, invoice_ref, status
ORDER BY bu, invoice_ref, status;

-- STEP 2: สำรองแถวที่จะแก้ (ตารางสำรองชั่วคราว)
CREATE TABLE IF NOT EXISTS vat_simpleinputdraft_bak_typesim_20261002 AS
SELECT * FROM vat_simpleinputdraft
WHERE menu_source = 'sm-vat' AND (type_sim IS NULL OR type_sim = '');

-- STEP 3: อัปเดต (แก้เงื่อนไข bu / invoice_ref / ค่า type_sim ให้ตรงกับที่ต้องการ)
-- ตัวอย่าง: Credit ของ OMT ที่ Rule3 = NNN (Create Journal/Interbranch/Book VAT Only = No/No/No)
BEGIN;
UPDATE vat_simpleinputdraft
SET type_sim = 'NNN'
WHERE menu_source = 'sm-vat'
  AND (type_sim IS NULL OR type_sim = '')
  AND bu = 'OMT'
  AND invoice_ref = 'Credit'
  AND status IN ('pre-draft', 'draft');
-- ตรวจจำนวนแถวที่ถูกแก้ให้ตรงกับ Step 1 ก่อน แล้วค่อย COMMIT (ถ้าไม่ตรงให้ ROLLBACK)
-- COMMIT;
-- ROLLBACK;

-- STEP 4: ตรวจผลหลัง COMMIT
SELECT bu, invoice_ref, type_sim, status, COUNT(*) AS n
FROM vat_simpleinputdraft
WHERE menu_source = 'sm-vat'
GROUP BY bu, invoice_ref, type_sim, status
ORDER BY bu, invoice_ref, type_sim, status;
