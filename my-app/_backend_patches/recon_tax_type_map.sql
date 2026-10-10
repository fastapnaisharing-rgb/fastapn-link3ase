-- ตาราง Tax Type -> Account (Backend สร้าง+Seed ให้อัตโนมัติตอน Start; ไฟล์นี้ไว้รันเองได้/เพิ่ม Tax Type ใหม่)
CREATE TABLE IF NOT EXISTS recon_tax_type_map (
  tax_type text PRIMARY KEY, account text NOT NULL, grp text NOT NULL, label text,
  in_all_type boolean NOT NULL DEFAULT true, enabled boolean NOT NULL DEFAULT true, sort_no int NOT NULL DEFAULT 0);
INSERT INTO recon_tax_type_map (tax_type, account, grp, label, in_all_type, sort_no) VALUES
 ('N','11610752','Expense','Input N',true,0),('A','11610752','Expense','Input A',true,1),
 ('F','11610755','Asset','Input F',true,2),('T','11610755','Asset','Input T',true,3),
 ('M','11610751','Merchandise','Input M',false,4)
ON CONFLICT (tax_type) DO NOTHING;
-- ตัวอย่างเพิ่ม Tax Type ใหม่: INSERT INTO recon_tax_type_map (tax_type,account,grp,label,in_all_type,sort_no) VALUES ('X','1161xxxx','Expense','Input X',false,9);
