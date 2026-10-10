// vatExportGenerators.js
// ── Pure Function สร้างไฟล์ Excel Popvat/Simple/ADI จาก Master Template จริง ──
// ── แยกออกจาก Route/DB โดยตั้งใจ เพื่อ Unit Test ได้ง่าย ไม่ต้องพึ่ง Database ──
import ExcelJS from "exceljs";
import { createRequire } from "module";

// MARKER_VATEXPORTGEN_STRIP_FILTERPRIVACY_V1 -- ExcelJS ฝัง filterPrivacy="1" ใน xl/workbook.xml ของทุกไฟล์ที่เขียนออกมา
// ทำให้ Excel ขึ้น "Be careful! Parts of your document may include personal information..." ทุกครั้งที่ Save/Export
// ตัด Attribute นี้ออกจาก Buffer หลังเขียน (ถ้าตัดไม่ได้ให้คืน Buffer เดิม ไม่ให้ Export ล้ม)
async function stripFilterPrivacy(xlsxBuffer) {
  try {
    let JSZip;
    try {
      JSZip = (await import("jszip")).default;
    } catch (e1) {
      const req = createRequire(import.meta.url);
      JSZip = createRequire(req.resolve("exceljs"))("jszip");
    }
    const zip = await JSZip.loadAsync(xlsxBuffer);
    const f = zip.file("xl/workbook.xml");
    if (!f) return xlsxBuffer;
    const xml = await f.async("string");
    const next = xml.replace(/\sfilterPrivacy="(?:1|true)"/, "");
    if (next === xml) return xlsxBuffer;
    zip.file("xl/workbook.xml", next);
    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } catch (err) {
    console.error("[stripFilterPrivacy] skip:", err.message);
    return xlsxBuffer;
  }
}

const MONTH_ABBR = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// ── "09-2026" -> "SEP-26" ──────────────────────────────────────────────────
export function periodToMmmYy(periodMonthYear) {
  if (!periodMonthYear) return "";
  const [mm, yyyy] = String(periodMonthYear).split("-");
  const idx = parseInt(mm, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx > 11) return "";
  return `${MONTH_ABBR[idx]}-${String(yyyy).slice(-2)}`;
}

// ── รองรับ 2 Format: "2026-08-15" (ISO, ใช้กับ Simple/ADI ที่เป็น Date Column จริง) ──
// ── และ "09-Sep-26" (DD-MMM-YY, ใช้กับ Popvat ที่เก็บเป็น Text -- Confirm จาก DB จริงแล้ว) ──
// ── ต้องแปลงเป็น JS Date object ก่อนเสมอ ไม่งั้น ExcelJS/SheetJS จะเขียนเป็น Text ธรรมดา ไม่ใช่ Date Cell จริง ──
const MONTH_ABBR_LOOKUP = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
export function toExcelDate(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).trim();

  // Format 1: ISO "YYYY-MM-DD"
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, y, mo, d] = isoMatch;
    return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d))); // MARKER_VATEXPORT_TOEXCELDATE_UTC_FIX_V1 -- ใช้ UTC เที่ยงคืน เพราะ ExcelJS เขียน Date เป็น UTC; แบบเดิม new Date(y,m,d) = เที่ยงคืนเวลาไทย => Excel ถอยไปวันก่อนหน้า (เช่น 30-Sep โชว์ 29-Sep 17:00)
  }

  // Format 2: "DD-MMM-YY" หรือ "DD-MMM-YYYY" (เช่น "09-Sep-26") -- MARKER_VATEXPORT_TOEXCELDATE_DDMMMYY_FIX_V1
  const ddMmmYyMatch = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (ddMmmYyMatch) {
    const [, d, mmmRaw, yRaw] = ddMmmYyMatch;
    const monthIdx = MONTH_ABBR_LOOKUP[mmmRaw.toLowerCase()];
    if (monthIdx === undefined) return null;
    let year = Number(yRaw);
    if (year < 100) year += 2000; // "26" -> 2026
    return new Date(Date.UTC(year, monthIdx, Number(d))); // MARKER_VATEXPORT_TOEXCELDATE_UTC_FIX_V1
  }

  return null;
}

