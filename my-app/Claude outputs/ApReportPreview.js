import React, { useState, useEffect, useMemo } from 'react';

// MARKER_APRECONCILE_REPORT_V1
// Preview รายงาน AP Recon (Popup หลายชีตแบบ Excel อ่านอย่างเดียว) -- ใช้ข้อมูลจาก Parser Preview ตัวเดียวกับ Input
//   ApReportPreview : Popup จาก Control Zone (1 BU = Tab ต่อ Account 52/54/84/85 + ชีต Cover / TB / Accounts Payable Trial Balance ด้านล่าง)
//   ApJobPreview    : Popup ไฟล์ที่เก็บเป็น Job แล้ว (File Storage Zone)
const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';
const BORDER = '#ddd';
const authHeaders = () => { const t = sessionStorage.getItem('fastapn_token'); return t ? { Authorization: `Bearer ${t}` } : {}; };

const colLetter = (n) => { let s = ''; let x = n; while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); } return s; };
const parseCss = (css) => {
  const o = {};
  String(css || '').split(';').forEach((kv) => {
    const i = kv.indexOf(':'); if (i < 0) return;
    const k = kv.slice(0, i).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    o[k] = kv.slice(i + 1).trim();
  });
  return o;
};

// ตารางชีตเดียว (Logic เดียวกับ FileSheetPreview ของ Input)
function SheetGrid({ d, tab }) {
  const sh = d && d.sheets[Math.min(tab, d.sheets.length - 1)];
  const styleObjs = useMemo(() => (d ? d.styles.map(parseCss) : []), [d]);
  const grid = useMemo(() => {
    if (!sh) return null;
    const cellMap = new Map();
    sh.rows.forEach((r) => r.cells.forEach((c) => cellMap.set(`${r.r}:${c[0]}`, c)));
    const span = new Map(); const covered = new Set();
    sh.merges.forEach(([r1, c1, r2, c2]) => {
      span.set(`${r1}:${c1}`, [r2 - r1 + 1, c2 - c1 + 1]);
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) covered.add(`${r}:${c}`);
    });
    const vis = sh.cols.map((w, i) => ({ w, c: i + 1 })).filter((x) => !sh.hidden[x.c - 1]);
    sh.rows.forEach((r) => {
      vis.forEach((x, vi) => {
        const key = `${r.r}:${x.c}`;
        const c = cellMap.get(key);
        if (!c || !c[1] || c[3] || span.has(key) || covered.has(key)) return;
        const ta = ((d && d.styles[c[2]]) || '').match(/text-align:\s*(\w+)/);
        if (ta && ta[1] !== 'left') return;
        const need = String(c[1]).length * 7 + 10;
        let acc = x.w; let n = 1;
        for (let j = vi + 1; j < vis.length && acc < need; j++) {
          const k2 = `${r.r}:${vis[j].c}`;
          const c2 = cellMap.get(k2);
          if ((c2 && c2[1]) || span.has(k2) || covered.has(k2)) break;
          acc += vis[j].w; n++;
        }
        if (n > 1) {
          span.set(key, [1, n]);
          for (let j = vi + 1; j < vi + n; j++) covered.add(`${r.r}:${vis[j].c}`);
        }
      });
    });
    return { cellMap, span, covered };
  }, [sh, d]);
  if (!sh || !grid) return null;
  const visCols = sh.cols.map((w, i) => ({ w, c: i + 1 })).filter((x) => !sh.hidden[x.c - 1]);
  const gl = sh.grid ? '1px solid #e1e1e1' : 'none';
  const hdrCell = { background: '#f3f3f3', border: '1px solid #d4d4d4', color: '#555', fontSize: 11, textAlign: 'center', padding: '1px 4px', position: 'sticky', zIndex: 2 };
  return (
    <>
      <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: 38 + visCols.reduce((t, x) => t + x.w, 0), fontFamily: 'Calibri, Tahoma, sans-serif', fontSize: 13, color: '#000' }}>
        <colgroup><col style={{ width: 38 }} />{visCols.map((x) => <col key={x.c} style={{ width: x.w }} />)}</colgroup>
        <thead>
          <tr>
            <th style={{ ...hdrCell, top: 0, left: 0, zIndex: 3 }} />
            {visCols.map((x) => <th key={x.c} style={{ ...hdrCell, top: 0, fontWeight: 500 }}>{colLetter(x.c)}</th>)}
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
      {sh.truncated && <p style={{ fontSize: 12, color: '#856404', padding: '8px 18px' }}>แสดง {sh.rows.length.toLocaleString()} จาก {sh.totalRows.toLocaleString()} แถว — ดูทั้งหมดได้จากไฟล์ที่ Download</p>}
    </>
  );
}

function SheetTabs({ d, tab, setTab }) {
  if (!d) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, padding: '0 14px', background: '#f3f3f3', borderTop: `1px solid ${BORDER}`, flexShrink: 0, overflowX: 'auto' }}>
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
  );
}

const overlay = { position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15, 23, 42, 0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 4 };
const panel = { background: '#fff', borderRadius: 12, width: '99vw', height: '98vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' };

