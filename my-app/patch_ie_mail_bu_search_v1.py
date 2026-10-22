# -*- coding: utf-8 -*-
"""
patch_ie_mail_bu_search_v1.py  (src/pages/IEController.js)
Mail Manage (I-Expense > Generate by Macro Logic): ช่อง BU เปลี่ยนจาก <select> เป็นกล่องค้นหา
  - กดแล้วเปิดรายการ + ช่อง Search (พิมพ์กรองสด) | ค่าเริ่มต้นเห็น 5 แถว ที่เหลือเลื่อนดู
  - คลิกเลือก หรือ ↑↓ + Enter | Esc / คลิกข้างนอก = ปิด | ผลหลังเลือกเหมือนเดิม (โหลด Config + Draft ของ BU)
แก้เฉพาะจุดนี้ (2 จุด: เพิ่ม Component + แทนที่ <select>) -- ไม่แตะส่วนอื่น
วิธีรัน:  python patch_ie_mail_bu_search_v1.py [path/to/IEController.js]
"""
import sys, os, shutil

DEFAULT = r"D:\Users\LeKarn\fastapn-link3ase\my-app\src\pages\IEController.js"
MARKER = "MARKER_IE_MAIL_BU_SEARCH_PICKER_V1"

COMPONENT = r'''// MARKER_IE_MAIL_BU_SEARCH_PICKER_V1 -- กล่องเลือก BU แบบค้นหาได้ (Mail Manage): เห็น 5 แถว เลื่อนดูที่เหลือ + ช่อง Search
function IeMailBuPicker({ value, options = [], onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const filtered = (options || []).filter((o) => !q.trim() || String(o).toLowerCase().includes(q.trim().toLowerCase()));
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  useEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open]);
  useEffect(() => { setHi(0); }, [q, open]);
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[hi];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [hi, open]);
  const pick = (o) => { setOpen(false); setQ(''); if (o !== value) onChange(o); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((i) => (filtered.length ? (i + 1) % filtered.length : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((i) => (filtered.length ? (i - 1 + filtered.length) % filtered.length : 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[hi] != null) pick(filtered[hi]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); setQ(''); }
  };
  const ROW_H = 30;
  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'inline-block', verticalAlign: 'middle' }}>
      <button type="button" disabled={disabled} onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}
        title="คลิกเพื่อค้นหา / เลือก BU"
        style={{ height: '30px', minWidth: '110px', display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', border: '0.5px solid #cfd6df', borderRadius: '6px', padding: '0 8px', fontSize: '12px', background: '#fff', color: '#1a3a5c', cursor: disabled ? 'not-allowed' : 'pointer' }}>
        <span>{value || 'เลือก BU'}</span>
        <span style={{ color: '#888', fontSize: '11px' }}>🔍 ▾</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '34px', left: 0, zIndex: 60, width: '200px', background: '#fff', border: '0.5px solid #cfd6df', borderRadius: '8px', boxShadow: '0 6px 20px rgba(0,0,0,0.15)', padding: '6px' }}>
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="🔍 ค้นหา BU..."
            style={{ width: '100%', boxSizing: 'border-box', height: '28px', border: '0.5px solid #cfd6df', borderRadius: '6px', padding: '0 8px', fontSize: '12px', outline: 'none', marginBottom: '4px' }} />
          <div ref={listRef} style={{ maxHeight: `${ROW_H * 5}px`, overflowY: 'auto' }}>
            {filtered.map((o, i) => (
              <div key={o} onMouseDown={(e) => { e.preventDefault(); pick(o); }} onMouseEnter={() => setHi(i)}
                style={{ height: `${ROW_H}px`, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: '6px', padding: '0 8px', fontSize: '12px', cursor: 'pointer', borderRadius: '4px', background: i === hi ? '#eaf0f6' : 'transparent', color: o === value ? '#1a3a5c' : '#333', fontWeight: o === value ? 600 : 400 }}>
                <span style={{ width: '12px', color: '#1a7a4c' }}>{o === value ? '✓' : ''}</span>{o}
              </div>
            ))}
            {filtered.length === 0 && <div style={{ height: `${ROW_H}px`, display: 'flex', alignItems: 'center', padding: '0 8px', fontSize: '12px', color: '#aaa' }}>ไม่พบ BU</div>}
          </div>
        </div>
      )}
    </span>
  );
}
'''

PATCHES = [
 {"id": "P1 component",
  "old": "// SmComboBox — custom dropdown มี maxHeight + scroll (ใช้ใน RealVendorPopup smGrid)\nfunction SmComboBox(",
  "new": COMPONENT + "// SmComboBox — custom dropdown มี maxHeight + scroll (ใช้ใน RealVendorPopup smGrid)\nfunction SmComboBox("},
 {"id": "P2 replace select",
  "old": "                <select value={mailBu} onChange={ev => { setMailBu(ev.target.value); loadMailConfig(mailType, ev.target.value); loadMailDrafts(mailType, ev.target.value); }}\n                  style={{ height: '30px', border: '0.5px solid #cfd6df', borderRadius: '6px', padding: '0 8px', fontSize: '12px', minWidth: '90px' }}>\n                  {[...new Set([mailBu, ...mailBuOptions].filter(Boolean))].map(b => <option key={b} value={b}>{b}</option>)}\n                </select>\n",
  "new": "                <IeMailBuPicker value={mailBu} options={[...new Set([mailBu, ...mailBuOptions].filter(Boolean))]} onChange={(b) => { setMailBu(b); loadMailConfig(mailType, b); loadMailDrafts(mailType, b); }} /> {/* MARKER_IE_MAIL_BU_SEARCH_PICKER_V1 */}\n"},
]

def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    raw = open(path, "rb").read().decode("utf-8")
    crlf = "\r\n" in raw
    src = raw.replace("\r\n", "\n")
    if MARKER in src:
        print("[SKIP] มีแล้ว (", MARKER, ")"); return
    out = src
    for p in PATCHES:
        c = out.count(p["old"])
        if c != 1:
            print("[ABORT] anchor %s match %d ครั้ง (ต้อง 1) -- ยังไม่แก้ไฟล์" % (p["id"], c)); sys.exit(1)
        out = out.replace(p["old"], p["new"], 1); print("[OK]", p["id"])
    bk = path + ".bak_mail_bu_search_v1"
    n = 1
    while os.path.exists(bk):
        n += 1; bk = path + ".bak_mail_bu_search_v1_" + str(n)
    shutil.copy2(path, bk)
    if crlf: out = out.replace("\n", "\r\n")
    open(path, "wb").write(out.encode("utf-8"))
    print("DONE -> backup:", bk)

if __name__ == "__main__":
    main()
