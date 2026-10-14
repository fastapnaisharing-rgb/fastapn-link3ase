import React, { useState, useEffect, useMemo, useRef } from 'react';

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

// ตารางชีตเดียว (Logic เดียวกับ FileSheetPreview ของ Input) + วาดเฉพาะแถวที่เห็น + ชีตใหญ่ (sh.paged) โหลดแถวเพิ่มเป็นช่วงตามที่เลื่อน (loadRows)
const GRID_BLOCK = 200; const GRID_HEAD = 30; const GRID_MAX_BLOCKS = 30; const GRID_VIRT_ABOVE = 120;
function SheetGrid({ d, tab, loadRows }) {
  const sh = d && d.sheets[Math.min(tab, d.sheets.length - 1)];
  const baseN = d ? d.styles.length : 0;
  const styleObjs = useMemo(() => (d ? d.styles.map(parseCss) : []), [d]);
  const wrapRef = useRef(null);
  const [vp, setVp] = useState({ top: 0, h: 900 });
  const [ver, setVer] = useState(0);
  const [loadErr, setLoadErr] = useState('');
  // แถวที่โหลดเพิ่ม (นอก 400 แถวแรก) เก็บเป็น Block ละ 200 แถว | ล้างเมื่อเปลี่ยนชีต
  const ext = useMemo(() => ({ blocks: new Map(), pending: new Set(), failed: new Map(), css: [], cssObj: [], cssIdx: new Map(), center: 0 }), [sh]); // eslint-disable-line react-hooks/exhaustive-deps
  const styleStr = (i) => (i < baseN ? (d.styles[i] || '') : (ext.css[i - baseN] || ''));
  const styleObj = (i) => (i < baseN ? styleObjs[i] : ext.cssObj[i - baseN]);
  const rowMap = useMemo(() => {
    const m = new Map();
    if (!sh) return m;
    sh.rows.forEach((r) => m.set(r.r, r));
    ext.blocks.forEach((rows) => rows.forEach((r) => m.set(r.r, r)));
    return m;
  }, [sh, ver, ext]);
  const grid = useMemo(() => {
    if (!sh) return null;
    const cellMap = new Map();
    rowMap.forEach((r) => r.cells.forEach((c) => cellMap.set(`${r.r}:${c[0]}`, c)));
    const span = new Map(); const covered = new Set();
    sh.merges.forEach(([r1, c1, r2, c2]) => {
      span.set(`${r1}:${c1}`, [r2 - r1 + 1, c2 - c1 + 1]);
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) covered.add(`${r}:${c}`);
    });
    const vis = sh.cols.map((w, i) => ({ w, c: i + 1 })).filter((x) => !sh.hidden[x.c - 1]);
    rowMap.forEach((r) => {
      vis.forEach((x, vi) => {
        const key = `${r.r}:${x.c}`;
        const c = cellMap.get(key);
        if (!c || !c[1] || c[3] || span.has(key) || covered.has(key)) return;
        const ta = styleStr(c[2]).match(/text-align:\s*(\w+)/);
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
  }, [sh, d, rowMap]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const host = wrapRef.current && wrapRef.current.parentElement;
    if (!host) return undefined;
    host.scrollTop = 0;
    let raf = 0;
    const upd = () => { raf = 0; setVp((o) => (Math.abs(o.top - host.scrollTop) < 1 && o.h === host.clientHeight ? o : { top: host.scrollTop, h: host.clientHeight || 900 })); };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(upd); };
    upd();
    host.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { host.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [sh]);
  const paged = !!(sh && sh.paged);
  const total = sh ? (paged ? sh.totalRows : sh.rows.length) : 0;
  const virt = total > GRID_VIRT_ABOVE;
  const offs = useMemo(() => { // ตำแหน่งบนสุดของแต่ละแถว (แถวที่ 1 = offs[0]) | ชีต Paged: แถวหลัง 30 แถวแรกสูง 20 px เท่ากัน
    if (!sh) return [0];
    const cnt = paged ? Math.min(GRID_HEAD, sh.rows.length) : sh.rows.length;
    const a = new Array(cnt + 1); a[0] = 0;
    for (let i = 0; i < cnt; i++) a[i + 1] = a[i] + (sh.rows[i].h || 20);
    return a;
  }, [sh, paged]);
  const offsetOf = (no) => { // บนสุดของแถว no (no = total + 1 -> ท้ายตาราง)
    const hn = offs.length - 1;
    if (no - 1 <= hn) return offs[no - 1];
    return offs[hn] + (no - 1 - hn) * 20;
  };
  const rowAtY = (y) => {
    const hn = offs.length - 1;
    if (y <= offs[hn]) { let i = 0; while (i < hn && offs[i + 1] <= y) i++; return i + 1; }
    return Math.min(total, hn + 1 + Math.floor((y - offs[hn]) / 20));
  };
  let from = 1; let to = total;
  if (virt) {
    from = Math.max(GRID_HEAD + 1, rowAtY(Math.max(0, vp.top - 20 - 600)));
    to = Math.min(total, rowAtY(vp.top + vp.h + 600) + 5);
  }
  // โหลดแถวที่ยังไม่มี (เฉพาะชีต Paged) : ช่วงที่เห็น + เผื่อ 200 แถวบน/ล่าง
  const needKey = paged ? `${rowAtY(Math.max(0, vp.top - 20))}|${rowAtY(vp.top + vp.h)}` : '';
  useEffect(() => {
    if (!paged || !loadRows || !sh) return;
    const [a, b] = needKey.split('|').map(Number);
    const bFrom = Math.max(0, Math.floor((a - 1 - GRID_BLOCK) / GRID_BLOCK));
    const bTo = Math.min(Math.floor((total - 1) / GRID_BLOCK), Math.floor((b - 1 + GRID_BLOCK) / GRID_BLOCK));
    ext.center = Math.floor((a + b) / 2 / GRID_BLOCK);
    for (let bi = bFrom; bi <= bTo; bi++) {
      if ((bi + 1) * GRID_BLOCK <= sh.rows.length || ext.blocks.has(bi) || ext.pending.has(bi)) continue;
      if (ext.failed.has(bi) && Date.now() - ext.failed.get(bi) < 4000) continue;
      ext.pending.add(bi);
      setVer((v) => v + 1);
      loadRows(sh.name, bi * GRID_BLOCK + 1, (bi + 1) * GRID_BLOCK).then((res) => {
        const rows = (res.rows || []).map((r) => ({ ...r, cells: r.cells.map((c) => {
          const css = (res.styles && res.styles[c[2]]) || '';
          if (!css) return [c[0], c[1], 0, c[3]];
          if (!ext.cssIdx.has(css)) { ext.css.push(css); ext.cssObj.push(parseCss(css)); ext.cssIdx.set(css, baseN + ext.css.length - 1); }
          return [c[0], c[1], ext.cssIdx.get(css), c[3]];
        }) }));
        ext.blocks.set(bi, rows);
        while (ext.blocks.size > GRID_MAX_BLOCKS) { // ทิ้ง Block ที่ไกลจากจุดที่ดูอยู่ที่สุด
          let far = null; let fd = -1;
          ext.blocks.forEach((_, k) => { const dd = Math.abs(k - ext.center); if (dd > fd) { fd = dd; far = k; } });
          ext.blocks.delete(far);
        }
        ext.failed.delete(bi); ext.pending.delete(bi); setLoadErr(''); setVer((v) => v + 1);
      }).catch((err) => { ext.pending.delete(bi); ext.failed.set(bi, Date.now()); setLoadErr(err && err.message ? err.message : 'โหลดแถวเพิ่มไม่สำเร็จ'); setVer((v) => v + 1); });
    }
  }, [needKey, sh, paged]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!sh || !grid) return null;
  const visCols = sh.cols.map((w, i) => ({ w, c: i + 1 })).filter((x) => !sh.hidden[x.c - 1]);
  const gl = sh.grid ? '1px solid #e1e1e1' : 'none';
  const hdrCell = { background: '#f3f3f3', border: '1px solid #d4d4d4', color: '#555', fontSize: 11, textAlign: 'center', padding: '1px 4px', position: 'sticky', zIndex: 2 };
  const nos = [];
  if (virt) { for (let i = 1; i <= Math.min(GRID_HEAD, total); i++) nos.push(i); }
  for (let i = virt ? Math.max(from, GRID_HEAD + 1) : 1; i <= to; i++) nos.push(i);
  const startAt = virt ? Math.max(from, GRID_HEAD + 1) : 0;
  const topGap = virt && startAt > GRID_HEAD + 1 ? offsetOf(startAt) - offsetOf(GRID_HEAD + 1) : 0;
  const botGap = virt ? offsetOf(total + 1) - offsetOf(to + 1) : 0;
  const colSpanAll = visCols.length + 1;
  const drawRow = (no) => {
    const r = rowMap.get(no) || { r: no, h: 0, cells: [] };
    const h = paged && no > GRID_HEAD ? 20 : (r.h || 20);
    return (
      <tr key={no} style={{ height: h }}>
        <td style={{ ...hdrCell, left: 0, position: 'sticky' }}>{no}</td>
        {visCols.map((x) => {
          const key = `${no}:${x.c}`;
          if (grid.covered.has(key)) return null;
          const c = grid.cellMap.get(key);
          const sp = grid.span.get(key);
          const base = { border: gl, padding: '0 4px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'clip', verticalAlign: 'bottom' };
          const so = c ? (styleObj(c[2]) || {}) : {};
          const sty = c ? { ...base, ...so, ...(c[3] && !so.textAlign ? { textAlign: 'right' } : {}) } : base;
          return <td key={x.c} rowSpan={sp ? sp[0] : undefined} colSpan={sp ? sp[1] : undefined} style={sty}>{c ? c[1] : ''}</td>;
        })}
      </tr>
    );
  };
  return (
    <div ref={wrapRef}>
      <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: 38 + visCols.reduce((t, x) => t + x.w, 0), fontFamily: 'Calibri, Tahoma, sans-serif', fontSize: 13, color: '#000' }}>
        <colgroup><col style={{ width: 38 }} />{visCols.map((x) => <col key={x.c} style={{ width: x.w }} />)}</colgroup>
        <thead>
          <tr>
            <th style={{ ...hdrCell, top: 0, left: 0, zIndex: 3 }} />
            {visCols.map((x) => <th key={x.c} style={{ ...hdrCell, top: 0, fontWeight: 500 }}>{colLetter(x.c)}</th>)}
          </tr>
        </thead>
        <tbody>
          {nos.map((no) => (no === startAt && topGap > 0
            ? <React.Fragment key={`g${no}`}><tr aria-hidden="true" style={{ height: topGap }}><td colSpan={colSpanAll} style={{ padding: 0, border: 'none' }} /></tr>{drawRow(no)}</React.Fragment>
            : drawRow(no)))}
          {botGap > 0 && <tr aria-hidden="true" style={{ height: botGap }}><td colSpan={colSpanAll} style={{ padding: 0, border: 'none' }} /></tr>}
        </tbody>
      </table>
      {(ext.pending.size > 0 || loadErr) && (
        <div style={{ position: 'sticky', bottom: 8, left: 8, display: 'inline-block', margin: '0 0 8px 8px', padding: '4px 10px', fontSize: 12, borderRadius: 6, background: loadErr ? '#fdedee' : '#eef2f6', color: loadErr ? '#a30d16' : '#475569', boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }}>
          {loadErr ? `โหลดแถวเพิ่มไม่สำเร็จ: ${loadErr}` : 'กำลังโหลดแถว…'}
        </div>
      )}
      {sh.truncated && <p style={{ fontSize: 12, color: '#856404', padding: '8px 18px' }}>แสดง {sh.rows.length.toLocaleString()} จาก {sh.totalRows.toLocaleString()} แถว — ดูทั้งหมดได้จากไฟล์ที่ Download</p>}
    </div>
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

// ขอแถวเพิ่มของชีตใหญ่ (ช่วงตามที่เลื่อน)
const fetchRows = async (url) => {
  const res = await fetch(url, { headers: authHeaders() });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error || `โหลดแถวเพิ่มไม่สำเร็จ (HTTP ${res.status})`);
  return j;
};

const overlay = { position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15, 23, 42, 0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 4 };
const panel = { background: '#fff', borderRadius: 12, width: '99vw', height: '98vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' };

export function ApJobPreview({ job, onClose }) {
  const [st, setSt] = useState({ loading: true, error: '', data: null });
  const [tab, setTab] = useState(0);
  const loadRows = (sheet, from, to) => fetchRows(`${API_BASE}/ap-reconcile/report/jobs/${job.id}/preview/rows?sheet=${encodeURIComponent(sheet)}&from=${from}&to=${to}`);
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
          <SheetGrid d={st.data} tab={tab} loadRows={loadRows} />
        </div>
        <SheetTabs d={st.data} tab={tab} setTab={setTab} />
      </div>
    </div>
  );
}

// MARKER_APRECONCILE_GROUP_VIEW_V1 -- ปุ่ม View ใน File Storage Zone: หน้าตาเหมือน Preview AP Reconcile (Tab ต่อ Account + ชีต Cover/TB/AP TB/Detail) แต่อ่านอย่างเดียวจากไฟล์ที่ Export แล้ว -- ไม่มีปุ่ม Export / ไม่สร้างใหม่
export function ApGroupPreview({ jobs, title, onClose }) {
  const LIST = useMemo(() => [...(jobs || [])].sort((a, b) => String((a.pf && a.pf.acct) || a.account || '').localeCompare(String((b.pf && b.pf.acct) || b.account || ''))), [jobs]);
  const [items, setItems] = useState(() => LIST.map((job) => ({ job, loading: true })));
  const [acc, setAcc] = useState(0);
  const [tab, setTab] = useState(0);
  useEffect(() => {
    let dead = false;
    setItems(LIST.map((job) => ({ job, loading: true })));
    LIST.forEach((job, i) => {
      (async () => {
        let item;
        try {
          const res = await fetch(`${API_BASE}/ap-reconcile/report/jobs/${job.id}/preview`, { headers: authHeaders() });
          const j = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(j?.error || `เปิด Preview ไม่สำเร็จ (HTTP ${res.status})`);
          item = { ...j, job };
        } catch (err) { item = { job, error: err?.message || 'เปิด Preview ไม่สำเร็จ' }; }
        if (dead) return;
        setItems((prev) => prev.map((x, k) => (k === i ? item : x)));
      })();
    });
    return () => { dead = true; };
  }, [LIST]);
  const acctOf = (f) => (f.job.pf && f.job.pf.acct) || f.job.account || '';
  const cur = items[Math.min(acc, items.length - 1)];
  const loadRows = (sheet, from, to) => fetchRows(`${API_BASE}/ap-reconcile/report/jobs/${cur.job.id}/preview/rows?sheet=${encodeURIComponent(sheet)}&from=${from}&to=${to}`);
  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: '#334155', margin: 0 }}>Preview — {title || 'AP Reconcile'}<span style={{ marginLeft: 10, fontSize: 12, fontWeight: 500, color: '#57606a' }}>(ไฟล์ที่ Export แล้ว · อ่านอย่างเดียว)</span></p>
          <button type="button" aria-label="ปิด" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#666' }}>✕</button>
        </div>
        <div style={{ display: 'flex', gap: 6, padding: '8px 14px 0', borderBottom: `1px solid ${BORDER}`, flexShrink: 0, overflowX: 'auto' }}>
          {items.map((f, i) => {
            const on = i === acc; const noData = !!(f.job.pf && f.job.pf.noData);
            return (
              <button key={f.job.id} type="button" onClick={() => { setAcc(i); setTab(0); }}
                style={{ padding: '7px 14px', fontSize: 12.5, fontWeight: on ? 700 : 500, cursor: 'pointer', whiteSpace: 'nowrap', border: `1px solid ${on ? '#0969da' : BORDER}`, borderBottom: on ? '1px solid #fff' : `1px solid ${BORDER}`, marginBottom: -1, borderRadius: '8px 8px 0 0', background: on ? '#fff' : '#f6f8fa', color: on ? '#0969da' : '#57606a', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span>{acctOf(f)}</span>
                {f.loading ? <span style={{ fontSize: 10.5, color: '#8b95a1' }}>กำลังโหลด…</span>
                  : f.error ? <span style={{ padding: '1px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: '#fdedee', color: '#cf222e' }}>Error</span>
                  : noData ? <span style={{ padding: '1px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: '#fdedee', color: '#cf222e' }}>No Data</span>
                    : <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'radial-gradient(circle at 30% 30%, #4ac26b, #1a7f37)' }} title="มีข้อมูล" />}
              </button>
            );
          })}
        </div>
        {cur && (
          <div style={{ padding: '6px 18px', fontSize: 12, color: '#57606a', flexShrink: 0 }}>
            ชื่อไฟล์: <code style={{ background: '#f6f8fa', padding: '1px 6px', borderRadius: 4 }}>{cur.job.fileName || cur.job.file_name}</code>
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {cur && cur.loading && <p style={{ fontSize: 13, color: '#666', padding: 18 }}>กำลังเปิดไฟล์...</p>}
          {cur && cur.error && <p style={{ fontSize: 13, color: '#a30d16', padding: 18 }}>{cur.error}</p>}
          {cur && cur.sheets && <SheetGrid key={cur.job.id} d={cur} tab={tab} loadRows={loadRows} />}
        </div>
        {cur && cur.sheets && <SheetTabs d={cur} tab={tab} setTab={setTab} />}
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, padding: '10px 18px', borderTop: `1px solid ${BORDER}`, flexShrink: 0 }}>
          <span style={{ marginRight: 'auto', fontSize: 12, color: '#57606a' }}>ดูไฟล์ที่ Export แล้ว {items.length} Account — ไม่สามารถแก้ไขได้</span>
          <button type="button" onClick={onClose} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: `1px solid ${BORDER}`, background: '#fff', color: '#334155', cursor: 'pointer' }}>ปิด</button>
        </div>
      </div>
    </div>
  );
}

const REPORT_ACCOUNTS = ['21930052', '21930054', '21930084', '21930085'];
// MARKER_APRECONCILE_IE_REPORT_V1 -- prefetch เฉพาะกลุ่ม AP 4 ตัว | Popup รับ accounts เพิ่มได้ (IE 100/220 ใช้ Template เดียวกัน)

// แคชผล Preview ฝั่งหน้าเว็บ 30 วินาที + โหลดล่วงหน้าได้ (prefetchApPreview) -- กดปุ่ม Preview แล้วขึ้นทันทีถ้าโหลดไว้แล้ว
const previewCache = new Map();
function fetchApPreview(bu, period, account) {
  const key = `${bu}|${period}|${account}`;
  const hit = previewCache.get(key);
  if (hit && Date.now() - hit.t < 30000) return hit.p;
  const url = `${API_BASE}/ap-reconcile/report/preview?bu=${encodeURIComponent(bu)}&period=${encodeURIComponent(period)}&account=${account}`;
  const p = (async () => {
    const res = await fetch(url, { headers: authHeaders() });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j?.error || `เปิด Preview ไม่สำเร็จ (HTTP ${res.status})`);
    let net = null;
    try {
      const e = performance.getEntriesByName(url).slice(-1)[0];
      if (e && e.responseStart > 0) net = { wait: Math.round(e.responseStart - e.requestStart), dl: Math.round(e.responseEnd - e.responseStart), kb: Math.round((e.encodedBodySize || 0) / 1024) };
    } catch (_) { /* ไม่มีข้อมูลเวลา -> ข้าม */ }
    return { ...j.files[0], timing: j.timing, net };
  })();
  previewCache.set(key, { t: Date.now(), p });
  p.catch(() => previewCache.delete(key));
  return p;
}
export function prefetchApPreview(bu, period) {
  if (!bu || !period) return;
  REPORT_ACCOUNTS.forEach((a) => { fetchApPreview(bu, period, a).catch(() => {}); });
}

