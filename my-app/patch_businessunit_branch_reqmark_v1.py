# patch_businessunit_branch_reqmark_v1.py -- รันที่ my-app\src\pages
# Import Branch: ตัด "*" ท้ายหัวคอลัมน์ (Template ใหม่มี * ที่ช่องบังคับ) ก่อนจับคู่ชื่อ Field | ปุ่ม Template ของระบบก็ใส่ * ที่ช่องบังคับให้
import io, shutil, sys
p = sys.argv[1] if len(sys.argv) > 1 else 'BusinessUnit.js'
s = io.open(p, encoding='utf-8').read()
if 'MARKER_BRANCH_REQUIRED_MARK_V1' in s:
    print('already patched'); sys.exit(0)
a_old = "const markInvalidNewBranchRows = (rows) => rows.map((r) => {"
a_new = "// MARKER_BRANCH_REQUIRED_MARK_V1 -- หัวคอลัมน์ใน Excel ที่ลงท้ายด้วย * (ช่องบังคับ) ให้ตัด * ออกก่อน แล้วค่อยจับคู่ชื่อ Field\nconst stripReqMark = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [String(k).replace(/\\s*\\*+\\s*$/, '').trim(), v])));\n" + a_old
assert s.count(a_old) == 1, s.count(a_old)
b_old = "let rawRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }).filter((r) => String(r[BRANCH_KEY] || '').trim())"
b_new = "let rawRows = stripReqMark(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })).filter((r) => String(r[BRANCH_KEY] || '').trim())"
assert s.count(b_old) == 1, s.count(b_old)
c_old = "const ws = XLSX.utils.aoa_to_sheet([BRANCH_FIELDS.filter(f => !['updated_by','updated_at'].includes(f))]); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'BranchList');"
c_new = "const ws = XLSX.utils.aoa_to_sheet([BRANCH_FIELDS.filter(f => !['updated_by','updated_at'].includes(f)).map(f => BRANCH_REQUIRED_KEYS.includes(f) ? f + ' *' : f)]); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'BranchList');"
assert s.count(c_old) == 1, s.count(c_old)
shutil.copy(p, p + '.bak_reqmark_v1')
s = s.replace(a_old, a_new).replace(b_old, b_new).replace(c_old, c_new)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('OK')
