# -*- coding: utf-8 -*-
# MARKER_VATRECONCILE_FILE_PREVIEW_FRONT_V18
# (1) Preview ในตารางไฟล์ (Results zone) = ดูไฟล์ .xlsx ที่ Export จริง ทุกชีตแบบ Excel (อ่านอย่างเดียว) -- ไม่ใช่หน้า Reconcile
# (2) Preview ที่ Control Zone = หน้าทำงาน Reconcile (มี Tool) + ช่อง "Prepare by" ของ BU (แก้ได้ บันทึกลง DB)
import sys, shutil, os
M = "MARKER_VATRECONCILE_FILE_PREVIEW_FRONT_V18"
P = sys.argv[1] if len(sys.argv) > 1 else "VatReconcileDashboard.js"
raw = open(P, "rb").read(); crlf = b"\r\n" in raw
s = raw.decode("utf-8").replace("\r\n", "\n")
if M in s: sys.exit("skip: already patched")
shutil.copy2(P, P + ".bak_before_v18")
def rep(old, new):
    global s
    if s.count(old) != 1: sys.exit("ABORT anchor count=%d: %s" % (s.count(old), old[:80]))
    s = s.replace(old, new)

# ---- (2) Prepare by ในหน้าทำงาน ----
rep("""  const [exportMsg, setExportMsg] = useState(null); // { ok, text }
""", """  const [exportMsg, setExportMsg] = useState(null); // { ok, text }
  const [prepVal, setPrepVal] = useState(null); // """ + M + """ -- Prepare by ของ BU (null = ใช้ค่าจาก data.header.preparedBy)
  const savePrep = async (next) => {
    const cur = prepVal != null ? prepVal : (data?.header?.preparedBy || '');
    const v = String(next || '').trim();
    if (v === cur) return;
    try {
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${VAT_RECONCILE_API_BASE}/vat-reconcile/prepared-by`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ bu: state.bu, value: v }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `บันทึกไม่สำเร็จ (HTTP ${res.status})`);
      setPrepVal(v);
    } catch (err) {
      window.alert(err?.message || 'บันทึกไม่สำเร็จ');
    }
  };
""")
rep("""                <span style={{ color: '#57606a' }}>แสดง {shownRows.length} / {data.rows.length} สาขา (Total คิดจากทุกสาขา)</span>
""", """                <span style={{ color: '#57606a' }}>แสดง {shownRows.length} / {data.rows.length} สาขา (Total คิดจากทุกสาขา)</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', color: '#334155' }} title={data.header.preparedByEditable ? 'Prepare by ของ BU นี้ (ออกในไฟล์ Export ช่อง ผู้จัดทำ) -- แก้แล้วบันทึกลง DB' : 'ไม่พบคอลัมน์ Prepare by ใน company_list / vat_setting ของ BU นี้ -- Export จะใช้ชื่อผู้ Export แทน'}>
                  Prepare by
                  <input key={prepVal != null ? prepVal : (data.header.preparedBy || '')} type="text" defaultValue={prepVal != null ? prepVal : (data.header.preparedBy || '')} disabled={!data.header.preparedByEditable}
                    onBlur={(e) => savePrep(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    style={{ padding: '4px 8px', border: `1px solid ${RP_BORDER}`, borderRadius: 6, fontSize: 12.5, width: 200, background: data.header.preparedByEditable ? '#fff' : '#f6f8fa' }} />
                </label>
""")

