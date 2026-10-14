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

  if (!hasData) return { wb, hasData, accountName };

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
  let tbRow = 10;
  const tot = { F: 0, G: 0, H: 0, I: 0, J: 0, K: 0, L: 0, M: 0 };
  for (const [tbIdx, t] of o.tbRows.entries()) {
    const tbStyle = tbStyleAt(tbIdx, o.tbRows.length);
    const r = wsTb.getRow(tbRow);
    if (tbHeight) r.height = tbHeight;
    const I = r2(-(apRem.get(`${t.branch}|${t.subacc}`) || 0));
    const L = I;
    const M = r2(Number(t.ending) - L);
    const vals = [t.branch, t.cpc, String(t.account), t.subacc, t.description, Number(t.beginning), Number(t.activity), Number(t.ending),
      { formula: `-SUMIFS(${AP}!$I$20:$I$1000000,${AP}!$A$20:$A$1000000,$A${tbRow},${AP}!$C$20:$C$1000000,$D${tbRow})`, result: I },
      null, null,
      { formula: `SUM($I${tbRow}:$K${tbRow})`, result: L },
      { formula: `+$H${tbRow}-$L${tbRow}`, result: M }, null];
    vals.forEach((v, i) => { const c = r.getCell(i + 1); c.style = clone(tbStyle[i]); c.value = v; });
    tot.F += Number(t.beginning); tot.G += Number(t.activity); tot.H += Number(t.ending); tot.I += I; tot.L += L; tot.M += M;
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
  covF("E16", "H", perTb); covF("F16", "I", r2(tot.I)); covF("F18", "K", 0); covF("F20", "J", 0);
  wsCv.getCell("G16").value = { formula: "IFERROR($E16-$F16,\"\")", result: r2(perTb - tot.I) };
  wsCv.getCell("G18").value = { formula: "IFERROR($E18-$F18,\"\")", result: 0 };
  wsCv.getCell("G20").value = { formula: "IFERROR($E20-$F20,\"\")", result: 0 };
  wsCv.getCell("E23").value = { formula: "SUM(E14:E22)", result: perTb };
  wsCv.getCell("F23").value = { formula: "SUM(F14:F22)", result: r2(tot.I) };
  wsCv.getCell("G23").value = { formula: "SUM(G14:G22)", result: r2(perTb - tot.I) };
  void oldTbName; void perDet;
  return { wb, hasData, accountName };
}
