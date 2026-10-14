import ExcelJS from "exceljs";
import { TEMPLATE_DATA, TEMPLATE_NODATA } from "./apReconcileTemplates.js";

// MARKER_APRECONCILE_WORKBOOK_V1
/**
 * สร้างไฟล์ Reconcile รายบัญชีของ AP (21930052 / 54 / 84 / 85 / 100 / 220) ให้เหมือน Template จริง
 * ใช้ไฟล์ตัวอย่างเป็นแม่แบบหน้าตา (ฝังใน apReconcileTemplates.js): ชีต Cover · TB <Account> · Accounts Payable Trial Balance
 *  - ap_account_data.xlsx   = ไฟล์ที่มีข้อมูล (จากตัวอย่าง 0568_MPS_21930052_AUG-26.xlsx)
 *  - ap_account_nodata.xlsx = ไฟล์ No Data (จากตัวอย่าง 0568_MPS_21930084_AUG-26_No Data.xlsx)
 * ชื่อไฟล์ตาม Macro (Z_Movesheet_AccountPayable): <Com>_<BU(OMT->ODP)>_<Account>_<MMM-YY>[ No Data].xlsx
 */
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const clone = (o) => JSON.parse(JSON.stringify(o || {}));
// MARKER_APRECONCILE_NEG_RED_V1 -- ยอดติดลบเป็นสีแดง (แสดงในวงเล็บเหมือนเดิม)
const RED_NUM = "#,##0.00_);[Red](#,##0.00)";

// ชื่อ Account เต็ม (Cover) -- ตามไฟล์ตัวอย่าง; 21930100 / 21930220 รอชื่อเต็มจากผู้ใช้ (ตอนนี้ Fallback เป็นคำอธิบายจาก TB)
export const AP_ACCOUNT_NAMES = {
  "21930052": "Accounts Payable-Non Trade-Subsidiaries",
  "21930054": "Accounts Payable-Non Trade-Other Company",
  "21930084": "Return Cheque to be Reissued-Non Trade",
  "21930085": "Return Cheque to be Reissued-Non Trade_GL",
};

export const monYY = (d) => `${MON[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}`;
export const dMonYY = (d) => `${String(d.getUTCDate()).padStart(2, "0")}-${monYY(d)}`;
export const dMonYYYY = (d) => `${String(d.getUTCDate()).padStart(2, "0")}-${MON[d.getUTCMonth()]}-${d.getUTCFullYear()}`;

export function apReportFileName({ comCode, bu, account, asOfDate, hasData }) {
  const buPart = bu === "OMT" ? "ODP" : bu;
  return `${comCode}_${buPart}_${account}_${monYY(asOfDate)}${hasData ? "" : " No Data"}.xlsx`;
}

const supplierText = (code, name) => `${String(code || "").trim().padEnd(18, " ")}: ${String(name || "").trim()}`;

// ล้างแถวเก่าของ Template (ค่า + Style) ตั้งแต่แถว from ถึง to -- กันข้อมูลของ BU ตัวอย่างค้างเมื่อ BU ใหม่มีแถวน้อยกว่า
function clearRows(ws, from, to) {
  for (let r = from; r <= to; r++) {
    const row = ws.getRow(r);
    row.eachCell({ includeEmpty: true }, (c) => { c.value = null; c.style = {}; });
  }
}

