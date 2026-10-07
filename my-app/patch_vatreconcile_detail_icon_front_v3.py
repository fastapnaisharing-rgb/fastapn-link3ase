# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_DETAIL_ICON_V3
# หน้า Cover (Tab Reconcile): เปลี่ยนจากคอลัมน์ปุ่ม "Detail" ท้ายแถว เป็น "ไอคอน Detail" ในช่อง NOTE/STATUS (ซ้ายของป้ายสถานะ)
# ทุกสาขามีไอคอน (รวมสาขาที่ตรงกัน) -- กดแล้วสลับไปหน้า Input Summary Detail ของสาขานั้น (ดึงเฉพาะสาขา)
# ต้องรันหลัง patch_vatreconcile_detail_btn_front_v1.py
# ใช้: python patch_vatreconcile_detail_icon_front_v3.py <path ของ src\pages\VatReconcileDashboard.js>
import sys, shutil, os

MARKER = "MARKER_VATRECONCILE_DETAIL_ICON_V3"

def safe_replace(src, old, new, label):
    n = src.count(old)
    if n != 1:
        print(f"[ABORT] anchor '{label}' พบ {n} ครั้ง (ต้องเป็น 1) -- ไม่เขียนไฟล์")
        sys.exit(1)
    return src.replace(old, new)

path = sys.argv[1] if len(sys.argv) > 1 else r"D:\Users\LeKarn\fastapn-link3ase\my-app\src\pages\VatReconcileDashboard.js"
with open(path, "rb") as f:
    raw = f.read().decode("utf-8")
crlf = "\r\n" in raw
src = raw.replace("\r\n", "\n")

if MARKER in src:
    print("[SKIP] patch นี้ถูกใช้แล้ว")
    sys.exit(0)
if "MARKER_VATRECONCILE_DETAIL_BTN_BRANCH_ONLY_V1" not in src:
    print("[ABORT] ต้องรัน patch_vatreconcile_detail_btn_front_v1.py ก่อน")
    sys.exit(1)

# 1) เอาคอลัมน์ Detail ท้ายแถวออก (Header / ว่างตอนไม่มีข้อมูล / Total)
src = safe_replace(src,
    "<th rowSpan={2} style={th({ top: 0 })}>NOTE/STATUS</th>\n                      <th rowSpan={2} style={th({ top: 0 })}>Detail</th>",
    "<th rowSpan={2} style={th({ top: 0 })}>NOTE/STATUS</th>",
    "th detail")
src = safe_replace(src,
    "<td colSpan={3 + nPairs * 2 + 4} style=",
    "<td colSpan={3 + nPairs * 2 + 3} style=",
    "empty colspan")
src = safe_replace(src,
    """ background: RP_HEAD_GRAD, position: 'sticky', bottom: 0, borderTop: `2px solid ${RP_BORDER}` }} />
                      <td style={{ ...tdBase, background: RP_HEAD_GRAD, position: 'sticky', bottom: 0, borderTop: `2px solid ${RP_BORDER}` }} />
                    </tr>""",
    """ background: RP_HEAD_GRAD, position: 'sticky', bottom: 0, borderTop: `2px solid ${RP_BORDER}` }} />
                    </tr>""",
    "total row cell")

# 2) เอาปุ่ม Detail (คอลัมน์ท้าย) ออก
src = safe_replace(src,
    """                          </td>
                          <td style={{ ...tdBase, textAlign: 'center', whiteSpace: 'nowrap' }}>
                            {attn ? (
                              <button type="button" onClick={() => goView('input', r.branch)} title="ดู Detail (Input Summary) ของสาขานี้"
                                style={{ padding: '3px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6, cursor: 'pointer', border: '1px solid #0969da', background: '#fff', color: '#0969da' }}>Detail</button>
                            ) : <span style={{ color: '#9aa4b2' }}>-</span>}
                          </td>""",
    "                          </td>",
    "detail btn col")

# 3) ไอคอน Detail ในช่อง NOTE/STATUS ซ้ายของป้ายสถานะ -> สลับไปหน้า Input Summary ของสาขานั้น
src = safe_replace(src,
    "                            {pill(ok, r.status)}\n",
    """                            <button type="button" aria-label="ดู Detail" title="ดู Detail (Input Summary) ของสาขานี้" onClick={() => goView('input', r.branch)}
                              style={{ verticalAlign: 'middle', marginRight: 8, width: 24, height: 24, padding: 0, borderRadius: 6, cursor: 'pointer', border: '1px solid #0969da', background: '#fff', color: '#0969da', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2.5" y="1.5" width="11" height="13" rx="1.5" /><path d="M5 5.5h6M5 8h6M5 10.5h4" /></svg>
                            </button>
                            {pill(ok, r.status)}
""",
    "icon")

# 4) ข้อความแนะนำ
src = safe_replace(src,
    "กดปุ่ม Detail ท้ายแถวสาขาเพื่อดูรายการ",
    "กดไอคอน Detail ในช่อง NOTE/STATUS ของสาขาเพื่อดูรายการ",
    "notice text")
src = safe_replace(src,
    "<b>Detail</b> ท้ายแถว เพื่อดูรายการของสาขานั้น",
    "ไอคอน <b>Detail</b> ในช่อง NOTE/STATUS เพื่อดูรายการของสาขานั้น",
    "placeholder text")
src = safe_replace(src,
    "<p style={{ margin: '0 0 10px' }}>เลือกสาขาจากแท็บ Reconcile แล้วกดปุ่ม ",
    "<p style={{ margin: '0 0 10px' }}>เลือกสาขาจากแท็บ Reconcile แล้วกด",
    "placeholder lead")
src = src.replace("// MARKER_VATRECONCILE_DETAIL_BTN_BRANCH_ONLY_V1\n", "// MARKER_VATRECONCILE_DETAIL_BTN_BRANCH_ONLY_V1 | " + MARKER + "\n", 1) if False else src
src = src.replace("  const tabKey = (v, b) =>", "  // " + MARKER + "\n  const tabKey = (v, b) =>", 1)

n = 1
while os.path.exists(f"{path}.bak{n:02d}"):
    n += 1
shutil.copyfile(path, f"{path}.bak{n:02d}")
out = src.replace("\n", "\r\n") if crlf else src
with open(path, "wb") as f:
    f.write(out.encode("utf-8"))
print(f"[OK] patched {path} (backup .bak{n:02d})")
