-- ════════════════════════════════════════════════════════════════════
-- tax_close_timeline_v2.sql  (Timeline ปิดภาษี) — รันซ้ำได้ (Idempotent)
-- ต่อจาก tax_close_lifecycle_v1.sql
--   1) tax_close_bu_config   : Config ถาวรรายช่อง (Enable/Disable ทุกตัว) — "ไม่ Reset" ไม่ถูก Purge
--   2) tax_close_task_item   : ติ๊ก Checklist ย่อยต่อรอบ (ถูก Purge ตามรอบ 15 วัน)
--   3) tax_close_period_bu   : เพิ่ม Confirm ของ BU
-- ════════════════════════════════════════════════════════════════════

-- 1) Config ถาวรรายช่อง: เก็บสถานะ Enable/Disable ของทุกช่อง/รายการ (ทั้งเปิดและปิด)
--    config_key ตัวอย่าง:  step:Popup-Suspense | item:46119:Grab | card:Closing Vat:Transfer | rpt:first:N:inc
--    ใช้เป็นค่าเริ่มต้นตอนสร้าง Task ของรอบใหม่ (ค่า Y/ติ๊ก/Request ID เริ่มใหม่ ส่วน Enable/Disable คงเดิม)
CREATE TABLE IF NOT EXISTS tax_close_bu_config (
  bu_code      TEXT NOT NULL,
  config_key   TEXT NOT NULL,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bu_code, config_key)
);

-- 2) Checklist ย่อยต่อรอบ (เช่น แพลตฟอร์มของ 46119, ขั้นของ Daily) — ลบตาม period_ym ตอน Purge
CREATE TABLE IF NOT EXISTS tax_close_task_item (
  id          BIGSERIAL PRIMARY KEY,
  period_ym   TEXT NOT NULL,
  bu_code     TEXT NOT NULL,
  step_code   TEXT NOT NULL,
  item_key    TEXT NOT NULL,
  done        BOOLEAN NOT NULL DEFAULT FALSE,
  done_by     TEXT,
  done_at     TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (period_ym, bu_code, step_code, item_key)
);
CREATE INDEX IF NOT EXISTS idx_tax_close_task_item_period ON tax_close_task_item (period_ym, bu_code);

-- 3) Confirm ของ BU (ไม่เกี่ยวกับการปิด Period)
ALTER TABLE tax_close_period_bu ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE tax_close_period_bu ADD COLUMN IF NOT EXISTS confirmed_by TEXT;
