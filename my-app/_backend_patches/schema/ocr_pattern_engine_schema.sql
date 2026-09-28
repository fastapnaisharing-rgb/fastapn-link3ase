-- ============================================================
-- FastAPN OCR + Pattern Engine — Phase 1 Database Schema
-- ============================================================
-- ออกแบบตาม Architecture ที่สรุปไว้:
--   - จัดกลุ่มหน้าเป็น "ชุด" (Set) ตาม Invoice Number
--   - Queue-based processing (1 Core worker, ปลอดภัยกับ production)
--   - Pattern Engine เก็บ "ตำแหน่ง field" ไม่ใช่ "ค่าจริง"
--   - ทุกชุดต้องผ่าน Approve ก่อนเข้า DB เสมอ (ไม่มี auto-save)
--   - Save Pattern เฉพาะตอนมีการแก้ไข (ไม่ save ซ้ำถ้าไม่เปลี่ยน)
--   - เชื่อมกับ supplier_list (ตาราง vendor หลักจริงของ FastAPN, PK เป็น uuid)
--     และ user_roles (PK เป็น uuid เช่นกัน) ที่มีอยู่แล้วในระบบ
-- ============================================================


-- ============================================================
-- 1. OCR SETS — หน่วยงานหลักของระบบ (1 ชุด = 1 invoice ที่อาจมีหลายหน้า)
-- ============================================================
CREATE TABLE ocr_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uploaded_by UUID NOT NULL REFERENCES user_roles(id),
    source_file_name TEXT,                       -- ชื่อไฟล์ PDF ต้นฉบับ
    supplier_id UUID REFERENCES supplier_list(id), -- NULL จนกว่าจะ match/approve ได้ (เดิมชื่อ vendor_id)
    invoice_no TEXT,                              -- อ่านได้จาก OCR ตอนแรก, ยืนยันตอน approve
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
        -- pending: รอ OCR ทำงาน
        -- processing: worker กำลังทำ
        -- ready_for_review: OCR เสร็จ รอคน approve
        -- approved: อนุมัติแล้ว บันทึกลง invoice จริงแล้ว
        -- rejected: ปฏิเสธ (ไม่ใช่ invoice ที่ถูกต้อง / ซ้ำ / ผิดพลาด)
    priority INT NOT NULL DEFAULT 0,             -- เผื่อ business rule ในอนาคต (due date ใกล้ ฯลฯ)
    used_pattern_id UUID,                        -- pattern ที่ใช้ pre-fill ตอนแรก (NULL = ไม่มี/vendor ใหม่)
    ocr_engine VARCHAR(20) DEFAULT 'paddleocr',
    ocr_dpi INT DEFAULT 150,
    total_pages INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    approved_at TIMESTAMP,
    approved_by UUID REFERENCES user_roles(id)
);

CREATE INDEX idx_ocr_sets_status ON ocr_sets(status, priority DESC, created_at ASC);
CREATE INDEX idx_ocr_sets_supplier ON ocr_sets(supplier_id);
CREATE INDEX idx_ocr_sets_invoice_no ON ocr_sets(supplier_id, invoice_no);


-- ============================================================
-- 2. OCR QUEUE PAGES — แต่ละหน้าที่อยู่ใน "ชุด" เดียวกัน
-- ============================================================
CREATE TABLE ocr_queue_pages (
    id SERIAL PRIMARY KEY,
    set_id UUID NOT NULL REFERENCES ocr_sets(id) ON DELETE CASCADE,
    page_number INT NOT NULL,                    -- ลำดับหน้าภายในชุด (1, 2, 3...)
    image_path TEXT NOT NULL,                     -- path ของไฟล์ภาพที่แปลงจาก PDF แล้ว
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
        -- pending, processing, done, failed
    raw_ocr_result JSONB,                          -- ผลลัพธ์ดิบจาก PaddleOCR (rec_texts, rec_scores, bbox)
    avg_confidence NUMERIC(5,4),                   -- confidence เฉลี่ยของหน้านี้
    elapsed_seconds NUMERIC(6,2),                  -- เวลาที่ใช้ OCR หน้านี้ (สำหรับ monitor/analytics)
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP,
    UNIQUE (set_id, page_number)
);

CREATE INDEX idx_queue_pages_status ON ocr_queue_pages(status, created_at ASC);