// ── "3218" + "09-2026" -> "3218\2026.09" ────────────────────────────────────
export function buildFolderPath(com, periodMonthYear) {
  if (!com || !periodMonthYear) return "";
  const [mm, yyyy] = String(periodMonthYear).split("-");
  return `${com}\\${yyyy}.${mm}`;
}

// ════════════════════════════════════════════════════════════════════════
// POPVAT -- Sheet เดียว "AP-UpdateTax", Data เริ่มแถว 2, Column A-G (H/I เว้นว่างเสมอ)
// MARKER_VATEXPORT_POPVAT_EXCELJS_LIBREOFFICE_V4 -- ใช้ exceljs เขียน .xlsx
// สะอาด (สี/Format ครบ) ก่อน แล้วส่งต่อให้ LibreOffice (ติดตั้งแล้วบน Server)
// แปลงเป็น .xls แท้อีกที (Composite Document File V2 เหมือนไฟล์ Excel จริง
// ไม่ติด Protected View) -- แก้ปัญหาทั้ง 2 เรื่องพร้อมกัน (ทั้ง SheetJS ที่
// ระบบปลายทางเปิดได้แต่ Protected View ยังติด และ .xlsx ตรงๆ ที่ระบบปลายทาง
// เปิดไม่ได้เลย) -- Template ต้องเป็น .xlsx (Master Popvat Templete.xlsx)
// ════════════════════════════════════════════════════════════════════════
export async function generatePopvatWorkbook(templatePath, rows, meta) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(templatePath);
  wb.definedNames.model = []; // MARKER_VATEXPORT_STRIP_EXTERNAL_DEFINEDNAMES_V1 -- เคลียร์ Defined Name ที่มี External Link ค้าง (กัน Excel ขึ้น Repair Dialog)
  const ws = wb.worksheets[0];

  rows.forEach((r, i) => {
    const rowIdx = i + 2; // แถวที่ 2 เป็นต้นไป (1-indexed ตาม Excel)
    ws.getCell(`A${rowIdx}`).value = r.branch || "";
    ws.getCell(`B${rowIdx}`).value = r.grt_number || "";
    ws.getCell(`C${rowIdx}`).value = r.original_invoice_number || "";
    ws.getCell(`D${rowIdx}`).value = toExcelDate(r.receipt_date);
    ws.getCell(`D${rowIdx}`).numFmt = 'dd-mmm-yy'; // MARKER_VATEXPORT_DATECELL_NUMFMT_CONSISTENT_V1
    ws.getCell(`E${rowIdx}`).value = r.tax_invoice_number || "";
    ws.getCell(`F${rowIdx}`).value = toExcelDate(r.tax_invoice_date);
    ws.getCell(`F${rowIdx}`).numFmt = 'dd-mmm-yy'; // MARKER_VATEXPORT_DATECELL_NUMFMT_CONSISTENT_V1
    ws.getCell(`G${rowIdx}`).value = r.vendor_tax_invoice_number || "";
    // H (Supplier Tax ID) / I (Supplier Branch Number) เว้นว่างเสมอ -- Confirm แล้ว
  });

  // ── Metadata (M2 Create by คงค่าเดิมจาก Template ไว้ ไม่แตะ) ──
  ws.getCell("M3").value = meta.folderPath || "";
  // M4 (Time Stamp) / M5 (File Name) เว้นว่าง -- ระบบปลายทางเติมเอง
  ws.getCell("M7").value = meta.bu || "";
  ws.getCell("M8").value = meta.periodMmmYy || "";

  return stripFilterPrivacy(await wb.xlsx.writeBuffer());
}

// ════════════════════════════════════════════════════════════════════════
// LIBREOFFICE CONVERT -- แปลง Buffer .xlsx เป็น Buffer .xls แท้ (Headless CLI)
// MARKER_VATEXPORT_LIBREOFFICE_CONVERT_V1
// ════════════════════════════════════════════════════════════════════════
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";
const execFileAsync = promisify(execFile);

