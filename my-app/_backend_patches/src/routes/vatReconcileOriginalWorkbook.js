import ExcelJS from "exceljs";

// MARKER_VATRECONCILE_ORIGINAL_WORKBOOK_V1
/**
 * สร้าง Workbook ให้เหมือนไฟล์ Reconcile ต้นฉบับ (เช่น 0561_OOF_11610755_SEP-26.xlsx) -- Template "100" / "100_simple"
 * ชีต: Cover · ReportVat_VGR · Detail · TB · Pivot (+ Simple Excel BU ถ้ามี Simple 100%)
 * สูตรทุกจุดเหมือนต้นฉบับ (Cover→TB/ReportVat, ReportVat→Pivot/TB, Pivot→Detail, Detail!P/Q) ปรับช่วงแถวตามจำนวนสาขา/รายการจริง
 */
const NAVY = "FF002060";
const WHITE = "FFFFFFFF";
const TOT80 = "FFDEEBF7"; // theme8 tint 0.8
const TOT60 = "FFBDD7EE"; // theme8 tint 0.6
const TOT40 = "FF9DC3E6"; // theme8 tint 0.4
const ACC = '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)';
const NUM2 = "#,##0.00_);[Red](#,##0.00)";
const DATEF = "[$-409]d\\-mmm\\-yy;@";

const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const bd = (l, r, t, b) => {
  const o = {};
  if (l) o.left = { style: l };
  if (r) o.right = { style: r };
  if (t) o.top = { style: t };
  if (b) o.bottom = { style: b };
  return o;
};
const ALL_THIN = bd("thin", "thin", "thin", "thin");
const bdc = (argb, l, r, t, b) => { const o = bd(l, r, t, b); Object.keys(o).forEach((k) => { o[k].color = { argb }; }); return o; };
const GREY_THIN = "FFD9D9D9"; // theme0 tint -0.15 (เส้นตารางสรุป Cover)
const GREY_BOX = "FFBFBFBF"; // theme0 tint -0.25 (กรอบ Medium Cover)
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function put(ws, addr, value, o = {}) {
  const c = ws.getCell(addr);
  if (value !== undefined && value !== null) c.value = value;
  if (o.font) c.font = o.font;
  if (o.fill) c.fill = fill(o.fill);
  if (o.border) c.border = o.border;
  if (o.al) c.alignment = o.al;
  if (o.nf) c.numFmt = o.nf;
  return c;
}
const toDate = (s) => {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
};
const dayNum = (s) => { const d = toDate(s); return d ? Math.floor(d.getTime() / 86400000) : null; };
const colL = (n) => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

// ผลลัพธ์ของสูตร Status (Detail!Q) -- ใช้เป็น cached result ให้ไฟล์เปิดแล้วเห็นค่าทันที (Excel คำนวณใหม่เองอยู่แล้ว)
function statusResult(d) {
  const a = dayNum(d.receive_date), b = dayNum(d.tax_invoice_date);
  if (a != null && b != null && b - a > 0) return "Futuredate";
  const chk = r2((Number(d.paid_amount) || 0) * 7 / 100 - (Number(d.claimed100_vat) || 0));
  return Math.abs(chk) <= 0.05 ? "Balance" : "Unbalance";
}
const STATUS_F = (r) =>
  `IF(AND(IFERROR(DATEDIF($C${r},$E${r},"D"),"P")<>"P",IFERROR(DATEDIF($C${r},$E${r},"D"),"P")<>0),"Futuredate",IF(COUNTIF($A${r},"*Total*"),"True",_xlfn.SWITCH(ROUND($L${r}*7/100-$O${r},2),0,"Balance",0.01,"Balance",0.02,"Balance",0.03,"Balance",0.04,"Balance",0.05,"Balance",-0.01,"Balance",-0.02,"Balance",-0.03,"Balance",-0.04,"Balance",-0.05,"Balance","Unbalance")))`;

function thaiDateDots(d) {
  const dd = String(d.getDate()).padStart(2, "0"), mm = String(d.getMonth() + 1).padStart(2, "0");
  return `วันที่ ...${dd}…/...${mm}…/...${d.getFullYear()}...`;
}

// MARKER_VATRECONCILE_SIMPLE_REPORT_FORMAT_BACK_V21
// ═══ ชีต Simple ตามไฟล์ต้นฉบับจริง (Simple_Report_Vat_100/AVG) -- Layout รายงาน Oracle: หัวรายงาน (แถว 1-6) + Block ต่อสาขา
// ═══ (ชื่อผู้ประกอบการ/ที่อยู่ -> หัวตาราง 2 แถว -> รายการ -> รวมสาขา) + รวมสุทธิ | คอลัมน์ B-AA, ซ่อนเส้นตาราง
const LRO = "‭", PDFMARK = "‬";
const lrWrap = (v) => { const s = String(v == null ? "" : v).replace(/[‪-‮]/g, "").trim(); return s ? `${LRO}${s}${PDFMARK}` : ""; };
const SM_BLACK = "FF000000";
const SM_THIN = { style: "thin", color: { argb: SM_BLACK } };
const SM_BOX = { top: SM_THIN, left: SM_THIN, bottom: SM_THIN, right: SM_THIN };
const SM_W = { type: "pattern", pattern: "solid", fgColor: { argb: WHITE } };
const SM_HDR = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7F3FD" } };
const smF = (size, bold, argb) => ({ name: "Tahoma", size, bold: !!bold, color: { argb: argb || SM_BLACK } });
const SM_WIDTHS = [0.164, 11.5, 7.164, 7.164, 7.164, 7.5, 7.164, 7.164, 7.164, 8.664, 7.164, 7.164, 7.164, 14.664, 7.164, 10.5, 8.332, 7.164, 7.5, 18, 12.832, 16.164, 17.5, 7.164, 7.164, 7.164, 13, 0.164];
const SM_NUM = "#,##0.00";

/**
 * groups: [{ branch, header:{ report_title, bu_code, report_id, print_date, print_by, operator_name, address_line1..3, company_tax_id, branch_no }, rows:[...] }]
 * คืน { firstDataRow, subtotalRows: { [branch]: row }, grandRow }
 */
