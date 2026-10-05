-- เพิ่มคอลัมน์ prefix_length (อ่านกี่ตำแหน่ง) ในตาราง vat_watchlist_related_person
-- ต้องรัน "ก่อน" ใช้หน้า Vat Config ใหม่ (รันซ้ำได้ปลอดภัย)
ALTER TABLE vat_watchlist_related_person
  ADD COLUMN IF NOT EXISTS prefix_length INTEGER;

-- ตรวจผล
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'vat_watchlist_related_person'
ORDER BY ordinal_position;
