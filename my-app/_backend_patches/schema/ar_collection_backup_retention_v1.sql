-- ════════════════════════════════════════════════════════════════════
-- ar_collection_backup_retention_v1.sql
-- Retention ของ vat_backup_tax_invoice (เฉพาะ source_type='ar_collection_match')
-- Trigger ปิด VAT Period (POST /api/vat/period/close) -> Stamp expired_date ให้แถวที่ยัง pending
-- ครบ ar_collection_backup_retention_days วันหลัง Stamp -> Cron ลบถาวร (DELETE)
-- รันครั้งเดียวบน PostgreSQL (Idempotent — รันซ้ำได้)
-- ════════════════════════════════════════════════════════════════════

-- 1) Column เก็บเวลาที่ถูก Stamp ว่า "หมดอายุ" (ตอนปิด VAT Period ที่ยังไม่ Match ได้)
ALTER TABLE vat_backup_tax_invoice ADD COLUMN IF NOT EXISTS expired_date TIMESTAMPTZ;

-- 2) Index ให้ Cron Purge หาแถวที่ถึงกำหนดได้เร็ว (เฉพาะ Source ของ AR_Collection เท่านั้น)
CREATE INDEX IF NOT EXISTS idx_vat_backup_tax_invoice_ar_expired
  ON vat_backup_tax_invoice (expired_date)
  WHERE source_type = 'ar_collection_match' AND expired_date IS NOT NULL;

-- 3) ค่าตั้ง: จำนวนวันเก็บหลัง Stamp expired_date (ปรับได้โดยไม่ต้องแก้โค้ด เหมือน tax_close_retention_days)
INSERT INTO system_settings (key, value, updated_by, updated_at)
VALUES ('ar_collection_backup_retention_days', '30', 'system', NOW())
ON CONFLICT (key) DO NOTHING;
