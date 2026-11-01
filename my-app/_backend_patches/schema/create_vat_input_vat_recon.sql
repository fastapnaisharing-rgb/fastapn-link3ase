-- MARKER_VAT_INPUT_VAT_RECON_TABLE_V1
-- ตารางชั่วคราวของรายงาน "Input VAT Reconciliation Report (Custom)" (โปรแกรม CRC_AP_I_VAT_RECONCILE, ไฟล์ .out)
-- แยกจาก vat_reconcile_input_summary (Input Summary APCRC201) เพราะคอลัมน์ต่างกัน (ตารางนี้มี Tax Code)
-- ใช้งานชั่วคราวสำหรับหน้า VAT Reconcile AP01-AP05: ข้อมูลถูกลบอัตโนมัติเมื่อครบกำหนด (ค่าเริ่มต้น 30 วันนับจากวันที่โยนไฟล์
-- ปรับได้ที่ system_settings key 'input_vat_recon_retention_days' 1-365) -- ดู routes/vatInputVatRecon.js
-- เก็บค่าตามไฟล์ต้นฉบับ ไม่แก้ตัวเลข
-- รันครั้งเดียวบน DB (ปลอดภัยถ้ารันซ้ำ)
CREATE TABLE IF NOT EXISTS vat_input_vat_recon (
  id                  BIGSERIAL PRIMARY KEY,

  -- ขอบเขตข้อมูล
  period              TEXT        NOT NULL,           -- 'YYYY-MM' (Period VAT ที่โยนไฟล์)
  bu                  TEXT,                           -- BU ที่ระบบหาได้จากสาขา
  bu_state            TEXT        NOT NULL DEFAULT 'active',  -- active | inactive | unknown

  -- Tax Code / Tax Type (แยกวิธีเดียวกับ Incomplete: [A|T|F]?<สาขา>-<N|M> [S]VAT7)
  tax_code            TEXT,                           -- Tax Code ตามไฟล์ เช่น 321801-N SVAT7, T321801-N VAT7
  tax_type            TEXT,                           -- N / A / T / F / M

  -- ข้อมูลตามคอลัมน์ในไฟล์ (ลำดับเดียวกับไฟล์)
  source              TEXT,                           -- Source (BTM, DOC, ITC, B2M, Manual Invoice Entry ...)
  branch              TEXT,                           -- สาขา
  tax_cost_center     TEXT,
  receive_date        DATE,                           -- วันที่ (รับสินค้า)
  grt_no              TEXT,                           -- GRT_No. (รับสินค้า)
  tax_invoice_date    DATE,                           -- วันที่ใบกำกับภาษี
  tax_invoice_no      TEXT,                           -- เลขที่ใบกำกับภาษี
  tax_running_number  TEXT,
  vendor_name         TEXT,
  item_detail         TEXT,                           -- รายการ
  purchase_amount     NUMERIC(18,2),                  -- ภาษีซื้อ (ยอดก่อนภาษี) ตามไฟล์
  purchase_vat        NUMERIC(18,2),                  -- ภาษีซื้อ (ภาษี)
  claim100_amount     NUMERIC(18,2),
  claim100_vat        NUMERIC(18,2),
  average_rate        NUMERIC(18,6),
  avg_amount          NUMERIC(18,2),
  avg_vat             NUMERIC(18,2),
  claim100b_amount    NUMERIC(18,2),
  claim100b_vat       NUMERIC(18,2),
  exam50_amount       NUMERIC(18,2),
  exam50_vat          NUMERIC(18,2),
  calculate_tax       NUMERIC(18,2),
  vendor_number       TEXT,
  ap_invoice_no       TEXT,                           -- เลขที่ใบแจ้งหนี้
  ap_invoice_amount   NUMERIC(18,2),
  ap_invoice_vat      NUMERIC(18,2),
  journal_batch       TEXT,
  journal_name        TEXT,
  journal_line        TEXT,
  journal_amount      NUMERIC(18,2),
  gl_line_amount      NUMERIC(18,2),
  gl_date             DATE,
  posting_status      TEXT,
  posting_date        DATE,
  ap_invoice_status   TEXT,
  message             TEXT,
  svat_info           TEXT,
  is_this_tax         TEXT,

  -- กันซ้ำ: hash ของบรรทัดดิบ + ลำดับที่ซ้ำกันในไฟล์เดียวกัน (แถวที่เหมือนกันทุกคอลัมน์จริงๆ ยังเก็บได้ครบ)
  line_no             INTEGER,
  row_hash            TEXT,
  dup_seq             INTEGER     NOT NULL DEFAULT 0,

  -- ระบบ
  source_file         TEXT,
  report_request_id   TEXT,                           -- Request ID ในหัวรายงาน
  uploaded_by         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- ใช้นับกำหนดลบ
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS vat_input_vat_recon_rowkey_uq ON vat_input_vat_recon (bu, period, row_hash, dup_seq);
CREATE INDEX IF NOT EXISTS vat_input_vat_recon_scope_idx   ON vat_input_vat_recon (period, bu, tax_type);
CREATE INDEX IF NOT EXISTS vat_input_vat_recon_invoice_idx ON vat_input_vat_recon (tax_invoice_no);
CREATE INDEX IF NOT EXISTS vat_input_vat_recon_created_idx ON vat_input_vat_recon (created_at);
