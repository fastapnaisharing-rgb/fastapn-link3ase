-- MARKER_FILE_STORAGE_SHAREPOINT_COLUMNS_V1
-- เพิ่มคอลัมน์สถานะ SharePoint ให้ file_storage (ใช้กับไฟล์รายงาน Input VAT Recon: module = 'vat-reconcile-report')
-- ใช้ใน pgAdmin (Query Tool) ครั้งเดียว -- รันซ้ำได้ ไม่พัง (IF NOT EXISTS)
-- ไม่แตะข้อมูลเดิมและไม่เปลี่ยน retention_days ของไฟล์ที่มีอยู่ (ไฟล์เดิมยังถาวรเหมือนเดิม)

BEGIN;

-- ── ข้อมูลตอนกด Confirm ส่ง ──
ALTER TABLE file_storage ADD COLUMN IF NOT EXISTS sp_url         TEXT;          -- ลิงก์ SharePoint ของไฟล์ (เปิดเป็น Excel บนเว็บ)
ALTER TABLE file_storage ADD COLUMN IF NOT EXISTS sp_sent_at     TIMESTAMPTZ;   -- วันเวลาที่กด Confirm ส่ง
ALTER TABLE file_storage ADD COLUMN IF NOT EXISTS sp_sent_by     TEXT;          -- username ผู้กดส่ง

-- ── สถานะจากการ Sync ภายหลัง (เฟสถัดไป: ปุ่ม Sync / สคริปต์ตามเวลา) ──
ALTER TABLE file_storage ADD COLUMN IF NOT EXISTS sp_exists      BOOLEAN;       -- NULL = ยังไม่เคยตรวจ, TRUE = พบใน SharePoint, FALSE = ไม่พบ (ถูกลบ/ย้าย)
ALTER TABLE file_storage ADD COLUMN IF NOT EXISTS sp_size        BIGINT;        -- ขนาดล่าสุดที่ตรวจพบ (bytes)
ALTER TABLE file_storage ADD COLUMN IF NOT EXISTS sp_modified_at TIMESTAMPTZ;   -- วันที่แก้ไขล่าสุดที่ตรวจพบ
ALTER TABLE file_storage ADD COLUMN IF NOT EXISTS sp_checked_at  TIMESTAMPTZ;   -- เวลาที่ตรวจสถานะล่าสุด

-- ── (มีใช้อยู่แล้วในโค้ดเดิมของ ie-simple: ลบเฉพาะไฟล์บน disk แต่เก็บแถวไว้) ──
ALTER TABLE file_storage ADD COLUMN IF NOT EXISTS file_removed_at TIMESTAMPTZ;

-- ── Index ช่วยหาไฟล์ที่ส่งแล้วและครบกำหนดลบสำเนา (30 วันหลังส่ง) ──
CREATE INDEX IF NOT EXISTS idx_file_storage_sp_sent_at
  ON file_storage (sp_sent_at)
  WHERE sp_sent_at IS NOT NULL AND file_removed_at IS NULL;

COMMIT;

-- ── ตรวจผล (รันแยกได้) ──
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name = 'file_storage' AND column_name LIKE 'sp\_%' OR column_name = 'file_removed_at'
--  ORDER BY column_name;
