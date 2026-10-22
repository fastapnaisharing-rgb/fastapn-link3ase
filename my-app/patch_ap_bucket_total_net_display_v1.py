# -*- coding: utf-8 -*-
"""
patch_ap_bucket_total_net_display_v1.py (src/pages/APController.js)
Batch Bucket: คอลัมน์ Total (ตาราง Invoice, ตาราง Summary และแถวรวมท้าย) แสดง = Amount + Vat + Wht (Wht เก็บเป็นค่าติดลบ => หัก WHT)
  *** แก้เฉพาะการแสดงผล *** ไม่แตะ inv.net ที่เก็บ/ส่งไป Duplicate Check/Export/บันทึก ไม่แตะสูตรคำนวณรายบรรทัดใน Invoice Detail
"""
import sys, os, shutil
DEFAULT = r"D:\Users\LeKarn\fastapn-link3ase\my-app\src\pages\APController.js"
MARKER = "MARKER_BUCKET_TOTAL_NET_DISPLAY_V1"
EXPR = "{inv.net != null && inv.net !== '' ? Number(inv.net).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>"
R = [
("""  const [activeBucketRow, setActiveBucketRow] = useState(null);""",
 """  // MARKER_BUCKET_TOTAL_NET_DISPLAY_V1 -- Total ที่แสดงใน Bucket = Amount + Vat + Wht (Wht ติดลบ) | แสดงผลเท่านั้น ไม่แก้ inv.net
  const bucketNetValue = (inv) => Math.round(((parseFloat(inv?.amount) || 0) + (parseFloat(inv?.vat) || 0) + (parseFloat(inv?.wht) || 0)) * 100) / 100;
  const bucketNetPay = (inv) => (inv?.amount != null && inv.amount !== '') ? bucketNetValue(inv).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
  const [activeBucketRow, setActiveBucketRow] = useState(null);"""),
("""<td style={{ padding: '8px 9px', fontWeight: '600', color: '#1a3a5c', textAlign: 'right' }}>""" + EXPR,
 """<td style={{ padding: '8px 9px', fontWeight: '600', color: '#1a3a5c', textAlign: 'right' }}>{bucketNetPay(inv)}</td>"""),
("""<td style={{ padding: '6px 9px', textAlign: 'right', fontSize: '11px', fontWeight: '600', color: '#1a3a5c' }}>""" + EXPR,
 """<td style={{ padding: '6px 9px', textAlign: 'right', fontSize: '11px', fontWeight: '600', color: '#1a3a5c' }}>{bucketNetPay(inv)}</td>"""),
("""const bucketTotal  = invoices.reduce((s, inv) => s + (parseFloat(inv.net) || 0), 0);""",
 """const bucketTotal  = invoices.reduce((s, inv) => s + bucketNetValue(inv), 0); // MARKER_BUCKET_TOTAL_NET_DISPLAY_V1"""),
]
def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    raw = open(path, "rb").read().decode("utf-8")
    crlf = "\r\n" in raw
    src = raw.replace("\r\n", "\n")
    if MARKER in src: print("[SKIP] มีแล้ว"); return
    for o, n in R:
        if src.count(o) != 1: print("[ABORT] anchor %d ครั้ง: %s" % (src.count(o), o[:70])); sys.exit(1)
    for o, n in R: src = src.replace(o, n, 1)
    bk = path + ".bak_bucket_total_v1"; k = 1
    while os.path.exists(bk): k += 1; bk = path + ".bak_bucket_total_v1_" + str(k)
    shutil.copy2(path, bk)
    if crlf: src = src.replace("\n", "\r\n")
    open(path, "wb").write(src.encode("utf-8"))
    print("[OK] แก้ %d จุด | backup: %s" % (len(R), bk))
if __name__ == "__main__": main()
