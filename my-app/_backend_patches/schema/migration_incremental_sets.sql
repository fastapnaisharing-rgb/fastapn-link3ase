-- ============================================================
-- Migration: Incremental Set Grouping
-- แก้ให้ Worker แบ่ง "ชุด" ระหว่างทำงาน ไม่ต้องรอ OCR ครบทั้ง batch
-- ============================================================

-- 1. ตาราง Batch ใหม่ — เก็บไฟล์ที่ Upload มาทั้งก้อน (ก่อนแบ่งชุด)
CREATE TABLE ocr_upload_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uploaded_by UUID NOT NULL REFERENCES user_roles(id),
    source_file_name TEXT,
    total_pages INT NOT NULL,
    current_open_set_id UUID,  -- ชุดที่ยังเปิดอยู่ (worker อัพเดตเอง)
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 2. ocr_queue_pages: ผูกกับ batch แทนที่จะผูกกับ set ตั้งแต่ต้น
--    set_id จะถูกเติมทีหลังโดย worker (ตอน OCR หน้านั้นเสร็จแล้ว)
ALTER TABLE ocr_queue_pages DROP CONSTRAINT IF EXISTS ocr_queue_pages_set_id_page_number_key;
ALTER TABLE ocr_queue_pages ALTER COLUMN set_id DROP NOT NULL;
ALTER TABLE ocr_queue_pages ADD COLUMN batch_id UUID REFERENCES ocr_upload_batches(id);
ALTER TABLE ocr_queue_pages ADD CONSTRAINT uq_batch_page UNIQUE (batch_id, page_number);

-- 3. ocr_sets: เก็บว่าเกิดจาก batch ไหน (เผื่อ trace กลับ)
ALTER TABLE ocr_sets ADD COLUMN batch_id UUID REFERENCES ocr_upload_batches(id);
ALTER TABLE ocr_sets ALTER COLUMN total_pages DROP NOT NULL;  -- ไม่รู้จำนวนหน้าล่วงหน้าอีกแล้ว
ALTER TABLE ocr_sets ALTER COLUMN total_pages SET DEFAULT 0;

-- 4. Index สำหรับ worker ดึงงานตามลำดับหน้าใน batch
CREATE INDEX idx_queue_pages_batch_order ON ocr_queue_pages(batch_id, page_number)
    WHERE status = 'pending';

-- 5. Function ใหม่ — ดึงหน้าถัดไปตามลำดับ batch + page_number (สำคัญมาก
--    เพราะต้องประมวลผล "เรียงตามหน้า" ถึงจะตรวจจับจุดแบ่งชุดได้ถูกต้อง)
CREATE OR REPLACE FUNCTION fetch_next_ocr_page_v2()
RETURNS TABLE (page_id INT, batch_id UUID, page_number INT, image_path TEXT) AS $$
BEGIN
    RETURN QUERY
    UPDATE ocr_queue_pages
    SET status = 'processing'
    WHERE id = (
        SELECT qp.id
        FROM ocr_queue_pages qp
        JOIN ocr_upload_batches b ON b.id = qp.batch_id
        WHERE qp.status = 'pending'
        ORDER BY b.created_at ASC, qp.page_number ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    RETURNING id, ocr_queue_pages.batch_id, ocr_queue_pages.page_number, ocr_queue_pages.image_path;
END;
$$ LANGUAGE plpgsql;
