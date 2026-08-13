// MARKER_HOMEPAGE_ZONE_A_V1
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../lib/db';
// MARKER_HOMEPAGE_NOTIFICATION_CHAT_V1
import BatchChatDrawer from './BatchChatDrawer';

const ROLE_STYLE = {
  Owner:  { background: '#d4f0e7', color: '#0F6E56' },
  Admin:  { background: '#FCEBEB', color: '#791F1F' },
  Editor: { background: '#EAF3DE', color: '#27500A' },
  Viewer: { background: '#f0f0f0', color: '#888'    },
};

function getTodayThai() {
  const d = new Date();
  const days   = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
  const months = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                  'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  return `วัน${days[d.getDay()]}ที่ ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`;
}

const MENU_LABELS = {
  'ap-gr': 'AP Controller',
  'vat-controller': 'VAT Controller',
  'i-expense': 'I-Expense',
  'gl-functional': 'GL Functional',
  'i-pro-interface': 'I-Pro Interface',
  'document-center': 'Document Center',
  'ap-ocr': 'AP OCR',
  'upload': 'Upload',
  'users': 'จัดการ Users',
  'vendor-apcode': 'Vendor AP Code',
  'home': 'หน้าหลัก',
};

const NOTIF_ICON = {
  receiver: { icon: '📤', color: '#0C447C' },
  sender_wait: { icon: '⏳', color: '#854F0B' },
  sender_resend: { icon: '🔄', color: '#854F0B' },
  sender_rejected: { icon: '❌', color: '#791F1F' },
};

// MARKER_HOMEPAGE_NOTIF_REDESIGN_V1
// ── สถานะจริงของ Batch (จาก batch_list.status) เอาไว้โชว์ Badge ใน Notification ──
// MARKER_ADD_APPROVED_STATUS_STYLE_V1
const BATCH_STATUS_STYLE = {
  reviewing: { label: 'รอตรวจ', bg: '#FAEEDA', color: '#854F0B', icon: '📥' },
  processing: { label: 'รอตรวจ', bg: '#FAEEDA', color: '#854F0B', icon: '📥' },
  done: { label: 'อนุมัติ', bg: '#EAF3DE', color: '#27500A', icon: '✅' },
  approved: { label: 'อนุมัติ', bg: '#EAF3DE', color: '#27500A', icon: '✅' },
  rejected: { label: 'ถูกตีกลับ', bg: '#FCEBEB', color: '#791F1F', icon: '❌' },
};

// MARKER_HOMEPAGE_NOTIF_FILTER_PILLS_V1
// ── Filter Pills ตามโมดูลต้นทาง: batch_notifications = AP โดยนัยเสมอ ──────────
// ── notifications (support-feedback) ใช้ n.menu_source แปลงเป็น Code ย่อ ──────
const NOTIF_MODULE_MAP = {
  'AP Controller': 'AP',
  'VAT Controller': 'VAT',
  'I-Expense': 'IE',
  'GL Functional': 'GL',
  'I-Pro Interface': 'IPRO',
};
const NOTIF_MODULE_META = {
  AP:   { label: 'AP',    color: '#0C447C', bg: '#E6F1FB' },
  VAT:  { label: 'VAT',   color: '#27500A', bg: '#EAF3DE' },
  IE:   { label: 'IE',    color: '#633806', bg: '#FAEEDA' },
  IPRO: { label: 'I-Pro', color: '#712B13', bg: '#FAECE7' },
  GL:   { label: 'GL',    color: '#3C3489', bg: '#EEEDFE' },
  SUP:  { label: 'Support', color: '#8a4a00', bg: '#FDF0E0' }, // MARKER_HOMEPAGE_RENAME_FEEDBACK_MODULE_V1 -- Label จริงคำนวณตอน Render (Owner=Support / ผู้แจ้ง=Feedback)
};
// MARKER_HOMEPAGE_SUPPORT_SEVERITY_BADGE_V1
// ── สีเดียวกับ SEVERITY_LEVELS ใน UploadGen.js (ฟอร์มตั้งกระทู้ใหม่) ──
const SEVERITY_META = {
  incident:  { label: 'Incident',  color: '#791F1F', bg: '#FCEBEB' },
  important: { label: 'Important', color: '#8a4a00', bg: '#FDF0E0' },
  issue:     { label: 'Issue',     color: '#856404', bg: '#FAEEDA' },
  request:   { label: 'Request',   color: '#27500A', bg: '#EAF3DE' },
};
const NOTIF_FILTER_PILLS = ['All', 'AP', 'VAT', 'IE', 'IPRO', 'GL', 'SUP'];
function notifModule(n) {
  // MARKER_HOMEPAGE_RENAME_FEEDBACK_MODULE_V1
  // ── Support & Feedback ทุกรายการรวมเป็น Tag เดียว ไม่แยกตาม menu_source อีกต่อไป ──
  if (n.category === 'support-feedback') return 'SUP';
  return 'AP'; // batch_notifications ทั้งหมด = AP โดยนัย
}

function notifKind(n) {
  if (n.audience === 'receiver') return 'receiver';
  if (n.status === 'resend') return 'sender_resend';
  if (n.status === 'rejected') return 'sender_rejected';
  return 'sender_wait';
}

