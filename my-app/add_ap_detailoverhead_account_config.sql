-- =====================================================================
-- add_ap_detailoverhead_account_config.sql  (รันใน pgAdmin DB fastapn-link3ase -- รันซ้ำได้)
-- ตัวกลางกำหนด "Account ไหน เก็บ Journal ไว้ให้รายงานไหน" ของตาราง ap_detailoverhead
-- เพิ่ม Account/รายงานใหม่ = INSERT 1 แถว ไม่ต้องแก้โค้ด และเลิกใช้ CHECK(source) ที่ล็อกไว้แค่ 2 ค่า
-- =====================================================================
CREATE TABLE IF NOT EXISTS ap_detailoverhead_account_config (
    account_code  VARCHAR(10) PRIMARY KEY,
    source        VARCHAR(30) NOT NULL,          -- ชื่อรายงานที่ใช้ เช่น ap_reconcile, ie_reconcile, vat_reconcile
    label         VARCHAR(100),
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO ap_detailoverhead_account_config (account_code, source, label) VALUES
 ('21930052','ap_reconcile','Accounts Payable-Non Trade-Sub'),
 ('21930054','ap_reconcile',NULL),
 ('21930084','ap_reconcile',NULL),
 ('21930085','ap_reconcile',NULL),
 ('21930100','ie_reconcile',NULL),
 ('21930220','ie_reconcile',NULL)
ON CONFLICT (account_code) DO NOTHING;

-- ปลด CHECK(source IN (...)) เดิมของ ap_detailoverhead (ชื่อ constraint อาจต่างกันตามที่รันไว้ -- ลบทั้งสองชื่อ)
ALTER TABLE ap_detailoverhead DROP CONSTRAINT IF EXISTS ap_detailoverhead_source_check;
ALTER TABLE ap_detailoverhead DROP CONSTRAINT IF EXISTS chk_apdo_source;
