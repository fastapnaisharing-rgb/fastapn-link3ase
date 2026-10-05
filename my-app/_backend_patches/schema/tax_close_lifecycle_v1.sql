-- ════════════════════════════════════════════════════════════════════
-- tax_close_lifecycle_v1.sql
-- Timeline ปิดภาษี (VAT) — โครงรอบเดือน + ขอบเขต BU + งาน + วงจรล้างข้อมูลหลังปิด Period 15 วัน
-- รันครั้งเดียวบน PostgreSQL (Idempotent — รันซ้ำได้)
-- ════════════════════════════════════════════════════════════════════

-- 1) รอบเดือน (1 แถวต่อ vat_period_month) — Trigger ปิด = POST /api/vat/period/close เดิม
CREATE TABLE IF NOT EXISTS tax_close_period (
  period_ym         TEXT PRIMARY KEY,                       -- 'YYYY-MM' ตรงกับเดือนที่ถูกปิดใน vat_period_month
  status            TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'closed', 'purged')),
  closed_at         TIMESTAMPTZ,
  closed_by         TEXT,
  purge_after       TIMESTAMPTZ,                            -- closed_at + tax_close_retention_days (ปฏิทิน)
  summary_snapshot  JSONB,                                  -- สรุปก่อนล้าง (เก็บถาวร ขนาดเล็ก)
  purged_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tax_close_period_purge
  ON tax_close_period (purge_after) WHERE status = 'closed';

-- 2) Master: BU ที่ "ปกติ" ใช้ปิดภาษี (ค่าเริ่มต้นตอนเปิดรอบใหม่) — ไม่ผูกกับ Active ของ company_list
CREATE TABLE IF NOT EXISTS tax_close_bu_master (
  bu_code      TEXT PRIMARY KEY,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  note         TEXT,
  updated_by   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3) ขอบเขต BU ต่อรอบ — BU ไหนต้องปิดเดือนนี้ (ปรับเฉพาะรอบได้ เช่น Active แต่เดือนนี้ไม่ต้องปิด)
CREATE TABLE IF NOT EXISTS tax_close_period_bu (
  period_ym    TEXT NOT NULL REFERENCES tax_close_period(period_ym),
  bu_code      TEXT NOT NULL,
  in_scope     BOOLEAN NOT NULL DEFAULT TRUE,
  reason       TEXT,                                        -- เหตุผลที่ไม่ปิด (ถ้า in_scope = false)
  updated_by   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (period_ym, bu_code)
);

-- 4) งานต่อ BU ต่อขั้นตอน (สร้างเฉพาะ BU ที่ in_scope = true)
CREATE TABLE IF NOT EXISTS tax_close_task (
  id            BIGSERIAL PRIMARY KEY,
  period_ym     TEXT NOT NULL REFERENCES tax_close_period(period_ym),
  bu_code       TEXT NOT NULL,
  step_code     TEXT NOT NULL,
  sub_code      TEXT NOT NULL DEFAULT '',                   -- A/N/T/F/M (ว่างถ้าไม่มี)
  status        TEXT NOT NULL DEFAULT 'NOT_STARTED'
                CHECK (status IN ('NA','NOT_STARTED','PENDING','REQUESTED','DONE','NO_DATA')),
  ref_id        TEXT,                                       -- Request ID
  owner         TEXT,
  due_date      DATE,
  completed_at  TIMESTAMPTZ,
  note          TEXT,
  updated_by    TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (period_ym, bu_code, step_code, sub_code)
);
CREATE INDEX IF NOT EXISTS idx_tax_close_task_period ON tax_close_task (period_ym, bu_code);

-- 5) ประวัติเปลี่ยนสถานะ (ไม่มี FK ไป task เพื่อให้ล้างตาม period_ym ได้ตรงๆ)
CREATE TABLE IF NOT EXISTS tax_close_task_log (
  id          BIGSERIAL PRIMARY KEY,
  task_id     BIGINT,
  period_ym   TEXT NOT NULL,
  bu_code     TEXT,
  step_code   TEXT,
  old_status  TEXT,
  new_status  TEXT,
  changed_by  TEXT,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_tax_close_task_log_period ON tax_close_task_log (period_ym);

-- 6) ค่าตั้ง: จำนวนวันเก็บข้อมูลหลังปิด Period (ปฏิทิน) — ปรับได้โดยไม่ต้องแก้โค้ด
INSERT INTO system_settings (key, value, updated_by, updated_at)
VALUES ('tax_close_retention_days', '15', 'system', NOW())
ON CONFLICT (key) DO NOTHING;
