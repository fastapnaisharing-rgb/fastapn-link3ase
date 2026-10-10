-- purge_expired_recon_inputs.sql
-- ล้าง Input ของ VAT Reconcile อัตโนมัติเมื่อครบ input_expire_at (60 วันนับจาก Confirm)
-- ล้าง: vat_reconcile_input_summary + vat_reconcile_simple_header/detail (Simple 100 / AVG) ของ BU+Account+Period นั้น
-- ไม่แตะ: TB (vat_reconcile_tb) และตัวไฟล์รายงานใน file_storage
-- ใช้ได้ทั้ง pg_cron และ Windows Task Scheduler (psql)

ALTER TABLE file_storage ADD COLUMN IF NOT EXISTS input_purged_at timestamptz;

CREATE OR REPLACE FUNCTION purge_expired_recon_inputs(dry_run boolean DEFAULT true)
RETURNS TABLE(file_id uuid, bu_num text, account text, period text, input_rows bigint, simple_headers bigint, simple_details bigint)
LANGUAGE plpgsql AS $$
DECLARE
  f record;
  v_bu text;
  v_acc text;
  v_per text;
  n_in bigint; n_h bigint; n_d bigint;
BEGIN
  FOR f IN
    SELECT fs.id, fs.bu, fs.ref_id
      FROM file_storage fs
     WHERE fs.module = 'vat-reconcile-report'
       AND fs.confirmed_at IS NOT NULL
       AND fs.input_expire_at IS NOT NULL
       AND fs.input_expire_at <= NOW()
       AND fs.input_purged_at IS NULL
  LOOP
    v_acc := split_part(f.ref_id, '|', 1);
    v_per := split_part(f.ref_id, '|', 2);
    IF v_acc = '' OR v_per = '' THEN CONTINUE; END IF;

    -- file_storage.bu เก็บชื่อสั้น -> แปลงเป็นเลข BU เหมือน resolveBuToNumeric ใน Backend
    IF f.bu ~ '^\d+$' THEN
      v_bu := f.bu;
    ELSE
      SELECT split_part(cl."COMPANY CODE", '-', 3) INTO v_bu
        FROM company_list cl
       WHERE cl.bu = f.bu AND cl.deleted IS NOT TRUE
       LIMIT 1;
    END IF;
    IF v_bu IS NULL OR v_bu = '' THEN
      RAISE NOTICE 'ข้าม file_id=% : แปลง BU % เป็นเลขไม่ได้', f.id, f.bu;
      CONTINUE;
    END IF;

    SELECT count(*) INTO n_in FROM vat_reconcile_input_summary s
      WHERE s.bu = v_bu AND s.reconcile_account = v_acc AND s.period = v_per;
    SELECT count(*) INTO n_h FROM vat_reconcile_simple_header h
      WHERE h.bu = v_bu AND h.reconcile_account = v_acc AND h.period = v_per;
    SELECT count(*) INTO n_d FROM vat_reconcile_simple_detail d
      WHERE d.header_id IN (SELECT h.id FROM vat_reconcile_simple_header h
                             WHERE h.bu = v_bu AND h.reconcile_account = v_acc AND h.period = v_per);

    IF NOT dry_run THEN
      DELETE FROM vat_reconcile_simple_detail d
       WHERE d.header_id IN (SELECT h.id FROM vat_reconcile_simple_header h
                              WHERE h.bu = v_bu AND h.reconcile_account = v_acc AND h.period = v_per);
      DELETE FROM vat_reconcile_simple_header h
       WHERE h.bu = v_bu AND h.reconcile_account = v_acc AND h.period = v_per;
      DELETE FROM vat_reconcile_input_summary s
       WHERE s.bu = v_bu AND s.reconcile_account = v_acc AND s.period = v_per;
      UPDATE file_storage SET input_purged_at = NOW() WHERE id = f.id;
    END IF;

    file_id := f.id; bu_num := v_bu; account := v_acc; period := v_per;
    input_rows := n_in; simple_headers := n_h; simple_details := n_d;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- 1) ทดสอบก่อน (ไม่ลบจริง ดูว่าจะล้างอะไรบ้าง):
--      SELECT * FROM purge_expired_recon_inputs(true);
-- 2) ลบจริง:
--      SELECT * FROM purge_expired_recon_inputs(false);
-- 3) ตั้งเวลา (เลือกอย่างใดอย่างหนึ่ง)
--    pg_cron (ทุกวัน 02:00):
--      SELECT cron.schedule('purge-recon-inputs', '0 2 * * *', $$SELECT purge_expired_recon_inputs(false)$$);
--    Task Scheduler:
--      psql -h <host> -U <user> -d <db> -c "SELECT * FROM purge_expired_recon_inputs(false)"
