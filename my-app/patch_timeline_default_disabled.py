# -*- coding: utf-8 -*-
# MARKER_TIMELINE_BU_DEFAULT_DISABLED_V1
# BU ที่ยังไม่มีข้อมูลบันทึก (ยังไม่เปิดใช้งานจริง) เริ่มต้นเป็น Disable ทุกช่อง แทน Enable ทั้งหมด -- ไม่มี Logic Rate/Tax Type ใดๆ
import sys, io
path = sys.argv[1]
src = io.open(path, encoding="utf-8").read()
M = "MARKER_TIMELINE_BU_DEFAULT_DISABLED_V1"
if M in src:
    print("already patched"); sys.exit(0)

def rep(old, new, label):
    global src
    assert src.count(old) == 1, "anchor count != 1: %s (found %d)" % (label, src.count(old))
    src = src.replace(old, new)

rep("// Active/Inactive อ้างอิงสถานะจาก VAT Config (company_list)",
'''// ''' + M + ''' -- BU ที่ยังไม่เคย Setting/ยังไม่เปิดใช้งานจริง: เริ่มต้น Disable ทุกช่อง (ผู้ใช้ Enable เองทีหลัง) ไม่ใช้ค่าตามตัวอย่าง
function allDisabledTasks() {
  const t = allEnabledTasks();
  Object.keys(t).forEach((k) => { t[k].mode = "X"; });
  return t;
}
const allDisabledReq = () => REQ_GROUPS.reduce((r, g) => ({ ...r, [g]: REQ_KEYS.reduce((o, k) => ({ ...o, [k]: "X" }), {}) }), {});
const allDisabledRpt = () => { const mk = () => RPT_CODES.reduce((r, c) => ({ ...r, [c]: { inc: "X", inp: "X" } }), {}); return { first: mk(), final: mk() }; };
const allDisabledVat = () => makeVat(["X", "X", "X", "X", "X", "X", "X", "X", "X", ""]); // การ์ด Closing Vat 9 ใบ Disable (Transfer Vat Status ไม่มีสวิตช์ Enable)
// Active/Inactive อ้างอิงสถานะจาก VAT Config (company_list)''', "helpers")

rep('tasks: allEnabledTasks(), ids: ["", "", "", "", "", ""], vat: makeVat(["", "", "", "", "", "", "", "", "", ""]), req: makeReq(""), rpt: makeRpt("", true),',
    'tasks: allDisabledTasks(), ids: ["", "", "", "", "", ""], vat: allDisabledVat(), req: allDisabledReq(), rpt: allDisabledRpt(), /* ' + M + ' */', "mkRealBu")

io.open(path, "w", encoding="utf-8", newline="").write(src)
print("patched OK")
