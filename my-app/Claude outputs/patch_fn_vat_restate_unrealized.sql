-- MARKER_DB_VAT_RESTATE_UNREALIZED_V1
-- fn_vat_restate_unrealized(p_period, p_bu, p_user, p_confirm)
--   Note (accept_with_condition) ที่บันทึกหลังปิดงวด -> ปรับ Unrealized ของ Final งวดที่ปิดล่าสุด (รายคู่ BU + งวด)
--   ใบที่ "Expired ณ งวดนั้น" (อยู่ใน Detail ที่ Freeze ไว้ + is_expired) และตอนนี้เป็น Accept ใน vat_watchlist_report
--   จะถูกย้ายจาก Realized -> Unrealized (ยอด Expired รวมเท่าเดิม ทุกใบยังอยู่ช่อง Aging เดิม ตามอายุจริงจาก payment_date)
--   กรอบเวลาใช้ fn_vat_freeze_window เดิม: grace(<=20 วัน) ทำได้ | confirm(21-30 วัน) ต้อง p_confirm=true | locked ไม่ทำ
--   Idempotent: ไม่มีใบให้ย้าย -> 'unchanged' ไม่ขึ้นเวอร์ชันใหม่
--   ขึ้นเวอร์ชัน Final ใหม่ (+1) เก็บ Final เดิมเข้า vat_summary_frozen_history และ Detail เวอร์ชันเดิมไว้ (เหมือน re-freeze ปกติ)
--   Rollback ทั้งก้อนอัตโนมัติถ้ายอดไม่ตรง (RAISE EXCEPTION)

