# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_TOOLS_COLUMN_FRONT_V22
# หน้า Reconcile (ตารางสรุปสาขา): เปลี่ยนหัวคอลัมน์ NOTE/STATUS เป็น "Tools" และเปลี่ยนไอคอนเดียวเป็น 4 ปุ่ม (2x2)
#   Detail      : Enable ตลอด (กดแล้วเปิด Detail ของสาขา เหมือนเดิม)
#   Branch      : Enable ตลอด (ยังไม่ผูก Action -- รอระบุ)
#   Cross check : Enable เมื่อสาขามีผลต่าง (Not Balance) (ยังไม่ผูก Action -- รอระบุ)
#   Notice      : Enable เมื่อมี Notice/Status ไม่ Balance (กดแล้วเปิด Detail เหมือนไอคอนเดิม)
# ปุ่มที่ Disable = สีเทาจาง กดไม่ได้ + Tooltip บอกเหตุผล
# ใช้: python patch_vatreconcile_tools_column_front_v22.py "<path>\src\pages\VatReconcileDashboard.js"
import sys, os, shutil

MARKER = "MARKER_VATRECONCILE_TOOLS_COLUMN_FRONT_V22"

TARGET = sys.argv[1] if len(sys.argv) > 1 else r"src\pages\VatReconcileDashboard.js"

with open(TARGET, "rb") as f:
    raw = f.read()
has_bom = raw.startswith(b"\xef\xbb\xbf")
text = raw.decode("utf-8-sig")
crlf = "\r\n" in text
src = text.replace("\r\n", "\n")

if MARKER in src:
    print("[SKIP] patch นี้ถูกใช้แล้ว")
    sys.exit(0)


def once(s, old, label):
    n = s.count(old)
    if n != 1:
        print(f"[ABORT] anchor '{label}' พบ {n} ครั้ง (ต้องเป็น 1) -- ไม่เขียนไฟล์")
        sys.exit(1)


# ---------- 1) หัวคอลัมน์ ----------
OLD_TH = "<th rowSpan={2} style={th({ top: 0 })}>NOTE/STATUS</th>"
once(src, OLD_TH, "th NOTE/STATUS")
src = src.replace(OLD_TH, "<th rowSpan={2} style={th({ top: 0 })}>Tools</th>")

# ---------- 2) เซลล์ ----------
START = "{/* MARKER_VATRECONCILE_SINGLE_NOTICE_ICON_V9 -- ไอคอนเดียว: Detail (ปกติ) / Notice (มีปัญหา) */}"
END = "})()}"
once(src, START, "start single notice icon")
i = src.index(START)
j = src.index(END, i)
if src.count(END, i, j + len(END)) != 1:
    print("[ABORT] พบ end anchor มากกว่า 1 ใน block -- ไม่เขียนไฟล์")
    sys.exit(1)
j_end = j + len(END)

NEW = r"""{/* MARKER_VATRECONCILE_TOOLS_COLUMN_FRONT_V22 -- Tools 2x2: Detail | Branch | Cross check | Notice */}
                            {(() => {
                              const issues = [
                                r.branchMissing && 'ไม่พบสาขานี้ในรายการสาขา (Branch) — ไม่อนุญาตให้ Export',
                                !ok && `Error: Not Balance (ผลต่าง ${rpFmt(r.diff)})`,
                                hasOver && `Over Period ${r.overCount} รายการ (เดือนของ Tax Invoice Date เกินเดือน Period)`,
                                hasFuture && `Future Date ${r.futureCount} รายการ (Receive Date น้อยกว่า Tax Invoice Date)`,
                              ].filter(Boolean);
                              const has = issues.length > 0;
                              const severe = !ok || hasOver || r.branchMissing;
                              const svgP = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
                              const tool = (key, enabled, title, onClick, color, bg, bd, icon, badge) => (
                                <button key={key} type="button" aria-label={title} title={title} disabled={!enabled}
                                  onClick={enabled && onClick ? onClick : undefined}
                                  style={{ position: 'relative', width: 26, height: 26, padding: 0, borderRadius: 6, cursor: enabled ? 'pointer' : 'not-allowed', border: `1px solid ${enabled ? bd : '#d0d7de'}`, background: enabled ? bg : '#f3f4f6', color: enabled ? color : '#b6bcc4', opacity: enabled ? 1 : 0.6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                                  {icon}
                                  {enabled && badge > 1 && (
                                    <span style={{ position: 'absolute', top: -6, right: -6, minWidth: 14, height: 14, padding: '0 3px', borderRadius: 7, background: '#cf222e', color: '#fff', fontSize: 10, fontWeight: 700, lineHeight: '14px', textAlign: 'center' }}>{badge}</span>
                                  )}
                                </button>
                              );
                              return (
                                <div style={{ display: 'grid', gridTemplateColumns: '26px 26px', gap: 4, justifyContent: 'center', padding: '2px 0' }}>
                                  {tool('detail', true, 'Detail (Input Summary) ของสาขานี้', () => goView('input', r.branch), '#0969da', '#fff', '#0969da',
                                    <svg {...svgP}><rect x="2.5" y="1.5" width="11" height="13" rx="1.5" /><path d="M5 5.5h6M5 8h6M5 10.5h4" /></svg>)}
                                  {tool('branch', true, 'Branch (ยังไม่เปิดใช้งาน)', null, '#0969da', '#fff', '#0969da',
                                    <svg {...svgP}><path d="M2.5 14.5h11M4 14.5V3h5.5v11.5M9.5 7H12v7.5" /><path d="M6 5.5h1.5M6 8h1.5M6 10.5h1.5" /></svg>)}
                                  {tool('cross', !ok, !ok ? `Cross check (ผลต่าง ${rpFmt(r.diff)}) — ยังไม่เปิดใช้งาน` : 'Cross check: ไม่มีผลต่าง', null, '#0969da', '#fff', '#0969da',
                                    <svg {...svgP}><path d="M2.5 5.5h10l-2.5-2.5M13.5 10.5h-10l2.5 2.5" /></svg>)}
                                  {tool('notice', has, has ? issues.join('\n') + '\n(กดเพื่อดู Detail)' : 'Notice: ไม่มีรายการที่ต้องแจ้ง', () => goView('input', r.branch), severe ? '#cf222e' : '#856404', severe ? '#ffe5e5' : '#fff3cd', severe ? '#f1a9a9' : '#e8d48a',
                                    <svg {...svgP}><path d="M8 2 14.5 13.5h-13z" /><path d="M8 6.5v3.2M8 11.6v.1" /></svg>, issues.length)}
                                </div>
                              );
                            })()}"""
src = src[:i] + NEW + src[j_end:]

# ---------- เขียนกลับ ----------
shutil.copyfile(TARGET, TARGET + ".bak")  # .bak ไฟล์เดียว เขียนทับทุกครั้ง
out = src.replace("\n", "\r\n") if crlf else src
with open(TARGET, "wb") as f:
    f.write((b"\xef\xbb\xbf" if has_bom else b"") + out.encode("utf-8"))
print("[OK] ใส่ Tools 4 ปุ่มแล้ว -> build ใหม่ แล้ว Ctrl+Shift+R")
