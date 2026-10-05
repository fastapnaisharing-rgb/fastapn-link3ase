# -*- coding: utf-8 -*-
# MARKER_VATCONTROLLER_SIMPLEOPS_ZONEB_CATEGORY_DYNAMIC_V1 -- Category (Zone B) เดิม Hardcode 'com-IB-ALL' -> ใช้ SEGMENT3 ของ Company (ฝั่ง Debit ก่อน) เหมือนค่าที่ Insert จริงตอน Add: `${SEGMENT3}-IB-ALL`
import sys, shutil
M = 'MARKER_VATCONTROLLER_SIMPLEOPS_ZONEB_CATEGORY_DYNAMIC_V1'
path = sys.argv[1]
raw = open(path, 'rb').read(); bom = raw.startswith(b'\xef\xbb\xbf')
s = raw.decode('utf-8-sig')
if M in s: print('already patched'); sys.exit(0)
shutil.copyfile(path, path + '.bak_category')
old = "<span style={kStyle}>Category</span><span style={vStyle(true)}>com-IB-ALL</span>"
assert s.count(old) == 1, s.count(old)
new = ("<span style={kStyle}>Category</span>{(() => { const _seg3 = String(mainCompanyForAdi?.['SEGMENT3'] || '').trim(); return <span style={vStyle(!!_seg3)}>{_seg3 ? `${_seg3}-IB-ALL` : '—'}</span>; })()}"
       f" {{/* {M} */}}")
s = s.replace(old, new)
open(path, 'wb').write((b'\xef\xbb\xbf' if bom else b'') + s.encode('utf-8'))
print('patched OK')
