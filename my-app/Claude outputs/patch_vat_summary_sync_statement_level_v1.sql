-- MARKER_DB_VAT_SUMMARY_SYNC_STATEMENT_LEVEL_V1
-- ปัญหา: trg_vat_watchlist_sync เป็น FOR EACH ROW เรียก fn_recompute_vat_summary_for_bu(bu) ทุกแถว
--        replace_bu (ลบ ~19,500 + Insert ~17,400 แถว) จึง Recompute สรุปของ BU เดิมซ้ำหลายหมื่นรอบ -> ช้าหลายนาที
-- แก้:   เปลี่ยนเป็น Trigger ระดับ Statement + Transition Table -> Recompute ครั้งเดียวต่อ BU ต่อคำสั่ง
--        (ผลสุดท้ายเท่าเดิม เพราะ Recompute จากข้อมูลหลังคำสั่งจบ)
-- หมายเหตุ: Postgres ไม่ให้ใช้ Transition Table กับ Trigger ที่มีหลาย Event -> แยกเป็น 3 ตัว (INSERT / DELETE / UPDATE)
--           UPDATE รวม BU ทั้งเก่าและใหม่ (กรณีย้าย BU) ดีกว่าเดิมที่ Recompute เฉพาะ NEW.bu
-- รันใน pgAdmin ทีเดียวทั้งไฟล์ (Transaction เดียว ถ้าพังจะ Rollback เอง)

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_sync_vat_summary_live_stmt_ins()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT bu FROM new_rows WHERE bu IS NOT NULL LOOP
    PERFORM fn_recompute_vat_summary_for_bu(r.bu);
  END LOOP;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.fn_sync_vat_summary_live_stmt_del()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT bu FROM old_rows WHERE bu IS NOT NULL LOOP
    PERFORM fn_recompute_vat_summary_for_bu(r.bu);
  END LOOP;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.fn_sync_vat_summary_live_stmt_upd()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT bu FROM new_rows WHERE bu IS NOT NULL
    UNION
    SELECT bu FROM old_rows WHERE bu IS NOT NULL
  LOOP
    PERFORM fn_recompute_vat_summary_for_bu(r.bu);
  END LOOP;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_vat_watchlist_sync ON public.vat_watchlist_report;
DROP TRIGGER IF EXISTS trg_vat_watchlist_sync_ins ON public.vat_watchlist_report;
DROP TRIGGER IF EXISTS trg_vat_watchlist_sync_del ON public.vat_watchlist_report;
DROP TRIGGER IF EXISTS trg_vat_watchlist_sync_upd ON public.vat_watchlist_report;

CREATE TRIGGER trg_vat_watchlist_sync_ins
  AFTER INSERT ON public.vat_watchlist_report
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_sync_vat_summary_live_stmt_ins();

CREATE TRIGGER trg_vat_watchlist_sync_del
  AFTER DELETE ON public.vat_watchlist_report
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_sync_vat_summary_live_stmt_del();

CREATE TRIGGER trg_vat_watchlist_sync_upd
  AFTER UPDATE ON public.vat_watchlist_report
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_sync_vat_summary_live_stmt_upd();

COMMIT;

-- ตรวจผล: ต้องเห็น 3 Trigger ใหม่ (_ins/_del/_upd) และไม่มี trg_vat_watchlist_sync ตัวเดิม
-- SELECT tgname FROM pg_trigger WHERE tgrelid='vat_watchlist_report'::regclass AND NOT tgisinternal ORDER BY 1;

-- ====== วิธีย้อนกลับ (ถ้าต้องการกลับไปแบบเดิม) ======
-- BEGIN;
-- DROP TRIGGER IF EXISTS trg_vat_watchlist_sync_ins ON public.vat_watchlist_report;
-- DROP TRIGGER IF EXISTS trg_vat_watchlist_sync_del ON public.vat_watchlist_report;
-- DROP TRIGGER IF EXISTS trg_vat_watchlist_sync_upd ON public.vat_watchlist_report;
-- CREATE TRIGGER trg_vat_watchlist_sync AFTER INSERT OR DELETE OR UPDATE ON public.vat_watchlist_report
--   FOR EACH ROW EXECUTE FUNCTION fn_sync_vat_summary_live();
-- COMMIT;
