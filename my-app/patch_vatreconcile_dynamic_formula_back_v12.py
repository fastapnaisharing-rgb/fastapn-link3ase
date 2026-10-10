# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_DYNAMIC_FORMULA_BACK_V12
# สูตร Status (Detail!Q) เปิดใน Excel แล้วมี "@" นำหน้า -> เขียนเป็น Dynamic-Array Formula (เหมือน Formula2 ใน VBA): <f t="array"> + cm="1" + xl/metadata.xml
import sys, shutil, os
M = "MARKER_VATRECONCILE_DYNAMIC_FORMULA_BACK_V12"
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
    s = rep(s, 'put(dt, `Q${rowNo}`, { formula: STATUS_F(rowNo), result: "True" }, totQ);', 'put(dt, `Q${rowNo}`, { formula: STATUS_F(rowNo), result: "True", shareType: "array", ref: `Q${rowNo}` }, totQ); // ' + M)
    s = rep(s, 'put(dt, `Q${dr}`, { formula: STATUS_F(dr), result: statusResult(d) }, {', 'put(dt, `Q${dr}`, { formula: STATUS_F(dr), result: statusResult(d), shareType: "array", ref: `Q${dr}` }, {')
    wr(p, s, c); print("OK", p)
else: print("skip", p)

HELPER = r'''
// ''' + M + r'''
// ExcelJS ไม่รองรับ Dynamic-Array (cm="1") -- เติมเองหลังเขียนไฟล์: cell ที่เป็น <f t="array"> ได้ cm="1" + เพิ่ม xl/metadata.xml (XLDAPR) -> Excel เปิดแล้วไม่มี "@" และไม่มีปีกกา {} (เหมือนใช้ Formula2)
async function markDynamicArrayFormulas(buf) {
  try {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(buf);
    let any = false;
    for (const name of Object.keys(zip.files)) {
      if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue;
      const xml = await zip.file(name).async("string");
      const out = xml.replace(/<c ([^>]*?)>(<f t="array" ref="[A-Z]+\d+")/g, (m, attrs, f) => (/\bcm=/.test(attrs) ? m : (any = true, `<c ${attrs} cm="1">${f}`)));
      if (out !== xml) zip.file(name, out);
    }
    if (!any) return buf;
    zip.file("xl/metadata.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xda="http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray"><metadataTypes count="1"><metadataType name="XLDAPR" minSupportedVersion="120000" copy="1" pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1" cellMeta="1"/></metadataTypes><futureMetadata name="XLDAPR" count="1"><bk><extLst><ext uri="{bdbb8cdc-fa1e-496e-a857-3c3f30c029c3}"><xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/></ext></extLst></bk></futureMetadata><cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>`);
    let ct = await zip.file("[Content_Types].xml").async("string");
    if (!ct.includes("/xl/metadata.xml")) ct = ct.replace("</Types>", `<Override PartName="/xl/metadata.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml"/></Types>`);
    zip.file("[Content_Types].xml", ct);
    let rels = await zip.file("xl/_rels/workbook.xml.rels").async("string");
    if (!rels.includes("sheetMetadata")) rels = rels.replace("</Relationships>", `<Relationship Id="rIdMetaDA1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata" Target="metadata.xml"/></Relationships>`);
    zip.file("xl/_rels/workbook.xml.rels", rels);
    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
  } catch (e) {
    console.warn("[vatReconcile] markDynamicArrayFormulas ข้าม:", e.message);
    return buf;
  }
}
'''
p = "vatReconcileReportFiles.js"; s, c = rd(p)
if M not in s:
    bak(p)
    s = rep(s, "async function buildReconcileWorkbook(rep, bu, period) {", HELPER + "\nasync function buildReconcileWorkbook(rep, bu, period) {")
    s = rep(s, "      const buf = Buffer.from(await wb.xlsx.writeBuffer({ zip: { compression: \"DEFLATE\", compressionOptions: { level: 9 } } }));",
               "      let buf = Buffer.from(await wb.xlsx.writeBuffer({ zip: { compression: \"DEFLATE\", compressionOptions: { level: 9 } } }));\n      if (rep.template !== \"avg\") buf = await markDynamicArrayFormulas(buf); // " + M)
    wr(p, s, c); print("OK", p)
else: print("skip", p)
