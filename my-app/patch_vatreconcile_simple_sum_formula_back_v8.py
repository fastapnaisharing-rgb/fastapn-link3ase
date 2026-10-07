# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_SIMPLE_SUM_FORMULA_BACK_V8
# ช่อง "รวมสาขา" / "รวมสุทธิ" ในชีต Simple ตอน Export ให้เป็นสูตร SUBTOTAL(9,..) จริง (ไม่ใช่ตัวเลขนิ่ง)
import sys, shutil, os
MARKER = "MARKER_VATRECONCILE_SIMPLE_SUM_FORMULA_BACK_V8"
def rd(p):
    b = open(p, "rb").read(); crlf = b"\r\n" in b
    return b.decode("utf-8").replace("\r\n", "\n"), crlf
def wr(p, s, crlf):
    if crlf: s = s.replace("\n", "\r\n")
    open(p, "wb").write(s.encode("utf-8"))
def rep(s, old, new):
    if s.count(old) != 1: sys.exit("ABORT anchor count=%d: %s" % (s.count(old), old[:70]))
    return s.replace(old, new)
def bak(p):
    n = 1
    while os.path.exists("%s.bak%02d" % (p, n)): n += 1
    shutil.copy2(p, "%s.bak%02d" % (p, n))

# ---- 1) vatReconcileOriginalWorkbook.js ----
p = "vatReconcileOriginalWorkbook.js"
s, crlf = rd(p)
if MARKER not in s:
    bak(p)
    s = rep(s, """    [...byB.keys()].sort().forEach((b) => {
      const list = byB.get(b);
      list.forEach((d) => {""", """    const subRows = []; // """ + MARKER + """
    [...byB.keys()].sort().forEach((b) => {
      const list = byB.get(b);
      const firstR = sw.rowCount + 1;
      list.forEach((d) => {""")
    s = rep(s, """      const row = sw.addRow([`${b} รวมสาขา`, "", "", "", "", "", "", "", "", "", ...["paid_amount", "paid_vat", "claimed_amount", "claimed_vat"].map((k) => r2(list.reduce((s, d) => s + (Number(d[k]) || 0), 0))), ""]);
      row.eachCell({ includeEmpty: true }, (c, i) => { c.font = { bold: true }; c.fill = fill(TOT80); c.border = ALL_THIN; if (i >= 11 && i <= 14) c.numFmt = NUM2; });
    });""", """      const lastR = sw.rowCount;
      const L4 = ["K", "L", "M", "N"];
      const row = sw.addRow([`${b} รวมสาขา`, "", "", "", "", "", "", "", "", "", ...["paid_amount", "paid_vat", "claimed_amount", "claimed_vat"].map((k, ci) => ({ formula: `SUBTOTAL(9,${L4[ci]}${firstR}:${L4[ci]}${lastR})`, result: r2(list.reduce((s, d) => s + (Number(d[k]) || 0), 0)) })), ""]);
      subRows.push(row.number);
      row.eachCell({ includeEmpty: true }, (c, i) => { c.font = { bold: true }; c.fill = fill(TOT80); c.border = ALL_THIN; if (i >= 11 && i <= 14) c.numFmt = NUM2; });
    });
    if (subRows.length) {
      const lastAll = sw.rowCount;
      const L4 = ["K", "L", "M", "N"];
      const gk = ["paid_amount", "paid_vat", "claimed_amount", "claimed_vat"];
      const grow = sw.addRow(["รวมสุทธิ", "", "", "", "", "", "", "", "", "", ...gk.map((k, ci) => ({ formula: `SUBTOTAL(9,${L4[ci]}2:${L4[ci]}${lastAll})`, result: r2((src.simple || []).reduce((s, d) => s + (Number(d[k]) || 0), 0)) })), ""]);
      grow.eachCell({ includeEmpty: true }, (c, i) => { c.font = { bold: true }; c.fill = fill(TOT60); c.border = bd("thin", "thin", "double", "thin"); if (i >= 11 && i <= 14) c.numFmt = NUM2; });
    }""")
    wr(p, s, crlf); print("OK", p)
else: print("skip", p)

# ---- 2) vatReconcileReportFiles.js (Legacy: Simple AVG / Simple Excel BU) ----
p = "vatReconcileReportFiles.js"
s, crlf = rd(p)
if MARKER not in s:
    bak(p)
    s = rep(s, """    [...byB.keys()].sort().forEach((b) => {
      const list = byB.get(b);
      list.forEach((d) => srows.push(""", """    [...byB.keys()].sort().forEach((b) => { // """ + MARKER + """
      const list = byB.get(b);
      const firstR = srows.length + 2;
      list.forEach((d) => srows.push(""")
    s = rep(s, """      srows.push({ values: [`${b} รวมสาขา`, "", "", "", "", "", "", "", "", "", sum("paid_amount"), sum("paid_vat"), sum("claimed_amount"), sum("claimed_vat"), ""], bold: true });
    });""", """      const lastR = srows.length + 1;
      const fm = (L, k) => ({ formula: `SUBTOTAL(9,${L}${firstR}:${L}${lastR})`, result: sum(k) });
      srows.push({ values: [`${b} รวมสาขา`, "", "", "", "", "", "", "", "", "", fm("K", "paid_amount"), fm("L", "paid_vat"), fm("M", "claimed_amount"), fm("N", "claimed_vat"), ""], bold: true });
    });
    {
      const lastAll = srows.length + 1;
      const gs = (k) => r2(sim.reduce((s, d) => s + (Number(d[k]) || 0), 0));
      const gm = (L, k) => ({ formula: `SUBTOTAL(9,${L}2:${L}${lastAll})`, result: gs(k) });
      srows.push({ values: ["รวมสุทธิ", "", "", "", "", "", "", "", "", "", gm("K", "paid_amount"), gm("L", "paid_vat"), gm("M", "claimed_amount"), gm("N", "claimed_vat"), ""], bold: true });
    }""")
    wr(p, s, crlf); print("OK", p)
else: print("skip", p)
