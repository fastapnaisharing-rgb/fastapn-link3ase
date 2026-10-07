# -*- coding: utf-8 -*-
# patch_vatcontroller_draftmonitor_adi_accdate_format.py
# Draft Monitor > Upload ADI: คอลัมน์ Acc Date แสดง DD-MMM-YY (เดิมแสดง YYYY-MM-DD ดิบ)
import sys, io, shutil
P = r'src\pages\VatController.js' if len(sys.argv) < 2 else sys.argv[1]
MARK = 'MARKER_VATCONTROLLER_DRAFTMONITOR_ADI_ACCDATE_DDMMMYY_V1'
s = io.open(P, encoding='utf-8').read()
if MARK in s:
    print('already patched'); sys.exit(0)
old = "{ADI_DRAFT_COLUMNS.map((c) => ( // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_ADI_BLANK_NULL_V1 -- ปล่อยว่างแทน — เมื่อไม่มีข้อมูล"
i = 0; n = 0
while True:
    i = s.find(old, i)
    if i < 0: break
    j = s.index("</td>", i)
    seg = s[i:j]
    cell = "{row[c.key] ?? ''}"
    assert cell in seg, 'cell anchor'
    new_seg = seg.replace(cell, "{c.key === 'acc_date' ? (formatDateDDMMMYY(row[c.key]) || '') : (row[c.key] ?? '')}" + " {/* " + MARK + " */}", 1)
    s = s[:i] + new_seg + s[j:]
    i = i + len(new_seg); n += 1
assert n == 2, 'expected 2 Draft Monitor ADI tables, got %d' % n
shutil.copyfile(P, P + '.bak')
io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('patched', n)
