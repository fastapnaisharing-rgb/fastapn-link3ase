-- เพิ่มคอลัมน์ Simple Company ใน company_list (ไม่บังคับกรอก) -- รันก่อนใช้ช่อง Simple Company ในหน้า Business Unit
ALTER TABLE company_list ADD COLUMN IF NOT EXISTS "Simple Company" text;
