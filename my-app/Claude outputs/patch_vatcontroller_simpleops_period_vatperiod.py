# -*- coding: utf-8 -*-
# MARKER_VATCONTROLLER_SIMPLEOPS_ZONEB_PERIOD_VATPERIOD_V1 -- Period (Zone B) เดิมใช้เดือนปัจจุบันของเครื่อง -> ใช้ VAT Period ที่เปิดอยู่ (smPeriodStatus.vat_period_current_month) เหมือนค่า adi_period ที่ Insert จริง
import sys, shutil
M = 'MARKER_VATCONTROLLER_SIMPLEOPS_ZONEB_PERIOD_VATPERIOD_V1'
path = sys.argv[1]
raw = open(path, 'rb').read(); bom = raw.startswith(b'\xef\xbb\xbf')
s = raw.decode('utf-8-sig')
if M in s: print('already patched'); sys.exit(0)
shutil.copyfile(path, path + '.bak_period')
old = "<span style={vStyle(true)}>{(() => { const _n = new Date(); const _ma = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${_ma[_n.getMonth()]}-${String(_n.getFullYear()).slice(-2)}`; })()}</span>"
assert s.count(old) == 1, s.count(old)
new = ("<span style={vStyle(!!currentPeriodMonth)}>{(() => { const _ma = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; const [_y, _m] = String(currentPeriodMonth || '').split('-').map(Number); return (_y && _m) ? `${_ma[_m - 1]}-${String(_y).slice(-2)}` : '—'; })()}</span>"
       f" {{/* {M} -- ตาม VAT Period ที่เปิดอยู่ (ไม่ใช่เดือนปัจจุบันของเครื่อง) */}}")
s = s.replace(old, new)
open(path, 'wb').write((b'\xef\xbb\xbf' if bom else b'') + s.encode('utf-8'))
print('patched OK')
