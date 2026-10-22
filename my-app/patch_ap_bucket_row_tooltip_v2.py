# -*- coding: utf-8 -*-
"""
patch_ap_bucket_row_tooltip_v2.py (src/pages/APController.js)
Tooltip การ์ดสวย (แทน title ของเบราว์เซอร์) ตอนชี้แถว Invoice ใน Batch Bucket
  หัวการ์ดสีกรมท่า = Supplier Name | GRT No. / Branch No. / Branch IB เป็นชิป | Amount / Vat / Wht | Total เด่นสีเขียว
  ขึ้นหลังชี้ 0.25 วิ, ตามเมาส์ (ปรับตำแหน่งผ่าน ref ไม่ Re-render), กลับด้านเองถ้าชนขอบจอ, ไม่บังเมาส์ (pointer-events none)
"""
import sys, os, shutil
DEFAULT = r"D:\Users\LeKarn\fastapn-link3ase\my-app\src\pages\APController.js"
MARKER = "MARKER_BUCKET_ROW_TOOLTIP_V2"
START = "  // MARKER_BUCKET_ROW_TOOLTIP_V1 -- ข้อความ Tooltip ของแถว Invoice ใน Bucket"
END = "  const [activeBucketRow, setActiveBucketRow] = useState(null);"

BLOCK = """  // MARKER_BUCKET_ROW_TOOLTIP_V2 -- Tooltip การ์ดของแถว Invoice ใน Bucket (ตำแหน่งปรับผ่าน ref ไม่ Re-render ตอนขยับเมาส์)
  const [bucketTip, setBucketTip] = useState(null);
  const bucketTipRef = useRef(null);
  const bucketTipPos = useRef({ x: 0, y: 0 });
  const bucketTipTimer = useRef(null);
  const placeBucketTip = (e) => {
    const w = 280, h = 270;
    let x = e.clientX + 16, y = e.clientY + 16;
    if (x + w > window.innerWidth) x = e.clientX - w - 12;
    if (y + h > window.innerHeight) y = e.clientY - h - 12;
    return { x: Math.max(4, x), y: Math.max(4, y) };
  };
  const showBucketTip = (e, inv) => {
    bucketTipPos.current = placeBucketTip(e);
    clearTimeout(bucketTipTimer.current);
    bucketTipTimer.current = setTimeout(() => setBucketTip(inv), 250);
  };
  const moveBucketTip = (e) => {
    bucketTipPos.current = placeBucketTip(e);
    const el = bucketTipRef.current;
    if (el) { el.style.left = bucketTipPos.current.x + 'px'; el.style.top = bucketTipPos.current.y + 'px'; }
  };
  const hideBucketTip = () => { clearTimeout(bucketTipTimer.current); setBucketTip(null); };
  const renderBucketTip = (inv) => {
    const fm = (v) => (v != null && v !== '' && !isNaN(parseFloat(v))) ? parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';
    const fd = inv?.form_data || {};
    const bNo = String(inv?.branch_label || fd.branchDirectLabel || '').split('-')[0].trim() || '-';
    const ibRaw = String(fd.branchIBLabel || '').trim();
    const bIB = (ibRaw && ibRaw !== '-') ? ibRaw.split('-')[0].trim() : '-';
    const wht = parseFloat(inv?.wht) || 0;
    const lbl = { color: '#8a94a6', fontSize: '11px' };
    const chip = (t, hi) => (<span style={{ fontFamily: 'monospace', fontSize: '11px', fontWeight: 600, padding: '1px 8px', borderRadius: '10px', background: hi ? '#FFF3CD' : '#eef2f7', color: hi ? '#856404' : '#1a3a5c' }}>{t}</span>);
    const row = (k, v) => (<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '3px 0' }}><span style={lbl}>{k}</span>{v}</div>);
    const num = (t, color) => (<span style={{ fontFamily: 'monospace', fontSize: '12px', fontWeight: 600, color: color || '#1a3a5c' }}>{t}</span>);
    return (
      <div ref={bucketTipRef} style={{ position: 'fixed', left: bucketTipPos.current.x, top: bucketTipPos.current.y, zIndex: 99999, width: '280px', pointerEvents: 'none', background: '#fff', border: '1px solid #dfe5ee', borderRadius: '10px', boxShadow: '0 10px 28px rgba(26,58,92,0.22)', overflow: 'hidden', fontSize: '12px' }}>
        <div style={{ background: '#1a3a5c', color: '#fff', padding: '9px 12px' }}>
          <div style={{ fontSize: '9px', letterSpacing: '0.08em', opacity: 0.65 }}>SUPPLIER NAME</div>
          <div style={{ fontSize: '13px', fontWeight: 600, marginTop: '2px', lineHeight: 1.35 }}>{inv?.vendor_name || '-'}</div>
        </div>
        <div style={{ padding: '8px 12px 4px' }}>
          {row('GRT No.', chip(fd.grtNum || '-'))}
          {row('Branch No.', chip(bNo))}
          {row('Branch IB.', chip(bIB, bIB !== '-'))}
        </div>
        <div style={{ margin: '4px 12px 0', borderTop: '1px dashed #e3e8f0' }} />
        <div style={{ padding: '4px 12px 8px' }}>
          {row('Amount', num(fm(inv?.amount)))}
          {row('Vat', num(fm(inv?.vat)))}
          {row('Wht', num(fm(inv?.wht), wht < 0 ? '#A32D2D' : '#1a3a5c'))}
        </div>
        <div style={{ background: '#E6F4EC', padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#0F6E56', fontSize: '11px', fontWeight: 600, letterSpacing: '0.05em' }}>TOTAL</span>
          <span style={{ fontFamily: 'monospace', fontSize: '14px', fontWeight: 700, color: '#085041' }}>{bucketNetPay(inv)}</span>
        </div>
      </div>
    );
  };
"""