export function writeSimpleOriginalSheet(ws, groups, opts = {}) {
  const info = { subtotalRows: {}, grandRow: null, firstDataRow: null };
  const gs = (groups || []).filter((g) => g);
  const subOf = (g, k) => { const v = opts.useSub && g && g.rows && g.rows[0] ? g.rows[0][`sub_${k}`] : null; return v == null || v === "" ? null : Number(v); };
  SM_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.views = [{ showGridLines: false, zoomScale: opts.zoom || 70, zoomScaleNormal: opts.zoom || 70 }];
  ws.pageSetup = { orientation: "landscape", paperSize: 9, fitToWidth: 1, fitToHeight: 0 };
  ws.properties.defaultRowHeight = 14.25;
  const merge = (r, a, b) => ws.mergeCells(`${a}${r}:${b}${r}`);
  const cell = (r, L, v, o = {}) => {
    const c = ws.getCell(`${L}${r}`);
    if (v !== undefined && v !== null) c.value = v;
    c.font = o.font || smF(11, false);
    if (o.fill !== null) c.fill = o.fill || SM_W;
    if (o.border) c.border = o.border;
    if (o.al) c.alignment = o.al;
    if (o.nf) c.numFmt = o.nf;
    return c;
  };
  const colN = (L) => L.split("").reduce((s, ch) => s * 26 + ch.charCodeAt(0) - 64, 0);
  const colS = (n) => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const boxRange = (r, a, b, border) => { for (let c = colN(a); c <= colN(b); c++) ws.getCell(`${colS(c)}${r}`).border = border; };
  const h0 = (gs[0] && gs[0].header) || {};
  const TOP = { vertical: "top", wrapText: true };

  // ── หัวรายงาน (แถว 1-7) ──
  ws.getRow(1).height = 26.5; merge(1, "B", "AA");
  cell(1, "B", h0.report_title || "รายงานภาษีซื้อ", { font: smF(18, true), al: { horizontal: "center", ...TOP } });
  ws.getRow(2).height = 9; merge(2, "B", "AA"); cell(2, "B", null);
  const meta = [["Bu Code:", h0.bu_code || opts.buCode || "", 14.9], ["Report ID:", lrWrap(h0.report_id), 13.5], ["Print Date:", lrWrap(h0.print_date), 13.5], ["Print By:", h0.print_by || "", 13.5]];
  meta.forEach(([lab, val, h], i) => {
    const r = 3 + i; ws.getRow(r).height = h;
    merge(r, "B", "C"); merge(r, "D", "F"); merge(r, "G", "H"); merge(r, "I", "J");
    if (i < 2) { merge(r, "K", "W"); merge(r, "X", "Y"); merge(r, "Z", "AA"); } else merge(r, "K", "AA");
    cell(r, "B", `   ${lab}`, { font: smF(9, true), al: TOP });
    cell(r, "D", val, { font: smF(9, false), al: TOP });
  });
  merge(7, "B", "AA"); cell(7, "B", null);

  let r = 8;
  const dataRowsAll = [];
  gs.forEach((g, gi) => {
    const h = g.header || {};
    const br = String(g.branch == null ? "" : g.branch);
    // ── Block หัวบริษัท (4 แถว) ──
    const co = [
      ["ชื่อผู้ประกอบการ", h.operator_name || "", "เลขประจำตัวผู้เสียภาษี", h.company_tax_id ? `: ${String(h.company_tax_id).replace(/^:\s*/, "")}` : "", 14.4],
      ["ที่อยู่", h.address_line1 || "", "รหัสสาขา", `: ${lrWrap(br)}`, 13.5],
      ["", h.address_line2 || "", "สาขาที่", h.branch_no ? `: ${String(h.branch_no).replace(/^:\s*/, "")}` : "", 13.5],
      ["", h.address_line3 || "", "", "", 13.5],
    ];
    co.forEach(([l1, v1, l2, v2, ht], i) => {
      const rr = r + i; ws.getRow(rr).height = ht;
      merge(rr, "C", "E"); merge(rr, "F", "K"); merge(rr, "M", "N");
      if (i === 0) { merge(rr, "O", "Q"); merge(rr, "U", "AA"); }
      else if (i === 1) { merge(rr, "O", "Q"); merge(rr, "S", "T"); merge(rr, "U", "AA"); }
      else merge(rr, "O", "AA");
      cell(rr, "C", l1 || null, { font: smF(9, true), al: TOP });
      cell(rr, "F", v1 || null, { font: smF(9, false), al: TOP });
      cell(rr, "M", l2 || null, { font: smF(9, true), al: TOP });
      cell(rr, "O", v2 || null, { font: smF(9, false, WHITE), al: TOP }); // ต้นฉบับตั้งสีตัวอักษรขาว (ซ่อนค่า)
    });
    r += 4;
    // เส้นคั่น (แถว 12 ต้นฉบับ)
    ws.getRow(r).height = 20.65; merge(r, "B", "AA");
    for (let c = 2; c <= 27; c++) ws.getCell(`${colS(c)}${r}`).border = { bottom: SM_THIN };
    cell(r, "B", null, { border: { bottom: SM_THIN } });
    r += 1;
    // ── หัวตาราง 2 แถว ──
    const H = { font: smF(9, true), fill: SM_HDR, al: { horizontal: "center", vertical: "middle", wrapText: true } };
    ws.getRow(r).height = 24.25; ws.getRow(r + 1).height = 22;
    for (let c = 2; c <= 27; c++) { cell(r, colS(c), null, { ...H }); cell(r + 1, colS(c), null, { ...H }); }
    const hm = (a, b, rr, v) => { merge(rr, a, b); ws.getCell(`${a}${rr}`).value = v; };
    hm("B", "D", r, "รับสินค้า/รับเอกสาร"); hm("E", "M", r, "ใบกำกับภาษี");
    ws.mergeCells(`N${r}:O${r + 1}`); ws.getCell(`N${r}`).value = "เลขประจำตัวผู้เสียภาษีอากร";
    ws.mergeCells(`P${r}:P${r + 1}`); ws.getCell(`P${r}`).value = "สถานประกอบการ สาขาที่";
    ws.mergeCells(`Q${r}:T${r + 1}`); ws.getCell(`Q${r}`).value = "รายการ";
    hm("U", "V", r, "ภาษีซื้อที่ชำระ"); hm("W", "AA", r, "ภาษีซื้อที่ใช้สิทธิ์");
    const r14 = r + 1;
    ws.getCell(`B${r14}`).value = "วัน/เดือน/ปี"; hm("C", "D", r14, "ลำดับที่"); hm("E", "G", r14, "วัน/เดือน/ปี"); hm("H", "I", r14, "เลขที่"); hm("J", "M", r14, "ชื่อผู้ค้า");
    ws.getCell(`U${r14}`).value = "มูลค่าสินค้า"; ws.getCell(`V${r14}`).value = "เงินภาษี"; hm("W", "X", r14, "มูลค่าสินค้า"); hm("Y", "Z", r14, "เงินภาษี"); ws.getCell(`AA${r14}`).value = "(%)";
    for (let c = 2; c <= 27; c++) { ws.getCell(`${colS(c)}${r}`).border = SM_BOX; ws.getCell(`${colS(c)}${r14}`).border = SM_BOX; }
    r += 2;
    // ── รายการ ──
    const first = r;
    if (info.firstDataRow == null) info.firstDataRow = first;
    const D = { font: smF(9, false), al: { wrapText: true }, border: SM_BOX };
    (g.rows || []).forEach((d) => {
      ws.getRow(r).height = 19.75;
      for (let c = 2; c <= 27; c++) cell(r, colS(c), null, { ...D });
      [["C", "D"], ["E", "G"], ["H", "I"], ["J", "M"], ["N", "O"], ["Q", "T"], ["W", "X"], ["Y", "Z"]].forEach(([a, b]) => merge(r, a, b));
      const num = (L, v) => cell(r, L, v == null || v === "" ? null : Number(v), { ...D, al: { horizontal: "right", wrapText: true }, nf: SM_NUM });
      cell(r, "B", toDate(d.receive_date), { ...D, nf: "d-mmm-yy" });
      cell(r, "C", lrWrap(d.running_no) || null, D);
      cell(r, "E", toDate(d.tax_invoice_date), { ...D, nf: "d-mmm-yy" });
      cell(r, "H", lrWrap(d.tax_invoice_no) || null, D);
      cell(r, "J", d.vendor_name || null, D);
      cell(r, "N", lrWrap(d.tax_id) || null, D);
      const bf = d.branch_field == null ? "" : String(d.branch_field).trim();
      cell(r, "P", /^\d+$/.test(bf) ? Number(bf) : (bf || null), D);
      cell(r, "Q", d.item_detail || null, D);
      num("U", d.paid_amount); num("V", d.paid_vat); num("W", d.claimed_amount); num("Y", d.claimed_vat);
      cell(r, "AA", d.claim_percent == null || d.claim_percent === "" ? null : Number(d.claim_percent), { ...D, al: { horizontal: "right", wrapText: true }, nf: "0.00%" });
      dataRowsAll.push(r);
      r += 1;
    });
    const last = r - 1;
    // ── รวมสาขา ──
    const sum = (k) => Math.round((g.rows || []).reduce((s, d) => s + (Number(d[k]) || 0), 0) * 100) / 100;
    ws.getRow(r).height = 19.25;
    const B = { font: smF(9, true), al: { wrapText: true }, border: SM_BOX };
    for (let c = 2; c <= 27; c++) cell(r, colS(c), null, { ...B });
    [["B", "P"], ["Q", "T"], ["W", "X"], ["Y", "Z"]].forEach(([a, b]) => merge(r, a, b));
    cell(r, "Q", `รวมสาขา ${lrWrap(br)}`, B);
    // MARKER_VATRECONCILE_SIMPLE_SUBTOTAL_COLS_V1 -- opts.useSub: ใช้ยอด "รวมสาขา" ที่พิมพ์มากับไฟล์ต้นฉบับ (ค่าคงที่ ไม่ใช่สูตร) เหมือนไฟล์ Reconcile จริงของ Template หัว %
    const fm = (L, k) => { const sv = subOf(g, k); return cell(r, L, sv != null ? sv : (last >= first ? { formula: `SUBTOTAL(9,${L}${first}:${L}${last})`, result: sum(k) } : 0), { ...B, al: { horizontal: "right", wrapText: true }, nf: SM_NUM }); };
    fm("U", "paid_amount"); fm("V", "paid_vat"); fm("W", "claimed_amount"); fm("Y", "claimed_vat");
    info.subtotalRows[br] = r;
    r += 1;
    // ── แถวคั่น (สูง 9.25) ──
    ws.getRow(r).height = 9.25;
    for (let c = 2; c <= 27; c++) cell(r, colS(c), null, { border: { top: SM_THIN } });
    [["B", "P"], ["Q", "T"], ["W", "X"], ["Y", "Z"]].forEach(([a, b]) => merge(r, a, b));
    r += 1;
    if (gi < gs.length - 1) { merge(r, "B", "AA"); cell(r, "B", null); r += 1; } // แถวว่างคั่นระหว่างสาขา
  });
  // ── รวมสุทธิ ──
  if (gs.length) {
    ws.getRow(r).height = 19.25;
    const G = { font: smF(9, true), al: { wrapText: true } };
    for (let c = 2; c <= 27; c++) cell(r, colS(c), null, { ...G });
    [["B", "P"], ["Q", "T"], ["W", "X"], ["Y", "Z"]].forEach(([a, b]) => merge(r, a, b));
    cell(r, "Q", "รวมสุทธิ", G);
    const all = gs.flatMap((g) => g.rows || []);
    const tk = (k) => Math.round(all.reduce((s, d) => s + (Number(d[k]) || 0), 0) * 100) / 100;
    const f0 = info.firstDataRow, lastAll = r - 1;
    // MARKER_VATRECONCILE_SIMPLE_GRAND_SUM_OF_SUBTOTALS_V1 -- รวมสุทธิ = บวกยอด "รวมสาขา" ของแต่ละช่วง (ไม่ใช่ SUBTOTAL ครอบทั้งช่วง)
    const subRows = Object.values(info.subtotalRows);
    const grpSum = (g, k) => { const sv = subOf(g, k); return sv != null ? sv : Math.round((g.rows || []).reduce((s, d) => s + (Number(d[k]) || 0), 0) * 100) / 100; };
    const tkSub = (k) => Math.round(gs.reduce((s, g) => s + grpSum(g, k), 0) * 100) / 100;
    [["U", "paid_amount"], ["V", "paid_vat"], ["W", "claimed_amount"], ["Y", "claimed_vat"]].forEach(([L, k]) => {
      const useSub = !opts.useSub && subRows.length > 0 && subRows.length <= 1000; // หัว % (opts.useSub): รวมสุทธิ = ผลรวมแถวรายการ ตรงกับที่พิมพ์ในไฟล์ต้นฉบับ // สูตร Excel ยาวได้ไม่เกิน 8192 ตัวอักษร
      const f = useSub ? subRows.map((x) => `${L}${x}`).join("+") : `SUBTOTAL(9,${L}${f0}:${L}${lastAll})`;
      cell(r, L, { formula: f, result: useSub ? tkSub(k) : tk(k) }, { ...G, al: { horizontal: "right", wrapText: true }, nf: SM_NUM });
    });
    info.grandRow = r;
  }
  return info;
}

/** จัดกลุ่ม src.simple เป็น groups ตามสาขา (ต่อ simple_type) พร้อม header ต่อสาขา */
export function simpleRowsToGroups(rows, type) {
  let list = rows || [];
  if (type) { const f = list.filter((d) => String(d.simple_type) === String(type)); list = f.length ? f : list; }
  const byB = new Map();
  list.forEach((d) => {
    const k = String(d.branch);
    if (!byB.has(k)) byB.set(k, { branch: k, header: { report_title: d.report_title, bu_code: d.bu_code, report_id: d.report_id, print_date: d.print_date, print_by: d.print_by, operator_name: d.operator_name, address_line1: d.address_line1, address_line2: d.address_line2, address_line3: d.address_line3, company_tax_id: d.company_tax_id, branch_no: d.branch_no }, rows: [] });
    byB.get(k).rows.push(d);
  });
  return [...byB.keys()].sort().map((k) => byB.get(k));
}

