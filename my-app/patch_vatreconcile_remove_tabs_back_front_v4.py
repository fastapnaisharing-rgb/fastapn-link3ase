# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_NO_TABBAR_BACK_BTN_V4
# Popup Input Reconcile: เอาแถบแท็บ [Reconcile][Input Summary][Simple] ด้านบนออก -- เข้าหน้า Detail ผ่านไอคอนในหน้า Cover เท่านั้น
# หน้า Detail มีปุ่ม "‹ กลับ Reconcile" + ชื่อสาขา + (ถ้า BU มี Simple) แท็บย่อย Input Summary / Simple
# ต้องรันหลัง patch_vatreconcile_detail_icon_front_v3.py
# ใช้: python patch_vatreconcile_remove_tabs_back_front_v4.py <path ของ src\pages\VatReconcileDashboard.js>
import sys, shutil, os

MARKER = "MARKER_VATRECONCILE_NO_TABBAR_BACK_BTN_V4"

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
if "MARKER_VATRECONCILE_DETAIL_ICON_V3" not in src:
    print("[ABORT] ต้องรัน patch_vatreconcile_detail_icon_front_v3.py ก่อน")
    sys.exit(1)

old = """        {!loading && !error && data && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px 0', flexShrink: 0, flexWrap: 'wrap' }}>
            {[['reconcile', 'Reconcile'], ['input', 'Input Summary'], ...(simpleType ? [['simple', simpleType === 'simple_avg' ? 'Simple AVG' : 'Simple 100%']] : [])].map(([k, label]) => (
              <button key={k} type="button" onClick={() => goView(k)}
                style={{ padding: '5px 14px', fontSize: 12.5, fontWeight: 700, borderRadius: 6, cursor: 'pointer', border: `1px solid ${RP_BORDER}`, background: view === k ? '#24292f' : '#fff', color: view === k ? '#fff' : '#24292f' }}>
                {label}
              </button>
            ))}
            {view !== 'reconcile' && selBranch && ("""
new = """        {/* MARKER_VATRECONCILE_NO_TABBAR_BACK_BTN_V4 -- ไม่มีแถบแท็บ: เข้า Detail ผ่านไอคอนในหน้า Cover เท่านั้น / มีปุ่มกลับ */}
        {!loading && !error && data && view !== 'reconcile' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px 0', flexShrink: 0, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => goView('reconcile', '')}
              style={{ padding: '5px 14px', fontSize: 12.5, fontWeight: 700, borderRadius: 6, cursor: 'pointer', border: `1px solid ${RP_BORDER}`, background: '#fff', color: '#24292f' }}>
              ‹ กลับ Reconcile
            </button>
            {simpleType && [['input', 'Input Summary'], ['simple', simpleType === 'simple_avg' ? 'Simple AVG' : 'Simple 100%']].map(([k, label]) => (
              <button key={k} type="button" onClick={() => goView(k)}
                style={{ padding: '5px 14px', fontSize: 12.5, fontWeight: 700, borderRadius: 6, cursor: 'pointer', border: `1px solid ${RP_BORDER}`, background: view === k ? '#24292f' : '#fff', color: view === k ? '#fff' : '#24292f' }}>
                {label}
              </button>
            ))}
            {view !== 'reconcile' && selBranch && ("""
src = safe_replace(src, old, new, "tab bar")

# ข้อความ Placeholder (เข้าหน้า Input โดยไม่มีสาขา เช่น สลับจาก Simple)
src = safe_replace(src,
    "เลือกสาขาจากแท็บ Reconcile แล้วกด",
    "เลือกสาขาจากหน้า Reconcile แล้วกด",
    "placeholder")

n = 1
while os.path.exists(f"{path}.bak{n:02d}"):
    n += 1
shutil.copyfile(path, f"{path}.bak{n:02d}")
out = src.replace("\n", "\r\n") if crlf else src
with open(path, "wb") as f:
    f.write(out.encode("utf-8"))
print(f"[OK] patched {path} (backup .bak{n:02d})")
