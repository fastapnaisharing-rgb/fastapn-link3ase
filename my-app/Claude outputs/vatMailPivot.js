// vatMailPivot.js -- MARKER_VATMAILEXPORT_REAL_PIVOT_V1
// ฝัง PivotTable "ตัวจริง" ของ Excel ลงในไฟล์ .xlsx (ExcelJS สร้าง Pivot เองไม่ได้)
// ใส่ Pivot Cache (พร้อม Records) + Pivot Table + refreshOnLoad -> เปิดไฟล์แล้ว Excel คำนวณ/วาด Pivot ให้เอง
import JSZip from "jszip";

const esc = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const isoDate = (d) => d.toISOString().slice(0, 19);
const kindOf = (v) => (v == null || v === "" ? "m" : v instanceof Date ? "d" : typeof v === "number" ? "n" : "s");

/**
 * header: string[]          -- ชื่อคอลัมน์ของชีทข้อมูล (A1..)
 * rows:   any[][]           -- ค่าแต่ละแถว (Date | number | string | null) ต้องตรงกับที่เขียนลงชีทจริง
 * opts: { dataSheet, hostSheetFile, rowFields:number[], pageField:number, dataFields:[{idx,name}], pivotRef:'A10', cacheId }
 */
export async function injectPivot(buffer, { header, rows, dataSheet, hostSheetFile = "sheet1.xml", rowFields, pageField = null, dataFields, pivotTop = 10, cacheId = 1, slicers = [], hostSheetName = "Incompleted_Pivot", styleName = "PivotStyleMedium6", fontName = "Tahoma" }) {
  const slicerFields = slicers.map((x) => x.field);
  const nCols = header.length;
  const colLetter = (n) => { let s = ""; n += 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

  // ── วิเคราะห์ชนิดข้อมูลต่อคอลัมน์ ──
  const cols = header.map((name, c) => {
    const vals = rows.map((r) => r[c]);
    const kinds = new Set(vals.map(kindOf));
    const hasBlank = kinds.has("m");
    kinds.delete("m");
    let type = "s";
    if (kinds.size === 1 && kinds.has("n")) type = "n";
    else if (kinds.size === 1 && kinds.has("d")) type = "d";
    const enumerate = rowFields.includes(c) || c === pageField || slicerFields.includes(c);
    let items = null; const idxOf = new Map();
    if (enumerate) {
      const seen = new Map();
      vals.forEach((v) => { if (v == null || v === "") return; const key = type === "d" ? isoDate(v) : String(v); if (!seen.has(key)) seen.set(key, v); });
      items = [...seen.keys()].sort((a, b) => (type === "n" ? Number(a) - Number(b) : a.localeCompare(b, "th")));
      if (slicers.find((x) => x.field === c && x.reverse)) items.reverse(); // เรียงมาก -> น้อย (เช่น aging 6 ... 0)
      items.forEach((k, i) => idxOf.set(k, i));
      if (hasBlank) { idxOf.set("\u0000blank", items.length); }
    }
    let minV; let maxV;
    if (type === "n") { const ns = vals.filter((v) => typeof v === "number"); minV = Math.min(...ns); maxV = Math.max(...ns); }
    if (type === "d") { const ds = vals.filter((v) => v instanceof Date).map((v) => v.getTime()); minV = new Date(Math.min(...ds)); maxV = new Date(Math.max(...ds)); }
    return { name, type, hasBlank, items, idxOf, minV, maxV };
  });

  // ── pivotCacheDefinition ──
  const cacheFields = cols.map((c) => {
    let si;
    if (c.type === "n") si = `<sharedItems containsSemiMixedTypes="0" containsString="0" containsNumber="1"${c.hasBlank ? "" : ""} minValue="${c.minV}" maxValue="${c.maxV}"/>`;
    else if (c.type === "d") si = `<sharedItems${c.hasBlank ? "" : ' containsSemiMixedTypes="0"'} containsNonDate="0" containsDate="1" containsString="0"${c.hasBlank ? ' containsBlank="1"' : ""} minDate="${isoDate(c.minV)}" maxDate="${isoDate(c.maxV)}"${c.items ? ` count="${c.items.length + (c.hasBlank ? 1 : 0)}"` : ""}>${c.items ? c.items.map((k) => `<d v="${k}"/>`).join("") + (c.hasBlank ? "<m/>" : "") : ""}</sharedItems>`;
    else if (c.items) si = `<sharedItems${c.hasBlank ? ' containsBlank="1"' : ""} count="${c.items.length + (c.hasBlank ? 1 : 0)}">${c.items.map((k) => `<s v="${esc(k)}"/>`).join("")}${c.hasBlank ? "<m/>" : ""}</sharedItems>`;
    else si = `<sharedItems${c.hasBlank ? ' containsBlank="1"' : ""}/>`;
    const nf = c.type === "d" ? ' numFmtId="15"' : c.type === "n" ? ' numFmtId="4"' : ' numFmtId="0"';
    return `<cacheField name="${esc(c.name)}"${nf}>${si}</cacheField>`;
  }).join("");
  const lastRow = rows.length + 1;
  const cacheDef = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotCacheDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1" refreshOnLoad="1" refreshedBy="Link3ase" refreshedDate="${(Date.now() / 86400000 + 25569).toFixed(6)}" createdVersion="6" refreshedVersion="6" minRefreshableVersion="3" recordCount="${rows.length}"><cacheSource type="worksheet"><worksheetSource ref="A1:${colLetter(nCols - 1)}${lastRow}" sheet="${esc(dataSheet)}"/></cacheSource><cacheFields count="${nCols}">${cacheFields}</cacheFields>${slicers.length ? `<extLst><ext uri="{725AE2AE-9491-48be-B2B4-4EB974FC3084}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:pivotCacheDefinition pivotCacheId="${cacheId}"/></ext></extLst>` : ""}</pivotCacheDefinition>`; // MARKER_VATMAILPIVOT_X14_CACHE_EXT_V1 -- Slicer ต้องผูกกับ Cache ผ่าน x14:pivotCacheDefinition (ไม่มี Excel อาจไม่วาด Slicer)

  // ── pivotCacheRecords ──
  const recs = rows.map((r) => `<r>${cols.map((c, i) => {
    const v = r[i]; const blank = v == null || v === "";
    if (c.items) { const k = blank ? "\u0000blank" : (c.type === "d" ? isoDate(v) : String(v)); return `<x v="${c.idxOf.get(k)}"/>`; }
    if (blank) return "<m/>";
    if (c.type === "n") return `<n v="${v}"/>`;
    if (c.type === "d") return `<d v="${isoDate(v)}"/>`;
    return `<s v="${esc(v)}"/>`;
  }).join("")}</r>`).join("");
  const cacheRec = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotCacheRecords xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" count="${rows.length}">${recs}</pivotCacheRecords>`;

  // ── pivotTableDefinition ──
  const dataIdx = dataFields.map((d) => d.idx);
  const pivotFields = cols.map((c, i) => {
    const itemsXml = (withDefault) => c.items ? `<items count="${c.items.length + (c.hasBlank ? 1 : 0) + (withDefault ? 1 : 0)}">${c.items.map((_, k) => `<item x="${k}"/>`).join("")}${c.hasBlank ? `<item x="${c.items.length}"/>` : ""}${withDefault ? '<item t="default"/>' : ""}</items>` : "";
    const nf = c.type === "d" ? ' numFmtId="15"' : "";
    const rowPos = rowFields.indexOf(i);
    if (rowPos >= 0) {
      const outer = rowPos === 0; // Subtotal เฉพาะ Related Persons (ชั้นนอกสุด) เหมือนไฟล์ตัวอย่าง
      return `<pivotField axis="axisRow" compact="0"${nf} outline="0" showAll="0"${outer ? "" : ' defaultSubtotal="0"'}>${itemsXml(outer)}</pivotField>`;
    }
    if (slicerFields.includes(i)) return `<pivotField compact="0" outline="0" multipleItemSelectionAllowed="1" showAll="0">${itemsXml(true)}</pivotField>`;
    if (i === pageField) return `<pivotField axis="axisPage" compact="0" outline="0" multipleItemSelectionAllowed="1" showAll="0">${itemsXml(true)}</pivotField>`;
    if (dataIdx.includes(i)) return `<pivotField dataField="1" compact="0" outline="0" showAll="0"/>`;
    return `<pivotField compact="0"${nf} outline="0" showAll="0"/>`;
  }).join("");
  const nRow = rowFields.length;
  const ptDef = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotTableDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" name="ICP_Following" cacheId="${cacheId}" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="1" dataCaption="Values" updatedVersion="6" minRefreshableVersion="3" useAutoFormatting="1" itemPrintTitles="1" createdVersion="6" indent="0" compact="0" compactData="0" multipleFieldFilters="0"><location ref="A${pivotTop}:${colLetter(nRow + dataFields.length - 1)}${pivotTop + 1}" firstHeaderRow="0" firstDataRow="1" firstDataCol="${nRow}"${pageField != null ? ' rowPageCount="1" colPageCount="1"' : ""}/><pivotFields count="${nCols}">${pivotFields}</pivotFields><rowFields count="${nRow}">${rowFields.map((f) => `<field x="${f}"/>`).join("")}</rowFields><colFields count="1"><field x="-2"/></colFields>${pageField != null ? `<pageFields count="1"><pageField fld="${pageField}" hier="-1"/></pageFields>` : ""}<dataFields count="${dataFields.length}">${dataFields.map((d) => `<dataField name="${esc(d.name)}" fld="${d.idx}" baseField="0" baseItem="0" numFmtId="43"/>`).join("")}</dataFields><pivotTableStyleInfo name="${styleName}" showRowHeaders="1" showColHeaders="1" showRowStripes="0" showColStripes="0" showLastColumn="1"/></pivotTableDefinition>`;

  // ── ประกอบเข้า zip ──
  const zip = await JSZip.loadAsync(buffer);
  zip.file("xl/pivotCache/pivotCacheDefinition1.xml", cacheDef);
  zip.file("xl/pivotCache/pivotCacheRecords1.xml", cacheRec);
  zip.file("xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheRecords" Target="pivotCacheRecords1.xml"/></Relationships>`);
  zip.file("xl/pivotTables/pivotTable1.xml", ptDef);
  zip.file("xl/pivotTables/_rels/pivotTable1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition" Target="../pivotCache/pivotCacheDefinition1.xml"/></Relationships>`);

  const relPath = `xl/worksheets/_rels/${hostSheetFile}.rels`;
  const pivRel = `<Relationship Id="rIdPivot1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotTable" Target="../pivotTables/pivotTable1.xml"/>`;
  const existing = zip.file(relPath);
  if (existing) { const t = await existing.async("string"); zip.file(relPath, t.replace("</Relationships>", `${pivRel}</Relationships>`)); }
  else zip.file(relPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${pivRel}</Relationships>`);

  let wbXml = await zip.file("xl/workbook.xml").async("string");
  const pc = `<pivotCaches><pivotCache cacheId="${cacheId}" r:id="rIdPivotCache1"/></pivotCaches>`;
  if (!/xmlns:r=/.test(wbXml)) wbXml = wbXml.replace("<workbook ", '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
  if (/<extLst>/.test(wbXml)) wbXml = wbXml.replace("<extLst>", `${pc}<extLst>`); else wbXml = wbXml.replace("</workbook>", `${pc}</workbook>`);
  zip.file("xl/workbook.xml", wbXml);

  let wbRels = await zip.file("xl/_rels/workbook.xml.rels").async("string");
  wbRels = wbRels.replace("</Relationships>", `<Relationship Id="rIdPivotCache1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition1.xml"/></Relationships>`);
  zip.file("xl/_rels/workbook.xml.rels", wbRels);

  let ct = await zip.file("[Content_Types].xml").async("string");
  ct = ct.replace("</Types>", `<Override PartName="/xl/pivotCache/pivotCacheDefinition1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml"/><Override PartName="/xl/pivotCache/pivotCacheRecords1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml"/><Override PartName="/xl/pivotTables/pivotTable1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml"/></Types>`);
  zip.file("[Content_Types].xml", ct);

  // ── Slicers (เช่น Aging, Tax Group) ──
  if (slicers.length) {
    const sheetIdM = wbXml.match(new RegExp(`<sheet [^>]*?name="${esc(hostSheetName)}"[^>]*?>`));
    const tabId = sheetIdM ? (sheetIdM[0].match(/sheetId="(\d+)"/) || [])[1] || "1" : "1";
    const info = slicers.map((sl, n) => ({ ...sl, sc: cols[sl.field], slName: `Slicer_${cols[sl.field].name.replace(/[^A-Za-z0-9_]/g, "_")}`, n: n + 1 }));
    info.forEach((x) => {
      zip.file(`xl/slicerCaches/slicerCache${x.n}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<slicerCacheDefinition xmlns="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" name="${x.slName}" sourceName="${esc(x.sc.name)}"><pivotTables><pivotTable tabId="${tabId}" name="ICP_Following"/></pivotTables><data><tabular pivotCacheId="${cacheId}"${x.reverse ? ' sortOrder="descending"' : ""}><items count="${x.sc.items.length}">${x.sc.items.map((_, k) => `<i x="${k}" s="1"/>`).join("")}</items></tabular></data></slicerCacheDefinition>`);
    });
    zip.file("xl/slicers/slicer1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<slicers xmlns="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${info.map((x) => `<slicer name="${esc(x.caption || x.sc.name)}" cache="${x.slName}" caption="${esc(x.caption || x.sc.name)}" columnCount="${x.columnCount || 1}" rowHeight="${x.rowHeight || 257175}"/>`).join("")}</slicers>`);
    const anchors = info.map((x) => `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${x.from[0]}</xdr:col><xdr:colOff>${(x.fromOff || [0, 0])[0]}</xdr:colOff><xdr:row>${x.from[1]}</xdr:row><xdr:rowOff>${(x.fromOff || [0, 0])[1]}</xdr:rowOff></xdr:from><xdr:to><xdr:col>${x.to[0]}</xdr:col><xdr:colOff>${(x.toOff || [0, 0])[0]}</xdr:colOff><xdr:row>${x.to[1]}</xdr:row><xdr:rowOff>${(x.toOff || [0, 95250])[1]}</xdr:rowOff></xdr:to><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"><mc:Choice Requires="a14"><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${x.n + 1}" name="${esc(x.caption || x.sc.name)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/drawing/2010/slicer"><sle:slicer xmlns:sle="http://schemas.microsoft.com/office/drawing/2010/slicer" name="${esc(x.caption || x.sc.name)}"/></a:graphicData></a:graphic></xdr:graphicFrame></mc:Choice><mc:Fallback xmlns=""><xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="0" name=""/><xdr:cNvSpPr><a:spLocks noTextEdit="1"/></xdr:cNvSpPr></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="2000000" y="600000"/><a:ext cx="3400000" cy="1100000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:prstClr val="white"/></a:solidFill></xdr:spPr><xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip"/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1100"/><a:t>Slicer (Excel 2010+)</a:t></a:r></a:p></xdr:txBody></xdr:sp></mc:Fallback></mc:AlternateContent><xdr:clientData/></xdr:twoCellAnchor>`).join("");
    zip.file("xl/drawings/drawing1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors}</xdr:wsDr>`);

    let sh = await zip.file(`xl/worksheets/${hostSheetFile}`).async("string");
    if (!/xmlns:r=/.test(sh)) sh = sh.replace("<worksheet ", '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
    const drawTag = '<drawing r:id="rIdDrawing1"/>';
    if (/<tableParts|<extLst/.test(sh)) sh = sh.replace(/(<tableParts|<extLst)/, `${drawTag}$1`); else sh = sh.replace("</worksheet>", `${drawTag}</worksheet>`);
    const slExt = `<extLst><ext uri="{A8765BA9-456A-4dab-B4F3-ACF838C121DE}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:slicerList><x14:slicer r:id="rIdSlicer1"/></x14:slicerList></ext></extLst>`;
    if (/<extLst>/.test(sh)) sh = sh.replace("</extLst>", `${slExt.replace(/^<extLst>|<\/extLst>$/g, "")}</extLst>`); else sh = sh.replace("</worksheet>", `${slExt}</worksheet>`);
    zip.file(`xl/worksheets/${hostSheetFile}`, sh);
    let rl = await zip.file(relPath).async("string");
    rl = rl.replace("</Relationships>", `<Relationship Id="rIdDrawing1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/><Relationship Id="rIdSlicer1" Type="http://schemas.microsoft.com/office/2007/relationships/slicer" Target="../slicers/slicer1.xml"/></Relationships>`);
    zip.file(relPath, rl);

    let wb2 = await zip.file("xl/workbook.xml").async("string");
    const dn = info.map((x) => `<definedName name="${x.slName}">#N/A</definedName>`).join("");
    if (/<definedNames>/.test(wb2)) wb2 = wb2.replace("</definedNames>", `${dn}</definedNames>`); else wb2 = wb2.replace("</sheets>", `</sheets><definedNames>${dn}</definedNames>`);
    wb2 = wb2.replace("</workbook>", `<extLst><ext uri="{BBE1A952-AA13-448e-AADC-164F8A28A991}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:slicerCaches>${info.map((x) => `<x14:slicerCache r:id="rIdSlicerCache${x.n}"/>`).join("")}</x14:slicerCaches></ext></extLst></workbook>`);
    zip.file("xl/workbook.xml", wb2);
    let wr = await zip.file("xl/_rels/workbook.xml.rels").async("string");
    wr = wr.replace("</Relationships>", info.map((x) => `<Relationship Id="rIdSlicerCache${x.n}" Type="http://schemas.microsoft.com/office/2007/relationships/slicerCache" Target="slicerCaches/slicerCache${x.n}.xml"/>`).join("") + "</Relationships>");
    zip.file("xl/_rels/workbook.xml.rels", wr);
    let ct2 = await zip.file("[Content_Types].xml").async("string");
    ct2 = ct2.replace("</Types>", info.map((x) => `<Override PartName="/xl/slicerCaches/slicerCache${x.n}.xml" ContentType="application/vnd.ms-excel.slicerCache+xml"/>`).join("") + `<Override PartName="/xl/slicers/slicer1.xml" ContentType="application/vnd.ms-excel.slicer+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
    zip.file("[Content_Types].xml", ct2);
  }

  // ── ฟอนต์ตั้งต้นของไฟล์ (Normal style) เป็น Tahoma ตามไฟล์ตัวอย่าง -- ให้ Pivot ที่ Excel วาดเองใช้ฟอนต์เดียวกัน ──
  if (fontName && zip.file("xl/styles.xml")) {
    let st = await zip.file("xl/styles.xml").async("string");
    st = st.replace(/(<fonts[^>]*>\s*)<font>[\s\S]*?<\/font>/, `$1<font><sz val="11"/><color theme="1"/><name val="${fontName}"/><family val="2"/></font>`); // Normal style = Tahoma (ตัด scheme minor ออก ไม่งั้น Excel ใช้ฟอนต์ธีมแทน)
    zip.file("xl/styles.xml", st);
  }

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
