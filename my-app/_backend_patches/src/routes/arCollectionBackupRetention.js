/**
 * routes/arCollectionBackupRetention.js
 *
 * Retention ของ vat_backup_tax_invoice ที่มาจาก AR_Collection (source_type='ar_collection_match')
 *
 *   pending ──(POST /api/vat/period/close)──▶ Stamp expired_date = เวลาปิด ──(ครบ N วัน ปฏิทิน)──▶ DELETE ถาวร
 *
 * ไฟล์นี้ไม่ใช่ Router — เป็น Helper ที่ถูกเรียกจาก:
 *   - vatPeriodRoute.js     → stampArCollectionBackupExpired (ภายใน SAVEPOINT ของ /close)
 *   - app.js (Cron 5 นาที) → purgeExpiredArCollectionBackup
 *
 * เฉพาะแถว source_type='ar_collection_match' ที่ status='pending' เท่านั้น (ยัง Match ไม่ได้ ณ ตอนปิด Period)
 * แถวที่ Match สำเร็จไปแล้ว (status เปลี่ยนไปทางอื่นก่อนปิด Period) จะไม่ถูก Stamp/ลบ
 * ปิด Period ของระบบนี้ปิดทุก BU พร้อมกันทีเดียว (ดู vatPeriodRoute.js) จึง Stamp ทุกแถวทุก BU โดยไม่ต้องเจาะจง BU
 * ไม่กระทบ vat_backup_tax_invoice ของ source_type อื่น (เช่น amagno)
 *
 * ต้องรัน schema/ar_collection_backup_retention_v1.sql ก่อน (เพิ่ม Column expired_date + system_settings key)
 */

import { pool } from "../db.js";

const DEFAULT_RETENTION_DAYS = 30;

// ── อ่านจำนวนวันเก็บจาก system_settings (fallback 30 ถ้าไม่มี/ค่าผิด) ──
export async function getArCollectionBackupRetentionDays(db) {
  try {
    const { rows } = await (db || pool).query(
      `SELECT value FROM system_settings WHERE key = 'ar_collection_backup_retention_days'`
    );
    const n = parseInt(rows[0]?.value, 10);
    return Number.isInteger(n) && n >= 1 && n <= 365 ? n : DEFAULT_RETENTION_DAYS;
  } catch (err) {
    return DEFAULT_RETENTION_DAYS;
  }
}

// ── เรียกตอน Period ถูกปิด: Stamp expired_date ให้แถว AR_Collection Backup ที่ยัง pending ทุกแถว ทุก BU ──
// ต้องเรียกภายใน SAVEPOINT ของ /close — ถ้าพลาดต้องไม่ทำให้การปิด Period ล้ม
export async function stampArCollectionBackupExpired(client) {
  const { rowCount } = await client.query(
    `UPDATE vat_backup_tax_invoice
        SET expired_date = NOW()
      WHERE source_type = 'ar_collection_match'
        AND status = 'pending'
        AND expired_date IS NULL`
  );
  return rowCount;
}

// ── Cron: ลบถาวรแถวที่ถูก Stamp expired_date ไว้ครบกำหนดแล้ว ──
export async function purgeExpiredArCollectionBackup() {
  const days = await getArCollectionBackupRetentionDays();
  const { rowCount } = await pool.query(
    `DELETE FROM vat_backup_tax_invoice
      WHERE source_type = 'ar_collection_match'
        AND status = 'pending'
        AND expired_date IS NOT NULL
        AND expired_date <= NOW() - make_interval(days => $1)`,
    [days]
  );
  if (rowCount > 0) {
    console.log(`[MARKER_ARCOLLECTION_BACKUP_RETENTION_V1] purged ${rowCount} rows (ar_collection_match, expired > ${days} days)`);
  }
  return rowCount;
}