CREATE OR REPLACE FUNCTION public.fn_vat_restate_unrealized(
  p_period  text,
  p_bu      text,
  p_user    text,
  p_confirm boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_eff        text;
  v_win        jsonb;
  v_ver        integer;
  v_new        integer;
  v_period_date date;
  v_n          integer;
  v_moved_exp  numeric;
  v_moved_avg  numeric;
  v_exp0 numeric; v_avg0 numeric; v_exp1 numeric; v_avg1 numeric;
  v_rows       integer;
  v_tot_expired numeric;
  v_unreal_exp numeric;
  v_sum_subset numeric;
  v_detail_sum numeric;
BEGIN
  v_eff := fn_vat_effective_period_month(p_bu);
  IF v_eff IS NULL THEN
    RETURN jsonb_build_object('bu', p_bu, 'period', p_period, 'action', 'skipped_no_period');
  END IF;
  IF p_period >= v_eff THEN
    RETURN jsonb_build_object('bu', p_bu, 'period', p_period, 'action', 'skipped_open');
  END IF;

  v_win := fn_vat_freeze_window(p_period, p_bu);
  IF v_win->>'state' IN ('locked', 'unknown') OR v_win->>'state' IS NULL THEN
    RETURN jsonb_build_object('bu', p_bu, 'period', p_period, 'action', 'locked', 'window', v_win);
  END IF;
  IF v_win->>'state' = 'confirm' AND NOT p_confirm THEN
    RETURN jsonb_build_object('bu', p_bu, 'period', p_period, 'action', 'needs_confirm', 'window', v_win);
  END IF;
  IF v_win->>'state' NOT IN ('grace', 'confirm') THEN
    RETURN jsonb_build_object('bu', p_bu, 'period', p_period, 'action', 'skipped_state', 'window', v_win);
  END IF;

  SELECT max(freeze_version) INTO v_ver
  FROM vat_summary_frozen
  WHERE period_month = p_period AND bu = p_bu AND freeze_status = 'final';
  IF v_ver IS NULL THEN
    RETURN jsonb_build_object('bu', p_bu, 'period', p_period, 'action', 'skipped_not_final');
  END IF;

  v_period_date := (p_period || '-01')::date;

  -- ใบที่ต้องย้าย: Expired ณ งวดนั้น (Detail ที่ Freeze ไว้) + ตอนนี้เป็น Accept (มี Note) และยัง Pending
  DROP TABLE IF EXISTS _vat_restate_cand;
  CREATE TEMP TABLE _vat_restate_cand ON COMMIT DROP AS
  SELECT
    d.id AS did,
    d.bus_type, d.payment_type, d.exp_amount, d.exp_vat, d.avg_amount, d.avg_vat,
    d.aging_month_actual AS old_aging_month,
    (COALESCE(d.remark, '') = 'Check Return')          AS old_cheque,
    r.remark AS new_remark, r.note AS new_note,
    (COALESCE(r.remark, '') = 'Check Return')          AS new_cheque,
    x.new_aging_month,
    CASE COALESCE(r.remark, '') WHEN 'Check Return' THEN 'Check Return' WHEN 'Issue' THEN 'Issue' ELSE 'Other' END AS new_reason,
    CASE
      WHEN UPPER(TRIM(vc."TYPE")) IN ('CPN','ITC','LAND','UTL') THEN UPPER(TRIM(vc."TYPE"))
      WHEN UPPER(TRIM(d.bus_type)) IN ('CPN','ITC','LAND','UTL') THEN UPPER(TRIM(d.bus_type))
      ELSE 'OTH'
    END AS true_type
  FROM vat_watchlist_frozen_detail d
  JOIN vat_watchlist_report r
    ON r.id = d.src_id AND r.bu = p_bu AND r.status = 'pending' AND COALESCE(r.aging_label, '') = 'Accept'
  CROSS JOIN LATERAL (
    SELECT fn_vat_aging_month(
      CASE WHEN d.payment_date IS NULL THEN NULL
           ELSE ((EXTRACT(YEAR FROM v_period_date) - EXTRACT(YEAR FROM d.payment_date)) * 12
               + (EXTRACT(MONTH FROM v_period_date) - EXTRACT(MONTH FROM d.payment_date)))::int END,
      '', COALESCE(r.remark, '')
    ) AS new_aging_month
  ) x
  LEFT JOIN LATERAL (
    SELECT c."TYPE" FROM vendor_category c WHERE TRIM(c."Code") = TRIM(d.supplier_code) LIMIT 1
  ) vc ON true
  WHERE d.period_month = p_period AND d.bu = p_bu AND d.freeze_version = v_ver
    AND d.unrealized_reason IS NULL
    AND d.is_expired = true;

  SELECT count(*), COALESCE(sum(exp_vat), 0), COALESCE(sum(avg_vat), 0)
    INTO v_n, v_moved_exp, v_moved_avg FROM _vat_restate_cand;
  IF v_n = 0 THEN
    RETURN jsonb_build_object('bu', p_bu, 'period', p_period, 'action', 'unchanged', 'version', v_ver);
  END IF;

  SELECT COALESCE(sum(exp_vat), 0), COALESCE(sum(avg_vat), 0) INTO v_exp0, v_avg0
  FROM vat_summary_frozen WHERE period_month = p_period AND bu = p_bu AND freeze_version = v_ver;

  v_new := v_ver + 1;

  -- Summary ใหม่ = Summary เดิม - (ใบที่ย้าย ตาม Key เดิม) + (ใบที่ย้าย ตาม Key ใหม่ ที่มี unrealized_reason)
  DROP TABLE IF EXISTS _vat_restate_sum;
  CREATE TEMP TABLE _vat_restate_sum ON COMMIT DROP AS
  SELECT bus_type, aging_month, aging_risk, payment_type, payment_group, is_cheque_return, true_type, unrealized_reason,
         sum(ic)::int AS invoice_count, sum(ea) AS exp_amount, sum(ev) AS exp_vat, sum(aa) AS avg_amount, sum(av) AS avg_vat
  FROM (
    SELECT bus_type, aging_month, aging_risk, payment_type, payment_group, is_cheque_return, true_type, unrealized_reason,
           invoice_count AS ic, exp_amount AS ea, exp_vat AS ev, avg_amount AS aa, avg_vat AS av
    FROM vat_summary_frozen
    WHERE period_month = p_period AND bu = p_bu AND freeze_version = v_ver
    UNION ALL
    SELECT c.bus_type, c.old_aging_month, fn_vat_aging_risk(c.old_aging_month),
           c.payment_type, fn_vat_payment_group(c.old_aging_month, c.payment_type), c.old_cheque, c.true_type, NULL::text,
           -count(*)::int, -sum(c.exp_amount), -sum(c.exp_vat), -sum(c.avg_amount), -sum(c.avg_vat)
    FROM _vat_restate_cand c
    GROUP BY c.bus_type, c.old_aging_month, c.payment_type, c.old_cheque, c.true_type
    UNION ALL
    SELECT c.bus_type, c.new_aging_month, fn_vat_aging_risk(c.new_aging_month),
           c.payment_type, fn_vat_payment_group(c.new_aging_month, c.payment_type), c.new_cheque, c.true_type, c.new_reason,
           count(*)::int, sum(c.exp_amount), sum(c.exp_vat), sum(c.avg_amount), sum(c.avg_vat)
    FROM _vat_restate_cand c
    GROUP BY c.bus_type, c.new_aging_month, c.payment_type, c.new_cheque, c.true_type, c.new_reason
  ) u
  GROUP BY bus_type, aging_month, aging_risk, payment_type, payment_group, is_cheque_return, true_type, unrealized_reason;

  -- กลุ่มที่ Key ไม่ตรง (ติดลบ/ยอดค้าง) = Rollback ทั้งก้อน
  IF EXISTS (SELECT 1 FROM _vat_restate_sum WHERE invoice_count < 0
             OR (invoice_count = 0 AND (abs(exp_vat) > 0.005 OR abs(avg_vat) > 0.005 OR abs(exp_amount) > 0.005 OR abs(avg_amount) > 0.005))) THEN
    RAISE EXCEPTION 'restate: Key ของใบที่ย้ายไม่ตรงกับ Summary เดิม (BU %, งวด %) -- ยกเลิก ไม่มีการเปลี่ยนแปลง', p_bu, p_period;
  END IF;
  DELETE FROM _vat_restate_sum WHERE invoice_count = 0;

  -- เก็บ Final เดิมเข้า History (เหมือน fn_freeze_vat_summary ตอน re-freeze)
  INSERT INTO vat_summary_frozen_history (archived_by, id, period_month, bu, bus_type, aging_month, aging_risk,
      payment_type, payment_group, invoice_count, exp_amount, exp_vat, avg_amount, avg_vat, frozen_at, frozen_by,
      true_type, is_cheque_return, unrealized_reason, freeze_version, trigger_type, refreeze_count, freeze_status)
  SELECT p_user, id, period_month, bu, bus_type, aging_month, aging_risk,
      payment_type, payment_group, invoice_count, exp_amount, exp_vat, avg_amount, avg_vat, frozen_at, frozen_by,
      true_type, is_cheque_return, unrealized_reason, freeze_version, trigger_type, refreeze_count, freeze_status
  FROM vat_summary_frozen WHERE period_month = p_period AND bu = p_bu;

  DELETE FROM vat_summary_frozen WHERE period_month = p_period AND bu = p_bu;

  INSERT INTO vat_summary_frozen (period_month, bu, bus_type, aging_month, aging_risk, payment_type, payment_group,
      invoice_count, exp_amount, exp_vat, avg_amount, avg_vat, frozen_at, frozen_by, true_type,
      is_cheque_return, unrealized_reason, freeze_version, trigger_type, refreeze_count, freeze_status)
  SELECT p_period, p_bu, bus_type, aging_month, aging_risk, payment_type, payment_group,
      invoice_count, exp_amount, exp_vat, avg_amount, avg_vat, now(), p_user, true_type,
      is_cheque_return, unrealized_reason, v_new, 'manual', GREATEST(v_new - 1, 0), 'final'
  FROM _vat_restate_sum;

  -- Detail เวอร์ชันใหม่ = สำเนา Detail เวอร์ชันเดิม + ใบที่ย้ายเปลี่ยนเป็น Accept/Unrealized
  INSERT INTO vat_watchlist_frozen_detail (period_month, bu, freeze_version, frozen_at, src_id, invoice_ref, supplier_code, vendor_name,
      doc_date, payment_date, check_no, bus_type, payment_type, exp_amount, exp_vat, avg_amount, avg_vat,
      aging_label, aging_months_stored, aging_month_actual, is_expired, remark, note, unrealized_reason)
  SELECT d.period_month, d.bu, v_new, now(), d.src_id, d.invoice_ref, d.supplier_code, d.vendor_name,
      d.doc_date, d.payment_date, d.check_no, d.bus_type, d.payment_type, d.exp_amount, d.exp_vat, d.avg_amount, d.avg_vat,
      CASE WHEN c.did IS NULL THEN d.aging_label ELSE 'Accept' END,
      CASE WHEN c.did IS NULL THEN d.aging_months_stored ELSE NULL END,
      CASE WHEN c.did IS NULL THEN d.aging_month_actual ELSE c.new_aging_month END,
      CASE WHEN c.did IS NULL THEN d.is_expired ELSE (c.new_aging_month = 'Expired') END,
      CASE WHEN c.did IS NULL THEN d.remark ELSE c.new_remark END,
      CASE WHEN c.did IS NULL THEN d.note ELSE c.new_note END,
      CASE WHEN c.did IS NULL THEN d.unrealized_reason ELSE c.new_reason END
  FROM vat_watchlist_frozen_detail d
  LEFT JOIN _vat_restate_cand c ON c.did = d.id
  WHERE d.period_month = p_period AND d.bu = p_bu AND d.freeze_version = v_ver;

  -- ตรวจ: ยอดรวมต้องเท่าเดิม และ Detail ต้องตรง Summary (เหมือนตรวจตอน Freeze ปกติ)
  SELECT count(*), COALESCE(sum(exp_vat), 0), COALESCE(sum(avg_vat), 0) INTO v_rows, v_exp1, v_avg1
  FROM vat_summary_frozen WHERE period_month = p_period AND bu = p_bu AND freeze_version = v_new;
  IF abs(v_exp1 - v_exp0) > 0.005 OR abs(v_avg1 - v_avg0) > 0.005 THEN
    RAISE EXCEPTION 'restate: ยอดรวมเปลี่ยน (exp % -> %, avg % -> %) -- ยกเลิก', v_exp0, v_exp1, v_avg0, v_avg1;
  END IF;

  SELECT COALESCE(sum(exp_vat) FILTER (WHERE aging_risk = 'Expired'), 0),
         COALESCE(sum(exp_vat) FILTER (WHERE aging_risk = 'Expired' AND unrealized_reason IS NOT NULL), 0),
         COALESCE(sum(exp_vat) FILTER (WHERE aging_risk = 'Expired' OR unrealized_reason IS NOT NULL), 0)
    INTO v_tot_expired, v_unreal_exp, v_sum_subset
  FROM vat_summary_frozen WHERE period_month = p_period AND bu = p_bu AND freeze_version = v_new;

  SELECT COALESCE(sum(exp_vat), 0) INTO v_detail_sum
  FROM vat_watchlist_frozen_detail WHERE period_month = p_period AND bu = p_bu AND freeze_version = v_new;
  IF abs(v_detail_sum - v_sum_subset) > 0.005 THEN
    RAISE EXCEPTION 'restate: ยอดรายใบกำกับไม่ตรงยอดสรุป (detail % vs summary %) -- ยกเลิก', v_detail_sum, v_sum_subset;
  END IF;

  INSERT INTO vat_freeze_log (period_month, bu, freeze_version, trigger_type, frozen_by, row_count,
      total_exp_vat, total_avg_vat, total_expired, unrealized_in_expired, note)
  VALUES (p_period, p_bu, v_new, 'manual', p_user, v_rows, v_exp1, v_avg1, v_tot_expired, v_unreal_exp,
      'restate unrealized from notes (' || v_n || ' invoices, exp_vat ' || v_moved_exp || ')');

  RETURN jsonb_build_object('bu', p_bu, 'period', p_period, 'action', 'restated', 'version', v_new,
      'moved_invoices', v_n, 'moved_exp_vat', v_moved_exp, 'moved_avg_vat', v_moved_avg,
      'total_expired', v_tot_expired, 'unrealized_in_expired', v_unreal_exp);
END;
$function$;
