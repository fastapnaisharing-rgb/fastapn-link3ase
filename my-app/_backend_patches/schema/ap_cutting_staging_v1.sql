-- ============================================================================
-- ap_cutting_staging_v1.sql  (REVISED — Documentation Only, อย่ารันซ้ำบน Production)
-- FASTAPN Link3ase — GL Functional > Reconcile > Account Payable Recon.
--
-- ⚠️ ตารางนี้มีอยู่แล้วจริงในฐานข้อมูล Production (สร้างไว้นอกรอบ Session นี้ —
--    ตรวจสอบวันที่ 2026-09-26 พบว่ายังว่างเปล่า 0 Row, ไม่มีข้อมูลสูญหาย)
--    ไฟล์นี้แก้จากที่เคยส่งไปให้ตรงกับ Schema จริงที่มีอยู่แล้ว — ใช้เป็นเอกสาร
--    อ้างอิงเท่านั้น (เช่น ตั้ง Dev/Test Database ใหม่) ห้ามรันกับ Production
--    เพราะ CREATE TABLE IF NOT EXISTS จะ Skip อยู่แล้ว แต่ไม่ต้องเสี่ยงรันซ้ำอีก
--
-- โครงสร้างจริงที่ตรวจสอบได้ (information_schema.columns, 2026-09-26):
-- ============================================================================

CREATE TABLE IF NOT EXISTS ap_cutting_staging (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id             UUID,            -- Key ผูกรวมทุกแถวของ 1 ครั้ง Commit (เหมือน batch_list Pattern)
    source_book          VARCHAR(50),     -- Oracle EBS Book เช่น 'REV BOOK', 'CRG BOOK', 'TOPS BOOK'
    source_request_id    VARCHAR(100),    -- อ้างอิง file_id (จาก file_storage) ถ้ามี ตอน Commit
    source_file_name     VARCHAR(255),    -- ชื่อไฟล์ดิบที่ Upload
    as_of_date           DATE,            -- As of Date จาก Header ของ Report
    period               VARCHAR(7)   NOT NULL,   -- 'YYYY-MM'
    branch_code          VARCHAR(20)  NOT NULL,
    gl_account           VARCHAR(20)  NOT NULL,   -- Whitelist 6 รหัส (21930052/54/100/84/85/220)
    sub_account          VARCHAR(20)  NOT NULL,
    supplier_code        VARCHAR(30),
    supplier_name        VARCHAR(255),
    invoice_number       VARCHAR(50)  NOT NULL,
    invoice_date         DATE,
    currency             VARCHAR(10),
    amount               NUMERIC(18,2) NOT NULL DEFAULT 0,
    remaining_amount     NUMERIC(18,2) NOT NULL DEFAULT 0,
    description          VARCHAR(500),
    branch_cpc_key       VARCHAR(20),     -- ค่า BU ที่ Resolve ได้จาก Branch (เทียบเท่า "bu")
    brand_group          CHAR(1),         -- ตัวอักษรแรกของ Book: R / C / T
    is_special_case      BOOLEAN DEFAULT FALSE, -- true = Resolve BU ผ่าน Fallback (group_range)
    status               VARCHAR(20) DEFAULT 'imported',
    imported_at          TIMESTAMP    NOT NULL DEFAULT NOW(),
    imported_by          VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_ap_cutting_staging_cpc_period
    ON ap_cutting_staging (branch_cpc_key, period);

CREATE INDEX IF NOT EXISTS idx_ap_cutting_staging_cpc_period_book
    ON ap_cutting_staging (branch_cpc_key, period, source_book);

CREATE INDEX IF NOT EXISTS idx_ap_cutting_staging_gl_account
    ON ap_cutting_staging (gl_account);
