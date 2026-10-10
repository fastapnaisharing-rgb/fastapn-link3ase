# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_CF_COLORS_BACK_V13
# Conditional Format ให้ตรง A_ReconcileAcc_Temp (VBA): Closed = ตัวแดง+พื้นเทา, Futuredate = พื้นฟ้า+ตัวเข้ม (Dark2 -75%)
# + Preview ไฟล์ (pvLoadSheets) อ่านกติกา Conditional Format จริงจากไฟล์ แทนที่การเดาเฉพาะชีต ReportVat
import sys, shutil, os
M = "MARKER_VATRECONCILE_CF_COLORS_BACK_V13"
def rd(p):
    b = open(p, "rb").read(); return b.decode("utf-8").replace("\r\n", "\n"), b"\r\n" in b
def wr(p, s, c): open(p, "wb").write((s.replace("\n", "\r\n") if c else s).encode("utf-8"))
def bak(p):
    n = 1
    while os.path.exists("%s.bak%02d" % (p, n)): n += 1
    shutil.copy2(p, "%s.bak%02d" % (p, n))
def rep(s, old, new):
    if s.count(old) != 1: sys.exit("ABORT anchor count=%d: %s" % (s.count(old), old[:80]))
    return s.replace(old, new)

p = "vatReconcileOriginalWorkbook.js"; s, c = rd(p)
if M not in s:
    bak(p)
    s = rep(s, """{ type: "expression", formulae: ['$Q10="Futuredate"'], priority: 1, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFCCECFF" } } } },""",
               """{ type: "expression", formulae: ['$Q10="Futuredate"'], priority: 1, style: { font: { color: { theme: 3, tint: -0.749992370372631 } }, fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFCCECFF" } } } }, // """ + M)
    s = rep(s, """formulae: ['$P9="Closed"'], priority: 4, style: { font: { color: { argb: "FFFF0000" } } } }""",
               """formulae: ['$P9="Closed"'], priority: 4, style: { font: { color: { argb: "FFFF0000" } }, fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFD9D9D9" } } } }""")
    wr(p, s, c); print("OK", p)
else: print("skip", p)

p = "vatReconcileReportFiles.js"; s, c = rd(p)
if M not in s:
    bak(p)
    # pvCss: รองรับ bold/border จาก CF
    s = rep(s, """  if (f.bold) css.push("font-weight:700");""", """  if (f.bold || (extra && extra.bold)) css.push("font-weight:700");""")
    s = rep(s, """  const b = cell.border || {};
  for (const [k, side] of""", """  const b = (extra && extra.border) || cell.border || {};
  for (const [k, side] of""")
    # ตัวช่วยประเมิน CF
    CF = r'''
// ''' + M + r'''
const PV_THEME = [0xFFFFFF, 0x000000, 0xE7E6E6, 0x44546A, 0x4472C4, 0xED7D31, 0xA5A5A5, 0xFFC000, 0x5B9BD5, 0x70AD47];
function pvCfColor(c) {
  if (!c) return null;
  if (typeof c.argb === "string" && c.argb.length >= 6) return "#" + c.argb.slice(-6);
  if (typeof c.theme === "number" && PV_THEME[c.theme] != null) {
    const t = c.tint || 0, base = PV_THEME[c.theme];
    const ch = [(base >> 16) & 255, (base >> 8) & 255, base & 255].map((v) => Math.max(0, Math.min(255, Math.round(t < 0 ? v * (1 + t) : v + (255 - v) * t))));
    return "#" + ch.map((v) => v.toString(16).padStart(2, "0")).join("");
  }
  return null;
}
function pvRange(ref) {
  const m = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(String(ref).split(" ")[0]);
  if (!m) return null;
  const cn = (L) => L.split("").reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
  return { c1: cn(m[1]), r1: Number(m[2]), c2: cn(m[3] || m[1]), r2: Number(m[4] || m[2]), cn };
}
function pvCfPlan(ws) {
  const plan = [];
  for (const cf of ws.conditionalFormattings || []) {
    const rg = pvRange(cf.ref);
    if (!rg) continue;
    for (const rule of cf.rules || []) plan.push({ rg, rule, pr: rule.priority == null ? 9999 : rule.priority });
  }
  return plan.sort((a, b) => a.pr - b.pr);
}
function pvCfEval(plan, ws, r, c, valueOf) {
  const out = {};
  for (const { rg, rule } of plan) {
    if (r < rg.r1 || r > rg.r2 || c < rg.c1 || c > rg.c2) continue;
    const v = valueOf(r, c);
    let hit = false;
    const f0 = rule.formulae && rule.formulae[0];
    if (rule.type === "cellIs") {
      const n = Number(typeof v === "number" ? v : NaN), x = Number(f0);
      if (Number.isFinite(n) && Number.isFinite(x)) hit = ({ lessThan: n < x, lessThanOrEqual: n <= x, greaterThan: n > x, greaterThanOrEqual: n >= x, equal: n === x, notEqual: n !== x })[rule.operator] === true;
    } else if (rule.type === "containsText") {
      hit = rule.text != null && String(v == null ? "" : v).toLowerCase().includes(String(rule.text).toLowerCase());
    } else if (rule.type === "expression" && typeof f0 === "string") {
      const m = /^\$([A-Z]+)(\d+)\s*=\s*"(.*)"$/.exec(f0.replace(/^=/, ""));
      if (m) {
        const rr = r - rg.r1 + Number(m[2]);
        const vv = valueOf(rr, rg.cn(m[1]));
        hit = String(vv == null ? "" : vv).toLowerCase() === m[3].toLowerCase();
      }
    }
    if (!hit) continue;
    const st = rule.style || {};
    const fc = pvCfColor(st.font && st.font.color);
    if (fc && !out.color) out.color = fc;
    if (st.font && st.font.bold && !out.bold) out.bold = true;
    const bg = st.fill && pvCfColor(st.fill.bgColor || st.fill.fgColor);
    if (bg && !out.bg) out.bg = bg;
    if (st.border && !out.border) out.border = st.border;
    if (rule.stopIfTrue) break;
  }
  return out;
}
'''
    s = rep(s, "async function pvLoadSheets(filePath) {", CF + "async function pvLoadSheets(filePath) {")
    # ใช้ CF จริงแทนการเดา
    a = s.index("        const extra = {};\n        if (isRv && r >= 9) {")
    b = s.index("        if (tx.red && !extra.color) extra.color = \"#ff0000\";")
    s = s[:a] + "        const extra = pvCfEval(cfPlan, ws, r, c, valOf);\n" + s[b:]
    s = rep(s, "    const isRv = /^ReportVat/i.test(ws.name);\n", "    const cfPlan = pvCfPlan(ws);\n    const valOf = (rr, cc) => { const v = ws.getRow(rr).getCell(cc).value; return v && typeof v === \"object\" && !(v instanceof Date) && \"formula\" in v ? v.result : v && typeof v === \"object\" && v.richText ? v.richText.map((x) => x.text).join(\"\") : v; };\n")
    s = s.replace("      const closed = isRv && r >= 9 && String((row.getCell(16).value && row.getCell(16).value.result) ?? row.getCell(16).value ?? \"\") === \"Closed\";\n", "")
    wr(p, s, c); print("OK", p)
else: print("skip", p)
