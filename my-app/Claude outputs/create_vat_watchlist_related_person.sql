-- สร้างตาราง vat_watchlist_related_person (Related Person ต่อ Range + Type สำหรับ Mail/Pivot)
-- รันทีละ Step ใน DB Client (Production) -- ต้องรัน "ก่อน" ใช้งานหน้า Vat Config ใหม่

-- STEP 1: สร้างตาราง (รันซ้ำได้ปลอดภัย)
CREATE TABLE IF NOT EXISTS vat_watchlist_related_person (
  id             SERIAL PRIMARY KEY,
  bu             TEXT NOT NULL,
  range_start    TEXT NOT NULL,
  range_end      TEXT NOT NULL,
  person_type    TEXT NOT NULL DEFAULT 'ALL' CHECK (person_type IN ('ALL','ASSET','EXPENSE')),
  related_person TEXT NOT NULL,
  updated_by     TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vat_watchlist_related_person_bu ON vat_watchlist_related_person (bu);

-- STEP 2: ตรวจผล
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'vat_watchlist_related_person'
ORDER BY ordinal_position;

-- (ถ้าต้องย้อนกลับ) DROP TABLE IF EXISTS vat_watchlist_related_person;
