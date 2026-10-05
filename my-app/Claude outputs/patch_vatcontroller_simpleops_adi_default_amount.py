# -*- coding: utf-8 -*-
# MARKER_VATCONTROLLER_SIMPLEOPS_ADI_DEFAULT_AMOUNT_V1 -- Simple Input Ops: ช่อง "Default (Vat)" หลัง Credit -- แก้ยอด -> Simple = No/No/No ทุกกรณี + ADI = Manual-ADJ (ใช้ยอดที่แก้)
import sys, shutil
M = 'MARKER_VATCONTROLLER_SIMPLEOPS_ADI_DEFAULT_AMOUNT_V1'
path = sys.argv[1]
raw = open(path, 'rb').read()
bom = raw.startswith(b'\xef\xbb\xbf')
s = raw.decode('utf-8-sig')
if M in s:
    print('already patched'); sys.exit(0)
shutil.copyfile(path, path + '.bak_adidefault')
def rep(old, new, count=1):
    global s
    n = s.count(old); assert n == count, f'anchor count={n} (expect {count}): {old[:70]}'
    s = s.replace(old, new)

# 1) State
rep("  const [adiRow1PoNum, setAdiRow1PoNum] = React.useState('');\n",
    "  const [adiRow1PoNum, setAdiRow1PoNum] = React.useState('');\n"
    f"  const [adiRow1AdiAmt, setAdiRow1AdiAmt] = React.useState(''); // {M} -- '' = ยังไม่แก้ (ใช้ Default = Vat ที่คำนวณจาก Amount)\n")

# 2) ค่า Default / ตรวจว่าแก้ยอดไหม (หลัง totalRowCalc ถูกคำนวณ)
rep("          // MARKER_VATCONTROLLER_SIMPLE_INPUT_OPS_ADI_SEGMENTALL_AUTOFILL_V1 -- เมื่อเข้าเงื่อนไข Interbranch",
    f"          // {M} -- Default (Vat) = Vat ที่คำนวณจาก Amount / ถ้าผู้ใช้แก้ให้ต่างจาก Vat -> Manual-ADJ: Simple = No/No/No ทุกกรณี + ADI ใช้ยอดที่แก้ (ออก ADI แม้ Dr=Cr)\n"
    "          const adiAmtOverrideNum = parseFloat(String(adiRow1AdiAmt || '').replace(/,/g, '').trim());\n"
    "          const adiAmtChanged = !!totalRowCalc && String(adiRow1AdiAmt || '').trim() !== '' && !isNaN(adiAmtOverrideNum) && Math.abs(adiAmtOverrideNum - totalRowCalc.vatNum) >= 0.005;\n"
    "          const adiAmtDisplay = String(adiRow1AdiAmt || '') !== '' ? adiRow1AdiAmt : (totalRowCalc ? totalRowCalc.vat : '');\n"
    "          // MARKER_VATCONTROLLER_SIMPLE_INPUT_OPS_ADI_SEGMENTALL_AUTOFILL_V1 -- เมื่อเข้าเงื่อนไข Interbranch")

# 3) Trigger ADI เมื่อแก้ยอด
rep("const adiTriggered = ibOfinMismatch || isAssetAdiCase;",
    "const adiTriggered = ibOfinMismatch || isAssetAdiCase || adiAmtChanged;")

# 4) Badge ADI Journal
rep("const adiJournalMainStatus = !adiTriggered ? 'Standby' : (isAssetAdiCase ?",
    "const adiJournalMainStatus = !adiTriggered ? 'Standby' : (adiAmtChanged ? 'Manual-ADJ' : isAssetAdiCase ?")
# 5) บรรทัด ADI ตามยอดที่แก้ (Dr/Cr ตามกรอบ Debit/Credit)
rep("          let adiSegmentAutoRows = null;\n          if (isAdiAverageCase) {",
    "          let adiSegmentAutoRows = null;\n"
    f"          if (adiAmtChanged) {{ // {M} -- Manual-ADJ: 2 บรรทัด Dr/Cr ตามกรอบ Debit/Credit ใช้ยอดที่ผู้ใช้แก้\n"
    "            adiSegmentAutoRows = [\n"
    "              { segmentAll: [...buildSegmentAllPrefix(), adiRow1DebitOfin, adiRow1DebitCpc, adiRow1DebitAccount, adiRow1DebitSubAcc].filter((v) => String(v || '').trim()).join('-'), lineValue: fmtTotalRow(adiAmtOverrideNum), side: 'Dr', rate: debitBranchMatch ? String(debitBranchMatch['%'] || '') : '' },\n"
    "              { segmentAll: [...buildSegmentAllPrefix(), adiRow1CreditOfin, adiRow1CreditCpc, adiRow1CreditAccount, adiRow1CreditSubAcc].filter((v) => String(v || '').trim()).join('-'), lineValue: fmtTotalRow(adiAmtOverrideNum), side: 'Cr', rate: creditBranchMatch ? String(creditBranchMatch['%'] || '') : '' },\n"
    "            ];\n"
    "          } else if (isAdiAverageCase) {")

