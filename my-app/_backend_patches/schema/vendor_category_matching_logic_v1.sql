-- MARKER_VENDORCAT_MATCHING_LOGIC_V1
-- เพิ่มคอลัมน์ "Matching Logic" ใน vendor_category: เก็บรูปแบบการ Match ใบกำกับภาษีของ Supplier (Code) นั้น
--   '1:1'          = Supplier ออกใบกำกับภาษีต่อใบแจ้งหนี้ (Match แถว Incomplete ทีละแถว)
--   'Payment Doc'  = Supplier ออกรวมตาม Payment Doc (รวม VAT ทุกแถวที่จ่ายด้วยเอกสารเดียวกัน)
--   ว่าง           = ยังไม่กำหนด -> ระบบใช้สถิติจากไฟล์ที่โยน แล้วเติมให้เมื่อมั่นใจ (ไม่ทับค่าที่มีอยู่)
-- รันก่อน Deploy Frontend ไม่งั้นการบันทึกใน Vendor Category จะ Error (ไม่มี Column)
ALTER TABLE vendor_category ADD COLUMN IF NOT EXISTS "Matching Logic" text;
