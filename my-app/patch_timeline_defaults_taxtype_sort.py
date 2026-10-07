# -*- coding: utf-8 -*-
# MARKER_TIMELINE_DEFAULTS_TAXTYPE_SORT_V1
# 1) ปุ่ม Defaults Set: ตั้ง Enable/Disable ตามกฎ Tax Type (company_list.allowed_tax_type) + Rate (VAT %) แล้วบันทึกเป็นค่าเริ่มต้นของ BU
#    - N,T / A,T / All Type / No Type  -> การ์ดที่ผูก Tax Type: Input Summary, Incomplete/Input Reconcile, Final Step (Tax Code), Daily
#    - Rate = 100% -> Trial Balance + Expense 100% + Asset 100% เปิด (AVG ปิด) · Rate < 100% -> Trial Balance + Expense AVG + Asset AVG เปิด (ที่เป็น 100% ปิด)
#    - ไม่แตะ Step 1 และ Transfer Vat Status
# 2) เรียงการ์ด Enable ขึ้นก่อน (คงลำดับเดิมในกลุ่ม) ภายใน Box ตัวเอง -- คำนวณตอนเปิดหน้า BU และตอนกด Defaults Set เท่านั้น
import sys, io
path = sys.argv[1]
src = io.open(path, encoding="utf-8").read()
M = "MARKER_TIMELINE_DEFAULTS_TAXTYPE_SORT_V1"
if M in src:
    print("already patched"); sys.exit(0)
def rep(old, new, label):
    global src
    assert src.count(old) == 1, "anchor count != 1: %s (%d)" % (label, src.count(old))
    src = src.replace(old, new)

# ---- A) company_list -> BU: เพิ่ม taxType ----
rep('nameEn: String(colOf(c, "ENGLISH COMPANY NAME") || "").trim() };',
    'nameEn: String(colOf(c, "ENGLISH COMPANY NAME") || "").trim(), taxType: String(colOf(c, "allowed_tax_type") ?? "").trim() /* ' + M + ' */ };', "mkRealBu")
rep('vatRate: fresh.vatRate, prep: fresh.prep, mine }',
    'vatRate: fresh.vatRate, taxType: fresh.taxType, prep: fresh.prep, mine }', "merge")

# ---- B) ฟังก์ชันกฎ ----
helpers = '''// ''' + M + ''' -- กฎ Defaults ตาม Tax Type + Rate
const TAX_CODES = ["A", "N", "T", "F", "M"];
// 'N,T' / 'A,T' / 'All Type' / 'No Type' -> Set ของ Tax Code ที่ใช้ (null = อ่านรูปแบบไม่ออก -> ไม่ใช้กฎ)
function parseTaxTypes(raw) {
  const s = String(raw == null ? "" : raw).trim().toUpperCase().replace(/\\s+/g, " ");
  if (!s) return null;
  if (/^ALL( TYPE)?$/.test(s)) return new Set(TAX_CODES);
  if (/^NO( TYPE)?$/.test(s)) return new Set();
  const toks = s.split(/[^A-Z]+/).filter(Boolean);
  if (!toks.length || !toks.every((t) => TAX_CODES.includes(t))) return null;
  return new Set(toks);
}
// vat[i] = true/false/undefined(ไม่แตะ) ตาม VAT_CARDS: 0,1 Daily Average (ต้องมี A) · 2 Suspense N · 3 Suspense T/F · 4 Trial Balance · 5,6 Expense · 7,8 Asset
function defaultsRule(taxRaw, rate) {
  const tt = parseTaxTypes(taxRaw);
  if (!tt) return null;
  const none = tt.size === 0;
  const codes = TAX_CODES.reduce((o, k) => ({ ...o, [k]: tt.has(k) }), {});
  const vat = [tt.has("A"), tt.has("A"), tt.has("N"), tt.has("N") && (tt.has("T") || tt.has("F"))];
  const r100 = typeof rate === "number" && Math.abs(rate - 100) < 1e-9;
  const rLt = typeof rate === "number" && rate > 0 && rate < 100;
  if (none) vat.push(false, false, false, false, false);
  else if (r100) vat.push(true, true, false, true, false); // Rate 100%: Trial Balance เปิด · Expense 100% เปิด · Asset 100% เปิด (AVG ปิด)
  else if (rLt) vat.push(true, false, true, false, true); // Rate < 100%: Trial Balance เปิด · Expense AVG เปิด · Asset AVG เปิด (ตัวที่เป็น 100% ปิด)
  else vat.push(undefined, undefined, undefined, undefined, undefined);
  return { none, codes, vat };
}
function applyDefaultsRule(x, rule) {
  REQ_GROUPS.forEach((g) => {
    const cells = x.req[g];
    TAX_CODES.forEach((k) => { if (!rule.codes[k]) cells[k] = "X"; else if (cells[k] === "X") cells[k] = ""; });
    if (g !== "Input Summary") { if (rule.none) cells.All = "X"; else if (cells.All === "X") cells.All = ""; }
  });
  ["first", "final"].forEach((sd) => RPT_CODES.forEach((c) => ["inc", "inp"].forEach((rk) => {
    const cur = x.rpt[sd][c][rk];
    x.rpt[sd][c][rk] = !rule.codes[c] ? "X" : cur === "X" ? "P" : cur;
  })));
  rule.vat.forEach((want, i) => {
    if (want === undefined) return;
    const c = x.vat.cards[i];
    c.on = want;
    if (!want) { c.v = ""; c.by = ""; }
  });
}

'''
rep("function mkRealBu(c) {", helpers + "function mkRealBu(c) {", "mkRealBu anchor")

