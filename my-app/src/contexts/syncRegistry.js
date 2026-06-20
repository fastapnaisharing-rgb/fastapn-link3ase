// src/contexts/syncRegistry.js
// ─────────────────────────────────────────────────────────────────────────
// Sync Flush Registry
// ─────────────────────────────────────────────────────────────────────────
// Pub/sub กลางสำหรับ "Auto Backup" — component ที่มีข้อมูล pending
// (เช่น Batch Bucket / GRT-GRN running number ใน APController) ลงทะเบียน
// flush function ของตัวเองไว้ที่นี่ตอน mount แล้ว unregister ตอน unmount
//
// ตอน logout (AuthContext.logout) จะเรียก flushAllSync() เพื่อ sync ข้อมูล
// ค้างทั้งหมดขึ้น Supabase ให้เสร็จก่อน sign out — โดยไม่ต้องให้ AuthContext
// รู้จัก state ภายในของ component อื่นเลย
// ─────────────────────────────────────────────────────────────────────────

const flushers = new Set();

/**
 * ลงทะเบียน flush function (จะเป็น async หรือ sync ก็ได้)
 * คืนค่า unregister function — เรียกตอน component unmount
 *
 * ตัวอย่าง:
 *   useEffect(() => {
 *     const unregister = registerSyncFlush(async () => {
 *       await syncPendingToBucket();
 *       await syncGrtGrnCounter();
 *     });
 *     return unregister;
 *   }, [bu, me]);
 */
export function registerSyncFlush(fn) {
  flushers.add(fn);
  return () => flushers.delete(fn);
}

/**
 * เรียก flush function ที่ลงทะเบียนไว้ทั้งหมดแบบ parallel
 * รอจนกว่าทุกตัวจะเสร็จ (หรือ error) ก่อน resolve
 * ใช้ก่อน logout / sign out
 */
export async function flushAllSync() {
  const tasks = Array.from(flushers).map((fn) => {
    try {
      return Promise.resolve(fn());
    } catch (e) {
      console.error('flushAllSync:', e);
      return Promise.resolve();
    }
  });
  await Promise.allSettled(tasks);
}
