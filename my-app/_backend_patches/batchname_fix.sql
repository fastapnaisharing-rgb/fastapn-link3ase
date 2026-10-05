-- ============================================================
-- Fix: Batch Name ซ้ำ (CTD-NMR-260928-OTH/KHAW-001)  -- รัน "ก่อน" Deploy โค้ดใหม่ หรือหลังก็ได้ แต่ Step 4 ต้องรันหลัง Step 2-3
-- รันทีละ Step ใน pgAdmin (ตรวจผลก่อนไป Step ถัดไป)
-- ============================================================

-- STEP 1: ดูว่า Invoice ของทั้ง 2 ชุดปนกันอยู่แค่ไหน (ยังไม่แก้อะไร)
SELECT batch_id, status, exported_at, COUNT(*) AS cnt, SUM(net::numeric) AS total
FROM bucket_list
WHERE batch_id = 'CTD-NMR-260928-OTH/KHAW-001'
GROUP BY batch_id, status, exported_at
ORDER BY exported_at;
-- ชุดแรก (4,661.00) Export ~ 28/09 00:02 น. / ชุดที่สอง (596,839.83) Export ~ 28/09 09:23 น.
-- ถ้ายอดรวมแยกตามเวลา exported_at ตรงกับ 2 ชุดนี้ ไปต่อ Step 2

-- STEP 2: เปลี่ยนชื่อ "ชุดที่สอง" (id 28832a85...) เป็น -002
BEGIN;
UPDATE batch_list
   SET batch_id = 'CTD-NMR-260928-OTH/KHAW-002'
 WHERE id = '28832a85-e412-4870-82a3-60469f357725'
   AND batch_id = 'CTD-NMR-260928-OTH/KHAW-001';          -- ต้องได้ 1 row

UPDATE bucket_list
   SET batch_id = 'CTD-NMR-260928-OTH/KHAW-002'
 WHERE batch_id = 'CTD-NMR-260928-OTH/KHAW-001'
   AND exported_at >= '2026-09-28 09:00:00+07';            -- ปรับเวลาให้ตรงตามผล Step 1 ก่อนรัน
-- ตรวจ: ยอดรวมของ -002 ต้องได้ ~596,839.83 และ -001 ~4,661.00
SELECT batch_id, COUNT(*), SUM(net::numeric) FROM bucket_list
 WHERE batch_id LIKE 'CTD-NMR-260928-OTH/KHAW-00%' GROUP BY batch_id;
-- ถ้าถูกต้อง: COMMIT;   ถ้าไม่: ROLLBACK;

-- STEP 3: ตารางที่อ้าง batch_id ด้วย (ต้องเช็คเองว่าแถวไหนเป็นของชุดไหน ก่อนย้าย)
SELECT * FROM batch_comments  WHERE batch_id = 'CTD-NMR-260928-OTH/KHAW-001';
SELECT * FROM batch_email_log WHERE batch_id = 'CTD-NMR-260928-OTH/KHAW-001';
-- ไฟล์ Excel ที่ /file-storage/generate ใช้ refId = ชื่อ Batch (ชุดที่สองอาจเขียนทับหรือ Link ซ้ำกับชุดแรก) -> ตรวจในหน้า Attachment

-- STEP 4: สร้าง Unique Index กันซ้ำถาวร (จะ Fail ถ้ายังมีชื่อซ้ำเหลืออยู่ -> กลับไปเช็ค Step 1-2)
SELECT batch_id, COUNT(*) FROM batch_list GROUP BY batch_id HAVING COUNT(*) > 1;   -- ต้องไม่มีแถว
CREATE UNIQUE INDEX IF NOT EXISTS uq_batch_list_batch_id ON batch_list (batch_id);
