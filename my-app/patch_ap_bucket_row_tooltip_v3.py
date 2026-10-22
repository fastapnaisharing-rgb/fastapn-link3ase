# -*- coding: utf-8 -*-
"""
patch_ap_bucket_row_tooltip_v3.py (src/pages/APController.js)
Tooltip Bucket: Amount | Vat | Wht | Total เรียงเป็น 4 ช่องแนวนอน (ชื่อบน ตัวเลขล่าง) แทนการเรียงเป็นแถว
  การ์ดกว้างขึ้นเป็น 340px / Total ช่องสุดท้ายพื้นเขียวอ่อน
"""
import sys, os, shutil
DEFAULT = r"D:\Users\LeKarn\fastapn-link3ase\my-app\src\pages\APController.js"
MARKER = "MARKER_BUCKET_ROW_TOOLTIP_V3"
S1 = "        <div style={{ margin: '4px 12px 0', borderTop: '1px dashed #e3e8f0' }} />"
S2 = "          <span style={{ fontFamily: 'monospace', fontSize: '14px', fontWeight: 700, color: '#085041' }}>{bucketNetPay(inv)}</span>\n        </div>\n"
NEW = """        <div style={{ margin: '4px 0 0', borderTop: '1px dashed #e3e8f0' }} />{/* MARKER_BUCKET_ROW_TOOLTIP_V3 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 0.7fr 1fr 1.15fr' }}>
          {[['AMOUNT', fm(inv?.amount), '#1a3a5c', 'transparent'], ['VAT', fm(inv?.vat), '#1a3a5c', 'transparent'], ['WHT', fm(inv?.wht), wht < 0 ? '#A32D2D' : '#1a3a5c', 'transparent'], ['TOTAL', bucketNetPay(inv), '#085041', '#E6F4EC']].map(([k, v, c, bg], idx) => (
            <div key={k} style={{ padding: '8px 10px', background: bg, textAlign: 'right', borderLeft: idx === 0 ? 'none' : '1px solid #eef1f6' }}>
              <div style={{ fontSize: '9px', letterSpacing: '0.06em', fontWeight: 600, color: k === 'TOTAL' ? '#0F6E56' : '#8a94a6' }}>{k}</div>
              <div style={{ fontFamily: 'monospace', fontSize: k === 'TOTAL' ? '13px' : '12px', fontWeight: k === 'TOTAL' ? 700 : 600, color: c, marginTop: '3px', whiteSpace: 'nowrap' }}>{v}</div>
            </div>
          ))}
        </div>
"""
def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    raw = open(path, "rb").read().decode("utf-8")
    crlf = "\r\n" in raw
    src = raw.replace("\r\n", "\n")
    if MARKER in src: print("[SKIP] มีแล้ว"); return
    if src.count(S1) != 1 or src.count(S2) != 1: print("[ABORT] anchor ไม่ตรง", src.count(S1), src.count(S2)); sys.exit(1)
    i = src.index(S1); j = src.index(S2) + len(S2)
    if not (i < j and j - i < 2500): print("[ABORT] ระยะบล็อกผิดปกติ"); sys.exit(1)
    src = src[:i] + NEW + src[j:]
    w_old = "zIndex: 99999, width: '280px'"
    if src.count(w_old) != 1: print("[ABORT] width anchor"); sys.exit(1)
    src = src.replace(w_old, "zIndex: 99999, width: '340px'", 1)
    w2 = "const w = 280, h = 270;"
    if src.count(w2) != 1: print("[ABORT] placement anchor"); sys.exit(1)
    src = src.replace(w2, "const w = 340, h = 200;", 1)
    # ลบ helper num เดิมที่ไม่ได้ใช้แล้ว (กัน ESLint no-unused-vars)
    a = src.find("    const num = (t, color) => (<span style={{ fontFamily: 'monospace'")
    if a >= 0:
        b = src.index("\n", a) + 1
        src = src[:a] + src[b:]
    bk = path + ".bak_bucket_tooltip_v3"; k = 1
    while os.path.exists(bk): k += 1; bk = path + ".bak_bucket_tooltip_v3_" + str(k)
    shutil.copy2(path, bk)
    if crlf: src = src.replace("\n", "\r\n")
    open(path, "wb").write(src.encode("utf-8"))
    print("[OK] backup:", bk)
if __name__ == "__main__": main()
