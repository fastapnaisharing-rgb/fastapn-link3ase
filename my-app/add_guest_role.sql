-- MARKER_GUEST_ROLE_V1 : เพิ่ม Role 'Guest' (ต่ำกว่า Viewer)
-- 1) menu_min_role รับ 'Guest' (ใช้กับเมนู AP/VAT/IE/GL/I-Pro เท่านั้น Document Access ไม่ตั้ง Guest)
ALTER TABLE menu_min_role DROP CONSTRAINT IF EXISTS menu_min_role_min_role_check;
ALTER TABLE menu_min_role ADD CONSTRAINT menu_min_role_min_role_check
  CHECK (min_role IN ('Guest','Viewer','Editor','Admin'));

-- 2) ถ้า user_roles มี CHECK จำกัดค่า role ไว้ ให้ขยายให้รับ 'Guest' (ไม่มี = ไม่ทำอะไร)
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'user_roles'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%' AND pg_get_constraintdef(oid) ILIKE '%Viewer%'
  LOOP
    EXECUTE format('ALTER TABLE user_roles DROP CONSTRAINT %I', c.conname);
    EXECUTE 'ALTER TABLE user_roles ADD CONSTRAINT user_roles_role_check CHECK (role IN (''Owner'',''Admin'',''Editor'',''Viewer'',''Guest''))';
  END LOOP;
END $$;

-- ตรวจ: SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid IN ('menu_min_role'::regclass,'user_roles'::regclass) AND contype='c';
