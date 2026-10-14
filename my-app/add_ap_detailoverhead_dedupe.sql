-- =====================================================================
-- add_ap_detailoverhead_dedupe.sql  (รันใน pgAdmin DB fastapn-link3ase -- รันซ้ำได้)
-- กันเก็บข้อมูลซ้ำ: ลายนิ้วมือต่อแถว (row_hash) + ห้ามซ้ำภายใน COM + งวด + Account
-- ตารางต้องว่างอยู่ (ยังไม่เคยบันทึก) ถึงจะเพิ่ม NOT NULL ได้
-- =====================================================================
ALTER TABLE ap_detailoverhead ADD COLUMN IF NOT EXISTS row_hash VARCHAR(32);
CREATE UNIQUE INDEX IF NOT EXISTS uq_apdo_row_hash ON ap_detailoverhead (com, period, account_code, row_hash);
CREATE INDEX IF NOT EXISTS idx_apdo_row_hash ON ap_detailoverhead (com, account_code, row_hash);
