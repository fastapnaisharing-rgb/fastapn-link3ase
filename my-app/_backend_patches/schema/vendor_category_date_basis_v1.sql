-- MARKER_VENDORCAT_DATE_BASIS_V1
-- เพิ่มคอลัมน์ "Date Basis" ใน vendor_category: ใบกำกับภาษีของ Supplier (Code) นี้ออกตามวันไหน
--   'Payment Date' = ออกตามวันที่ชำระเงิน (ค่าเริ่มต้นเมื่อว่าง)  -> เทียบวันที่ใบกำกับกับ Payment Date ห่างไม่เกิน 7 วัน
--   'Doc Date'     = ออกตามวันที่เอกสาร/ใบแจ้งหนี้              -> เทียบวันที่ใบกำกับกับ Doc Date ห่างไม่เกิน 7 วัน
--   ว่าง           = ใช้ Payment Date
-- รันก่อน Deploy Frontend ไม่งั้นการบันทึกใน Vendor Category จะ Error (ไม่มี Column)
ALTER TABLE vendor_category ADD COLUMN IF NOT EXISTS "Date Basis" text;