export function ApJobPreview({ job, onClose }) {
  const [st, setSt] = useState({ loading: true, error: '', data: null });
  const [tab, setTab] = useState(0);
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/ap-reconcile/report/jobs/${job.id}/preview`, { headers: authHeaders() });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j?.error || `เปิด Preview ไม่สำเร็จ (HTTP ${res.status})`);
        if (!dead) setSt({ loading: false, error: '', data: j });
      } catch (err) { if (!dead) setSt({ loading: false, error: err?.message || 'เปิด Preview ไม่สำเร็จ', data: null }); }
    })();
    return () => { dead = true; };
  }, [job.id]);
  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: '#334155', margin: 0 }}>Preview ไฟล์ · {job.fileName || job.file_name}<span style={{ marginLeft: 10, fontSize: 12, fontWeight: 500, color: '#57606a' }}>(อ่านอย่างเดียว)</span></p>
          <button type="button" aria-label="ปิด" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#666' }}>✕</button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {st.loading && <p style={{ fontSize: 13, color: '#666', padding: 18 }}>กำลังเปิดไฟล์...</p>}
          {st.error && <p style={{ fontSize: 13, color: '#a30d16', padding: 18 }}>{st.error}</p>}
          <SheetGrid d={st.data} tab={tab} />
        </div>
        <SheetTabs d={st.data} tab={tab} setTab={setTab} />
      </div>
    </div>
  );
}

export default function ApReportPreview({ bu, period, onClose, onExport, exporting }) {
  const [st, setSt] = useState({ loading: true, error: '', data: null });
  const [acc, setAcc] = useState(0);
  const [tab, setTab] = useState(0);
  useEffect(() => {
    let dead = false;
    setSt({ loading: true, error: '', data: null });
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/ap-reconcile/report/preview?bu=${encodeURIComponent(bu)}&period=${encodeURIComponent(period)}`, { headers: authHeaders() });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j?.error || `เปิด Preview ไม่สำเร็จ (HTTP ${res.status})`);
        if (!dead) setSt({ loading: false, error: '', data: j });
      } catch (err) { if (!dead) setSt({ loading: false, error: err?.message || 'เปิด Preview ไม่สำเร็จ', data: null }); }
    })();
    return () => { dead = true; };
  }, [bu, period]);
  const files = (st.data && st.data.files) || [];
  const cur = files[Math.min(acc, files.length - 1)];
  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: '#334155', margin: 0 }}>Preview — {bu} · {period}<span style={{ marginLeft: 10, fontSize: 12, fontWeight: 500, color: '#57606a' }}>(ไฟล์เดียวกับที่ Export · อ่านอย่างเดียว)</span></p>
          <button type="button" aria-label="ปิด" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#666' }}>✕</button>
        </div>
        <div style={{ display: 'flex', gap: 6, padding: '8px 14px 0', borderBottom: `1px solid ${BORDER}`, flexShrink: 0, overflowX: 'auto' }}>
          {files.map((f, i) => {
            const on = i === acc;
            return (
              <button key={f.account} type="button" onClick={() => { setAcc(i); setTab(0); }}
                style={{ padding: '7px 14px', fontSize: 12.5, fontWeight: on ? 700 : 500, cursor: 'pointer', whiteSpace: 'nowrap', border: `1px solid ${on ? '#0969da' : BORDER}`, borderBottom: on ? '1px solid #fff' : `1px solid ${BORDER}`, marginBottom: -1, borderRadius: '8px 8px 0 0', background: on ? '#fff' : '#f6f8fa', color: on ? '#0969da' : '#475569', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{f.account}</span>
                {f.has_data
                  ? <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'radial-gradient(circle at 30% 30%, #4ac26b, #1a7f37)' }} title="มีข้อมูล" />
                  : <span style={{ padding: '1px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: '#fdedee', color: '#cf222e' }}>No Data</span>}
              </button>
            );
          })}
        </div>
        {cur && <div style={{ padding: '6px 18px', fontSize: 12, color: '#57606a', flexShrink: 0 }}>ชื่อไฟล์: <code style={{ background: '#f6f8fa', padding: '1px 6px', borderRadius: 4 }}>{cur.file_name}</code> &nbsp;·&nbsp; TB {cur.tb_rows} แถว · AP {cur.ap_rows} แถว</div>}
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {st.loading && <p style={{ fontSize: 13, color: '#666', padding: 18 }}>กำลังสร้าง Preview...</p>}
          {st.error && <p style={{ fontSize: 13, color: '#a30d16', padding: 18 }}>{st.error}</p>}
          <SheetGrid d={cur} tab={tab} />
        </div>
        <SheetTabs d={cur} tab={tab} setTab={setTab} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, padding: '10px 18px', borderTop: `1px solid ${BORDER}`, flexShrink: 0 }}>
          <span style={{ marginRight: 'auto', fontSize: 12, color: '#57606a' }}>Export = เก็บ {files.length} ไฟล์เป็น {files.length} Job (My Job / All Job)</span>
          <button type="button" onClick={onClose} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: `1px solid ${BORDER}`, background: '#fff', color: '#334155', cursor: 'pointer' }}>ปิด</button>
          <button type="button" disabled={exporting || st.loading || !!st.error} onClick={onExport} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: '#1a7f37', color: '#fff', cursor: 'pointer', opacity: exporting || st.loading || st.error ? 0.5 : 1 }}>{exporting ? 'กำลัง Export...' : `Export ทั้ง ${files.length || 4} Account`}</button>
        </div>
      </div>
    </div>
  );
}
