# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_CELL_EDIT_BACK_V7
# แก้ Cell ใน Preview แล้วบันทึกลง DB: PUT /vat-reconcile/cell  body {table:'tb'|'simple_detail', id, field, value}
#  + ส่ง id มากับ type=tb และ type=simple_100|simple_avg (view=detail, rows + groups) เพื่อให้ Grid แก้ได้
# ใช้: python patch_vatreconcile_cell_edit_back_v7.py <routes\vatReconcile.js>
import sys, shutil, os
MARKER = "MARKER_VATRECONCILE_CELL_EDIT_BACK_V7"
path = sys.argv[1] if len(sys.argv) > 1 else r"C:\apps\fastapn-backend\src\routes\vatReconcile.js"
raw = open(path, "rb").read().decode("utf-8")
crlf = "\r\n" in raw
s = raw.replace("\r\n", "\n")
if MARKER in s:
    print("[SKIP] patch นี้ถูกใช้แล้ว"); sys.exit(0)
def rp(s, old, new, label):
    c = s.count(old)
    if c != 1:
        print(f"[ABORT] {label}: anchor พบ {c} ครั้ง (ต้องเป็น 1)"); sys.exit(1)
    return s.replace(old, new)

# 1) type=tb ส่ง id
s = rp(s, "        `SELECT branch, cpc, account, subacc, description,\n                beginning_balance::float8 AS beginning_balance,",
          "        `SELECT id, branch, cpc, account, subacc, description,\n                beginning_balance::float8 AS beginning_balance,", "tb id")
# 2) simple detail rows ส่ง id
s = rp(s, "          `SELECT d.running_no,\n", "          `SELECT d.id,\n                  d.running_no,\n", "simple rows id")
# 3) groups ส่ง id
s = rp(s, "                  d.running_no, d.receive_date::text AS receive_date, d.tax_invoice_date::text AS tax_invoice_date,",
          "                  d.id, d.running_no, d.receive_date::text AS receive_date, d.tax_invoice_date::text AS tax_invoice_date,", "groups sql id")
s = rp(s, "              running_no: r.running_no, receive_date: r.receive_date, tax_invoice_date: r.tax_invoice_date,",
          "              id: r.id, running_no: r.running_no, receive_date: r.receive_date, tax_invoice_date: r.tax_invoice_date,", "groups id")

# 4) route แก้ Cell
ROUTE = '''// ''' + MARKER + ''' -- แก้ Cell จาก Preview (Excel Grid) ลง DB | Period ที่ปิดงวดแล้ว (tax_close_period closed/purged) = 409
const CELL_EDIT = {
  tb: {
    table: "vat_reconcile_tb",
    periodSql: "SELECT period FROM vat_reconcile_tb WHERE id = $1",
    cols: { branch: "t", cpc: "t", account: "t", subacc: "t", description: "t", beginning_balance: "n", period_activity: "n", ending_balance: "n" },
  },
  simple_detail: {
    table: "vat_reconcile_simple_detail",
    periodSql: "SELECT h.period FROM vat_reconcile_simple_detail d JOIN vat_reconcile_simple_header h ON h.id = d.header_id WHERE d.id = $1",
    cols: { running_no: "t", receive_date: "d", tax_invoice_date: "d", tax_invoice_no: "t", vendor_name: "t", tax_id: "t", branch_field: "t", item_detail: "t",
            paid_amount: "n", paid_vat: "n", claimed_amount: "n", claimed_vat: "n", claim_percent: "p" },
  },
};
router.put("/cell", express.json(), async (req, res) => {
  try {
    const { table, id, field, value } = req.body || {};
    const cfg = CELL_EDIT[table];
    if (!cfg || !Number.isInteger(Number(id)) || !Object.prototype.hasOwnProperty.call(cfg.cols, field)) {
      return res.status(400).json({ error: "ตาราง/คอลัมน์ไม่อนุญาตให้แก้ไข" });
    }
    const pr = await pool.query(cfg.periodSql, [Number(id)]);
    if (!pr.rows.length) return res.status(404).json({ error: "ไม่พบแถวที่ต้องการแก้ไข" });
    try {
      const st = (await pool.query(`SELECT status FROM tax_close_period WHERE period_ym = $1`, [pr.rows[0].period])).rows[0]?.status;
      if (st === "closed" || st === "purged") return res.status(409).json({ error: `Period ${pr.rows[0].period} ปิดงวดแล้ว แก้ไขไม่ได้`, code: "PERIOD_FROZEN" });
    } catch (e) { if (e.code !== "42P01") throw e; }
    const kind = cfg.cols[field];
    let v = value === undefined || value === null || String(value).trim() === "" ? null : String(value).trim();
    if (v !== null && (kind === "n" || kind === "p")) {
      const n = Number(v.replace(/,/g, "").replace(/%$/, ""));
      if (!Number.isFinite(n)) return res.status(400).json({ error: "ต้องเป็นตัวเลข" });
      v = kind === "p" ? n / 100 : n; // claim_percent เก็บเป็นสัดส่วน (100 -> 1)
    }
    if (v !== null && kind === "d" && !/^\\d{4}-\\d{2}-\\d{2}$/.test(v)) return res.status(400).json({ error: "วันที่ต้องเป็นรูปแบบ YYYY-MM-DD" });
    await pool.query(`UPDATE ${cfg.table} SET ${field} = $1 WHERE id = $2`, [v, Number(id)]);
    console.log(`[vatReconcile] cell edit ${table}#${id}.${field} by=${req.user?.email || "unknown"}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("[vatReconcile] cell edit error:", err);
    res.status(500).json({ error: "บันทึกไม่สำเร็จ", detail: err.message });
  }
});

'''
s = rp(s, 'router.delete("/tb", async (req, res) => {', ROUTE + 'router.delete("/tb", async (req, res) => {', "route")

n = 1
while os.path.exists(f"{path}.bak{n:02d}"): n += 1
shutil.copy2(path, f"{path}.bak{n:02d}")
open(path, "wb").write((s.replace("\n", "\r\n") if crlf else s).encode("utf-8"))
print(f"[OK] patched {path} (backup .bak{n:02d})")
