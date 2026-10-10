// MARKER_SP_CLONE_EXPLORER_V3 -- v3: ลากเมาส์คลุมเลือก (marquee) + Shift/Ctrl คลิก + Ctrl+A | เมนูคลิกขวาเต็ม (โฟลเดอร์/ไฟล์/หลายรายการ/พื้นที่ว่าง) | สร้างโฟลเดอร์ใหม่ เปลี่ยนชื่อ ย้ายไปที่… ลบหลายรายการ (ต้อง Handler v6)
// MARKER_SP_CLONE_EXPLORER_V2
// Document Center > VAT Control > Z_Report Reconcile : Clone จาก SharePoint (สไตล์หน้า SharePoint) -- ไม่เก็บไฟล์จริงในระบบ
//  - รายการ: Cache ที่ SharePoint Handler (v3+ คำสั่ง list) สแกนจากโฟลเดอร์ที่ซิงก์ แล้วส่งขึ้น Backend
//  - เปิดไฟล์: Excel Online (ตั้ง SP_WEB_BASE_RECON ที่ Backend) หรือเปิดในเครื่องผ่าน Handler | ไฟล์ไม่ผ่าน Backend
//  - โยน/วาง/อัปโหลดไฟล์ลงโฟลเดอร์ -> Browser ดาวน์โหลดสำเนาลง Downloads -> Handler (put) ย้ายไปโฟลเดอร์ชื่อเดียวกันใน SharePoint (ชื่อซ้ำ = Update ทับ)
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';           // MARKER_SPC_RESOURCE_HEADER_V1
import { useUserRole } from '../contexts/useUserRole';

