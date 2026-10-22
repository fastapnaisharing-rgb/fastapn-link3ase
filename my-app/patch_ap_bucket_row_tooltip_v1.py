# -*- coding: utf-8 -*-
"""
patch_ap_bucket_row_tooltip_v1.py (src/pages/APController.js)
Batch Bucket (ตาราง Invoice): เอาเมาส์ชี้แถว -> Tooltip สรุป
  Supplier Name / GRT No. / Branch No. / Branch IB / Amount / Vat / Wht / Total  (Total = ค่าเดียวกับที่แสดงในตาราง)
"""
import sys, os, shutil
DEFAULT = r"D:\Users\LeKarn\fastapn-link3ase\my-app\src\pages\APController.js"
MARKER = "MARKER_BUCKET_ROW_TOOLTIP_V1"
R = [
("""  const [activeBucketRow, setActiveBucketRow] = useState(null);""",
 """  // MARKER_BUCKET_ROW_TOOLTIP_V1 -- ข้อความ Tooltip ของแถว Invoice ใน Bucket
  const bucketRowTooltip = (inv) => {
    const fm = (v) => (v != null && v !== '' && !isNaN(parseFloat(v))) ? parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';
    const fd = inv?.form_data || {};
    const bNo = String(inv?.branch_label || fd.branchDirectLabel || '').split('-')[0].trim() || '-';
    const ibRaw = String(fd.branchIBLabel || '').trim();
    const bIB = (ibRaw && ibRaw !== '-') ? ibRaw.split('-')[0].trim() : '-';
    return [
      'Supplier Name : ' + (inv?.vendor_name || '-'),
      'GRT No. : ' + (fd.grtNum || '-'),
      'Branch No. : ' + bNo,
      'Branch IB. : ' + bIB,
      'Amount : ' + fm(inv?.amount),
      'Vat : ' + fm(inv?.vat),
      'Wht : ' + fm(inv?.wht),
      'Total : ' + bucketNetPay(inv),
    ].join('\\n');
  };
  const [activeBucketRow, setActiveBucketRow] = useState(null);"""),
("""data-bkey={String(rowKey)} // MARKER_BUCKET_ROW_ARROW_NAV_V1""",
 """data-bkey={String(rowKey)} title={bucketRowTooltip(inv)} // MARKER_BUCKET_ROW_ARROW_NAV_V1 // MARKER_BUCKET_ROW_TOOLTIP_V1"""),
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
    bk = path + ".bak_bucket_tooltip_v1"; k = 1
    while os.path.exists(bk): k += 1; bk = path + ".bak_bucket_tooltip_v1_" + str(k)
    shutil.copy2(path, bk)
    if crlf: src = src.replace("\n", "\r\n")
    open(path, "wb").write(src.encode("utf-8"))
    print("[OK] แก้ %d จุด | backup: %s" % (len(R), bk))
if __name__ == "__main__": main()
