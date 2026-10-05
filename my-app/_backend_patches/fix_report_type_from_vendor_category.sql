-- ซิงค์ bus_type / sub_type ใน vat_watchlist_report ให้ตรงกับ vendor_category (เฉพาะ status='pending')
-- กติกาเดียวกับตอน Upload: จ่ายแล้ว(payment_date มีค่า) -> ใช้ TYPE/SUB TYPE ; ยังไม่จ่าย -> คงเดิม ยกเว้น TYPE เป็น CPN/ITC -> ใช้ตรงๆ
-- ไม่แตะ receive_doc_no (GRT) และ status อื่น  ** รัน Step 1 ดูก่อน แล้วค่อย Step 2 **

-- Step 1: Preview
SELECT r.supplier_code, r.bus_type AS old_type, r.sub_type AS old_sub,
       v."TYPE" AS new_type, v."SUB TYPE" AS new_sub, COUNT(*) AS rows
FROM vat_watchlist_report r
JOIN vendor_category v ON TRIM(v."Code") = TRIM(r.supplier_code)
WHERE r.status = 'pending'
  AND (
    (COALESCE(TRIM(r.payment_date::text),'') <> '' AND (r.bus_type IS DISTINCT FROM v."TYPE" OR r.sub_type IS DISTINCT FROM COALESCE(NULLIF(v."SUB TYPE",''),'OTH')))
    OR (COALESCE(TRIM(r.payment_date::text),'') = '' AND v."TYPE" IN ('CPN','ITC') AND (r.bus_type IS DISTINCT FROM v."TYPE" OR r.sub_type IS DISTINCT FROM v."TYPE"))
  )
GROUP BY 1,2,3,4,5 ORDER BY rows DESC;

-- Step 2: Backup + Update
CREATE TABLE IF NOT EXISTS bak_vwr_type_20261001 AS
  SELECT id, bus_type, sub_type FROM vat_watchlist_report WHERE status = 'pending';

BEGIN;
UPDATE vat_watchlist_report r
SET bus_type = v."TYPE",
    sub_type = CASE WHEN COALESCE(TRIM(r.payment_date::text),'') = '' THEN v."TYPE"
                    ELSE COALESCE(NULLIF(v."SUB TYPE",''),'OTH') END
FROM vendor_category v
WHERE TRIM(v."Code") = TRIM(r.supplier_code)
  AND r.status = 'pending'
  AND (
    (COALESCE(TRIM(r.payment_date::text),'') <> '' AND (r.bus_type IS DISTINCT FROM v."TYPE" OR r.sub_type IS DISTINCT FROM COALESCE(NULLIF(v."SUB TYPE",''),'OTH')))
    OR (COALESCE(TRIM(r.payment_date::text),'') = '' AND v."TYPE" IN ('CPN','ITC') AND (r.bus_type IS DISTINCT FROM v."TYPE" OR r.sub_type IS DISTINCT FROM v."TYPE"))
  );
-- ดูจำนวนแถวที่ถูกแก้ แล้วเลือก: COMMIT;  หรือ ROLLBACK;
