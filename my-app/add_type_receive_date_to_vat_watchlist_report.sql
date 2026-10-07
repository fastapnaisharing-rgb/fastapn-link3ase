-- Popvat A/B/F -> สถานะ type_a / type_b / type_f ใน vat_watchlist_report.status
-- เพิ่มคอลัมน์ "วันที่ใช้สิทธิ์" (= Receive Date ตอน Popvat รูปแบบ DD-MMM-YY)
ALTER TABLE vat_watchlist_report ADD COLUMN IF NOT EXISTS type_receive_date text;

-- ตรวจว่ามี CHECK constraint บังคับค่า status หรือไม่ (ถ้ามีและไม่รวม type_a/type_b/type_f ต้องแก้ก่อนใช้งาน)
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'vat_watchlist_report'::regclass AND contype = 'c';
