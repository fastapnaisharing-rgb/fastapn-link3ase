import React, { useState, useEffect, useCallback, useRef } from 'react';
import { maybeUpdateSpHandler } from '../spHandlerAutoUpdate'; // MARKER_SP_HANDLER_AUTOUPDATE_V1

// MARKER_RECONCILE_RESULTS_EXPLORER_V1
// Resource Center > Document Center > Tile "VAT Control": ที่เก็บ Results ที่ Export จาก Input Reconcile
// เดือน > BU > (Folder ย่อย) > ไฟล์ -- หน้าตา/การใช้งานแบบ Windows Explorer, ทุกเมนูอยู่ในคลิกขวา
// Backend: /api/vat-reconcile/result-folders/*  (vatResultFolders.js)
const API = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/$/, '') + '/vat-reconcile/result-folders';
const MAX_BYTES = 10 * 1024 * 1024;
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const GRID = 'minmax(0,3fr) 170px 180px 90px 170px'; // MARKER_RRE_SP_COLUMN_V1 -- เพิ่มคอลัมน์ SharePoint ท้ายตาราง

const token = () => sessionStorage.getItem('fastapn_token');
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(token() ? { Authorization: `Bearer ${token()}` } : {}) },
  });
  if (res.status === 401) window.dispatchEvent(new CustomEvent('fastapn:unauthorized'));
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}
const fmtPeriod = (p) => String(p || '').replace('-', '.');
const fmtDate = (d) => { if (!d) return ''; const x = new Date(d); return Number.isNaN(x.getTime()) ? '' : x.toLocaleString('en-US', { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const fmtShort = (d) => { if (!d) return ''; const x = new Date(d); return Number.isNaN(x.getTime()) ? '' : x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }); };
const fmtSize = (n) => (n == null ? '' : n < 1024 ? n + ' B' : n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
// เลขBU_BU_รายงาน_Mon-YY.xlsx  ->  { period, bu } (ตรงกับ Backend parseFileName)
function parseName(name) {
  const m = /^(?:(\d+)_)?([A-Za-z0-9-]+)_(.+)_([A-Za-z]{3})-(\d{2})\.xlsx$/i.exec(name);
  if (!m) return null;
  const mi = MON.indexOf(m[4].toUpperCase());
  return mi < 0 ? null : { bu: m[2].toUpperCase(), period: `20${m[5]}-${String(mi + 1).padStart(2, '0')}` };
}
const toBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
  r.readAsDataURL(file);
});

