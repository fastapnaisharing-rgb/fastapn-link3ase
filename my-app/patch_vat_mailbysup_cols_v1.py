# patch_vat_mailbysup_cols_v1.py -- รันที่ my-app\src\pages : ทำให้ปุ่ม Draft ในแท็บ Config Email - by Supplier ไม่ถูกตัดทิ้งเมื่อหน้าจอแคบ/Zoom
import io, shutil, sys
p = sys.argv[1] if len(sys.argv) > 1 else 'VatController.js'
s = io.open(p, encoding='utf-8').read()
old = "minmax(230px,1.5fr) minmax(240px,1.6fr) minmax(170px,1.1fr) minmax(210px,1.3fr) 78px 100px 100px 180px 76px"
new = "minmax(150px,1.5fr) minmax(170px,1.6fr) minmax(110px,1.1fr) minmax(130px,1.3fr) 70px 90px 90px 150px 64px"
assert s.count(old) == 1, s.count(old)
box_old = "<div style={{ border: '0.5px solid #e3e3e3', borderRadius: '8px', overflow: 'hidden' }}>\n        <div style={{ display: 'grid', gridTemplateColumns: cols,"
assert s.count(box_old) == 1, s.count(box_old)
box_new = "<div style={{ border: '0.5px solid #e3e3e3', borderRadius: '8px', overflowX: 'auto', overflowY: 'hidden' }}> {/* MARKER_VATWATCHLIST_MAIL_BYSUP_COLS_FIT_V1 -- คอลัมน์แคบลง + เลื่อนแนวนอนได้ ปุ่ม Draft ไม่ถูกตัด */}\n        <div style={{ display: 'grid', gridTemplateColumns: cols,"
shutil.copy(p, p + '.bak_mailbysup_v1')
s = s.replace(old, new).replace(box_old, box_new)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('OK')
