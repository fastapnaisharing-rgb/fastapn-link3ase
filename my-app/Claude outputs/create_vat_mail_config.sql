CREATE TABLE IF NOT EXISTS vat_mail_config (
  id            SERIAL PRIMARY KEY,
  config_name   TEXT NOT NULL,
  bu            TEXT NOT NULL,
  send_type     TEXT NOT NULL DEFAULT 'BU' CHECK (send_type IN ('BU','SUPPLIER')),
  scope_mode    TEXT NOT NULL DEFAULT 'ALL_CONDITIONS' CHECK (scope_mode IN ('ALL_CONDITIONS','BY_VENDOR')),
  rules         JSONB NOT NULL DEFAULT '{}'::jsonb,
  vendors       JSONB NOT NULL DEFAULT '[]'::jsonb,
  mail_to       TEXT,
  mail_cc       TEXT,
  subject_template TEXT,
  body_template TEXT,
  last_sent_at  TIMESTAMP,
  last_sent_by  TEXT,
  updated_by    TEXT,
  updated_at    TIMESTAMP DEFAULT NOW(),
  created_at    TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vat_mail_config_bu ON vat_mail_config (bu);
