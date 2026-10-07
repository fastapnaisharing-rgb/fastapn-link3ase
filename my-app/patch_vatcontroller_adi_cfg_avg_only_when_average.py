# -*- coding: utf-8 -*-
# patch_vatcontroller_adi_cfg_avg_only_when_average.py
# Simple Ops ⚙ ADI Config: แถวเฉลี่ย (45700/63050000) ขึ้นเฉพาะ Rate BU เป็นตัวเลขและ != 100
import sys, shutil, io
P = r'src\pages\VatController.js' if len(sys.argv) < 2 else sys.argv[1]
MARK = 'MARKER_VATCONTROLLER_ADI_CFG_AVG_ONLY_WHEN_AVERAGE_V1'
s = io.open(P, encoding='utf-8').read()
if MARK in s:
    print('already patched'); sys.exit(0)
old = "const avg = (isAdiAverageCase || classifyAdiAccount(adiRow1DebitAccount) === 'EXPENSE') && !adiAmtChanged;"
new = "const avg = (isAdiAverageCase || classifyAdiAccount(adiRow1DebitAccount) === 'EXPENSE') && adiAverageRatePct !== undefined && isFinite(adiAverageRatePct) && Number(adiAverageRatePct) < 100 && !adiAmtChanged; /* " + MARK + " */"
assert s.count(old) == 1, 'anchor1'
s = s.replace(old, new)
shutil.copyfile(P, P + '.bak')
io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('patched')
