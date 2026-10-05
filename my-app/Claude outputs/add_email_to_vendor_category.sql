-- เพิ่มคอลัมน์ Email (หลายที่อยู่คั่นด้วย ;) ใน Vendor Category -- 1 ผู้ค้า + BU = 1 ช่อง
ALTER TABLE vendor_category ADD COLUMN IF NOT EXISTS "EMAIL" text;
