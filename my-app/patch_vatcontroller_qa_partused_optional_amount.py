# patch_vatcontroller_qa_partused_optional_amount.py -- Modal B: จำนวนเงิน/รายละเอียดเพิ่ม ไม่บังคับ (บังคับเฉพาะวันที่)
import sys, io
P = sys.argv[1]
s = io.open(P, encoding='utf-8', newline='').read()
MARK = 'MARKER_VATWATCHLISTOPS_QA_PARTUSED_OPTIONAL_AMOUNT_V1'
if MARK in s:
    print('already applied'); sys.exit(0)
edits = [
 ("const okB = !!(qaPopBDate && Number(qaPopBAmount) > 0);", "const okB = !!qaPopBDate; /* " + MARK + " */"),
 ("ระบุรายละเอียดส่วนที่เคยใช้ไปแล้ว (จำเป็นต้องกรอกทุกช่อง) --", "ระบุรายละเอียดส่วนที่เคยใช้ไปแล้ว (บังคับกรอกเฉพาะวันที่) --"),
]
for o, n in edits:
    if s.count(o) != 1:
        print('FAIL count=%d: %s' % (s.count(o), o[:80])); sys.exit(1)
    s = s.replace(o, n)
io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('OK')