const API_ROOT = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
const DEST = 'recon';
const MENU = 'vat';   // MARKER_SPC_FOLDER_MANAGE_V1 -- เมนูนี้ = VAT Controller (whitelist โฟลเดอร์หลักแยกตามเมนู)
const STALE_MS = 10 * 60 * 1000;
const tok = () => sessionStorage.getItem('fastapn_token') || '';
const authHeaders = () => ({ Authorization: `Bearer ${tok()}` });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NEED_V = 6;   // เวอร์ชัน Handler ขั้นต่ำสำหรับ mkdir / rename / move / ลบหลายรายการ
const enc = encodeURIComponent;
const badName = (n) => !n || n === '.' || n === '..' || /[\\/:*?"<>|]/.test(n);

function fmtSize(n) { if (!n) return ''; if (n < 1024) return n + ' B'; if (n < 1048576) return Math.round(n / 1024) + ' KB'; return (n / 1048576).toFixed(1) + ' MB'; }
function fmtTime(t) { if (!t) return ''; try { return new Date(t).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } }
function launch(uri) { const a = document.createElement('a'); a.href = uri; a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove(); }
const extOf = (n) => (String(n).split('.').pop() || '').toLowerCase();
const isExcel = (n) => ['xlsx', 'xlsm', 'xls', 'csv'].includes(extOf(n));

// ── ไอคอนไฟล์ตามชนิด (SVG วาดเอง) ──
function FileIcon({ name, dir, size = 20 }) {
  if (dir) return (<svg width={size} height={size} viewBox="0 0 20 20"><path d="M1.5 4.5a1 1 0 0 1 1-1h5l1.8 2H17.5a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" fill="#f2c24a" /></svg>);
  const e = extOf(name);
  const m = ['xlsx', 'xlsm', 'xls', 'csv'].includes(e) ? ['#1d6f42', 'X'] : ['docx', 'doc'].includes(e) ? ['#2b579a', 'W'] : e === 'pdf' ? ['#c0392b', 'PDF'] : ['pptx', 'ppt'].includes(e) ? ['#c43e1c', 'P'] : ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(e) ? ['#0f7b8a', 'IMG'] : ['zip', 'rar', '7z'].includes(e) ? ['#8a6d00', 'ZIP'] : ['#7a7a7a', ''];
  const long = m[1].length > 1;
  return (
    <svg width={size} height={size} viewBox="0 0 20 20">
      <path d="M4 1.5h8l4 4V18a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 4 18z" fill="#fff" stroke={m[0]} strokeWidth="1.2" />
      <path d="M12 1.5v4h4" fill="none" stroke={m[0]} strokeWidth="1.2" />
      {m[1] && <><rect x="1" y="7.5" width={long ? 13 : 10} height="7.5" rx="1.2" fill={m[0]} /><text x={long ? 7.5 : 6} y="13.4" fontSize={long ? 5.6 : 7.5} fontWeight="700" fill="#fff" textAnchor="middle" fontFamily="Segoe UI,Arial">{m[1]}</text></>}
    </svg>
  );
}

export default function SpCloneExplorer({ onBack, onOpenLegacy }) {
  const { userName, currentUser, userRole } = useAuth();   // MARKER_SPC_RESOURCE_HEADER_V1
  const { isOwner } = useUserRole();
  const [syncing, setSyncing] = useState(false);
  const [syncErr, setSyncErr] = useState(false);
  const [fm, setFm] = useState(null);                       // MARKER_SPC_FOLDER_MANAGE_V1 -- { loading, all:[{name,mtime,hasData,isNew}], on:[], q, f, configured, saving, err }
  // MARKER_SPC_KEEP_PATH_V1 -- จำโฟลเดอร์ที่เปิดอยู่ (กันเด้งกลับหน้าแรกตอน Refresh/Component รีโหลด) | หมดอายุ 5 นาที
  const [parts, setParts] = useState(() => { try { const o = JSON.parse(sessionStorage.getItem('spc_parts') || 'null'); if (o && Array.isArray(o.p) && Date.now() - o.t < 300000) return o.p; } catch (_) {} return []; });
  useEffect(() => { try { sessionStorage.setItem('spc_parts', JSON.stringify({ p: parts, t: Date.now() })); } catch (_) {} }, [parts]);
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState(null);
  const [webBase, setWebBase] = useState('');
  const [loading, setLoading] = useState(true);
  const [handlerVer, setHandlerVer] = useState(null); // null=ไม่เคยรายงาน | เลขเวอร์ชันสูงสุดของเครื่องฉัน
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState([]);                // paths ที่เลือก
  const [sortKey, setSortKey] = useState('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [ctx, setCtx] = useState(null);               // { x, y, it }
  const [dlg, setDlg] = useState(null);             // { type:'mkdir'|'rename', parent, it, value }
  const [mv, setMv] = useState(null);               // { paths, loc:[], dirs:[], loading }
  const [mq, setMq] = useState(null);               // สี่เหลี่ยมลากคลุม (พิกัดหน้าจอ)
  const listRef = useRef(null);
  const mqRef = useRef(null);
  const justDragged = useRef(false);
  const lastSel = useRef(null);
  const loadRef = useRef(null);
  const fileInput = useRef(null);
  const syncedRef = useRef(false);
  const path = parts.join('/');

  const lastKeyRef = useRef(null);
  const load = useCallback(async () => {
    // MARKER_SPC_SILENT_REFRESH_V1 -- โหลดซ้ำที่เดิม (Refresh) = ทำเบื้องหลัง ไม่ขึ้น Skeleton/ไม่กระพริบ | เปลี่ยนโฟลเดอร์/ค้นหา = ขึ้น Skeleton ตามเดิม
    const key = path + '|' + q.trim();
    if (lastKeyRef.current !== key) setLoading(true);
    try {
      const url = `${API_ROOT}/api/file-storage/sp-handler/tree?dest=${DEST}&menu=${MENU}` + (q.trim() ? `&q=${encodeURIComponent(q.trim())}` : `&path=${encodeURIComponent(path)}`);
      const res = await fetch(url, { headers: authHeaders() });
      const d = await res.json();
      if (res.ok) { setItems(d.items || []); setMeta(d.meta || null); setWebBase(d.webBase || ''); setSyncErr(false); } else setSyncErr(true);
    } catch (_) { setSyncErr(true); }
    lastKeyRef.current = key;
    setLoading(false);
  }, [path, q]);

  const checkHandler = useCallback(async () => {
    try {
      const res = await fetch(`${API_ROOT}/api/file-storage/sp-handler/my-status`, { headers: authHeaders() });
      const d = await res.json();
      const v = Array.isArray(d.machines) && d.machines.length ? Math.max(...d.machines.map((m) => Number(m.version) || 0)) : null;
      setHandlerVer(v); return v;
    } catch (_) { setHandlerVer(null); return null; }
  }, []);

  const triggerList = useCallback((subPath) => {
    launch(`fastapn-sp://list?dest=${DEST}&path=${encodeURIComponent(subPath || '')}&api=${encodeURIComponent(API_ROOT)}&token=${encodeURIComponent(tok())}`);
  }, []);
  const triggerUpdate = () => {
    launch(`fastapn-sp://update?v=${NEED_V}&api=${encodeURIComponent(API_ROOT)}&token=${encodeURIComponent(tok())}`);
    setMsg('สั่ง Update Handler แล้ว (ทำเบื้องหลัง) — รอสักครู่แล้วกด ↻ รีเฟรช');
  };

  loadRef.current = load;
  useEffect(() => { setSel([]); load(); }, [load]);
  useEffect(() => {
    (async () => {
      const v = await checkHandler();
      if (!v || v < 3 || syncedRef.current) return;
      syncedRef.current = true;
      const r = await fetch(`${API_ROOT}/api/file-storage/sp-handler/tree?dest=${DEST}&path=`, { headers: authHeaders() }).then((x) => x.json()).catch(() => null);
      const at = r && r.meta && r.meta.synced_at ? new Date(r.meta.synced_at).getTime() : 0;
      if (Date.now() - at > STALE_MS) { triggerList(''); await sleep(6000); load(); }
    })();
  }, [checkHandler, triggerList, load]);

  const refresh = async () => {
    setSyncing(true);
    setMsg('กำลังสแกนโฟลเดอร์ SharePoint ที่ซิงก์ในเครื่อง… (ถ้ามีหน้าต่างถามให้เปิดโปรแกรม ให้กดอนุญาต)'); triggerList('');
    await sleep(6000); await load(); const v = await checkHandler();
    setSyncing(false); if (!v) setSyncErr(true);
    setMsg(v ? '' : 'ยังไม่ได้รับข้อมูลจาก Handler — ตรวจว่าติดตั้ง SharePoint Handler แล้ว (Setup - Tools › Download) และโฟลเดอร์ Z_Report Reconcile ซิงก์ในเครื่อง · ดู Log ที่ D:\\apps\\fastapn-sp.log');
  };

  const enter = (it) => { setQ(''); setParts(it.path.split('/')); };
  // MARKER_SPC_FOLDER_MANAGE_V1 -- Owner เท่านั้น: เลือกโฟลเดอร์หลักที่เมนูนี้ (VAT Controller) ให้เห็น (whitelist) | โฟลเดอร์ย่อยที่ไม่มีไฟล์ Backend ซ่อนให้เอง
  const fmUrl = `${API_ROOT}/api/file-storage/sp-handler/folder-whitelist`;
  const openFm = async () => {
    setFm({ loading: true, all: [], on: [], q: '', f: 'all', configured: false, saving: false, err: '' });
    try {
      const r = await fetch(`${fmUrl}?dest=${DEST}&menu=${MENU}`, { headers: authHeaders() });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
      const all = d.all || [];
      setFm((m) => (m ? { ...m, loading: false, all, configured: !!d.configured, on: d.configured ? (d.folders || []) : all.map((x) => x.name) } : m));
    } catch (e) { setFm((m) => (m ? { ...m, loading: false, err: String((e && e.message) || e) } : m)); }
  };
  const saveFm = async () => {
    if (!fm) return;
    setFm({ ...fm, saving: true, err: '' });
    try {
      const r = await fetch(fmUrl, { method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ dest: DEST, menu: MENU, folders: fm.on, known: fm.all.map((x) => x.name) }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
      const n = fm.on.length; setFm(null); setQ(''); setParts([]); setMsg(`บันทึกแล้ว — VAT Controller แสดง ${n} โฟลเดอร์หลัก`);
      setTimeout(() => { if (loadRef.current) loadRef.current(); }, 0);
    } catch (e) { setFm((m) => (m ? { ...m, saving: false, err: String((e && e.message) || e) } : m)); }
  };
  const fmToggle = (name) => setFm((m) => (m ? { ...m, on: m.on.includes(name) ? m.on.filter((x) => x !== name) : [...m.on, name] } : m));
  const fmVisible = () => {
    if (!fm) return [];
    const qq = fm.q.trim().toLowerCase();
    return fm.all.filter((x) => (!qq || x.name.toLowerCase().includes(qq)) && (fm.f === 'all' || (fm.f === 'on' && fm.on.includes(x.name)) || (fm.f === 'off' && !fm.on.includes(x.name)) || (fm.f === 'new' && x.isNew)));
  };
  const dirOf = (it) => it.path.split('/').slice(0, -1).join('/');

  const webUrl = (it) => webBase ? `${webBase}/${it.path.split('/').map(encodeURIComponent).join('/')}${isExcel(it.name) ? '?web=1' : ''}` : '';
  const openOnline = (it) => { const u = webUrl(it); if (u) window.open(u, '_blank', 'noopener'); else setMsg('ยังไม่ได้ตั้งลิงก์ SharePoint ฝั่ง Backend (SP_WEB_BASE_RECON ใน .env) — ใช้ "เปิดในเครื่อง" แทน'); };
  const openLocal = (it) => { if (!handlerVer) { setMsg('ยังไม่พบ Handler ของคุณ — ติดตั้ง/Update ที่ Setup - Tools'); return; } launch(`fastapn-sp://open?name=${encodeURIComponent(it.name)}&path=${encodeURIComponent(dirOf(it))}&dest=${DEST}`); };
  // MARKER_SP_CLONE_FILEOPS_V1 -- คำสั่งที่เปลี่ยนแปลงใน SharePoint ทั้งหมดสั่งผ่าน Handler v6 (ไฟล์ไม่ผ่าน Backend) | Handler สแกนรายการส่งกลับเองหลังทำเสร็จ
  const apiQ = () => `&api=${enc(API_ROOT)}&token=${enc(tok())}`;
  const needV6 = () => {
    if (!handlerVer) { setMsg('ยังไม่พบ SharePoint Handler ของคุณ — ติดตั้ง/Update ที่ Setup - Tools'); return true; }
    if (handlerVer < NEED_V) { setMsg(`คำสั่งนี้ต้องใช้ Handler v${NEED_V} ขึ้นไป (เครื่องคุณ v${handlerVer}) — กด ⚙ Update Handler ด้านบนก่อน`); return true; }
    return false;
  };
  const sendOp = (uri, text) => {
    if (uri.length > 1900) { setMsg('เลือกหลายรายการเกินไป (ชื่อรวมกันยาวเกินที่ลิงก์รองรับ) — แบ่งทำทีละชุด'); return; }
    launch(uri); setMsg(text); setSel([]);
    [6000, 13000].forEach((ms) => setTimeout(() => { if (loadRef.current) loadRef.current(); }, ms));
  };
  const doMkdir = (parent, name) => sendOp(`fastapn-sp://mkdir?name=${enc(name)}&path=${enc(parent)}&dest=${DEST}${apiQ()}`, `สั่งสร้างโฟลเดอร์ "${name}" แล้ว — รายการจะอัปเดตเอง`);
  const doRename = (it, nw) => sendOp(`fastapn-sp://rename?name=${enc(it.name)}&newname=${enc(nw)}&path=${enc(dirOf(it))}&dest=${DEST}${apiQ()}`, `สั่งเปลี่ยนชื่อ "${it.name}" → "${nw}" แล้ว — รายการจะอัปเดตเอง`);
  const doMove = (paths, to) => sendOp(`fastapn-sp://move?items=${enc(paths.join('|'))}&to=${enc(to)}&dest=${DEST}${apiQ()}`, `สั่งย้าย ${paths.length} รายการแล้ว — ยืนยันในหน้าต่างของ Handler`);
  const doDelete = (paths) => sendOp(`fastapn-sp://delete?items=${enc(paths.join('|'))}&dest=${DEST}${apiQ()}`, `สั่งลบ ${paths.length} รายการแล้ว — ยืนยันในหน้าต่างของ Handler (โฟลเดอร์ลบได้เฉพาะที่ว่าง)`);
  const askMkdir = (parent) => { if (needV6()) return; setDlg({ type: 'mkdir', parent, value: '' }); };
  const askRename = (it) => { if (needV6()) return; setDlg({ type: 'rename', it, value: it.name }); };
  const askDelete = (arr) => { if (!arr.length || needV6()) return; doDelete(arr.map((x) => x.path)); };
  const openMove = (arr) => { if (!arr.length || needV6()) return; setMv({ paths: arr.map((x) => x.path), loc: parts.slice(), dirs: [], loading: true }); };
  const openFolderLocal = (it) => { if (needV6()) return; launch(`fastapn-sp://open?name=${enc(it.name)}&path=${enc(dirOf(it))}&dest=${DEST}`); };
  const submitDlg = () => {
    if (!dlg) return;
    const v = String(dlg.value || '').trim();
    if (badName(v)) { setMsg('ชื่อไม่ถูกต้อง (ห้ามว่าง และห้ามมีอักขระ \\ / : * ? " < > |)'); return; }
    const d = dlg; setDlg(null);
    if (d.type === 'mkdir') doMkdir(d.parent, v); else if (v !== d.it.name) doRename(d.it, v);
  };
  const copyLink = async (it) => { const u = webUrl(it); if (!u) { setMsg('ยังไม่ได้ตั้งลิงก์ SharePoint ฝั่ง Backend (SP_WEB_BASE_RECON)'); return; } try { await navigator.clipboard.writeText(u); setMsg('คัดลอกลิงก์แล้ว'); } catch (_) { window.prompt('คัดลอกลิงก์', u); } };

  // ── โยน/วาง/อัปโหลดไฟล์ -> put ──
  const putFiles = useCallback(async (files) => {
    if (!files.length) return;
    if (!parts.length) { setMsg('เปิดโฟลเดอร์ปลายทางก่อน แล้วค่อยโยนไฟล์'); return; }
    if (!handlerVer || handlerVer < 3) { setMsg('ยังไม่พบ SharePoint Handler v3+ ของคุณ — ติดตั้ง/Update ที่ Setup - Tools ก่อนจึงจะส่งไป SharePoint ได้'); return; }
    setBusy(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        setMsg(`กำลังส่ง ${i + 1}/${files.length}: ${f.name} → ${path}`);
        const url = URL.createObjectURL(f);
        const a = document.createElement('a'); a.href = url; a.download = f.name; a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        await sleep(1500);
        launch(`fastapn-sp://put?name=${encodeURIComponent(f.name)}&path=${encodeURIComponent(path)}&dest=${DEST}&api=${encodeURIComponent(API_ROOT)}&token=${encodeURIComponent(tok())}`);
        await sleep(4000);
      }
      triggerList(path); await sleep(6000); await load();
      setMsg(`ส่ง ${files.length} ไฟล์ไป ${path} แล้ว — รอ OneDrive ซิงก์ขึ้น SharePoint`);
    } finally { setBusy(false); }
  }, [parts, path, handlerVer, triggerList, load]);

  useEffect(() => {
    const onPaste = (e) => {
      const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
      if (files.length) { e.preventDefault(); putFiles(files); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [putFiles]);

  // Esc: ปิดเมนูคลิกขวา > ล้างการเลือก > ขึ้นหนึ่งชั้น > ออก
  useEffect(() => {
    const fn = (e) => {
      if (e.key !== 'Escape') return;
      const t = e.target; const tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.stopImmediatePropagation(); e.preventDefault();
      if (syncing || busy) return; // MARKER_SPC_KEEP_PATH_V1 -- ระหว่าง Refresh/ส่งไฟล์ Esc (ปิดหน้าต่างถามเปิดโปรแกรม) ต้องไม่พาถอยโฟลเดอร์
      if (fm) { setFm(null); return; }
      if (dlg) { setDlg(null); return; }
      if (mv) { setMv(null); return; }
      if (ctx) { setCtx(null); return; }
      if (sel.length) { setSel([]); return; }
      if (parts.length) setParts((p) => p.slice(0, -1)); else onBack && onBack();
    };
    window.addEventListener('keydown', fn, true);
    return () => window.removeEventListener('keydown', fn, true);
  }, [fm, dlg, mv, ctx, sel, parts, onBack, syncing, busy]);
  useEffect(() => {
    if (!mv) return undefined;
    let stop = false;
    (async () => {
      try {
        const r = await fetch(`${API_ROOT}/api/file-storage/sp-handler/tree?dest=${DEST}&path=${enc(mv.loc.join('/'))}`, { headers: authHeaders() });
        const d = await r.json();
        if (!stop) setMv((m) => (m ? { ...m, dirs: (d.items || []).filter((x) => x.dir && !m.paths.includes(x.path)), loading: false } : m));
      } catch (_) { if (!stop) setMv((m) => (m ? { ...m, dirs: [], loading: false } : m)); }
    })();
    return () => { stop = true; };
  }, [mv && mv.loc.join('/')]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!ctx) return undefined; const c = () => setCtx(null); window.addEventListener('click', c); return () => window.removeEventListener('click', c); }, [ctx]);

  const sorted = useMemo(() => {
    const a = [...items];
    a.sort((x, y) => {
      if (x.dir !== y.dir) return x.dir ? -1 : 1;
      let r = 0;
      if (sortKey === 'mtime') r = new Date(x.mtime || 0) - new Date(y.mtime || 0);
      else if (sortKey === 'size') r = (x.size || 0) - (y.size || 0);
      else r = x.name.localeCompare(y.name, 'th', { numeric: true, sensitivity: 'base' });
      return sortAsc ? r : -r;
    });
    return a;
  }, [items, sortKey, sortAsc]);
  const setSort = (k) => { if (sortKey === k) setSortAsc(!sortAsc); else { setSortKey(k); setSortAsc(true); } };
  const arrow = (k) => (sortKey === k ? (sortAsc ? ' ▲' : ' ▼') : '');
  const toggleSel = (it) => setSel((s) => (s.includes(it.path) ? s.filter((x) => x !== it.path) : [...s, it.path]));
  const selItems = sorted.filter((i) => sel.includes(i.path));
  const one = selItems.length === 1 ? selItems[0] : null;
  const oneFile = one && !one.dir ? one : null;
  const searching = !!q.trim();
  const crumbs = parts.map((p, i) => ({ label: p, to: parts.slice(0, i + 1) }));
  const cmdB = (label, onClick, enabled, color) => (<div onClick={enabled ? onClick : undefined} style={{ padding: '7px 11px', borderRadius: 4, fontSize: 14.5, color: enabled ? (color || '#323130') : '#a19f9d', cursor: enabled ? 'pointer' : 'default', whiteSpace: 'nowrap', userSelect: 'none' }} onMouseEnter={(e) => { if (enabled) e.currentTarget.style.background = '#f3f2f1'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>{label}</div>);
  const GRID = '16px minmax(220px,1fr) 180px 100px';  // MARKER_SPC_NO_CHECKBOX_V1 -- ตัดคอลัมน์ Checkbox ออก (เลือกด้วยคลิก/Shift/Ctrl/ลากเมาส์) + ขยายขนาด ~12%
  // ── เลือกหลายรายการ: ลากคลุม (marquee) / Shift+คลิกเป็นช่วง / Ctrl+A ──
  const onListMouseDown = (e) => {
    if (e.button !== 0 || (e.target.closest && e.target.closest('[data-nodrag]'))) return;
    mqRef.current = { x: e.clientX, y: e.clientY, base: (e.ctrlKey || e.metaKey) ? sel : [], active: false };
    const move = (ev) => {
      const m = mqRef.current; if (!m) return;
      if (!m.active && Math.abs(ev.clientX - m.x) + Math.abs(ev.clientY - m.y) < 5) return;
      m.active = true;
      const el = listRef.current;
      if (el) { const cr = el.getBoundingClientRect(); if (ev.clientY > cr.bottom - 24) el.scrollTop += 16; else if (ev.clientY < cr.top + 24) el.scrollTop -= 16; }
      const r = { l: Math.min(m.x, ev.clientX), t: Math.min(m.y, ev.clientY), r: Math.max(m.x, ev.clientX), b: Math.max(m.y, ev.clientY) };
      setMq(r);
      const hit = [];
      if (el) el.querySelectorAll('[data-spath]').forEach((row) => { const b = row.getBoundingClientRect(); if (b.bottom >= r.t && b.top <= r.b && b.right >= r.l && b.left <= r.r) hit.push(row.getAttribute('data-spath')); });
      setSel(Array.from(new Set([...m.base, ...hit])));
    };
    const up = () => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
      if (mqRef.current && mqRef.current.active) { justDragged.current = true; setTimeout(() => { justDragged.current = false; }, 0); }
      mqRef.current = null; setMq(null);
    };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
  const clickRow = (e, it, on) => {
    if (justDragged.current) return;
    if (e.ctrlKey || e.metaKey) { toggleSel(it); lastSel.current = it.path; return; }
    if (e.shiftKey && lastSel.current) {
      const a = sorted.findIndex((x) => x.path === lastSel.current); const z = sorted.findIndex((x) => x.path === it.path);
      if (a >= 0 && z >= 0) { const lo = Math.min(a, z); const hi = Math.max(a, z); setSel(sorted.slice(lo, hi + 1).map((x) => x.path)); return; }
    }
    lastSel.current = it.path;
    setSel(on && sel.length === 1 ? [] : [it.path]);
  };
  useEffect(() => {
    const fn = (e) => {
      if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a')) return;
      const t = e.target; const tag = t && t.tagName; if (tag === 'INPUT' || tag === 'TEXTAREA' || dlg || mv) return;
      e.preventDefault(); setSel(sorted.map((x) => x.path));
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [sorted, dlg, mv]);
  const ctxItems = () => {
    if (!ctx) return [];
    if (ctx.kind === 'bg') return [['➕ โฟลเดอร์ใหม่', () => askMkdir(path), !searching], ['⬆ อัปโหลดไฟล์', () => fileInput.current && fileInput.current.click(), !!parts.length && !busy], 'sep', ['↻ รีเฟรช', refresh, true]];
    const tg = sel.includes(ctx.it.path) ? selItems : [ctx.it];
    if (tg.length > 1) return [[`➡ ย้าย ${tg.length} รายการไปที่…`, () => openMove(tg), true], 'sep', [`🗑 ลบ ${tg.length} รายการ`, () => askDelete(tg), true, '#a4262c']];
    const it = tg[0];
    if (it.dir) return [['📁 เปิดโฟลเดอร์', () => enter(it), true], ['🖥 เปิดใน File Explorer', () => openFolderLocal(it), true], 'sep', ['➕ โฟลเดอร์ใหม่ข้างใน', () => askMkdir(it.path), true], ['✏ เปลี่ยนชื่อ', () => askRename(it), true], ['➡ ย้ายไปที่…', () => openMove([it]), true], 'sep', ['🗑 ลบ (โฟลเดอร์ว่างเท่านั้น)', () => askDelete([it]), true, '#a4262c']];
    return [['↗ เปิดใน Excel Online', () => openOnline(it), true], ['🖥 เปิดในเครื่อง', () => openLocal(it), true], ['🔗 คัดลอกลิงก์ SharePoint', () => copyLink(it), true], 'sep', ['✏ เปลี่ยนชื่อ', () => askRename(it), true], ['➡ ย้ายไปที่…', () => openMove([it]), true], 'sep', ['🗑 ลบ', () => askDelete([it]), true, '#a4262c']];
  };

  // MARKER_SPC_RESOURCE_HEADER_V1 -- หัวแบบหน้า Home + Step bar + Tools | pill Sync: เขียว=Synced · เหลือง=กำลัง Sync · แดง=ไม่สำเร็จ/ไม่เคย Sync
  const syncCls = syncing ? 'y' : (syncErr || !meta ? 'r' : 'g');
  const syncPal = { g: ['#e3f6ec', '#14935a', '#22c55e'], y: ['#fff6dc', '#8a5a00', '#f5b400'], r: ['#fdecec', '#b42318', '#e5484d'] }[syncCls];
  const syncTxt = syncCls === 'y' ? 'กำลัง Sync' : syncCls === 'r' ? (syncErr ? 'Sync ไม่สำเร็จ' : 'ยังไม่เคย Sync') : 'Synced';
  const syncDet = syncCls === 'g' ? `· ${fmtTime(meta.synced_at)}${meta.synced_by ? ' โดย ' + meta.synced_by : ''}` : syncCls === 'r' && handlerVer === null ? '· ไม่พบ SharePoint Handler' : syncCls === 'y' ? '· กำลังสแกนโฟลเดอร์' : '';
  const steps = [{ label: 'Z_Report Reconcile', to: [] }, ...parts.map((pp, i) => ({ label: pp, to: parts.slice(0, i + 1) }))];
  if (searching) steps.push({ label: `ค้นหา "${q.trim()}"`, search: true });
  const todayTh = (() => { try { return new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); } catch (_) { return ''; } })();
  const capSt = { fontSize: 10, letterSpacing: '.14em', color: '#6b778c', fontWeight: 700 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', overflow: 'hidden', background: '#fff', fontFamily: '"Segoe UI", Tahoma, sans-serif', color: '#323130' }}
      onDragOver={(e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false); }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); putFiles(Array.from(e.dataTransfer.files || [])); }}>
      {/* MARKER_SPC_RESOURCE_HEADER_V1 -- หัว */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px 12px', background: '#fff' }}>
        <div style={{ borderLeft: '4px solid #2fb58a', paddingLeft: 12 }}>
          <div style={{ fontSize: 10.5, letterSpacing: '.14em', color: '#2fb58a', fontWeight: 700, textTransform: 'uppercase' }}>Resource Center</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#14284b', lineHeight: 1.2, marginTop: 2 }}>SharePoint - <span style={{ color: '#2fb58a' }}>VatController</span></div>
          <div style={{ fontSize: 12, color: '#6b778c', marginTop: 2 }}>Z_Report Reconcile · โครงสร้างเดียวกับ SharePoint · ไม่เก็บไฟล์จริงในระบบ</div>
          <div title={syncCls === 'r' ? 'กด ↻ รีเฟรช เพื่อสั่งสแกนใหม่' : ''} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 11, borderRadius: 99, padding: '3px 10px', background: syncPal[0], color: syncPal[1] }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: syncPal[2], boxShadow: `0 0 0 3px ${syncPal[2]}33`, opacity: syncCls === 'y' ? 0.6 : 1 }} />
            <span style={{ fontWeight: 600 }}>{syncTxt}</span><span style={{ color: '#6b778c' }}>{syncDet}</span>
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 12.5, color: '#4b5a73' }}>
          <div>{todayTh}</div>
          <div style={{ marginTop: 4 }}><span style={{ color: '#6b778c', marginRight: 4 }}>{userName || (currentUser && currentUser.email) || ''}</span>{userRole && <span style={{ fontSize: 11, background: '#e3f6ec', color: '#14935a', borderRadius: 99, padding: '2px 10px', fontWeight: 700 }}>{userRole}</span>}</div>
        </div>
      </div>
      {/* Step bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 24px 12px', background: '#fff', borderBottom: '1px solid #edebe9' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: 1 }}>
          {/* MARKER_SPC_BACK_VATCONTROL_V1 -- ปุ่มย้อนกลับ VAT Control อยู่หน้าสุดของ Step bar */}
          <span onClick={() => onBack && onBack()} title="กลับไปหน้า VAT Control"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid #0f6cbd', background: '#fff', color: '#0f6cbd', fontWeight: 600, borderRadius: 99, padding: '5px 14px', fontSize: 13, cursor: 'pointer' }}>← ⌂ VAT Control</span>
          <span style={{ color: '#b3bccb' }}>›</span>
          {steps.map((st, i) => {
            const cur = i === steps.length - 1;
            return (
              <React.Fragment key={i + '|' + st.label}>
                {i > 0 && <span style={{ color: '#b3bccb' }}>›</span>}
                <span onClick={() => { if (cur) return; setQ(''); setParts(st.to || []); }} title={cur ? '' : 'ย้อนกลับมาชั้นนี้'}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid ' + (cur ? '#14284b' : '#e5e9f0'), background: cur ? '#14284b' : '#fff', color: cur ? '#fff' : '#1b3358', fontWeight: cur ? 600 : 400, borderRadius: 99, padding: '5px 14px 5px 6px', fontSize: 13, cursor: cur ? 'default' : 'pointer' }}>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', background: cur ? '#2fb58a' : '#eef2f8', color: cur ? '#fff' : '#1b3358', fontSize: 11, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>{st.label}
                </span>
              </React.Fragment>
            );
          })}
        </div>
      </div>
      {/* แถบคำสั่ง */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '6px 12px', borderBottom: '1px solid #edebe9', flexWrap: 'wrap' }}>
        <span style={{ ...capSt, marginRight: 6 }}>TOOLS</span>
        {cmdB('⬆ อัปโหลดไฟล์', () => fileInput.current && fileInput.current.click(), !!parts.length && !busy, '#0f6cbd')}
        {cmdB('↗ เปิดใน Excel Online', () => oneFile && openOnline(oneFile), !!oneFile)}
        {cmdB('🖥 เปิดในเครื่อง', () => oneFile && openLocal(oneFile), !!oneFile)}
        <div style={{ width: 1, height: 20, background: '#e1dfdd', margin: '0 6px' }} />
        {cmdB('➕ โฟลเดอร์ใหม่', () => askMkdir(path), !searching)}
        {cmdB('✏ เปลี่ยนชื่อ', () => one && askRename(one), !!one)}
        {cmdB('➡ ย้ายไปที่', () => openMove(selItems), selItems.length > 0)}
        {cmdB(selItems.length > 1 ? `🗑 ลบ (${selItems.length})` : '🗑 ลบ', () => askDelete(selItems), selItems.length > 0, '#a4262c')}
        <div style={{ width: 1, height: 20, background: '#e1dfdd', margin: '0 6px' }} />
        {cmdB('↻ รีเฟรช', refresh, true)}
        {handlerVer && handlerVer < NEED_V && cmdB('⚙ Update Handler', triggerUpdate, true, '#8a4a00')}
        <div style={{ flex: 1 }} />
        {isOwner && (
          <button onClick={openFm} title="เลือกโฟลเดอร์หลักที่ VAT Controller จะเห็น (เฉพาะ Owner)" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid #1b3358', background: '#fff', color: '#1b3358', borderRadius: 8, padding: '5px 12px', fontWeight: 600, fontSize: 12, cursor: 'pointer', marginRight: 8 }}>
            ⚙ Folder Manage <span style={{ fontSize: 9.5, background: '#e3f6ec', color: '#14935a', borderRadius: 99, padding: '1px 7px', fontWeight: 700 }}>OWNER</span>
          </button>
        )}
        {onOpenLegacy && <div onClick={onOpenLegacy} style={{ fontSize: 11, color: '#8a8886', cursor: 'pointer', padding: '4px 8px' }}>ดูของเดิม (Backend)</div>}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 ค้นหาใน Z_Report Reconcile (ทุกชั้น)" style={{ fontSize: 13.5, padding: '7px 11px', border: '1px solid #d2d0ce', borderRadius: 4, width: 290 }} />
        <input ref={fileInput} type="file" multiple style={{ display: 'none' }} onChange={(e) => { const fs = Array.from(e.target.files || []); e.target.value = ''; putFiles(fs); }} />
      </div>
      {!handlerVer && (
        <div style={{ background: '#FFF6E8', borderTop: '1px solid #f3c98b', borderBottom: '1px solid #f3c98b', color: '#8a4a00', fontSize: 12, padding: '6px 16px' }}>
          ⚠️ ยังไม่พบข้อมูลว่าเครื่องคุณมี SharePoint Handler — ติดตั้ง/Update ที่ Setup - Tools แล้วกด ↻ รีเฟรช หนึ่งครั้ง (Handler จะรายงานตัวเอง) จึงจะดูไฟล์, เปิด, ลบ และโยนไฟล์ได้
        </div>
      )}
      {msg && <div style={{ background: '#EFF6FC', borderBottom: '1px solid #c7e0f4', color: '#0f548c', fontSize: 12, padding: '6px 16px', display: 'flex', justifyContent: 'space-between' }}><span>{msg}</span><span style={{ cursor: 'pointer' }} onClick={() => setMsg('')}>✕</span></div>}
      {/* หัวตาราง */}
      <div style={{ display: 'grid', gridTemplateColumns: GRID, fontSize: 13.5, color: '#605e5c', borderBottom: '1px solid #edebe9', marginTop: 4 }}>
        <div />
        <div style={hdc} onClick={() => setSort('name')}>ชื่อ{arrow('name')}</div>
        <div style={hdc} onClick={() => setSort('mtime')}>แก้ไขล่าสุด{arrow('mtime')}</div>
        <div style={hdc} onClick={() => setSort('size')}>ขนาด{arrow('size')}</div>
      </div>
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', position: 'relative', userSelect: 'none' }}
        onMouseDown={onListMouseDown}
        onClick={(e) => { if (e.target === e.currentTarget && !justDragged.current) setSel([]); }}
        onContextMenu={(e) => { if (e.target.closest && e.target.closest('[data-spath]')) return; e.preventDefault(); setSel([]); setCtx({ x: e.clientX, y: e.clientY, kind: 'bg' }); }}>
        {loading ? (
          <div>
            {[62, 48, 70, 55, 40, 66, 52, 58].map((w, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f3f2f1' }}>
                <div />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="spc-sk" style={{ width: 23, height: 18, borderRadius: 4 }} /><span className="spc-sk" style={{ width: w + '%', maxWidth: 360, height: 12 }} /></div>
                <div><span className="spc-sk" style={{ width: 110, height: 12 }} /></div>
                <div><span className="spc-sk" style={{ width: 44, height: 12 }} /></div>
              </div>
            ))}
          </div>
        )
          : sorted.length === 0 ? <div style={{ padding: 40, fontSize: 13, color: '#8a8886', textAlign: 'center' }}>{meta ? 'โฟลเดอร์นี้ว่าง' : 'ยังไม่มีข้อมูลจาก SharePoint — กด ↻ รีเฟรช (ต้องมี Handler และโฟลเดอร์ SharePoint ซิงก์ในเครื่อง)'}</div>
            : sorted.map((it) => {
              const on = sel.includes(it.path);
              return (
                <div key={it.path} className="spc-row" data-spath={it.path}
                  onClick={(e) => clickRow(e, it, on)}
                  onDoubleClick={() => { if (it.dir) enter(it); else if (webBase) openOnline(it); else openLocal(it); }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (!sel.includes(it.path)) setSel([it.path]); setCtx({ x: e.clientX, y: e.clientY, it, kind: 'item' }); }}
                  style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f3f2f1', background: on ? '#eff6fc' : undefined, cursor: 'pointer', fontSize: 15 }}
                  onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = '#f5f5f5'; }} onMouseLeave={(e) => { e.currentTarget.style.background = on ? '#eff6fc' : ''; }}>
                  <div />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                    <FileIcon name={it.name} dir={it.dir} size={23} />
                    <span onClick={(e) => { e.stopPropagation(); if (it.dir) enter(it); else setSel([it.path]); }} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} className="spc-name">{searching ? it.path : it.name}</span>
                  </div>
                  <div style={{ color: '#605e5c' }}>{fmtTime(it.mtime)}</div>
                  <div style={{ color: '#605e5c' }}>{it.dir ? '' : fmtSize(it.size)}</div>
                </div>
              );
            })}
        {drag && (
          <div style={{ position: 'absolute', inset: 6, border: '2px dashed #0f6cbd', background: 'rgba(239,246,252,0.9)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#0f6cbd', pointerEvents: 'none' }}>
            {parts.length ? `ปล่อยไฟล์เพื่อส่งไป SharePoint › ${path}` : 'เปิดโฟลเดอร์ปลายทางก่อน'}
          </div>
        )}
      </div>
      <div style={{ padding: '6px 16px', borderTop: '1px solid #edebe9', fontSize: 12.5, color: '#605e5c', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span>{sel.length ? `เลือก ${sel.length} รายการ · ` : ''}ทั้งหมด {sorted.length} รายการ{busy ? ' · กำลังส่ง…' : ''}</span>
        <span>ดับเบิลคลิก = เปิด · คลิกขวา = เมนู · ลากเมาส์คลุม/Shift/Ctrl = เลือกหลายรายการ · ลาก/วาง (Ctrl+V) ไฟล์ลงโฟลเดอร์เพื่อส่งไป SharePoint (ชื่อซ้ำ = Update ทับ) · Esc = ย้อนกลับ</span>
      </div>
      {/* เมนูคลิกขวา */}
      {ctx && (
        <div style={{ position: 'fixed', left: Math.min(ctx.x, window.innerWidth - 250), top: Math.min(ctx.y, window.innerHeight - 330), zIndex: 10040, background: '#fff', border: '1px solid #e1dfdd', borderRadius: 6, boxShadow: '0 6px 18px rgba(0,0,0,0.18)', padding: '4px 0', width: 235, fontSize: 13 }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          {ctxItems().map((m, k) => (m === 'sep'
            ? <div key={'s' + k} style={{ height: 1, background: '#edebe9', margin: '4px 0' }} />
            : <div key={m[0]} onClick={() => { if (!m[2]) return; setCtx(null); m[1](); }} style={{ padding: '7px 14px', cursor: m[2] ? 'pointer' : 'default', color: m[2] ? (m[3] || '#323130') : '#a19f9d' }} onMouseEnter={(e) => { if (m[2]) e.currentTarget.style.background = '#f3f2f1'; }} onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}>{m[0]}</div>))}
        </div>
      )}
      {/* สี่เหลี่ยมลากคลุม */}
      {mq && <div style={{ position: 'fixed', left: mq.l, top: mq.t, width: mq.r - mq.l, height: mq.b - mq.t, border: '1px solid #0f6cbd', background: 'rgba(15,108,189,0.15)', zIndex: 10035, pointerEvents: 'none' }} />}
      {/* หน้าต่างสร้างโฟลเดอร์ / เปลี่ยนชื่อ */}
      {dlg && (
        <div onMouseDown={() => setDlg(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 10050, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onMouseDown={(e) => e.stopPropagation()} style={{ width: 380, background: '#fff', borderRadius: 8, boxShadow: '0 10px 32px rgba(0,0,0,0.25)', padding: '16px 18px' }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{dlg.type === 'mkdir' ? 'โฟลเดอร์ใหม่' : 'เปลี่ยนชื่อ'}</div>
            <div style={{ fontSize: 11, color: '#605e5c', marginBottom: 10 }}>{dlg.type === 'mkdir' ? `สร้างใน: Z_Report Reconcile${dlg.parent ? ' › ' + dlg.parent.split('/').join(' › ') : ''}` : `ชื่อเดิม: ${dlg.it.name}`}</div>
            <input autoFocus value={dlg.value} onChange={(e) => setDlg({ ...dlg, value: e.target.value })}
              onFocus={(e) => { if (dlg.type === 'rename') { const n = dlg.it.name; const dot = dlg.it.dir ? -1 : n.lastIndexOf('.'); e.target.setSelectionRange(0, dot > 0 ? dot : n.length); } }}
              onKeyDown={(e) => { if (e.key === 'Enter') submitDlg(); else if (e.key === 'Escape') { e.stopPropagation(); setDlg(null); } }}
              placeholder={dlg.type === 'mkdir' ? 'ชื่อโฟลเดอร์' : 'ชื่อใหม่'} style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '7px 10px', border: '1px solid #0f6cbd', borderRadius: 4, outline: 'none' }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button onClick={() => setDlg(null)} style={{ fontSize: 12, padding: '6px 14px', border: '1px solid #d2d0ce', borderRadius: 4, background: '#fff', cursor: 'pointer' }}>ยกเลิก</button>
              <button onClick={submitDlg} style={{ fontSize: 12, padding: '6px 14px', border: 'none', borderRadius: 4, background: '#0f6cbd', color: '#fff', cursor: 'pointer' }}>{dlg.type === 'mkdir' ? 'สร้าง' : 'เปลี่ยนชื่อ'}</button>
            </div>
          </div>
        </div>
      )}
      {/* หน้าต่างเลือกโฟลเดอร์ปลายทาง (ย้าย) */}
      {mv && (
        <div onMouseDown={() => setMv(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 10050, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onMouseDown={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: '92vw', background: '#fff', borderRadius: 8, boxShadow: '0 10px 32px rgba(0,0,0,0.25)', padding: '16px 18px' }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>ย้าย {mv.paths.length} รายการไปที่…</div>
            <div style={{ fontSize: 12, color: '#605e5c', marginBottom: 8, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ color: '#0f6cbd', cursor: 'pointer' }} onClick={() => setMv({ ...mv, loc: [], loading: true })}>Z_Report Reconcile</span>
              {mv.loc.map((c, i) => (<React.Fragment key={i}><span>›</span><span style={{ color: '#0f6cbd', cursor: 'pointer' }} onClick={() => setMv({ ...mv, loc: mv.loc.slice(0, i + 1), loading: true })}>{c}</span></React.Fragment>))}
            </div>
            <div style={{ border: '1px solid #edebe9', borderRadius: 4, height: 260, overflowY: 'auto' }}>
              {mv.loading ? <div style={{ padding: 14, fontSize: 12, color: '#8a8886' }}>กำลังโหลด…</div>
                : mv.dirs.length === 0 ? <div style={{ padding: 14, fontSize: 12, color: '#8a8886' }}>ไม่มีโฟลเดอร์ย่อยในระดับนี้</div>
                  : mv.dirs.map((d) => (<div key={d.path} onClick={() => setMv({ ...mv, loc: d.path.split('/'), loading: true })} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid #f6f6f6' }} onMouseEnter={(e) => { e.currentTarget.style.background = '#f3f2f1'; }} onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}><FileIcon dir size={18} />{d.name}</div>))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
              <span style={{ fontSize: 11, color: '#605e5c' }}>ปลายทาง: {mv.loc.length ? mv.loc.join(' › ') : '(โฟลเดอร์หลัก)'}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setMv(null)} style={{ fontSize: 12, padding: '6px 14px', border: '1px solid #d2d0ce', borderRadius: 4, background: '#fff', cursor: 'pointer' }}>ยกเลิก</button>
                <button onClick={() => { const m = mv; setMv(null); doMove(m.paths, m.loc.join('/')); }} style={{ fontSize: 12, padding: '6px 14px', border: 'none', borderRadius: 4, background: '#0f6cbd', color: '#fff', cursor: 'pointer' }}>ย้ายมาที่นี่</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* MARKER_SPC_FOLDER_MANAGE_V1 -- หน้าต่าง Folder Manage (Owner) */}
      {fm && (() => {
        const vis = fmVisible(); const onN = fm.on.length;
        const pill = (k, t) => (<button key={k} onClick={() => setFm({ ...fm, f: k })} style={{ border: '1px solid ' + (fm.f === k ? '#14284b' : '#e5e9f0'), background: fm.f === k ? '#14284b' : '#fff', color: fm.f === k ? '#fff' : '#4b5a73', fontWeight: fm.f === k ? 600 : 400, borderRadius: 99, padding: '4px 13px', fontSize: 12, cursor: 'pointer' }}>{t}</button>);
        return (
          <div onMouseDown={() => !fm.saving && setFm(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(11,22,48,0.55)', zIndex: 10060, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div onMouseDown={(e) => e.stopPropagation()} style={{ width: 720, maxWidth: '100%', maxHeight: '92vh', background: '#fff', borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid #e5e9f0', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ borderLeft: '4px solid #2fb58a', paddingLeft: 12, flex: 1 }}>
                  <div style={{ fontSize: 10.5, letterSpacing: '.14em', color: '#2fb58a', fontWeight: 700, textTransform: 'uppercase' }}>VAT Controller · Resource Center</div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: '#14284b' }}>Folder Manage</div>
                  <div style={{ fontSize: 12, color: '#6b778c', marginTop: 3 }}>เลือกโฟลเดอร์หลักที่ต้องการให้แสดงในเมนูนี้ · โฟลเดอร์ย่อย (แบรนด์/เดือน) ที่ไม่มีไฟล์จะซ่อนอัตโนมัติ</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, background: '#f6f8fb', borderRadius: 99, padding: '3px 10px', color: '#4b5a73' }}>ใช้ร่วมกันทุกคน</span>
                    <span style={{ fontSize: 11, background: '#f6f8fb', borderRadius: 99, padding: '3px 10px', color: '#4b5a73' }}>แก้ไขได้เฉพาะ Owner</span>
                    {!fm.configured && !fm.loading && <span style={{ fontSize: 11, background: '#fff6dc', borderRadius: 99, padding: '3px 10px', color: '#8a5a00' }}>ยังไม่เคยตั้งค่า — ตอนนี้แสดงทุกโฟลเดอร์</span>}
                  </div>
                </div>
                <button onClick={() => setFm(null)} style={{ border: 0, background: 'none', fontSize: 20, color: '#6b778c', cursor: 'pointer' }}>✕</button>
              </div>
              <div style={{ padding: '12px 20px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid #e5e9f0' }}>
                <input value={fm.q} onChange={(e) => setFm({ ...fm, q: e.target.value })} placeholder="ค้นหาชื่อโฟลเดอร์..." style={{ flex: 1, minWidth: 160, border: '1px solid #e5e9f0', borderRadius: 8, padding: '8px 10px', fontSize: 13 }} />
                <div style={{ display: 'flex', gap: 6 }}>{pill('all', 'ทั้งหมด')}{pill('on', 'แสดง')}{pill('off', 'ซ่อน')}{pill('new', 'ใหม่')}</div>
                <button onClick={() => setFm({ ...fm, on: Array.from(new Set([...fm.on, ...vis.map((x) => x.name)])) })} style={{ border: 0, background: 'none', color: '#1b3358', fontSize: 12, cursor: 'pointer' }}>เลือกที่เห็นทั้งหมด</button>
                <button onClick={() => { const v = new Set(vis.map((x) => x.name)); setFm({ ...fm, on: fm.on.filter((x) => !v.has(x)) }); }} style={{ border: 0, background: 'none', color: '#1b3358', fontSize: 12, cursor: 'pointer' }}>ล้าง</button>
              </div>
              <div style={{ overflowY: 'auto', flex: 1, minHeight: 200 }}>
                {fm.loading ? [60, 45, 70, 52, 64, 40].map((w, i) => (<div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 20px', borderBottom: '1px solid #f0f2f6' }}><span className="spc-sk" style={{ width: 36, height: 20, borderRadius: 99 }} /><span className="spc-sk" style={{ width: w + '%', height: 12 }} /></div>))
                  : fm.err ? <div style={{ padding: 24, color: '#b42318', fontSize: 13 }}>โหลดรายการไม่สำเร็จ: {fm.err}</div>
                    : vis.length === 0 ? <div style={{ padding: 30, textAlign: 'center', color: '#6b778c', fontSize: 13 }}>ไม่พบโฟลเดอร์</div>
                      : vis.map((x) => {
                        const on = fm.on.includes(x.name);
                        return (
                          <div key={x.name} onClick={() => fmToggle(x.name)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 20px', borderBottom: '1px solid #f0f2f6', cursor: 'pointer' }} onMouseEnter={(e) => { e.currentTarget.style.background = '#fafbfd'; }} onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}>
                            <span style={{ width: 36, height: 20, borderRadius: 99, background: on ? '#14935a' : '#cfd6e2', position: 'relative', flexShrink: 0, transition: '.15s' }}><span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.3)', transition: '.15s' }} /></span>
                            <FileIcon dir size={18} />
                            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 }}>{x.name}{x.isNew && <span style={{ marginLeft: 6, fontSize: 10, background: '#fef3c7', color: '#b45309', borderRadius: 4, padding: '1px 6px', fontWeight: 700 }}>ใหม่</span>}{!x.hasData && <span style={{ marginLeft: 6, fontSize: 10, background: '#eef0f4', color: '#8a94a6', borderRadius: 4, padding: '1px 6px' }}>ว่าง</span>}</span>
                            <span style={{ fontSize: 11.5, color: '#6b778c', width: 110, textAlign: 'right' }}>{fmtTime(x.mtime)}</span>
                            <span style={{ fontSize: 11, borderRadius: 99, padding: '2px 8px', fontWeight: 700, width: 56, textAlign: 'center', background: on ? '#e3f6ec' : '#eef0f4', color: on ? '#14935a' : '#9aa5b5' }}>{on ? 'แสดง' : 'ซ่อน'}</span>
                          </div>
                        );
                      })}
              </div>
              <div style={{ padding: '12px 20px', borderTop: '1px solid #e5e9f0', display: 'flex', alignItems: 'center', gap: 10, background: '#fbfcfe' }}>
                <div style={{ fontSize: 12, color: '#6b778c', flex: 1 }}>{fm.err && !fm.loading && fm.all.length ? <span style={{ color: '#b42318' }}>บันทึกไม่สำเร็จ: {fm.err}</span> : `แสดง ${onN} จาก ${fm.all.length} โฟลเดอร์หลัก`}</div>
                <button onClick={() => setFm(null)} disabled={fm.saving} style={{ border: '1px solid #e5e9f0', background: '#fff', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>ยกเลิก</button>
                <button onClick={saveFm} disabled={fm.saving || fm.loading || !!(fm.err && !fm.all.length)} style={{ border: '1px solid #14284b', background: '#14284b', color: '#fff', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: fm.saving ? 0.6 : 1 }}>{fm.saving ? 'กำลังบันทึก…' : 'บันทึก'}</button>
              </div>
            </div>
          </div>
        );
      })()}
      <style>{'.spc-row:hover .spc-name{color:#0f6cbd;text-decoration:underline}@keyframes spcShimmer{0%{background-position:-300px 0}100%{background-position:300px 0}}.spc-sk{display:inline-block;border-radius:6px;background:linear-gradient(90deg,#eceff1 25%,#f6f8f9 37%,#eceff1 63%);background-size:600px 100%;animation:spcShimmer 1.3s infinite linear}@media (prefers-reduced-motion: reduce){.spc-sk{animation:none}}'}</style>
    </div>
  );
}
const hdc = { padding: '7px 6px', cursor: 'pointer', userSelect: 'none' };