// MARKER_APRECONCILE_NEG_RED_ALL_V1 -- ทุกช่องตัวเลขในทุกชีต: ยอดติดลบเป็นสีแดงเป็นค่าเริ่มต้น (ใส่ [Red] ในส่วนติดลบของ Format; ไม่แตะ Format วันที่/ข้อความ/General)
function redNegFmt(f) {
  if (!f || typeof f !== "string" || /\[Red\]/i.test(f) || !/[0#]/.test(f) || /[dmyhs]{2,}/i.test(f.replace(/"[^"]*"/g, "")) || f === "General" || f === "@") return f;
  const secs = f.split(";");
  if (secs.length === 1) return `${f};[Red]-${f}`;
  secs[1] = `[Red]${secs[1]}`;
  return secs.join(";");
}
function applyRedNegatives(wb) {
  for (const ws of wb.worksheets) {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (c) => {
        const f = c.numFmt;
        if (f) { const nf = redNegFmt(f); if (nf !== f) c.numFmt = nf; }
        // ใส่สีตัวอักษรแดงที่ตัว Cell ด้วย (ยอดติดลบ) เพื่อให้ Preview ที่อ่านเฉพาะสีตัวอักษรแสดงแดงเหมือน Excel โดยไม่ต้องแก้ Parser กลาง
        const v = c.value; const num = typeof v === "number" ? v : (v && typeof v === "object" && typeof v.result === "number" ? v.result : null);
        if (num !== null && num < 0) c.font = { ...(c.font || {}), color: { argb: "FFFF0000" } };
      });
    });
  }
}

function clearDefinedNames(wb) {
  try { wb.definedNames.model = []; } catch (e) { /* ไม่มีก็ข้าม */ }
}

function setHeaderLines(wsAp, o, hasData) {
  const pad = (s, n) => " ".repeat(n) + s;
  wsAp.getCell("A1").value = `${o.book} BOOK${" ".repeat(94)}Report Date: ${dMonYYYY(o.reportDate)}`;
  wsAp.getCell("A6").value = pad(`Reporting Context:  ${o.book} Operation Unit`, 14);
  wsAp.getCell("A8").value = pad(`As of Date:  ${dMonYY(o.asOfDate)}`, 21);
  if (hasData) {
    wsAp.getCell("A9").value = pad(`Branch From:   ${o.branchFrom}`, 19);
    wsAp.getCell("A10").value = pad(`Branch To:   ${o.branchTo}`, 21);
    wsAp.getCell("A12").value = pad(`Liability Account From:  ${o.liabFrom}`, 9);
    wsAp.getCell("A13").value = pad(`Liability Account To:  ${o.liabTo}`, 11);
  }
}

function coverValues(wsCv, o) {
  wsCv.getCell("C5").value = `${o.comCode} ${o.companyNameEn}`;
  wsCv.getCell("C6").value = `${o.branchFrom}-${o.branchTo} ${o.companyNameEn}`;
  wsCv.getCell("C7").value = Number(o.account);
  wsCv.getCell("C8").value = o.accountName;
  wsCv.getCell("C9").value = o.asOfDate;
  wsCv.getCell("C16").value = `Detail ${o.account}`;
  // Prepare by (C30) / Department (C31) จาก AP Setting ของ BU | ถ้า Setting ว่างคงค่าเดิมของ Template ไว้
  wsCv.getCell("C30").value = o.prepareBy || null;
  if (o.department) wsCv.getCell("C31").value = o.department;
}

