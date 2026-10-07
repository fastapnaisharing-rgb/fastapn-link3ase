# patch_vatcontroller_qa_partused_remark_date.py -- Modal B (Part Used): วันที่พิมพ์/วางได้, ตัดช่องเดือน, Remark = "ใช้สิทธิ์ไปแล้วบางส่วน วันที่ DD/MM/YYYY | รายละเอียดเพิ่ม", วันที่ใช้สิทธิ์ = Receive Date (เหมือน A/F)
import sys, io
P = sys.argv[1]
s = io.open(P, encoding='utf-8').read()
MARK = 'MARKER_VATWATCHLISTOPS_QA_PARTUSED_REMARK_DATE_V1'
if MARK in s:
    print('already applied'); sys.exit(0)

INP = "box-sizing"  # placeholder to keep linters quiet
ST = "{{ width: '100%', boxSizing: 'border-box', fontSize: '13px', border: '1px solid #ddd', borderRadius: '8px', padding: '7px 10px' }}"

edits = []
# 1) ช่องวันที่: type=date -> Text พิมพ์/วางได้ + ปฏิทินซ่อน (Pattern เดียวกับ Receive Date)
edits.append((
 "<input type=\"date\" value={qaPopBDate} onChange={(e) => setQaPopBDate(e.target.value)} style=" + ST + " />",
 "<div style={{ position: 'relative' }}><input key={`qpbd${qaPopBDate || 'x'}`} type=\"text\" defaultValue={formatDateDisplayMDY(qaPopBDate)} placeholder=\"MM/DD/YYYY\" onBlur={async (e) => { const parsed = await resolveFlexibleDateInput(e.target); if (parsed) { e.target.value = formatDateDisplayMDY(parsed); setQaPopBDate(parsed); } else if (!e.target.value.trim()) { setQaPopBDate(''); } else { e.target.value = formatDateDisplayMDY(qaPopBDate); } }} style={{ width: '100%', boxSizing: 'border-box', fontSize: '13px', border: '1px solid #ddd', borderRadius: '8px', padding: '7px 30px 7px 10px' }} /><span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', fontSize: '13px', color: '#888' }}>\U0001F4C5</span><input type=\"date\" tabIndex={-1} value={qaPopBDate || ''} onChange={(e) => setQaPopBDate(e.target.value)} style={{ position: 'absolute', right: 0, top: 0, width: '30px', height: '100%', opacity: 0, cursor: 'pointer', border: 'none', padding: 0 }} /></div>{/* " + MARK + " */}"
))
# 2) ตัดช่อง "ใช้ไปในเดือนไหน"
edits.append((
 "<div style={{ fontSize: '12px', color: '#555', margin: '8px 0 3px' }}>ใช้ไปในเดือนไหน</div><input type=\"month\" value={qaPopBMonth} onChange={(e) => setQaPopBMonth(e.target.value)} style=" + ST + " />",
 ""
))
# 3) Remark ตัวอย่างในกล่องสรุป
edits.append((
 "{(qaPopBDate && qaPopBMonth && Number(qaPopBAmount) > 0) ? `ใช้สิทธิ์บางส่วน ใช้ไปแล้วเมื่อ ${qaPopBDate} (เดือน ${qaPopBMonth}) จำนวน ${Number(qaPopBAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` + (qaPopBExtra.trim() ? ` | ${qaPopBExtra.trim()}` : '') : '-'}",
 "{`ใช้สิทธิ์ไปแล้วบางส่วน${qaPopBDate ? ` วันที่ ${qaPopBDate.split('-').reverse().join('/')}` : ''}` + (qaPopBExtra.trim() ? ` | ${qaPopBExtra.trim()}` : '')}"
))
# 4) วันที่ใช้สิทธิ์ = Receive Date (เหมือน A/F)
edits.append((
 "<div><b>วันที่ใช้สิทธิ์:</b> {formatQuickActionReceiveDateText(qaPopBDate) || '-'}</div>",
 "<div><b>วันที่ใช้สิทธิ์ (Receive Date):</b> {formatQuickActionReceiveDateText(quickActionReceiveDate) || '-'}</div>"
))
# 5) ปุ่ม Popvat - B: เงื่อนไข + Remark + ไม่ส่ง popUseDate
edits.append((
 "const okB = !!(qaPopBDate && qaPopBMonth && Number(qaPopBAmount) > 0);",
 "const okB = !!(qaPopBDate && Number(qaPopBAmount) > 0);"
))
edits.append((
 "const amtTxt = Number(qaPopBAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); const remarkB = `ใช้สิทธิ์บางส่วน ใช้ไปแล้วเมื่อ ${qaPopBDate} (เดือน ${qaPopBMonth}) จำนวน ${amtTxt}` + (qaPopBExtra.trim() ? ` | ${qaPopBExtra.trim()}` : ''); setQaPopBOpen(false); handleAddQuickActionData('B', remarkB, qaPopBDate);",
 "const remarkB = `ใช้สิทธิ์ไปแล้วบางส่วน วันที่ ${qaPopBDate.split('-').reverse().join('/')}` + (qaPopBExtra.trim() ? ` | ${qaPopBExtra.trim()}` : ''); setQaPopBOpen(false); handleAddQuickActionData('B', remarkB);"
))
for old, new in edits:
    n = s.count(old)
    if n != 1:
        print('FAIL count=%d for: %s' % (n, old[:90])); sys.exit(1)
    s = s.replace(old, new)
io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('OK', len(edits), 'edits')
