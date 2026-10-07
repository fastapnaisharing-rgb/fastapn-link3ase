# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_STATUS_SUMMARY_ICON_V7
# หน้า Cover ช่อง NOTE/STATUS: แทนป้ายข้อความหลายอัน (Error: Not Balance / Over Period / Future Date)
# ด้วย "ไอคอนเตือนสรุป" อันเดียว -- มีตัวเลขจำนวนชนิดปัญหาเมื่อมี >= 2 ชนิด, เอาเมาส์ชี้เห็นรายการทั้งหมด, กดแล้วไปหน้า Detail
# สาขาที่ไม่มีปัญหา = มีแค่ไอคอน Detail  | ต้องรันหลัง patch ... status_error_label_front_v6.py
# ใช้: python patch_vatreconcile_status_summary_icon_front_v7.py <path ของ src\pages\VatReconcileDashboard.js>
import sys, shutil, os
MARKER = "MARKER_VATRECONCILE_STATUS_SUMMARY_ICON_V7"
path = sys.argv[1] if len(sys.argv) > 1 else r"D:\Users\LeKarn\fastapn-link3ase\my-app\src\pages\VatReconcileDashboard.js"
raw = open(path, "rb").read().decode("utf-8")
crlf = "\r\n" in raw
src = raw.replace("\r\n", "\n")
if MARKER in src:
    print("[SKIP] patch นี้ถูกใช้แล้ว"); sys.exit(0)
start_m = "                            {/* MARKER_VATRECONCILE_STATUS_NOT_BALANCE_V5 */}\n"
end_m = "                                ⚠ Future Date {r.futureCount} รายการ\n                              </span>\n                            )}\n"
if src.count(start_m) != 1 or src.count(end_m) != 1 or "MARKER_VATRECONCILE_STATUS_ERROR_LABEL_V6" not in src:
    print("[ABORT] anchor ไม่ตรง / ยังไม่ได้รัน v6 -- ไม่เขียนไฟล์"); sys.exit(1)
s = src.index(start_m); e = src.index(end_m) + len(end_m)
if e <= s:
    print("[ABORT] ลำดับ anchor ผิด"); sys.exit(1)
new = """                            {/* """ + MARKER + """ -- ไอคอนเตือนสรุป (ชี้เมาส์ดูรายการ / กด = ไปหน้า Detail) */}
                            {(() => {
                              const issues = [
                                !ok && `Error: Not Balance (ผลต่าง ${rpFmt(r.diff)})`,
                                hasOver && `Over Period ${r.overCount} รายการ (เดือนของ Tax Invoice Date เกินเดือน Period)`,
                                hasFuture && `Future Date ${r.futureCount} รายการ (Receive Date น้อยกว่า Tax Invoice Date)`,
                              ].filter(Boolean);
                              if (issues.length === 0) return null;
                              const severe = !ok || hasOver;
                              return (
                                <button type="button" aria-label="มีรายการที่ต้องตรวจสอบ" title={issues.join('\\n')} onClick={() => goView('input', r.branch)}
                                  style={{ position: 'relative', verticalAlign: 'middle', width: 24, height: 24, padding: 0, borderRadius: 6, cursor: 'pointer', border: severe ? '1px solid #f1a9a9' : '1px solid #e8d48a', background: severe ? '#ffe5e5' : '#fff3cd', color: severe ? '#cf222e' : '#856404', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 2 14.5 13.5h-13z" /><path d="M8 6.5v3.2M8 11.6v.1" /></svg>
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
