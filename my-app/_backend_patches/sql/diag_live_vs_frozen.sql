-- เทียบรายแถว Live vs Final ของ 4 BU (งวด 2026-09) หาแถวที่ต่าง
WITH l AS (
  SELECT bu, COALESCE(bus_type,'') bus_type, COALESCE(aging_month,'') aging_month, COALESCE(aging_risk,'') aging_risk,
         COALESCE(payment_type,'') payment_type, COALESCE(payment_group,'') payment_group, COALESCE(true_type,'') true_type,
         COALESCE(is_cheque_return::text,'') chq, COALESCE(unrealized_reason,'') unreal,
         sum(exp_vat) exp_vat, sum(avg_vat) avg_vat, sum(invoice_count) inv
  FROM vat_summary_live WHERE period_month='2026-09' AND bu IN ('CRG','OFM','OMT','PNM') GROUP BY 1,2,3,4,5,6,7,8),
f AS (
  SELECT bu, COALESCE(bus_type,'') bus_type, COALESCE(aging_month,'') aging_month, COALESCE(aging_risk,'') aging_risk,
         COALESCE(payment_type,'') payment_type, COALESCE(payment_group,'') payment_group, COALESCE(true_type,'') true_type,
         COALESCE(is_cheque_return::text,'') chq, COALESCE(unrealized_reason,'') unreal,
         sum(exp_vat) exp_vat, sum(avg_vat) avg_vat, sum(invoice_count) inv
  FROM vat_summary_frozen f WHERE period_month='2026-09' AND bu IN ('CRG','OFM','OMT','PNM')
    AND freeze_version=(SELECT max(freeze_version) FROM vat_summary_frozen x WHERE x.period_month=f.period_month AND x.bu=f.bu AND x.freeze_status='final') GROUP BY 1,2,3,4,5,6,7,8)
SELECT COALESCE(l.bu,f.bu) bu, COALESCE(l.bus_type,f.bus_type) bus_type, COALESCE(l.aging_month,f.aging_month) aging_month,
       COALESCE(l.aging_risk,f.aging_risk) aging_risk, COALESCE(l.payment_type,f.payment_type) payment_type,
       COALESCE(l.payment_group,f.payment_group) payment_group, COALESCE(l.true_type,f.true_type) true_type,
       l.exp_vat live_exp, f.exp_vat final_exp, l.avg_vat live_avg, f.avg_vat final_avg, l.inv live_inv, f.inv final_inv
FROM l FULL JOIN f USING (bu,bus_type,aging_month,aging_risk,payment_type,payment_group,true_type,chq,unreal)
WHERE l.exp_vat IS DISTINCT FROM f.exp_vat OR l.avg_vat IS DISTINCT FROM f.avg_vat OR l.inv IS DISTINCT FROM f.inv
ORDER BY 1,2,3;
