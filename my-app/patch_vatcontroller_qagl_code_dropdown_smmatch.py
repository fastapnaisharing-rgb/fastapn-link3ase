# -*- coding: utf-8 -*-
# patch: Dropdown Vendor ที่ Draft ไม่มี Supplier Code -> หา SM-Code จากชื่อใน SM master (Company/Thai/Supplier Name) ให้กดเลือกได้
import sys
p = sys.argv[1]; o = sys.argv[2]
s = open(p, encoding='utf-8-sig').read()
def rep(a, b):
    global s
    assert s.count(a) == 1, (s.count(a), a[:70])
    s = s.replace(a, b)
rep("  const qaGlOpenDraftMenu = (ev) => {",
"""  const qaGlNormName = (t) => String(t || '').toLowerCase().replace(/บริษัท|จำกัด|\\(มหาชน\\)|มหาชน|หจก\\.?|บจก\\.?|บมจ\\.?|co\\.?,?\\s*ltd\\.?|[\\s.,()\\-]/g, ''); // MARKER_QA_GL_CODE_DROPDOWN_SMMATCH_V1
  const qaGlSmByName = (name) => { // หา SM master ที่ชื่อตรง/ครอบคลุมกัน (ตัด บริษัท/จำกัด/เว้นวรรค)
    const n = qaGlNormName(name); if (n.length < 3) return [];
    const pool = new Map(); [...(addTaxInvoiceSmCodeListData || []), ...(smCodes || [])].forEach((x) => { const c = String(x['SM-Code'] || '').trim(); if (c && !pool.has(c)) pool.set(c, x); });
    const out = [];
    pool.forEach((x, c) => { const names = [x['Company Name'], x['Thai Company Name'], x['Supplier Name'], x['English Company Name']].map(qaGlNormName).filter((v) => v.length >= 3); if (names.some((v) => v === n || (Math.min(v.length, n.length) >= 4 && (v.includes(n) || n.includes(v))))) out.push(x); });
    return out.slice(0, 6);
  };
  const qaGlOpenDraftMenu = (ev) => {""")
rep("""{!qaGlDrLoading && qaGlDrRows.filter((r) => { const q = String(qaGlSupplierCode || '').trim().toLowerCase(); return !q || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q); }).map((r) => (
                              <div key={r.code || `n:${r.name}`}""",
"""{!qaGlDrLoading && qaGlDrRows.flatMap((r) => { if (r.code) return [r]; const c = qaGlSmByName(r.name); return c.length ? c.map((x) => ({ ...r, code: String(x['SM-Code'] || '').trim(), sub: String(x['Short Name'] || x['Branch'] || '').trim() })) : [r]; }).filter((r) => { const q = String(qaGlSupplierCode || '').trim().toLowerCase(); return !q || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q); }).map((r) => (
                              <div key={`${r.code}|${r.name}`}""")
rep("""<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name || '(ไม่มีชื่อ)'}</span>""",
"""<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name || '(ไม่มีชื่อ)'}{r.sub ? <span style={{ marginLeft: '6px', color: '#999', fontSize: '11px' }}>{r.sub}</span> : null}</span>""")
rep("title={r.code ? '' : 'รายการนี้ใน Draft ไม่มี Supplier Code'}", "title={r.code ? '' : 'ไม่พบชื่อนี้ใน SM master จึงไม่มี Code'}")
open(o, 'w', encoding='utf-8-sig', newline='').write(s)
