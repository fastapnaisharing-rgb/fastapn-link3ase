-- MARKER_MENU_MIN_ROLE_V1 : Permission (Role) ขั้นต่ำต่อเมนู  Viewer < Editor < Admin < Owner
CREATE TABLE IF NOT EXISTS menu_min_role (
  id         SERIAL PRIMARY KEY,
  menu_id    TEXT NOT NULL UNIQUE,
  min_role   TEXT NOT NULL DEFAULT 'Editor' CHECK (min_role IN ('Viewer','Editor','Admin')),
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO menu_min_role (menu_id, min_role, updated_by) VALUES
  ('vat-watchlist-ops',       'Viewer', 'seed'),
  ('vat-dashboard',           'Viewer', 'seed'),
  ('vat-reconcile-ap01-05',   'Editor', 'seed'),
  ('vat-simple-input-ops',    'Editor', 'seed'),
  ('vat-input-rec',           'Editor', 'seed'),
  ('vat-suspense-rec',        'Editor', 'seed'),
  ('vat-direct-debit-recon',  'Editor', 'seed'),
  ('vat-timeline',            'Editor', 'seed'),
  ('vat-freeze',              'Editor', 'seed'),
  ('vat-upload-file',         'Editor', 'seed'),
  ('vat-monthly-report',      'Editor', 'seed'),
  ('vat-backup-transaction',  'Editor', 'seed'),
  ('vat-backup-tax-invoice',  'Editor', 'seed')
ON CONFLICT (menu_id) DO NOTHING;

-- MARKER_MENU_USER_GRANT_V1 : ให้สิทธิ์/ปลดสิทธิ์รายบุคคลต่อเมนู (granted=true เข้าได้แม้ Role ต่ำกว่าขั้นต่ำ | false = ห้ามเข้า | ไม่มีแถว = ตามขั้นต่ำ)
-- user_id ใช้ชนิดเดียวกับ user_roles.id (กันชนิด int/uuid ไม่ตรง)
DO $$
DECLARE t text;
BEGIN
  SELECT format_type(atttypid, atttypmod) INTO t FROM pg_attribute WHERE attrelid = 'user_roles'::regclass AND attname = 'id';
  EXECUTE format('CREATE TABLE IF NOT EXISTS menu_user_grant (
    id         SERIAL PRIMARY KEY,
    user_id    %s NOT NULL,
    menu_id    TEXT NOT NULL,
    granted    BOOLEAN NOT NULL,
    updated_by TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, menu_id)
  )', t);
END $$;
