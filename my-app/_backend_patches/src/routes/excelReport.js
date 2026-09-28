import { Router } from "express";
import { pool, getUsernameByEmail } from "../db.js";
import ExcelJS from "exceljs";

const router = Router();

// ── สีและ Style มาตรฐาน APN01 ──────────────────────────────────────────────
const HEADER_BG   = "FF1A3A5C";   // #1a3a5c
const HEADER_FONT = "FFFFFFFF";   // white
const TOTAL_BG    = "FFE8F0FB";   // ฟ้าอ่อน
const BORDER_CLR  = "FFD0D0D0";   // เทาอ่อน

const thinBorder = {
  top:    { style: "thin", color: { argb: BORDER_CLR } },
  left:   { style: "thin", color: { argb: BORDER_CLR } },
  bottom: { style: "thin", color: { argb: BORDER_CLR } },
  right:  { style: "thin", color: { argb: BORDER_CLR } },
};

const mediumBorder = {
  top:    { style: "medium", color: { argb: "FF1A3A5C" } },
  left:   { style: "thin",   color: { argb: BORDER_CLR } },
  bottom: { style: "thin",   color: { argb: BORDER_CLR } },
  right:  { style: "thin",   color: { argb: BORDER_CLR } },
};

// ── Format วันที่ → DD-Mon-YY ────────────────────────────────────────────────
function fmtDate(val) {
  if (!val) return "";
  const d = new Date(val);
  if (isNaN(d)) return String(val);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const yy = String(d.getFullYear()).slice(-2);
  return `${String(d.getDate()).padStart(2,"0")}-${months[d.getMonth()]}-${yy}`;
}

// ── Column definitions per docType ─────────────────────────────────────────
const DOC_CONFIG = {
  APN01: {
    sheetName: "Report APN01",
    row4Label: "Receive Date",
    getRow4: (file) => fmtDate(file.file_date || ""),
    cols: [
      { key: "Branch",              width: 12  },
      { key: "Vendor Name",         width: 32  },
      { key: "GR Transaction No.",  width: 22  },
      { key: "Invoice Number",      width: 24  },
      { key: "Receive Date",        width: null },
      { key: "รายการ",              width: 60  },
      { key: "มูลค่าก่อนภาษี",     width: 18  },
      { key: "มูลค่าภาษี",         width: 15  },
      { key: "มูลค่ารวม",          width: 18  },
      { key: "Batch Name",          width: 36  },
      { key: "Payment Doc",         width: 16  },
    ],
    numCols: ["มูลค่าก่อนภาษี","มูลค่าภาษี","มูลค่ารวม"],
    dateCols: ["Receive Date"],
    textCols: ["Invoice Number","GR Transaction No."],
    totalMergeCols: 6,  // merge A-F
    computeRow: null,   // ใช้ row ตรงๆ
  },
  AP07: {
    sheetName: "Report AP07",
    row4Label: "ที่อยู่",
    getRow4: (file) => file.bu_address || "",
    cols: [
      { key: "Branch",            width: 12  },
      { key: "Vendor Name",       width: 32  },
      { key: "Receive Date",      width: null },
      { key: "GRT No.",           width: 16  },
      { key: "Tax Invoice Date",  width: null },
      { key: "Tax Invoice No.",   width: 20  },
      { key: "Description",       width: 52  },
      { key: "ยอดก่อนภาษี",      width: 16  },
      { key: "ยอดภาษี",          width: 14  },
      { key: "ยอดรวม",           width: 16  },
    ],
    numCols: ["ยอดก่อนภาษี","ยอดภาษี","ยอดรวม"],
    dateCols: ["Receive Date","Tax Invoice Date"],
    textCols: ["GRT No.","Tax Invoice No."],
    totalMergeCols: 7,  // merge A-G
    computeRow: (row) => {
      // คำนวณ VAT จาก Invoice Amount (รวม VAT แล้ว)
      const amt = parseFloat(String(
        row['Invoice Amount'] || row['มูลค่ารวม'] || row['ยอดรวม'] || 0
      ).replace(/,/g,"")) || 0;
      const gross = Math.round(amt * 100 / 107 * 100) / 100;
      const vat   = Math.round(amt * 7   / 107 * 100) / 100;
      return {
        "Branch":           row['Branch'] || row['[ ]']?.split('.')?.[1] || "",
        "Vendor Name":      row['Vendor Name'] || row['Supplier'] || "",
        "Receive Date":     row['Receive Date'] || row['Invoice Date'] || "",
        "GRT No.":          row['GR Transaction No.'] || row['GRT No.'] || row['[ ]'] || "",
        "Tax Invoice Date": row['Invoice Date'] || row['Receive Date'] || "",
        "Tax Invoice No.":  row['Invoice Number'] || row['Invoice Num'] || "",
        "Description":      row['รายการ'] || row['Description'] || row['Desctiption'] || "",
        "ยอดก่อนภาษี":     gross,
        "ยอดภาษี":         vat,
        "ยอดรวม":          amt,
      };
    },
  },
};
DOC_CONFIG.AP09 = { ...DOC_CONFIG.AP07, sheetName: "Report AP09", computeRow: null };

