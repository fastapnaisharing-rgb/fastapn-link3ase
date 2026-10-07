# patch_vatcontroller_qa_partused_remark_amount.py -- Modal B: ต่อ "จำนวนเงิน" + "รายละเอียดเพิ่มเติม" ท้าย Remark
import sys, io
P = sys.argv[1]
s = io.open(P, encoding='utf-8', newline='').read()
MARK = 'MARKER_VATWATCHLISTOPS_QA_PARTUSED_REMARK_AMOUNT_V1'
if MARK in s:
    print('already applied'); sys.exit(0)
AMT = "(Number(qaPopBAmount) > 0 ? ` จำนวน ${Number(qaPopBAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '')"
edits = [
 ("{`ใช้สิทธิ์ไปแล้วบางส่วน${qaPopBDate ? ` วันที่ ${qaPopBDate.split('-').reverse().join('/')}` : ''}` + (qaPopBExtra.trim()",
  "{`ใช้สิทธิ์ไปแล้วบางส่วน${qaPopBDate ? ` วันที่ ${qaPopBDate.split('-').reverse().join('/')}` : ''}` + " + AMT + " + (qaPopBExtra.trim()"),
 ("const remarkB = `ใช้สิทธิ์ไปแล้วบางส่วน วันที่ ${qaPopBDate.split('-').reverse().join('/')}` + (qaPopBExtra.trim()",
  "const remarkB = `ใช้สิทธิ์ไปแล้วบางส่วน วันที่ ${qaPopBDate.split('-').reverse().join('/')}` + " + AMT + " + (qaPopBExtra.trim()"),
]
for o, n in edits:
    if s.count(o) != 1:
        print('FAIL count=%d: %s' % (s.count(o), o[:80])); sys.exit(1)
    s = s.replace(o, n)
s = s.replace("{/* MARKER_VATWATCHLISTOPS_QA_PARTUSED_REMARK_DATE_V1 */}", "{/* MARKER_VATWATCHLISTOPS_QA_PARTUSED_REMARK_DATE_V1 " + MARK + " */}", 1)
io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('OK')