function formatAgo(ts) {
  if (!ts) return '';
  const diffMin = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (diffMin < 1) return 'เมื่อครู่';
  if (diffMin < 60) return `${diffMin} นาทีที่แล้ว`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} ชม.ที่แล้ว`;
  return `${Math.floor(diffHr / 24)} วันก่อน`;
}

// ── Central Queue ──────────────────────────────────────────────────────────
const API_QUEUE = 'http://10.101.87.126:4000/api/docenter';
const QUEUE_STATUS_CONFIG = {
  ocring:         { label: 'กำลัง OCR',    color: '#1a3a5c', bg: '#E3F0FF', icon: '⚙️' },
  processing:     { label: 'กำลังทำงาน',  color: '#1a3a5c', bg: '#E3F0FF', icon: '⚙️' },
  pending:        { label: 'รอคิว',        color: '#856404', bg: '#FFF9E6', icon: '⏳' },
  waiting_ap:     { label: 'รอ AP OCR',    color: '#6A1B9A', bg: '#F3E5F5', icon: '⏸️' },
  done:           { label: 'เสร็จแล้ว',   color: '#1B5E20', bg: '#E8F5E9', icon: '✅' },
  error:          { label: 'ผิดพลาด',     color: '#B71C1C', bg: '#FFEBEE', icon: '❌' },
  failed:         { label: 'ผิดพลาด',     color: '#B71C1C', bg: '#FFEBEE', icon: '❌' },
  local_grouping: { label: 'จัดกลุ่ม',    color: '#0D47A1', bg: '#E3F2FD', icon: '🔄' },
};
const QUEUE_SOURCE_CONFIG = {
  ap_ocr:   { label: 'AP OCR',          color: '#BF360C', bg: '#FFF3E0' },
  docenter: { label: 'Document Center', color: '#0D47A1', bg: '#E3F2FD' },
};
function queueFmtTime(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}
function queueFmtFile(name = '') {
  const base = name.split(/[\\/]/).pop();
  return base.length > 28 ? base.slice(0, 26) + '…' : base;
}

function Homepage({ onOpenInbox } = {}) {
  const { userName, userRole, currentUser } = useAuth();
  const today = useMemo(() => getTodayThai(), []);
  const displayName = userName || currentUser?.email || '-';
  const roleStyle = ROLE_STYLE[userRole] || ROLE_STYLE.Viewer;
  const isOwner = userRole === 'Owner';
  const isAdmin = userRole === 'Admin';

  // ── Central Queue state ──────────────────────────────────────────────────
  const [queueItems, setQueueItems] = useState([]);
  const [queueModal, setQueueModal] = useState(false);
  const QUEUE_PREVIEW = 5;

  React.useEffect(() => {
    const role = isOwner ? 'owner' : isAdmin ? 'admin' : 'user';
    const token = sessionStorage.getItem('fastapn_token');
    const fetchAll = async () => {
      try {
        const r = await fetch(`${API_QUEUE}/central-queue?role=${role}&limit=100`, {
          headers: { Authorization: `Bearer ${token}`, 'x-username': currentUser?.email || '' },
        });
        const d = await r.json();
        setQueueItems(Array.isArray(d) ? d : []);
      } catch (_) {}
    };
    fetchAll();

    // SSE: ส่ง token ใน query string เพราะ EventSource ไม่รองรับ custom header
    const es = new EventSource(`${API_QUEUE}/queue/stream?token=${encodeURIComponent(token || '')}`);
    es.addEventListener('queue_update', () => { fetchAll(); });
    es.addEventListener('queue_done',   () => { fetchAll(); });
    es.addEventListener('queue_error',  () => { fetchAll(); });
    es.onerror = () => { es.close(); };
    return () => { es.close(); };
  }, [isOwner, isAdmin, currentUser?.email]);

  const [queueModalFilter, setQueueModalFilter] = useState('active');
  const [queueModalSource, setQueueModalSource] = useState('all');
  const [qSide,   setQSide]   = useState('dashboard');
  const [qStatus, setQStatus] = useState('active');

  const handleQueueBoost = async (item) => {
    if (!isOwner || item.source !== 'docenter') return;
    try {
      const token = sessionStorage.getItem('fastapn_token');
      await fetch(`${API_QUEUE}/queue/${item.source_id}/priority`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction: 'up' }),
      });
      setQueueItems(prev => [...prev]); // trigger refetch รอบถัดไป
    } catch (_) {}
  };

  // ── Zone A Data: Notification + ทีม ────────────────────────────────────
  const me = userName || currentUser?.email || '';
  const [notifications, setNotifications] = useState([]);
  // MARKER_HOMEPAGE_NOTIF_FILTER_PILLS_V1
  const [notifFilter, setNotifFilter] = useState('All');
  // MARKER_HOMEPAGE_NOTIF_MEASURE_ROWS_V1
  // ── วัดความสูงแถวจริงแทนเดาตัวเลข ให้เห็น 5 แถวเป๊ะไม่ว่า Font จริงจะสูงแค่ไหน ──
  const notifListRef = useRef(null);
  const [notifMaxHeight, setNotifMaxHeight] = useState(274);
  const filteredNotif = useMemo(
    () => (notifFilter === 'All' ? notifications : notifications.filter(n => notifModule(n) === notifFilter)),
    [notifications, notifFilter]
  );
  useEffect(() => {
    const el = notifListRef.current;
    if (!el) return;
    const rows = el.querySelectorAll(':scope > div');
    if (rows.length === 0) return; // ── มีรายการน้อยกว่า 5 หรือไม่มีเลย -> ใช้ notifMaxHeight เดิม (คงที่จาก Filter ก่อนหน้า) ──
    const rowH = rows[0].getBoundingClientRect().height;
    const gap = 6; // ต้องตรงกับ gap ที่ตั้งไว้ใน style ของ notifListRef
    const rowsToShow = 5; // MARKER_HOMEPAGE_NOTIF_FIXED_HEIGHT_V1 -- Default 5 แถวเสมอ ไม่ลดตามจำนวนจริงของ Filter นี้
    setNotifMaxHeight(Math.ceil(rowH * rowsToShow + gap * (rowsToShow - 1)));
  }, [filteredNotif]);
  // MARKER_HOMEPAGE_SUPPORT_NOTIFICATION_POPUP_V1
  // MARKER_HOMEPAGE_SUPPORT_POPUP_MINICHAT_V1
  const [supportPopup, setSupportPopup] = useState(null); // { notifId, thread }
  const [supportPopupLoading, setSupportPopupLoading] = useState(false);
  const [supportPopupComments, setSupportPopupComments] = useState([]);
  const [supportPopupReplyText, setSupportPopupReplyText] = useState('');
  const [supportPopupSending, setSupportPopupSending] = useState(false);
  const [supportPopupFinishing, setSupportPopupFinishing] = useState(false);

  // MARKER_HOMEPAGE_REVERT_TASK_QUEUE_V1
  const supportApiBase = () => (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
  const supportFmtTime = (ts) => {
    if (!ts) return '—';
    const d = new Date(ts);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };

  const openSupportPopup = async (n) => {
    setSupportPopupLoading(true);
    setSupportPopupComments([]);
    setSupportPopupReplyText('');
    try {
      const apiBase = supportApiBase();
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${apiBase}/api/support/threads/${n.link_to}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.ok) {
        setSupportPopup({ notifId: n.id, thread: data.thread });
        setSupportPopupComments(data.comments || []);
      }
    } catch (err) { console.error('load support thread error:', err); }
    setSupportPopupLoading(false);
    // MARKER_HOMEPAGE_NO_AUTO_DISMISS_V1
    // ── ไม่ลบ Notification ตอนคลิกดูอีกต่อไป (เฉพาะ Home) — Card จะอยู่ต่อจนกว่า ──
    // ── Backend จะลบเองตอน Resolve/Reject จริง (มี Logic นี้อยู่แล้ว) ─────────────
  };

  const handleSupportPopupSend = async () => {
    if (!supportPopup || !supportPopupReplyText.trim()) return;
    setSupportPopupSending(true);
    try {
      const apiBase = supportApiBase();
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${apiBase}/api/support/threads/${supportPopup.thread.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: supportPopupReplyText.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setSupportPopupComments(prev => [...prev, data.comment]);
        setSupportPopupReplyText('');
      } else {
        alert('ส่งข้อความไม่สำเร็จ: ' + (data.error || ''));
      }
    } catch (err) { alert('ส่งข้อความไม่สำเร็จ: ' + err.message); }
    setSupportPopupSending(false);
  };

  const handleSupportPopupResolve = async () => {
    if (!supportPopup) return;
    if (!window.confirm('ยืนยันปิดกระทู้นี้เป็น Resolve?')) return;
    setSupportPopupFinishing(true);
    try {
      const apiBase = supportApiBase();
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${apiBase}/api/support/threads/${supportPopup.thread.id}/finish`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.ok) {
        setSupportPopup(prev => prev ? { ...prev, thread: { ...prev.thread, status: 'resolved' } } : prev);
      } else {
        alert('ปิดกระทู้ไม่สำเร็จ: ' + (data.error || ''));
      }
    } catch (err) { alert('ปิดกระทู้ไม่สำเร็จ: ' + err.message); }
    setSupportPopupFinishing(false);
  };

  // MARKER_HOMEPAGE_SUPPORT_REJECT_V1
  const [supportPopupRejecting, setSupportPopupRejecting] = useState(false);
  const handleSupportPopupReject = async () => {
    if (!supportPopup) return;
    if (!window.confirm('ยืนยัน Reject กระทู้นี้?')) return;
    setSupportPopupRejecting(true);
    try {
      const apiBase = supportApiBase();
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${apiBase}/api/support/threads/${supportPopup.thread.id}/reject`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.ok) {
        setSupportPopup(prev => prev ? { ...prev, thread: { ...prev.thread, status: 'resolved', resolution_type: 'rejected' } } : prev);
      } else {
        alert('Reject กระทู้ไม่สำเร็จ: ' + (data.error || ''));
      }
    } catch (err) { alert('Reject กระทู้ไม่สำเร็จ: ' + err.message); }
    setSupportPopupRejecting(false);
  };
  const [loadingNotif, setLoadingNotif] = useState(true);
  const [batchMeta, setBatchMeta] = useState({}); // batch_id -> { bu, status } จาก batch_list
  const [chatBatchId, setChatBatchId] = useState(null); // Notification "ถูกตีกลับ" -> เปิด Chat ทันที
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [offlineUsers, setOfflineUsers] = useState([]);
  const [loadingTeam, setLoadingTeam] = useState(true);

  useEffect(() => {
    if (!me) return;
    const loadNotif = async () => {
      try {
        const { data } = await db.from('batch_notifications').select('*').eq('recipient_username', me).order('created_at', { ascending: false }).limit(50);
        const list = data || [];

        // MARKER_HOMEPAGE_SUPPORT_NOTIFICATIONS_V1
        // ── ผสม Notification ของ Support & Feedback (ตาราง notifications) เข้าการ์ดเดียวกัน ──
        let supportList = [];
        try {
          const { data: mineData } = await db.from('notifications').select('*').eq('category', 'support-feedback').eq('recipient_username', me).order('created_at', { ascending: false }).limit(50);
          supportList = mineData || [];
          if (isOwner) {
            const { data: ownerData } = await db.from('notifications').select('*').eq('category', 'support-feedback').eq('target_role', 'Owner').order('created_at', { ascending: false }).limit(50);
            supportList = [...supportList, ...(ownerData || [])];
          }
          // ── ดึง severity/log_number จาก support_threads มาผูกกับ Notification (คนละตารางกัน) ──
          const threadIds = [...new Set(supportList.map(n => n.link_to).filter(Boolean))];
          if (threadIds.length > 0) {
            const { data: threadMeta, error: threadMetaErr } = await db.from('support_threads').select('id, severity, log_number, status').in('id', threadIds);
            // MARKER_HOMEPAGE_CARD_STATUS_BADGE_DEBUG_V1 -- เปิด Console (F12) ดูว่า threadMeta ว่างเปล่าไหม (RLS อาจปิดกั้น)
            console.log('[support threadMeta]', { threadIds, threadMeta, threadMetaErr });
            const metaMap = {};
            (threadMeta || []).forEach(t => { metaMap[t.id] = t; });
            supportList = supportList.map(n => ({ ...n, severity: metaMap[n.link_to]?.severity, log_number: metaMap[n.link_to]?.log_number, threadStatus: metaMap[n.link_to]?.status }));
          }
        } catch (supportErr) { console.error('[load support notifications]', supportErr); }

        const combined = [...list, ...supportList].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        setNotifications(combined);

        // ── Join batch_list เอา bu/status จริงมาโชว์ Badge (ไม่ใช้ Status ที่ Freeze ไว้ตอน Insert) ──
        const batchIds = [...new Set(list.map(n => n.batch_id).filter(Boolean))];
        if (batchIds.length > 0) {
          const { data: batches } = await db.from('batch_list').select('batch_id, bu, status').in('batch_id', batchIds);
          const map = {};
          (batches || []).forEach(b => { map[b.batch_id] = b; });
          setBatchMeta(map);
        } else {
          setBatchMeta({});
        }
      } catch (e) { console.error('[load notifications]', e); }
      setLoadingNotif(false);
    };
    loadNotif();
    const iv = setInterval(loadNotif, 30000);
    return () => clearInterval(iv);
  }, [me, isOwner]);

  useEffect(() => {
    const loadTeam = async () => {
      try {
        const [{ data: roles }, { data: sessions }] = await Promise.all([
          db.from('user_roles').select('*'),
          db.from('menu_active_sessions').select('*'),
        ]);
        const cutoff = Date.now() - 5 * 60 * 1000; // Online = Activity ใน 5 นาทีล่าสุด
        const sessByUser = {};
        (sessions || []).forEach(s => { sessByUser[s.user_name] = s; });
        const online = [];
        const offline = [];
        (roles || []).forEach(r => {
          const sess = sessByUser[r.username];
          const lastSeen = sess?.last_seen ? new Date(sess.last_seen).getTime() : 0;
          const entry = { username: r.username, role: r.role, menu_id: sess?.menu_id, lastSeen: sess?.last_seen };
          if (lastSeen >= cutoff) online.push(entry); else offline.push(entry);
        });
        setOnlineUsers(online);
        setOfflineUsers(offline);
      } catch (e) { console.error('[load team]', e); }
      setLoadingTeam(false);
    };
    loadTeam();
    const iv = setInterval(loadTeam, 30000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: '#f5f5f5',
      fontFamily: 'sans-serif',
      overflowY: 'auto',
    }}>

      {/* ── Header ── */}
      <div style={{
        background: 'white',
        borderBottom: '1px solid #e8eaf0',
        padding: '24px 32px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '12px',
        flexShrink: 0,
      }}>

        {/* Left: ชื่อระบบ */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {/* accent bar */}
          <div style={{ width: '4px', height: '42px', background: '#5DCAA5', borderRadius: '4px', flexShrink: 0 }} />
          <div>
            <p style={{
              fontSize: '11px', fontWeight: '600', color: '#5DCAA5',
              margin: '0 0 3px', letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>
              AP Controller
            </p>
            <h1 style={{
              fontSize: '22px', fontWeight: '700', color: '#1a3a5c',
              margin: '0 0 2px', lineHeight: 1.2,
            }}>
              FAST<span style={{ color: '#5DCAA5' }}>APN</span> Link3ase
            </h1>
            <p style={{ fontSize: '12px', color: '#aaa', margin: 0 }}>
              Accounts Payable Invoice Management
            </p>
          </div>
        </div>

        {/* Right: วันที่ + user */}
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: '13px', color: '#555', margin: '0 0 6px', fontWeight: '500' }}>
            {today}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: '#888' }}>{displayName}</span>
            {userRole && (
              <span style={{
                fontSize: '11px', fontWeight: '600',
                padding: '3px 10px', borderRadius: '99px',
                ...roleStyle,
              }}>
                {userRole}
              </span>
            )}
          </div>
        </div>

      </div>

      {/* ── Zone A: Notification (A1+A2) / ว่างไว้ก่อน (A3) / ทีม (A4) ── */}
      <div style={{ padding: '20px 32px', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px' }}>

        {/* ── A1+A2: Notification ── */}
        <div style={{ background: 'white', borderRadius: '12px', padding: '14px 16px', boxSizing: 'border-box' }}>
          {/* MARKER_HOMEPAGE_NOTIF_FILTER_PILLS_V1 -- ซ่อน Scrollbar เฉพาะกล่องนี้ */}
          <style>{`.homepage-notif-scroll::-webkit-scrollbar{display:none;width:0;height:0}`}</style>
          {(() => {
            return (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <p style={{ fontSize: '13px', fontWeight: '500', margin: 0, color: '#1a3a5c' }}>🔔 Notification</p>
                  {filteredNotif.length > 0 && (
                    <span style={{ background: '#E6F1FB', color: '#0C447C', fontSize: '10px', padding: '2px 7px', borderRadius: '20px' }}>{filteredNotif.length} รายการ</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
                  {NOTIF_FILTER_PILLS.map(p => {
                    const isActive = notifFilter === p;
                    const label = p === 'All' ? 'All' : p === 'SUP' ? (isOwner ? 'Support' : 'Feedback') : NOTIF_MODULE_META[p].label;
                    return (
                      <button key={p} onClick={() => setNotifFilter(p)}
                        style={{
                          fontSize: '11px', padding: '4px 11px', borderRadius: '20px',
                          border: isActive ? '0.5px solid #1a3a5c' : '0.5px solid #ddd',
                          background: isActive ? '#1a3a5c' : '#fff',
                          color: isActive ? '#fff' : '#666',
                          cursor: 'pointer', fontWeight: '500',
                        }}>
                        {label}
                      </button>
                    );
                  })}
                </div>
                {/* MARKER_HOMEPAGE_NOTIF_FIXED_HEIGHT_V1 */}
                <div style={{ minHeight: notifMaxHeight + 'px' }}>
                {loadingNotif ? (
                  <p style={{ fontSize: '11px', color: '#aaa', margin: 0 }}>กำลังโหลด...</p>
                ) : filteredNotif.length === 0 ? (
                  <p style={{ fontSize: '11px', color: '#aaa', margin: 0 }}>{notifications.length === 0 ? 'ไม่มีการแจ้งเตือน' : 'ไม่มีการแจ้งเตือนในหมวดนี้'}</p>
                ) : (
                  <div ref={notifListRef} className="homepage-notif-scroll" style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: notifMaxHeight + 'px', overflowY: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                    {filteredNotif.map(n => {
                      const mod = notifModule(n);
                      const modMeta = NOTIF_MODULE_META[mod];
                      if (n.category === 'support-feedback') {
                        const isResolvedNotif = n.action_type === 'resolved';
                        return (
                          <div key={n.id} onClick={()=>openSupportPopup(n)}
                            style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 10px', border: '0.5px solid #eee', borderRadius: '10px', cursor: 'pointer', background: '#fafbfc', flexShrink: 0 }}>
                            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: isResolvedNotif ? '#EAF3DE' : '#FAEEDA', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', flexShrink: 0 }}>{isResolvedNotif ? '✅' : '💬'}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              {/* MARKER_HOMEPAGE_CARD_SWITCH_BADGE_PREVIEW_V1 */}
                              <p style={{ fontSize: '12px', fontWeight: '500', color: '#1a3a5c', margin: '0 0 1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.title || '-'}</p>
                              {n.threadStatus === 'resolved' ? (
                                <p style={{ fontSize: '11px', color: '#777', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.message || '-'}</p>
                              ) : (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  {n.log_number && <span style={{ fontSize: '9px', color: '#999', fontFamily: 'monospace', flexShrink: 0 }}>{n.log_number}</span>}
                                  {n.severity && SEVERITY_META[n.severity] && (
                                    <span style={{ fontSize: '9px', padding: '1px 6px', borderRadius: '4px', fontWeight: '500', flexShrink: 0, background: SEVERITY_META[n.severity].bg, color: SEVERITY_META[n.severity].color }}>{SEVERITY_META[n.severity].label}</span>
                                  )}
                                  {n.threadStatus && (
                                    <span style={{
                                      fontSize: '9px', padding: '1px 6px', borderRadius: '4px', fontWeight: '500', flexShrink: 0,
                                      background: n.threadStatus === 'new' ? '#FCEBEB' : '#FAEEDA',
                                      color: n.threadStatus === 'new' ? '#791F1F' : '#633806',
                                    }}>
                                      {n.threadStatus === 'new' ? 'ใหม่' : 'กำลังดำเนินการ'}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                            <span style={{ fontSize: '9px', color: '#bbb', flexShrink: 0 }}>{formatAgo(n.created_at)}</span>
                          </div>
                        );
                      }
                      const bMeta = batchMeta[n.batch_id];
                      const statusKey = bMeta?.status || 'reviewing';
                      const st = BATCH_STATUS_STYLE[statusKey] || BATCH_STATUS_STYLE.reviewing;
                      // MARKER_FIX_HOMEPAGE_COMMENT_SYNTAX_V1
                      return (
                        <div key={n.id} onClick={() => {
                          // ── MARKER_HOMEPAGE_NOTIFICATION_CHAT_V1: Rejected -> เปิด Chat ทันที ──
                          // MARKER_HOMEPAGE_REJECT_GOTO_INBOX_V1
                          // ── พาไปที่ Tab Inbox/My Jobs ด้วย (ไม่ return ออกก่อนแล้ว) ──────────
                          if (statusKey === 'rejected') {
                            setChatBatchId(n.batch_id);
                            onOpenInbox && onOpenInbox(n.audience === 'sender' ? 'mine' : 'inbox');
                            return;
                          }
                          onOpenInbox && onOpenInbox(n.audience === 'sender' ? 'mine' : 'inbox');
                        }}
                          style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 10px', border: '0.5px solid #eee', borderRadius: '10px', cursor: onOpenInbox ? 'pointer' : 'default', background: '#fafbfc', flexShrink: 0 }}>
                          <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: st.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', flexShrink: 0 }}>{st.icon}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '1px' }}>
                              <span style={{ fontSize: '12px', fontWeight: '500', color: '#1a3a5c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.batch_id || '-'}</span>
                              {bMeta?.bu && <span style={{ fontSize: '10px', color: '#aaa', flexShrink: 0 }}>{bMeta.bu}</span>}
                              <span style={{ fontSize: '9px', padding: '1px 6px', borderRadius: '4px', fontWeight: '500', flexShrink: 0, background: modMeta.bg, color: modMeta.color }}>{modMeta.label}</span>
                            </div>
                            <p style={{ fontSize: '11px', color: '#777', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.title || '-'}</p>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px', flexShrink: 0 }}>
                            <span style={{ fontSize: '10px', padding: '1px 8px', borderRadius: '99px', fontWeight: '500', background: st.bg, color: st.color }}>{st.label}</span>
                            <span style={{ fontSize: '9px', color: '#bbb' }}>{formatAgo(n.created_at)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                </div>
              </>
            );
          })()}
        </div>

        {/* ── A3: OCR Queue Monitor ── */}
        {(() => {
          const activeQ = queueItems.filter(it => ['pending','ocring','processing','waiting_ap'].includes(it.status));
          const previewQ = activeQ.length > 0 ? activeQ.slice(0, QUEUE_PREVIEW) : queueItems.slice(0, QUEUE_PREVIEW);
          const apBusy  = queueItems.some(it => it.source === 'ap_ocr' && ['pending','processing'].includes(it.status));
          return (
            <div style={{ background: 'white', borderRadius: '12px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Header */}
              <div style={{ padding: '10px 14px', borderBottom: '0.5px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '13px', fontWeight: '500', color: '#1a3a5c' }}>🖥️ OCR Queue</span>
                  {activeQ.length > 0 && <span style={{ background: '#E24B4A', color: 'white', borderRadius: '10px', padding: '1px 6px', fontSize: '10px', fontWeight: '700' }}>{activeQ.length}</span>}
                  {apBusy && <span style={{ background: '#FFF3E0', color: '#BF360C', borderRadius: '4px', padding: '1px 5px', fontSize: '9px', fontWeight: '600' }}>AP ทำงานอยู่</span>}
                </div>
                <button onClick={() => setQueueModal(true)} style={{ fontSize: '11px', color: '#1a3a5c', background: 'none', border: '0.5px solid #c8d8ec', borderRadius: '5px', padding: '3px 8px', cursor: 'pointer' }}>ดูทั้งหมด →</button>
              </div>
              {/* Preview rows */}
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {previewQ.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#ccc', fontSize: '12px' }}>
                    <div style={{ fontSize: '22px' }}>✅</div>
                    <div style={{ marginTop: '4px' }}>ไม่มีงานในคิว</div>
                  </div>
                ) : previewQ.map((item, i) => {
                  const st  = QUEUE_STATUS_CONFIG[item.status] || { label: item.status, color: '#555', bg: '#f5f5f5', icon: '?' };
                  const src = QUEUE_SOURCE_CONFIG[item.source] || { label: item.source, color: '#555', bg: '#f5f5f5' };
                  const pos = item.queue_position || (i + 1);
                  return (
                    <div key={`${item.source}-${item.source_id}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', borderBottom: '0.5px solid #f5f5f5', background: item.status==='ocring'||item.status==='processing'?'#f8fbff':'white' }}>
                      {/* position badge */}
                      <div style={{ display:'flex',flexDirection:'column',alignItems:'center',flexShrink:0,minWidth:'22px' }}>
                        <span style={{ fontSize:'8px',color:'#ccc',fontWeight:'700' }}>#{pos}</span>
                        <span style={{ fontSize:'12px' }}>{st.icon}</span>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '11px', fontWeight: '500', color: '#1a3a5c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.file_name}>{queueFmtFile(item.file_name)}</div>
                        <div style={{ display: 'flex', gap: '4px', marginTop: '2px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '9px', fontWeight: '600', padding: '1px 4px', borderRadius: '3px', background: src.bg, color: src.color }}>{src.label}</span>
                          <span style={{ fontSize: '9px', padding: '1px 4px', borderRadius: '3px', background: st.bg, color: st.color, fontWeight: '500' }}>{st.label}</span>
                          <span style={{ fontSize: '9px', color: '#aaa' }}>{queueFmtTime(item.created_at)}</span>
                        </div>
                      </div>
                      {isOwner && ['pending','waiting_ap'].includes(item.status) && item.source === 'docenter' && (
                        <button onClick={() => handleQueueBoost(item)} title="ลัดคิว" style={{ width: '20px', height: '20px', borderRadius: '4px', border: '0.5px solid #1a3a5c', background: '#f0f6ff', color: '#1a3a5c', fontSize: '10px', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>↑</button>
                      )}
                    </div>
                  );
                })}
                {queueItems.length > QUEUE_PREVIEW && (
                  <div style={{ padding: '5px 12px', textAlign: 'center', fontSize: '10px', color: '#888', borderTop: '0.5px solid #f5f5f5', cursor: 'pointer', background: '#fafafa' }} onClick={() => setQueueModal(true)}>
                    และอีก {queueItems.length - QUEUE_PREVIEW} รายการ
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ── Queue Modal (popup) ── */}
        {queueModal && (() => {
          const MENU_ITEMS = [
            { key:'ap_controller', label:'AP Controller' },
            { key:'docenter',      label:'Document Center' },
            { key:'vat_controller',label:'VAT Controller' },
            { key:'i_expense',     label:'I-Expense' },
            { key:'gl_functional', label:'GL Functional' },
            { key:'i_pro',         label:'I-Pro Interface' },
          ];
          const getMenuCount = (key) => {
            if (key === 'docenter') return queueItems.filter(q => ['pending','ocring','processing','waiting_ap'].includes(q.status)).length;
            return 0;
          };
          const activeCount = queueItems.filter(q => ['pending','ocring','processing','waiting_ap'].includes(q.status)).length;
          const displayed = queueItems.filter(it => {
            const matchSt = qStatus === 'all' ? true
              : qStatus === 'active' ? ['pending','ocring','processing','waiting_ap'].includes(it.status)
              : qStatus === 'done'   ? it.status === 'done'
              : qStatus === 'error'  ? ['error','failed'].includes(it.status)
              : true;
            return matchSt;
          });
          const getStatusTag = (s) => ({ ocring:{label:'กำลัง OCR',bg:'#E3F0FF',color:'#1a3a5c'},processing:{label:'กำลังทำงาน',bg:'#E3F0FF',color:'#1a3a5c'},pending:{label:'รอคิว',bg:'#F5F5F5',color:'#777'},waiting_ap:{label:'รอ AP Controller',bg:'#F5EEF2',color:'#8D6B7E'},done:{label:'เสร็จแล้ว',bg:'#EEF4EF',color:'#5A7C5E'},error:{label:'ผิดพลาด',bg:'#FFEBEE',color:'#C62828'},failed:{label:'ผิดพลาด',bg:'#FFEBEE',color:'#C62828'} }[s] || {label:s,bg:'#f0f0f0',color:'#666'});
          return (
            <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.45)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1500}} onClick={()=>setQueueModal(false)}>
              <div onClick={e=>e.stopPropagation()} style={{background:'white',borderRadius:'12px',width:'900px',height:'580px',display:'flex',flexDirection:'column',overflow:'hidden',boxShadow:'0 8px 32px rgba(0,0,0,0.2)'}}>
                <div style={{background:'#1a3a5c',padding:'13px 18px',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
                  <div style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'13px',fontWeight:'600',color:'white'}}>
                    🖥️ Central Queue Monitor
                    {activeCount>0&&<span style={{background:'#E24B4A',color:'white',borderRadius:'10px',padding:'1px 8px',fontSize:'10px',fontWeight:'700'}}>{activeCount}</span>}
                  </div>
                  <button onClick={()=>setQueueModal(false)} style={{background:'none',border:'none',color:'rgba(255,255,255,0.6)',fontSize:'20px',cursor:'pointer'}}>×</button>
                </div>
                <div style={{padding:'5px 16px',background:'#EEF3F7',borderBottom:'0.5px solid #C5CAE9',fontSize:'10px',color:'#4F6E8A',display:'flex',gap:'16px',alignItems:'center',flexShrink:0}}>
                  <span><span style={{width:'7px',height:'7px',borderRadius:'50%',background:'#E24B4A',display:'inline-block',marginRight:'3px'}}></span>AP Controller = Priority สูง</span>
                  <span><span style={{width:'7px',height:'7px',borderRadius:'50%',background:'#4E8079',display:'inline-block',marginRight:'3px'}}></span>Document Center = Priority ปกติ</span>
                  {isOwner&&<span style={{marginLeft:'auto',color:'#856404',fontWeight:'500'}}>Owner: กด ↑ ลัดคิวได้</span>}
                </div>
                <div style={{display:'flex',flex:1,overflow:'hidden'}}>
                  <div style={{width:'170px',flexShrink:0,borderRight:'0.5px solid #eee',background:'#fafafa',overflowY:'auto'}}>
                    <div style={{padding:'10px 0'}}>
                      <div onClick={()=>setQSide('dashboard')} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'9px 14px',cursor:'pointer',fontSize:'12px',fontWeight:'700',color:qSide==='dashboard'?'#455A64':'#444',background:qSide==='dashboard'?'#EEF3F7':'transparent',borderLeft:`2.5px solid ${qSide==='dashboard'?'#455A64':'transparent'}`}}>
                        Dashboard {activeCount>0&&<span style={{background:'#E24B4A',color:'white',borderRadius:'8px',padding:'1px 6px',fontSize:'9px',fontWeight:'700'}}>{activeCount}</span>}
                      </div>
                    </div>
                    <div style={{borderTop:'0.5px solid #eee',margin:'0 14px'}}></div>
                    <div style={{padding:'8px 0'}}>
                      <div style={{fontSize:'9px',fontWeight:'600',color:'#bbb',padding:'4px 14px 6px',letterSpacing:'.5px',textTransform:'uppercase'}}>เมนู</div>
                      {MENU_ITEMS.map(({key,label})=>{
                        const cnt=getMenuCount(key); const isOn=qSide===key;
                        return <div key={key} onClick={()=>cnt>0?setQSide(key):null} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 14px',cursor:cnt>0?'pointer':'default',fontSize:'11px',color:isOn?'#455A64':cnt===0?'#bbb':'#555',background:isOn?'#EEF3F7':'transparent',borderLeft:`2.5px solid ${isOn?'#455A64':'transparent'}`,fontWeight:isOn?'600':'400'}}>
                          {label}<span style={{fontSize:'9px',borderRadius:'8px',padding:'1px 6px',background:cnt>0?'#E24B4A':'#E8ECEF',color:cnt>0?'white':'#aaa',fontWeight:'600'}}>{cnt}</span>
                        </div>;
                      })}
                    </div>
                  </div>
                  <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minWidth:0}}>
                    <div style={{display:'flex',alignItems:'center',gap:'8px',padding:'8px 14px',borderBottom:'0.5px solid #eee',flexShrink:0,background:'#fafafa'}}>
                      {[['active','กำลังทำงาน/รอ'],['done','Done'],['error','Error'],['all','ทั้งหมด']].map(([v,l])=>(
                        <button key={v} onClick={()=>setQStatus(v)} style={{padding:'5px 12px',fontSize:'11px',background:qStatus===v?'#455A64':'white',color:qStatus===v?'white':'#546E7A',border:'0.5px solid #CFD8DC',borderRadius:'6px',cursor:'pointer',fontWeight:qStatus===v?'500':'400',whiteSpace:'nowrap'}}>{l}</button>
                      ))}
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'44px minmax(0,1fr) 100px 72px 90px 64px',padding:'6px 14px',background:'#F5F7F9',borderBottom:'0.5px solid #e8e8e8',flexShrink:0,gap:'4px'}}>
                      {['#','ไฟล์','สถานะ','เวลา','อัปโหลดโดย','Action'].map((h,i)=><div key={i} style={{fontSize:'10px',fontWeight:'500',color:'#888',textAlign:i===5?'right':'left'}}>{h}</div>)}
                    </div>
                    <div style={{flex:1,overflowY:'auto'}}>
                      {displayed.length===0?(
                        <div style={{textAlign:'center',padding:'40px',color:'#aaa',fontSize:'12px'}}><div style={{fontSize:'28px',marginBottom:'8px'}}>✅</div>ไม่มีงานในคิว</div>
                      ):displayed.map((item,qi)=>{
                        const st=getStatusTag(item.status);
                        const src=item.source==='ap_ocr'?{label:'AP Controller',bg:'#EEF0F2',color:'#546E7A'}:{label:'Document Center',bg:'#EDF5F4',color:'#4E8079'};
                        const pos=item.queue_position||(qi+1);
                        const isOcring=['ocring','processing'].includes(item.status);
                        return (
                          <div key={`${item.source}-${item.source_id}-${qi}`} style={{display:'grid',gridTemplateColumns:'44px minmax(0,1fr) 100px 72px 90px 64px',padding:'10px 14px',borderBottom:'0.5px solid #f5f5f5',alignItems:'center',gap:'4px',background:isOcring?'#f0f6ff':'white'}}>
                            <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'1px'}}>
                              <span style={{fontSize:'8px',color:'#bbb',fontWeight:'700'}}>#{pos}</span>
                              <span style={{fontSize:'14px',lineHeight:1}}>{isOcring?'⚙️':item.status==='done'?'✅':['error','failed'].includes(item.status)?'❌':item.status==='waiting_ap'?'⏸️':'⏳'}</span>
                            </div>
                            <div style={{minWidth:0}}>
                              <div style={{fontSize:'11px',fontWeight:'500',color:'#1a3a5c',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={item.file_name}>{queueFmtFile(item.file_name)}</div>
                              <div style={{display:'flex',gap:'3px',marginTop:'2px',flexWrap:'wrap'}}>
                                <span style={{fontSize:'9px',padding:'1px 5px',borderRadius:'3px',fontWeight:'500',background:src.bg,color:src.color}}>{src.label}</span>
                                <span style={{fontSize:'9px',padding:'1px 5px',borderRadius:'3px',fontWeight:'500',background:st.bg,color:st.color}}>{st.label}</span>
                              </div>
                              {isOcring&&<div style={{height:'3px',borderRadius:'2px',background:'#dce8fb',overflow:'hidden',marginTop:'4px'}}><div style={{height:'100%',borderRadius:'2px',background:'#1a3a5c',animation:'ocrShimmer 1.5s ease-in-out infinite'}}/></div>}
                            </div>
                            <div><span style={{fontSize:'9px',padding:'1px 6px',borderRadius:'3px',fontWeight:'500',background:st.bg,color:st.color,whiteSpace:'nowrap'}}>{st.label}</span></div>
                            <div style={{fontSize:'10.5px',color:'#666'}}>{queueFmtTime(item.created_at)}</div>
                            <div style={{fontSize:'10.5px',color:'#666',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.uploaded_by?.split('@')[0]||'-'}</div>
                            <div style={{display:'flex',gap:'4px',justifyContent:'flex-end'}}>
                              {isOwner&&['pending','waiting_ap'].includes(item.status)&&item.source==='docenter'&&(
                                <button onClick={()=>handleQueueBoost(item)} style={{width:'24px',height:'24px',borderRadius:'4px',border:'0.5px solid #455A64',background:'#EEF0F2',color:'#455A64',fontSize:'11px',cursor:'pointer',fontWeight:'700',display:'flex',alignItems:'center',justifyContent:'center'}}>↑</button>
                              )}
                              <button style={{width:'24px',height:'24px',borderRadius:'4px',border:'0.5px solid #FFCDD2',background:'#FFEBEE',color:'#C62828',fontSize:'11px',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{flexShrink:0,borderTop:'0.5px solid #eee',padding:'7px 14px',background:'#fafafa',fontSize:'10px',color:'#aaa',display:'flex',justifyContent:'space-between'}}>
                      <span>แสดง {displayed.length} รายการ (24 ชั่วโมงล่าสุด)</span>
                      <span>อัปเดตทันทีเมื่อมีการเปลี่ยนแปลง</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── A4: ทีม (Online/Offline + Role + กำลังทำเมนูไหน) ── */}
        <div style={{ background: 'white', borderRadius: '12px', padding: '14px 16px', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <p style={{ fontSize: '13px', fontWeight: '500', margin: 0, color: '#1a3a5c' }}>👥 ทีม</p>
            <span style={{ background: '#EAF3DE', color: '#27500A', fontSize: '10px', padding: '2px 7px', borderRadius: '20px' }}>{onlineUsers.length} online</span>
          </div>
          {loadingTeam ? (
            <p style={{ fontSize: '11px', color: '#aaa', margin: 0 }}>กำลังโหลด...</p>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: onlineUsers.length && offlineUsers.length ? '10px' : 0 }}>
                {onlineUsers.map(u => (
                  <div key={u.username} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ position: 'relative', width: '20px', height: '20px', flexShrink: 0 }}>
                      <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#E6F1FB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: '500', color: '#0C447C' }}>{(u.username || '?')[0].toUpperCase()}</div>
                      <div style={{ position: 'absolute', bottom: '-1px', right: '-1px', width: '7px', height: '7px', borderRadius: '50%', background: '#639922', border: '1.5px solid white' }}></div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <p style={{ fontSize: '11px', margin: 0 }}>{u.username}</p>
                        <span style={{ fontSize: '9px', padding: '1px 6px', borderRadius: '20px', ...(ROLE_STYLE[u.role] || ROLE_STYLE.Viewer) }}>{u.role || 'Viewer'}</span>
                      </div>
                      <p style={{ fontSize: '10px', margin: '1px 0 0', color: '#aaa' }}>กำลังทำ · {MENU_LABELS[u.menu_id] || u.menu_id || '-'}</p>
                    </div>
                  </div>
                ))}
              </div>
              {offlineUsers.length > 0 && (
                <div style={{ borderTop: onlineUsers.length ? '0.5px solid #f0f0f0' : 'none', paddingTop: onlineUsers.length ? '8px' : 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {offlineUsers.map(u => (
                    <div key={u.username} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: '#f5f5f5', border: '0.5px solid #e8eaf0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: '500', color: '#bbb', flexShrink: 0 }}>{(u.username || '?')[0].toUpperCase()}</div>
                      <p style={{ fontSize: '11px', margin: 0, color: '#bbb', flex: 1 }}>{u.username}</p>
                      <p style={{ fontSize: '9px', margin: 0, color: '#ccc' }}>{u.lastSeen ? formatAgo(u.lastSeen) : ''}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

      </div>

      {chatBatchId && (
        <BatchChatDrawer
          batch={{ batch_id: chatBatchId }}
          isRejectMode={false}
          currentUsername={me}
          onClose={() => setChatBatchId(null)}
          onMinimize={() => setChatBatchId(null)}
        />
      )}

      {supportPopup && (
        <div onClick={()=>setSupportPopup(null)}
          style={{ position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.4)', zIndex:10001, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:'white', borderRadius:'12px', width:'440px', maxWidth:'92vw', maxHeight:'82vh', display:'flex', flexDirection:'column', overflow:'hidden' }}>
            {supportPopupLoading ? (
              <p style={{ fontSize:'13px', color:'#999', textAlign:'center', margin:'40px 0' }}>กำลังโหลด...</p>
            ) : supportPopup.thread ? (
              <>
                <div style={{ padding:'16px 18px', borderBottom:'0.5px solid #eee', flexShrink:0 }}>
                  {/* MARKER_HOMEPAGE_SUPPORT_LOG_NUMBER_DISPLAY_V1 */}
                  {supportPopup.thread.log_number && (
                    <p style={{ fontSize:'10px', color:'#999', fontFamily:'monospace', margin:'0 0 3px' }}>{supportPopup.thread.log_number}</p>
                  )}
                  <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:'10px' }}>
                    <p style={{ fontSize:'14px', fontWeight:'600', color:'#1a3a5c', margin:0, flex:1 }}>{supportPopup.thread.title}</p>
                    <button onClick={()=>setSupportPopup(null)} style={{ background:'none', border:'none', fontSize:'16px', color:'#999', cursor:'pointer', flexShrink:0, lineHeight:1 }}>×</button>
                  </div>
                  <span style={{
                    display:'inline-block', fontSize:'10px', padding:'2px 10px', borderRadius:'10px', marginTop:'6px',
                    background: supportPopup.thread.status==='new' ? '#FCEBEB' : supportPopup.thread.status==='in_process' ? '#FAEEDA' : '#EAF3DE',
                    color: supportPopup.thread.status==='new' ? '#791F1F' : supportPopup.thread.status==='in_process' ? '#633806' : '#27500A',
                  }}>
                    {supportPopup.thread.status==='new' ? 'ใหม่' : supportPopup.thread.status==='in_process' ? 'กำลังดำเนินการ' : 'แก้ไขแล้ว'}
                  </span>
                </div>

                {/* MARKER_HOMEPAGE_SUPPORT_POPUP_CHAT_HEIGHT_60VH_V1 */}
                <div style={{ maxHeight:'60vh', overflowY:'auto', padding:'14px 18px', display:'flex', flexDirection:'column', gap:'12px', background:'#fafbfc' }}>
                  <div style={{ display:'flex', gap:'8px', maxWidth:'85%' }}>
                    <div style={{ width:'26px', height:'26px', borderRadius:'50%', background:'#E6F1FB', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'10px', fontWeight:'500', color:'#0C447C', flexShrink:0 }}>
                      {(supportPopup.thread.created_by||'?').slice(0,2).toUpperCase()}
                    </div>
                    <div style={{ minWidth:0 }}>
                      <div style={{ fontSize:'10px', color:'#999', marginBottom:'3px' }}>{supportPopup.thread.created_by} · {supportFmtTime(supportPopup.thread.created_at)}</div>
                      <div style={{ background:'white', border:'0.5px solid #e8e8e8', borderRadius:'12px', borderTopLeftRadius:'3px', padding:'8px 10px' }}>
                        <div style={{ fontSize:'12px', color:'#333', whiteSpace:'pre-wrap', lineHeight:'1.5' }}>{supportPopup.thread.body}</div>
                      </div>
                    </div>
                  </div>

                  {supportPopupComments.map(c => {
                    const isFromCreator = c.username === supportPopup.thread.created_by;
                    return (
                      <div key={c.id} style={{ display:'flex', gap:'8px', maxWidth:'85%', marginLeft: isFromCreator?'0':'auto', flexDirection: isFromCreator?'row':'row-reverse' }}>
                        <div style={{ width:'26px', height:'26px', borderRadius:'50%', background: isFromCreator?'#E6F1FB':'#27500A', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'10px', fontWeight:'500', color: isFromCreator?'#0C447C':'white', flexShrink:0 }}>
                          {(c.username||'?').slice(0,2).toUpperCase()}
                        </div>
                        <div style={{ minWidth:0 }}>
                          <div style={{ fontSize:'10px', color:'#999', marginBottom:'3px', textAlign: isFromCreator?'left':'right' }}>{c.username}{!isFromCreator?' (Owner)':''} · {supportFmtTime(c.created_at)}</div>
                          <div style={{
                            background: isFromCreator?'white':'#27500A', border: isFromCreator?'0.5px solid #e8e8e8':'none', borderRadius:'12px', padding:'8px 10px',
                            borderTopLeftRadius: isFromCreator?'3px':'12px', borderTopRightRadius: isFromCreator?'12px':'3px',
                          }}>
                            <div style={{ fontSize:'12px', color: isFromCreator?'#333':'white', whiteSpace:'pre-wrap', lineHeight:'1.5' }}>{c.message}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {supportPopup.thread.status !== 'resolved' && (
                  <div style={{ padding:'12px 18px', borderTop:'0.5px solid #eee', flexShrink:0 }}>
                    <div style={{ display:'flex', gap:'8px', alignItems:'flex-end' }}>
                      <textarea value={supportPopupReplyText} onChange={e=>setSupportPopupReplyText(e.target.value)}
                        onKeyDown={e=>{ if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); handleSupportPopupSend(); } }}
                        rows={1} placeholder="พิมพ์ข้อความตอบกลับ..."
                        style={{ flex:1, padding:'8px 12px', borderRadius:'16px', border:'0.5px solid #ddd', fontSize:'12px', boxSizing:'border-box', resize:'none' }}/>
                      <button onClick={handleSupportPopupSend} disabled={supportPopupSending || !supportPopupReplyText.trim()}
                        style={{ fontSize:'12px', padding:'8px 16px', borderRadius:'16px', border:'none', background:'#1a3a5c', color:'white', cursor:'pointer', opacity:(supportPopupSending || !supportPopupReplyText.trim())?0.5:1, flexShrink:0 }}>
                        {supportPopupSending ? '...' : 'ส่ง'}
                      </button>
                    </div>
                    {isOwner && (
                      <div style={{ marginTop:'8px', display:'flex', gap:'6px' }}>
                        <button onClick={handleSupportPopupResolve} disabled={supportPopupFinishing || supportPopupRejecting}
                          style={{ flex:1, fontSize:'12px', padding:'7px', borderRadius:'8px', border:'none', background:'#27500A', color:'white', cursor:'pointer', opacity:(supportPopupFinishing || supportPopupRejecting)?0.6:1, fontWeight:'500' }}>
                          {supportPopupFinishing ? '...' : '✓ Resolve'}
                        </button>
                        <button onClick={handleSupportPopupReject} disabled={supportPopupFinishing || supportPopupRejecting}
                          style={{ width:'70px', fontSize:'12px', padding:'7px', borderRadius:'8px', border:'0.5px solid #d9534f', background:'white', color:'#d9534f', cursor:'pointer', opacity:(supportPopupFinishing || supportPopupRejecting)?0.6:1, fontWeight:'500' }}>
                          {supportPopupRejecting ? '...' : 'Reject'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p style={{ fontSize:'13px', color:'#999', textAlign:'center', margin:'40px 0' }}>ไม่พบกระทู้นี้ (อาจถูกลบไปแล้ว)</p>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

export default Homepage;