const FolderSvg = () => (<svg width="24" height="24" viewBox="0 0 24 24" fill="#f4b942" style={{ flexShrink: 0 }}><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h4l2 2.5h7A2.5 2.5 0 0 1 21 9v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" /></svg>);
const FileSvg = () => (<svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}><rect x="4" y="3" width="16" height="18" rx="2" fill="#1f8a4c" /><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" /></svg>);
const navBtn = (off) => ({ width: 36, height: 36, border: 0, background: 'transparent', borderRadius: 6, cursor: off ? 'default' : 'pointer', color: '#1b1f24', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: off ? 0.35 : 1 });

// MARKER_HIDE_NODATA_ACCT_FILES_V1 -- ไม่แสดงไฟล์ที่ชื่อมีรหัสบัญชีเหล่านี้ที่ VAT Controller (ไฟล์ยังอยู่ใน SharePoint ไม่ถูกลบ)
const HIDDEN_ACCT_CODES = ['21930052', '21930054', '21930084', '21930085', '21930100', '21930220'];
const isHiddenAcctFile = (name) => { const n = String(name || ''); return HIDDEN_ACCT_CODES.some((c) => n.includes(c)); };

export default function ReconcileResultsExplorer({ onBack }) {
  const [hist, setHist] = useState([{ l: 'root' }]);
  const [idx, setIdx] = useState(0);
  const [items, setItems] = useState([]);
  const [crumbs, setCrumbs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState('');
  const [qTerm, setQTerm] = useState('');
  const [menu, setMenu] = useState(null);
  const [newRow, setNewRow] = useState(false);
  const [newName, setNewName] = useState('New folder');
  const [newErr, setNewErr] = useState('');
  const [queue, setQueue] = useState(null); // dialog วางไฟล์: { rows:[{file,name,dest,status,note}], running }
  const [confirmDel, setConfirmDel] = useState(null);
  const [toast, setToast] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [monthOpts, setMonthOpts] = useState([]);
  const [buOpts, setBuOpts] = useState({}); // { 'YYYY-MM': ['LKS',...] }
  const rootRef = useRef(null);
  const fileInputRef = useRef(null);
  const reqSeq = useRef(0);
  const loc = hist[idx];

  const showToast = useCallback((t) => { setToast(t); setTimeout(() => setToast(''), 3000); }, []);
  const go = (l) => { setHist((h) => h.slice(0, idx + 1).concat([l])); setIdx((i) => i + 1); setSel(null); setQ(''); setQTerm(''); setNewRow(false); setNewErr(''); setMenu(null); };

  // ค้นหา: หน่วง 350 ms
  useEffect(() => { const t = setTimeout(() => setQTerm(q.trim()), 350); return () => clearTimeout(t); }, [q]);

  const load = useCallback(async () => {
    const seq = ++reqSeq.current;
    setLoading(true); setError('');
    try {
      let r;
      if (qTerm) {
        r = await api('/search?q=' + encodeURIComponent(qTerm));
        if (seq !== reqSeq.current) return;
        if (!r.ok) throw new Error(r.data?.error || 'ค้นหาไม่สำเร็จ');
        setItems((r.data.items || []).filter((x) => x.kind === 'folder' || x.kind === 'month' || x.kind === 'bu' || !isHiddenAcctFile(x.name)).map((x) => ({ ...x, key: `${x.kind}:${x.id || x.period + (x.bu || '')}`, search: true })));
        setCrumbs([]);
      } else if (loc.l === 'root') {
        r = await api('/months');
        if (seq !== reqSeq.current) return;
        if (!r.ok) throw new Error(r.data?.error || 'โหลดไม่สำเร็จ');
        setItems((r.data.months || []).map((m) => ({ kind: 'month', key: 'm:' + m.period, period: m.period, name: fmtPeriod(m.period), updated_at: m.updated_at })));
        setCrumbs([]);
      } else if (loc.l === 'month') {
        r = await api(`/months/${loc.p}/bus`);
        if (seq !== reqSeq.current) return;
        if (!r.ok) throw new Error(r.data?.error || 'โหลดไม่สำเร็จ');
        setItems((r.data.bus || []).map((b) => ({ kind: 'bu', key: 'b:' + b.bu, period: loc.p, bu: b.bu, name: b.bu, updated_at: b.updated_at })));
        setCrumbs([]);
      } else {
        r = await api(`/list?period=${loc.p}&bu=${encodeURIComponent(loc.b)}${loc.f ? '&folder=' + loc.f : ''}`);
        if (seq !== reqSeq.current) return;
        if (!r.ok) throw new Error(r.data?.error || 'โหลดไม่สำเร็จ');
        setItems([...(r.data.folders || []), ...(r.data.files || []).filter((x) => !isHiddenAcctFile(x.name))].map((x) => ({ ...x, key: `${x.kind}:${x.id}`, period: loc.p, bu: loc.b })));
        setCrumbs(r.data.crumbs || []);
      }
    } catch (e) {
      if (seq === reqSeq.current) { setError(e.message); setItems([]); }
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [loc, qTerm]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { maybeUpdateSpHandler(); }, []); // MARKER_SP_HANDLER_AUTOUPDATE_V1 -- เปิด Resource Center > VAT Control = ให้ Handler SharePoint ตรวจ/อัปเดตตัวเอง

  // ── เปิดไฟล์ใน SharePoint (แท็บใหม่) -- ลิงก์สร้างโดย Backend ตอนกดส่ง ──
  const openSp = (it) => { if (it && it.sp_url) window.open(it.sp_url, '_blank', 'noopener'); };

  // ── เปิดรายการ ──
  const openItem = (it) => {
    if (!it) return;
    if (it.kind === 'month') go({ l: 'month', p: it.period });
    else if (it.kind === 'bu') go({ l: 'bu', p: it.period, b: it.bu, f: null });
    else if (it.kind === 'folder') go({ l: 'bu', p: it.period, b: it.bu, f: it.id });
    else if (it.kind === 'file' && it.search) go({ l: 'bu', p: it.period, b: it.bu, f: it.folder || null });
    else if (it.kind === 'file' && it.sp_url) openSp(it);
  };

  // ── Navigation ──
  const canBack = idx > 0, canFwd = idx < hist.length - 1, canUp = loc.l !== 'root' && !qTerm;
  const goUp = () => {
    if (!canUp) return;
    if (loc.l === 'bu' && loc.f) go({ l: 'bu', p: loc.p, b: loc.b, f: crumbs.length > 1 ? crumbs[crumbs.length - 2].id : null });
    else if (loc.l === 'bu') go({ l: 'month', p: loc.p });
    else go({ l: 'root' });
  };
  const crumbList = [{ label: 'Reconcile Results', sep: '', go: () => go({ l: 'root' }) }];
  if (loc.l !== 'root') crumbList.push({ label: fmtPeriod(loc.p), sep: '›', go: () => go({ l: 'month', p: loc.p }) });
  if (loc.l === 'bu') {
    crumbList.push({ label: loc.b, sep: '›', go: () => go({ l: 'bu', p: loc.p, b: loc.b, f: null }) });
    crumbs.forEach((c) => crumbList.push({ label: c.name, sep: '›', go: () => go({ l: 'bu', p: loc.p, b: loc.b, f: c.id }) }));
  }
  const canNew = loc.l === 'bu' && !qTerm;

  // ── Folder ใหม่ ──
  const confirmNew = async () => {
    const name = newName.trim();
    if (!name) return setNewErr('กรุณาตั้งชื่อ Folder');
    if (/[\\/:*?"<>|]/.test(name)) return setNewErr('ห้ามใช้อักขระ \\ / : * ? " < > |');
    if (items.some((x) => x.kind === 'folder' && x.name.toLowerCase() === name.toLowerCase())) return setNewErr('มี Folder ชื่อนี้อยู่แล้ว');
    const r = await api('/folders', { method: 'POST', body: JSON.stringify({ period: loc.p, bu: loc.b, parentId: loc.f || null, name }) });
    if (!r.ok) return setNewErr(r.data?.error || 'สร้าง Folder ไม่สำเร็จ');
    setNewRow(false); setNewErr(''); await load(); setSel('folder:' + r.data.folder.id);
  };

  // ── ดาวน์โหลด / ลบ ──
  const download = async (it) => {
    try {
      const res = await fetch(`${API}/files/${it.id}/download`, { headers: { Authorization: `Bearer ${token()}` } });
      if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.error || 'ดาวน์โหลดไม่สำเร็จ'); }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a'); a.href = url; a.download = it.name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { showToast(e.message); }
  };
  const doDelete = async () => {
    const it = confirmDel; setConfirmDel(null);
    const r = await api(it.kind === 'folder' ? `/folders/${it.id}` : `/files/${it.id}`, { method: 'DELETE' });
    if (!r.ok) return showToast(r.data?.error || 'ลบไม่สำเร็จ');
    showToast(`ลบ "${it.name}" แล้ว`); setSel(null); load();
  };

  // ── วางไฟล์ (Ctrl+V / ลากมาวาง / เลือกไฟล์) ──
  const queueFiles = useCallback((files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    const rows = list.map((file) => {
      const base = { file, name: file.name, status: 'wait', note: '' };
      if (!/\.xlsx$/i.test(file.name)) return { ...base, status: 'skip', note: 'รับเฉพาะไฟล์ .xlsx' };
      if (file.size > MAX_BYTES) return { ...base, status: 'skip', note: 'ไฟล์ใหญ่เกิน 10 MB' };
      const p = parseName(file.name);
      if (p) return { ...base, dest: { period: p.period, bu: p.bu }, chk: { period: p.period, bu: p.bu, folder: null }, destLabel: `Reconcile Results › ${fmtPeriod(p.period)} › ${p.bu}`, note: 'จัดเข้า Folder ตามชื่อไฟล์' };
      if (loc.l === 'bu' && !qTerm) return { ...base, dest: loc.f ? { folderId: loc.f } : { period: loc.p, bu: loc.b }, chk: { period: loc.p, bu: loc.b, folder: loc.f || null }, destLabel: ['Reconcile Results', fmtPeriod(loc.p), loc.b, ...crumbs.map((c) => c.name)].join(' › '), note: 'อ่านเดือน/BU จากชื่อไฟล์ไม่ได้ — ใส่ใน Folder ที่เปิดอยู่' };
      return { ...base, status: 'pick', pick: true, pp: '', pb: '', note: 'อ่านเดือน/BU จากชื่อไฟล์ไม่ได้ — เลือกปลายทางเอง', };
    });
    setQueue({ rows, running: false });
  }, [loc, qTerm, crumbs]);
  const saveQueue = async () => {
    if (!queue || queue.running) return;
    setQueue((s) => ({ ...s, running: true }));
    let okCount = 0;
    const rows = queue.rows.map((r) => ({ ...r }));
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.status !== 'wait') continue;
      try {
        const res = await api('/upload', { method: 'POST', body: JSON.stringify({ fileName: r.name, fileBase64: await toBase64(r.file), ...r.dest }) });
        if (res.ok) { r.status = 'done'; r.note = res.data.file.replaced ? 'แทนที่ไฟล์เดิมแล้ว' : 'บันทึกแล้ว'; okCount++; }
        else { r.status = 'error'; r.note = res.data?.error || 'บันทึกไม่สำเร็จ'; }
      } catch (e) { r.status = 'error'; r.note = e.message; }
      setQueue({ rows: rows.map((x) => ({ ...x })), running: true });
    }
    setQueue({ rows, running: false, finished: true });
    if (okCount) { showToast(`บันทึก ${okCount} ไฟล์เรียบร้อย`); load(); }
  };

  // ตัวเลือกเดือนสำหรับไฟล์ที่ต้องเลือกปลายทางเอง (2 เดือนล่าสุด) / BU ของเดือนที่เลือก
  const needPick = !!(queue && queue.rows.some((r) => r.pick));
  useEffect(() => {
    if (!needPick || monthOpts.length) return;
    api('/months').then((r) => { if (r.ok) setMonthOpts((r.data.months || []).map((m) => m.period)); });
  }, [needPick, monthOpts.length]);
  const pickMonth = (i, period) => {
    setQueue((s) => ({ ...s, rows: s.rows.map((r, k) => (k === i ? { ...r, pp: period, pb: '', status: 'pick', dest: null, chk: null, destLabel: '', checked: false } : r)) }));
    if (period && !buOpts[period]) api(`/months/${period}/bus`).then((r) => { if (r.ok) setBuOpts((o) => ({ ...o, [period]: (r.data.bus || []).map((b) => b.bu) })); });
  };
  const pickBu = (i, bu) => setQueue((s) => ({ ...s, rows: s.rows.map((r, k) => (k === i ? (bu
    ? { ...r, pb: bu, status: 'wait', dest: { period: r.pp, bu }, chk: { period: r.pp, bu, folder: null }, destLabel: `Reconcile Results › ${fmtPeriod(r.pp)} › ${bu}`, note: '', checked: false }
    : { ...r, pb: '', status: 'pick', dest: null, chk: null, destLabel: '', checked: false }) : r)) }));

  // เช็คไฟล์ชื่อซ้ำล่วงหน้า (เทียบกับรายการจริงในปลายทาง) -- ชื่อซ้ำ = แทนที่ / ถ้าเป็นของคนอื่นแทนที่ไม่ได้
  useEffect(() => {
    if (!queue || queue.running || queue.finished) return;
    const todo = queue.rows.map((r, i) => ({ r, i })).filter(({ r }) => r.chk && !r.checked && r.status === 'wait');
    if (!todo.length) return;
    let dead = false;
    (async () => {
      const cache = {}; const out = {};
      for (const { r, i } of todo) {
        const k = `${r.chk.period}|${r.chk.bu}|${r.chk.folder || ''}`;
        if (!(k in cache)) { const x = await api(`/list?period=${r.chk.period}&bu=${encodeURIComponent(r.chk.bu)}${r.chk.folder ? '&folder=' + r.chk.folder : ''}`); cache[k] = x.ok ? (x.data.files || []) : []; }
        const hit = cache[k].find((f) => f.name.toLowerCase() === r.name.toLowerCase());
        out[i] = hit ? (hit.can_delete ? { dup: 'replace', note: 'มีไฟล์ชื่อเดียวกันอยู่แล้ว — จะถูกแทนที่' } : { dup: 'blocked', note: `มีไฟล์ชื่อนี้ที่ ${hit.created_by} สร้างไว้ — แทนที่ไม่ได้ (เปลี่ยนชื่อไฟล์)` }) : { dup: '' };
      }
      if (dead) return;
      setQueue((s) => (!s ? s : { ...s, rows: s.rows.map((r, i) => (out[i] && r.chk ? { ...r, checked: true, dup: out[i].dup, status: out[i].dup === 'blocked' ? 'skip' : r.status, note: out[i].note || r.note } : r)) }));
    })();
    return () => { dead = true; };
  }, [queue]);

  useEffect(() => {
    const onPaste = (e) => {
      if (queue || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '')) return;
      const files = e.clipboardData && e.clipboardData.files;
      if (files && files.length) { e.preventDefault(); queueFiles(files); }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [queue, queueFiles]);

  // Esc: ปิดเมนู/Dialog ก่อน (กัน Esc ไปทำให้ถอยออกจากหน้านี้ทั้งหมด) -- ถ้าไม่มีอะไรเปิดอยู่ปล่อยให้ Esc = Back ตามเดิม
  useEffect(() => {
    const fn = (e) => {
      if (e.key !== 'Escape') return;
      if (menu || confirmDel || queue || newRow) {
        e.stopPropagation();
        if (menu) setMenu(null); else if (confirmDel) setConfirmDel(null); else if (queue) { if (!queue.running) setQueue(null); } else setNewRow(false);
      }
    };
    document.addEventListener('keydown', fn, true);
    return () => document.removeEventListener('keydown', fn, true);
  }, [menu, confirmDel, queue, newRow]);

  // ── คลิกขวา ──
  const openMenu = (e, it) => {
    e.preventDefault(); e.stopPropagation();
    const r = rootRef.current.getBoundingClientRect();
    setMenu({ x: Math.max(0, Math.min(e.clientX - r.left, r.width - 246)), y: Math.max(0, Math.min(e.clientY - r.top, r.height - 200)), item: it });
    if (it) setSel(it.key);
  };
  const MI = (label, hint, run, off, danger) => ({ label, hint, run: () => { setMenu(null); run(); }, off: !!off, danger: !!danger });
  let menuItems = [];
  if (menu) {
    const it = menu.item;
    if (it && (it.kind === 'month' || it.kind === 'bu' || it.kind === 'folder')) {
      menuItems = [MI('Open', 'Enter', () => openItem(it)), null,
        MI('Delete', it.kind !== 'folder' ? 'Folder ระบบ' : it.can_delete ? 'Del' : 'ไม่ใช่ของคุณ', () => setConfirmDel(it), it.kind !== 'folder' || !it.can_delete, true)];
    } else if (it && it.kind === 'file') {
      menuItems = [...(it.search ? [MI('เปิด Folder ที่เก็บไฟล์', '', () => go({ l: 'bu', p: it.period, b: it.bu, f: it.folder || null }))] : []),
        ...(it.sp_url ? [MI('เปิดใน SharePoint', 'แท็บใหม่', () => openSp(it))] : []),
        MI('Download', it.file_removed ? 'ลบสำเนาแล้ว' : '', () => download(it), !!it.file_removed), null,
        MI('Delete', it.can_delete ? 'Del' : 'สร้างโดย ' + it.created_by, () => setConfirmDel(it), !it.can_delete, true)];
    } else {
      menuItems = [MI('+ Folder', canNew ? '' : 'ใน BU เท่านั้น', () => { setNewRow(true); setNewName('New folder'); setNewErr(''); setSel(null); }, !canNew),
        MI('อัปโหลดไฟล์…', 'หรือ Ctrl+V / ลากมาวาง', () => fileInputRef.current && fileInputRef.current.click()), null, MI('Refresh', '', load)];
    }
  }

  const selItem = items.find((x) => x.key === sel) || null;
  const hint = qTerm ? 'ค้นจากทุกเดือน (รวมเดือนที่เก่ากว่า 2 เดือน)' : (loc.l === 'root' ? 'แสดงเฉพาะ 2 เดือนล่าสุด — เดือนเก่ากว่านี้ใช้ช่องค้นหา  ·  ' : '') + 'วาง (Ctrl+V) หรือลากไฟล์มาวางเพื่ออัปโหลดได้';
  const emptyText = qTerm ? 'ไม่พบรายการที่ตรงกับคำค้น' : loc.l === 'bu' ? 'Folder นี้ว่าง — วางไฟล์ (Ctrl+V) หรือคลิกขวา > + Folder เพื่อสร้าง Folder ย่อย' : 'ยังไม่มีข้อมูล';

  const onDrop = (e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) queueFiles(e.dataTransfer.files); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', minHeight: 0, background: '#fff', color: '#1b1f24', fontFamily: '"Segoe UI",system-ui,-apple-system,Tahoma,sans-serif', position: 'relative', overflow: 'hidden' }} ref={rootRef}>
      <style>{'.rre-hv:hover:not(:disabled){background:#e9eef6}.rre-row:hover{background:#eef3fa}.rre-mi:hover:not(:disabled){background:#e9eef6}'}</style>
      {/* แถบบน: back/fwd/up/refresh + breadcrumb + search */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', background: '#f7f9fc', borderBottom: '1px solid #e3e8ef' }}>
        <button className="rre-hv" aria-label="กลับหน้า Document Center" title="กลับหน้า Document Center" onClick={onBack} style={{ ...navBtn(false), fontSize: 13, width: 'auto', padding: '0 10px', gap: 4 }}>⌂ Document Center</button>
        <button className="rre-hv" aria-label="ย้อนกลับ" disabled={!canBack} onClick={() => { setIdx(idx - 1); setSel(null); setQ(''); setQTerm(''); }} style={navBtn(!canBack)}>←</button>
        <button className="rre-hv" aria-label="ไปข้างหน้า" disabled={!canFwd} onClick={() => { setIdx(idx + 1); setSel(null); setQ(''); setQTerm(''); }} style={navBtn(!canFwd)}>→</button>
        <button className="rre-hv" aria-label="ขึ้นไป 1 ระดับ" disabled={!canUp} onClick={goUp} style={navBtn(!canUp)}>↑</button>
        <button className="rre-hv" aria-label="รีเฟรช" onClick={load} style={navBtn(false)}>⟳</button>
        <div style={{ flexGrow: 1, display: 'flex', alignItems: 'center', gap: 2, height: 36, border: '1px solid #d0d7e2', borderRadius: 6, background: '#fff', padding: '0 6px', boxSizing: 'border-box', minWidth: 0, overflow: 'hidden' }}>
          <span style={{ margin: '0 6px' }}><FolderSvg /></span>
          {crumbList.map((c, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
              <span style={{ color: '#7b8794', fontSize: 13 }}>{c.sep}</span>
              <button className="rre-hv" onClick={c.go} style={{ border: 0, background: 'transparent', cursor: 'pointer', fontSize: 14, color: '#1b1f24', padding: '4px 8px', borderRadius: 4 }}>{c.label}</button>
            </span>
          ))}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #d0d7e2', borderRadius: 6, padding: '0 12px', height: 36, background: '#fff', width: 300, boxSizing: 'border-box' }}>
          <input aria-label="ค้นหา" value={q} onChange={(e) => { setQ(e.target.value); setSel(null); }} placeholder="ค้นหาย้อนหลัง เช่น 2026.03 / LKS / Input VAT" style={{ border: 0, background: 'transparent', outline: 0, fontSize: 13, flexGrow: 1, minWidth: 0 }} />
          <span style={{ color: '#7b8794' }}>🔍</span>
        </label>
      </div>
      <div style={{ padding: '6px 20px', borderBottom: '1px solid #e3e8ef', fontSize: 12, color: '#7b8794' }}>คลิกขวาที่ไฟล์/Folder หรือพื้นที่ว่างเพื่อเปิดเมนู (Open, Download, + Folder, อัปโหลด, Delete)</div>

      {/* หัวตาราง */}
      <div style={{ display: 'grid', gridTemplateColumns: GRID, padding: '0 14px', height: 36, alignItems: 'center', borderBottom: '1px solid #e3e8ef', fontSize: 13, color: '#4a5563' }}>
        <span style={{ paddingLeft: 8 }}>Name</span><span>Date modified</span><span>Type</span><span style={{ textAlign: 'right', paddingRight: 8 }}>Size</span><span>SharePoint</span>
      </div>

      {/* รายการ */}
      <div onContextMenu={(e) => openMenu(e, null)} onClick={() => setSel(null)} onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}
        style={{ flexGrow: 1, overflow: 'auto', padding: '4px 6px', outline: dragOver ? '2px dashed #6b9be0' : 'none', outlineOffset: -4, background: dragOver ? '#f3f8ff' : '#fff' }}>
        {newRow && canNew && (
          <div onClick={(e) => e.stopPropagation()} style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', height: 48, padding: '0 8px', borderRadius: 6, background: '#eef3fa', outline: '1px solid #8db3e8' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <FolderSvg />
              <input autoFocus aria-label="ชื่อ Folder ใหม่" value={newName} onChange={(e) => { setNewName(e.target.value); setNewErr(''); }} onFocus={(e) => e.target.select()} onKeyDown={(e) => { if (e.key === 'Enter') confirmNew(); }} style={{ flexGrow: 1, minWidth: 0, height: 32, border: '1px solid #6b9be0', borderRadius: 4, padding: '0 8px', fontSize: 14, outline: 0, fontFamily: 'inherit', background: '#fff' }} />
            </span>
            <span style={{ gridColumn: '2 / span 4', display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>
              <span style={{ color: '#c0392b', fontSize: 12, flexGrow: 1, textAlign: 'right' }}>{newErr}</span>
              <button onClick={() => { setNewRow(false); setNewErr(''); }} style={{ height: 32, padding: '0 14px', border: '1px solid #c9d3e0', background: '#fff', borderRadius: 6, cursor: 'pointer', fontSize: 12, color: '#1a3a5c' }}>ยกเลิก</button>
              <button onClick={confirmNew} style={{ height: 32, padding: '0 14px', border: 0, background: '#1a3a5c', borderRadius: 6, cursor: 'pointer', fontSize: 12, color: '#fff' }}>สร้าง Folder</button>
            </span>
          </div>
        )}
        {loading && !items.length && <div style={{ padding: '48px 0', textAlign: 'center', fontSize: 13, color: '#7b8794' }}>กำลังโหลด…</div>}
        {error && <div style={{ padding: '48px 0', textAlign: 'center', fontSize: 13, color: '#c0392b' }}>{error}</div>}
        {!loading && !error && !items.length && !newRow && <div style={{ padding: '48px 0', textAlign: 'center', fontSize: 13, color: '#7b8794' }}>{emptyText}</div>}
        {items.map((it) => {
          const isF = it.kind !== 'file', on = it.key === sel;
          return (
            <div key={it.key} className="rre-row" onClick={(e) => { e.stopPropagation(); setSel(it.key); }} onDoubleClick={() => openItem(it)} onContextMenu={(e) => openMenu(e, it)}
              style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', cursor: 'default', fontSize: 14, height: it.search ? 48 : 40, padding: '0 8px', borderRadius: 6, background: on ? '#cfe0f7' : 'transparent', outline: on ? '1px solid #8db3e8' : 'none', userSelect: 'none' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                {isF ? <FolderSvg /> : <FileSvg />}
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
                  {it.search && <span style={{ fontSize: 11, color: '#7b8794', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.location}</span>}
                </span>
              </span>
              <span style={{ fontSize: 13, color: '#4a5563' }}>{fmtDate(it.updated_at)}</span>
              <span style={{ fontSize: 13, color: '#4a5563' }}>{isF ? 'File folder' : 'Microsoft Excel Worksheet'}</span>
              <span style={{ fontSize: 13, color: '#4a5563', textAlign: 'right', paddingRight: 8 }}>{isF ? '' : fmtSize(it.size_bytes)}</span>
              <span style={{ fontSize: 12, color: '#4a5563', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                {!isF && it.sp_url ? (
                  <>
                    <button className="rre-hv" title={'เปิดใน SharePoint (แท็บใหม่)' + (it.sp_sent_by ? ' · ส่งโดย ' + it.sp_sent_by : '') + (it.file_removed ? ' · สำเนาบน Server ถูกลบแล้ว' : '')} onClick={(e) => { e.stopPropagation(); openSp(it); }} style={{ height: 26, padding: '0 10px', border: '1px solid #8db3e8', background: '#fff', borderRadius: 6, cursor: 'pointer', fontSize: 12, color: '#1a3a5c', flexShrink: 0 }}>เปิด ↗</button>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#7b8794' }}>{fmtShort(it.sp_sent_at)}</span>
                  </>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>

      {/* แถบล่าง */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '0 16px', height: 32, borderTop: '1px solid #e3e8ef', background: '#f7f9fc', fontSize: 12, color: '#4a5563' }}>
        <span>{items.length} {qTerm ? 'results' : 'items'}</span>
        <span>{selItem ? '1 item selected' : ''}</span>
        <span style={{ flexGrow: 1 }} />
        <span style={{ color: '#7b8794' }}>{hint}</span>
      </div>

      <input ref={fileInputRef} type="file" accept=".xlsx" multiple style={{ display: 'none' }} onChange={(e) => { queueFiles(e.target.files); e.target.value = ''; }} />

      {/* เมนูคลิกขวา */}
      {menu && (
        <>
          <div onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} style={{ position: 'absolute', inset: 0, zIndex: 20 }} />
          <div style={{ position: 'absolute', left: menu.x, top: menu.y, zIndex: 21, width: 236, background: '#fff', border: '1px solid #d0d7e2', borderRadius: 10, boxShadow: '0 8px 28px rgba(0,0,0,.18)', padding: 6 }}>
            {menuItems.map((m, i) => m === null
              ? <div key={i} style={{ height: 1, background: '#e3e8ef', margin: '6px 4px' }} />
              : <button key={i} className="rre-mi" onClick={m.run} disabled={m.off} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', height: 36, padding: '0 12px', border: 0, background: 'transparent', borderRadius: 6, cursor: m.off ? 'default' : 'pointer', fontSize: 13, color: m.danger && !m.off ? '#c0392b' : '#1b1f24', opacity: m.off ? 0.4 : 1, textAlign: 'left' }}>
                <span>{m.label}</span><span style={{ fontSize: 11, color: '#8a95a5' }}>{m.hint}</span>
              </button>)}
          </div>
        </>
      )}

      {toast && <div style={{ position: 'absolute', left: '50%', bottom: 48, transform: 'translateX(-50%)', background: '#1b1f24', color: '#fff', fontSize: 13, padding: '10px 18px', borderRadius: 8, zIndex: 40 }}>{toast}</div>}

      {/* ยืนยันลบ */}
      {confirmDel && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(20,28,40,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 30 }}>
          <div style={{ width: 420, background: '#fff', borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,.25)', padding: 22 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#1a3a5c' }}>ลบ "{confirmDel.name}" ?</div>
            <div style={{ fontSize: 13, color: '#6b7788', marginTop: 8 }}>{confirmDel.kind === 'folder' ? 'ไฟล์และ Folder ย่อยทั้งหมดข้างในจะถูกลบด้วย ' : ''}ลบแล้วกู้คืนไม่ได้</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button onClick={() => setConfirmDel(null)} style={{ height: 36, padding: '0 16px', border: '1px solid #c9d3e0', background: '#fff', borderRadius: 8, cursor: 'pointer', fontSize: 13, color: '#1a3a5c' }}>ยกเลิก</button>
              <button onClick={doDelete} style={{ height: 36, padding: '0 18px', border: 0, background: '#c0392b', borderRadius: 8, cursor: 'pointer', fontSize: 13, color: '#fff' }}>ลบ</button>
            </div>
          </div>
        </div>
      )}

      {/* Dialog วางไฟล์ */}
      {queue && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(20,28,40,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 30 }}>
          <div style={{ width: 700, maxWidth: '94%', maxHeight: '90%', background: '#fff', borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,.25)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid #e3e8ef' }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#1a3a5c' }}>วางไฟล์เข้า Reconcile Results</div>
              <div style={{ fontSize: 12, color: '#6b7788', marginTop: 4 }}>ตรวจพบ {queue.rows.length} ไฟล์ — ระบบจัดเข้า Folder เดือน/BU จากชื่อไฟล์ให้อัตโนมัติ (รูปแบบ เลขBU_BU_รายงาน_Mon-YY.xlsx) ชื่อซ้ำในที่เดียวกันจะถูกแทนที่</div>
            </div>
            <div style={{ padding: '6px 22px 14px', overflow: 'auto' }}>
              {queue.rows.map((r, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)', gap: 14, alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #eef1f5' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}><FileSvg /><span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
                    {r.destLabel && <span style={{ color: '#1a3a5c', fontWeight: 600 }}>{r.destLabel}</span>}
                    {r.pick && !queue.finished && (
                      <span style={{ display: 'flex', gap: 6 }}>
                        <select aria-label="เดือน" value={r.pp} onChange={(e) => pickMonth(i, e.target.value)} style={{ height: 30, border: '1px solid #c9d3e0', borderRadius: 6, fontSize: 12, flexGrow: 1 }}>
                          <option value="">เลือกเดือน</option>{monthOpts.map((m) => <option key={m} value={m}>{fmtPeriod(m)}</option>)}
                        </select>
                        <select aria-label="BU" value={r.pb} disabled={!r.pp} onChange={(e) => pickBu(i, e.target.value)} style={{ height: 30, border: '1px solid #c9d3e0', borderRadius: 6, fontSize: 12, flexGrow: 1 }}>
                          <option value="">เลือก BU</option>{(buOpts[r.pp] || []).map((b) => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </span>
                    )}
                    <span style={{ color: r.status === 'done' ? '#1f8a4c' : r.dup === 'replace' ? '#b36b00' : r.status === 'error' || r.status === 'skip' ? '#c0392b' : r.status === 'pick' ? '#c0392b' : '#4a5563' }}>{r.note}</span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 22px', background: '#f7f9fc', borderTop: '1px solid #e3e8ef' }}>
              <button disabled={queue.running} onClick={() => setQueue(null)} style={{ height: 36, padding: '0 16px', border: '1px solid #c9d3e0', background: '#fff', borderRadius: 8, cursor: 'pointer', fontSize: 13, color: '#1a3a5c' }}>{queue.finished ? 'ปิด' : 'ยกเลิก'}</button>
              {!queue.finished && <button disabled={queue.running || !queue.rows.some((r) => r.status === 'wait')} onClick={saveQueue} style={{ height: 36, padding: '0 18px', border: 0, background: '#1a3a5c', borderRadius: 8, cursor: 'pointer', fontSize: 13, color: '#fff', opacity: queue.running || !queue.rows.some((r) => r.status === 'wait') ? 0.5 : 1 }}>{queue.running ? 'กำลังบันทึก…' : `บันทึก ${queue.rows.filter((r) => r.status === 'wait').length} ไฟล์`}</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