-- ============================================================
-- 3. VENDOR PATTERNS — "ความรู้" สะสมต่อ vendor (field mapping + crop area)
-- ============================================================
-- หลักการสำคัญ: เก็บ "วิธีหา" ไม่ใช่ "ค่าจริง"
--   - field_mapping: ตำแหน่ง/keyword ที่ field แต่ละตัวมักปรากฏ
--   - crop_area: พื้นที่ภาพที่ควร crop สำหรับ vendor นี้ (อนาคต, ยังไม่ทดสอบจริง)
--   - update_count: นับเฉพาะตอนมีการแก้ไขจริง (ไม่นับทุกครั้งที่ approve)
-- ============================================================
CREATE TABLE vendor_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID NOT NULL REFERENCES supplier_list(id),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    -- Field mapping: เก็บเป็น JSON เพราะ field ต่อ vendor ไม่ตายตัว
    -- ตัวอย่างโครงสร้าง:
    -- {
    --   "invoice_no":  { "keyword": "Invoice No.", "bbox_hint": [120,340,280,360], "confidence_avg": 0.98 },
    --   "total_amount":{ "keyword": "Total",        "bbox_hint": [150,890,300,910], "confidence_avg": 0.95 },
    --   "tax_id":      { "keyword": "Tax ID",        "bbox_hint": [200,150,400,170], "confidence_avg": 0.90 }
    -- }
    field_mapping JSONB NOT NULL DEFAULT '{}',

    -- Crop area: เก็บเป็นสัดส่วน (%) ของหน้า ไม่ใช่ pixel ตายตัว
    -- เพราะขนาดภาพอาจต่างกันได้ตาม DPI ที่ใช้
    -- ตัวอย่าง: { "top_pct": 0, "bottom_pct": 25 } = crop เอาแค่ 25% บนสุด
    -- NULL จนกว่าจะทดสอบ Crop จริงและพิสูจน์แล้วว่าปลอดภัย (ตามที่ตกลงกันไว้)
    crop_area JSONB,
    crop_area_verified BOOLEAN NOT NULL DEFAULT FALSE,

    -- จำนวนตัวอย่างที่ใช้สร้าง/ยืนยัน pattern นี้
    -- ตามหลักที่คุยไว้: ต้องมีอย่างน้อย 3-4 ตัวอย่างก่อนเริ่มใช้ crop จริง
    sample_count INT NOT NULL DEFAULT 1,

    -- นับเฉพาะตอนมีการแก้ไขค่าจาก pre-fill จริง (ไม่ใช่ทุกครั้งที่ approve)
    update_count INT NOT NULL DEFAULT 0,
    last_updated_reason VARCHAR(50),
        -- 'initial_creation', 'field_corrected', 'new_field_found', 'layout_changed_suspected'

    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

    UNIQUE (supplier_id)  -- 1 supplier = 1 pattern ที่ active ในตอนนี้ (เก็บ history แยกอีกตารางถ้าต้องการภายหลัง)
);

CREATE INDEX idx_vendor_patterns_supplier ON vendor_patterns(supplier_id) WHERE is_active = TRUE;


-- ============================================================
-- 4. OCR EXTRACTED FIELDS — ค่าที่สกัดได้จริงต่อ "ชุด" (ก่อน/หลัง แก้ไขโดยคน)
-- ============================================================
CREATE TABLE ocr_extracted_fields (
    id SERIAL PRIMARY KEY,
    set_id UUID NOT NULL REFERENCES ocr_sets(id) ON DELETE CASCADE,
    field_name VARCHAR(50) NOT NULL,
        -- 'invoice_no', 'invoice_date', 'total_amount', 'vat_amount', 'tax_id', 'vendor_name', ...

    -- ค่าที่ OCR/Pattern อ่านได้ก่อนคนแก้ (pre-fill value)
    ocr_value TEXT,
    ocr_confidence NUMERIC(5,4),

    -- ค่าที่คนกรอก/แก้ไขสุดท้ายตอน Approve
    final_value TEXT,

    -- flag ว่า field นี้ถูกแก้ไขจากค่าเดิมหรือไม่ (ใช้ตัดสินใจว่าต้อง update pattern ไหม)
    was_modified BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMP NOT NULL DEFAULT NOW(),

    UNIQUE (set_id, field_name)
);

CREATE INDEX idx_extracted_fields_set ON ocr_extracted_fields(set_id);