// ── POST /api/excel/download — Generate Excel APN01/AP07/AP09 format ────────
router.post("/download", async (req, res) => {
  try {
    const { file, rows } = req.body;
    if (!file || !Array.isArray(rows)) {
      return res.status(400).json({ error: "file และ rows จำเป็น" });
    }

    const docType    = file.doc_type     || "APN01";
    const cfg        = DOC_CONFIG[docType] || DOC_CONFIG.APN01;
    const buCode     = file.bu_code_name || file.bu_code || "";
    const serialCode = file.serial_code  || "Invoice_Register";

    // ── ดึงชื่อผู้ประกอบการและที่อยู่จาก company_list ────────────────────
    let buName    = file.bu_name || "";
    let buAddress = "";
    try {
      const { rows: buRows } = await pool.query(
        `SELECT bu_name_full, address FROM company_list WHERE bu = $1 LIMIT 1`,
        [file.bu_code]
      );
      if (buRows[0]?.bu_name_full) buName    = buRows[0].bu_name_full;
      if (buRows[0]?.address)      buAddress = buRows[0].address;
    } catch (_) {}
    file.bu_address = buAddress;

    const COLS    = cfg.cols.map(c => c.key);
    const NUM_COLS = cfg.numCols;

    const wb = new ExcelJS.Workbook();
    wb.creator  = "FASTAPN";
    wb.created  = new Date();
    wb.modified = new Date();

    const ws = wb.addWorksheet(cfg.sheetName, {
      pageSetup: {
        paperSize:    9,          // A4
        orientation:  "landscape",
        fitToPage:    true,
        fitToWidth:   1,
        fitToHeight:  0,
        printTitlesRow: "1:7",
      },
      views: [{ state: "frozen", ySplit: 7, xSplit: 0, topLeftCell: "A8", activePane: "bottomLeft" }],
    });

    // Narrow margins
    ws.pageSetup.margins = { left: 0.25, right: 0.25, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 };

    // ── Column widths จาก config ─────────────────────────────────────────
    ws.columns = cfg.cols;
    const NUM_FMT = '#,##0.00';

    // ── Helper: apply border ทุก cell ในแถว ──────────────────────────────
    function applyBorderRow(row, borderStyle) {
      row.eachCell({ includeEmpty: true }, cell => { cell.border = borderStyle; });
    }

    // ── Row 1: DOC TYPE ────────────────────────────────────────────────────
    ws.getRow(1).height = 16;
    ws.getCell("A1").value = "DOC TYPE";
    ws.getCell("A1").font  = { name: "Arial", size: 11, bold: true };
    ws.getCell("B1").value = docType;
    ws.getCell("B1").font  = { name: "Arial", size: 11, bold: true };

    // ── Row 2: BU CODE ────────────────────────────────────────────────────
    ws.getRow(2).height = 16;
    ws.getCell("A2").value = "BU CODE";
    ws.getCell("A2").font  = { name: "Arial", size: 11, bold: true };
    ws.getCell("B2").value = buCode;
    ws.getCell("B2").font  = { name: "Arial", size: 11, bold: true };

    // ── Row 3: ชื่อผู้ประกอบการ ──────────────────────────────────────────
    ws.getRow(3).height = 16;
    ws.getCell("A3").value = "ชื่อผู้ประกอบการ";
    ws.getCell("A3").font  = { name: "Arial", size: 11, bold: true };
    ws.getCell("B3").value = buName;
    ws.getCell("B3").font  = { name: "Arial", size: 11, bold: true };

    // ── Row 4: Receive Date หรือ ที่อยู่ ตาม docType ───────────────────────
    ws.getRow(4).height = 16;
    ws.getCell("A4").value = cfg.row4Label;
    ws.getCell("A4").font  = { name: "Arial", size: 11, bold: true };
    ws.getCell("B4").value = cfg.getRow4(file);
    ws.getCell("B4").font  = { name: "Arial", size: 11, bold: true };

    // MARKER_EXCELREPORT_SERIALCODE_E4F4_V1 -- E4 label "Serial Code" ชิดขวา, F4 = ค่า Serial Code จริง
    ws.getCell("E4").value = "Serial Code";
    ws.getCell("E4").font  = { name: "Arial", size: 11, bold: true };
    ws.getCell("E4").alignment = { horizontal: "right" };
    ws.getCell("F4").value = serialCode;
    ws.getCell("F4").font  = { name: "Arial", size: 11, bold: true };

    // ── Row 5-6: ว่าง ─────────────────────────────────────────────────────
    ws.getRow(5).height = 8;
    ws.getRow(6).height = 8;

    // ── Row 7: Table Header ───────────────────────────────────────────────
    const headerRow = ws.getRow(7);
    headerRow.height = 20;
    COLS.forEach((col, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value     = col;
      cell.font      = { name: "Arial", size: 11, bold: true, color: { argb: HEADER_FONT } };
      cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
      cell.alignment = { vertical: "middle", horizontal: NUM_COLS.includes(col) ? "right" : "left", wrapText: false };
      cell.border    = {
        top:    { style: "medium", color: { argb: HEADER_BG } },
        left:   { style: "thin",   color: { argb: "FF2A5A8C" } },
        bottom: { style: "medium", color: { argb: HEADER_BG } },
        right:  { style: "thin",   color: { argb: "FF2A5A8C" } },
      };
    });

    // ── Rows 8+: Data ─────────────────────────────────────────────────────
    rows.forEach((row, ri) => {
      const dataRow  = ws.getRow(ri + 8);
      const mappedRow = cfg.computeRow ? cfg.computeRow(row) : row;
      dataRow.height = 18;
      const WRAP_COLS = ['รายการ', 'Description', 'Batch Name'];
      let rowNeedsWrap = false;
      COLS.forEach((col, ci) => {
        const cell = dataRow.getCell(ci + 1);
        const needWrap = WRAP_COLS.includes(col);
        if (NUM_COLS.includes(col)) {
          const raw = typeof mappedRow[col] === 'number'
            ? mappedRow[col]
            : parseFloat(String(mappedRow[col] || "0").replace(/,/g, ""));
          cell.value     = isNaN(raw) ? 0 : raw;
          cell.numFmt    = NUM_FMT;
          cell.alignment = { horizontal: "right", vertical: "middle", wrapText: false };
        } else if (cfg.dateCols?.includes(col)) {
          cell.value     = fmtDate(mappedRow[col]);
          cell.numFmt    = "@";
          cell.alignment = { horizontal: "left", vertical: "middle", wrapText: false };
        } else if (cfg.textCols?.includes(col)) {
          cell.value     = String(mappedRow[col] || "");
          cell.numFmt    = "@";
          cell.dataType  = 'string';
          cell.alignment = { horizontal: "left", vertical: "middle", wrapText: needWrap };
        } else {
          cell.value     = mappedRow[col] || "";
          cell.alignment = { horizontal: "left", vertical: "middle", wrapText: needWrap };
        }
        if (needWrap && String(mappedRow[col] || '').length > 40) rowNeedsWrap = true;
        cell.font   = { name: "Arial", size: 11, bold: true };
        cell.fill   = ri % 2 === 0
          ? { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } }
          : { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F8FF" } };
        cell.border = thinBorder;
      });
      // max 2 บรรทัด ≈ height 30, ปกติ 18
      dataRow.height = rowNeedsWrap ? 30 : 18;
    });

    // ── Total Row ──────────────────────────────────────────────────────────
    const totalRowIdx = rows.length + 8;
    const totalRow    = ws.getRow(totalRowIdx);
    totalRow.height   = 18;

    const totalCell = totalRow.getCell(1);
    totalCell.value     = "ยอดรวมทั้งหมด";
    totalCell.font      = { name: "Arial", size: 11, bold: true };
    totalCell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
    totalCell.alignment = { horizontal: "left", vertical: "middle" };
    totalCell.border    = mediumBorder;

    // merge A-F ในแถว total
    const mergeTo = String.fromCharCode(64 + cfg.totalMergeCols); // F=70=64+6
    ws.mergeCells(`A${totalRowIdx}:${mergeTo}${totalRowIdx}`);

    NUM_COLS.forEach(col => {
      const ci        = COLS.indexOf(col) + 1;
      const cell      = totalRow.getCell(ci);
      const colLetter = ws.getColumn(ci).letter;
      cell.value     = { formula: `SUM(${colLetter}8:${colLetter}${totalRowIdx - 1})` };
      cell.numFmt    = NUM_FMT;
      cell.font      = { name: "Arial", size: 11, bold: true };
      cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
      cell.alignment = { horizontal: "right", vertical: "middle" };
      cell.border    = mediumBorder;
    });

    // cell ที่เหลือใน total row (ที่ไม่ใช่ merge และไม่ใช่ num)
    const numColIdxs = new Set(NUM_COLS.map(c => COLS.indexOf(c) + 1));
    Array.from({length: COLS.length}, (_, i) => i + 1)
      .filter(ci => ci > 1 && !numColIdxs.has(ci))
      .forEach(ci => {
      const cell  = totalRow.getCell(ci);
      cell.fill   = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
      cell.border = mediumBorder;
    });

    // ── Autofit date columns (Receive Date, Tax Invoice Date) ────────────
    cfg.dateCols?.forEach(dateCol => {
      const dcIdx = COLS.indexOf(dateCol) + 1;
      if (dcIdx > 0) {
        const maxLen = rows.reduce((mx, row) => {
          const v = String((cfg.computeRow ? cfg.computeRow(row) : row)[dateCol] || '');
          return Math.max(mx, v.length);
        }, dateCol.length);
        ws.getColumn(dcIdx).width = Math.min(maxLen + 2, 16);
      }
    });

    // ── Column A fixed width 14 ───────────────────────────────────────────
    ws.getColumn(1).width = 14;

    // ── Autofit Vendor Name column ───────────────────────────────────────
    const vendorColIdx = COLS.indexOf('Vendor Name') + 1;
    if (vendorColIdx > 0) {
      const maxLen = rows.reduce((max, row) => {
        const mappedRow = cfg.computeRow ? cfg.computeRow(row) : row;
        const val = String(mappedRow['Vendor Name'] || '');
        // ภาษาไทย 1 char ≈ 1.8 unit, ภาษาอังกฤษ 1 char ≈ 1 unit
        const len = [...val].reduce((s, c) => s + (c.charCodeAt(0) > 127 ? 1.8 : 1), 0);
        return Math.max(max, len);
      }, 'Vendor Name'.length);
      ws.getColumn(vendorColIdx).width = Math.min(Math.max(maxLen + 2, 16), 45);
    }

    // ── Log activity ──────────────────────────────────────────────────────
    try {
      const username = await getUsernameByEmail(req.user?.email);
      await pool.query(
        `INSERT INTO activity_log (username, module, action, detail, created_at)
         VALUES ($1, 'DOCUMENT_CENTER', 'DOWNLOAD_EXCEL', $2, NOW())`,
        [username, JSON.stringify({ serial_code: serialCode, doc_type: docType, rows: rows.length })]
      );
    } catch (_) {}

    // ── Sheet 2: AP09 (ถ้า doc_type = APN01 และมี ap09Rows) ───────────────
    const ap09Rows = req.body.ap09Rows;
    if (file.doc_type === 'APN01' && Array.isArray(ap09Rows) && ap09Rows.length > 0) {
      const cfgAP09  = DOC_CONFIG.AP09;
      const COLS09   = cfgAP09.cols.map(c => c.key);
      const NUM09    = cfgAP09.numCols;
      const ws09 = wb.addWorksheet('Report AP09', {
        pageSetup: { paperSize:9, orientation:'landscape', fitToPage:true, fitToWidth:1, fitToHeight:0 },
        views: [{ state:'frozen', ySplit:7, xSplit:0, topLeftCell:'A8', activePane:'bottomLeft' }],
      });
      ws09.pageSetup.margins = { left:0.25, right:0.25, top:0.75, bottom:0.75, header:0.3, footer:0.3 };
      ws09.columns = cfgAP09.cols;

      // Header rows
      [[1,'DOC TYPE','AP09'],[2,'BU CODE',buCode],[3,'ชื่อผู้ประกอบการ',buName],[4,'ที่อยู่',buAddress||'']].forEach(([r,a,b])=>{
        ws09.getRow(r).height = 16;
        ws09.getCell(`A${r}`).value = a; ws09.getCell(`A${r}`).font = {name:'Arial',size:11,bold:true};
        ws09.getCell(`B${r}`).value = b; ws09.getCell(`B${r}`).font = {name:'Arial',size:11,bold:true};
      });

      // MARKER_EXCELREPORT_SERIALCODE_E4F4_AP09_V1 -- E4 label "Serial Code" ชิดขวา, F4 = Serial Code (แปลง APN01->AP09 ตาม pattern เดิม)
      ws09.getCell('E4').value = 'Serial Code';
      ws09.getCell('E4').font  = { name: 'Arial', size: 11, bold: true };
      ws09.getCell('E4').alignment = { horizontal: 'right' };
      ws09.getCell('F4').value = serialCode.replace('APN01','AP09').replace('Invoice Register','Input Tax Invoice');
      ws09.getCell('F4').font  = { name: 'Arial', size: 11, bold: true };
      ws09.getRow(5).height = 8; ws09.getRow(6).height = 8;

      // Table header
      const hdr09 = ws09.getRow(7); hdr09.height = 20;
      COLS09.forEach((col,i) => {
        const cell = hdr09.getCell(i+1);
        cell.value = col;
        cell.font  = {name:'Arial',size:11,bold:true,color:{argb:HEADER_FONT}};
        cell.fill  = {type:'pattern',pattern:'solid',fgColor:{argb:HEADER_BG}};
        cell.alignment = {vertical:'middle',horizontal:NUM09.includes(col)?'right':'left'};
        cell.border = {top:{style:'medium',color:{argb:HEADER_BG}},left:{style:'thin',color:{argb:'FF2A5A8C'}},bottom:{style:'medium',color:{argb:HEADER_BG}},right:{style:'thin',color:{argb:'FF2A5A8C'}}};
      });

      // Data rows
      ap09Rows.forEach((row, ri) => {
        const dr = ws09.getRow(ri+8); dr.height = 18;
        COLS09.forEach((col,ci) => {
          const cell = dr.getCell(ci+1);
          if (NUM09.includes(col)) {
            const raw = typeof row[col]==='number' ? row[col] : parseFloat(String(row[col]||'0').replace(/,/g,''));
            cell.value = isNaN(raw)?0:raw; cell.numFmt = NUM_FMT;
            cell.alignment = {horizontal:'right',vertical:'middle'};
          } else if (cfgAP09.dateCols?.includes(col)) {
            cell.value = fmtDate(row[col]); cell.numFmt = '@';
            cell.alignment = {horizontal:'left',vertical:'middle'};
          } else if (cfgAP09.textCols?.includes(col)) {
            cell.value = String(row[col]||''); cell.numFmt = '@';
            cell.alignment = {horizontal:'left',vertical:'middle'};
          } else {
            cell.value = row[col]||''; cell.alignment = {horizontal:'left',vertical:'middle'};
          }
          cell.font   = {name:'Arial',size:11,bold:true};
          cell.fill   = ri%2===0 ? {type:'pattern',pattern:'solid',fgColor:{argb:'FFFFFFFF'}} : {type:'pattern',pattern:'solid',fgColor:{argb:'FFF5F8FF'}};
          cell.border = thinBorder;
        });
      });

      // Total row AP09
      const tot09Idx = ap09Rows.length + 8;
      const tot09 = ws09.getRow(tot09Idx); tot09.height = 18;
      const totCell09 = tot09.getCell(1);
      totCell09.value = 'ยอดรวมทั้งหมด'; totCell09.font = {name:'Arial',size:11,bold:true};
      totCell09.fill = {type:'pattern',pattern:'solid',fgColor:{argb:TOTAL_BG}};
      totCell09.border = mediumBorder;
      const mergeTo09 = String.fromCharCode(64 + cfgAP09.totalMergeCols);
      ws09.mergeCells(`A${tot09Idx}:${mergeTo09}${tot09Idx}`);
      NUM09.forEach(col => {
        const ci = COLS09.indexOf(col)+1;
        const cl = ws09.getColumn(ci).letter;
        const cell = tot09.getCell(ci);
        cell.value = {formula:`SUM(${cl}8:${cl}${tot09Idx-1})`}; cell.numFmt = NUM_FMT;
        cell.font = {name:'Arial',size:11,bold:true}; cell.fill = {type:'pattern',pattern:'solid',fgColor:{argb:TOTAL_BG}};
        cell.alignment = {horizontal:'right',vertical:'middle'}; cell.border = mediumBorder;
      });
      const numIdxs09 = new Set(NUM09.map(c=>COLS09.indexOf(c)+1));
      Array.from({length:COLS09.length},(_,i)=>i+1).filter(ci=>ci>1&&!numIdxs09.has(ci)).forEach(ci=>{
        tot09.getCell(ci).fill = {type:'pattern',pattern:'solid',fgColor:{argb:TOTAL_BG}};
        tot09.getCell(ci).border = mediumBorder;
      });
      ws09.getColumn(1).width = 14;

      // ── Autofit Vendor Name column AP09 ──────────────────────────────
      const vendorColIdx09 = COLS09.indexOf('Vendor Name') + 1;
      if (vendorColIdx09 > 0) {
        const maxLen09 = ap09Rows.reduce((max, row) => {
          const val = String(row['Vendor Name'] || '');
          const len = [...val].reduce((s, c) => s + (c.charCodeAt(0) > 127 ? 1.8 : 1), 0);
          return Math.max(max, len);
        }, 'Vendor Name'.length);
        ws09.getColumn(vendorColIdx09).width = Math.min(Math.max(maxLen09 + 2, 16), 45);
      }
    }

    // ── ส่งไฟล์กลับ ──────────────────────────────────────────────────────
    const filename = `${serialCode}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);

    const buffer = await wb.xlsx.writeBuffer();
    res.send(buffer);

  } catch (err) {
    console.error("POST /excel/download error:", err.message);
    res.status(500).json({ error: "Generate Excel ไม่สำเร็จ" });
  }
});

export default router;