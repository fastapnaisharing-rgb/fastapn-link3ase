# -*- coding: utf-8 -*-
"""
patch_ap_bucket_row_arrow_nav_v1.py (src/pages/APController.js)
Batch Bucket (ตาราง Invoice): คลิกแถว = Highlight แถวนั้น + กดลูกศร ↑/↓ เลื่อนแถวที่ Highlight ได้ (ไว้ไล่ตรวจทีละรายการ)
  - Space = ติ๊ก/เอาติ๊ก Checkbox ของแถวที่ Highlight | Esc = ยกเลิก Highlight
  - Scroll ตามอัตโนมัติ (เผื่อ Header ที่ Sticky) | ไม่ทำงานเมื่อกำลังพิมพ์ใน input/select/textarea
"""
import sys, os, shutil
DEFAULT = r"D:\Users\LeKarn\fastapn-link3ase\my-app\src\pages\APController.js"
MARKER = "MARKER_BUCKET_ROW_ARROW_NAV_V1"
R = [
("""  const [selectedRows, setSelectedRows] = useState(new Set()); // ✅ Batch Bucket""",
 """  // MARKER_BUCKET_ROW_ARROW_NAV_V1 -- แถว Invoice ใน Bucket ที่ Highlight อยู่ (คลิก/ลูกศรขึ้นลง)
  const [activeBucketRow, setActiveBucketRow] = useState(null);
  const bucketScrollRef = useRef(null);
  const handleBucketKeyDown = (e) => {
    const tag = String(e.target?.tagName || '').toUpperCase();
    if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(tag)) return;
    const box = bucketScrollRef.current; if (!box) return;
    const rows = Array.from(box.querySelectorAll('tr[data-bkey]'));
    if (!rows.length) return;
    const idx = rows.findIndex(r => r.getAttribute('data-bkey') === activeBucketRow);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const nextIdx = idx < 0 ? (e.key === 'ArrowDown' ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, idx + (e.key === 'ArrowDown' ? 1 : -1)));
      const el = rows[nextIdx];
      setActiveBucketRow(el.getAttribute('data-bkey'));
      el.scrollIntoView({ block: 'nearest' });
      const headH = (box.querySelector('thead')?.offsetHeight || 0) + 2;
      if (el.offsetTop - box.scrollTop < headH) box.scrollTop = Math.max(0, el.offsetTop - headH);
    } else if (e.key === ' ' && idx >= 0) {
      e.preventDefault();
      rows[idx].querySelector('input[type="checkbox"]')?.click();
    } else if (e.key === 'Escape' && idx >= 0) {
      setActiveBucketRow(null);
    }
  };
  const [selectedRows, setSelectedRows] = useState(new Set()); // ✅ Batch Bucket"""),
("""<tr key={rowKey} style={{ borderBottom: '0.5px solid #f5f5f5' }}>""",
 """<tr key={rowKey} data-bkey={String(rowKey)} // MARKER_BUCKET_ROW_ARROW_NAV_V1
                onClick={() => { setActiveBucketRow(String(rowKey)); bucketScrollRef.current?.focus({ preventScroll: true }); }}
                style={{ borderBottom: '0.5px solid #f5f5f5', cursor: 'pointer', background: activeBucketRow === String(rowKey) ? '#E3EEFB' : undefined, boxShadow: activeBucketRow === String(rowKey) ? 'inset 3px 0 0 #1a3a5c' : undefined }}>"""),
("""<div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {bucketViewMode === 'invoice' ? (""",
 """<div ref={bucketScrollRef} tabIndex={0} onKeyDown={handleBucketKeyDown} style={{ flex: 1, minHeight: 0, overflowY: 'auto', outline: 'none' }}>{/* MARKER_BUCKET_ROW_ARROW_NAV_V1 */}
        {bucketViewMode === 'invoice' ? ("""),
]
def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    raw = open(path, "rb").read().decode("utf-8")
    crlf = "\r\n" in raw
    src = raw.replace("\r\n", "\n")
    if MARKER in src: print("[SKIP] มีแล้ว"); return
    for o, n in R:
        if src.count(o) != 1: print("[ABORT] anchor %d ครั้ง: %s" % (src.count(o), o[:60])); sys.exit(1)
    for o, n in R: src = src.replace(o, n, 1)
    bk = path + ".bak_bucket_arrow_v1"; k = 1
    while os.path.exists(bk): k += 1; bk = path + ".bak_bucket_arrow_v1_" + str(k)
    shutil.copy2(path, bk)
    if crlf: src = src.replace("\n", "\r\n")
    open(path, "wb").write(src.encode("utf-8"))
    print("[OK] แก้ %d จุด | backup: %s" % (len(R), bk))
if __name__ == "__main__": main()
