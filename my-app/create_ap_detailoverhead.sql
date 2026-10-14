-- =====================================================================
-- create_ap_detailoverhead.sql
-- Schema สำหรับ "JV Journal" (รายงาน FNDWRR: Detail of Overhead for account 1,2 Report (custom))
-- ใช้เป็นข้อมูลฝั่ง "Detail of Journal" ของ AP Reconcile (เทียบ TB vs AP)
--
-- รันใน pgAdmin (database: fastapn-link3ase) ทีละ Block ได้
-- ออกแบบจากไฟล์ตัวอย่าง JV_Journal.xlsx (5,078 แถวข้อมูล + 1 แถว "Total :")
--
-- แนวทาง (ตามระบบเดิม)
--   * COM | BU | BOOK : เก็บทั้ง 3 ค่าลงตารางตอนบันทึก
--       com  = Segment 3 ของ Flexfield = company_list."SEGMENT3"   (เช่น 0401)
--       bu   = company_list.bu                                       (เช่น TOP)
--       book = company_list."BOOK"                                   (เช่น TOP)
--     (ไฟล์ JV ไม่มี COM/BU/BOOK ในตัวไฟล์ -> ต้องมาจากตอนอัปโหลด/จับจาก Branch แล้ว Validate กับ company_list)
--   * บันทึกแบบ "แทนทั้งก้อน" ต่อ (com, period, account_code) เหมือน Input Summary
--     (DELETE ก้อนเก่า -> INSERT ใหม่ ใน Transaction เดียว) เพราะไฟล์นี้ไม่มี Key ธรรมชาติ
--     (แถว Dr/Cr ของ Invoice เดียวกันซ้ำกันได้ จึงไม่ตั้ง UNIQUE ระดับแถว)
--   * เก็บ "เฉพาะแถวที่มี Journal name" และเฉพาะ Account ที่กำหนด (21930052, 21930054, 21930084/85?, 21930100, 21930220)
--     แถว Invoice (ไม่มี Journal name) ไม่เก็บ -- กรองที่ Backend ตอนอัปโหลด (ไฟล์ตัวอย่าง: 166 จาก 5,078 แถว)
--   * "Total :" ท้ายไฟล์ไม่เก็บเป็นแถว -> เก็บเป็น file_total (ยอดทั้งไฟล์) ในตาราง upload เทียบกับ computed_file_total
--     และเก็บ journal_total (ยอดเฉพาะแถว Journal ที่บันทึก) ไว้ใช้ในรายงาน
--   * Amount เก็บตามไฟล์ (ลบ = เครดิต) ตรงเครื่องหมายเดียวกับ TB (ต่างจาก AP Summary ที่เป็นบวก)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) ตาราง Upload (1 แถว = 1 ไฟล์ที่อัปโหลด) -- เก็บ Header/Footer ของรายงาน
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ap_detailoverhead_upload (
    id              SERIAL PRIMARY KEY,
    com             VARCHAR(10)  NOT NULL,            -- Segment 3 (company_list.SEGMENT3) เช่น 0401
    bu              VARCHAR(50),                      -- company_list.bu เช่น TOP
    book            VARCHAR(20),                      -- company_list."BOOK"
    period          VARCHAR(7)   NOT NULL,            -- YYYY-MM (Period ที่ผู้ใช้เลือกตอน Reconcile)
    account_code    VARCHAR(10)  NOT NULL,            -- เช่น 21930052
    file_name       VARCHAR(255),
    file_id         INTEGER,                          -- อ้าง file_storage ถ้ามี
    request_id      VARCHAR(20),                      -- "Request Id" ในหัวรายงาน (เช่น 117760850)
    printed_by      VARCHAR(30),                      -- "Printed by" (เช่น FAPMGR008)
    printed_at      TIMESTAMP,                        -- "Printed date"
    file_row_count  INTEGER      NOT NULL DEFAULT 0,  -- จำนวนแถวข้อมูลทั้งไฟล์ (ก่อนกรอง) เช่น 5,078
    file_total      NUMERIC(18,2),                    -- ยอด "Total :" ท้ายไฟล์ (เช่น -28,631,806.75)
    computed_file_total NUMERIC(18,2),                -- ผลรวม amount ทั้งไฟล์ที่คำนวณได้ (ต้องเท่ากับ file_total)
    journal_count   INTEGER      NOT NULL DEFAULT 0,  -- จำนวนแถว Journal ที่บันทึกจริง (มี Journal name + Account ที่กำหนด)
    journal_total   NUMERIC(18,2),                    -- ผลรวม amount ของแถว Journal ที่บันทึก
    uploaded_by     VARCHAR(100),
    uploaded_at     TIMESTAMP    NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_apdo_upload_period CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$')
);

CREATE INDEX IF NOT EXISTS idx_apdo_upload_scope
    ON ap_detailoverhead_upload (com, period, account_code, uploaded_at DESC);

