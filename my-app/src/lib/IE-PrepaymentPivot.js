// IE-PrepaymentPivot.js
// MARKER_IE_PREPAYMENT_PIVOT_V1
// ─────────────────────────────────────────────────────────────────────────
// เติมชีต "Pivot" (Pivot Table จริงของ Excel + Slicer "Status") ให้ไฟล์ Prepayment Aging
// ExcelJS สร้าง Pivot/Slicer ไม่ได้ จึงทำ 2 ขั้น:
//   1) preparePrepaymentPivot()  : เขียนหัวรายงาน + ตารางสรุปแบบ Static ลงชีต Pivot ผ่าน ExcelJS
//                                  (ให้เห็นผลทันทีแม้เปิดใน Protected View / โปรแกรมที่ไม่รองรับ Pivot)
//   2) injectPrepaymentPivot()   : แกะ .xlsx (JSZip) แล้วเติมส่วนของ Pivot Cache / Pivot Table / Slicer
//                                  โครงสร้างเลียนแบบไฟล์ตัวอย่าง (Pivot ที่ทำมือใน Excel) ทุกอย่าง
//                                  ตั้ง refreshOnLoad="1" -> Excel คำนวณ Pivot ใหม่เองตอนเปิดไฟล์
// Pivot: Row = Branch Name > InvoiceType > Supplier Name > InvoiceDate > Invoice Number > Description
//        Column = Status ; Value = Sum of AmountRemaining ; Slicer = Status
// ─────────────────────────────────────────────────────────────────────────
import JSZip from 'jszip';

export const PIVOT_SHEET_NAME = 'Pivot';
export const DATA_SHEET_NAME = 'Prepayment Aging';

