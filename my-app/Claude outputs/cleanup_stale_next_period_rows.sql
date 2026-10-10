-- MARKER_DB_CLEANUP_STALE_NEXT_PERIOD_V1
-- เก็บกวาดแถวงวดใหม่ (เช่น 2026-10) ที่เกิดผิดๆ ของ BU ที่ Report ยังไม่มีข้อมูลงวดนั้นเลย
-- รัน "หลัง" วาง fn_recompute_vat_summary_for_bu ตัวใหม่ แล้วรันทั้งไฟล์ในหน้าต่างเดียว (Transaction เดียว) ดูผลลัพธ์ก่อน COMMIT
-- เปลี่ยน '2026-10' ถ้าเป็นเดือนอื่น
BEGIN;

CREATE TEMP TABLE _stale ON COMMIT DROP AS
SELECT DISTINCT l.bu
FROM vat_summary_live l
WHERE l.period_month = '2026-10'
  AND NOT EXISTS (SELECT 1 FROM vat_watchlist_report w WHERE w.bu = l.bu AND w.period = '2026-10');

SELECT 'BU ที่จะเก็บกวาด' AS what, string_agg(bu, ', ' ORDER BY bu) AS value FROM _stale;

-- รายการ Detail ของ Draft งวดนั้น (ถ้ามี) ต้องลบก่อน Summary
DELETE FROM vat_watchlist_frozen_detail d
USING vat_summary_frozen f
WHERE d.period_month = '2026-10' AND d.bu IN (SELECT bu FROM _stale)
  AND f.period_month = d.period_month AND f.bu = d.bu AND f.freeze_version = d.freeze_version AND f.freeze_status = 'draft';

DELETE FROM vat_summary_frozen WHERE period_month = '2026-10' AND freeze_status = 'draft' AND bu IN (SELECT bu FROM _stale);
DELETE FROM vat_summary_live   WHERE period_month = '2026-10' AND bu IN (SELECT bu FROM _stale);

-- คำนวณ Live เดือนเดิมของ BU เหล่านี้ใหม่ ให้สะท้อน Note ล่าสุด (ฟังก์ชันตัวใหม่ใช้เดือนของข้อมูลจริง)
SELECT fn_recompute_vat_summary_for_bu(bu) FROM _stale;

-- ตรวจผล: ไม่ควรเหลือ BU ไหนมี 2 งวดพร้อมกัน ยกเว้นที่ Import งวดใหม่แล้วจริง
SELECT bu, string_agg(DISTINCT period_month, ', ') AS periods FROM vat_summary_live GROUP BY bu HAVING count(DISTINCT period_month) > 1;

-- ถ้าผลถูกต้องให้สั่ง COMMIT; ถ้าไม่ถูกให้สั่ง ROLLBACK
