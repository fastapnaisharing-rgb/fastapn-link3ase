# -*- coding: utf-8 -*-
# MARKER_VATCONTROLLER_SIMPLEOPS_DEFAULTVAT_TOPROW_V1 -- ย้ายช่อง Default (Vat) จากท้ายกรอบ Credit ขึ้นไปท้ายแถวบน (ต่อจาก PO number) ตาม Mockup ที่ Confirm
import sys, shutil
M = 'MARKER_VATCONTROLLER_SIMPLEOPS_DEFAULTVAT_TOPROW_V1'
path = sys.argv[1]
raw = open(path, 'rb').read(); bom = raw.startswith(b'\xef\xbb\xbf')
s = raw.decode('utf-8-sig')
if M in s: print('already patched'); sys.exit(0)
shutil.copyfile(path, path + '.bak_defvat_move')
def rep(old, new):
    global s
    n = s.count(old); assert n == 1, f'anchor count={n}: {old[:70]}'
    s = s.replace(old, new)

# 1) ตัดบล็อกคอลัมน์ที่ 3 ออกจากกรอบ Debit/Credit
start_marker = "            {/* MARKER_VATCONTROLLER_SIMPLEOPS_ADI_DEFAULT_AMOUNT_V1 -- ช่อง Default (Vat) หลัง Credit"
i = s.index(start_marker); assert s.count(start_marker) == 1
tail = "            </div>\n          </div>\n          </div>\n          <div style={{ position: 'relative', padding: '16px', border: '1.5px solid transparent'"
j = s.index(tail, i)
block = s[i:j + len("            </div>\n")]
s = s[:i] + s[j + len("            </div>\n"):]

# 2) คืน Grid 2 คอลัมน์ + เส้นแบ่ง
rep("gridTemplateColumns: '1fr 1fr 0.5fr', border: '0.5px solid #e8eaf0'", "gridTemplateColumns: '1fr 1fr', border: '0.5px solid #e8eaf0'")
rep("<div key={side.key} style={{ borderRight: '0.5px solid #e8eaf0' }}>", "<div key={side.key} style={{ borderRight: si === 0 ? '0.5px solid #e8eaf0' : 'none' }}>")

# 3) ช่องใหม่ท้ายแถวบน
NEW = (
f"            {{/* {M} -- Default (Vat) ท้ายแถวบน: ค่าเริ่มต้น = Vat ที่คำนวณจาก Amount / แก้ให้ต่าง -> Simple No/No/No + ADI Manual-ADJ (ใช้ยอดที่แก้ Dr./Cr. ตามกรอบ Debit/Credit) */}}\n"
"            <div style={{ flex: '14 1 0%', minWidth: 0 }}>\n"
"              <label style={{ display: 'block', fontSize: '12px', fontWeight: '500', color: '#8a5a00', marginBottom: '5px' }}>Default (Vat)</label>\n"
"              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>\n"
"                <input\n"
"                  type=\"text\"\n"
"                  value={adiAmtDisplay}\n"
"                  readOnly={!totalRowCalc}\n"
"                  onChange={(e) => setAdiRow1AdiAmt(e.target.value)}\n"
"                  onBlur={(e) => { const num = parseFloat(String(e.target.value || '').replace(/,/g, '').trim()); if (isNaN(num) || !totalRowCalc || Math.abs(num - totalRowCalc.vatNum) < 0.005) { setAdiRow1AdiAmt(''); } else { setAdiRow1AdiAmt(num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })); } }}\n"
"                  placeholder=\"Vat\"\n"
"                  title={adiAmtChanged ? 'แก้ยอดแล้ว -> Simple = No/No/No ทุกกรณี และ ADI = Manual-ADJ' : 'ค่าเริ่มต้น = Vat ที่คำนวณจาก Amount (แก้ได้ ถ้าต้องการให้ ADI คนละยอดกับ Simple)'}\n"
"                  style={{ flex: 1, minWidth: 0, width: '100%', boxSizing: 'border-box', height: '34px', fontSize: '13px', padding: '0 10px', textAlign: 'right', border: adiAmtChanged ? '1.5px solid #e08a00' : '1px solid #f2d9a6', background: adiAmtChanged ? '#fff1d6' : '#fff8e8', borderRadius: '8px', outline: 'none', color: '#8a5a00' }}\n"
"                />\n"
"                {adiAmtChanged && (<button type=\"button\" tabIndex={-1} title=\"คืนค่า Default (Vat)\" onClick={() => setAdiRow1AdiAmt('')} style={{ flexShrink: 0, width: '26px', height: '34px', border: '1px solid #f2c777', borderRadius: '8px', background: '#fff', color: '#8a5a00', cursor: 'pointer', padding: 0, fontSize: '13px' }}>↺</button>)}\n"
"              </div>\n"
"            </div>\n"
)
anchor = "            </div>\n          </div>\n\n          {/* MARKER_VATCONTROLLER_SIMPLE_INPUT_OPS_ADI_ROW1_DEBITCREDIT_DEFAULTS_V5"
assert s.count(anchor) == 1, s.count(anchor)
s = s.replace(anchor, "            </div>\n" + NEW + "          </div>\n\n          {/* MARKER_VATCONTROLLER_SIMPLE_INPUT_OPS_ADI_ROW1_DEBITCREDIT_DEFAULTS_V5")
open(path, 'wb').write((b'\xef\xbb\xbf' if bom else b'') + s.encode('utf-8'))
print('patched OK')
