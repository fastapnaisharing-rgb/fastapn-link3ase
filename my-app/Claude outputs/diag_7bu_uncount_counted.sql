-- ส่วนต่างอยู่ที่ aging_month='Uncount' ของ 7 BU: เจาะเฉพาะแถวที่ Dashboard "นับ" (ไม่ใช่ Unpaid, ไม่ใช่ No Risk) ฝั่ง Live เทียบฝั่ง Report
WITH bus AS (SELECT unnest(ARRAY['CMK','OMT','TOP','B2S','CDS','OOF','HCD']) bu),
cur AS (SELECT l.bu, max(l.period_month) p FROM vat_summary_live l JOIN bus b ON b.bu=l.bu GROUP BY l.bu)
SELECT 'live' src, l.bu, l.bus_type, l.payment_type, l.aging_risk AS aging_risk_or_label, COALESCE(l.is_cheque_return,false) AS chq,
       l.true_type AS true_type_or_status, round(sum(l.avg_vat),2) avg_vat, sum(l.invoice_count) inv
FROM vat_summary_live l JOIN cur c ON c.bu=l.bu AND c.p=l.period_month
WHERE l.aging_month='Uncount' AND l.aging_risk IS DISTINCT FROM 'No Risk'
  AND NOT (l.aging_risk IS DISTINCT FROM 'Expired' AND NOT COALESCE(l.is_cheque_return,false)
           AND (l.payment_type='Unpaid' OR l.bus_type IN ('N-PAY','N-PO3')))
GROUP BY 1,2,3,4,5,6,7
UNION ALL
SELECT 'report', w.bu, w.bus_type, w.payment_type, COALESCE(w.aging_label,''), (COALESCE(w.remark,'') ILIKE '%check return%'),
       w.status, round(sum(w.avg_vat),2), count(*)
FROM vat_watchlist_report w JOIN bus b ON b.bu=w.bu
WHERE COALESCE(w.aging_months,-1) < 1 AND NOT (COALESCE(w.aging_label,'')='Accept' AND w.aging_months IS NULL)
  AND NOT (COALESCE(w.remark,'') NOT ILIKE '%check return%' AND (w.payment_type='Unpaid' OR w.bus_type IN ('N-PAY','N-PO3')))
GROUP BY 1,2,3,4,5,6,7
ORDER BY 2,1,3,4;
