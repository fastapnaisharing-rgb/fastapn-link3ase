-- MARKER_GUEST_ADD_TAB_V1 : เก็บ BU ของ Guest (หลาย BU คั่นด้วยจุลภาค เช่น 'CRG,TOP')
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS guest_bu TEXT;
