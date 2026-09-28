-- MARKER_DOCCOLLECTION_DOWNLOADED_AT_TRIGGER_V1 (2026-09-28)
-- เพิ่มคอลัมน์ downloaded_at ให้ doc_collection เพื่อใช้เป็น Trigger ของ Cron
-- Auto-Confirm Cross Check (MARKER_DOCCOLLECTION_AUTOCONFIRM_CRON_V1 ใน app.js)
--
-- รันครั้งเดียวบน Production DB "ก่อน" Deploy app.js เวอร์ชันใหม่ (ไม่งั้น Cron จะ Error
-- เพราะ Column ยังไม่มี)

ALTER TABLE doc_collection
  ADD COLUMN IF NOT EXISTS downloaded_at TIMESTAMP NULL;

COMMENT ON COLUMN doc_collection.downloaded_at IS
  'เวลาที่มีการ Download เอกสารนี้ออกไปครั้งล่าสุด (ทุกช่องทาง: Excel/PDF/รูปแนบ) — ใช้เป็น Trigger ของ Cron Auto-Confirm Cross Check หลังผ่านไป 6 ชม.';
