-- MARKER_VATMAIL_SENT_ICON_V1 : จำว่า Supplier ไหนถูกกด "ส่งเมลแล้ว" (ไอคอนคนสีฟ้า + ซองจดหมาย)
CREATE TABLE IF NOT EXISTS vat_mail_sent_log (
  id            SERIAL PRIMARY KEY,
  supplier_code TEXT NOT NULL UNIQUE,
  sent_at       TIMESTAMPTZ,
  sent_by       TEXT,
  mail_to       TEXT
);
