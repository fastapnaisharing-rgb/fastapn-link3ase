# -*- coding: utf-8 -*-
"""patch_vatreconcile_tb_clear_back_v1  (BACKEND)
เพิ่ม DELETE /api/vat-reconcile/tb?bu=&account=&period=  ลบทุกแถว vat_reconcile_tb ของ BU + account + period นั้น
(ไม่ต้องพึ่ง patch input_summary แต่ถ้ารันคู่กันให้รัน patch นั้นก่อน)
รันบน Server ที่โฟลเดอร์ backend แล้ว Restart-Service fastapn-backend
"""
import os, shutil, sys

TARGET = os.path.join("src", "routes", "vatReconcile.js")
MARKER = "VATRECONCILE_TB_CLEAR_V1"
ANCHOR = "// ===========================================================================\n// ส่วนที่ 3: Dashboard Status"
NEW = '''/**
 * DELETE /vat-reconcile/tb?bu=...&account=...&period=...
 * MARKER_VATRECONCILE_TB_CLEAR_V1 -- ล้าง Trial Balance ทั้งก้อนของ BU + Account + Period (ใช้ตอนบันทึก TB ผิด แล้วต้องนำเข้าใหม่)
 * Freeze: Period ที่ปิดงวดแล้ว (tax_close_period.status closed/purged) หรือมี TB Period ใหม่กว่า -> 409 ล้างไม่ได้ (Input Summary ไม่ Freeze)
 * ลบทุกแถวรวมแถว is_protected_account ด้วย (TB Commit เป็น Upsert จึงต้องล้างก่อนถึงจะแก้ที่ผิดออกได้)
 */
router.delete("/tb", async (req, res) => {
  try {
    const { account, period } = req.query;
    let { bu } = req.query;
    if (!bu || !account || !period) {
      return res.status(400).json({ error: "ต้องระบุ bu, account, period ให้ครบ" });
    }
    bu = await resolveBuToNumeric(bu);
    if (!bu) {
      return res.status(422).json({ error: "ไม่พบ BU นี้ในระบบ (แปลงเป็นเลข BU ไม่ได้)" });
    }
    // Freeze: TB ของ Period ที่ปิดงวดแล้ว หรือมี TB ของ Period ใหม่กว่านำเข้าแล้ว = ยอดสุดท้าย ล้างไม่ได้
    try {
      const st = (await pool.query(`SELECT status FROM tax_close_period WHERE period_ym = $1`, [period])).rows[0]?.status;
      if (st === "closed" || st === "purged") {
        return res.status(409).json({ error: `Period ${period} ปิดงวดแล้ว — TB ถูก Freeze ล้างไม่ได้`, code: "PERIOD_FROZEN" });
      }
    } catch (e) {
      if (e.code !== "42P01") throw e; // ไม่มีตาราง tax_close_period = ข้ามเช็คสถานะปิดงวด
    }
    const newer = await pool.query(`SELECT 1 FROM vat_reconcile_tb WHERE period > $1 LIMIT 1`, [period]);
    if (newer.rowCount > 0) {
      return res.status(409).json({ error: `Period ${period} ถูก Freeze (มี TB ของ Period ใหม่กว่านำเข้าแล้ว) ล้างไม่ได้`, code: "PERIOD_FROZEN" });
    }
    const del = await pool.query(
      `DELETE FROM vat_reconcile_tb
       WHERE bu = $1 AND account = $2 AND period = $3`,
      [bu, account, period]
    );
    console.log(`[vatReconcile] tb CLEAR bu=${bu} account=${account} period=${period} deleted=${del.rowCount} by=${req.user?.email || "unknown"}`);
    res.json({ bu, account, period, deleted: del.rowCount });
  } catch (err) {
    console.error("[vatReconcile] tb clear error:", err);
    res.status(500).json({ error: "เกิดข้อผิดพลาดระหว่างล้างข้อมูล", detail: err.message });
  }
});

'''

def main():
    with open(TARGET, "r", encoding="utf-8", newline="") as f:
        src = f.read()
    bom = src.startswith("\ufeff")
    if MARKER in src:
        print("SKIP: patch นี้ถูกใช้แล้ว (%s)" % MARKER); return
    crlf = "\r\n" in src
    s = src.replace("\r\n", "\n")
    if s.count(ANCHOR) != 1:
        print("ERROR: anchor พบ %d ครั้ง (ต้องเป็น 1) - ไม่เขียนไฟล์" % s.count(ANCHOR)); sys.exit(1)
    s = s.replace(ANCHOR, NEW + ANCHOR)
    for a, b in ("{}", "()", "[]"):  # เช็คเฉพาะโค้ดที่แทรกใหม่
        if NEW.count(a) != NEW.count(b):
            print("ERROR: bracket %s%s ไม่สมดุล - ไม่เขียนไฟล์" % (a, b)); sys.exit(1)
    if crlf: s = s.replace("\n", "\r\n")
    shutil.copyfile(TARGET, TARGET + ".bak")
    with open(TARGET, "w", encoding="utf-8-sig" if bom else "utf-8", newline="") as f:
        f.write(s)
    print("OK: patched ->", TARGET)

main()
