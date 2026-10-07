# -*- coding: utf-8 -*-
# MARKER VATWATCHLISTOPS_TYPE_ABF_V8 -- มุมมอง Type: จัด Align หัวคอลัมน์ให้ตรงกับข้อมูล (วันที่=กลาง, ตัวเลข=ขวา, อื่นๆ=ซ้าย)
import sys, os, shutil
P = os.path.join('src', 'pages', 'VatController.js')
MARK = 'VATWATCHLISTOPS_TYPE_ABF_V8'
s = open(P, 'rb').read().decode('utf-8')
if MARK in s: print('SKIP: patch นี้ถูกใช้แล้ว (%s)' % MARK); sys.exit(0)
crlf = '\r\n' in s
def fx(t): return t.replace('\n', '\r\n') if crlf else t
h_old = "<div style={{ display: 'flex', alignItems: 'center', gap: '6px', position: 'relative', padding: '8px 10px', width: '100%', boxSizing: 'border-box' }}>" + fx("\n                          <span>{c.label}</span>")
h_new = "<div style={{ display: 'flex', alignItems: 'center', gap: '6px', position: 'relative', padding: '8px 10px', width: '100%', boxSizing: 'border-box', justifyContent: showDetailMode === 'type' ? (VAT_INCOMPLETE_NUMBER_KEYS.has(c.key) ? 'flex-end' : ((VAT_INCOMPLETE_DATE_KEYS.has(c.key) || c.key === 'type_receive_date') ? 'center' : 'flex-start')) : undefined }}> {/* MARKER_VATWATCHLISTOPS_TYPE_ABF_V8 */}" + fx("\n                          <span>{c.label}</span>")
c_old = "else cellValue = row[c.key] ?? '';"
c_new = "else if (c.key === 'type_receive_date') { cellValue = row[c.key] ?? ''; cellAlign = 'center'; } // MARKER_VATWATCHLISTOPS_TYPE_ABF_V8\n                        else cellValue = row[c.key] ?? '';"
c_new = fx(c_new)
if s.count(h_old) != 1 or s.count(c_old) != 1:
    print('ERROR: anchor ไม่ตรง h=%d c=%d (ต้อง 1/1) - ไม่เขียนไฟล์' % (s.count(h_old), s.count(c_old))); sys.exit(1)
s = s.replace(h_old, h_new).replace(c_old, c_new)
if not os.path.exists(P + '.bak'): shutil.copy(P, P + '.bak')
open(P, 'wb').write(s.encode('utf-8'))
print('OK: patched ->', P)
