# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_FILE_PREVIEW_BACK_V10
# GET /dashboard/report-files/:id/preview -- อ่านไฟล์ .xlsx ที่ Export ไว้จริง (file_storage) แล้วส่งทุกชีตเป็น JSON (ค่า+สไตล์) ให้หน้า Preview ในตารางไฟล์ (อ่านอย่างเดียว)
import sys, shutil, os
M = "MARKER_VATRECONCILE_FILE_PREVIEW_BACK_V10"
p = "vatReconcileReportFiles.js"
raw = open(p, "rb").read(); crlf = b"\r\n" in raw
s = raw.decode("utf-8").replace("\r\n", "\n")
if M in s: sys.exit("skip")
n = 1
while os.path.exists("%s.bak%02d" % (p, n)): n += 1
shutil.copy2(p, "%s.bak%02d" % (p, n))
def rep(old, new):
    global s
    if s.count(old) != 1: sys.exit("ABORT anchor count=%d: %s" % (s.count(old), old[:80]))
    s = s.replace(old, new)

HELPERS = r'''
// ''' + M + r'''
const PV_MAX_ROWS = 3000, PV_MAX_COLS = 40;
const PV_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function pvArgb(c) { return c && typeof c.argb === "string" && c.argb.length >= 6 ? "#" + c.argb.slice(-6) : null; }
function pvFmtNum(n, nf) {
  if (!nf || nf === "General") return Number.isInteger(n) ? String(n) : String(+n.toFixed(10));
  if (nf === "@") return String(n);
  const secs = nf.split(";");
  const pos = secs[0];
  const pct = /%/.test(pos);
  const dm = /0\.(0+)/.exec(pos);
  const dec = dm ? dm[1].length : 0;
  let v = Math.abs(n) * (pct ? 100 : 1);
  if (n === 0 && secs[2] && /-/.test(secs[2])) return { t: "-", neg: false };
  let t = v.toFixed(dec);
  if (/#,##0/.test(pos)) t = Number(t).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  if (pct) t += "%";
  if (n < 0) {
    const negSec = secs[1] || "";
    const parens = /\(/.test(negSec) || (!secs[1] && /_\)/.test(pos));
    return { t: parens ? `(${t})` : `-${t}`, neg: /\[Red\]/i.test(negSec) };
  }
  return { t, neg: false };
}
function pvText(v, nf) {
  if (v == null) return { t: "" };
  if (typeof v === "object" && !(v instanceof Date)) {
    if ("formula" in v || "sharedFormula" in v) return pvText(v.result === undefined ? null : v.result, nf);
    if (v.richText) return { t: v.richText.map((x) => x.text).join("") };
    if (v.text != null) return { t: String(v.text) };
    if (v.error) return { t: String(v.error) };
    return { t: "" };
  }
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return { t: "" };
    const d = String(v.getUTCDate()), y = v.getUTCFullYear();
    if (nf && /yy/i.test(nf)) return { t: `${d}-${PV_MON[v.getUTCMonth()]}-${String(y).slice(-2)}`, c: 1 };
    return { t: `${y}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${d.padStart(2, "0")}`, c: 1 };
  }
  if (typeof v === "number") { const r = pvFmtNum(v, nf); return typeof r === "string" ? { t: r, n: 1 } : { t: r.t, n: 1, red: r.neg }; }
  if (typeof v === "boolean") return { t: v ? "TRUE" : "FALSE" };
  return { t: String(v) };
}
const PV_BSTYLE = { thin: "1px solid", medium: "2px solid", thick: "3px solid", double: "3px double", hair: "1px dotted", dotted: "1px dotted", dashed: "1px dashed" };
function pvCss(cell, extra) {
  const css = [];
  const f = cell.font || {};
  if (f.bold) css.push("font-weight:700");
  if (f.italic) css.push("font-style:italic");
  const fc = pvArgb(f.color) || (extra && extra.color);
  if (fc) css.push(`color:${fc}`);
  if (f.size) css.push(`font-size:${Math.round(f.size * 1.2 * 10) / 10}px`);
  if (f.name) css.push(`font-family:"${f.name}",Tahoma,sans-serif`);
  const fl = cell.fill;
  const bg = (extra && extra.bg) || (fl && fl.type === "pattern" && fl.pattern === "solid" ? pvArgb(fl.fgColor) : null);
  if (bg) css.push(`background:${bg}`);
  const al = cell.alignment || {};
  if (al.horizontal) css.push(`text-align:${al.horizontal === "centerContinuous" ? "center" : al.horizontal}`);
  if (al.vertical) css.push(`vertical-align:${al.vertical === "center" ? "middle" : al.vertical}`);
  if (al.wrapText) css.push("white-space:pre-wrap");
  const b = cell.border || {};
  for (const [k, side] of [["top", "top"], ["left", "left"], ["bottom", "bottom"], ["right", "right"]]) {
    const x = b[k];
    if (x && x.style) css.push(`border-${side}:${PV_BSTYLE[x.style] || "1px solid"} ${pvArgb(x.color) || "#000"}`);
  }
  return css.join(";");
}
async function pvLoadSheets(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const styles = [""];
  const styleIdx = new Map([["", 0]]);
  const sid = (css) => { if (!styleIdx.has(css)) { styleIdx.set(css, styles.length); styles.push(css); } return styleIdx.get(css); };
  const sheets = [];
  wb.eachSheet((ws) => {
    if (ws.state && ws.state !== "visible") return;
    const maxRow = Math.min(ws.rowCount || 0, PV_MAX_ROWS);
    const maxCol = Math.min(ws.columnCount || 1, PV_MAX_COLS);
    const isRv = /^ReportVat/i.test(ws.name);
    const cols = [], hidden = [];
    for (let c = 1; c <= maxCol; c++) {
      const col = ws.getColumn(c);
      cols.push(Math.round(((col.width || 9) * 7 + 5)));
      hidden.push(!!col.hidden);
    }
    const merges = (ws.model.merges || []).map((m) => {
      const [a, z] = String(m).split(":");
      const pa = ws.getCell(a), pz = ws.getCell(z || a);
      return [Number(pa.row), Number(pa.col), Number(pz.row), Number(pz.col)];
    });
    const rows = [];
    for (let r = 1; r <= maxRow; r++) {
      const row = ws.getRow(r);
      const cells = [];
      const closed = isRv && r >= 9 && String((row.getCell(16).value && row.getCell(16).value.result) ?? row.getCell(16).value ?? "") === "Closed";
      for (let c = 1; c <= maxCol; c++) {
        const cell = row.getCell(c);
        const nf = cell.numFmt;
        const tx = pvText(cell.value, nf);
        const extra = {};
        if (isRv && r >= 9) {
          if (tx.n && Number(cell.value && cell.value.result !== undefined ? cell.value.result : cell.value) < 0 && c >= 3 && c <= 14) extra.color = "#ff5050";
          if (closed && c <= 16) extra.color = "#ff0000";
          if (c === 16 && tx.t === "Active") { extra.bg = "#ccffcc"; extra.color = "#002060"; }
          if (c === 16 && (tx.t === "Temp." || tx.t === "Relocate")) { extra.bg = "#ffffcc"; extra.color = "#002060"; }
        }
        if (tx.red && !extra.color) extra.color = "#ff0000";
        const css = pvCss(cell, extra);
        if (!tx.t && !css) continue;
        cells.push([c, tx.t, sid(css), tx.n ? 1 : 0]);
      }
      rows.push({ r, h: row.height ? Math.round(row.height * 1.333) : 0, cells });
    }
    const v = (ws.views && ws.views[0]) || {};
    sheets.push({ name: ws.name, cols, hidden, merges, rows, grid: v.showGridLines !== false, truncated: (ws.rowCount || 0) > PV_MAX_ROWS, totalRows: ws.rowCount || 0 });
  });
  return { sheets, styles };
}
'''
rep("""async function buildReconcileWorkbook(rep, bu, period) {""", HELPERS + """
async function buildReconcileWorkbook(rep, bu, period) {""")

rep("""  router.get("/dashboard/report-files/:id/download", async (req, res) => {""", """  router.get("/dashboard/report-files/:id/preview", async (req, res) => { // """ + M + """
    try {
      const q = await pool.query(`SELECT file_name, file_path FROM file_storage WHERE id=$1 AND module=$2`, [req.params.id, REPORT_FILE_MODULE]);
      if (!q.rows.length) return res.status(404).json({ error: "ไม่พบไฟล์" });
      const { file_name, file_path } = q.rows[0];
      if (!fs.existsSync(file_path)) return res.status(410).json({ error: "ไฟล์บน Server ถูกลบหรือย้ายแล้ว" });
      const out = await pvLoadSheets(file_path);
      res.json({ file_name, ...out });
    } catch (err) {
      console.error("[vatReconcile] report-files preview error:", err);
      res.status(500).json({ error: "เปิด Preview ไฟล์ไม่สำเร็จ", detail: err.message });
    }
  });

  router.get("/dashboard/report-files/:id/download", async (req, res) => {""")
open(p, "wb").write((s.replace("\n", "\r\n") if crlf else s).encode("utf-8"))
print("OK")
