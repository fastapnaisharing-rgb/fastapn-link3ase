-- เทียบยอด Claim (avg_vat) รายBU: ฝั่ง Dashboard (vat_summary_live งวดล่าสุด + Final ทับถ้ามี, Scope Aging) vs ฝั่ง Report (Ops: pending, Aging >=1 หรือ Accept)
WITH cur AS (SELECT bu, max(period_month) p FROM vat_summary_live GROUP BY bu),
fz AS (SELECT DISTINCT ON (bu, period_month) bu, period_month, freeze_version
       FROM vat_summary_frozen WHERE freeze_status='final' ORDER BY bu, period_month, freeze_version DESC),
dash_rows AS (
  SELECT c.bu, s.aging_risk, s.payment_type, s.bus_type, s.is_cheque_return, s.avg_vat
  FROM cur c JOIN vat_summary_live s ON s.bu=c.bu AND s.period_month=c.p
  WHERE NOT EXISTS (SELECT 1 FROM fz WHERE fz.bu=c.bu AND fz.period_month=c.p)
  UNION ALL
  SELECT c.bu, f.aging_risk, f.payment_type, f.bus_type, f.is_cheque_return, f.avg_vat
  FROM cur c JOIN fz ON fz.bu=c.bu AND fz.period_month=c.p
  JOIN vat_summary_frozen f ON f.bu=fz.bu AND f.period_month=fz.period_month AND f.freeze_version=fz.freeze_version),
d AS (
  SELECT bu, sum(avg_vat) dash_v FROM dash_rows
  WHERE aging_risk IS DISTINCT FROM 'No Risk'
    AND NOT (aging_risk IS DISTINCT FROM 'Expired' AND NOT COALESCE(is_cheque_return,false)
             AND (payment_type='Unpaid' OR bus_type IN ('N-PAY','N-PO3')))
  GROUP BY bu),
r AS (
  SELECT bu, sum(avg_vat) rep_v FROM vat_watchlist_report
  WHERE status='pending' AND bus_type IN ('CPN','ITC','LAND','OTH','UTL')
    AND (aging_months >= 1 OR (aging_label='Accept' AND aging_months IS NULL))
  GROUP BY bu),
j AS (SELECT COALESCE(d.bu,r.bu) bu, COALESCE(d.dash_v,0) dash_v, COALESCE(r.rep_v,0) rep_v FROM d FULL JOIN r ON r.bu=d.bu)
SELECT bu, round(dash_v,2) dashboard, round(rep_v,2) report, round(dash_v-rep_v,2) diff FROM j WHERE abs(dash_v-rep_v) > 0.005
UNION ALL
SELECT 'TOTAL', round(sum(dash_v),2), round(sum(rep_v),2), round(sum(dash_v-rep_v),2) FROM j
ORDER BY 4 DESC NULLS LAST;