const PIVOT_ZOOM = 55;                    // Zoom เริ่มต้นของชีต Pivot (%)
const PIVOT_FREEZE_ROW = 25;              // Freeze Panes ที่แถว 25 (ตรึงแถวด้านบนทั้งหมดก่อนแถวนี้)
const PIVOT_TOP_ROW = 23;                 // ตาราง Pivot เริ่มที่ A23 (เหมือนไฟล์ตัวอย่าง) แถวบนไว้ใส่หัวรายงาน + Slicer
const ROW_FIELDS = ['Branch Name', 'InvoiceType', 'Supplier Name', 'InvoiceDate', 'Invoice Number', 'Description'];
const COL_FIELD = 'Status';
const DATA_FIELD = 'AmountRemaining';
const SHARED_FIELDS = ['Branch Code', 'Supplier Name', 'InvoiceType', 'Invoice Number', 'InvoiceDate', 'Description', 'Branch Name', 'Category', 'Status'];
const AMOUNT_FIELDS = ['InvoiceAmount', 'WithheldAmount', 'AmountRemaining'];
const MAX_STR = 255;                      // ข้อความใน Pivot Cache ยาวสุด 255 ตัวอักษร

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_X14 = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PIVOT_CACHE_ID_X14 = 1100786764;    // รหัสเชื่อม Pivot Cache <-> Slicer (ค่าใดก็ได้ แต่ต้องตรงกัน 2 จุด)

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const cut = (s) => String(s).slice(0, MAX_STR);
const isDate = (v) => v instanceof Date && !Number.isNaN(v.getTime());
const isoDate = (d) => d.toISOString().slice(0, 19);
const pad2 = (n) => String(n).padStart(2, '0');
const fmtDMY = (d) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function colLetter(n) { // 1 -> A
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// ── แปลง Matrix (แถวละ Array ตามลำดับ headers) เป็น Object ต่อแถว ──────────
function toRecords(headers, matrix) {
  return matrix.map(arr => {
    const o = {};
    headers.forEach((h, i) => { o[h] = arr[i]; });
    return o;
  });
}

// ── ชนิดของแต่ละคอลัมน์ + Shared Items (เรียงตามลำดับที่เจอก่อนหลัง) ────────
function analyzeColumns(headers, recs) {
  return headers.map(h => {
    const vals = recs.map(r => r[h]);
    let kind = 'string';
    const nonNull = vals.filter(v => v !== null && v !== undefined && v !== '');
    if (nonNull.length && nonNull.every(isDate)) kind = 'date';
    else if (nonNull.length && nonNull.every(v => typeof v === 'number')) kind = 'number';
    const shared = SHARED_FIELDS.includes(h);
    const items = []; const index = new Map();
    if (shared) {
      vals.forEach(v => {
        const key = kind === 'date' ? (isDate(v) ? isoDate(v) : '') : cut(v ?? '');
        if (!index.has(key)) { index.set(key, items.length); items.push(key); }
      });
    }
    const nums = nonNull.filter(v => typeof v === 'number');
    const dates = nonNull.filter(isDate).map(d => d.getTime());
    return {
      name: h, kind, shared, items, index,
      allInt: nums.length > 0 && nums.every(Number.isInteger),
      min: nums.length ? Math.min(...nums) : 0, max: nums.length ? Math.max(...nums) : 0,
      minDate: dates.length ? isoDate(new Date(Math.min(...dates))) : '', maxDate: dates.length ? isoDate(new Date(Math.max(...dates))) : '',
      numFmtId: kind === 'date' ? 15 : (AMOUNT_FIELDS.includes(h) ? 4 : 0),
    };
  });
}

// ── Pivot Cache Definition / Records ────────────────────────────────────
function buildCacheDefinition(cols, n) {
  const fields = cols.map(c => {
    let si;
    if (c.kind === 'string') {
      si = c.shared ? `<sharedItems count="${c.items.length}">${c.items.map(v => `<s v="${esc(v)}"/>`).join('')}</sharedItems>` : '<sharedItems/>';
    } else if (c.kind === 'number') {
      si = `<sharedItems containsSemiMixedTypes="0" containsString="0" containsNumber="1"${c.allInt ? ' containsInteger="1"' : ''} minValue="${c.min}" maxValue="${c.max}"/>`;
    } else { // date
      const attr = `containsSemiMixedTypes="0" containsNonDate="0" containsDate="1" containsString="0" minDate="${c.minDate}" maxDate="${c.maxDate}"`;
      si = c.shared ? `<sharedItems ${attr} count="${c.items.length}">${c.items.map(v => `<d v="${v}"/>`).join('')}</sharedItems>` : `<sharedItems ${attr}/>`;
    }
    return `<cacheField name="${esc(c.name)}" numFmtId="${c.numFmtId}">${si}</cacheField>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
    + `<pivotCacheDefinition xmlns="${NS_MAIN}" xmlns:r="${NS_R}" r:id="rId1" refreshOnLoad="1" refreshedBy="FastAPN" refreshedDate="${(Date.now() / 86400000 + 25569).toFixed(6)}" createdVersion="6" refreshedVersion="6" minRefreshableVersion="3" recordCount="${n}">`
    + `<cacheSource type="worksheet"><worksheetSource ref="A1:${colLetter(cols.length)}${n + 1}" sheet="${DATA_SHEET_NAME}"/></cacheSource>`
    + `<cacheFields count="${cols.length}">${fields}</cacheFields>`
    + `<extLst><ext uri="{725AE2AE-9491-48be-B2B4-4EB974FC3084}" xmlns:x14="${NS_X14}"><x14:pivotCacheDefinition pivotCacheId="${PIVOT_CACHE_ID_X14}"/></ext></extLst>`
    + `</pivotCacheDefinition>`;
}

function buildCacheRecords(cols, recs) {
  const body = recs.map(r => '<r>' + cols.map(c => {
    const v = r[c.name];
    if (c.shared) {
      const key = c.kind === 'date' ? (isDate(v) ? isoDate(v) : '') : cut(v ?? '');
      return `<x v="${c.index.get(key)}"/>`;
    }
    if (c.kind === 'number') return `<n v="${typeof v === 'number' ? v : 0}"/>`;
    if (c.kind === 'date') return isDate(v) ? `<d v="${isoDate(v)}"/>` : '<m/>';
    return `<s v="${esc(cut(v ?? ''))}"/>`;
  }).join('') + '</r>').join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotCacheRecords xmlns="${NS_MAIN}" xmlns:r="${NS_R}" count="${recs.length}">${body}</pivotCacheRecords>`;
}

// ── ลำดับ Item ที่แสดงใน Pivot (เรียงน้อย -> มาก) ───────────────────────
function displayOrder(c) { // คืน Array ของ Index ใน Shared Items เรียงตามการแสดงผล
  const idx = c.items.map((_, i) => i);
  if (c.kind === 'date') return idx.sort((a, b) => cmp(c.items[a], c.items[b]));
  return idx.sort((a, b) => cmp(String(c.items[a]).toLowerCase(), String(c.items[b]).toLowerCase()) || cmp(c.items[a], c.items[b]));
}

function buildPivotTable(cols, lastRow) {
  const nameIdx = (n) => cols.findIndex(c => c.name === n);
  const rowIdx = ROW_FIELDS.map(nameIdx);
  const colIdx = nameIdx(COL_FIELD);
  const dataIdx = nameIdx(DATA_FIELD);
  const statusCount = cols[colIdx].items.length;
  const lastCol = colLetter(6 + statusCount + 1);

  const pf = cols.map((c, i) => {
    const isRow = rowIdx.includes(i), isCol = i === colIdx, isData = i === dataIdx;
    const attrs = [];
    if (isRow) attrs.push('axis="axisRow"'); else if (isCol) attrs.push('axis="axisCol"');
    if (isData) attrs.push('dataField="1"');
    attrs.push('compact="0"');
    if (c.numFmtId) attrs.push(`numFmtId="${c.numFmtId}"`);
    attrs.push('outline="0"', 'showAll="0"');
    const subtotal = !(isRow && ROW_FIELDS[0] !== c.name) ? true : false; // เฉพาะ Branch Name มี Subtotal
    if (isRow && !subtotal) attrs.push('defaultSubtotal="0"');
    if (!c.shared) return `<pivotField ${attrs.join(' ')}/>`;
    const withDefault = !(isRow && !subtotal);
    const items = displayOrder(c).map(k => `<item x="${k}"/>`).join('') + (withDefault ? '<item t="default"/>' : '');
    return `<pivotField ${attrs.join(' ')}><items count="${c.items.length + (withDefault ? 1 : 0)}">${items}</items></pivotField>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
    + `<pivotTableDefinition xmlns="${NS_MAIN}" name="PivotTable1" cacheId="1" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="1" dataCaption="Values" updatedVersion="6" minRefreshableVersion="3" useAutoFormatting="1" itemPrintTitles="1" createdVersion="6" indent="0" compact="0" compactData="0" multipleFieldFilters="0">`
    + `<location ref="A${PIVOT_TOP_ROW}:${lastCol}${lastRow}" firstHeaderRow="1" firstDataRow="2" firstDataCol="6"/>`
    + `<pivotFields count="${cols.length}">${pf}</pivotFields>`
    + `<rowFields count="${rowIdx.length}">${rowIdx.map(i => `<field x="${i}"/>`).join('')}</rowFields>`
    + `<colFields count="1"><field x="${colIdx}"/></colFields>`
    + `<dataFields count="1"><dataField name="Sum of ${DATA_FIELD}" fld="${dataIdx}" baseField="0" baseItem="0" numFmtId="4"/></dataFields>`
    + `<pivotTableStyleInfo name="PivotStyleMedium9" showRowHeaders="1" showColHeaders="1" showRowStripes="0" showColStripes="0" showLastColumn="1"/>`
    + `<extLst><ext uri="{962EF5D1-5CA2-4c93-8EF4-DBF5C05439D2}" xmlns:x14="${NS_X14}"><x14:pivotTableDefinition hideValuesRow="1" xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main"/></ext></extLst>`
    + `</pivotTableDefinition>`;
}

function buildSlicerCache(cols, pivotTabId) {
  const c = cols.find(x => x.name === COL_FIELD);
  const items = displayOrder(c).map(k => `<i x="${k}" s="1"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
    + `<slicerCacheDefinition xmlns="${NS_X14}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x" xmlns:x="${NS_MAIN}" name="Slicer_Status" sourceName="Status">`
    + `<pivotTables><pivotTable tabId="${pivotTabId}" name="PivotTable1"/></pivotTables>`
    + `<data><tabular pivotCacheId="${PIVOT_CACHE_ID_X14}"><items count="${c.items.length}">${items}</items></tabular></data></slicerCacheDefinition>`;
}

const SLICER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
  + `<slicers xmlns="${NS_X14}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x" xmlns:x="${NS_MAIN}">`
  + `<slicer name="Status" cache="Slicer_Status" caption="Status" columnCount="3" rowHeight="251883"/></slicers>`;

// MARKER_IE_PIVOT_SLICER_TOP_V1 -- Slicer วางด้านบนขวา: เริ่มกลางคอลัมน์ E ไปถึงเกือบสุดคอลัมน์ F (Description) แถว 1-10 -- อยู่ในส่วนที่ตรึง (Freeze) จึงเห็นตลอดเวลา
// (เดิมวางที่ A5:C12 ใต้หัวรายงาน)
const DRAWING_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
  + `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">`
  + `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>4</xdr:col><xdr:colOff>609600</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>`
  + `<xdr:to><xdr:col>5</xdr:col><xdr:colOff>6172200</xdr:colOff><xdr:row>10</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>`
  + `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" Requires="a14">`
  + `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Status"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>`
  + `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/drawing/2010/slicer">`
  + `<sle:slicer xmlns:sle="http://schemas.microsoft.com/office/drawing/2010/slicer" name="Status"/></a:graphicData></a:graphic></xdr:graphicFrame></mc:Choice>`
  + `<mc:Fallback><xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="0" name=""/><xdr:cNvSpPr><a:spLocks noTextEdit="1"/></xdr:cNvSpPr></xdr:nvSpPr>`
  + `<xdr:spPr><a:xfrm><a:off x="0" y="744103"/><a:ext cx="4953001" cy="1334077"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:prstClr val="white"/></a:solidFill><a:ln w="1"><a:solidFill><a:prstClr val="green"/></a:solidFill></a:ln></xdr:spPr>`
  + `<xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip"/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1100"/><a:t>Slicer (Excel 2010 or later)</a:t></a:r></a:p></xdr:txBody></xdr:sp></mc:Fallback></mc:AlternateContent><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`;

// ─────────────────────────────────────────────────────────────────────────
// ขั้นที่ 1: เขียนชีต Pivot (หัวรายงาน + ตารางสรุป Static) ด้วย ExcelJS
// headers = ชื่อคอลัมน์ชีต Prepayment Aging, matrix = แถวข้อมูล (Date เป็น Date Object)
// คืน null ถ้าไม่มีข้อมูล (ไม่สร้าง Pivot)
// ─────────────────────────────────────────────────────────────────────────
export function preparePrepaymentPivot(wsPivot, headers, matrix, opts = {}) {
  const reportDate = opts.reportDate || new Date();
  const bu = opts.bu || '';
  if (!matrix || !matrix.length) return null;
  const recs = toRecords(headers, matrix);

  // ── หัวรายงาน (เหมือนไฟล์ Vat): ช่วงวันที่ทำจ่าย Min-Max + วันที่จัดทำรายงาน ──
  const dates = recs.map(r => r.InvoiceDate).filter(isDate).map(d => d.getTime());
  const minD = dates.length ? new Date(Math.min(...dates)) : null;
  const maxD = dates.length ? new Date(Math.max(...dates)) : null;
  const range = minD ? `${fmtDMY(minD)} - ${fmtDMY(maxD)}` : '-';
  // รูปแบบเดียวกับหัวรายงานไฟล์ Vat: บรรทัด 1 ชื่อรายงาน (ตัวหนา) / 2 รายละเอียด (สีเทา) / 3 หมายเหตุ (ตัวเอียง)
  const buTxt = bu && bu !== 'UnknownBU' ? ` — ${bu}` : '';
  const stamp = `${fmtDMY(reportDate)}, ${pad2(reportDate.getHours())}:${pad2(reportDate.getMinutes())}:${pad2(reportDate.getSeconds())}`;
  wsPivot.getCell('A1').value = `รายละเอียด Prepayment ตั้งแต่วันที่ ${range}${buTxt}`;
  wsPivot.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF1A3A5C' } };
  wsPivot.getCell('A2').value = `จำนวนรายการ: ${recs.length.toLocaleString('en-US')}   |   จัดทำรายงานวันที่: ${stamp}`;
  wsPivot.getCell('A2').font = { size: 11, color: { argb: 'FF555555' } };
  wsPivot.getCell('A3').value = '* Pivot Table จริง -- ถ้าตัวเลขไม่ขึ้น กด Data > Refresh All  |  เลือกช่วง Aging (Status) ได้ที่ Slicer ด้านล่าง';
  wsPivot.getCell('A3').font = { italic: true, size: 10, color: { argb: 'FF888888' } };

  // ── สรุป Static: รวม AmountRemaining ตาม Row Fields x Status ──
  const statuses = [...new Set(recs.map(r => String(r.Status ?? '')))].sort((a, b) => cmp(a.toLowerCase(), b.toLowerCase()) || cmp(a, b));
  const keyOf = (r) => ROW_FIELDS.map(f => (isDate(r[f]) ? r[f].getTime() : String(r[f] ?? '')));
  const sortKey = (r) => ROW_FIELDS.map(f => (isDate(r[f]) ? String(r[f].getTime()).padStart(16, '0') : String(r[f] ?? '').toLowerCase()));
  const groups = new Map();
  recs.forEach(r => {
    const k = JSON.stringify(keyOf(r));
    if (!groups.has(k)) groups.set(k, { rec: r, sums: {} });
    const g = groups.get(k);
    const st = String(r.Status ?? '');
    g.sums[st] = (g.sums[st] || 0) + (Number(r[DATA_FIELD]) || 0);
  });
  const list = [...groups.values()].sort((a, b) => {
    const A = sortKey(a.rec), B = sortKey(b.rec);
    for (let i = 0; i < A.length; i++) { const c = cmp(A[i], B[i]); if (c) return c; }
    return 0;
  });

  const MONEY = '#,##0.00';
  const hdrFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
  const subFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF3FA' } };
  const firstStatusCol = 7;
  const totalCol = firstStatusCol + statuses.length;
  const setMoney = (row, sums, bold, fill) => {
    let tot = 0;
    statuses.forEach((s, i) => {
      if (s in sums) { const c = row.getCell(firstStatusCol + i); c.value = sums[s]; c.numFmt = MONEY; tot += sums[s]; if (bold) c.font = { bold: true }; if (fill) c.fill = fill; }
    });
    const t = row.getCell(totalCol); t.value = tot; t.numFmt = MONEY; t.font = { bold: true }; if (fill) t.fill = fill;
    return tot;
  };

  // หัวตาราง (แถว 23-24)
  const h1 = wsPivot.getRow(PIVOT_TOP_ROW), h2 = wsPivot.getRow(PIVOT_TOP_ROW + 1);
  h1.getCell(1).value = `Sum of ${DATA_FIELD}`; h1.getCell(firstStatusCol).value = COL_FIELD;
  ROW_FIELDS.forEach((f, i) => { h2.getCell(i + 1).value = f; });
  statuses.forEach((s, i) => { h2.getCell(firstStatusCol + i).value = s; });
  h2.getCell(totalCol).value = 'Grand Total';
  [h1, h2].forEach(r => { for (let c = 1; c <= totalCol; c++) { const cell = r.getCell(c); cell.font = { bold: true }; cell.fill = hdrFill; } });

  let rowNo = PIVOT_TOP_ROW + 2;
  let prev = null;
  const grand = {}; let branchSums = {}; let branchName = null;
  const flushBranch = () => {
    if (branchName === null) return;
    const row = wsPivot.getRow(rowNo++);
    row.getCell(1).value = `${branchName} Total`; row.getCell(1).font = { bold: true }; row.getCell(1).fill = subFill;
    for (let c = 2; c < firstStatusCol; c++) row.getCell(c).fill = subFill;
    setMoney(row, branchSums, true, subFill);
  };
  list.forEach(g => {
    const r = g.rec;
    const bn = String(r[ROW_FIELDS[0]] ?? '');
    if (branchName !== null && bn !== branchName) { flushBranch(); branchSums = {}; prev = null; }
    branchName = bn;
    const row = wsPivot.getRow(rowNo++);
    let changed = false;
    ROW_FIELDS.forEach((f, i) => {
      const v = r[f];
      const same = prev && (isDate(v) ? (isDate(prev[f]) && prev[f].getTime() === v.getTime()) : String(prev[f] ?? '') === String(v ?? ''));
      if (!same) changed = true;
      if (changed) {
        const cell = row.getCell(i + 1);
        cell.value = isDate(v) ? v : (v ?? '');
        if (isDate(v)) cell.numFmt = 'dd\\-mmm\\-yy';
      }
    });
    setMoney(row, g.sums, false, null);
    Object.keys(g.sums).forEach(s => { branchSums[s] = (branchSums[s] || 0) + g.sums[s]; grand[s] = (grand[s] || 0) + g.sums[s]; });
    prev = r;
  });
  flushBranch();
  const gRow = wsPivot.getRow(rowNo++);
  gRow.getCell(1).value = 'Grand Total';
  for (let c = 1; c < firstStatusCol; c++) { gRow.getCell(c).font = { bold: true }; gRow.getCell(c).fill = hdrFill; }
  setMoney(gRow, grand, true, hdrFill);

  // ความกว้างคอลัมน์ (เหมือนไฟล์ตัวอย่าง)
  const widths = [32.9, 17.7, 43.6, 16.8, 16.3, 99.8];
  widths.forEach((w, i) => { wsPivot.getColumn(i + 1).width = w; });
  for (let c = firstStatusCol; c < totalCol; c++) wsPivot.getColumn(c).width = 18.3;
  wsPivot.getColumn(totalCol).width = 16;
  // MARKER_IE_PIVOT_VIEW_V1 -- ค่าเริ่มต้นของชีต Pivot: Zoom 55% + Freeze Panes ที่แถว 25 (ตรึงแถว 1-24 = หัวรายงาน / Slicer / หัวตาราง Pivot)
  wsPivot.views = [{ state: 'frozen', xSplit: 0, ySplit: PIVOT_FREEZE_ROW - 1, topLeftCell: `A${PIVOT_FREEZE_ROW}`, activeCell: `A${PIVOT_FREEZE_ROW}`, zoomScale: PIVOT_ZOOM, zoomScaleNormal: PIVOT_ZOOM }];

  return { lastRow: rowNo - 1, statusCount: statuses.length, recordCount: recs.length };
}

// ─────────────────────────────────────────────────────────────────────────
// ขั้นที่ 2: เติม Pivot Cache / Pivot Table / Slicer เข้า .xlsx ที่ ExcelJS เขียนเสร็จแล้ว
// ─────────────────────────────────────────────────────────────────────────
export async function injectPrepaymentPivot(xlsxBuffer, headers, matrix, info) {
  if (!info) return xlsxBuffer;
  const recs = toRecords(headers, matrix);
  const cols = analyzeColumns(headers, recs);
  const zip = await JSZip.loadAsync(xlsxBuffer);

  // หา sheetId + path ของชีต Pivot จาก workbook.xml / rels
  let wbXml = await zip.file('xl/workbook.xml').async('string');
  const m = wbXml.match(new RegExp(`<sheet [^>]*name="${PIVOT_SHEET_NAME}"[^>]*>`));
  if (!m) throw new Error('ไม่พบชีต Pivot ใน workbook.xml');
  const sheetId = (m[0].match(/sheetId="(\d+)"/) || [])[1];
  const sheetRid = (m[0].match(/r:id="([^"]+)"/) || [])[1];
  let relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const rel = relsXml.match(new RegExp(`<Relationship [^>]*Id="${sheetRid}"[^>]*>`));
  const target = rel && (rel[0].match(/Target="([^"]+)"/) || [])[1];
  if (!target) throw new Error('หา Path ของชีต Pivot ไม่เจอ');
  const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  const sheetFile = sheetPath.split('/').pop();
  const sheetRelsPath = `xl/worksheets/_rels/${sheetFile}.rels`;

  // ── ไฟล์ส่วนประกอบใหม่ ──
  zip.file('xl/pivotCache/pivotCacheDefinition1.xml', buildCacheDefinition(cols, recs.length));
  zip.file('xl/pivotCache/pivotCacheRecords1.xml', buildCacheRecords(cols, recs));
  zip.file('xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/pivotCacheRecords" Target="pivotCacheRecords1.xml"/></Relationships>`);
  zip.file('xl/pivotTables/pivotTable1.xml', buildPivotTable(cols, info.lastRow));
  zip.file('xl/pivotTables/_rels/pivotTable1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/pivotCacheDefinition" Target="../pivotCache/pivotCacheDefinition1.xml"/></Relationships>`);
  zip.file('xl/slicerCaches/slicerCache1.xml', buildSlicerCache(cols, sheetId));
  zip.file('xl/slicers/slicer1.xml', SLICER_XML);
  zip.file('xl/drawings/drawing1.xml', DRAWING_XML);

  // ── Rels ของชีต Pivot (เติมต่อจากที่มี ถ้ามี) ──
  const sheetRels = `<Relationship Id="rIdPvT" Type="${REL}/pivotTable" Target="../pivotTables/pivotTable1.xml"/>`
    + `<Relationship Id="rIdPvD" Type="${REL}/drawing" Target="../drawings/drawing1.xml"/>`
    + `<Relationship Id="rIdPvS" Type="http://schemas.microsoft.com/office/2007/relationships/slicer" Target="../slicers/slicer1.xml"/>`;
  const existingSheetRels = zip.file(sheetRelsPath);
  if (existingSheetRels) {
    const x = await existingSheetRels.async('string');
    zip.file(sheetRelsPath, x.replace('</Relationships>', `${sheetRels}</Relationships>`));
  } else {
    zip.file(sheetRelsPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRels}</Relationships>`);
  }

  // ── Sheet XML: <drawing> + slicerList ──
  let sheetXml = await zip.file(sheetPath).async('string');
  if (!/xmlns:r=/.test(sheetXml.slice(0, 600))) sheetXml = sheetXml.replace('<worksheet ', `<worksheet xmlns:r="${NS_R}" `);
  const tail = `<drawing r:id="rIdPvD"/><extLst><ext uri="{A8765BA9-456A-4dab-B4F3-ACF838C121DE}" xmlns:x14="${NS_X14}"><x14:slicerList><x14:slicer r:id="rIdPvS"/></x14:slicerList></ext></extLst>`;
  sheetXml = sheetXml.replace('</worksheet>', `${tail}</worksheet>`);
  zip.file(sheetPath, sheetXml);

  // ── workbook.xml: definedName ของ Slicer + pivotCaches + slicerCaches ──
  const dn = '<definedName name="Slicer_Status">#N/A</definedName>';
  if (wbXml.includes('</definedNames>')) wbXml = wbXml.replace('</definedNames>', `${dn}</definedNames>`);
  else wbXml = wbXml.replace('</sheets>', `</sheets><definedNames>${dn}</definedNames>`);
  const pc = '<pivotCaches><pivotCache cacheId="1" r:id="rIdPvC"/></pivotCaches>';
  const ext = `<extLst><ext uri="{BBE1A952-AA13-448e-AADC-164F8A28A991}" xmlns:x14="${NS_X14}"><x14:slicerCaches><x14:slicerCache r:id="rIdPvSC"/></x14:slicerCaches></ext></extLst>`;
  if (/<calcPr[^>]*\/>/.test(wbXml)) wbXml = wbXml.replace(/(<calcPr[^>]*\/>)/, `$1${pc}`);
  else wbXml = wbXml.replace('</workbook>', `${pc}</workbook>`);
  wbXml = wbXml.replace('</workbook>', `${ext}</workbook>`);
  zip.file('xl/workbook.xml', wbXml);

  relsXml = relsXml.replace('</Relationships>',
    `<Relationship Id="rIdPvC" Type="${REL}/pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition1.xml"/>`
    + `<Relationship Id="rIdPvSC" Type="http://schemas.microsoft.com/office/2007/relationships/slicerCache" Target="slicerCaches/slicerCache1.xml"/></Relationships>`);
  zip.file('xl/_rels/workbook.xml.rels', relsXml);

  // ── [Content_Types].xml ──
  let ct = await zip.file('[Content_Types].xml').async('string');
  const ov = (p, t) => `<Override PartName="${p}" ContentType="${t}"/>`;
  ct = ct.replace('</Types>',
    ov('/xl/pivotCache/pivotCacheDefinition1.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml')
    + ov('/xl/pivotCache/pivotCacheRecords1.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml')
    + ov('/xl/pivotTables/pivotTable1.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml')
    + ov('/xl/slicerCaches/slicerCache1.xml', 'application/vnd.ms-excel.slicerCache+xml')
    + ov('/xl/slicers/slicer1.xml', 'application/vnd.ms-excel.slicer+xml')
    + ov('/xl/drawings/drawing1.xml', 'application/vnd.openxmlformats-officedocument.drawing+xml')
    + '</Types>');
  zip.file('[Content_Types].xml', ct);

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