# ---- C) Defaults Set (Parent) ----
rep('''  const onDefaultsSet = () => {
    mutate(cur, (x) => { const snap = clone(pickProg(x)); delete snap.defaults; delete snap.rhist; delete snap.rnotes; resetValues(snap); x.defaults = snap; });
    log(cur, "Defaults Set (บันทึก Enable/Disable เป็นค่าเริ่มต้นของ BU)");
  };''', '''  const onDefaultsSet = () => {
    const b = bus[cur];
    const rule = defaultsRule(b.taxType, b.vatRate);
    if (rule && !window.confirm(`Defaults Set จะตั้ง Enable/Disable ของ BU ${b.bu} ตาม Tax Type "${b.taxType}"${typeof b.vatRate === "number" ? ` และ Rate ${b.vatRate}%` : ""}\\nแล้วบันทึกเป็นค่าเริ่มต้น (ทับ Enable/Disable ที่ตั้งไว้เดิม ค่าที่กรอกไว้ไม่หาย)\\n\\nต้องการดำเนินการต่อหรือไม่?`)) return;
    mutate(cur, (x) => { if (rule) applyDefaultsRule(x, rule); const snap = clone(pickProg(x)); delete snap.defaults; delete snap.rhist; delete snap.rnotes; resetValues(snap); x.defaults = snap; });
    log(cur, rule ? `Defaults Set (ตาม Tax Type ${b.taxType}${typeof b.vatRate === "number" ? ` · Rate ${b.vatRate}%` : ""})` : "Defaults Set (บันทึก Enable/Disable เป็นค่าเริ่มต้นของ BU)");
  };''', "onDefaultsSet")

# ---- D) BuPage: ลำดับการเรียง (คำนวณตอนเปิดหน้า + ตอนกด Defaults Set) ----
rep("  const renderVatCard = (i) => {",
'''  // ''' + M + ''' -- Enable ขึ้นก่อน (Stable) ภายใน Box ตัวเอง · คำนวณใหม่เฉพาะตอนเปิดหน้า BU / กด Defaults Set (ไม่วิ่งตามตอนกดสวิตช์)
  const [sortVer, setSortVer] = React.useState(0);
  const order = React.useMemo(() => {
    const onFirst = (arr, isOn) => [...arr].sort((a, b) => (isOn(a) ? 0 : 1) - (isOn(b) ? 0 : 1));
    const rptOn = (c) => ["first", "final"].some((sd) => ["inc", "inp"].some((rk) => u.rpt[sd][c][rk] !== "X"));
    return {
      daily: onFirst([0, 1, 2, 3], (i) => u.vat.cards[i].on),
      simple: onFirst([5, 6, 7, 8], (i) => u.vat.cards[i].on),
      sum: onFirst(["A", "N", "T", "F", "M"], (k) => u.req["Input Summary"][k] !== "X"),
      req: ["All", ...onFirst(REQ_KEYS.filter((k) => k !== "All"), (k) => u.req.Incomplete[k] !== "X" || u.req["Input Reconcile"][k] !== "X")],
      rpt: onFirst(RPT_CODES, rptOn),
    };
  }, [sortVer, u.bu]); // eslint-disable-line react-hooks/exhaustive-deps
  const renderVatCard = (i) => {''', "order")
rep('onClick={onDefaultsSet} style={{ ...btn, height: 40, width: "100%"', 'onClick={() => { onDefaultsSet(); setSortVer((v) => v + 1); }} style={{ ...btn, height: 40, width: "100%"', "defaults button")
rep("{[0, 1, 2, 3].map(renderVatCard)}", "{order.daily.map(renderVatCard)}", "daily")
rep("{[5, 6, 7, 8].map(renderVatCard)}", "{order.simple.map(renderVatCard)}", "simple")
rep('{["A", "N", "T", "F", "M"].map(renderSumCard)}', "{order.sum.map(renderSumCard)}", "sum")
rep("            {REQ_KEYS.map((k) => {\n              const v = cells[k];", "            {order.req.map((k) => {\n              const v = cells[k];", "req keys")
rep("        {RPT_CODES.map((c) => (\n          <React.Fragment key={c}>", "        {order.rpt.map((c) => (\n          <React.Fragment key={c}>", "rpt")

io.open(path, "w", encoding="utf-8", newline="").write(src)
print("patched OK")
