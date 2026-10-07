# -*- coding: utf-8 -*-
# patch: Draft Monitor (Upload Popvat / Simple / ADI) ดึงทั้ง draft และ fu-draft (Over Period) -- เดิมดึงแค่ draft ทำให้รายการ Over ไม่โผล่
import sys
p = sys.argv[1]; o = sys.argv[2]
lines = open(p, encoding='utf-8-sig').read().split('\n')
targets = ['/vat_upload_popvatdraft?eq_bu=${encodeURIComponent(bu.bu)}&eq_status=draft`', '/vat_simpleinputdraft?eq_bu=${encodeURIComponent(bu.bu)}&eq_status=draft`', '/vat_adi_transferdraft?eq_bu=${encodeURIComponent(bu.bu)}&eq_status=draft`']
n = 0
for i, ln in enumerate(lines):
    for t in targets:
        if t in ln and 'bu.bu' in ln and (i < 8100 or 14900 < i < 15200):
            lines[i] = ln.replace('&eq_status=draft`', '&in_status=draft,fu-draft`') + ' // MARKER_DRAFTMONITOR_INCLUDE_FU_V1'
            n += 1
assert n == 6, n
open(o, 'w', encoding='utf-8-sig', newline='').write('\n'.join(lines))