R2 = [
("""title={bucketRowTooltip(inv)} // MARKER_BUCKET_ROW_ARROW_NAV_V1 // MARKER_BUCKET_ROW_TOOLTIP_V1""",
 """onMouseEnter={(e) => showBucketTip(e, inv)} onMouseMove={moveBucketTip} onMouseLeave={hideBucketTip} // MARKER_BUCKET_ROW_ARROW_NAV_V1 // MARKER_BUCKET_ROW_TOOLTIP_V2"""),
("""      const nextIdx = idx < 0 ? (e.key === 'ArrowDown'""",
 """      hideBucketTip(); // MARKER_BUCKET_ROW_TOOLTIP_V2
      const nextIdx = idx < 0 ? (e.key === 'ArrowDown'"""),
("""{/* MARKER_BUCKET_ROW_ARROW_NAV_V1 */}
        {bucketViewMode === 'invoice' ? (""",
 """{/* MARKER_BUCKET_ROW_ARROW_NAV_V1 */}
        {bucketTip && ReactDOM.createPortal(renderBucketTip(bucketTip), document.body)}{/* MARKER_BUCKET_ROW_TOOLTIP_V2 */}
        {bucketViewMode === 'invoice' ? ("""),
]
def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    raw = open(path, "rb").read().decode("utf-8")
    crlf = "\r\n" in raw
    src = raw.replace("\r\n", "\n")
    if MARKER in src: print("[SKIP] มีแล้ว"); return
    if src.count(START) != 1 or src.count(END) != 1: print("[ABORT] anchor บล็อกเดิมไม่ครบ"); sys.exit(1)
    i = src.index(START); j = src.index(END)
    if not (i < j and j - i < 3000): print("[ABORT] ระยะบล็อกเดิมผิดปกติ"); sys.exit(1)
    for o, n in R2:
        if src.count(o) != 1: print("[ABORT] anchor %d ครั้ง: %s" % (src.count(o), o[:70])); sys.exit(1)
    src = src[:i] + BLOCK + src[j:]
    for o, n in R2: src = src.replace(o, n, 1)
    bk = path + ".bak_bucket_tooltip_v2"; k = 1
    while os.path.exists(bk): k += 1; bk = path + ".bak_bucket_tooltip_v2_" + str(k)
    shutil.copy2(path, bk)
    if crlf: src = src.replace("\n", "\r\n")
    open(path, "wb").write(src.encode("utf-8"))
    print("[OK] backup:", bk)
if __name__ == "__main__": main()
