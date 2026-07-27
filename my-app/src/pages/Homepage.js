// MARKER_HOMEPAGE_ZONE_A_V1
import React, { useMemo, useState, useEffect } from 'react';
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

    // โหลด central queue ครั้งแรก (AP OCR + DocCenter รวม)
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

    // SSE: รับ push จาก backend เมื่อ DocCenter queue เปลี่ยน
    // AP OCR จะ refetch ทั้งหมดเมื่อมี event เพราะต้อง merge ทั้งสองระบบ
    const es = new EventSource(`${API_QUEUE}/queue/stream`);
    es.addEventListener('queue_update', () => { fetchAll(); });
    es.addEventListener('queue_done',   () => { fetchAll(); });
    es.addEventListener('queue_error',  () => { fetchAll(); });
    es.onerror = () => { es.close(); };
    return () => { es.close(); };
  }, [isOwner, isAdmin, currentUser?.email]);

  const [queueModalFilter, setQueueModalFilter] = useState('active');
  const [queueModalSource, setQueueModalSource] = useState('all');

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
        setNotifications(list);
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
  }, [me]);

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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <p style={{ fontSize: '13px', fontWeight: '500', margin: 0, color: '#1a3a5c' }}>🔔 Notification</p>
            {notifications.length > 0 && (
              <span style={{ background: '#E6F1FB', color: '#0C447C', fontSize: '10px', padding: '2px 7px', borderRadius: '20px' }}>{notifications.length} รายการ</span>
            )}
          </div>
          {loadingNotif ? (
            <p style={{ fontSize: '11px', color: '#aaa', margin: 0 }}>กำลังโหลด...</p>
          ) : notifications.length === 0 ? (
            <p style={{ fontSize: '11px', color: '#aaa', margin: 0 }}>ไม่มีการแจ้งเตือน</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {notifications.slice(0, 8).map(n => {
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
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 10px', border: '0.5px solid #eee', borderRadius: '10px', cursor: onOpenInbox ? 'pointer' : 'default', background: '#fafbfc' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: st.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', flexShrink: 0 }}>{st.icon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '1px' }}>
                        <span style={{ fontSize: '12px', fontWeight: '500', color: '#1a3a5c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.batch_id || '-'}</span>
                        {bMeta?.bu && <span style={{ fontSize: '10px', color: '#aaa', flexShrink: 0 }}>{bMeta.bu}</span>}
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
              {notifications.length > 8 && (
                <p style={{ fontSize: '11px', margin: '2px 0 0', color: '#aaa' }}>+ อีก {notifications.length - 8} รายการ</p>
              )}
            </div>
          )}
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
          const displayed = queueItems.filter(it => {
            const okSrc = queueModalSource === 'all' || it.source === queueModalSource;
            const okSt  = queueModalFilter === 'all' || ['pending','ocring','processing','waiting_ap'].includes(it.status);
            return okSrc && okSt;
          });
          const activeCount = queueItems.filter(it => ['pending','ocring','processing','waiting_ap'].includes(it.status)).length;
          return (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1500 }} onClick={() => setQueueModal(false)}>
              <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '12px', width: '620px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
                <div style={{ padding: '12px 16px', background: '#1a3a5c', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: '600', color: 'white' }}>🖥️ Central Queue Monitor</span>
                    {activeCount > 0 && <span style={{ background: '#E24B4A', color: 'white', borderRadius: '10px', padding: '1px 7px', fontSize: '10px', fontWeight: '700' }}>{activeCount} รายการ</span>}
                  </div>
                  <button onClick={() => setQueueModal(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', fontSize: '18px', cursor: 'pointer' }}>×</button>
                </div>
                <div style={{ padding: '5px 14px', background: '#f0f6ff', borderBottom: '0.5px solid #e0ebf7', fontSize: '10px', color: '#1a3a5c', flexShrink: 0, display: 'flex', gap: '12px' }}>
                  <span>🔴 AP OCR = Priority สูง</span>
                  <span>🟢 Document Center = Priority ปกติ</span>
                  {isOwner && <span style={{ color: '#856404', fontWeight: '500' }}>Owner: กด ↑ ลัดคิวได้</span>}
                  {isAdmin && !isOwner && <span style={{ color: '#555' }}>Admin: ดูได้ทั้งหมด ลัดคิวไม่ได้</span>}
                </div>
                <div style={{ display: 'flex', borderBottom: '0.5px solid #eee', flexShrink: 0 }}>
                  {[['active','กำลังทำงาน/รอ'],['all','ทั้งหมด']].map(([v,l]) => (
                    <button key={v} onClick={() => setQueueModalFilter(v)} style={{ flex: 1, padding: '7px', fontSize: '11px', border: 'none', background: 'none', borderBottom: queueModalFilter===v?'2px solid #1a3a5c':'2px solid transparent', color: queueModalFilter===v?'#1a3a5c':'#888', cursor: 'pointer', fontWeight: queueModalFilter===v?'500':'400' }}>{l}</button>
                  ))}
                  {[['all','ทุกระบบ'],['ap_ocr','AP OCR'],['docenter','Document Center']].map(([v,l]) => (
                    <button key={v} onClick={() => setQueueModalSource(v)} style={{ flex: 1, padding: '7px', fontSize: '11px', border: 'none', background: 'none', borderBottom: queueModalSource===v?'2px solid #E65100':'2px solid transparent', color: queueModalSource===v?'#E65100':'#888', cursor: 'pointer', fontWeight: queueModalSource===v?'500':'400' }}>{l}</button>
                  ))}
                </div>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {displayed.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#aaa', fontSize: '12px' }}><div style={{ fontSize: '28px', marginBottom: '8px' }}>✅</div>ไม่มีงานในคิว</div>
                  ) : displayed.map((item, i) => {
                    const st  = QUEUE_STATUS_CONFIG[item.status] || { label: item.status, color: '#555', bg: '#f5f5f5', icon: '?' };
                    const src = QUEUE_SOURCE_CONFIG[item.source] || { label: item.source, color: '#555', bg: '#f5f5f5' };
                    return (
                      <div key={`${item.source}-${item.source_id}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 14px', borderBottom: '0.5px solid #f5f5f5', background: ['ocring','processing'].includes(item.status) ? '#f8fbff' : 'white' }}>
                        <span style={{ fontSize: '14px', flexShrink: 0 }}>{st.icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '11px', fontWeight: '500', color: '#1a3a5c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.file_name}>{queueFmtFile(item.file_name)}</div>
                          <div style={{ display: 'flex', gap: '5px', marginTop: '2px', flexWrap: 'wrap', alignItems: 'center' }}>
                            <span style={{ fontSize: '9px', fontWeight: '600', padding: '1px 5px', borderRadius: '3px', background: src.bg, color: src.color }}>{src.label}</span>
                            <span style={{ fontSize: '9px', padding: '1px 5px', borderRadius: '3px', background: st.bg, color: st.color, fontWeight: '500' }}>{st.label}</span>
                            <span style={{ fontSize: '9px', color: '#aaa' }}>{queueFmtTime(item.created_at)}</span>
                            {(isOwner || isAdmin) && item.uploaded_by && <span style={{ fontSize: '9px', color: '#888' }}>{item.uploaded_by.split('@')[0]}</span>}
                          </div>
                          {item.error_msg && <div style={{ fontSize: '9px', color: '#c0392b', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.error_msg}</div>}
                        </div>
                        {isOwner && ['pending','waiting_ap'].includes(item.status) && item.source === 'docenter' && (
                          <button onClick={() => handleQueueBoost(item)} title="ลัดคิว" style={{ width: '22px', height: '22px', borderRadius: '4px', border: '0.5px solid #1a3a5c', background: '#f0f6ff', color: '#1a3a5c', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>↑</button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div style={{ padding: '7px 14px', borderTop: '0.5px solid #eee', background: '#fafafa', flexShrink: 0, fontSize: '10px', color: '#aaa', display: 'flex', justifyContent: 'space-between' }}>
                  <span>แสดง {displayed.length} จาก {queueItems.length} รายการ (24 ชั่วโมงล่าสุด)</span>
                  <span>อัปเดตทุก 15 วิ</span>
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

    </div>
  );
}

export default Homepage;