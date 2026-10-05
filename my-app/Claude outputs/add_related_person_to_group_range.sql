-- เพิ่มคอลัมน์ related_person ในตาราง vat_watchlist_bu_group_range
-- รันทีละ Step ใน DB Client (Production) -- ต้องรัน "ก่อน" Deploy Frontend ใหม่

-- STEP 1: ดูโครงสร้างตารางและข้อมูลปัจจุบัน (ยังไม่เปลี่ยนอะไร)
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'vat_watchlist_bu_group_range'
ORDER BY ordinal_position;

SELECT COUNT(*) AS total_rows FROM vat_watchlist_bu_group_range;

-- STEP 2: สำรองตารางเดิมทั้งก้อน
CREATE TABLE IF NOT EXISTS vat_watchlist_bu_group_range_bak_20261002 AS
SELECT * FROM vat_watchlist_bu_group_range;

-- STEP 3: เพิ่มคอลัมน์ (ว่างได้ ไม่กระทบแถวเดิม รันซ้ำได้ปลอดภัย)
ALTER TABLE vat_watchlist_bu_group_range
  ADD COLUMN IF NOT EXISTS related_person TEXT;

-- STEP 4: ตรวจผล -- ต้องเห็นคอลัมน์ related_person และจำนวนแถวเท่า STEP 1
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'vat_watchlist_bu_group_range'
ORDER BY ordinal_position;

SELECT COUNT(*) AS total_rows FROM vat_watchlist_bu_group_range;

-- (ถ้าต้องย้อนกลับ) ลบคอลัมน์ที่เพิ่ม -- ใช้เฉพาะกรณีจำเป็น
-- ALTER TABLE vat_watchlist_bu_group_range DROP COLUMN IF EXISTS related_person;
