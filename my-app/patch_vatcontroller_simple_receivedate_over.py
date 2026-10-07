# -*- coding: utf-8 -*-
# patch: Simple Input / ADI (GL-TransferVat + Full Page) ตอน Over Period ON -> Receive Date (acc_date) ใช้เดือนถัดไปของ Period (Asset = วันที่ 15 / Expense = วันสุดท้ายของเดือน)
#        ให้ตรงกับ period (MM-YYYY ที่ขยับเป็นเดือนถัดไปอยู่แล้ว) และ status 'fu-draft' (เดิมวันที่ยังเป็นเดือนของ Period ปัจจุบัน)
import sys, re
p = sys.argv[1]; o = sys.argv[2]
s = open(p, encoding='utf-8-sig').read()
key = "let simpleReceiveDateFP;"
refs = ["quickActionOverRef", "addTaxInvoiceOverRef"]
pos = [m.start() for m in re.finditer(re.escape(key), s)]
assert len(pos) == 2, pos
for idx, (i, ref) in reversed(list(enumerate(zip(pos, refs)))):
    start = i; seg_end = s.index("simpleReceiveDateFP = `${ymExpFP[0]}", start); seg_end = s.index("\n", seg_end)
    seg = s[start:seg_end]
    assert seg.count("currentPeriodMonthFP") == 4, seg.count("currentPeriodMonthFP")
    seg = seg.replace("currentPeriodMonthFP", "recvYmFP")
    seg = seg.replace(key, f"const recvYmFP = ({ref}.current ? vatShiftYm(currentPeriodMonthFP, 1) : currentPeriodMonthFP); // MARKER_SIMPLE_RECEIVEDATE_OVER_V1 -- Over ON = เดือนถัดไป ให้ตรงกับ period\n" + " " * 0 + key, 1)
    s = s[:start] + seg + s[seg_end:]
# ADI Period (JAN-26 รูปแบบ) ตอน Over ON ใช้เดือนถัดไปด้วย ให้ตรงกับ period / acc_date
a = "= (currentPeriodMonthFP || '').split('-').map(Number);"
assert s.count(a) == 2, s.count(a)
s = s.replace(a, "= (recvYmFP || '').split('-').map(Number); // MARKER_SIMPLE_RECEIVEDATE_OVER_V1 -- ADI Period ตาม Over")
open(o, 'w', encoding='utf-8-sig', newline='').write(s)
