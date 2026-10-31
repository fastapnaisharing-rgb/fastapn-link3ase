-- MARKER_VAT_SIMPLEDRAFT_HOLD_V1
-- ที่พัก Draft Simple (Hold) : ใช้ร่วมทุก Feature ที่เตรียมแถวเข้า Simple Draft (เช่น Temp. T36 จาก PDF)
-- ทุก User เห็นตรงกัน ทำงานต่อกันได้ ; เมื่อ Confirm เข้า vat_simpleinputdraft จริงแล้วให้ลบแถว Hold ทิ้ง
-- รันครั้งเดียวบน DB (ปลอดภัยถ้ารันซ้ำ)
CREATE TABLE IF NOT EXISTS vat_simpledraft_hold (
  id          BIGSERIAL PRIMARY KEY,
  feature     TEXT        NOT NULL,            -- เช่น 'sm-pp36' (Temp. T36 จาก PDF)
  draft_key   TEXT        NOT NULL,            -- คีย์กันซ้ำของแถว เช่น เลขที่ใบเสร็จ|ฐานภาษี|ภ.พ.36
  bu          TEXT,
  payload     JSONB       NOT NULL,            -- แถวข้อมูลทั้งชุด (คอลัมน์ตามตารางของ Feature นั้น)
  source_file TEXT,                            -- ชื่อไฟล์ PDF/ไฟล์ต้นทาง
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT vat_simpledraft_hold_feature_key UNIQUE (feature, draft_key)
);
CREATE INDEX IF NOT EXISTS vat_simpledraft_hold_feature_idx ON vat_simpledraft_hold (feature);