# 6) UI: Grid 3 คอลัมน์ + ช่อง Default (Vat) หลัง Credit
rep("<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', border: '0.5px solid #e8eaf0', borderRadius: '6px', overflow: 'hidden', marginTop: '10px' }}>",
    "<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 0.5fr', border: '0.5px solid #e8eaf0', borderRadius: '6px', overflow: 'hidden', marginTop: '10px' }}>")
rep("<div key={side.key} style={{ borderRight: si === 0 ? '0.5px solid #e8eaf0' : 'none' }}>",
    "<div key={side.key} style={{ borderRight: '0.5px solid #e8eaf0' }}>")
UI = (
"            })}\n"
f"            {{/* {M} -- ช่อง Default (Vat) หลัง Credit: ค่าเริ่มต้น = Vat ที่คำนวณ / แก้ให้ต่าง -> Simple No/No/No + ADI Manual-ADJ */}}\n"
"            <div>\n"
"              <div style={{ padding: '4px 10px', fontSize: '10.5px', color: '#8a5a00', background: adiAmtChanged ? '#ffe8b8' : '#fff4e0', fontWeight: '600', textAlign: 'center', borderBottom: '0.5px solid #e8eaf0' }}>Default (Vat)</div>\n"
"              <div style={{ padding: '4px 6px', display: 'flex', alignItems: 'center', gap: '4px' }}>\n"
"                <input\n"
"                  value={adiAmtDisplay}\n"
"                  readOnly={!totalRowCalc}\n"
"                  onChange={(e) => setAdiRow1AdiAmt(e.target.value)}\n"
"                  onBlur={(e) => { const num = parseFloat(String(e.target.value || '').replace(/,/g, '').trim()); if (isNaN(num) || !totalRowCalc || Math.abs(num - totalRowCalc.vatNum) < 0.005) { setAdiRow1AdiAmt(''); } else { setAdiRow1AdiAmt(num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })); } }}\n"
"                  placeholder=\"Vat\"\n"
"                  title={adiAmtChanged ? 'แก้ยอดแล้ว -> Simple = No/No/No ทุกกรณี และ ADI = Manual-ADJ' : 'ค่าเริ่มต้น = Vat ที่คำนวณจาก Amount (แก้ได้ ถ้าต้องการให้ ADI คนละยอดกับ Simple)'}\n"
"                  style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', height: '26px', fontSize: '11.5px', padding: '0 6px', textAlign: 'right', border: adiAmtChanged ? '1.5px solid #e08a00' : '1px solid #f2d9a6', background: adiAmtChanged ? '#fff1d6' : '#fff8e8', borderRadius: '4px', outline: 'none', color: '#8a5a00' }}\n"
"                />\n"
"                {adiAmtChanged && (<button type=\"button\" tabIndex={-1} title=\"คืนค่า Default (Vat)\" onClick={() => setAdiRow1AdiAmt('')} style={{ flexShrink: 0, width: '22px', height: '26px', border: '1px solid #f2c777', borderRadius: '4px', background: '#fff', color: '#8a5a00', cursor: 'pointer', padding: 0, fontSize: '12px' }}>↺</button>)}\n"
"              </div>\n"
"            </div>\n"
"          </div>\n"
"          </div>\n"
)
OLD_UI = "            })}\n          </div>\n          </div>\n          <div style={{ position: 'relative', padding: '16px', border: '1.5px solid transparent'"
assert s.count(OLD_UI) == 1, s.count(OLD_UI)
s = s.replace(OLD_UI, UI + "          <div style={{ position: 'relative', padding: '16px', border: '1.5px solid transparent'")

# 7) Reset ตอน Add / Clear และเมื่อ Amount / Type เปลี่ยน
rep("                setAdiRow1AmountType('GRO+VT');\n                setAdiRow1PoNum('');\n",
    "                setAdiRow1AmountType('GRO+VT');\n                setAdiRow1AdiAmt('');\n                setAdiRow1PoNum('');\n", count=2)
rep("onChange={(e) => setAdiRow1Amount(e.target.value)}", "onChange={(e) => { setAdiRow1Amount(e.target.value); setAdiRow1AdiAmt(''); }}")
rep("onChange={(e) => setAdiRow1AmountType(e.target.value)}", "onChange={(e) => { setAdiRow1AmountType(e.target.value); setAdiRow1AdiAmt(''); }}")

open(path, 'wb').write((b'\xef\xbb\xbf' if bom else b'') + s.encode('utf-8'))
print('patched OK')