export function buildOriginalWorkbook(rep, bu, period, opts = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = opts.preparedBy || "FASTAPN Link3ase";
  wb.created = new Date();
  wb.calcProperties = { fullCalcOnLoad: true };

  const src = rep.sources || { detail: [], tb: [], simple: [] };
  const account = String(rep.account);
  const accountNum = /^\d+$/.test(account) ? Number(account) : account;
  const hasSimple = rep.template === "100_simple" && (src.simple || []).length > 0;
  const numericBu = (rep.buCode && rep.buCode.numeric) || "";
  const companyEn = rep.header.companyEn || rep.header.company || "";
  const branches = rep.rows.map((r) => String(r.branch));
  const bMin = branches[0] || "", bMax = branches[branches.length - 1] || "";
  const [py, pm] = String(period).split("-").map(Number);
  const periodEnd = new Date(Date.UTC(py, pm, 0));
  const exportDate = opts.exportDate || new Date();
  const preparedBy = opts.preparedBy || "";
  const companyLine = `${numericBu ? numericBu + " " : ""}${companyEn}`.trim();
  const branchLine = `${bMin}-${bMax} ${companyEn}`.trim();
  const tbLabel = rep.tbLabel;
  const nameBy = new Map(rep.rows.map((r) => [String(r.branch), r.name || ""]));

  const view = (o) => [{ showGridLines: false, ...o }];
  const header7 = (ws) => {
    // บล็อกหัวกระดาษ (Detail / TB ใช้ร่วมกัน)
    put(ws, "A1", "DETAIL OF ACCOUNT", { font: { name: "Calibri", size: 11 } });
    const rows = [["Company ", companyLine], ["Branch ", branchLine], ["Account code ", accountNum], ["Account name", rep.accountName || ""], ["Period", periodEnd]];
    rows.forEach((x, i) => {
      put(ws, `A${3 + i}`, x[0], { font: { name: "Calibri", size: 11 } });
      put(ws, `B${3 + i}`, x[1], { font: { name: "Calibri", size: 11 }, al: { horizontal: "left" }, nf: x[1] instanceof Date ? "d-mmm-yy" : undefined });
    });
  };

  const cover = wb.addWorksheet("Cover");
  const rv = wb.addWorksheet("ReportVat_VGR");
  const dt = wb.addWorksheet("Detail");
  const tb = wb.addWorksheet("TB");
  const pv = wb.addWorksheet("Pivot");

  // ═════════════ TB ═════════════
  header7(tb);
  const TBH = ["Branch", "CPC", "Account", "SubAcc", "Description", "Beginnging Balance", "Period Activity", "Ending Balance"];
  TBH.forEach((h, i) => put(tb, `${colL(i + 1)}9`, h, { font: { name: "Calibri", size: 11, color: { argb: WHITE } }, fill: NAVY, border: ALL_THIN, al: { horizontal: "center", vertical: "middle" }, nf: i >= 5 ? ACC : undefined }));
  const tbRows = [...(src.tb || [])].sort((a, b) => String(a.branch).localeCompare(String(b.branch)) || String(a.cpc).localeCompare(String(b.cpc)) || String(a.subacc).localeCompare(String(b.subacc)));
  let tr = 10;
  tbRows.forEach((t) => {
    const vals = [String(t.branch), String(t.cpc ?? ""), String(t.account ?? account), String(t.subacc ?? ""), t.description || "", Number(t.beginning_balance) || 0, Number(t.period_activity) || 0, Number(t.ending_balance) || 0];
    vals.forEach((v, i) => put(tb, `${colL(i + 1)}${tr}`, v, { font: { name: "Tahoma", size: 11 }, border: ALL_THIN, nf: i === 0 ? "@" : i >= 5 ? ACC : undefined }));
    tr++;
  });
  const tbLast = Math.max(tr - 1, 10);
  const tbTot = tr;
  put(tb, `A${tbTot}`, "Total", { font: { name: "Tahoma", size: 11, bold: true }, fill: TOT80, border: bd("thin", null, "thin", "thin"), nf: "@* \\>" });
  for (let c = 2; c <= 8; c++) put(tb, `${colL(c)}${tbTot}`, null, { font: { name: "Tahoma", size: 11, bold: true }, fill: TOT80, border: bd(null, c === 8 ? "thin" : null, "thin", "thin") });
  [["F", "beginning_balance"], ["G", "period_activity"], ["H", "ending_balance"]].forEach(([L, k]) => {
    put(tb, `${L}${tbTot}`, { formula: `SUM(${L}$10:${L}${tbLast})`, result: r2(tbRows.reduce((s, t) => s + (Number(t[k]) || 0), 0)) }, { font: { name: "Tahoma", size: 11, bold: true }, fill: TOT80, border: ALL_THIN, nf: ACC });
  });
  [13.58, 9.83, 11.25, 10.25, 21.58, 17.08, 14.83, 15.25].forEach((w, i) => { tb.getColumn(i + 1).width = w; });
  tb.getColumn(10).width = 13.58;
  tb.views = view({ state: "frozen", ySplit: 9, topLeftCell: "A10", zoomScale: 90 });
  tb.pageSetup = { paperSize: 9, orientation: "portrait" };

  // ═════════════ Detail ═════════════
  header7(dt);
  put(dt, "DD1", "INPUT-C");
  const DH = ["สาขา", "ชื่อผู้ประกอบการ", "วันที่ (รับสินค้า)", "GRT_No. (รับสินค้า)", "วันที่ใบกำกับภาษี", "เลขที่ใบกำกับภาษี", "ชื่อผู้ค้า", "TAX ID", "HO", "BRANCH", "รายการ",
    "ภาษีซื้อที่ชำระ(มูลค่าสินค้า)", "ภาษีซื้อที่ชำระ(เงินภาษี)", "ภาษีซื้อที่ชำระ(มูลค่าสินค้า)", "ภาษีซื้อที่ใช้สิทธิ์ (เงินภาษี)", "Calculate Tax", "Status"];
  DH.forEach((h, i) => {
    const q = i === 16;
    put(dt, `${colL(i + 1)}9`, h, { font: { name: q ? "Tahoma" : "Calibri", size: 11, color: { argb: WHITE } }, fill: NAVY, border: q ? undefined : bd("thin", "thin", "thin", null), al: { horizontal: "center", vertical: "middle", wrapText: true } });
  });
  dt.getRow(9).height = 26.5;
  const detByBranch = new Map();
  (src.detail || []).forEach((d) => { const k = String(d.branch); if (!detByBranch.has(k)) detByBranch.set(k, []); detByBranch.get(k).push(d); });
  const detBranches = [...detByBranch.keys()].sort();
  let dr = 10;
  const SUMK = ["paid_amount", "paid_vat", "claimed100_amount", "claimed100_vat"];
  const tot = (list, k) => r2(list.reduce((s, d) => s + (Number(d[k]) || 0), 0));
  const dataFont = { name: "Calibri", size: 12 };
  const dBorder = bd("thin", "thin", "thin", "hair");
  const totFont = { name: "Calibri", size: 13, bold: true };
  const totQ = { font: { ...totFont, color: { argb: TOT60 } }, fill: TOT60, border: bd(null, "thin", "thin", "thin"), al: { horizontal: "center", vertical: "middle" } };
  const totRow = (rowNo, label, first, last, list) => {
    put(dt, `A${rowNo}`, label, { font: totFont, fill: TOT60, border: bd("thin", null, "thin", "thin"), nf: NUM2 });
    for (let c = 2; c <= 17; c++) put(dt, `${colL(c)}${rowNo}`, null, { font: totFont, fill: TOT60, border: bd(null, null, "thin", "thin") });
    ["L", "M", "N", "O"].forEach((L, i) => put(dt, `${L}${rowNo}`, { formula: `SUBTOTAL(9,${L}${first}:${L}${last})`, result: tot(list, SUMK[i]) }, { font: totFont, fill: TOT60, border: ALL_THIN, nf: ACC }));
    put(dt, `Q${rowNo}`, { formula: STATUS_F(rowNo), result: "True", shareType: "array", ref: `Q${rowNo}` }, totQ); // MARKER_VATRECONCILE_DYNAMIC_FORMULA_BACK_V12
    dt.getRow(rowNo).height = 17;
  };
  detBranches.forEach((b) => {
    const list = detByBranch.get(b);
    const first = dr;
    list.forEach((d) => {
      const vals = [b, nameBy.get(b) || "", toDate(d.receive_date), d.grt_no ?? "", toDate(d.tax_invoice_date), d.tax_invoice_no ?? "", d.vendor_name ?? "", d.tax_id ?? "", d.ho ?? "", d.branch_field ?? "", d.item_detail ?? "",
        Number(d.paid_amount) || 0, Number(d.paid_vat) || 0, Number(d.claimed100_amount) || 0, Number(d.claimed100_vat) || 0];
      vals.forEach((v, i) => {
        const nf = i === 2 || i === 4 ? DATEF : i >= 10 ? ACC : NUM2;
        put(dt, `${colL(i + 1)}${dr}`, v === "" ? null : v, { font: dataFont, border: dBorder, nf });
      });
      put(dt, `P${dr}`, { formula: `ROUND($L${dr}*7/100-$O${dr},2)`, result: r2((Number(d.paid_amount) || 0) * 7 / 100 - (Number(d.claimed100_vat) || 0)) }, { font: dataFont, border: dBorder, nf: NUM2 });
      put(dt, `Q${dr}`, { formula: STATUS_F(dr), result: statusResult(d), shareType: "array", ref: `Q${dr}` }, { font: dataFont, border: dBorder, al: { horizontal: "center", vertical: "middle" } });
      const row = dt.getRow(dr); row.height = 15.5; row.outlineLevel = 2; row.hidden = true;
      dr++;
    });
    totRow(dr, `${b} Total`, first, dr - 1, list);
    const trw = dt.getRow(dr); trw.outlineLevel = 1;
    dr++;
  });
  const dGrand = dr;
  const allDet = src.detail || [];
  totRow(dGrand, "Grand Total", 10, dGrand - 1, allDet);
  [13.58, 30.25, 14.33, 16.58, 14.33, 14.58, 26.33, 14.58, 7.33, 7.33, 35.83, 14.33, 11.58, 14.33, 14.33, 14.33, 9.58].forEach((w, i) => { dt.getColumn(i + 1).width = w; });
  dt.properties.outlineLevelRow = 2;
  dt.views = view({ state: "frozen", xSplit: 1, ySplit: 9, topLeftCell: "B10", zoomScale: 85 });
  const dEnd = Math.max(dGrand, 22);
  dt.addConditionalFormatting({ ref: `K10:O${dEnd}`, rules: [{ type: "cellIs", operator: "lessThan", formulae: [0], priority: 3, style: { font: { color: { argb: "FFFF5050" } } } }] });
  dt.addConditionalFormatting({ ref: `A10:Q${dEnd}`, rules: [
    { type: "expression", formulae: ['$Q10="Futuredate"'], priority: 1, style: { font: { color: { theme: 3, tint: -0.749992370372631 } }, fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFCCECFF" } } } }, // MARKER_VATRECONCILE_CF_COLORS_BACK_V13
    { type: "expression", formulae: ['$Q10="Unbalance"'], priority: 2, style: { font: { color: { argb: "FFC00000" } }, fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFFFCC" } } } },
  ] });
  dt.pageSetup = { paperSize: 9, orientation: "portrait" };

  // ═════════════ Pivot ═════════════
  put(pv, "C2", "Data", { font: { name: "Tahoma", size: 11 } });
  const PH = ["สาขา", "ชื่อผู้ประกอบการ", "Sum of ภาษีซื้อที่ชำระ(มูลค่าสินค้า)", "Sum of ภาษีซื้อที่ชำระ(เงินภาษี)", "Sum of ภาษีซื้อที่ใช้สิทธิ์ 100%  (มูลค่าสินค้า)", "Sum of ภาษีซื้อที่ใช้สิทธิ์ 100%  (เงินภาษี)", "Count of สาขา"];
  PH.forEach((h, i) => put(pv, `${colL(i + 1)}3`, h, { font: { name: "Tahoma", size: 11, color: { argb: NAVY } }, fill: i < 2 ? "FFF2F2F2" : "FFCCFFCC", border: ALL_THIN, al: { horizontal: "center", vertical: "middle", wrapText: true } }));
  pv.getRow(3).height = 42;
  let pr = 4;
  const pvBranches = detBranches.length ? detBranches : branches;
  pvBranches.forEach((b) => {
    const list = detByBranch.get(b) || [];
    const cell = (L, f, res, nf, extra = {}) => put(pv, `${L}${pr}`, f == null ? res : { formula: f, result: res }, { font: { name: "Calibri", size: 12 }, border: ALL_THIN, nf, ...extra });
    cell("A", null, b);
    cell("B", null, nameBy.get(b) || "");
    cell("C", `ROUND(SUMIF(Detail!$A$10:$A$100002,Pivot!$A${pr},Detail!$L$10:$L$100002),2)`, tot(list, "paid_amount"), NUM2);
    cell("D", `ROUND(SUMIF(Detail!$A$10:$A$100002,Pivot!$A${pr},Detail!$M$10:$DI$100002),2)`, tot(list, "paid_vat"), NUM2);
    cell("E", `ROUND(SUMIF(Detail!$A$10:$A$100002,Pivot!$A${pr},Detail!$N$10:$N$100002),2)`, tot(list, "claimed100_amount"), NUM2);
    cell("F", `ROUND(SUMIF(Detail!$A$10:$A$100002,Pivot!$A${pr},Detail!$O$10:$O$100002),2)`, tot(list, "claimed100_vat"), NUM2);
    cell("G", `COUNTIF(Detail!$A$10:$A$100002,$A${pr})`, list.length, undefined, { al: { horizontal: "center", vertical: "middle" } });
    pv.getRow(pr).height = 15.5;
    pr++;
  });
  const pvLast = pr - 1, pvGrand = pr;
  put(pv, `A${pvGrand}`, "Grand Total", { font: { name: "Tahoma", size: 11 }, nf: "@* \\>" });
  [["C", "paid_amount"], ["D", "paid_vat"], ["E", "claimed100_amount"], ["F", "claimed100_vat"]].forEach(([L, k]) =>
    put(pv, `${L}${pvGrand}`, { formula: `SUM(${L}$4:${L}${pvLast})`, result: tot(allDet, k) }, { font: { name: "Calibri", size: 12 }, fill: "FFFFCCFF", border: bd("thin", "thin", "double", "thin"), nf: NUM2 }));
  put(pv, `G${pvGrand}`, { formula: `SUM(G$4:G${pvLast})`, result: allDet.length }, { font: { name: "Calibri", size: 12 }, fill: "FFFFCCFF", border: bd("thin", "thin", "double", "thin"), al: { horizontal: "center", vertical: "middle" } });
  put(pv, `X${pvGrand + 1}`, "TURN OFF");
  [11.83, 80.58, 18.58, 18.58, 18.58, 18.58, 13.75].forEach((w, i) => { pv.getColumn(i + 1).width = w; });
  pv.views = view({ state: "frozen", ySplit: 3, topLeftCell: "A4", zoomScale: 85 });

  // ═════════════ Simple Excel BU (เฉพาะกรณีมี Simple 100%) ═════════════
  let simSheetName = null, simInfo = null;
  if (hasSimple) {
    simSheetName = "Simple Excel BU";
    const sw = wb.addWorksheet(simSheetName);
    simInfo = writeSimpleOriginalSheet(sw, simpleRowsToGroups(src.simple, "100"), { buCode: bu, zoom: 70 }); // MARKER_VATRECONCILE_SIMPLE_REPORT_FORMAT_BACK_V21
  }
  const simSum = (b, k) => r2((simpleRowsToGroups(src.simple, "100").filter((g) => String(g.branch) === b).flatMap((g) => g.rows)).reduce((s, d) => s + (Number(d[k]) || 0), 0));

  // ═════════════ ReportVat_VGR ═════════════
  const F11 = { name: "Calibri", size: 11 };
  const TH = { name: "Tahoma", size: 11 };
  const titles = [rep.header.title, rep.header.company, rep.header.taxId ? `เลขประจำตัวผู้เสียภาษี     ${rep.header.taxId}` : "", `ประจำเดือน ${rep.header.periodLabel}`];
  titles.forEach((t, i) => { if (t) put(rv, `A${i + 1}`, t, { font: F11, al: { horizontal: "centerContinuous" } }); for (let c = 2; c <= 16; c++) rv.getCell(i + 1, c).alignment = { horizontal: "centerContinuous" }; });
  put(rv, "A6", accountNum, { font: F11 });
  put(rv, "N6", "Check Diff", { font: { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFCC" } }, fill: "FF262626", al: { vertical: "middle" }, nf: "@* \\>" });
  put(rv, "O6", { formula: 'IF(COUNTIF(Detail!$Q$10:$Q$100000,"Unbalance"),"Found Diff in Detail","Approve Balance")', result: rep.checkDiff && rep.checkDiff.unbalance > 0 ? "Found Diff in Detail" : "Approve Balance" }, { font: F11, al: { horizontal: "center", vertical: "middle" } });
  rv.getRow(6).height = 20.15; rv.getRow(7).height = 42;
  const hd = { font: { name: "Calibri", size: 11, color: { argb: WHITE } }, fill: NAVY, border: ALL_THIN, al: { horizontal: "center", vertical: "middle" } };
  const hdc = { ...hd, al: { horizontal: "centerContinuous", vertical: "middle" } };
  const hd2 = { ...hd, border: bd("thin", "thin", "thin", null) };
  rv.mergeCells("A7:A8"); put(rv, "A7", "รหัสสาขา", hd);
  rv.mergeCells("B7:B8"); put(rv, "B7", "สาขา", hd);
  [["C", "D", "ภาษีซื้อ Input-N 100%"], ["E", "F", "ภาษีซื้อ Excel-N 100%"], ["G", "H", "รวมภาษีซื้อ"], ["K", "L", "รวมภาษีซื้อทั้งสิ้น"]].forEach(([L, L2, t]) => {
    put(rv, `${L}7`, t, hdc); put(rv, `${L2}7`, null, hdc);
  });
  rv.mergeCells("I7:J7"); put(rv, "I7", "ภาษีซื้อที่ต้องยื่นเพิ่มเติม", hd);
  put(rv, "M7", "ภาษีตาม T/B ", hd);
  rv.mergeCells("N7:N8"); put(rv, "N7", "ผลต่าง", hd);
  rv.mergeCells("O7:O8"); put(rv, "O7", "Remark", { ...hd, border: undefined });
  rv.mergeCells("P7:P8"); put(rv, "P7", "Status", { ...hd, border: undefined });
  for (let c = 3; c <= 12; c++) put(rv, `${colL(c)}8`, c % 2 === 1 ? "มูลค่า" : "ภาษี", hd2);
  put(rv, "M8", tbLabel, hd2);

  const rvFirst = 9;
  let rr = rvFirst;
  rep.rows.forEach((row) => {
    const b = String(row.branch);
    const list = detByBranch.get(b) || [];
    const inA = tot(list, "paid_amount"), inV = tot(list, "paid_vat");
    const exA = hasSimple ? simSum(b, "claimed_amount") : 0, exV = hasSimple ? simSum(b, "claimed_vat") : 0;
    const c = (L, v, o = {}) => put(rv, `${L}${rr}`, v, { font: TH, border: ALL_THIN, nf: ACC, ...o });
    c("A", b, { nf: "@" }); c("B", row.name || "", { nf: undefined });
    c("C", { formula: `ROUND(SUMIF(Pivot!$A$4:$A$100000,$A${rr},Pivot!$C$4:$C$10000),2)`, result: inA });
    c("D", { formula: `ROUND(SUMIF(Pivot!$A$4:$A$100000,$A${rr},Pivot!$D$4:$D$10000),2)`, result: inV });
    if (hasSimple) {
      c("E", { formula: `ROUND(SUMIF('${simSheetName}'!$Q$15:$Q$100000,"*รวมสาขา*"&$A${rr}&"*",'${simSheetName}'!$W$15:$W$100000),2)`, result: exA });
      c("F", { formula: `ROUND(SUMIF('${simSheetName}'!$Q$15:$Q$100000,"*รวมสาขา*"&$A${rr}&"*",'${simSheetName}'!$Y$15:$Y$100000),2)`, result: exV });
    } else { c("E", null); c("F", null); }
    c("G", { formula: `$C${rr}+$E${rr}`, result: r2(inA + exA) });
    c("H", { formula: `$D${rr}+$F${rr}`, result: r2(inV + exV) });
    c("I", null); c("J", null);
    c("K", { formula: `$G${rr}+$I${rr}`, result: r2(inA + exA) });
    c("L", { formula: `$H${rr}+$J${rr}`, result: r2(inV + exV) });
    c("M", { formula: `ROUND(SUMIFS(TB!$H$10:$H$100000,TB!$D$10:$D$100000,"999999",TB!$A$10:$A$100000,$A${rr})+SUMIFS(TB!$H$10:$H$100000,TB!$B$10:$B$100000,"46250",TB!$A$10:$A$100000,$A${rr}),2)-SUMIFS(TB!$H$10:$H$100000,TB!$B$10:$B$100000,"46119",TB!$A$10:$A$100000,$A${rr})-SUMIFS(TB!$H$10:$H$100000,TB!$B$10:$B$100000,"46250",TB!$A$10:$A$100000,$A${rr})`, result: row.tb });
    c("N", { formula: `ROUND($L${rr}-$M${rr},2)`, result: row.diff });
    c("O", null, { nf: undefined, al: { horizontal: "left", vertical: "middle" } });
    c("P", row.branchStatus || "Active", { nf: undefined, al: { horizontal: "center", vertical: "middle" } });
    put(rv, `Q${rr}`, "A", { font: TH });
    rr++;
  });
  const rvLast = rr - 1, rvTot = rr;
  put(rv, `A${rvTot}`, "Total", { font: { ...TH, bold: true }, fill: TOT80, border: bd("thin", null, "thin", "thin"), al: { horizontal: "left" } });
  put(rv, `B${rvTot}`, null, { font: { ...TH, bold: true }, fill: TOT80, border: bd(null, "thin", "thin", "thin") });
  const tp = rep.totals.pairs;
  const totRes = { C: tp[0][0], D: tp[0][1], E: tp[1][0], F: tp[1][1], G: tp[2][0], H: tp[2][1], I: 0, J: 0, K: tp[4][0], L: tp[4][1], M: rep.totals.tb, N: rep.totals.diff };
  Object.keys(totRes).forEach((L) => put(rv, `${L}${rvTot}`, { formula: `SUBTOTAL(9,${L}$${rvFirst}:${L}${rvLast})`, result: totRes[L] }, { font: { ...TH, bold: true }, fill: TOT80, border: ALL_THIN, nf: ACC }));
  put(rv, `Q${rvTot}`, "A", { font: TH });
  const fb = rvTot + 2;
  put(rv, `A${fb}`, `ผู้จัดทำ : ${preparedBy}`, { font: TH });
  put(rv, `K${fb}`, "ผู้อนุมัติ..............................................ผู้จัดการฝ่ายบัญชี", { font: TH });
  put(rv, `A${fb + 1}`, thaiDateDots(exportDate), { font: TH });
  put(rv, `K${fb + 1}`, thaiDateDots(exportDate), { font: TH });
  put(rv, `A${fb + 3}`, "ผู้ตรวจสอบ  : ......................................", { font: TH });
  put(rv, `K${fb + 3}`, "ผู้รับ........................................เจ้าหน้าที่  TAX", { font: TH });
  put(rv, `A${fb + 4}`, thaiDateDots(exportDate), { font: TH });
  [9.5, 32.08, 18.08, 16.58, 16.58, 13.58, 18.08, 16.58, 9.08, 9.08, 18.08, 16.58, 16.58, 15.83, 27.25, 9.33].forEach((w, i) => { rv.getColumn(i + 1).width = w; });
  rv.getColumn(17).hidden = true;
  rv.getColumn(19).width = 18.08;
  rv.autoFilter = `Q8:Q${rvTot}`;
  rv.views = view({ state: "frozen", xSplit: 1, ySplit: 8, topLeftCell: "B9", zoomScale: 72 });
  rv.pageSetup = { paperSize: 9, scale: 70, orientation: "landscape", printArea: `A1:N${rvTot + 6}` };
  rv.addConditionalFormatting({ ref: `C9:N${rvTot}`, rules: [{ type: "cellIs", operator: "lessThan", formulae: [0], priority: 5, style: { font: { color: { argb: "FFFF5050" } } } }] });
  rv.addConditionalFormatting({ ref: `A9:P${rvLast}`, rules: [{ type: "expression", formulae: ['$P9="Closed"'], priority: 4, style: { font: { color: { argb: "FFFF0000" } }, fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFD9D9D9" } } } }] });
  rv.addConditionalFormatting({ ref: `P9:P${rvLast}`, rules: [
    { type: "expression", formulae: ['$P9="Active"'], priority: 3, style: { font: { color: { argb: NAVY } }, fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFCCFFCC" } } } },
    { type: "expression", formulae: ['$P9="Temp."'], priority: 2, style: { font: { color: { argb: NAVY } }, fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFFFCC" } } } },
    { type: "expression", formulae: ['$P9="Relocate"'], priority: 1, style: { font: { color: { argb: NAVY } }, fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFFFCC" } } } },
  ] });
  rv.addConditionalFormatting({ ref: "O6", rules: [
    { type: "containsText", operator: "containsText", text: "Approve Balance", priority: 7, style: { font: { color: { argb: "FF0070C0" } }, fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFCCFFCC" } } } },
    { type: "containsText", operator: "containsText", text: "Found Diff in Detail", priority: 6, style: { font: { color: { argb: NAVY } }, fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFF5050" } } } },
  ] });

  // ═════════════ Cover ═════════════
  const cv = cover;
  const CF = { name: "Calibri", size: 11 };
  put(cv, "I1", 100, { font: { name: "Tahoma", size: 11 } });
  put(cv, "AZ1", "APN", { font: { name: "Tahoma", size: 11 } });
  cv.mergeCells("B3:I3");
  put(cv, "B3", "DETAIL OF ACCOUNT", { font: { name: "Calibri", size: 12, bold: true, color: { argb: WHITE } }, fill: NAVY, al: { horizontal: "center" } });
  [["Company ", companyLine], ["Branch ", branchLine], ["Account code ", accountNum], ["Account name", rep.accountName || ""], ["Period", periodEnd]].forEach((x, i) => {
    put(cv, `B${5 + i}`, x[0], { font: { ...CF, bold: true } });
    put(cv, `C${5 + i}`, x[1], { font: CF, al: { horizontal: "left" }, nf: x[1] instanceof Date ? "d-mmm-yy" : undefined });
  });
  put(cv, "F5", "Nature :", { font: { ...CF, bold: true } });
  const th = (a, t, border, extra = {}) => put(cv, a, t, { font: { ...CF, bold: !!t, color: { argb: WHITE } }, fill: NAVY, border, al: { horizontal: "center" }, ...extra });
  th("C13", "By CPC", bdc(GREY_THIN, "thin", null, "thin", null), { al: { horizontal: "left" } }); th("D13", null, bdc(GREY_THIN, null, null, "thin", null));
  const h3 = bdc(GREY_THIN, "thin", "thin", "thin", null);
  th("E13", "Per TB", h3); th("F13", "Per Detail", h3); th("G13", "Diff", h3); th("H13", "Remark", h3, { al: { horizontal: "left" } });
  for (let r = 14; r <= 22; r++) {
    put(cv, `C${r}`, null, { font: CF, border: bdc(GREY_THIN, "thin", null, null, null), nf: ACC });
    put(cv, `D${r}`, null, { font: CF, nf: ACC });
    ["E", "F", "G", "H"].forEach((L) => put(cv, `${L}${r}`, null, { font: CF, border: bdc(GREY_THIN, "thin", "thin", null, null), nf: ACC }));
  }
  put(cv, "C16", `Detail ${account}`, { font: CF });
  const perTb = rep.cover.perTb, perDetail = rep.cover.perDetail;
  put(cv, "E16", { formula: 'ROUND(SUMIF(TB!$A$10:$A$100000,"*Total*",TB!$H$10:$H$100000),2)', result: perTb }, { font: CF, border: bdc(GREY_THIN, "thin", "thin", null, null), nf: ACC });
  put(cv, "F16", { formula: 'ROUND(SUMIF(ReportVat_VGR!$A$10:$A$100000,"*Total*",ReportVat_VGR!$L$10:$L$100000),2)', result: perDetail }, { font: CF, border: bdc(GREY_THIN, "thin", "thin", null, null), nf: ACC });
  put(cv, "G16", { formula: 'IFERROR($E16-$F16,"")', result: r2(perTb - perDetail) }, { font: CF, border: bdc(GREY_THIN, "thin", "thin", null, null), nf: ACC });
  put(cv, "I16", "Detail", { font: { name: "Tahoma", size: 11 } });
  put(cv, "C18", "Detail of FinCredit 46250", { font: CF, border: bdc(GREY_THIN, "thin", null, null, null), nf: ACC });
  put(cv, "G18", { formula: '-ROUND(SUMIF(TB!$B$10:$B$1000,"46250",TB!$H$10:$H$1000),2)', result: rep.cover.finCredit == null ? 0 : rep.cover.finCredit }, { font: CF, border: bdc(GREY_THIN, "thin", "thin", null, null), nf: ACC });
  put(cv, "C23", "Diff", { font: { ...CF, bold: true }, fill: TOT40, border: { left: { style: "thin", color: { argb: GREY_THIN } }, top: { style: "thin" }, bottom: { style: "medium" } }, nf: ACC });
  put(cv, "D23", null, { fill: TOT40, border: bd(null, null, "thin", "medium") });
  const e23 = r2(perTb), f23 = r2(perDetail), g23 = r2(perTb - perDetail + (rep.cover.finCredit || 0));
  [["E", "SUM(E14:E22)", e23], ["F", "SUM(F14:F22)", f23], ["G", "SUM(G14:G22)", g23], ["H", null, null]].forEach(([L, f, res]) =>
    put(cv, `${L}23`, f ? { formula: f, result: res } : null, { font: { ...CF, bold: true }, fill: TOT40, border: { left: { style: "thin", color: { argb: GREY_THIN } }, right: { style: "thin", color: { argb: GREY_THIN } }, top: { style: "thin" }, bottom: { style: "medium" } }, nf: ACC }));
  for (let c = 2; c <= 9; c++) put(cv, `${colL(c)}26`, null, { fill: NAVY });
  put(cv, "B28", "APN", { font: { name: "Tahoma", size: 11 } });
  put(cv, "B30", "Prepare by :", { font: { name: "Times New Roman", size: 11, bold: true } });
  put(cv, "C30", preparedBy, { font: { name: "Times New Roman", size: 11 }, fill: TOT80, border: bd(null, null, null, "thin"), al: { horizontal: "left" } });
  put(cv, "F30", "Review by :", { font: { name: "Times New Roman", size: 11, bold: true } });
  ["G", "H"].forEach((L) => put(cv, `${L}30`, null, { fill: TOT80, border: bd(null, null, null, "thin") }));
  put(cv, "C31", "AP Controller", { font: { name: "Times New Roman", size: 11 } });
  put(cv, "J31", "(ระบุชื่อ - นามสกุล)", { font: { name: "Tahoma", size: 11 } });
  put(cv, "J32", "(ระบุตำแหน่ง)", { font: { name: "Tahoma", size: 11 } });
  put(cv, "B33", "Date :", { font: { name: "Times New Roman", size: 11, bold: true } });
  put(cv, "F33", "Date :", { font: { name: "Times New Roman", size: 11, bold: true } });
  ["C", "G", "H"].forEach((L) => { cv.getCell(`${L}33`).border = bd(null, null, "thin", null); });
  // กรอบ Medium: กล่อง 1 = แถว 3-10, กล่อง 2 = 12-25, กล่อง 3 = 29-34 (ซ้าย=B ขวา=I) -- ทำหลังสุดเพื่อรวมกับเส้นเดิมของแต่ละ Cell
  const box = (top, bottom, color) => {
    const m = color ? { style: "medium", color: { argb: color } } : { style: "medium" };
    for (let r = top; r <= bottom; r++) for (let c = 2; c <= 9; c++) {
      const cell = cv.getCell(r, c);
      const b = { ...(cell.border || {}) };
      if (c === 2) b.left = m;
      if (c === 9) b.right = m;
      if (r === top) b.top = m;
      if (r === bottom) b.bottom = m;
      cell.border = b;
    }
  };
  box(3, 10, GREY_BOX); box(12, 25, GREY_BOX); box(29, 34, null);
  [null, 15.58, 29.83, 12.33, 14.58, 14.58, 13.75].forEach((w, i) => { if (w) cv.getColumn(i + 1).width = w; });
  cv.views = view({ tabSelected: true });
  cv.addConditionalFormatting({ ref: "E16:G16", rules: [{ type: "cellIs", operator: "lessThan", formulae: [0], priority: 3, style: { font: { color: { argb: "FFFF0000" } } } }] });
  cv.addConditionalFormatting({ ref: "E23:G23", rules: [{ type: "cellIs", operator: "lessThan", formulae: [0], priority: 2, style: { font: { color: { argb: "FFFF0000" } } } }] });
  cv.addConditionalFormatting({ ref: "E18:G18", rules: [{ type: "cellIs", operator: "lessThan", formulae: [0], priority: 1, style: { font: { color: { argb: "FFFF0000" } } } }] });

  return wb;
}

// MARKER_VATRECONCILE_PCT_WORKBOOK_V2
/**
 * Template "หัว %" (เช่น CFW 11610755) -- Layout และสูตรตามไฟล์จริง 0402_CFW_11610755_SEP-26.xlsx
 * ชีต: Cover · ReportVat_AVG · A-Detail · IP-DETAIL · TB · Pivot · Simple AVG · (Simple 100 ถ้ามี)
 * ReportVat_AVG: C = ROUND(D×100/7) | D = Σ มูลค่าชำระที่ภาษีชำระ=0 | E/F = ใช้สิทธิ์ทั้งหมด − ที่ Calculate Tax=0 | G/H = Simple AVG | I/J = C+E+G | M/N = I+K | O = TB | P = N−O
 */
export function buildPctWorkbook(rep, bu, period, opts = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = opts.preparedBy || "FASTAPN Link3ase";
  wb.created = new Date();
  wb.calcProperties = { fullCalcOnLoad: true };

  const src = rep.sources || { detail: [], tb: [], simple: [] };
  const account = String(rep.account);
  const accountNum = /^\d+$/.test(account) ? Number(account) : account;
  const numericBu = (rep.buCode && rep.buCode.numeric) || "";
  const companyEn = rep.header.companyEn || rep.header.company || "";
  const branches = rep.rows.map((r) => String(r.branch));
  const bMin = branches[0] || "", bMax = branches[branches.length - 1] || "";
  const [py, pm] = String(period).split("-").map(Number);
  const periodEnd = new Date(Date.UTC(py, pm, 0));
  const exportDate = opts.exportDate || new Date();
  const preparedBy = opts.preparedBy || "";
  const companyLine = `${numericBu ? numericBu + " " : ""}${companyEn}`.trim();
  const branchLine = `${bMin}-${bMax} ${companyEn}`.trim();
  const nameBy = new Map(rep.rows.map((r) => [String(r.branch), r.name || ""]));
  const simAvgRows = (src.simple || []).filter((d) => String(d.simple_type) === "AVG");
  const sim100Rows = (src.simple || []).filter((d) => String(d.simple_type) !== "AVG");
  const hasAvg = simAvgRows.length > 0, has100 = sim100Rows.length > 0;
  const pctTxt = rep.ratePercent != null ? `${rep.ratePercent}%` : "ตาม % สาขา";
  // รายการที่ใช้สิทธิ์ 100% (Calculate Tax = 0 แต่มีภาษีชำระ) -- ต้องไปอยู่ช่อง Input-N 100% (ไม่งั้นหายจากยอดรวม)
  const has100Rows = (src.detail || []).some((d) => Math.abs(Number(d.calculate_tax) || 0) < 0.005 && (Number(d.paid_vat) || 0) !== 0);

  const view = (o) => [{ showGridLines: false, ...o }];
  const header7 = (ws) => {
    put(ws, "A1", "DETAIL OF ACCOUNT", { font: { name: "Calibri", size: 11 } });
    [["Company ", companyLine], ["Branch ", branchLine], ["Account code ", accountNum], ["Account name", rep.accountName || ""], ["Period", periodEnd]].forEach((x, i) => {
      put(ws, `A${3 + i}`, x[0], { font: { name: "Calibri", size: 11 } });
      put(ws, `B${3 + i}`, x[1], { font: { name: "Calibri", size: 11 }, al: { horizontal: "left" }, nf: x[1] instanceof Date ? "d-mmm-yy" : undefined });
    });
  };

  const cover = wb.addWorksheet("Cover");
  const rv = wb.addWorksheet("ReportVat_AVG");
  const dt = wb.addWorksheet("A-Detail");
  const ip = wb.addWorksheet("IP-DETAIL");
  const tb = wb.addWorksheet("TB");
  const pv = wb.addWorksheet("Pivot");

  // ═════════════ TB ═════════════
  header7(tb);
  ["Branch", "CPC", "Account", "SubAcc", "Description", "Beginnging Balance", "Period Activity", "Ending Balance"].forEach((h, i) =>
    put(tb, `${colL(i + 1)}9`, h, { font: { name: "Calibri", size: 11, color: { argb: WHITE } }, fill: NAVY, border: ALL_THIN, al: { horizontal: "center", vertical: "middle" } }));
  const tbRows = [...(src.tb || [])].sort((a, b) => String(a.branch).localeCompare(String(b.branch)) || String(a.cpc).localeCompare(String(b.cpc)) || String(a.subacc).localeCompare(String(b.subacc)));
  let tr = 10;
  tbRows.forEach((t) => {
    [String(t.branch), String(t.cpc ?? ""), String(t.account ?? account), String(t.subacc ?? ""), t.description || "", Number(t.beginning_balance) || 0, Number(t.period_activity) || 0, Number(t.ending_balance) || 0]
      .forEach((v, i) => put(tb, `${colL(i + 1)}${tr}`, v, { font: { name: "Tahoma", size: 11 }, border: ALL_THIN, nf: i === 0 ? "@" : i >= 5 ? ACC : undefined }));
    tr++;
  });
  const tbLast = Math.max(tr - 1, 10);
  put(tb, `A${tr}`, "Total", { font: { name: "Tahoma", size: 11, bold: true }, fill: TOT80, border: bd("thin", null, "thin", "thin") });
  for (let c = 2; c <= 8; c++) put(tb, `${colL(c)}${tr}`, null, { font: { name: "Tahoma", size: 11, bold: true }, fill: TOT80, border: bd(null, c === 8 ? "thin" : null, "thin", "thin") });
  [["F", "beginning_balance"], ["G", "period_activity"], ["H", "ending_balance"]].forEach(([L, k]) =>
    put(tb, `${L}${tr}`, { formula: `SUM(${L}$10:${L}${tbLast})`, result: r2(tbRows.reduce((s, t) => s + (Number(t[k]) || 0), 0)) }, { font: { name: "Tahoma", size: 11, bold: true }, fill: TOT80, border: ALL_THIN, nf: ACC }));
  [13.58, 9.83, 11.25, 10.25, 21.58, 17.08, 14.83, 15.25].forEach((w, i) => { tb.getColumn(i + 1).width = w; });
  tb.views = view({ state: "frozen", ySplit: 9, topLeftCell: "A10", zoomScale: 90 });

  // ═════════════ A-Detail / IP-DETAIL (Layout A–P ตามไฟล์ SEP-26) ═════════════
  const DH = ["สาขา", "ชื่อผู้ประกอบการ", "วันที่ (รับสินค้า)", "GRT_No. (รับสินค้า)", "วันที่ใบกำกับภาษี", "เลขที่ใบกำกับภาษี", "ชื่อผู้ค้า", "TAX ID", "HO", "BRANCH", "รายการ",
    "ภาษีซื้อที่ชำระ(มูลค่าสินค้า)", "ภาษีซื้อที่ชำระ(เงินภาษี)", `ภาษีซื้อที่ใช้สิทธิ์ ${pctTxt}  (มูลค่าสินค้า)`, `ภาษีซื้อที่ใช้สิทธิ์ ${pctTxt}  (เงินภาษี)`, "Calculate Tax"];
  const detHead = (ws, ipSheet) => {
    header7(ws);
    const hs = ipSheet ? [...DH.slice(0, 12), DH[12], "ภาษีซื้อที่ชำระ(มูลค่าสินค้า)", "ภาษีซื้อที่ใช้สิทธิ์ (เงินภาษี)", "Calculate Tax", "Parameter"] : DH;
    hs.forEach((h, i) => put(ws, `${colL(i + 1)}9`, h, { font: { name: "Calibri", size: 11, color: { argb: WHITE } }, fill: NAVY, border: bd("thin", "thin", "thin", null), al: { horizontal: "center", vertical: "middle", wrapText: true } }));
    ws.getRow(9).height = 26.5;
  };
  detHead(dt, false);
  detHead(ip, true);
  ip.views = view({ state: "frozen", xSplit: 1, ySplit: 9, topLeftCell: "B10", zoomScale: 85 });
  const detByBranch = new Map();
  (src.detail || []).forEach((d) => { const k = String(d.branch); if (!detByBranch.has(k)) detByBranch.set(k, []); detByBranch.get(k).push(d); });
  const detBranches = [...detByBranch.keys()].sort();
  const SUMK = ["paid_amount", "paid_vat", "claimed100_amount", "claimed100_vat"];
  const tot = (list, k) => r2(list.reduce((s, d) => s + (Number(d[k]) || 0), 0));
  const dataFont = { name: "Calibri", size: 12 };
  const dBorder = bd("thin", "thin", "thin", "hair");
  const totFont = { name: "Calibri", size: 13, bold: true };
  const totRow = (rowNo, label, first, last, list) => {
    put(dt, `A${rowNo}`, label, { font: totFont, fill: TOT60, border: bd("thin", null, "thin", "thin") });
    for (let c = 2; c <= 16; c++) put(dt, `${colL(c)}${rowNo}`, null, { font: totFont, fill: TOT60, border: bd(null, c === 16 ? "thin" : null, "thin", "thin") });
    ["L", "M", "N", "O"].forEach((L, i) => put(dt, `${L}${rowNo}`, { formula: `SUBTOTAL(9,${L}${first}:${L}${last})`, result: tot(list, SUMK[i]) }, { font: totFont, fill: TOT60, border: ALL_THIN, nf: ACC }));
  };
  // MARKER_VATRECONCILE_PCT_IP_DETAIL_V1 -- IP-DETAIL = Input N 100% ที่แท้จริงของ BU หัว % (ใช้สิทธิ์ 100% เต็ม Calculate Tax = 0) จัดกลุ่มรายสาขา + Total ตามรูปแบบ A-Detail
  {
    const ipList = (src.ip || []);
    const ipBy = new Map();
    ipList.forEach((d) => { const k = String(d.branch); if (!ipBy.has(k)) ipBy.set(k, []); ipBy.get(k).push(d); });
    let ir = 10;
    const ipTot = (rowNo, label, first, last, list) => {
      put(ip, `A${rowNo}`, label, { font: totFont, fill: TOT60, border: bd("thin", null, "thin", "thin") });
      for (let c = 2; c <= 17; c++) put(ip, `${colL(c)}${rowNo}`, null, { font: totFont, fill: TOT60, border: bd(null, c === 17 ? "thin" : null, "thin", "thin") });
      ["L", "M", "N", "O"].forEach((L, i) => put(ip, `${L}${rowNo}`, { formula: `SUBTOTAL(9,${L}${first}:${L}${last})`, result: tot(list, SUMK[i]) }, { font: totFont, fill: TOT60, border: ALL_THIN, nf: ACC }));
    };
    [...ipBy.keys()].sort().forEach((b) => {
      const list = ipBy.get(b); const first = ir;
      list.forEach((d) => {
        const vals = [b, d.operator_name || nameBy.get(b) || "", toDate(d.receive_date), d.grt_no ?? "", toDate(d.tax_invoice_date), d.tax_invoice_no ?? "", d.vendor_name ?? "", d.tax_id ?? "", d.ho ?? "", d.branch_field ?? "", d.item_detail ?? "",
          Number(d.paid_amount) || 0, Number(d.paid_vat) || 0, Number(d.paid_amount) || 0, Number(d.paid_vat) || 0, 0];
        vals.forEach((v, i) => put(ip, `${colL(i + 1)}${ir}`, v === "" ? null : v, { font: dataFont, border: dBorder, nf: i === 2 || i === 4 ? DATEF : i >= 11 ? ACC : undefined }));
        ip.getRow(ir).height = 15.5; ir++;
      });
      ipTot(ir, `${b} Total`, first, ir - 1, list); ir++;
    });
    if (ipList.length) ipTot(ir, "Grand Total", 10, ir - 1, ipList);
  }
  const opName = (b) => ((detByBranch.get(b) || []).find((d) => d.operator_name) || {}).operator_name || nameBy.get(b) || "";
  let dr = 10;
  detBranches.forEach((b) => {
    const list = detByBranch.get(b);
    const first = dr;
    list.forEach((d) => {
      const vals = [b, d.operator_name || nameBy.get(b) || "", toDate(d.receive_date), d.grt_no ?? "", toDate(d.tax_invoice_date), d.tax_invoice_no ?? "", d.vendor_name ?? "", d.tax_id ?? "", d.ho ?? "", d.branch_field ?? "", d.item_detail ?? "",
        Number(d.paid_amount) || 0, Number(d.paid_vat) || 0, Number(d.claimed100_amount) || 0, Number(d.claimed100_vat) || 0, Number(d.calculate_tax) || 0];
      vals.forEach((v, i) => put(dt, `${colL(i + 1)}${dr}`, v === "" ? null : v, { font: dataFont, border: dBorder, nf: i === 2 || i === 4 ? DATEF : i >= 11 ? ACC : undefined }));
      const row = dt.getRow(dr); row.height = 15.5; row.outlineLevel = 2;
      dr++;
    });
    totRow(dr, `${b} Total`, first, dr - 1, list);
    dt.getRow(dr).outlineLevel = 1;
    dr++;
  });
  totRow(dr, "Grand Total", 10, dr - 1, src.detail || []);
  const dEnd = dr;
  [13.58, 30.25, 14.33, 16.58, 14.33, 14.58, 26.33, 14.58, 7.33, 7.33, 35.83, 16.63, 14.63, 15.88, 14.38, 14.38].forEach((w, i) => { dt.getColumn(i + 1).width = w; ip.getColumn(i + 1).width = w; });
  dt.properties.outlineLevelRow = 2;
  dt.views = view({ state: "frozen", xSplit: 1, ySplit: 9, topLeftCell: "B10", zoomScale: 85 });
  dt.addConditionalFormatting({ ref: `L10:P${dEnd}`, rules: [{ type: "cellIs", operator: "lessThan", formulae: [0], priority: 1, style: { font: { color: { argb: "FFFF5050" } } } }] });

  // ═════════════ Pivot ═════════════
  put(pv, "C2", "Data", { font: { name: "Tahoma", size: 11 } });
  ["สาขา", "ชื่อผู้ประกอบการ", "Sum of ภาษีซื้อที่ชำระ(มูลค่าสินค้า)", "Sum of ภาษีซื้อที่ชำระ(เงินภาษี)", `Sum of ภาษีซื้อที่ใช้สิทธิ์ ${pctTxt}  (มูลค่าสินค้า)`, `Sum of ภาษีซื้อที่ใช้สิทธิ์ ${pctTxt}  (เงินภาษี)`, "Count of สาขา"]
    .forEach((h, i) => put(pv, `${colL(i + 1)}3`, h, { font: { name: "Tahoma", size: 11, color: { argb: NAVY } }, fill: i < 2 ? "FFF2F2F2" : "FFCCFFCC", border: ALL_THIN, al: { horizontal: "center", vertical: "middle", wrapText: true } }));
  pv.getRow(3).height = 42;
  let pr = 4;
  (detBranches.length ? detBranches : branches).forEach((b) => {
    const list = detByBranch.get(b) || [];
    const cell = (L, f, res, nf, extra = {}) => put(pv, `${L}${pr}`, f == null ? res : { formula: f, result: res }, { font: { name: "Calibri", size: 12 }, border: ALL_THIN, nf, ...extra });
    cell("A", null, b); cell("B", null, opName(b));
    [["C", "L", "paid_amount"], ["D", "M", "paid_vat"], ["E", "N", "claimed100_amount"], ["F", "O", "claimed100_vat"]].forEach(([L, S, k]) =>
      cell(L, `ROUND(SUMIF('A-Detail'!$A$10:$A$100017,$A${pr},'A-Detail'!$${S}$10:$${S}$100017),2)`, tot(list, k), NUM2));
    cell("G", `COUNTIF('A-Detail'!$A$10:$A$100017,$A${pr})`, list.length, undefined, { al: { horizontal: "center", vertical: "middle" } });
    pr++;
  });
  put(pv, `A${pr}`, "Grand Total", { font: { name: "Tahoma", size: 11 } });
  [["C", "paid_amount"], ["D", "paid_vat"], ["E", "claimed100_amount"], ["F", "claimed100_vat"]].forEach(([L, k]) =>
    put(pv, `${L}${pr}`, { formula: `SUM(${L}$4:${L}${pr - 1})`, result: tot(src.detail || [], k) }, { font: { name: "Calibri", size: 12 }, fill: "FFFFCCFF", border: bd("thin", "thin", "double", "thin"), nf: NUM2 }));
  put(pv, `G${pr}`, { formula: `SUM(G$4:G${pr - 1})`, result: (src.detail || []).length }, { font: { name: "Calibri", size: 12 }, fill: "FFFFCCFF", border: bd("thin", "thin", "double", "thin"), al: { horizontal: "center" } });
  [11.83, 80.58, 18.58, 18.58, 18.58, 18.58, 13.75].forEach((w, i) => { pv.getColumn(i + 1).width = w; });
  pv.views = view({ state: "frozen", ySplit: 3, topLeftCell: "A4", zoomScale: 85 });

  // ═════════════ Simple AVG / Simple 100 ═════════════
  if (hasAvg) writeSimpleOriginalSheet(wb.addWorksheet("Simple AVG"), simpleRowsToGroups(simAvgRows, "AVG"), { buCode: bu, zoom: 70, useSub: true });
  if (has100) writeSimpleOriginalSheet(wb.addWorksheet("Simple 100"), simpleRowsToGroups(sim100Rows, "100"), { buCode: bu, zoom: 70 });

  // ═════════════ ReportVat_AVG ═════════════
  const F11 = { name: "Calibri", size: 11 };
  const TH = { name: "Tahoma", size: 11 };
  [rep.header.title, rep.header.company, rep.header.taxId ? `เลขประจำตัวผู้เสียภาษี     ${rep.header.taxId}` : "", `ประจำเดือน ${rep.header.periodLabel}`].forEach((t, i) => {
    if (t) put(rv, `A${i + 1}`, t, { font: F11 });
    for (let c = 1; c <= 16; c++) rv.getCell(i + 1, c).alignment = { horizontal: "centerContinuous" };
  });
  put(rv, "A6", accountNum, { font: F11 });
  rv.getRow(7).height = 30;
  const hd = { font: { name: "Calibri", size: 11, color: { argb: WHITE } }, fill: NAVY, border: ALL_THIN, al: { horizontal: "center", vertical: "middle" } };
  const hd2 = { ...hd, border: bd("thin", "thin", "thin", null) };
  rv.mergeCells("A7:A8"); put(rv, "A7", "รหัสสาขา", hd);
  rv.mergeCells("B7:B8"); put(rv, "B7", "สาขา", hd);
  [["C", "D", rep.pairLabels[0]], ["E", "F", rep.pairLabels[1]], ["G", "H", rep.pairLabels[2]], ["I", "J", rep.pairLabels[3]], ["K", "L", rep.pairLabels[4]], ["M", "N", rep.pairLabels[5]]].forEach(([L, L2, t]) => {
    rv.mergeCells(`${L}7:${L2}7`); put(rv, `${L}7`, t, hd); put(rv, `${L2}7`, null, hd);
  });
  put(rv, "O7", "ภาษีตาม T/B ", hd);
  rv.mergeCells("P7:P8"); put(rv, "P7", "ผลต่าง", hd);
  rv.mergeCells("Q7:Q8"); put(rv, "Q7", "Remark", { ...hd, border: undefined });
  rv.mergeCells("R7:R8"); put(rv, "R7", "Status", { ...hd, border: undefined });
  for (let c = 3; c <= 14; c++) put(rv, `${colL(c)}8`, c % 2 === 1 ? "มูลค่า" : "ภาษี", hd2);
  put(rv, "O8", rep.tbLabel, hd2);

  const sA = (L, r) => `'Simple AVG'!$Q$15:$Q$10000,"*"&"รวมสาขา"&"*"&$A${r}&"*",'Simple AVG'!$${L}$15:$${L}$10000`;
  const s1 = (L, r) => `'Simple 100'!$Q$15:$Q$10000,"*"&"รวมสาขา"&"*"&$A${r}&"*",'Simple 100'!$${L}$15:$${L}$10000`;
  const rvFirst = 9;
  let rr = rvFirst;
  rep.rows.forEach((row) => {
    const p = row.pairs;
    const c = (L, v, o = {}) => put(rv, `${L}${rr}`, v, { font: TH, border: ALL_THIN, nf: ACC, ...o });
    c("A", String(row.branch), { nf: "@" }); c("B", row.name || "", { nf: undefined });
    const zeroL = `ROUND(SUMIFS('A-Detail'!$L$10:$L$100016,'A-Detail'!$M$10:$M$100016,0,'A-Detail'!$A$10:$A$100016,$A${rr}),2)`;
    const p0 = (S) => `ROUND(SUMIFS('A-Detail'!$${S}$10:$${S}$100016,'A-Detail'!$P$10:$P$100016,0,'A-Detail'!$M$10:$M$100016,"<>0",'A-Detail'!$A$10:$A$100016,$A${rr}),2)`;
    const all = (S) => `ROUND(SUMIF('A-Detail'!$A$10:$A$100017,$A${rr},'A-Detail'!$${S}$10:$${S}$100017),2)`;
    const zk = (S) => `ROUND(SUMIFS('A-Detail'!$${S}$10:$${S}$100017,'A-Detail'!$P$10:$P$100017,0,'A-Detail'!$A$10:$A$100017,$A${rr}),2)`;
    // C/D ตามไฟล์ SEP-26 (D = Σ มูลค่าชำระที่ภาษีชำระ=0, C = D×100/7) + รายการ 100% (Calculate Tax=0) + Simple 100 เมื่อมีข้อมูล
    c("D", { formula: zeroL + (has100Rows ? `+${p0("O")}` : "") + (has100 ? `+ROUND(SUMIF(${s1("Y", rr)}),2)` : ""), result: p[0][1] });
    c("C", { formula: (has100Rows || has100 ? `ROUND(${zeroL}*100/7,2)` : `ROUND($D${rr}*100/7,2)`) + (has100Rows ? `+${p0("N")}` : "") + (has100 ? `+ROUND(SUMIF(${s1("W", rr)}),2)` : ""), result: p[0][0] });
    c("E", { formula: `${all("N")}-${zk("N")}`, result: p[1][0] });
    c("F", { formula: `${all("O")}-${zk("O")}`, result: p[1][1] });
    if (hasAvg) { c("G", { formula: `ROUND(SUMIF(${sA("W", rr)}),2)`, result: p[2][0] }); c("H", { formula: `ROUND(SUMIF(${sA("Y", rr)}),2)`, result: p[2][1] }); }
    else { c("G", null); c("H", null); }
    c("I", { formula: `ROUND($C${rr}+$E${rr}+$G${rr},2)`, result: p[3][0] });
    c("J", { formula: `ROUND($D${rr}+$F${rr}+$H${rr},2)`, result: p[3][1] });
    c("K", null); c("L", null);
    c("M", { formula: `ROUND($I${rr}+$K${rr},2)`, result: p[5][0] });
    c("N", { formula: `ROUND($J${rr}+$L${rr},2)`, result: p[5][1] });
    c("O", { formula: `ROUND(SUMIF(TB!$A$10:$A$100000,$A${rr},TB!$H$10:$H$100000),2)`, result: row.tb });
    c("P", { formula: `ROUND($N${rr}-$O${rr},2)`, result: row.diff });
    c("Q", null, { nf: undefined, al: { horizontal: "left", vertical: "middle" } });
    c("R", row.branchStatus || "Active", { nf: undefined, al: { horizontal: "center", vertical: "middle" } });
    put(rv, `S${rr}`, { formula: `IF($N${rr}="",IF($O${rr}<>0,"A",""),IF($N${rr}=0,IF($O${rr}<>0,"A",""),"A"))`, result: "A" }, { font: TH });
    rr++;
  });
  const rvLast = rr - 1, rvTot = rr;
  put(rv, `A${rvTot}`, "Total", { font: { ...TH, bold: true }, fill: TOT80, border: bd("thin", null, "thin", "thin") });
  put(rv, `B${rvTot}`, null, { font: { ...TH, bold: true }, fill: TOT80, border: bd(null, "thin", "thin", "thin") });
  const tp = rep.totals.pairs;
  const totRes = { C: tp[0][0], D: tp[0][1], E: tp[1][0], F: tp[1][1], G: tp[2][0], H: tp[2][1], I: tp[3][0], J: tp[3][1], K: 0, L: 0, M: tp[5][0], N: tp[5][1], O: rep.totals.tb, P: rep.totals.diff };
  Object.keys(totRes).forEach((L) => put(rv, `${L}${rvTot}`, { formula: `SUM(${L}$${rvFirst}:${L}${rvLast})`, result: totRes[L] }, { font: { ...TH, bold: true }, fill: TOT80, border: ALL_THIN, nf: ACC }));
  put(rv, `S${rvTot}`, { formula: `IF($N${rvTot}="",IF($O${rvTot}<>0,"A",""),IF($N${rvTot}=0,IF($O${rvTot}<>0,"A",""),"A"))`, result: "A" }, { font: TH });
  const fb = rvTot + 2;
  put(rv, `A${fb}`, `ผู้จัดทำ : ${preparedBy}`, { font: TH });
  put(rv, `K${fb}`, "ผู้อนุมัติ..............................................ผู้จัดการฝ่ายบัญชี", { font: TH });
  put(rv, `A${fb + 1}`, thaiDateDots(exportDate), { font: TH });
  put(rv, `K${fb + 1}`, thaiDateDots(exportDate), { font: TH });
  put(rv, `A${fb + 3}`, "ผู้ตรวจสอบ  : ......................................", { font: TH });
  put(rv, `K${fb + 3}`, "ผู้รับ........................................เจ้าหน้าที่  TAX", { font: TH });
  put(rv, `A${fb + 4}`, thaiDateDots(exportDate), { font: TH });
  [9.5, 32.08, 18.08, 16.58, 16.58, 14.58, 16.58, 14.58, 16.03, 14.58, 10.58, 14.58, 16.58, 16.03, 15.08, 15.0, 27.25, 13.58].forEach((w, i) => { rv.getColumn(i + 1).width = w; });
  rv.getColumn(19).hidden = true;
  rv.autoFilter = `S8:S${rvTot}`;
  rv.views = view({ state: "frozen", xSplit: 1, ySplit: 8, topLeftCell: "E9", zoomScale: 72 });
  rv.pageSetup = { paperSize: 9, scale: 70, orientation: "landscape", printArea: `A1:P${rvTot + 6}` };
  rv.addConditionalFormatting({ ref: `C9:P${rvTot}`, rules: [{ type: "cellIs", operator: "lessThan", formulae: [0], priority: 5, style: { font: { color: { argb: "FFFF5050" } } } }] });
  rv.addConditionalFormatting({ ref: `A9:R${rvLast}`, rules: [{ type: "expression", formulae: ['$R9="Closed"'], priority: 4, style: { font: { color: { argb: "FFFF0000" } }, fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFD9D9D9" } } } }] });
  rv.addConditionalFormatting({ ref: `R9:R${rvLast}`, rules: [
    { type: "expression", formulae: ['$R9="Active"'], priority: 3, style: { font: { color: { argb: NAVY } }, fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFCCFFCC" } } } },
    { type: "expression", formulae: ['$R9="Temp."'], priority: 2, style: { font: { color: { argb: NAVY } }, fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFFFCC" } } } },
    { type: "expression", formulae: ['$R9="Relocate"'], priority: 1, style: { font: { color: { argb: NAVY } }, fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFFFCC" } } } },
  ] });

  // ═════════════ Cover ═════════════
  const cv = cover;
  const CF = { name: "Calibri", size: 11 };
  put(cv, "I1", 100, { font: { name: "Tahoma", size: 11 } });
  put(cv, "AZ1", "APN", { font: { name: "Tahoma", size: 11 } });
  cv.mergeCells("B3:I3");
  put(cv, "B3", "DETAIL OF ACCOUNT", { font: { name: "Calibri", size: 12, bold: true, color: { argb: WHITE } }, fill: NAVY, al: { horizontal: "center" } });
  [["Company ", companyLine], ["Branch ", branchLine], ["Account code ", accountNum], ["Account name", rep.accountName || ""], ["Period", periodEnd]].forEach((x, i) => {
    put(cv, `B${5 + i}`, x[0], { font: { ...CF, bold: true } });
    put(cv, `C${5 + i}`, x[1], { font: CF, al: { horizontal: "left" }, nf: x[1] instanceof Date ? "d-mmm-yy" : undefined });
  });
  put(cv, "F5", "Nature :", { font: { ...CF, bold: true } });
  const th = (a, t, border, extra = {}) => put(cv, a, t, { font: { ...CF, bold: !!t, color: { argb: WHITE } }, fill: NAVY, border, al: { horizontal: "center" }, ...extra });
  th("C13", "By CPC", bdc(GREY_THIN, "thin", null, "thin", null), { al: { horizontal: "left" } }); th("D13", null, bdc(GREY_THIN, null, null, "thin", null));
  const h3 = bdc(GREY_THIN, "thin", "thin", "thin", null);
  th("E13", "Per TB", h3); th("F13", "Per Detail", h3); th("G13", "Diff", h3); th("H13", "Remark", h3, { al: { horizontal: "left" } });
  for (let r = 14; r <= 22; r++) {
    put(cv, `C${r}`, null, { font: CF, border: bdc(GREY_THIN, "thin", null, null, null), nf: ACC });
    put(cv, `D${r}`, null, { font: CF, nf: ACC });
    ["E", "F", "G", "H"].forEach((L) => put(cv, `${L}${r}`, null, { font: CF, border: bdc(GREY_THIN, "thin", "thin", null, null), nf: ACC }));
  }
  put(cv, "C16", `Detail ${account}`, { font: CF });
  const perTb = rep.cover.perTb, perDetail = rep.cover.perDetail;
  put(cv, "E16", { formula: 'ROUND(SUMIF(TB!$A$10:$A$100000,"*Total*",TB!$H$10:$H$100000),2)', result: perTb }, { font: CF, border: bdc(GREY_THIN, "thin", "thin", null, null), nf: ACC });
  put(cv, "F16", { formula: 'ROUND(SUMIF(ReportVat_AVG!$A$10:$A$100000,"*Total*",ReportVat_AVG!$N$10:$N$100000),2)', result: perDetail }, { font: CF, border: bdc(GREY_THIN, "thin", "thin", null, null), nf: ACC });
  put(cv, "G16", { formula: 'IFERROR($E16-$F16,"")', result: r2(perTb - perDetail) }, { font: CF, border: bdc(GREY_THIN, "thin", "thin", null, null), nf: ACC });
  put(cv, "I16", "Detail", { font: { name: "Tahoma", size: 11 } });
  put(cv, "C18", "Detail of FinCredit 46250", { font: CF, border: bdc(GREY_THIN, "thin", null, null, null), nf: ACC });
  put(cv, "G18", { formula: '-ROUND(SUMIF(TB!$B$10:$B$1000,"46250",TB!$H$10:$H$1000),2)', result: rep.cover.finCredit == null ? 0 : rep.cover.finCredit }, { font: CF, border: bdc(GREY_THIN, "thin", "thin", null, null), nf: ACC });
  put(cv, "C23", "Diff", { font: { ...CF, bold: true }, fill: TOT40, border: { left: { style: "thin", color: { argb: GREY_THIN } }, top: { style: "thin" }, bottom: { style: "medium" } }, nf: ACC });
  put(cv, "D23", null, { fill: TOT40, border: bd(null, null, "thin", "medium") });
  const e23 = r2(perTb), f23 = r2(perDetail), g23 = r2(perTb - perDetail + (rep.cover.finCredit || 0));
  [["E", "SUM(E14:E22)", e23], ["F", "SUM(F14:F22)", f23], ["G", "SUM(G14:G22)", g23], ["H", null, null]].forEach(([L, f, res]) =>
    put(cv, `${L}23`, f ? { formula: f, result: res } : null, { font: { ...CF, bold: true }, fill: TOT40, border: { left: { style: "thin", color: { argb: GREY_THIN } }, right: { style: "thin", color: { argb: GREY_THIN } }, top: { style: "thin" }, bottom: { style: "medium" } }, nf: ACC }));
  for (let c = 2; c <= 9; c++) put(cv, `${colL(c)}26`, null, { fill: NAVY });
  put(cv, "B28", "APN", { font: { name: "Tahoma", size: 11 } });
  put(cv, "B30", "Prepare by :", { font: { name: "Times New Roman", size: 11, bold: true } });
  put(cv, "C30", preparedBy, { font: { name: "Times New Roman", size: 11 }, fill: TOT80, border: bd(null, null, null, "thin"), al: { horizontal: "left" } });
  put(cv, "F30", "Review by :", { font: { name: "Times New Roman", size: 11, bold: true } });
  ["G", "H"].forEach((L) => put(cv, `${L}30`, null, { fill: TOT80, border: bd(null, null, null, "thin") }));
  put(cv, "C31", "AP Controller", { font: { name: "Times New Roman", size: 11 } });
  put(cv, "J31", "(ระบุชื่อ - นามสกุล)", { font: { name: "Tahoma", size: 11 } });
  put(cv, "J32", "(ระบุตำแหน่ง)", { font: { name: "Tahoma", size: 11 } });
  put(cv, "B33", "Date :", { font: { name: "Times New Roman", size: 11, bold: true } });
  put(cv, "F33", "Date :", { font: { name: "Times New Roman", size: 11, bold: true } });
  ["C", "G", "H"].forEach((L) => { cv.getCell(`${L}33`).border = bd(null, null, "thin", null); });
  // กรอบ Medium: กล่อง 1 = แถว 3-10, กล่อง 2 = 12-25, กล่อง 3 = 29-34 (ซ้าย=B ขวา=I) -- ทำหลังสุดเพื่อรวมกับเส้นเดิมของแต่ละ Cell
  const box = (top, bottom, color) => {
    const m = color ? { style: "medium", color: { argb: color } } : { style: "medium" };
    for (let r = top; r <= bottom; r++) for (let c = 2; c <= 9; c++) {
      const cell = cv.getCell(r, c);
      const b = { ...(cell.border || {}) };
      if (c === 2) b.left = m;
      if (c === 9) b.right = m;
      if (r === top) b.top = m;
      if (r === bottom) b.bottom = m;
      cell.border = b;
    }
  };
  box(3, 10, GREY_BOX); box(12, 25, GREY_BOX); box(29, 34, null);
  [null, 15.58, 29.83, 12.33, 14.58, 14.58, 13.75].forEach((w, i) => { if (w) cv.getColumn(i + 1).width = w; });
  cv.views = view({ tabSelected: true });
  cv.addConditionalFormatting({ ref: "E16:G16", rules: [{ type: "cellIs", operator: "lessThan", formulae: [0], priority: 3, style: { font: { color: { argb: "FFFF0000" } } } }] });
  cv.addConditionalFormatting({ ref: "E23:G23", rules: [{ type: "cellIs", operator: "lessThan", formulae: [0], priority: 2, style: { font: { color: { argb: "FFFF0000" } } } }] });
  cv.addConditionalFormatting({ ref: "E18:G18", rules: [{ type: "cellIs", operator: "lessThan", formulae: [0], priority: 1, style: { font: { color: { argb: "FFFF0000" } } } }] });


  return wb;
}