// MARKER_APRECONCILE_CONFIRM_CLEAR_V1 -- หาคู่รายการที่น่าจะกลับรายการกัน (Branch + Cost Center + Account + SubAcc เดียวกัน, ยอดเท่ากันแต่ติดลบ/บวก)
// ไม่ลบ/ไม่ตัดออกเอง: แค่ Highlight ทั้งคู่ + ใส่ "Confirm Clear" ในช่อง Contact From..To ให้คนตรวจและตัดสินใจ | Description ใช้จัดอันดับว่าคู่ไหนน่าจะใช่ที่สุดเมื่อมีหลายตัวเลือก (ไม่บังคับต้องเหมือน)
const bigrams = (t) => { const x = String(t || "").toLowerCase().replace(/\s+/g, ""); const m = new Map(); for (let i = 0; i < x.length - 1; i++) { const g = x.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
const descSim = (a, b) => {
  const A = bigrams(a); const B = bigrams(b); let inter = 0; let na = 0; let nb = 0;
  for (const v of A.values()) na += v; for (const v of B.values()) nb += v;
  if (!na || !nb) return String(a || "").trim() === String(b || "").trim() ? 1 : 0;
  for (const [g, v] of A) inter += Math.min(v, B.get(g) || 0);
  return (2 * inter) / (na + nb);
};
function findReversalPairs(rows) {
  const flagged = new Set();
  const groups = new Map();
  rows.forEach((r, i) => {
    const cents = Math.round((Number(r.amount) || 0) * 100);
    if (!cents) return;
    const k = `${r.branch_code}|${r.cost_center}|${r.account_code}|${r.sub_account_code}`;
    if (!groups.has(k)) groups.set(k, { neg: [], pos: [] });
    (cents < 0 ? groups.get(k).neg : groups.get(k).pos).push({ i, cents: Math.abs(cents) });
  });
  for (const g of groups.values()) {
    const usedPos = new Set();
    for (const ng of g.neg) {
      let best = null; let bestSim = -1;
      for (const ps of g.pos) {
        if (usedPos.has(ps.i) || ps.cents !== ng.cents) continue;
        const sim = descSim(rows[ng.i].description, rows[ps.i].description);
        if (sim > bestSim) { bestSim = sim; best = ps; }
      }
      if (best) { usedPos.add(best.i); flagged.add(ng.i); flagged.add(best.i); }
    }
  }
  return flagged;
}

// MARKER_APRECONCILE_DETAIL_SHEET_V1 -- ชีต "Detail" = Detail of Overhead (JV Journal) ของ Account นี้ | จัดกลุ่มตาม Branch + Total/Grand Total เหมือนชีต Accounts Payable Trial Balance
const BORDER_SIDES = { left: { style: "thin" }, right: { style: "thin" } }; // แถวข้อมูล: เส้นแนวตั้งอย่างเดียว | เส้นแถว (บน/ล่าง) มีเฉพาะแถว Total / Grand Total (BORDER_ALL)
const BORDER_ALL = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
function addDetailSheet(wb, rows, o) {
  if (!rows || !rows.length) return;
  const ws = wb.addWorksheet("Detail", { views: [{ state: "frozen", ySplit: 9 }] });
  const heads = ["Branch Code", "Branch Name", "Cost Center", "Account Code", "Account Name", "Sub Account Code", "Transaction Date", "Journal name", "Invoice Number", "Vendor Name", "Description", "Amount", "Contact From..To"];
  const widths = [14, 34, 11, 13, 32, 15, 16, 38, 20, 40, 60, 16, 18]; // MARKER_APRECONCILE_DETAIL_WIDTH_V2 -- Journal name / Description กว้างพอ ข้อความไม่ล้นไปช่องข้างเคียง (เส้นแนวตั้งไม่ขาด)
  ws.columns = widths.map((w) => ({ width: w }));
  // หัวรายงาน DETAIL OF ACCOUNT (แถว 1-7) | ตารางเริ่มแถว 9
  const acctNo = String(o.account);
  ws.getCell("A1").value = "DETAIL OF ACCOUNT"; ws.getCell("A1").font = { bold: true, size: 12, name: "Calibri" };
  const info = [["Company", `${o.comCode} ${o.companyNameEn}`], ["Branch", `${o.branchFrom}-${o.branchTo} ${o.companyNameEn}`], ["Account code", Number(acctNo)], ["Account name", o.accountName || AP_ACCOUNT_NAMES[acctNo] || ""], ["Period", dMonYY(o.asOfDate)]];
  info.forEach(([k, v], i) => {
    ws.getCell(`A${3 + i}`).value = k; ws.getCell(`B${3 + i}`).value = v;
    ws.getCell(`A${3 + i}`).font = { size: 11, name: "Tahoma" }; ws.getCell(`B${3 + i}`).font = { size: 11, name: "Tahoma" }; ws.getCell(`B${3 + i}`).alignment = { horizontal: "left" };
  });
  const hr = ws.getRow(9);
  heads.forEach((h, i) => {
    const c = hr.getCell(i + 1); c.value = h;
    // MARKER_APRECONCILE_DETAIL_STYLE_V2 -- หัวตารางกรมท่า FF002060 ตัวอักษรขาว + เส้นขอบ เหมือนชีต TB / Accounts Payable Trial Balance
    c.font = { bold: true, size: 12, name: "Calibri", color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF002060" } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = BORDER_ALL;
  });
  hr.height = 27.5;
  // จัดกลุ่มตาม Branch เหมือนชีต Accounts Payable Trial Balance: แถว "<Branch> Total" (SUBTOTAL) + Grand Total | คำนวณตอนสร้างรายงาน ไม่ได้เก็บใน DB
  const AMT = RED_NUM;
  const bandStyle = (row) => {
    for (let c = 1; c <= heads.length; c++) {
      const cell = row.getCell(c);
      cell.font = { bold: true, size: 11, name: "Tahoma" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFBDD7EE" } };
      cell.border = BORDER_ALL;
    }
  };
  const reversal = findReversalPairs(rows);
  let n = 10; let grpStart = 10; let curBranch = null; let sAmt = 0; let gAmt = 0;
  const flush = () => {
    if (curBranch === null) return;
    const t = ws.getRow(n);
    bandStyle(t);
    t.getCell(1).value = `${curBranch} Total`;
    t.getCell(12).value = { formula: `SUBTOTAL(9,L${grpStart}:L${n - 1})`, result: r2(sAmt) };
    t.getCell(12).numFmt = AMT;
    n++; grpStart = n; sAmt = 0;
  };
  for (const [ri, r] of rows.entries()) {
    if (curBranch !== null && r.branch_code !== curBranch) flush();
    curBranch = r.branch_code;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r.tdate || "");
    const vals = [r.branch_code, r.branch_name, r.cost_center, r.account_code, r.account_name, r.sub_account_code,
      m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null, r.journal_name, r.invoice_number, r.vendor_name, r.description, Number(r.amount), r.contact_from_to];
    const row = ws.getRow(n++);
    vals.forEach((v, i) => { const cc = row.getCell(i + 1); cc.value = v == null ? null : v; cc.font = { size: 11, name: "Tahoma" }; cc.border = BORDER_SIDES; }); // MARKER_APRECONCILE_DETAIL_LINES_V3 -- แถวข้อมูลมีเฉพาะเส้นแนวตั้ง (ซ้าย/ขวา) เหมือนชีต Accounts Payable Trial Balance
    row.getCell(7).numFmt = "dd-mmm-yyyy"; row.getCell(7).alignment = { horizontal: "center" };
    row.getCell(12).numFmt = AMT;
    if (reversal.has(ri)) {
      row.getCell(13).value = "Confirm Clear";
      for (let c = 1; c <= heads.length; c++) row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
    }
    sAmt += Number(r.amount) || 0; gAmt += Number(r.amount) || 0;
  }
  flush();
  const g = ws.getRow(n);
  bandStyle(g);
  g.getCell(1).value = "Grand Total";
  g.getCell(12).value = { formula: `SUBTOTAL(9,L10:L${n - 1})`, result: r2(gAmt) };
  g.getCell(12).numFmt = AMT;
  ws.autoFilter = { from: { row: 9, column: 1 }, to: { row: 9, column: heads.length } };
}

/**
 * @param {object} o { account, accountName, bu, comCode, companyNameEn, book, branchFrom, branchTo, asOfDate(Date UTC), reportDate(Date),
 *                     liabFrom, liabTo, tbRows[], apRows[] }
 *  tbRows: { branch, cpc, account, subacc, description, beginning, activity, ending }
 *  apRows (เรียงตาม Branch, SubAcc แล้ว): { branch, account, subacc, supplier_code, supplier_name, invoice_no, invoice_date(Date|null), currency, amount, remaining, description }
 */
export async function buildApAccountWorkbook(o) {
  const hasData = (o.apRows && o.apRows.length > 0) || (o.tbRows && o.tbRows.length > 0);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(hasData ? TEMPLATE_DATA : TEMPLATE_NODATA);
  clearDefinedNames(wb);
  wb.creator = "FASTAPN Link3ase";
  const wsCv = wb.getWorksheet("Cover");
  const wsTb = wb.worksheets.find((w) => /^TB/.test(w.name));
  const wsAp = wb.getWorksheet("Accounts Payable Trial Balance");
  const acct = String(o.account);
  const accountName = o.accountName || AP_ACCOUNT_NAMES[acct] || "";
  const oo = { ...o, accountName };
  if (hasData && (!o.liabFrom || !o.liabTo) && o.apRows.length) {
    // Liability Account From/To = Company code + Branch + 99999 + GL + SubAcc ของแถวแรก/แถวสุดท้าย (ตาม Macro)
    const f = o.apRows[0]; const l = o.apRows[o.apRows.length - 1];
    oo.liabFrom = `${o.comPrefix}${f.branch}-99999-${acct}-${f.subacc}`;
    oo.liabTo = `${o.comPrefix}${l.branch}-99999-${acct}-${l.subacc}`;
  }

  coverValues(wsCv, oo);
  // TB sheet: หัวรายงาน
  wsTb.getCell("B3").value = `${o.comCode} ${o.companyNameEn}`;
  wsTb.getCell("B4").value = `${o.branchFrom}-${o.branchTo} ${o.companyNameEn}`;
  wsTb.getCell("B5").value = Number(acct);
  wsTb.getCell("B6").value = accountName;
  wsTb.getCell("B7").value = o.asOfDate;
  setHeaderLines(wsAp, oo, hasData);

  if (!hasData) { addDetailSheet(wb, o.detailRows, { ...o, accountName }); return { wb, hasData, accountName }; }

  // ── ชีต TB <Account> ──
  const oldTbName = wsTb.name;
  wsTb.name = `TB ${acct}`;
  const AP = "'Accounts Payable Trial Balance'";
  // สไตล์แถว TB ตามตำแหน่งเหมือนต้นฉบับ: แถวแรก = มีเส้นบน | แถวกลาง = ไม่มี | แถวสุดท้าย = มีเส้นล่าง
  const rowStyles = (ws, r, n) => Array.from({ length: n }, (_, i) => clone(ws.getRow(r).getCell(i + 1).style));
  const tbFirst = rowStyles(wsTb, 10, 14); const tbMid = rowStyles(wsTb, 11, 14); const tbLast = rowStyles(wsTb, wsTb.rowCount - 1, 14);
  const tbStyleAt = (idx, total) => {
    if (total === 1) return tbFirst.map((st, i) => ({ ...st, border: { ...(st.border || {}), bottom: (tbLast[i].border || {}).bottom } }));
    return idx === 0 ? tbFirst : idx === total - 1 ? tbLast : tbMid;
  };
  const tbTotStyle = Array.from({ length: 14 }, (_, i) => clone(wsTb.getRow(wsTb.rowCount).getCell(i + 1).style));
  const tbHeight = wsTb.getRow(10).height;
  clearRows(wsTb, 10, wsTb.rowCount); // ล้างข้อมูลตัวอย่างทั้งหมด (Style ถูกเก็บไว้แล้วด้านบน)
  const apRem = new Map();
  for (const a of o.apRows) {
    const k = `${a.branch}|${a.subacc}`;
    apRem.set(k, r2((apRem.get(k) || 0) + Number(a.remaining || 0)));
  }
  // MARKER_APRECONCILE_JOURNAL_ADJ_V1 -- Journal ADJ. (คอลัมน์ K) = Lookup จากชีต Detail ตาม Branch + SubAcc
  const jvAdj = new Map();
  for (const d of (o.detailRows || [])) { const k = `${d.branch_code}|${d.sub_account_code}`; jvAdj.set(k, r2((jvAdj.get(k) || 0) + Number(d.amount || 0))); }
  const hasDetail = (o.detailRows || []).length > 0;
  let tbRow = 10;
  const tot = { F: 0, G: 0, H: 0, I: 0, J: 0, K: 0, L: 0, M: 0 };
  for (const [tbIdx, t] of o.tbRows.entries()) {
    const tbStyle = tbStyleAt(tbIdx, o.tbRows.length);
    const r = wsTb.getRow(tbRow);
    if (tbHeight) r.height = tbHeight;
    const I = r2(-(apRem.get(`${t.branch}|${t.subacc}`) || 0));
    const K = hasDetail ? (jvAdj.get(`${t.branch}|${t.subacc}`) || 0) : 0;
    const L = r2(I + K);
    const M = r2(Number(t.ending) - L);
    const vals = [t.branch, t.cpc, String(t.account), t.subacc, t.description, Number(t.beginning), Number(t.activity), Number(t.ending),
      { formula: `-SUMIFS(${AP}!$I$20:$I$1000000,${AP}!$A$20:$A$1000000,$A${tbRow},${AP}!$C$20:$C$1000000,$D${tbRow})`, result: I },
      null, hasDetail ? { formula: `SUMIFS(Detail!$L$10:$L$1000000,Detail!$A$10:$A$1000000,$A${tbRow},Detail!$F$10:$F$1000000,$D${tbRow})`, result: K } : null,
      { formula: `SUM($I${tbRow}:$K${tbRow})`, result: L },
      { formula: `+$H${tbRow}-$L${tbRow}`, result: M }, null];
    vals.forEach((v, i) => { const c = r.getCell(i + 1); c.style = clone(tbStyle[i]); c.value = v; });
    tot.F += Number(t.beginning); tot.G += Number(t.activity); tot.H += Number(t.ending); tot.I += I; tot.K += K; tot.L += L; tot.M += M;
    tbRow++;
  }
  const lastTb = tbRow - 1;
  const rt = wsTb.getRow(tbRow);
  tbTotStyle.forEach((s, i) => { rt.getCell(i + 1).style = clone(s); });
  rt.getCell(1).value = "Total";
  for (const col of ["F", "G", "H", "I", "J", "K", "L", "M"]) {
    rt.getCell(col).value = { formula: `SUM(${col}$10:${col}${lastTb})`, result: r2(tot[col]) };
  }

  // ── ชีต Accounts Payable Trial Balance ──
  const apStyle = Array.from({ length: 10 }, (_, i) => clone(wsAp.getRow(21).getCell(i + 1).style)); // แถวกลางของต้นฉบับ (เส้นซ้าย/ขวา ไม่มีเส้นบน/ล่าง)
  let subRowTpl = null; let grandRowTpl = null;
  wsAp.eachRow((row, n) => { const a = row.getCell(1).value; if (typeof a === "string" && / Total$/.test(a) && !subRowTpl) subRowTpl = n; if (a === "Grand Total") grandRowTpl = n; });
  const subStyle = Array.from({ length: 10 }, (_, i) => clone(wsAp.getRow(subRowTpl).getCell(i + 1).style));
  const grandStyle = Array.from({ length: 10 }, (_, i) => clone(wsAp.getRow(grandRowTpl).getCell(i + 1).style));
  clearRows(wsAp, 20, wsAp.rowCount);
  let n = 20; let grpStart = 20; let curBranch = null; let gAmt = 0; let gRem = 0; let sAmt = 0; let sRem = 0;
  const flush = () => {
    if (curBranch === null) return;
    const r = wsAp.getRow(n);
    subStyle.forEach((s, i) => { r.getCell(i + 1).style = clone(s); });
    r.getCell(1).value = `${curBranch} Total`;
    r.getCell(8).value = { formula: `SUBTOTAL(9,H${grpStart}:H${n - 1})`, result: r2(sAmt) };
    r.getCell(9).value = { formula: `SUBTOTAL(9,I${grpStart}:I${n - 1})`, result: r2(sRem) };
    n++; grpStart = n; sAmt = 0; sRem = 0;
  };
  for (const a of o.apRows) {
    if (curBranch !== null && a.branch !== curBranch) flush();
    curBranch = a.branch;
    const r = wsAp.getRow(n);
    const vals = [a.branch, Number(a.account), a.subacc, supplierText(a.supplier_code, a.supplier_name), a.invoice_no, a.invoice_date ? dMonYY(a.invoice_date) : "", a.currency, Number(a.amount), Number(a.remaining), a.description];
    vals.forEach((v, i) => { const c = r.getCell(i + 1); c.style = clone(apStyle[i]); c.value = v; });
    sAmt += Number(a.amount); sRem += Number(a.remaining); gAmt += Number(a.amount); gRem += Number(a.remaining);
    n++;
  }
  flush();
  const rg = wsAp.getRow(n);
  grandStyle.forEach((s, i) => { rg.getCell(i + 1).style = clone(s); });
  rg.getCell(1).value = "Grand Total";
  rg.getCell(8).value = { formula: `SUBTOTAL(9,H20:H${Math.max(20, n - 2)})`, result: r2(gAmt) };
  rg.getCell(9).value = { formula: `SUBTOTAL(9,I20:I${Math.max(20, n - 2)})`, result: r2(gRem) };

  // ── Cover: สูตรอ้างชีต TB ของ Account นี้ + ค่า Cached ──
  const perTb = r2(tot.H); const perDet = r2(tot.I + tot.L - tot.L); // Per Detail = ผลรวมคอลัมน์ I ของแถว Total
  const covF = (cell, col, result) => { wsCv.getCell(cell).value = { formula: `ROUND(SUMIF('TB ${acct}'!$A$10:$A$1000000,"*Total*",'TB ${acct}'!$${col}$10:$${col}$1000000),2)`, result }; };
  covF("E16", "H", perTb); covF("F16", "I", r2(tot.I)); covF("F18", "K", r2(tot.K)); covF("F20", "J", 0);
  wsCv.getCell("G16").value = { formula: "IFERROR($E16-$F16,\"\")", result: r2(perTb - tot.I) };
  wsCv.getCell("G18").value = { formula: "IFERROR($E18-$F18,\"\")", result: r2(0 - tot.K) };
  wsCv.getCell("G20").value = { formula: "IFERROR($E20-$F20,\"\")", result: 0 };
  wsCv.getCell("E23").value = { formula: "SUM(E14:E22)", result: perTb };
  wsCv.getCell("F23").value = { formula: "SUM(F14:F22)", result: r2(tot.I + tot.K) };
  wsCv.getCell("G23").value = { formula: "SUM(G14:G22)", result: r2(perTb - tot.I - tot.K) };
  void oldTbName; void perDet;
  // ยอดติดลบเป็นสีแดง: TB (F:M) · Accounts Payable Trial Balance (H:I) · Cover (E:G)
  for (let r = 10; r <= tbRow; r++) for (let c = 6; c <= 13; c++) wsTb.getRow(r).getCell(c).numFmt = RED_NUM;
  for (let r = 20; r <= n; r++) for (const c of [8, 9]) wsAp.getRow(r).getCell(c).numFmt = RED_NUM;
  for (let r = 14; r <= 23; r++) for (const c of [5, 6, 7]) wsCv.getRow(r).getCell(c).numFmt = RED_NUM;
  addDetailSheet(wb, o.detailRows, { ...o, accountName });
  applyRedNegatives(wb);
  return { wb, hasData, accountName };
}
