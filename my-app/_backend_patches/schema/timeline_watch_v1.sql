-- timeline_watch_v1.sql  (Timeline ปิดภาษี > Config BU) — รันซ้ำได้
-- 1) user_roles.vat_prepare_name = ชื่อที่ใช้ตอนทำ VAT (ตรงกับ company_list."PREPARE BY") ผูกกับ User
-- 2) timeline_watch = BU ที่ User ต้องการ "ดู Progress" (1 แถวต่อ User)
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS vat_prepare_name TEXT;

CREATE TABLE IF NOT EXISTS timeline_watch (
  id          BIGSERIAL PRIMARY KEY,
  username    TEXT NOT NULL UNIQUE,
  bus         JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