-- ============================================================
-- 5. DUPLICATE / VALIDATION LOG — เก็บผลเช็ค SQL Lookup ตอน Pre-fill
-- ============================================================
-- ใช้บันทึกว่าตอน pre-fill เจอ flag เตือนอะไรบ้าง (ไม่ block การทำงาน แค่เตือนคนตรวจ)
CREATE TABLE ocr_validation_flags (
    id SERIAL PRIMARY KEY,
    set_id UUID NOT NULL REFERENCES ocr_sets(id) ON DELETE CASCADE,
    flag_type VARCHAR(30) NOT NULL,
        -- 'duplicate_invoice_no', 'amount_anomaly', 'vendor_low_confidence', 'tax_id_mismatch'
    flag_detail JSONB,
        -- เช่น { "existing_invoice_id": 123, "existing_amount": 1735.69 }
    severity VARCHAR(10) NOT NULL DEFAULT 'warning',  -- 'info', 'warning', 'critical'
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_validation_flags_set ON ocr_validation_flags(set_id);


-- ============================================================
-- 6. HELPER VIEW — คิวที่รอ Worker หยิบงาน (เรียงตาม priority + FIFO)
-- ============================================================
CREATE VIEW v_ocr_pending_queue AS
SELECT
    s.id AS set_id,
    s.priority,
    s.created_at,
    s.total_pages,
    COUNT(p.id) FILTER (WHERE p.status = 'done') AS pages_done,
    COUNT(p.id) AS pages_total
FROM ocr_sets s
JOIN ocr_queue_pages p ON p.set_id = s.id
WHERE s.status IN ('pending', 'processing')
GROUP BY s.id, s.priority, s.created_at, s.total_pages
ORDER BY s.priority DESC, s.created_at ASC;


-- ============================================================
-- 7. FUNCTION — Worker ใช้ดึงหน้าถัดไปแบบปลอดภัย (กัน race condition)
-- ============================================================
-- ใช้ FOR UPDATE SKIP LOCKED เผื่ออนาคตมี worker มากกว่า 1 ตัว
-- ตอนนี้มี worker เดียว (1 core ตามที่ตกลงกันไว้) แต่เตรียม logic ไว้ให้ scale ได้
CREATE OR REPLACE FUNCTION fetch_next_ocr_page()
RETURNS TABLE (page_id INT, set_id UUID, page_number INT, image_path TEXT) AS $$
BEGIN
    RETURN QUERY
    UPDATE ocr_queue_pages
    SET status = 'processing'
    WHERE id = (
        SELECT qp.id
        FROM ocr_queue_pages qp
        JOIN ocr_sets s ON s.id = qp.set_id
        WHERE qp.status = 'pending'
        ORDER BY s.priority DESC, s.created_at ASC, qp.page_number ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    RETURNING id, ocr_queue_pages.set_id, ocr_queue_pages.page_number, ocr_queue_pages.image_path;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- 8. ตัวอย่างการใช้งาน (Reference Queries — ไม่ต้องรัน)
-- ============================================================

-- 8.1 หา Supplier จาก Tax ID หรือชื่อ (fuzzy match) — ต้องเปิด extension pg_trgm ก่อน
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
--
-- SELECT id, "Supplier Name"
-- FROM supplier_list
-- WHERE deleted = false
--   AND (tax_id = :ocr_tax_id
--    OR similarity("Supplier Name", :ocr_supplier_name) > 0.7)
-- ORDER BY (tax_id = :ocr_tax_id) DESC
-- LIMIT 1;

-- 8.2 เช็ค Duplicate Invoice
-- SELECT COUNT(*) FROM ocr_sets
-- WHERE supplier_id = :supplier_id AND invoice_no = :invoice_no AND status = 'approved';

-- 8.3 เช็คว่า field นี้ "มีการแก้ไข" หรือไม่ (เทียบก่อน/หลัง approve)
-- UPDATE ocr_extracted_fields
-- SET final_value = :new_value,
--     was_modified = (ocr_value IS DISTINCT FROM :new_value)
-- WHERE set_id = :set_id AND field_name = :field_name;

-- 8.4 ตัดสินใจว่าต้อง Save/Update Pattern หรือไม่ (ตาม logic ที่ตกลงกันไว้)
-- SELECT set_id, COUNT(*) FILTER (WHERE was_modified) AS modified_fields
-- FROM ocr_extracted_fields
-- WHERE set_id = :set_id
-- GROUP BY set_id;
-- -- ถ้า modified_fields = 0 -> ไม่ต้อง save pattern
-- -- ถ้า modified_fields > 0 และมี pattern เดิมอยู่แล้ว -> UPDATE pattern
-- -- ถ้า modified_fields > 0 และไม่มี pattern เดิม -> INSERT pattern ใหม่
