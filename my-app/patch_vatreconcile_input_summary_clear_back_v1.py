# -*- coding: utf-8 -*-
"""patch_vatreconcile_input_summary_clear_back_v1  (BACKEND)
เพิ่ม DELETE /api/vat-reconcile/input-summary?bu=&account=&period=
ลบทุกแถวใน vat_reconcile_input_summary ของ BU + reconcile_account + period นั้น (Transaction เดียว)
รันบน Server ที่โฟลเดอร์ backend (มี src\\routes\\vatReconcile.js) แล้ว Restart-Service fastapn-backend
"""
import os, shutil, sys

TARGET = os.path.join("src", "routes", "vatReconcile.js")
MARKER = "VATRECONCILE_INPUT_SUMMARY_CLEAR_V1"

ANCHOR = "// ===========================================================================\n// ส่วนที่ 3: Dashboard Status"
NEW = '''/**
 * DELETE /vat-reconcile/input-summary?bu=...&account=...&period=...
 * MARKER_VATRECONCILE_INPUT_SUMMARY_CLEAR_V1 -- ล้าง Input Summary ทั้งก้อนของ BU + Account + Period (ใช้ตอนนำเข้าผิด แล้วต้องนำเข้าใหม่)
 * รับ bu ได้ทั้งเลข ("3218") และ Short Code ("BTM") เหมือน /dashboard/report
 */
router.delete("/input-summary", async (req, res) => {
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
    const del = await pool.query(
      `DELETE FROM vat_reconcile_input_summary
       WHERE bu = $1 AND reconcile_account = $2 AND period = $3`,
      [bu, account, period]
    );
    console.log(`[vatReconcile] input-summary CLEAR bu=${bu} account=${account} period=${period} deleted=${del.rowCount} by=${req.user?.email || "unknown"}`);
    res.json({ bu, account, period, deleted: del.rowCount });
  } catch (err) {
    console.error("[vatReconcile] input-summary clear error:", err);
    res.status(500).json({ error: "เกิดข้อผิดพลาดระหว่างล้างข้อมูล", detail: err.message });
  }
});

'''

def main():
    with open(TARGET, "r", encoding="utf-8", newline="") as f:
        src = f.read()
    bom = src.startswith("﻿")
    if MARKER in src:
        print("SKIP: patch นี้ถูกใช้แล้ว (%s)" % MARKER); return
    crlf = "\r\n" in src
    s = src.replace("\r\n", "\n")
    if s.count(ANCHOR) != 1:
        print("ERROR: anchor พบ %d ครั้ง (ต้องเป็น 1) - ไม่เขียนไฟล์" % s.count(ANCHOR)); sys.exit(1)
    s = s.replace(ANCHOR, NEW + ANCHOR)
    for a, b in ("{}", "()", "[]"):  # เช็คเฉพาะโค้ดที่แทรกใหม่ (ไฟล์เดิมมี () ใน String/Regex ทำให้นับทั้งไฟล์ไม่ตรง)
        if NEW.count(a) != NEW.count(b):
            print("ERROR: bracket %s%s ไม่สมดุล - ไม่เขียนไฟล์" % (a, b)); sys.exit(1)
    if crlf: s = s.replace("\n", "\r\n")
    shutil.copyfile(TARGET, TARGET + ".bak")
    with open(TARGET, "w", encoding="utf-8-sig" if bom else "utf-8", newline="") as f:
        f.write(s)
    print("OK: patched ->", TARGET)

main()
