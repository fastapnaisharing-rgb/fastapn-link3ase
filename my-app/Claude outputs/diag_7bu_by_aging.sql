-- เจาะ 7 BU ที่ Dashboard > Report: เทียบ vat_summary_live (งวดล่าสุดของ BU) กับ vat_watchlist_report (pending) แยกตาม Aging เดือน
-- ใช้สูตรจัด Aging เดียวกับ fn_freeze_vat_summary (fn_vat_aging_month + กรณี Accept)
WITH bus AS (SELECT unnest(ARRAY['CMK','OMT','TOP','B2S','CDS','OOF','HCD']) bu),
cur AS (SELECT l.bu, max(l.period_month) p FROM vat_summary_live l JOIN bus b ON b.bu=l.bu GROUP BY l.bu),
s AS (
  SELECT l.bu, COALESCE(l.aging_month,'(null)') am, sum(l.avg_vat) live_avg, sum(l.exp_vat) live_exp
  FROM vat_summary_live l JOIN cur c ON c.bu=l.bu AND c.p=l.period_month GROUP BY 1,2),
r AS (
  SELECT w.bu, COALESCE(fn_vat_aging_month(ea.m, ea.lbl, COALESCE(w.remark,'')),'(null)') am,
         sum(w.avg_vat) rep_avg, sum(w.exp_vat) rep_exp
  FROM vat_watchlist_report w JOIN cur c ON c.bu=w.bu
  CROSS JOIN LATERAL (
    SELECT CASE WHEN COALESCE(w.aging_label,'')='Accept' THEN
             CASE WHEN w.payment_date IS NULL THEN NULL
                  ELSE ((EXTRACT(YEAR FROM (c.p||'-01')::date) - EXTRACT(YEAR FROM w.payment_date)) * 12
                      + (EXTRACT(MONTH FROM (c.p||'-01')::date) - EXTRACT(MONTH FROM w.payment_date)))::int END
           ELSE w.aging_months END AS m,
           CASE WHEN COALESCE(w.aging_label,'')='Accept' THEN '' ELSE COALESCE(w.aging_label,'') END AS lbl) ea
  WHERE w.status='pending' AND w.bus_type IN ('CPN','ITC','LAND','OTH','UTL')
  GROUP BY 1,2)
SELECT COALESCE(s.bu,r.bu) bu, COALESCE(s.am,r.am) aging_month,
       round(COALESCE(s.live_avg,0),2) live_avg, round(COALESCE(r.rep_avg,0),2) report_avg,
       round(COALESCE(s.live_avg,0)-COALESCE(r.rep_avg,0),2) diff_avg,
       round(COALESCE(s.live_exp,0),2) live_exp, round(COALESCE(r.rep_exp,0),2) report_exp
FROM s FULL JOIN r ON r.bu=s.bu AND r.am=s.am
WHERE abs(COALESCE(s.live_avg,0)-COALESCE(r.rep_avg,0)) > 0.005 OR abs(COALESCE(s.live_exp,0)-COALESCE(r.rep_exp,0)) > 0.005
ORDER BY 1,2;
