-- vat_swap_draft_rows_v1.sql -- เก็บรายการใบกำกับรายแถวของ Draft (VAT Swap Finder) ตามรูปแบบ Input VAT Reconcile -- รันซ้ำได้
-- ต้องรัน vat_swap_drafts_v1.sql ก่อน
-- * tax_invoice_no (เลขที่ใบกำกับภาษี) กับ invoice_ref (เลขที่ใบแจ้งหนี้/Invoice Ref.) แยกคอลัมน์กัน -- invoice_ref ว่างได้
-- * เก็บเฉพาะแถวของ Tax Code ที่เลือกในงาน (ไม่เลือก = ทุก Tax Code) ; tax_type = ตัวอักษรหลังขีดของ Tax Code เช่น '321801-M SVAT7' -> M
-- * บันทึกซ้ำจะได้ batch ใหม่ ; แถวของ batch เก่าถูกล้างโดย purge_expired_vat_swap_drafts()

ALTER TABLE vat_swap_drafts ADD COLUMN IF NOT EXISTS rows_batch TEXT;

CREATE TABLE IF NOT EXISTS vat_swap_draft_rows (
  id               TEXT PRIMARY KEY,              -- draft_id|batch|ลำดับ
  draft_id         TEXT NOT NULL,                 -- = vat_swap_drafts.id
  batch            TEXT NOT NULL,                 -- = vat_swap_drafts.rows_batch ของรอบที่บันทึก
  username         TEXT,
  file_name        TEXT,
  file_period      TEXT,                          -- YYYY-MM ของไฟล์ Input
  src_row          INTEGER,                       -- แถวในไฟล์ต้นทาง
  source           TEXT,                          -- Source (BTM/B2M/DOC/...)
  branch           TEXT,                          -- สาขา
  tax_invoice_date DATE,                          -- วันที่ใบกำกับภาษี
  tax_invoice_no   TEXT,                          -- เลขที่ใบกำกับภาษี
  invoice_ref      TEXT,                          -- เลขที่ใบแจ้งหนี้ / Invoice Ref. (ว่างได้)
  vendor_name      TEXT,
  tax_id           TEXT,
  vendor_branch    TEXT,
  ho               TEXT,
  tax_code         TEXT,                          -- เช่น 321801-M SVAT7 / T321801-N VAT7
  tax_type         TEXT,                          -- M / N / A / F / T
  vat_amount       NUMERIC(18,2),                 -- ภาษีซื้อ (เงินภาษี)
  base_amount      NUMERIC(18,2)                  -- มูลค่าสินค้า
);
CREATE INDEX IF NOT EXISTS idx_vsdr_draft ON vat_swap_draft_rows (draft_id, batch);
CREATE INDEX IF NOT EXISTS idx_vsdr_taxinv ON vat_swap_draft_rows (tax_invoice_no);
CREATE INDEX IF NOT EXISTS idx_vsdr_ref ON vat_swap_draft_rows (invoice_ref) WHERE invoice_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vsdr_code ON vat_swap_draft_rows (tax_code);

-- ฟังก์ชันล้าง: ลบ Draft ที่หมดอายุ + แถวรายการของ Draft นั้น + แถว batch เก่าที่ไม่ใช่รอบล่าสุด
-- (คืนค่า: จำนวนที่ล้างหรือจะล้าง แยกตามประเภท)
DROP FUNCTION IF EXISTS purge_expired_vat_swap_drafts(boolean);
CREATE OR REPLACE FUNCTION purge_expired_vat_swap_drafts(dry_run boolean DEFAULT true)
RETURNS TABLE(kind text, cnt bigint)
LANGUAGE plpgsql AS $$
DECLARE n_d bigint; n_r bigint; n_o bigint;
BEGIN
  SELECT count(*) INTO n_d FROM vat_swap_drafts d WHERE d.expires_at IS NOT NULL AND d.expires_at <= NOW();
  SELECT count(*) INTO n_r FROM vat_swap_draft_rows r
    WHERE r.draft_id IN (SELECT d.id FROM vat_swap_drafts d WHERE d.expires_at IS NOT NULL AND d.expires_at <= NOW());
  SELECT count(*) INTO n_o FROM vat_swap_draft_rows r
    WHERE NOT EXISTS (SELECT 1 FROM vat_swap_drafts d WHERE d.id = r.draft_id AND d.rows_batch = r.batch);
  IF NOT dry_run THEN
    DELETE FROM vat_swap_draft_rows r
     WHERE r.draft_id IN (SELECT d.id FROM vat_swap_drafts d WHERE d.expires_at IS NOT NULL AND d.expires_at <= NOW());
    DELETE FROM vat_swap_drafts d WHERE d.expires_at IS NOT NULL AND d.expires_at <= NOW();
    DELETE FROM vat_swap_draft_rows r
     WHERE NOT EXISTS (SELECT 1 FROM vat_swap_drafts d WHERE d.id = r.draft_id AND d.rows_batch = r.batch);
  END IF;
  kind := 'draft หมดอายุ'; cnt := n_d; RETURN NEXT;
  kind := 'แถวของ draft ที่หมดอายุ'; cnt := n_r; RETURN NEXT;
  kind := 'แถว batch เก่า/กำพร้า'; cnt := n_o; RETURN NEXT;
END;
$$;

-- ทดสอบก่อน (ไม่ลบจริง):  SELECT * FROM purge_expired_vat_swap_drafts(true);
-- ลบจริง:                 SELECT * FROM purge_expired_vat_swap_drafts(false);
-- ตั้งเวลา: pg_cron ทุกวัน 02:00  SELECT cron.schedule('purge-vat-swap-drafts','0 2 * * *',$$SELECT * FROM purge_expired_vat_swap_drafts(false)$$);
-- Backend (genericTable.js) ต้องเปิดตาราง vat_swap_draft_rows ด้วย (เหมือน vat_swap_drafts)
