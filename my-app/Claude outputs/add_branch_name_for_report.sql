-- ต้องรันก่อน Deploy Frontend (ฟอร์ม Edit Branch จะส่งค่าช่องนี้ไปบันทึกด้วย)
ALTER TABLE branch_list ADD COLUMN IF NOT EXISTS "Branch Name for Report" text;
