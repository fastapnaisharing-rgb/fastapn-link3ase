-- timeline_progress_v1.sql  (Timeline ปิดภาษี > บันทึกความคืบหน้า) — รันซ้ำได้
-- 1 แถวต่อ (period_ym, bu) เก็บ state ทั้งก้อน: Checklist, ไม่มีข้อมูล, Request ID, Report Draft, Closing Vat, Enable/Disable, Confirm
CREATE TABLE IF NOT EXISTS timeline_progress (
  id          BIGSERIAL PRIMARY KEY,
  period_ym   TEXT NOT NULL,
  bu          TEXT NOT NULL,
  state       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (period_ym, bu)
);
