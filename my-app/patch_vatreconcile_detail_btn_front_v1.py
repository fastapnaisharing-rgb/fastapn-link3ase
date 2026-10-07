# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_DETAIL_BTN_BRANCH_ONLY_V1
# Popup Input Reconcile: เพิ่มคอลัมน์ปุ่ม "Detail" ท้ายแถวสาขา กดแล้วดึง Input Summary Detail เฉพาะสาขานั้น
# (รองรับหลายร้อย/พันสาขา) -- เข้าแท็บ Input Summary เฉยๆ จะไม่โหลดทุกสาขาอัตโนมัติ ต้องกด "โหลดทุกสาขา" เอง
# ต้องใช้คู่กับ patch_vatreconcile_detail_btn_back_v1.py (Backend รองรับ ?branch= ของ input_summary detail)
# ใช้: python patch_vatreconcile_detail_btn_front_v1.py <path ของ src\pages\VatReconcileDashboard.js>
import sys, shutil, os

MARKER = "MARKER_VATRECONCILE_DETAIL_BTN_BRANCH_ONLY_V1"

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

# 1) tabKey แยก Cache ต่อสาขาสำหรับ Input Summary
src = safe_replace(src,
    "const tabKey = (v, b) => (v === 'simple' ? `simple|${b}` : 'input|');",
    "const tabKey = (v, b) => (v === 'simple' ? `simple|${b}` : `input|${b || ''}`); // " + MARKER,
    "tabKey")

# 2) goView: ไม่โหลดทุกสาขาอัตโนมัติ (ต้อง force) + ส่ง branch ให้ Input Summary ด้วย
src = safe_replace(src,
    """  const goView = (v, branch) => {
    const b = branch === undefined ? selBranch : branch;
    setView(v);
    setSelBranch(b);
    if (v === 'reconcile') return;
    const key = tabKey(v, b);""",
    """  const goView = (v, branch, force) => {
    const b = branch === undefined ? selBranch : branch;
    setView(v);
    setSelBranch(b);
    if (v === 'reconcile') return;
    if (v === 'input' && !b && !force) return; // """ + MARKER + """ -- ไม่เลือกสาขา = ไม่โหลดทุกสาขาเอง (ต้องกด "โหลดทุกสาขา")
    const key = tabKey(v, b);""",
    "goView")
src = safe_replace(src,
    "view: 'detail', branch: v === 'simple' && b ? b : undefined })",
    "view: 'detail', branch: b || undefined })",
    "goView fetch")

# 3) แสดง Placeholder แทน "กำลังโหลด..." เมื่อเข้าแท็บ Input Summary โดยยังไม่เลือกสาขา
src = safe_replace(src,
    "              {(!curTab || curTab.loading) && <p style={{ fontSize: 13, color: '#666' }}>กำลังโหลด...</p>}",
    """              {view === 'input' && !selBranch && !curTab && (
                <div style={{ padding: '24px 4px', fontSize: 13, color: '#57606a' }}>
                  <p style={{ margin: '0 0 10px' }}>เลือกสาขาจากแท็บ Reconcile แล้วกดปุ่ม <b>Detail</b> ท้ายแถว เพื่อดูรายการของสาขานั้น</p>
                  <button type="button" onClick={() => goView('input', '', true)} style={{ fontSize: 12.5, cursor: 'pointer', border: `1px solid ${RP_BORDER}`, borderRadius: 6, background: '#fff', padding: '5px 14px' }}>โหลดทุกสาขา (ข้อมูลอาจมาก)</button>
                </div>
              )}
              {((!curTab && !(view === 'input' && !selBranch)) || curTab?.loading) && <p style={{ fontSize: 13, color: '#666' }}>กำลังโหลด...</p>}""",
    "placeholder")

# 4) ปุ่ม "ดูทุกสาขา" และ Total Diff = สั่งโหลดทุกสาขาโดยตั้งใจ
src = safe_replace(src,
    "onClick={() => goView(view, '')} style={{ marginLeft: 8,",
    "onClick={() => goView(view, '', true)} style={{ marginLeft: 8,",
    "ดูทุกสาขา")
src = safe_replace(src,
    "onClick={Math.abs(data.totals.diff) > 0.005 ? () => goView('input', '') : undefined}",
    "onClick={Math.abs(data.totals.diff) > 0.005 ? () => goView('input', '', true) : undefined}",
    "total diff")

# 5) ตาราง Reconcile: ปุ่ม Detail ท้ายแถว (เอา Click ทั้งแถวออก)
src = safe_replace(src,
    "<th rowSpan={2} style={th({ top: 0 })}>NOTE/STATUS</th>",
    "<th rowSpan={2} style={th({ top: 0 })}>NOTE/STATUS</th>\n                      <th rowSpan={2} style={th({ top: 0 })}>Detail</th>",
    "th detail")
src = safe_replace(src,
    "<td colSpan={3 + nPairs * 2 + 3} style=",
    "<td colSpan={3 + nPairs * 2 + 4} style=",
    "empty colspan")
src = safe_replace(src,
    "<tr key={r.branch} onClick={attn ? () => goView('input', r.branch) : undefined} title={attn ? 'กดเพื่อดู Detail (Input Summary)' : undefined} style={{ cursor: attn ? 'pointer' : 'default' }}>",
    "<tr key={r.branch}>",
    "row click")
src = safe_replace(src,
    """                            {attn && <span style={{ marginLeft: 6, color: '#0969da', fontSize: 11.5 }}>ดู Detail ›</span>}
                          </td>""",
    """                          </td>
                          <td style={{ ...tdBase, textAlign: 'center', whiteSpace: 'nowrap' }}>
                            {attn ? (
                              <button type="button" onClick={() => goView('input', r.branch)} title="ดู Detail (Input Summary) ของสาขานี้"
                                style={{ padding: '3px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6, cursor: 'pointer', border: '1px solid #0969da', background: '#fff', color: '#0969da' }}>Detail</button>
                            ) : <span style={{ color: '#9aa4b2' }}>-</span>}
                          </td>""",
    "detail btn")
src = safe_replace(src,
    """ background: RP_HEAD_GRAD, position: 'sticky', bottom: 0, borderTop: `2px solid ${RP_BORDER}` }} />
                    </tr>""",
    """ background: RP_HEAD_GRAD, position: 'sticky', bottom: 0, borderTop: `2px solid ${RP_BORDER}` }} />
                      <td style={{ ...tdBase, background: RP_HEAD_GRAD, position: 'sticky', bottom: 0, borderTop: `2px solid ${RP_BORDER}` }} />
                    </tr>""",
    "total row cell")
src = safe_replace(src,
    "(Receive Date น้อยกว่า Tax Invoice Date) — กดแถวสาขาเพื่อดู Detail",
    "(Receive Date น้อยกว่า Tax Invoice Date) — กดปุ่ม Detail ท้ายแถวสาขาเพื่อดูรายการ",
    "notice text")

n = 1
while os.path.exists(f"{path}.bak{n:02d}"):
    n += 1
shutil.copyfile(path, f"{path}.bak{n:02d}")
out = src.replace("\n", "\r\n") if crlf else src
with open(path, "wb") as f:
    f.write(out.encode("utf-8"))
print(f"[OK] patched {path} (backup .bak{n:02d})")
