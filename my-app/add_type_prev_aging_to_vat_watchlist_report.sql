-- เก็บ Aging เดิมไว้คืนตอน Clear (JSON {"l":label,"m":months})
ALTER TABLE vat_watchlist_report ADD COLUMN IF NOT EXISTS type_prev_aging text;

-- แถวที่ Popvat ไปแล้วก่อนหน้านี้ (IV6800376 REV-VT00518): เก็บ Aging เดิมแล้วเปลี่ยนเป็น Uncount
UPDATE vat_watchlist_report
SET type_prev_aging = jsonb_build_object('l', aging_label, 'm', aging_months)::text,
    aging_label = 'IV-Aging Uncount',
    aging_months = NULL
WHERE status IN ('type_a','type_b','type_f') AND type_prev_aging IS NULL
  AND aging_label IS DISTINCT FROM 'IV-Aging Uncount';