export default function ApReportPreview({ bu, period, onClose, onExport, exporting, accounts }) { // MARKER_APRECONCILE_PREVIEW_ACCOUNTS_V1 -- accounts = เฉพาะ Account ที่ต้องการ (ดับเบิลคลิกจุดใน Dashboard / เลือก IE)
  const LIST = useMemo(() => (Array.isArray(accounts) && accounts.length ? accounts : REPORT_ACCOUNTS), [accounts]);
  // โหลดทีละ Account แยกกัน (พร้อมกัน 4 คำขอ) -- Tab ไหนเสร็จก่อนเปิดดูได้ก่อน | วัดเวลาให้เห็นบนหน้าจอ
  const [items, setItems] = useState(() => LIST.map((account) => ({ account, loading: true })));
  const [acc, setAcc] = useState(0);
  const [tab, setTab] = useState(0);
  const [stat, setStat] = useState({ startedAt: Date.now(), doneMs: null, server: {} });
  useEffect(() => {
    let dead = false;
    const t0 = Date.now();
    setItems(LIST.map((account) => ({ account, loading: true })));
    setStat({ startedAt: t0, doneMs: null, server: {} });
    let left = LIST.length;
    LIST.forEach((account, i) => {
      (async () => {
        let item;
        try {
          const j = await fetchApPreview(bu, period, account);
          item = { ...j, clientMs: Date.now() - t0 };
        } catch (err) { item = { account, error: err?.message || 'เปิด Preview ไม่สำเร็จ' }; }
        if (dead) return;
        setItems((prev) => prev.map((x, k) => (k === i ? item : x)));
        left -= 1;
        if (left === 0) setStat((s) => ({ ...s, doneMs: Date.now() - t0 }));
      })();
    });
    return () => { dead = true; };
  }, [bu, period, LIST]);
  const cur = items[Math.min(acc, items.length - 1)];
  const tm = cur && cur.timing;
  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: '#334155', margin: 0 }}>Preview — {bu} · {period}<span style={{ marginLeft: 10, fontSize: 12, fontWeight: 500, color: '#57606a' }}>(ไฟล์เดียวกับที่ Export · อ่านอย่างเดียว)</span></p>
          <button type="button" aria-label="ปิด" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#666' }}>✕</button>
        </div>
        <div style={{ display: 'flex', gap: 6, padding: '8px 14px 0', borderBottom: `1px solid ${BORDER}`, flexShrink: 0, overflowX: 'auto' }}>
          {items.map((f, i) => {
            const on = i === acc;
            return (
              <button key={f.account} type="button" onClick={() => { setAcc(i); setTab(0); }}
                style={{ padding: '7px 14px', fontSize: 12.5, fontWeight: on ? 700 : 500, cursor: 'pointer', whiteSpace: 'nowrap', border: `1px solid ${on ? '#0969da' : BORDER}`, borderBottom: on ? '1px solid #fff' : `1px solid ${BORDER}`, marginBottom: -1, borderRadius: '8px 8px 0 0', background: on ? '#fff' : '#f6f8fa', color: on ? '#0969da' : '#475569', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{f.account}</span>
                {f.loading ? <span style={{ fontSize: 10.5, color: '#8b95a1' }}>กำลังโหลด…</span>
                  : f.error ? <span style={{ padding: '1px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: '#fdedee', color: '#cf222e' }}>Error</span>
                  : f.has_data
                    ? <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'radial-gradient(circle at 30% 30%, #4ac26b, #1a7f37)' }} title="มีข้อมูล" />
                    : <span style={{ padding: '1px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: '#fdedee', color: '#cf222e' }}>No Data</span>}
              </button>
            );
          })}
        </div>
        {cur && cur.file_name && (
          <div style={{ padding: '6px 18px', fontSize: 12, color: '#57606a', flexShrink: 0 }}>
            ชื่อไฟล์: <code style={{ background: '#f6f8fa', padding: '1px 6px', borderRadius: 4 }}>{cur.file_name}</code> &nbsp;·&nbsp; TB {cur.tb_rows} แถว · AP {cur.ap_rows} แถว
            {tm && <span style={{ marginLeft: 10, color: '#8b95a1' }}>⏱ รวม {(cur.clientMs / 1000).toFixed(1)} วิ (Server {tm.total_ms} ms = ฐานข้อมูล {tm.db_ms} + สร้าง {tm.build_ms}{cur.net ? ` · รอ Server {cur.net.wait} ms · ดาวน์โหลด {cur.net.dl} ms (${cur.net.kb} KB)` : ''})</span>}
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {cur && cur.loading && <p style={{ fontSize: 13, color: '#666', padding: 18 }}>กำลังสร้าง Preview...</p>}
          {cur && cur.error && <p style={{ fontSize: 13, color: '#a30d16', padding: 18 }}>{cur.error}</p>}
          {cur && cur.sheets && <SheetGrid d={cur} tab={tab} loadRows={(sheet, from, to) => fetchRows(`${API_BASE}/ap-reconcile/report/preview/rows?bu=${encodeURIComponent(bu)}&period=${encodeURIComponent(period)}&account=${cur.account}&sheet=${encodeURIComponent(sheet)}&from=${from}&to=${to}`)} />}
        </div>
        {cur && cur.sheets && <SheetTabs d={cur} tab={tab} setTab={setTab} />}
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, padding: '10px 18px', borderTop: `1px solid ${BORDER}`, flexShrink: 0 }}>
          <span style={{ marginRight: 'auto', fontSize: 12, color: '#57606a' }}>Export = เก็บ {items.length} ไฟล์เป็น {items.length} Job (My Job / All Job){stat.doneMs != null ? ` · โหลดครบ 4 Tab ใน ${(stat.doneMs / 1000).toFixed(1)} วิ` : ''}</span>
          <button type="button" onClick={onClose} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: `1px solid ${BORDER}`, background: '#fff', color: '#334155', cursor: 'pointer' }}>ปิด</button>
          <button type="button" disabled={exporting || items.some((x) => x.loading || x.error)} onClick={onExport} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: '#1a7f37', color: '#fff', cursor: 'pointer', opacity: exporting || items.some((x) => x.loading || x.error) ? 0.5 : 1 }}>{exporting ? 'กำลัง Export...' : `Export ทั้ง ${items.length} Account`}</button>
        </div>
      </div>
    </div>
  );
}
