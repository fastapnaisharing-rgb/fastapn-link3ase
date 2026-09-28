import { pool } from "../db.js";

// MARKER_ROUTE_DATA_INTEGRITY_CHECK_V1
// ── Cron ตรวจ bucket_list รายวัน หา Record ที่ branch_label ว่างผิดปกติ ──
// ── (branch_no มี NOT NULL Constraint แล้ว จึงเหลือแค่ branch_label ที่ยังหลุดได้) ──
// ── ที่มา: สืบเนื่องจาก Bug Smart Match Insert (MARKER_SMARTMATCH_ABORT_ON_INSERT_FAIL_V1) ──
// ── ที่แก้ไปแล้วในฝั่ง Frontend -- Cron นี้เป็น Safety Net เผื่อมีเคสอื่นที่ยังไม่เจอ ──

export async function checkBucketListDataIntegrity() {
  const { rows } = await pool.query(`
    SELECT id, batch_id, invoice_no, vendor_name, branch_no, branch_label, created_at
    FROM bucket_list
    WHERE (branch_label IS NULL OR TRIM(branch_label) = '')
      AND exported_at IS NULL
      -- MARKER_DATAINTEGRITY_SKIP_EXPORTED_V1 -- ข้าม Record ที่ Export เป็น Batch ไปแล้ว (exported_at ถูกตั้งค่าตอน Export)
      -- ใบที่ Export ไปแล้วแก้ Branch ตรงนี้ไม่ได้อยู่แล้ว (ต้อง Restore กลับ Batch Bucket ก่อน)
      -- เตือนซ้ำไปก็ไม่มีประโยชน์ ตัดเสียงรบกวนออก
    ORDER BY created_at DESC
    LIMIT 50
  `);

  if (rows.length === 0) return;

  const latest = rows[0];
  const title = `⚠️ พบข้อมูล Branch ไม่ครบใน Batch Bucket (${rows.length} รายการ)`;
  const message =
    rows.length === 1
      ? `Invoice ${latest.invoice_no || "(ไม่มีเลขที่)"} — Branch Label ว่างผิดปกติ (Batch ${latest.batch_id || "-"})`
      : `ล่าสุด: Invoice ${latest.invoice_no || "(ไม่มีเลขที่)"} (Batch ${latest.batch_id || "-"}) และอีก ${rows.length - 1} รายการ — Branch Label ว่างผิดปกติ`;

  await pool.query(
    `INSERT INTO notifications
       (title, message, category, link_to, target_role, created_by, batch_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      title,
      message,
      "data-integrity",
      latest.batch_id || "",
      "Owner",
      "system",
      latest.batch_id || "",
    ]
  );
}
