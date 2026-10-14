-- เพิ่มคอลัมน์ชนิด range (HO / FC) -- ใช้กับ BU CFM เท่านั้น (ว่าง = ไม่กำหนด)
ALTER TABLE vat_watchlist_bu_group_range ADD COLUMN IF NOT EXISTS range_type text;
