CREATE TABLE IF NOT EXISTS vat_mail_draft (
  id               SERIAL PRIMARY KEY,
  draft_name       TEXT NOT NULL,
  send_type        TEXT NOT NULL DEFAULT 'BU' CHECK (send_type IN ('BU','SUPPLIER')),
  subject_template TEXT,
  body_template    TEXT,
  updated_by       TEXT,
  updated_at       TIMESTAMP DEFAULT NOW(),
  created_at       TIMESTAMP DEFAULT NOW()
);

ALTER TABLE vat_mail_config ADD COLUMN IF NOT EXISTS draft_id INTEGER;

INSERT INTO vat_mail_draft (draft_name, send_type, subject_template, body_template)
SELECT 'ติดตามใบกำกับ - Aging', 'BU',
 '{BU} - ขอติดตามใบกำกับภาษี ของรายการที่ตัดชำระตั้งแต่เดือน {เดือนเริ่ม} ถึง {เดือนสุดท้าย}',
 E'เรียน {ชื่อผู้รับ}\n\n    ข้อความนี้ถูกสร้างโดยระบบอัตโนมัติเพื่อ ติดตามใบกำกับภาษี โดยสรุปรายละเอียดเป็นราย Supplier และแบ่งข้อมูลตามความเสี่ยง ดังนี้\n\n{AGING_LIST}'
WHERE NOT EXISTS (SELECT 1 FROM vat_mail_draft WHERE draft_name = 'ติดตามใบกำกับ - Aging');
