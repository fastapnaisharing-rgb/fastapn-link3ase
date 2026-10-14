-- Lost Period: BU ที่ปิดงวดแล้วแต่ยังไม่เข้างวดใหม่ (งวดล่าสุดใน vat_summary_live ของ BU = p_period)
-- ให้ fn_vat_freeze_window(p_period, p_bu) คืน 'grace' ตลอด ไม่ผูก 20/30 วัน -> Auto Freeze ซิงค์ Final ตาม Report ได้ต่อเนื่อง
-- ไม่กระทบ: กรณีไม่ส่ง p_bu (late_update ระดับระบบ) / งวดเก่ากว่างวดที่ปิดล่าสุด / ไม่พบวันที่ปิด
-- ย้อนกลับ: รันฟังก์ชันเดิมที่ได้จาก pg_get_functiondef อีกครั้ง
CREATE OR REPLACE FUNCTION public.fn_vat_freeze_window(p_period text, p_bu text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_closed    text;
  v_eff       text;
  v_last_closed text;
  v_closed_at timestamptz;
  v_days      numeric;
  v_state     text;
BEGIN
  SELECT value INTO v_closed FROM system_settings WHERE key = 'vat_period_month';
  IF v_closed IS NULL THEN RETURN jsonb_build_object('state', 'unknown'); END IF;
  IF p_bu IS NULL THEN
    v_eff := to_char(((v_closed || '-01')::date + interval '1 month'), 'YYYY-MM');
  ELSE
    v_eff := fn_vat_effective_period_month(p_bu);
    IF v_eff IS NULL THEN RETURN jsonb_build_object('state', 'unknown'); END IF;
  END IF;
  IF p_period >= v_eff THEN RETURN jsonb_build_object('state', 'open'); END IF;
  v_last_closed := to_char(((v_eff || '-01')::date - interval '1 month'), 'YYYY-MM');
  IF p_period < v_last_closed THEN RETURN jsonb_build_object('state', 'locked', 'reason', 'เก่ากว่างวดที่ปิดล่าสุดของ BU'); END IF;
  BEGIN
    SELECT value::timestamptz INTO v_closed_at FROM system_settings WHERE key = 'vat_period_closed_at';
  EXCEPTION WHEN OTHERS THEN v_closed_at := NULL;
  END;
  IF v_closed_at IS NULL THEN RETURN jsonb_build_object('state', 'locked', 'reason', 'ไม่พบวันที่ปิด Period'); END IF;
  v_days := EXTRACT(EPOCH FROM (now() - v_closed_at)) / 86400.0;
  v_state := CASE WHEN v_days <= 20 THEN 'grace' WHEN v_days <= 30 THEN 'confirm' ELSE 'locked' END;
  -- Lost Period: BU ยังไม่มีข้อมูลงวดใหม่ (งวดล่าสุดของ BU ยังเป็น p_period) -> Freeze ได้เลย
  IF v_state <> 'grace' AND p_bu IS NOT NULL
     AND (SELECT max(period_month) FROM vat_summary_live WHERE bu = p_bu) = p_period THEN
    RETURN jsonb_build_object('state', 'grace', 'lost_period', true, 'days_since_close', round(v_days, 1));
  END IF;
  RETURN jsonb_build_object('state', v_state, 'days_since_close', round(v_days, 1));
END;
$function$;