const SOFFICE_PATH = "C:\\apps\\LibreOfficePortable\\App\\libreoffice\\program\\soffice.exe";

export async function convertXlsxBufferToXls(xlsxBuffer, baseFileName) {
  // ── ใช้ Folder ชั่วคราวแยกทุกครั้ง (กัน Conflict ถ้ามีหลาย Request วิ่งพร้อมกัน) ──
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vatexport-libreoffice-"));
  const inputPath = path.join(tmpDir, `${baseFileName}.xlsx`);
  const outputPath = path.join(tmpDir, `${baseFileName}.xls`);

  try {
    fs.writeFileSync(inputPath, xlsxBuffer);

    // ── -env:UserInstallation ให้แต่ละ Request ใช้ Profile แยกกัน กัน Lock ชนกันตอนมีหลาย Request พร้อมกัน ──
    const userProfileDir = path.join(tmpDir, "profile");
    await execFileAsync(SOFFICE_PATH, [
      "--headless",
      "--convert-to", "xls",
      "--outdir", tmpDir,
      `-env:UserInstallation=file:///${userProfileDir.replace(/\\/g, "/")}`,
      inputPath,
    ], { timeout: 60000 }); // 60 วิ กันค้างถ้า LibreOffice มีปัญหา

    if (!fs.existsSync(outputPath)) {
      throw new Error("LibreOffice แปลงไฟล์ไม่สำเร็จ (ไม่พบไฟล์ผลลัพธ์)");
    }

    return fs.readFileSync(outputPath);
  } finally {
    // ── ลบ Folder ชั่วคราวทิ้งเสมอ ไม่ว่าจะสำเร็จหรือ Error ──
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}


// ── Copy Cell ทีละตัว (value + style + numFmt) จาก Sheet ต้นแบบ ไปยัง Sheet ใหม่ ──
function cloneSheetInto(targetWorkbook, sourceWs, newSheetName) {
  const newWs = targetWorkbook.addWorksheet(newSheetName, {
    views: sourceWs.views,
    properties: sourceWs.properties,
  });

  sourceWs.columns.forEach((col, idx) => {
    if (col && col.width) newWs.getColumn(idx + 1).width = col.width;
  });

  sourceWs.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const newRow = newWs.getRow(rowNumber);
    if (row.height) newRow.height = row.height; // MARKER_VATEXPORT_CLONESHEET_ROWHEIGHT_V1 -- เดิมไม่เคย Copy ความสูงแถว
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const newCell = newRow.getCell(colNumber);
      newCell.value = cell.value;
      newCell.style = JSON.parse(JSON.stringify(cell.style || {}));
      newCell.numFmt = cell.numFmt;
    });
    newRow.commit();
  });

  (sourceWs.model.merges || []).forEach((range) => {
    try { newWs.mergeCells(range); } catch (e) { /* ข้าม Range ที่ Merge ซ้ำ/ผิดพลาด ไม่ทำให้ทั้งไฟล์พัง */ }
  });

  return newWs;
}

// ── "YNY" -> { createJournal: 'Yes', interbranch: 'No', bookVatOnly: 'Yes' } ──
function typeSimToYn(typeSim) {
  const t = String(typeSim || "");
  const yn = (ch) => (ch === "Y" ? "Yes" : "No");
  return { createJournal: yn(t[0]), interbranch: yn(t[1]), bookVatOnly: yn(t[2]) };
}

// MARKER_VATEXPORT_SIMPLE_Y2_HHMM_TYPESIM_INVOICEREF_V1 -- Invoice Ref ย่อสำหรับใส่ใน Y2 (Invoice=IV, Credit=CN, ค่าอื่นที่ไม่รู้จัก Default เป็น IV)
// MARKER_VATEXPORT_Y2_SHORT_N_Y_I_C_V1 -- Type 3 ตัว (เช่น NNN/YNY) -> ตัวเดียว: มี Y อย่างน้อย 1 ตัว = Y, ไม่มีเลย = N
function typeSimToShortYN(typeSim) {
  return String(typeSim || "").toUpperCase().includes("Y") ? "Y" : "N";
}
function invoiceRefToAbbrev(invoiceRef) {
  return String(invoiceRef || "").trim().toLowerCase() === "credit" ? "C" : "I"; // MARKER_VATEXPORT_Y2_SHORT_N_Y_I_C_V1 -- ย่อเหลือตัวเดียว: Credit=C, Invoice=I
}

