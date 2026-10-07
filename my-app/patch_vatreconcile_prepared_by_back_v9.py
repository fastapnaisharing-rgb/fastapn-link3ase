# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_PREPARED_BY_BACK_V9
# ดึง "Prepare by" ของแต่ละ BU จาก company_list / vat_setting (คอลัมน์ที่ชื่อมี prepar / ผู้จัดทำ) -> rep.header.preparedBy
# + PUT /vat-reconcile/prepared-by แก้กลับ DB + Export ใช้ค่านี้ (Fallback = Username ผู้ Export)
import sys, shutil, os
M = "MARKER_VATRECONCILE_PREPARED_BY_BACK_V9"
def rd(p):
    b = open(p, "rb").read(); crlf = b"\r\n" in b
    return b.decode("utf-8").replace("\r\n", "\n"), crlf
def wr(p, s, crlf):
    open(p, "wb").write((s.replace("\n", "\r\n") if crlf else s).encode("utf-8"))
def rep(s, old, new):
    if s.count(old) != 1: sys.exit("ABORT anchor count=%d: %s" % (s.count(old), old[:80]))
    return s.replace(old, new)
def bak(p):
    n = 1
    while os.path.exists("%s.bak%02d" % (p, n)): n += 1
    shutil.copy2(p, "%s.bak%02d" % (p, n))

p = "vatReconcile.js"
s, crlf = rd(p)
if M in s: print("skip", p)
else:
    bak(p)
    s = rep(s, """function reconPickKey(row, re, exclude) {
  return Object.keys(row || {}).find((k) => re.test(k) && !(exclude && exclude.test(k)));
}
""", """function reconPickKey(row, re, exclude) {
  return Object.keys(row || {}).find((k) => re.test(k) && !(exclude && exclude.test(k)));
}

// """ + M + """
// หา "Prepare by" ของ BU จากตารางตั้งค่า (company_list ก่อน แล้ว vat_setting) -- คอลัมน์ใดก็ได้ที่ชื่อมี prepar / ผู้จัดทำ
const PREPARED_BY_TABLES = ["company_list", "vat_setting"];
const PREPARED_BY_RE = /prepar|ผู้จัดทำ|maker/i;
async function reconFindPreparedBy(buShort) {
  if (!buShort) return null;
  for (const t of PREPARED_BY_TABLES) {
    let row = null;
    for (const w of [`bu = $1 AND deleted IS NOT TRUE`, `bu = $1`]) {
      try {
        const q = await pool.query(`SELECT * FROM ${t} WHERE ${w} LIMIT 1`, [buShort]);
        row = q.rows[0] || null;
        break;
      } catch (e) { if (e.code !== "42703" && e.code !== "42P01") throw e; if (e.code === "42P01") break; }
    }
    if (!row) continue;
    const key = reconPickKey(row, PREPARED_BY_RE);
    if (key) return { table: t, key, value: row[key] == null ? "" : String(row[key]).trim(), softDel: Object.prototype.hasOwnProperty.call(row, "deleted") };
    console.warn(`[vatReconcile] ${t} (bu=${buShort}) ไม่มีคอลัมน์ Prepare by -- คอลัมน์ที่มี:`, Object.keys(row).join(", "));
  }
  return null;
}
router.put("/prepared-by", express.json(), async (req, res) => {
  try {
    let bu = String((req.body || {}).bu || "").trim();
    const value = String((req.body || {}).value ?? "").trim();
    if (!bu) return res.status(400).json({ error: "ต้องระบุ bu" });
    if (/^\\d+$/.test(bu)) {
      const r = await pool.query(`SELECT bu FROM company_list WHERE split_part("COMPANY CODE", '-', 3) = $1 AND deleted IS NOT TRUE LIMIT 1`, [bu]);
      if (r.rows[0]?.bu) bu = r.rows[0].bu;
    }
    const src = await reconFindPreparedBy(bu);
    if (!src) return res.status(404).json({ error: "ไม่พบคอลัมน์ Prepare by ใน company_list / vat_setting ของ BU นี้" });
    const qk = src.key.replace(/"/g, '""');
    await pool.query(`UPDATE ${src.table} SET "${qk}" = $1 WHERE bu = $2${src.softDel ? " AND deleted IS NOT TRUE" : ""}`, [value || null, bu]);
    console.log(`[vatReconcile] prepared-by ${src.table}.${src.key} bu=${bu} by=${req.user?.email || "unknown"}`);
    res.json({ ok: true, value });
  } catch (err) {
    console.error("[vatReconcile] prepared-by error:", err);
    res.status(500).json({ error: "บันทึกไม่สำเร็จ", detail: err.message });
  }
});
""")
    s = rep(s, """    for (const r of simQ.rows) {
      if (!companyTaxId && r.company_tax_id)""", """    let preparedBySrc = null;
    try { preparedBySrc = await reconFindPreparedBy(buShort); } catch (e) { console.warn("[vatReconcile] prepared-by lookup skipped:", e.message); } // """ + M + """
    for (const r of simQ.rows) {
      if (!companyTaxId && r.company_tax_id)""")
    s = rep(s, """        companyEn: companyNameEn || "",
        periodLabel: reconThaiPeriodLabel(period),""", """        companyEn: companyNameEn || "",
        preparedBy: preparedBySrc ? preparedBySrc.value : "",
        preparedByEditable: !!preparedBySrc,
        periodLabel: reconThaiPeriodLabel(period),""")
    wr(p, s, crlf); print("OK", p)

p = "vatReconcileReportFiles.js"
s, crlf = rd(p)
if M in s: print("skip", p)
else:
    bak(p)
    s = rep(s, """      const preparedBy = req.user?.email ? await getUsernameByEmail(req.user.email) : "";""",
               """      const preparedBy = (rep.header && rep.header.preparedBy) || (req.user?.email ? await getUsernameByEmail(req.user.email) : ""); // """ + M)
    wr(p, s, crlf); print("OK", p)
