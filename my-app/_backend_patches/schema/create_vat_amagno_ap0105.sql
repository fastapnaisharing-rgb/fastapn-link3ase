-- MARKER_VAT_AMAGNO_AP0105_TABLE_V1
-- ตาราง AP01-AP05 (Amagno) แยกจาก vat_backup_tax_invoice (Tax Invoice / AR_Collection)
-- เก็บเฉพาะ Period ปัจจุบัน + ย้อนหลัง 1 งวด (ลบอัตโนมัติโดย Backend)
-- ชื่อคอลัมน์หลักคงตามเดิมของ vat_backup_tax_invoice เพื่อให้แท็บ Amagno ใช้ Component เดิมได้
-- รันครั้งเดียวบน DB (ปลอดภัยถ้ารันซ้ำ)
CREATE TABLE IF NOT EXISTS vat_amagno_ap0105 (
  id                  BIGSERIAL PRIMARY KEY,

  -- ขอบเขตข้อมูล
  period              TEXT        NOT NULL,           -- 'YYYY-MM' (Period VAT ที่โยนไฟล์)
  ap_set              TEXT        NOT NULL,           -- AP01..AP05
  doc_type            TEXT,                           -- = ap_set (คงชื่อเดิมให้ตารางหน้าเว็บ)
  document_type       TEXT,                           -- Documenttype ตามไฟล์

  -- BU
  bu                  TEXT,                           -- BU ที่ระบบหาได้ (IndexReserve2 ตาม Macro / ODP ผ่านสาขา)
  bu_state            TEXT        NOT NULL DEFAULT 'active',  -- active | inactive | unknown (BU ไม่อยู่ company_list)
  bu_code_file        TEXT,                           -- BUcode ตามไฟล์ (เก็บไว้เทียบ)
  index_reserve2      TEXT,                           -- IndexReserve2 ตามไฟล์ (ใช้หา BU)
  business_name       TEXT,
  bu_tax_id           TEXT,
  bu_branch           TEXT,
  bu_branch_code      TEXT,                           -- BUBranchCode

  -- ผู้ขาย
  supplier_code       TEXT,                           -- VendorCode
  supplier_name       TEXT,                           -- VendorName
  tax_id_supplier     TEXT,
  branch_supplier     TEXT,
  merchant_id         TEXT,

  -- ใบกำกับ
  doc_date            DATE,                           -- OCR_TaxInvoiceDate (แปลง พ.ศ. เป็น ค.ศ.)
  tax_invoice_number  TEXT,                           -- OCR_TaxInvoiceNo
  gross_value         NUMERIC(18,2),                  -- OCR_Total_exclVAT
  vat_value           NUMERIC(18,2),                  -- OCR_VAT
  total_value         NUMERIC(18,2),
  invoice_ref         TEXT,                           -- IndexInvoice
  ofin                TEXT,                           -- OFIN
  tax_type            TEXT,                           -- N/A/T/F/M (ระบบหาให้)

  -- ข้อมูลต้นทางจากไฟล์ AP
  origin_file         TEXT,                           -- Name
  file_creation_date  TEXT,                           -- Creationdate
  file_modified_date  TEXT,                           -- Lastmodifieddate
  ocr_user            TEXT,                           -- OCR_User
  ocr_date            TEXT,                           -- OCR_Date
  verify_user         TEXT,                           -- Verify_User
  verify_date         TEXT,                           -- Verify_Date

  -- ระบบ
  source_file         TEXT,                           -- ไฟล์ที่โยนเข้ามา
  uploaded_by         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vat_amagno_ap0105_scope_idx   ON vat_amagno_ap0105 (period, ap_set, bu);
CREATE INDEX IF NOT EXISTS vat_amagno_ap0105_bu_idx      ON vat_amagno_ap0105 (bu, period);
CREATE INDEX IF NOT EXISTS vat_amagno_ap0105_invoice_idx ON vat_amagno_ap0105 (tax_invoice_number);
CREATE INDEX IF NOT EXISTS vat_amagno_ap0105_docdate_idx ON vat_amagno_ap0105 (doc_date);

-- ตรวจผล
-- SELECT COUNT(*) FROM vat_amagno_ap0105;
