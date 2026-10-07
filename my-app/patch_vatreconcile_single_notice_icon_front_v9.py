# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_SINGLE_NOTICE_ICON_V9
# ช่อง NOTE/STATUS: ไอคอนเดียวต่อแถว -- ปกติ = ไอคอน Detail (ฟ้า) / มีปัญหา = กลายเป็นไอคอน Notice (แดง: Not Balance/Over Period, เหลือง: Future Date)
# มีเลขมุมขวาบนเมื่อมี >= 2 ชนิดปัญหา, ชี้เมาส์เห็นรายการ, กด = ไปหน้า Detail ของสาขา | ต้องรันหลัง ...remove_icon_front_v8.py
import sys, shutil, os
MARKER = "MARKER_VATRECONCILE_SINGLE_NOTICE_ICON_V9"
path = sys.argv[1] if len(sys.argv) > 1 else r"D:\Users\LeKarn\fastapn-link3ase\my-app\src\pages\VatReconcileDashboard.js"
raw = open(path, "rb").read().decode("utf-8")
crlf = "\r\n" in raw
src = raw.replace("\r\n", "\n")
if MARKER in src:
    print("[SKIP] patch นี้ถูกใช้แล้ว"); sys.exit(0)
start_m = '                            <button type="button" aria-label="ดู Detail" title="ดู Detail (Input Summary) ของสาขานี้" onClick={() => goView(\'input\', r.branch)}\n'
end_m = "                            {/* MARKER_VATRECONCILE_STATUS_NO_WARN_ICON_V8 -- ไม่แสดงไอคอนเตือน เหลือเฉพาะไอคอน Detail */}\n"
if src.count(start_m) != 1 or src.count(end_m) != 1:
    print("[ABORT] anchor ไม่ตรง / ยังไม่ได้รัน v8 -- ไม่เขียนไฟล์"); sys.exit(1)
s = src.index(start_m); e = src.index(end_m) + len(end_m)
if e <= s:
    print("[ABORT] ลำดับ anchor ผิด"); sys.exit(1)
new = """                            {/* """ + MARKER + """ -- ไอคอนเดียว: Detail (ปกติ) / Notice (มีปัญหา) */}
                            {(() => {
                              const issues = [
                                !ok && `Error: Not Balance (ผลต่าง ${rpFmt(r.diff)})`,
                                hasOver && `Over Period ${r.overCount} รายการ (เดือนของ Tax Invoice Date เกินเดือน Period)`,
                                hasFuture && `Future Date ${r.futureCount} รายการ (Receive Date น้อยกว่า Tax Invoice Date)`,
                              ].filter(Boolean);
                              const has = issues.length > 0;
                              const severe = !ok || hasOver;
                              const col = !has ? '#0969da' : severe ? '#cf222e' : '#856404';
                              return (
                                <button type="button" aria-label={has ? 'มี Notice ดู Detail' : 'ดู Detail'}
                                  title={has ? issues.join('\\n') + '\\n(กดเพื่อดู Detail)' : 'ดู Detail (Input Summary) ของสาขานี้'}
                                  onClick={() => goView('input', r.branch)}
                                  style={{ position: 'relative', verticalAlign: 'middle', width: 24, height: 24, padding: 0, borderRadius: 6, cursor: 'pointer', border: `1px solid ${!has ? '#0969da' : severe ? '#f1a9a9' : '#e8d48a'}`, background: !has ? '#fff' : severe ? '#ffe5e5' : '#fff3cd', color: col, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                                  {has ? (
                                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 2 14.5 13.5h-13z" /><path d="M8 6.5v3.2M8 11.6v.1" /></svg>
                                  ) : (
                                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2.5" y="1.5" width="11" height="13" rx="1.5" /><path d="M5 5.5h6M5 8h6M5 10.5h4" /></svg>
                                  )}
                                  {issues.length > 1 && (
                                    <span style={{ position: 'absolute', top: -6, right: -6, minWidth: 14, height: 14, padding: '0 3px', borderRadius: 7, background: '#cf222e', color: '#fff', fontSize: 10, fontWeight: 700, lineHeight: '14px', textAlign: 'center' }}>{issues.length}</span>
                                  )}
                                </button>
                              );
                            })()}
"""
src = src[:s] + new + src[e:]
n = 1
while os.path.exists(f"{path}.bak{n:02d}"): n += 1
shutil.copyfile(path, f"{path}.bak{n:02d}")
open(path, "wb").write((src.replace("\n", "\r\n") if crlf else src).encode("utf-8"))
print(f"[OK] patched {path} (backup .bak{n:02d})")
