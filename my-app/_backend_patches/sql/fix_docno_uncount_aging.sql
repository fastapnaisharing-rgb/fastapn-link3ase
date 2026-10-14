-- แก้ Aging ของแถว pending ที่ถูกกฎ doc_no ทับเป็น 'IV-Aging Uncount' ทั้งที่มีวันที่จ่าย (คำนวณตามกฎเดิม: เดือนที่จ่ายเทียบงวดของแถว)
-- ขั้น 1: ดูตัวอย่างก่อน (คาดว่า 20 ใบ / 56,376.59 : Expired 16, Aging 3 = 1, Aging 0 = 3)
WITH x AS (
  SELECT id, bu, invoice_ref, avg_vat,
         ((split_part(period,'-',1)::int - EXTRACT(YEAR FROM payment_date)::int) * 12
          + (split_part(period,'-',2)::int - EXTRACT(MONTH FROM payment_date)::int)) AS diff
  FROM vat_watchlist_report
  WHERE status = 'pending' AND aging_label = 'IV-Aging Uncount' AND payment_date IS NOT NULL
    AND bus_type NOT IN ('N-PAY','N-PO3') AND doc_no IS NOT NULL AND btrim(doc_no) <> ''
)
SELECT CASE WHEN diff <= 0 THEN 'Aging 0 Month' WHEN diff <= 6 THEN 'Aging ' || diff || ' Month' ELSE 'Expired' END AS new_label,
       count(*) AS inv, round(sum(avg_vat),2) AS avg_vat
FROM x GROUP BY 1 ORDER BY 1;

-- ขั้น 2: ถ้าตัวอย่างตรงที่คาด ให้รันบล็อกนี้ (ทั้งก้อน) -- ปรับ aging_months/aging_label ตามวันที่จ่าย
BEGIN;
UPDATE vat_watchlist_report w
SET aging_months = GREATEST(d.diff, 0),
    aging_label  = CASE WHEN d.diff <= 0 THEN 'Aging 0 Month' WHEN d.diff <= 6 THEN 'Aging ' || d.diff || ' Month' ELSE 'Expired' END
FROM (
  SELECT id,
         ((split_part(period,'-',1)::int - EXTRACT(YEAR FROM payment_date)::int) * 12
          + (split_part(period,'-',2)::int - EXTRACT(MONTH FROM payment_date)::int)) AS diff
  FROM vat_watchlist_report
  WHERE status = 'pending' AND aging_label = 'IV-Aging Uncount' AND payment_date IS NOT NULL
    AND bus_type NOT IN ('N-PAY','N-PO3') AND doc_no IS NOT NULL AND btrim(doc_no) <> ''
) d
WHERE w.id = d.id;
-- ตรวจจำนวนแถวที่แก้ (ต้อง = 20) ถ้าไม่ตรงให้ ROLLBACK; ถ้าตรงให้ COMMIT
-- COMMIT;
-- ROLLBACK;
