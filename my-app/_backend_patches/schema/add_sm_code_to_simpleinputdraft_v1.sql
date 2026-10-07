-- เก็บ SM-Code ของ Supplier ไว้ในแถว Simple Input Draft เพื่อเรียกใช้ซ้ำ (คอลัมน์ซ่อน: ไม่อยู่ใน Draft Monitor และไม่ถูกส่งออก)
-- supplier_code ยังเป็น NULL เสมอตามกติกาเดิม ไม่แตะต้อง
-- ต้องรัน SQL นี้บน Production ก่อน Deploy Frontend ใหม่ ไม่งั้นการบันทึก Draft จะ Error (column "sm_code" does not exist)
ALTER TABLE vat_simpleinputdraft ADD COLUMN IF NOT EXISTS sm_code text;