// ── Excel Sheet ชื่อห้ามเกิน 31 ตัวอักษร และห้ามมีอักขระ \/?*[]: ──
function sanitizeSheetName(name) {
  return String(name || "Sheet").replace(/[\\/?*[\]:]/g, "_").slice(0, 31) || "Sheet";
}

// ════════════════════════════════════════════════════════════════════════
// SIMPLE + ADI -- รวมเป็น 1 ไฟล์เดียว (.xlsx) หลาย Sheet:
//   Sheet ของ Simple 1 Sheet ต่อ 1 กลุ่ม (invoice_ref + type_sim) + อีก 1 Sheet สำหรับ ADI
// MARKER_VATEXPORT_SIMPLE_ADI_COMBINED_V1 -- Popvat แยกไฟล์เดี่ยวเสมอ ไม่รวมกับใคร
// (Confirm แล้ว) ส่วน Simple/ADI รวมกันได้ในไฟล์เดียวแบบนี้
// ════════════════════════════════════════════════════════════════════════

// groupedRows: [{ key: 'invoice_ref_typeSim', invoiceRef, typeSim, rows: [...] }, ...]
// adiRows: [...] (ถ้าไม่มีข้อมูล ADI เลย ส่ง [] มาได้ -- จะไม่สร้าง Sheet ADI)
export async function generateSimpleAdiWorkbook(simpleTemplatePath, groupedRows, adiTemplatePath, adiRows, meta) {
  // ── ใช้ Simple Template เป็น Output Workbook หลัก (กัน Theme หายเหมือนที่เจอมาก่อน) ──
  const outWb = new ExcelJS.Workbook();
  await outWb.xlsx.readFile(simpleTemplatePath);
  outWb.definedNames.model = []; // MARKER_VATEXPORT_STRIP_EXTERNAL_DEFINEDNAMES_V1
  const masterWs = outWb.worksheets[0];

  const usedNames = new Set();
  // MARKER_VATEXPORT_SIMPLE_CLONE_BEFORE_FILL_V1 -- Clone ทุก Sheet ให้ครบก่อน แล้วค่อยเติมข้อมูลทีหลัง
  // (เดิม Clone สลับกับเติมข้อมูลทีละกลุ่ม ทำให้กลุ่มที่ 2 เป็นต้นไป Clone จาก masterWs
  // ที่ถูกกลุ่มแรกเติมข้อมูลไปแล้ว -- ได้ข้อมูลกลุ่มแรกเหลือค้างในแถวที่กลุ่มถัดไปไม่ได้เขียนทับ)
  const sheetsForGroups = groupedRows.map((group, idx) => {
    let sheetName = sanitizeSheetName(group.key);
    let suffix = 1;
    while (usedNames.has(sheetName)) {
      sheetName = sanitizeSheetName(`${group.key}_${++suffix}`);
    }
    usedNames.add(sheetName);
    const ws = idx === 0 ? masterWs : cloneSheetInto(outWb, masterWs, sheetName);
    if (idx === 0) ws.name = sheetName;
    return { group, ws };
  });

  sheetsForGroups.forEach(({ group, ws }) => {
    const yn = typeSimToYn(group.typeSim);

    // MARKER_VATEXPORTGEN_BOOK_FUNCTION_FIELDS_V1 -- C1 ใช้ meta.book (Fallback meta.bu ถ้าไม่มี -- VAT
    // ไม่กระทบ) แทนการอ้าง $J$4 (=meta.bu) ตรงๆ เพราะ Prefix ควรเป็น Book (เช่น "CRG") ไม่ใช่ BU
    // C4 (Function) ใช้ meta.functionCode (Fallback "APN" เดิม -- VAT ไม่กระทบ) แทน Hardcode ตายตัว
    const c1PrefixVal = String(meta.book || meta.bu || "").replace(/"/g, '""');
    ws.getCell("J4").value = meta.book || meta.bu || ""; // MARKER_VATEXPORTGEN_BUBOOK_J4_V1 -- BU Book ตาม Macro CHECK_GROUPBRAND_APN (เช่น CTD -> HWS)
    ws.getCell("C1").value = { formula: `"${c1PrefixVal}"&"INPUTVAT_"&TEXT(TODAY(),"YYMMDD")&"-"&$Y$2` };
    ws.getCell("C2").value = meta.company || "";
    ws.getCell("C3").value = "APN";
    ws.getCell("C4").value = meta.functionCode || "APN";
    ws.getCell("C5").value = group.invoiceType || "Invoice";
    ws.getCell("C6").value = yn.createJournal;
    ws.getCell("C7").value = yn.interbranch;
    ws.getCell("C8").value = yn.bookVatOnly;
    ws.getCell("C13").value = meta.periodMmmYy || "";
    ws.getCell("M1").value = "FASTAPN LINK3ASE"; // MARKER_VATEXPORT_SIMPLE_M1_CREATEDBY_V1 -- ทับค่า Static เดิมจาก Template ("AP_UpdateTax_System")
    ws.getCell("M2").value = meta.folderPath || "";
    ws.getCell("Y2").value = `${meta.hhmm || ""}${typeSimToShortYN(group.typeSim)}_${invoiceRefToAbbrev(group.invoiceRef)}`; // MARKER_VATEXPORT_SIMPLE_Y2_HHMM_TYPESIM_INVOICEREF_V1

    group.rows.forEach((r, i) => {
      const rowIdx = i + 16;
      ws.getCell(`D${rowIdx}`).value = r.supplier_code || "";
      ws.getCell(`E${rowIdx}`).value = r.supplier_name || "";
      ws.getCell(`F${rowIdx}`).value = toExcelDate(r.receive_date);
      ws.getCell(`F${rowIdx}`).numFmt = 'dd-mmm-yy'; // MARKER_VATEXPORT_DATECELL_NUMFMT_CONSISTENT_V1
      ws.getCell(`G${rowIdx}`).value = r.tax_invoice_number || "";
      ws.getCell(`H${rowIdx}`).value = toExcelDate(r.tax_invoice_date);
      ws.getCell(`H${rowIdx}`).numFmt = 'dd-mmm-yy'; // MARKER_VATEXPORT_DATECELL_NUMFMT_CONSISTENT_V1
      ws.getCell(`I${rowIdx}`).value = r.vendor_tax_invoice_number || "";
      ws.getCell(`J${rowIdx}`).value = r.tax_id || "";
      ws.getCell(`K${rowIdx}`).value = r.branch_no || "";
      // MARKER_VATEXPORTGEN_LINE_NUMBER_SEQUENCE_V1 -- Fallback เป็นลำดับแถว (i+1) ถ้าไม่มี r.line_number ส่งมา (VAT ถ้าส่งมาเองจะใช้ค่านั้นก่อนเสมอ ไม่กระทบ)
      ws.getCell(`L${rowIdx}`).value = r.line_number ?? (i + 1);
      ws.getCell(`M${rowIdx}`).value = r.expense_type || "";
      ws.getCell(`N${rowIdx}`).value = r.description || "";
      ws.getCell(`O${rowIdx}`).value = r.amount_ex_vat != null ? Number(r.amount_ex_vat) : "";
      ws.getCell(`P${rowIdx}`).value = r.vat_amount != null ? Number(r.vat_amount) : "";
      ws.getCell(`Q${rowIdx}`).value = r.branch_code || "";
      ws.getCell(`R${rowIdx}`).value = r.cpc_special || "";
      ws.getCell(`S${rowIdx}`).value = r.sub_account_special || "";
      ws.getCell(`T${rowIdx}`).value = r.cpc_tax_special || "";
      ws.getCell(`U${rowIdx}`).value = r.vat_average_percent != null ? Number(r.vat_average_percent) : "";
      ws.getCell(`V${rowIdx}`).value = r.grt_run ?? "";
    });
  });

  // ── เพิ่ม Sheet ADI ต่อท้าย (ถ้ามีข้อมูล) -- Clone จาก ADI Template แยกต่างหาก ──
  if (adiRows && adiRows.length > 0) {
    const adiTemplateWb = new ExcelJS.Workbook();
    await adiTemplateWb.xlsx.readFile(adiTemplatePath);
    adiTemplateWb.definedNames.model = []; // MARKER_VATEXPORT_STRIP_EXTERNAL_DEFINEDNAMES_V1
    const adiMasterWs = adiTemplateWb.worksheets[0];

    let adiSheetName = sanitizeSheetName("ADI-Upload"); // MARKER_VATEXPORTGEN_ADI_SHEETNAME_HYPHEN_V1 -- ชื่อ Sheet ตาม Macro = "ADI-Upload" (ขีดกลาง ไม่ใช่ Underscore)
    let adiSuffix = 1;
    while (usedNames.has(adiSheetName)) {
      adiSheetName = sanitizeSheetName(`ADI-Upload_${++adiSuffix}`);
    }
    const adiWs = cloneSheetInto(outWb, adiMasterWs, adiSheetName);

    adiRows.forEach((r, i) => {
      const rowIdx = i + 2;
      adiWs.getCell(`A${rowIdx}`).value = r.category || "";
      adiWs.getCell(`B${rowIdx}`).value = r.source || "";
      adiWs.getCell(`C${rowIdx}`).value = toExcelDate(r.acc_date);
      adiWs.getCell(`C${rowIdx}`).numFmt = 'dd-mmm-yy'; // MARKER_VATEXPORT_DATECELL_NUMFMT_CONSISTENT_V1
      adiWs.getCell(`D${rowIdx}`).value = r.bus || "";
      adiWs.getCell(`E${rowIdx}`).value = r.grp || "";
      adiWs.getCell(`F${rowIdx}`).value = r.com || "";
      adiWs.getCell(`G${rowIdx}`).value = r.branch || "";
      adiWs.getCell(`H${rowIdx}`).value = r.cpc || "";
      adiWs.getCell(`I${rowIdx}`).value = r.acc || "";
      adiWs.getCell(`J${rowIdx}`).value = r.sub_acc || "";
      adiWs.getCell(`K${rowIdx}`).value = r.debit != null ? Number(r.debit) : "";
      adiWs.getCell(`L${rowIdx}`).value = r.credit != null ? Number(r.credit) : "";
      adiWs.getCell(`M${rowIdx}`).value = r.adi_period || ""; // MARKER -- ใช้ adi_period ไม่ใช่ period
      adiWs.getCell(`N${rowIdx}`).value = r.batch_name || "";
      adiWs.getCell(`O${rowIdx}`).value = r.batch_description || "";
      adiWs.getCell(`P${rowIdx}`).value = r.journal_name || "";
      adiWs.getCell(`Q${rowIdx}`).value = r.journal_description || "";
      adiWs.getCell(`R${rowIdx}`).value = r.line_description || "";
      adiWs.getCell(`S${rowIdx}`).value = r.line_dff || "";
    });

    adiWs.getCell("X2").value = meta.folderPath || "";
    adiWs.getCell("X7").value = meta.book || meta.bu || ""; // MARKER_VATEXPORTGEN_BUBOOK_J4_V1
  }

  return stripFilterPrivacy(await outWb.xlsx.writeBuffer());
}

// ════════════════════════════════════════════════════════════════════════
// SIMPLE BY SHEET -- แยกแต่ละกลุ่ม (invoice_ref + type_sim) เป็นคนละไฟล์ต่างหาก
// MARKER_VATEXPORT_SIMPLE_BY_SHEET_V1
// ════════════════════════════════════════════════════════════════════════
// คืน Array [{ sheetKey, buffer }, ...] -- 1 รายการต่อ 1 กลุ่ม/ไฟล์
export async function generateSimpleBySheetWorkbooks(simpleTemplatePath, groupedRows, meta) {
  const results = [];

  for (const group of groupedRows) {
    const outWb = new ExcelJS.Workbook();
    await outWb.xlsx.readFile(simpleTemplatePath);
    outWb.definedNames.model = []; // MARKER_VATEXPORT_STRIP_EXTERNAL_DEFINEDNAMES_V1
    const ws = outWb.worksheets[0];
    ws.name = sanitizeSheetName(group.key);
    const yn = typeSimToYn(group.typeSim);

    // MARKER_VATEXPORTGEN_BOOK_FUNCTION_FIELDS_V1 -- C1 ใช้ meta.book (Fallback meta.bu ถ้าไม่มี -- VAT
    // ไม่กระทบ) แทนการอ้าง $J$4 (=meta.bu) ตรงๆ เพราะ Prefix ควรเป็น Book (เช่น "CRG") ไม่ใช่ BU
    // C4 (Function) ใช้ meta.functionCode (Fallback "APN" เดิม -- VAT ไม่กระทบ) แทน Hardcode ตายตัว
    const c1PrefixVal = String(meta.book || meta.bu || "").replace(/"/g, '""');
    ws.getCell("J4").value = meta.book || meta.bu || ""; // MARKER_VATEXPORTGEN_BUBOOK_J4_V1 -- BU Book ตาม Macro CHECK_GROUPBRAND_APN (เช่น CTD -> HWS)
    ws.getCell("C1").value = { formula: `"${c1PrefixVal}"&"INPUTVAT_"&TEXT(TODAY(),"YYMMDD")&"-"&$Y$2` };
    ws.getCell("C2").value = meta.company || "";
    ws.getCell("C3").value = "APN";
    ws.getCell("C4").value = meta.functionCode || "APN";
    ws.getCell("C5").value = group.invoiceType || "Invoice";
    ws.getCell("C6").value = yn.createJournal;
    ws.getCell("C7").value = yn.interbranch;
    ws.getCell("C8").value = yn.bookVatOnly;
    ws.getCell("C13").value = meta.periodMmmYy || "";
    ws.getCell("M1").value = "FASTAPN LINK3ASE"; // MARKER_VATEXPORT_SIMPLE_M1_CREATEDBY_V1 -- ทับค่า Static เดิมจาก Template ("AP_UpdateTax_System")
    ws.getCell("M2").value = meta.folderPath || "";
    ws.getCell("Y2").value = `${meta.hhmm || ""}${typeSimToShortYN(group.typeSim)}_${invoiceRefToAbbrev(group.invoiceRef)}`; // MARKER_VATEXPORT_SIMPLE_Y2_HHMM_TYPESIM_INVOICEREF_V1

    group.rows.forEach((r, i) => {
      const rowIdx = i + 16;
      ws.getCell(`D${rowIdx}`).value = r.supplier_code || "";
      ws.getCell(`E${rowIdx}`).value = r.supplier_name || "";
      ws.getCell(`F${rowIdx}`).value = toExcelDate(r.receive_date);
      ws.getCell(`F${rowIdx}`).numFmt = 'dd-mmm-yy'; // MARKER_VATEXPORT_DATECELL_NUMFMT_CONSISTENT_V1
      ws.getCell(`G${rowIdx}`).value = r.tax_invoice_number || "";
      ws.getCell(`H${rowIdx}`).value = toExcelDate(r.tax_invoice_date);
      ws.getCell(`H${rowIdx}`).numFmt = 'dd-mmm-yy'; // MARKER_VATEXPORT_DATECELL_NUMFMT_CONSISTENT_V1
      ws.getCell(`I${rowIdx}`).value = r.vendor_tax_invoice_number || "";
      ws.getCell(`J${rowIdx}`).value = r.tax_id || "";
      ws.getCell(`K${rowIdx}`).value = r.branch_no || "";
      // MARKER_VATEXPORTGEN_LINE_NUMBER_SEQUENCE_V1 -- Fallback เป็นลำดับแถว (i+1) ถ้าไม่มี r.line_number ส่งมา (VAT ถ้าส่งมาเองจะใช้ค่านั้นก่อนเสมอ ไม่กระทบ)
      ws.getCell(`L${rowIdx}`).value = r.line_number ?? (i + 1);
      ws.getCell(`M${rowIdx}`).value = r.expense_type || "";
      ws.getCell(`N${rowIdx}`).value = r.description || "";
      ws.getCell(`O${rowIdx}`).value = r.amount_ex_vat != null ? Number(r.amount_ex_vat) : "";
      ws.getCell(`P${rowIdx}`).value = r.vat_amount != null ? Number(r.vat_amount) : "";
      ws.getCell(`Q${rowIdx}`).value = r.branch_code || "";
      ws.getCell(`R${rowIdx}`).value = r.cpc_special || "";
      ws.getCell(`S${rowIdx}`).value = r.sub_account_special || "";
      ws.getCell(`T${rowIdx}`).value = r.cpc_tax_special || "";
      ws.getCell(`U${rowIdx}`).value = r.vat_average_percent != null ? Number(r.vat_average_percent) : "";
      ws.getCell(`V${rowIdx}`).value = r.grt_run ?? "";
    });

    const buffer = await stripFilterPrivacy(await outWb.xlsx.writeBuffer());
    results.push({ sheetKey: group.key, buffer });
  }

  return results;
}

// ════════════════════════════════════════════════════════════════════════
// ADI เดี่ยวๆ (ไม่รวมกับ Simple) -- Sheet เดียว "ADI-Upload", Data เริ่มแถว 2, Column A-S
// MARKER_VATEXPORT_ADI_ONLY_V1
// ════════════════════════════════════════════════════════════════════════
export async function generateAdiOnlyWorkbook(adiTemplatePath, adiRows, meta) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(adiTemplatePath);
  wb.definedNames.model = []; // MARKER_VATEXPORT_STRIP_EXTERNAL_DEFINEDNAMES_V1
  const ws = wb.worksheets[0];
  ws.name = "ADI-Upload"; // MARKER_VATEXPORTGEN_ADI_SHEETNAME_HYPHEN_V1 -- บังคับชื่อ Sheet ให้ตรง Macro แม้ Template ตั้งชื่ออื่น

  adiRows.forEach((r, i) => {
    const rowIdx = i + 2;
    ws.getCell(`A${rowIdx}`).value = r.category || "";
    ws.getCell(`B${rowIdx}`).value = r.source || "";
    ws.getCell(`C${rowIdx}`).value = toExcelDate(r.acc_date);
    ws.getCell(`C${rowIdx}`).numFmt = 'dd-mmm-yy'; // MARKER_VATEXPORT_DATECELL_NUMFMT_CONSISTENT_V1
    ws.getCell(`D${rowIdx}`).value = r.bus || "";
    ws.getCell(`E${rowIdx}`).value = r.grp || "";
    ws.getCell(`F${rowIdx}`).value = r.com || "";
    ws.getCell(`G${rowIdx}`).value = r.branch || "";
    ws.getCell(`H${rowIdx}`).value = r.cpc || "";
    ws.getCell(`I${rowIdx}`).value = r.acc || "";
    ws.getCell(`J${rowIdx}`).value = r.sub_acc || "";
    ws.getCell(`K${rowIdx}`).value = r.debit != null ? Number(r.debit) : "";
    ws.getCell(`L${rowIdx}`).value = r.credit != null ? Number(r.credit) : "";
    ws.getCell(`M${rowIdx}`).value = r.adi_period || "";
    ws.getCell(`N${rowIdx}`).value = r.batch_name || "";
    ws.getCell(`O${rowIdx}`).value = r.batch_description || "";
    ws.getCell(`P${rowIdx}`).value = r.journal_name || "";
    ws.getCell(`Q${rowIdx}`).value = r.journal_description || "";
    ws.getCell(`R${rowIdx}`).value = r.line_description || "";
    ws.getCell(`S${rowIdx}`).value = r.line_dff || "";
  });

  ws.getCell("X2").value = meta.folderPath || "";
  ws.getCell("X7").value = meta.book || meta.bu || ""; // MARKER_VATEXPORTGEN_BUBOOK_J4_V1

  return stripFilterPrivacy(await wb.xlsx.writeBuffer());
}