# ---- (1) Preview ไฟล์ ----
COMP = r'''
// MARKER_VATRECONCILE_FILE_PREVIEW_FRONT_V18 -- Preview ไฟล์ที่ Export จริง (อ่านจาก .xlsx บน Server) ทุกชีตแบบ Excel อ่านอย่างเดียว
const pvColLetter = (n) => { let s = ''; let x = n; while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); } return s; };
const pvParseCss = (css) => {
  const o = {};
  String(css || '').split(';').forEach((kv) => {
    const i = kv.indexOf(':'); if (i < 0) return;
    const k = kv.slice(0, i).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    o[k] = kv.slice(i + 1).trim();
  });
  return o;
};
function FileSheetPreview({ file, onClose }) {
  const [st, setSt] = useState({ loading: true, error: '', data: null });
  const [tab, setTab] = useState(0);
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const res = await fetch(`${VAT_RECONCILE_API_BASE}/vat-reconcile/dashboard/report-files/${file.id}/preview`, { headers: rfAuth() });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j?.error || `เปิด Preview ไม่สำเร็จ (HTTP ${res.status})`);
        if (!dead) setSt({ loading: false, error: '', data: j });
      } catch (err) { if (!dead) setSt({ loading: false, error: err?.message || 'เปิด Preview ไม่สำเร็จ', data: null }); }
    })();
    return () => { dead = true; };
  }, [file.id]);
  const d = st.data;
  const sh = d && d.sheets[Math.min(tab, d.sheets.length - 1)];
  const styleObjs = React.useMemo(() => (d ? d.styles.map(pvParseCss) : []), [d]);
  const grid = React.useMemo(() => {
    if (!sh) return null;
    const cellMap = new Map();
    sh.rows.forEach((r) => r.cells.forEach((c) => cellMap.set(`${r.r}:${c[0]}`, c)));
    const span = new Map(); const covered = new Set();
    sh.merges.forEach(([r1, c1, r2, c2]) => {
      span.set(`${r1}:${c1}`, [r2 - r1 + 1, c2 - c1 + 1]);
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) covered.add(`${r}:${c}`);
    });
    return { cellMap, span, covered };
  }, [sh]);
  const visCols = sh ? sh.cols.map((w, i) => ({ w, c: i + 1 })).filter((x) => !sh.hidden[x.c - 1]) : [];
  const gl = sh && sh.grid ? '1px solid #e1e1e1' : 'none';
  const hdrCell = { background: '#f3f3f3', border: '1px solid #d4d4d4', color: '#555', fontSize: 11, textAlign: 'center', padding: '1px 4px', position: 'sticky', zIndex: 2 };
  const download = async () => { try { await downloadReportFile(file); } catch (err) { window.alert(err?.message || 'ดาวน์โหลดไม่สำเร็จ'); } };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15, 23, 42, 0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 4 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, width: '99vw', height: '98vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderBottom: `1px solid ${RP_BORDER}`, flexShrink: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: '#334155', margin: 0 }}>
            Preview ไฟล์ · {file.file_name}
            <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 500, color: '#57606a' }}>(ไฟล์ที่ Export จริง · อ่านอย่างเดียว)</span>
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="button" onClick={download} style={{ padding: '4px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6, border: '1px solid #0969da', background: '#0969da', color: '#fff', cursor: 'pointer' }}>Download</button>
            <button type="button" aria-label="ปิด" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#666' }}>✕</button>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#fff' }}>
          {st.loading && <p style={{ fontSize: 13, color: '#666', padding: 18 }}>กำลังเปิดไฟล์...</p>}
          {st.error && <p style={{ fontSize: 13, color: '#a30d16', padding: 18 }}>{st.error}</p>}
          {sh && grid && (
            <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', fontFamily: 'Calibri, Tahoma, sans-serif', fontSize: 13, color: '#000' }}>
              <colgroup><col style={{ width: 38 }} />{visCols.map((x) => <col key={x.c} style={{ width: x.w }} />)}</colgroup>
              <thead>
                <tr>
                  <th style={{ ...hdrCell, top: 0, left: 0, zIndex: 3 }} />
                  {visCols.map((x) => <th key={x.c} style={{ ...hdrCell, top: 0, fontWeight: 500 }}>{pvColLetter(x.c)}</th>)}
                </tr>
              </thead>
              <tbody>
                {sh.rows.map((r) => (
                  <tr key={r.r} style={r.h ? { height: r.h } : { height: 20 }}>
                    <td style={{ ...hdrCell, left: 0, position: 'sticky' }}>{r.r}</td>
                    {visCols.map((x) => {
                      const key = `${r.r}:${x.c}`;
                      if (grid.covered.has(key)) return null;
                      const c = grid.cellMap.get(key);
                      const sp = grid.span.get(key);
                      const base = { border: gl, padding: '0 4px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'clip', verticalAlign: 'bottom' };
                      const sty = c ? { ...base, ...(styleObjs[c[2]] || {}), ...(c[3] && !(styleObjs[c[2]] || {}).textAlign ? { textAlign: 'right' } : {}) } : base;
                      return <td key={x.c} rowSpan={sp ? sp[0] : undefined} colSpan={sp ? sp[1] : undefined} style={sty}>{c ? c[1] : ''}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {sh && sh.truncated && <p style={{ fontSize: 12, color: '#856404', padding: '8px 18px' }}>แสดง {sh.rows.length.toLocaleString()} จาก {sh.totalRows.toLocaleString()} แถว — ดูทั้งหมดได้จากไฟล์ที่ Download</p>}
        </div>
        {d && (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, padding: '0 14px', background: '#f3f3f3', borderTop: `1px solid ${RP_BORDER}`, flexShrink: 0, overflowX: 'auto' }}>
            {d.sheets.map((x, i) => {
              const on = i === tab;
              return (
                <button key={x.name} type="button" onClick={() => setTab(i)}
                  style={{ padding: '6px 16px', fontSize: 12.5, fontWeight: on ? 700 : 500, cursor: 'pointer', whiteSpace: 'nowrap', border: 'none', borderTop: on ? '2px solid #1a7f37' : '2px solid transparent', background: on ? '#fff' : 'transparent', color: on ? '#1a7f37' : '#475569' }}>
                  {x.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
'''
rep("""const COLUMN_LABELS = {""", COMP + """
const COLUMN_LABELS = {""")

# ปุ่ม Preview ในตารางไฟล์ -> เปิด FileSheetPreview
rep("""onClick={() => openReconcilePopupFor({ bu: f.bu, account: f.account, period: f.period })} style={{ padding: '3px 9px', fontSize: 11, fontWeight: 700, borderRadius: 6, border: '1px solid #d0d7de'""",
    """onClick={() => setFilePreview(f)} style={{ padding: '3px 9px', fontSize: 11, fontWeight: 700, borderRadius: 6, border: '1px solid #d0d7de'""")
rep("""  const [reportScope, setReportScope] = useState('mine');""", """  const [filePreview, setFilePreview] = useState(null); // """ + M + """
  const [reportScope, setReportScope] = useState('mine');""")
rep("""      {/* DASHBOARD_SIMPLE_DETAIL_MODAL_PATCH_APPLIED -- Modal เต็มจอ""", """      {filePreview && <FileSheetPreview file={filePreview} onClose={() => setFilePreview(null)} />}

      {/* DASHBOARD_SIMPLE_DETAIL_MODAL_PATCH_APPLIED -- Modal เต็มจอ""")
open(P, "wb").write((s.replace("\n", "\r\n") if crlf else s).encode("utf-8"))
print("OK")
