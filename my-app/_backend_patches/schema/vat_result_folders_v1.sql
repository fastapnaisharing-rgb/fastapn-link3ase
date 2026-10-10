-- MARKER_VAT_RESULT_FOLDERS_SQL_V1 (2026-10-08)
-- Reconcile Results (VAT Control > Folder): Folder ย่อยที่ผู้ใช้สร้างเอง + ตัวช่วยค้นหา
--
-- หลักการ: "ไม่แตะ" ตาราง file_storage เดิม และไม่แตะ Export เดิม
--   * ไฟล์ที่ Export จาก Input Reconcile  = file_storage.module 'vat-reconcile-report' (มีอยู่แล้ว)
--       ref_id = '{account}|{YYYY-MM}|{template}' , bu = BU , file_path = Path เต็มบน Disk
--   * ไฟล์ที่ผู้ใช้ Paste/ลากมาวาง          = file_storage.module 'vat-result-upload' (ใหม่ — แยก Module
--       เพื่อไม่ปนกับ Zone ล่างของ VAT Reconcile Dashboard เดิม) ref_id = '{YYYY-MM}|{uuid}'
--   * ตำแหน่ง Folder: เดือน = จาก ref_id , BU = file_storage.bu , Folder ย่อย = ตารางใหม่ด้านล่าง
--     ไฟล์ที่ไม่มีแถวใน vat_result_file_link = อยู่ที่ราก BU
--
-- รันครั้งเดียวบน Production DB (ปลอดภัยรันซ้ำได้ — ใช้ IF NOT EXISTS ทั้งหมด)
-- รันก่อน Deploy Backend ที่เรียกใช้ตารางเหล่านี้

-- 1) Folder ย่อย (สร้างได้เฉพาะภายใน BU ของเดือนนั้น, ซ้อนกันได้ผ่าน parent_id)
CREATE TABLE IF NOT EXISTS vat_result_folder (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period      TEXT        NOT NULL,                          -- 'YYYY-MM'
  bu          TEXT        NOT NULL,
  parent_id   UUID        NULL REFERENCES vat_result_folder(id) ON DELETE RESTRICT,
  name        TEXT        NOT NULL,
  created_by  TEXT        NOT NULL,                          -- username (ใช้เช็คสิทธิ์ลบ)
  created_at  TIMESTAMP   NOT NULL DEFAULT NOW(),
  CONSTRAINT vat_result_folder_name_chk CHECK (length(btrim(name)) > 0 AND name !~ '[\\/:*?"<>|]')
);

-- ชื่อซ้ำใน Folder เดียวกันไม่ได้ (ไม่สนตัวพิมพ์เล็ก/ใหญ่ เหมือน Windows)
CREATE UNIQUE INDEX IF NOT EXISTS uq_vat_result_folder_name
  ON vat_result_folder (period, bu, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

CREATE INDEX IF NOT EXISTS idx_vat_result_folder_parent
  ON vat_result_folder (period, bu, parent_id);

-- 2) ไฟล์ ↔ Folder ย่อย (1 ไฟล์อยู่ได้ 1 Folder; ลบ file_storage แล้วแถวนี้หายตาม)
CREATE TABLE IF NOT EXISTS vat_result_file_link (
  file_id    UUID PRIMARY KEY REFERENCES file_storage(id) ON DELETE CASCADE,
  folder_id  UUID NOT NULL REFERENCES vat_result_folder(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_vat_result_file_link_folder ON vat_result_file_link (folder_id);

-- 3) Index ให้หน้า Folder/Search เร็ว แม้ไฟล์สะสมหลายปี
--    (เดือนอยู่ใน ref_id จึงทำ Expression Index; ใช้ WHERE จำกัดเฉพาะ 2 Module นี้ ตารางเล็ก ไม่กระทบ Module อื่น)
CREATE INDEX IF NOT EXISTS idx_file_storage_vatresult_period_bu
  ON file_storage (
    (CASE WHEN module = 'vat-reconcile-report' THEN split_part(ref_id, '|', 2) ELSE split_part(ref_id, '|', 1) END),
    bu
  )
  WHERE module IN ('vat-reconcile-report', 'vat-result-upload');

-- 4) ชื่อไฟล์ซ้ำใน BU/เดือน/Folder เดียวกัน = แทนที่ (Backend จัดการ) — ช่วยค้นหาด้วยชื่อ
CREATE INDEX IF NOT EXISTS idx_file_storage_vatresult_name
  ON file_storage (lower(file_name))
  WHERE module IN ('vat-reconcile-report', 'vat-result-upload');

-- ตรวจผล (รันแยกหลังสร้างเสร็จ):
--   SELECT to_regclass('vat_result_folder'), to_regclass('vat_result_file_link');
--   SELECT indexname FROM pg_indexes WHERE indexname LIKE '%vatresult%' OR indexname LIKE '%vat_result%';
--
-- ย้อนกลับ (ถ้าต้องการ — ไม่กระทบข้อมูลใน file_storage):
--   DROP TABLE IF EXISTS vat_result_file_link; DROP TABLE IF EXISTS vat_result_folder;
--   DROP INDEX IF EXISTS idx_file_storage_vatresult_period_bu, idx_file_storage_vatresult_name;
