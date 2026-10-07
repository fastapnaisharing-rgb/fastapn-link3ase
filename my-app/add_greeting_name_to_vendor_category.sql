-- เพิ่มคอลัมน์ Greeting Name (ชื่อผู้รับ/คำเรียกในเมล เช่น "คุณนท", "พี่ตู่") ใน Vendor Category -- 1 ผู้ค้า + BU = 1 ช่อง
-- ใช้แทน {ชื่อผู้รับ} ในคำขึ้นต้นของเมล To Supplier (ว่าง = ใช้ชื่อผู้รับของ Config)
ALTER TABLE vendor_category ADD COLUMN IF NOT EXISTS "GREETING_NAME" text;
