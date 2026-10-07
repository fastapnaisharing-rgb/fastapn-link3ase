-- Over Period (สับท่อรัน GRN ไปเดือนถัดไป): เก็บสถานะต่อ BU
-- เปิด = Prefix ของเดือนถัดไป + ใช้เลขท่อ vat_grn_ov ; ปิด Period (POST /api/vat/period/close) แล้วระบบปลดเป็น false ให้เอง
ALTER TABLE company_list ADD COLUMN IF NOT EXISTS vat_over_period boolean NOT NULL DEFAULT false;
-- ตรวจว่ามีท่อเลข vat_grn_ov / vat_grn_prev อยู่แล้ว (ใช้โดย /close และ /reopen เดิม) -- ถ้ายังไม่มีให้เปิดบรรทัดล่างนี้
-- ALTER TABLE company_list ADD COLUMN IF NOT EXISTS vat_grn_ov integer NOT NULL DEFAULT 0;
