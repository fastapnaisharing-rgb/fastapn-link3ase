-- MARKER_DB_RECOMPUTE_USE_DATA_PERIOD_V1
-- fn_recompute_vat_summary_for_bu: งวดของ Live = เดือนของข้อมูลจริงใน Report ของ BU
--   เดิม: ใช้ fn_vat_effective_period_month(BU) (= เดือนใหม่ทันทีหลังปิดงวด) ทั้งที่ Report ของ BU ยังเป็นเดือนเก่า
--         -> Note ที่บันทึกหลังปิดงวดสร้างแถว Live "เดือนใหม่" ปลอมๆ จากข้อมูลเดือนเก่า (อายุคำนวณเทียบเดือนใหม่) ซ้ำกับแถวเดือนเก่า
--   ใหม่: ถ้ายังไม่มีแถว Report (pending) ของเดือนใหม่เข้ามาเลย (max(period) < งวดที่ระบบตอบ) ให้ใช้ max(period) ของ Report เป็นงวดของ Live
--         พอ Import เดือนใหม่เข้ามา (max(period) >= งวดที่ระบบตอบ) กลับไปใช้งวดที่ระบบตอบเหมือนเดิม
--   ส่วนอื่นของฟังก์ชันเหมือนเดิมทุกบรรทัด

CREATE OR REPLACE FUNCTION public.fn_recompute_vat_summary_for_bu(p_bu text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_period_month TEXT;
  v_period_date  DATE;
  v_data_month   TEXT;
BEGIN
  v_period_month := fn_vat_effective_period_month(p_bu);

  IF v_period_month IS NULL THEN
    RAISE NOTICE 'ไม่พบ system_settings.vat_period_month หรือรูปแบบไม่ถูกต้อง ข้าม sync ของ BU %', p_bu;
    RETURN;
  END IF;

  -- เดือนของข้อมูลจริงใน Report: ยังไม่มี Incomplete เดือนใหม่เข้ามา -> ยังใช้เดือนเดิม
  SELECT max(w.period) INTO v_data_month
  FROM vat_watchlist_report w
  WHERE w.bu = p_bu AND w.status = 'pending' AND w.period ~ '^\d{4}-\d{2}$';
  IF v_data_month IS NOT NULL AND v_data_month < v_period_month THEN
    v_period_month := v_data_month;
  END IF;

  v_period_date := (v_period_month || '-01')::date;

  DELETE FROM vat_summary_live WHERE period_month = v_period_month AND bu = p_bu;

  INSERT INTO vat_summary_live (
    period_month, bu, bus_type, aging_month, aging_risk, payment_type, payment_group,
    is_cheque_return, true_type, unrealized_reason,
    invoice_count, exp_amount, exp_vat, avg_amount, avg_vat
  )
  SELECT
    v_period_month,
    p_bu,
    COALESCE(NULLIF(w.bus_type, ''), 'OTH')                               AS bus_type,
    fn_vat_aging_month(ea.m, ea.lbl, COALESCE(w.remark, ''))              AS aging_month,
    fn_vat_aging_risk(
      fn_vat_aging_month(ea.m, ea.lbl, COALESCE(w.remark, ''))
    )                                                                     AS aging_risk,
    COALESCE(NULLIF(w.payment_type, ''), 'Unpaid')                        AS payment_type,
    fn_vat_payment_group(
      fn_vat_aging_month(ea.m, ea.lbl, COALESCE(w.remark, '')),
      COALESCE(NULLIF(w.payment_type, ''), 'Unpaid')
    )                                                                     AS payment_group,
    COALESCE(w.remark = 'Check Return', false)                            AS is_cheque_return,
    CASE
      WHEN UPPER(TRIM(vc."TYPE")) IN ('CPN','ITC','LAND','UTL') THEN UPPER(TRIM(vc."TYPE"))
      WHEN UPPER(TRIM(w.bus_type)) IN ('CPN','ITC','LAND','UTL') THEN UPPER(TRIM(w.bus_type))
      ELSE 'OTH'
    END                                                                   AS true_type,
    -- Accept with Condition ทุกใบเก็บเหตุผล (remark แค่ระบุเหตุผล; Check On Hand/อื่นๆ => Other); ไม่ใช่ Accept = NULL
    CASE
      WHEN COALESCE(w.aging_label, '') = 'Accept' THEN
        CASE COALESCE(w.remark, '')
          WHEN 'Check Return' THEN 'Check Return'
          WHEN 'Issue'        THEN 'Issue'
          ELSE 'Other'
        END
      ELSE NULL
    END                                                                   AS unrealized_reason,
    COUNT(*)                                                              AS invoice_count,
    COALESCE(SUM(w.exp_amount), 0)                                        AS exp_amount,
    COALESCE(SUM(w.exp_vat), 0)                                           AS exp_vat,
    COALESCE(SUM(w.avg_amount), 0)                                        AS avg_amount,
    COALESCE(SUM(w.avg_vat), 0)                                           AS avg_vat
  FROM vat_watchlist_report w
  -- อายุที่ใช้จริง: Accept ถูกล้าง aging_months=NULL จึงคำนวณจาก payment_date เทียบเดือนงวด (สูตรเดียวกับ Upload)
  -- Accept ส่ง label '' เข้าฟังก์ชัน เพื่อไม่ให้กฎ "Accept+Check Return => Expired" บังคับ ใช้อายุจริงเท่านั้น
  CROSS JOIN LATERAL (
    SELECT
      CASE
        WHEN COALESCE(w.aging_label, '') = 'Accept' THEN
          CASE WHEN w.payment_date IS NULL THEN NULL
               ELSE ((EXTRACT(YEAR FROM v_period_date) - EXTRACT(YEAR FROM w.payment_date)) * 12
                   + (EXTRACT(MONTH FROM v_period_date) - EXTRACT(MONTH FROM w.payment_date)))::int
          END
        ELSE w.aging_months
      END AS m,
      CASE WHEN COALESCE(w.aging_label, '') = 'Accept' THEN '' ELSE COALESCE(w.aging_label, '') END AS lbl
  ) ea
  LEFT JOIN LATERAL (
    SELECT c."TYPE" FROM vendor_category c
    WHERE TRIM(c."Code") = TRIM(w.supplier_code)
    LIMIT 1
  ) vc ON true
  WHERE w.bu = p_bu
    AND w.status = 'pending'
  GROUP BY 1,2,3,4,5,6,7,8,9,10;

  UPDATE vat_summary_live SET last_calculated_at = now()
  WHERE period_month = v_period_month AND bu = p_bu;

  -- Freeze (Draft) วิ่งคู่กับ Live: ทุกครั้งที่ Live คำนวณใหม่ ให้ Draft ของงวดเปิดตามไปด้วย (สรุปเท่านั้น เบามาก)
  -- ถ้า Sync พลาด ต้องไม่ทำให้ Live ล้ม
  BEGIN
    PERFORM fn_freeze_vat_sync_draft(p_bu);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fn_freeze_vat_sync_draft(%) ล้มเหลว: %', p_bu, SQLERRM;
  END;
END;
$function$;
