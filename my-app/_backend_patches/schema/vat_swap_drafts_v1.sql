-- vat_swap_drafts_v1.sql  (VAT Toolbox > VAT Swap Finder -- เก็บ Draft ชั่วคราวใน DB) -- รันซ้ำได้
-- * กดบันทึก  -> เก็บ Draft (expires_at = NULL จนกว่าจะ Export)
-- * กด Export -> Frontend ตั้ง exported_at = NOW(), expires_at = NOW() + 3 วัน
-- * purge_expired_vat_swap_drafts() ลบแถวที่ expires_at <= NOW() (ใช้ได้ทั้ง pg_cron และ Task Scheduler)
-- * Frontend ซ่อนรายการที่หมดอายุอยู่แล้ว ต่อให้ยังไม่ถูกลบจริงก็ไม่แสดง

CREATE TABLE IF NOT EXISTS vat_swap_drafts (
  id           TEXT PRIMARY KEY,                 -- = job.id ของ Swap Finder
  username     TEXT NOT NULL,
  name         TEXT,
  status       TEXT,
  last_month   TEXT,
  job          JSONB NOT NULL,                   -- ตัวงานทั้งก้อน (พารามิเตอร์ + ไฟล์ที่อ่านแล้ว + ผล)
  saved_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  exported_at  TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_vat_swap_drafts_user ON vat_swap_drafts (username, saved_at DESC);
CREATE INDEX IF NOT EXISTS idx_vat_swap_drafts_expires ON vat_swap_drafts (expires_at) WHERE expires_at IS NOT NULL;

CREATE OR REPLACE FUNCTION purge_expired_vat_swap_drafts(dry_run boolean DEFAULT true)
RETURNS TABLE(draft_id text, owner text, draft_name text, exported_at timestamptz, expires_at timestamptz)
LANGUAGE plpgsql AS $$
BEGIN
  IF dry_run THEN
    RETURN QUERY SELECT d.id, d.username, d.name, d.exported_at, d.expires_at
                   FROM vat_swap_drafts d WHERE d.expires_at IS NOT NULL AND d.expires_at <= NOW();
  ELSE
    RETURN QUERY DELETE FROM vat_swap_drafts d
                  WHERE d.expires_at IS NOT NULL AND d.expires_at <= NOW()
              RETURNING d.id, d.username, d.name, d.exported_at, d.expires_at;
  END IF;
END;
$$;

-- 1) ทดสอบก่อน (ไม่ลบจริง):   SELECT * FROM purge_expired_vat_swap_drafts(true);
-- 2) ลบจริง:                  SELECT * FROM purge_expired_vat_swap_drafts(false);
-- 3) ตั้งเวลา (เลือกอย่างใดอย่างหนึ่ง)
--    pg_cron (ทุกวัน 02:00):  SELECT cron.schedule('purge-vat-swap-drafts', '0 2 * * *', $$SELECT * FROM purge_expired_vat_swap_drafts(false)$$);
--    Task Scheduler:          psql -h <host> -U <user> -d <db> -c "SELECT * FROM purge_expired_vat_swap_drafts(false)"
-- 4) Backend (genericTable.js) ต้องเปิดให้ตาราง vat_swap_drafts ใช้งานได้ -- เหมือนตาราง timeline_watch (ต้อง Deploy Backend)