-- ---------------------------------------------------------------------
-- 2) ตารางรายการ (1 แถว = 1 บรรทัดของไฟล์) -- 1:1 ตามหัวคอลัมน์ในไฟล์
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ap_detailoverhead (
    id                BIGSERIAL PRIMARY KEY,
    upload_id         INTEGER      NOT NULL REFERENCES ap_detailoverhead_upload(id) ON DELETE CASCADE,

    -- Scope (COM | BU | BOOK) + Period
    com               VARCHAR(10)  NOT NULL,
    bu                VARCHAR(50),
    book              VARCHAR(20),
    period            VARCHAR(7)   NOT NULL,

    -- หัวคอลัมน์ในไฟล์ (เรียงตามไฟล์)
    branch_code       VARCHAR(10)  NOT NULL,          -- Branch Code      เช่น 040101, 0401Z8 (ไฟล์ตัวอย่างยาวสุด 6)
    branch_name       VARCHAR(100),                   -- Branch Name      (ยาวสุด 47)
    cost_center       VARCHAR(10)  NOT NULL,          -- Cost Center      เช่น 99999 (= CPC)
    account_code      VARCHAR(10)  NOT NULL,          -- Account Code     เช่น 21930052
    account_name      VARCHAR(100),                   -- Account Name     (ยาวสุด 30)
    sub_account_code  VARCHAR(10)  NOT NULL,          -- Sub Account Code เช่น 0560H2 (มีตัวอักษรได้ -> TEXT ห้ามเป็นตัวเลข)
    transaction_date  DATE         NOT NULL,          -- Transaction Date (ไฟล์เป็นข้อความ DD-MON-YYYY เช่น 08-SEP-2026 -> แปลงเป็น DATE)
    journal_name      VARCHAR(100) NOT NULL,          -- Journal name     (เก็บเฉพาะแถวที่มี Journal name)
    invoice_number    VARCHAR(60),                    -- Invoice Number   (ในแถว Journal ว่างทั้งหมด เก็บไว้ครบตามหัวคอลัมน์)
    vendor_name       VARCHAR(200),                   -- Vendor Name      (ยาวสุด 82)
    description       TEXT,                           -- Description      (ยาวสุด 215; ว่างได้ ~34%)
    amount            NUMERIC(18,2) NOT NULL,         -- Amount           (ลบ = เครดิต เหมือน TB)
    contact_from_to   VARCHAR(100),                   -- "Contact From. To" (ไฟล์ตัวอย่างว่างทั้งหมด เก็บไว้ครบตามหัวคอลัมน์)

    -- ช่วยงาน
    line_no           INTEGER      NOT NULL,          -- ลำดับแถวในไฟล์ (เริ่ม 1) ใช้เรียง/อ้างกลับไฟล์
    source            VARCHAR(30)  NOT NULL DEFAULT 'upload', -- ที่มาของแถว: 'upload' = อัปโหลดไฟล์ JV (FNDWRR) / 'manual' = พิมพ์เพิ่มเอง (ค่าอื่นเพิ่มได้)
    created_at        TIMESTAMP    NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_apdo_period CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$')
);

-- กรณีสร้างตารางไปแล้วก่อนเพิ่มคอลัมน์ source (รันซ้ำได้)
ALTER TABLE ap_detailoverhead ADD COLUMN IF NOT EXISTS source VARCHAR(30) NOT NULL DEFAULT 'upload';

-- ค้นหา/ลบก้อนตอน Replace
CREATE INDEX IF NOT EXISTS idx_apdo_scope
    ON ap_detailoverhead (com, period, account_code);
-- จับคู่กับ TB ระดับ Liability Account (com-branch-cpc-account-subacc)
CREATE INDEX IF NOT EXISTS idx_apdo_liability
    ON ap_detailoverhead (com, period, account_code, branch_code, cost_center, sub_account_code);
CREATE INDEX IF NOT EXISTS idx_apdo_upload ON ap_detailoverhead (upload_id);

COMMENT ON TABLE  ap_detailoverhead IS 'JV Journal (FNDWRR Detail of Overhead) ต่อบรรทัด ใช้เป็น Detail of Journal ใน AP Reconcile';
COMMENT ON COLUMN ap_detailoverhead.com IS 'Segment 3 ของ Flexfield = company_list.SEGMENT3';
COMMENT ON COLUMN ap_detailoverhead.bu IS 'company_list.bu (ชื่อย่อ เช่น TOP)';
COMMENT ON COLUMN ap_detailoverhead.book IS 'company_list.BOOK';
COMMENT ON COLUMN ap_detailoverhead.source IS 'ที่มาของแถว: upload = อัปโหลดไฟล์ JV, manual = พิมพ์เพิ่มเอง';
COMMENT ON COLUMN ap_detailoverhead.amount IS 'ตามไฟล์: ลบ = เครดิต (เครื่องหมายเดียวกับ TB)';

-- ---------------------------------------------------------------------
-- 3) View: ยอดรวมต่อ Liability Account (ไว้จับคู่กับ vat_reconcile_tb / รายงาน AP)
--    Flexfield = 1-04-<com>-<branch>-<cpc>-<account>-<subacc>
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_ap_detailoverhead_by_liability AS
SELECT com, bu, book, period,
       branch_code, cost_center, account_code, sub_account_code,
       SUM(amount)                                AS journal_amount,
       COUNT(*)                                   AS line_count
FROM ap_detailoverhead
GROUP BY com, bu, book, period, branch_code, cost_center, account_code, sub_account_code;

-- =====================================================================
-- ตัวอย่างใช้งาน
--   -- ตรวจยอดตรงกับ Total ท้ายไฟล์
--   SELECT u.id, u.file_total, u.computed_file_total, (u.file_total = u.computed_file_total) AS ok, u.journal_count, u.journal_total
--   FROM ap_detailoverhead_upload u ORDER BY u.id DESC LIMIT 5;
--
--   -- เทียบ TB กับ Journal ระดับ Liability Account (ตัวอย่าง COM 0401 / 2026-09 / 21930052)
--   SELECT t.branch, t.cpc, t.account, t.subacc,
--          t.ending_balance AS tb_ending, j.journal_amount
--   FROM vat_reconcile_tb t
--   LEFT JOIN v_ap_detailoverhead_by_liability j
--          ON j.com = t.bu AND j.period = t.period AND j.branch_code = t.branch
--         AND j.cost_center = t.cpc AND j.account_code = t.account AND j.sub_account_code = t.subacc
--   WHERE t.bu = '0401' AND t.period = '2026-09' AND t.account = '21930052';
-- =====================================================================
