import React, { useState, useEffect, useRef } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
// MARKER_GLOBAL_CHAT_BUBBLE_V1
import GlobalChatBubble from './GlobalChatBubble';
import { DataCacheProvider, useDataCache } from './contexts/DataCacheContext';
import Login from './pages/Login';
import Homepage from './pages/Homepage';
import ItemCodeList from './pages/ItemCodeList';
import BusinessUnit from './pages/BusinessUnit';
import ChartOfAccounts from './pages/ChartOfAccounts';
import VendorMaster from './pages/VendorMaster';
import UploadGen from './pages/UploadGen';
import UserManagement from './pages/UserManagement';
import APController, { InvoiceHistoryPage } from './pages/APController';
import APScanOCR from './pages/APScanOCR';
import VatController from './pages/VatController';
import './App.css';
import { useUserRole } from './contexts/useUserRole';
import { db } from './lib/db';
import { useRealtimeRefresh } from './useRealtimeRefresh';
import { broadcastWs } from './wsManager';
import { confirmDialog } from './confirmDialog';
import ConfirmDialogHost from './ConfirmDialogHost';

const API = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');

function useWindowWidth() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const h = () => setWidth(window.innerWidth);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return width;
}

function NoAccessPage() {
  return (
    <div style={{ padding: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888' }}>
      <div style={{ fontSize: '48px', marginBottom: '16px' }}>⛔</div>
      <div style={{ fontSize: '18px', fontWeight: '500', color: '#1a3a5c', marginBottom: '8px' }}>ไม่มีสิทธิ์เข้าถึงหน้านี้ครับ</div>
      <div style={{ fontSize: '13px', color: '#aaa' }}>กรุณาติดต่อ Owner เพื่อขอสิทธิ์เพิ่มเติม</div>
    </div>
  );
}

function PlaceholderPage({ title, icon }) {
  return (
    <div style={{ padding: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888' }}>
      <div style={{ fontSize: '48px', marginBottom: '16px' }}>{icon}</div>
      <div style={{ fontSize: '18px', fontWeight: '500', color: '#1a3a5c', marginBottom: '8px' }}>{title}</div>
      <div style={{ fontSize: '13px', color: '#aaa' }}>อยู่ระหว่างการพัฒนา</div>
    </div>
  );
}

// ✅ Maps activePage -> maintenance menu key (as set in System Console > Access Control)
const PAGE_MAINTENANCE_MAP = {
  'ap-gr': 'ap-gr', 'ap-ocr': 'ap-ocr', 'ap-form': 'ap-form', 'ap-drafts': 'ap-drafts',
  'vat-incomplete-report': 'vat-controller',
  'vat-amagno-reconcile': 'vat-controller',
  'vat-popvat-report': 'vat-controller',
  'vat-simple-input-report': 'vat-controller',
  'i-expense': 'i-expense',
  'gl-functional': 'gl-functional',
  'i-pro-interface': 'i-pro-interface',
};

function MaintenancePage({ label }) {
  return (
    <div style={{ padding: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888' }}>
      <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔧</div>
      <div style={{ fontSize: '18px', fontWeight: '500', color: '#1a3a5c', marginBottom: '8px' }}>อยู่ระหว่างการปรับปรุง</div>
      <div style={{ fontSize: '13px', color: '#aaa' }}>{label ? `${label} ` : ''}ปิดให้บริการชั่วคราว — กรุณาลองใหม่อีกครั้งในภายหลัง</div>
    </div>
  );
}

const LogoutIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
    <polyline points="16 17 21 12 16 7"/>
    <line x1="21" y1="12" x2="9" y2="12"/>
  </svg>
);

const UserIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
  </svg>
);

const BellIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
    <path d="M13.73 21a2 2 0 01-3.46 0"/>
  </svg>
);

const DOC_FOLDER_LABELS = { ap: 'AP Manual', vat: 'VAT Control', ie: 'I-Expense', gl: 'GL Report', ipro: 'I-Pro Interface' };

function BellModal({ requests, isOwner, isAdmin, onApprove, onReject, onClose, onGoAccess, apNotifications, onMarkApNotifRead, onClearOrphanSafe, onClosePeriod }) {
  const pendingCount = requests.filter(r => r.status === 'pending').length;
  const pendingReqs = requests.filter(r => r.status === 'pending');
  // ── แก้ Bug: เดิมไม่มี Filter 24 ชม. เลย ทำให้ Request เก่าค้างอยู่ตลอดไป ──
  const handledReqs = requests.filter(r => {
    if (r.status === 'pending') return false;
    if (!r.handled_at) return true; // กันกรณีไม่มี handled_at (Bug เดิม) ให้โชว์ไปก่อน
    const hoursSinceHandled = (Date.now() - new Date(r.handled_at).getTime()) / (1000 * 60 * 60);
    return hoursSinceHandled < 24;
  });

  const formatTime = (ts) => {
    if (!ts) return '';
    const diff = Math.floor((Date.now() - new Date(ts)) / 1000 / 60);
    if (diff < 60) return `${diff} นาทีที่แล้ว`;
    if (diff < 1440) return `${Math.floor(diff/60)} ชั่วโมงที่แล้ว`;
    return 'เมื่อวาน';
  };

  const hoursLeft = (ts) => {
    if (!ts) return '';
    const left = Math.ceil((new Date(ts).getTime() + 24*60*60*1000 - Date.now()) / (1000*60*60));
    return left > 0 ? `หายใน ${left} ชม.` : 'กำลังจะหาย';
  };

  const visibleRequests = requests.filter(req => {
    if (req.status === 'pending') return true; // Pending แสดงเสมอ ไม่มีวันหมดอายุ
    if (!req.handled_at) return true; // กันกรณีไม่มี handled_at
    const hoursSinceHandled = (Date.now() - new Date(req.handled_at).getTime()) / (1000*60*60);
    return hoursSinceHandled < 24; // แสดงเฉพาะที่ยังไม่เกิน 24 ชม.
  });

  // ── แยก Notification ตาม category — AP Period / Orphan ปลอดภัย / System Alert (RAM) แสดงคนละ Section ──
  const apPeriodNotifs = (apNotifications || []).filter(n => n.category !== 'RAM_ANOMALY' && n.category !== 'RAM_ORPHAN_SAFE');
  const orphanSafeNotifs = (apNotifications || []).filter(n => n.category === 'RAM_ORPHAN_SAFE');
  const ramNotifs = (apNotifications || []).filter(n => n.category === 'RAM_ANOMALY');

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
      <div style={{ background: 'white', borderRadius: '12px', width: '460px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '0.5px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '15px', fontWeight: '500', color: '#1a3a5c' }}>🔔 การแจ้งเตือน</span>
            {pendingCount > 0 && (
              <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '20px', background: '#FCEBEB', color: '#791F1F', fontWeight: '500' }}>
                {pendingCount} รออนุมัติ
              </span>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: '20px', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {visibleRequests.length === 0 && apPeriodNotifs.length === 0 && orphanSafeNotifs.length === 0 && ramNotifs.length === 0 && (
            <div style={{ padding: '48px', textAlign: 'center', color: '#aaa', fontSize: '13px' }}>
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>🔔</div>
              ไม่มีการแจ้งเตือน
            </div>
          )}
          {pendingReqs.length > 0 && (
            <>
              <div style={{ padding: '6px 18px', background: '#f8f9fa', borderBottom: '0.5px solid #f0f0f0' }}>
                <span style={{ fontSize: '11px', fontWeight: '500', color: '#888', textTransform: 'uppercase', letterSpacing: '0.4px' }}>รออนุมัติ</span>
              </div>
              {pendingReqs.map(req => {
                const isSignup = req.request_type === 'signup';
                const isBatchTransfer = req.request_type === 'batch_transfer';
                const folderLabel = DOC_FOLDER_LABELS[req.folder_key] || req.folder_key;
                const initial = (req.requester_name || '?')[0].toUpperCase();
                const title = isSignup
                  ? `${req.requester_name} ขอสมัครเข้าใช้งานระบบ`
                  : isBatchTransfer
                    ? `${req.requester_name} ส่ง Batch มาให้ (${(req.ref_batch_ids || []).length} invoices)`
                    : (isOwner ? `${req.requester_name} ขอสิทธิ์เข้า ${folderLabel}` : `คำขอเข้า ${folderLabel}`);
                return (
                  <div key={req.id} style={{ padding: '14px 18px', borderBottom: '0.5px solid #f0f0f0', background: '#f8fbff' }}>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                      <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: isSignup ? '#EAF3DE' : '#e8f0fb', color: isSignup ? '#27500A' : '#0C447C', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: '500', flexShrink: 0 }}>{initial}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: '500', color: '#1a3a5c', marginBottom: '2px' }}>
                          {isSignup && <span style={{ fontSize: '10px', background: '#EAF3DE', color: '#27500A', padding: '1px 6px', borderRadius: '20px', marginRight: '6px' }}>สมัครใหม่</span>}
                          {title}
                        </div>
                        <div style={{ fontSize: '11px', color: '#888', marginBottom: isOwner ? '10px' : '0' }}>
                          {req.requester_name} · {formatTime(req.created_at)}
                        </div>
                        {isOwner && (
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={() => onApprove(req)} style={{ fontSize: '12px', padding: '5px 14px', borderRadius: '6px', border: 'none', background: '#EAF3DE', color: '#27500A', cursor: 'pointer', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '4px' }}>✅ อนุมัติ</button>
                            <button onClick={() => onReject(req)} style={{ fontSize: '12px', padding: '5px 14px', borderRadius: '6px', border: '0.5px solid #ddd', background: 'white', color: '#555', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>❌ ปฏิเสธ</button>
                          </div>
                        )}
                        {!isOwner && (
                          <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '20px', background: '#FFF3CD', color: '#856404' }}>⏳ รออนุมัติ</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
          {handledReqs.length > 0 && (
            <>
              <div style={{ padding: '6px 18px', background: '#f8f9fa', borderBottom: '0.5px solid #f0f0f0' }}>
                <span style={{ fontSize: '11px', fontWeight: '500', color: '#888', textTransform: 'uppercase', letterSpacing: '0.4px' }}>จัดการแล้ว</span>
              </div>
              {handledReqs.map(req => {
                const folderLabel = DOC_FOLDER_LABELS[req.folder_key] || req.folder_key;
                const initial = (req.requester_name || '?')[0].toUpperCase();
                const isApproved = req.status === 'approved';
                return (
                  <div key={req.id} style={{ padding: '14px 18px', borderBottom: '0.5px solid #f0f0f0' }}>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                      <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: '#f5f5f5', color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: '500', flexShrink: 0 }}>{initial}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', color: '#555', marginBottom: '4px' }}>
                          {isOwner ? `${req.requester_name} ขอสิทธิ์เข้า ${folderLabel}` : `คำขอเข้า ${folderLabel}`}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '20px', background: isApproved ? '#EAF3DE' : '#FCEBEB', color: isApproved ? '#27500A' : '#791F1F' }}>
                            {isApproved ? `✅ อนุมัติโดย ${req.handled_by}` : `❌ ปฏิเสธโดย ${req.handled_by}`}
                          </span>
                          <span style={{ fontSize: '11px', color: '#aaa' }}>{hoursLeft(req.handled_at)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
          {/* ── Section: AP Period Notifications (Close Period / Override) ── */}
          {apPeriodNotifs.length > 0 && (
            <>
              <div style={{ padding: '6px 18px', background: '#f8f9fa', borderBottom: '0.5px solid #f0f0f0' }}>
                <span style={{ fontSize: '11px', fontWeight: '500', color: '#888', textTransform: 'uppercase', letterSpacing: '0.4px' }}>AP Period</span>
              </div>
              {apPeriodNotifs.map(n => (
                <div key={n.id} onClick={() => !n.is_read && onMarkApNotifRead(n.id)}
                  style={{ padding: '14px 18px', borderBottom: '0.5px solid #f0f0f0', cursor: n.is_read ? 'default' : 'pointer', background: n.is_read ? 'white' : '#f0f7ff' }}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                    <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: '#E6F1FB', color: '#0C447C', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', flexShrink: 0 }}>🔒</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                        {!n.is_read && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#1a3a5c', flexShrink: 0 }} />}
                        <span style={{ fontSize: '13px', fontWeight: '500', color: '#1a3a5c' }}>{n.title}</span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#888', marginBottom: '2px' }}>{n.message}</div>
                      <div style={{ fontSize: '11px', color: '#aaa', marginBottom: n.category === 'AP_PERIOD_REQUEST' && (isOwner || isAdmin) ? '8px' : '0' }}>{formatTime(n.created_at)}</div>
                      {n.category === 'AP_PERIOD_REQUEST' && (isOwner || isAdmin) && (
                        <button onClick={(e) => { e.stopPropagation(); onClosePeriod(n.id); }}
                          style={{ fontSize: '12px', padding: '6px 16px', borderRadius: '6px', border: 'none', background: '#791F1F', color: 'white', fontWeight: '500', cursor: 'pointer' }}>
                          ปิด Period
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* ── Section: Orphan Process ปลอดภัยที่จะปิด ── */}
          {orphanSafeNotifs.length > 0 && (
            <>
              <div style={{ padding: '6px 18px', background: '#f8f9fa', borderBottom: '0.5px solid #f0f0f0' }}>
                <span style={{ fontSize: '11px', fontWeight: '500', color: '#888', textTransform: 'uppercase', letterSpacing: '0.4px' }}>System · RAM</span>
              </div>
              {orphanSafeNotifs.map(n => (
                <div key={n.id} style={{ padding: '14px 18px', borderBottom: '0.5px solid #f0f0f0', background: '#EAF3DE' }}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                    <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: '#C0DD97', color: '#27500A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', flexShrink: 0 }}>✓</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#27500A', flexShrink: 0 }} />
                        <span style={{ fontSize: '13px', fontWeight: '500', color: '#27500A' }}>{n.title}</span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#5a6b4a', marginBottom: '8px' }}>{n.message}</div>
                      <button onClick={() => onClearOrphanSafe()} style={{ fontSize: '12px', padding: '6px 16px', borderRadius: '6px', border: 'none', background: '#27500A', color: 'white', fontWeight: '500', cursor: 'pointer' }}>
                        เคลียร์เลย
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* ── Section: System Alert (RAM Anomaly) ── */}
          {ramNotifs.length > 0 && (
            <>
              <div style={{ padding: '6px 18px', background: '#f8f9fa', borderBottom: '0.5px solid #f0f0f0' }}>
                <span style={{ fontSize: '11px', fontWeight: '500', color: '#888', textTransform: 'uppercase', letterSpacing: '0.4px' }}>System Alert</span>
              </div>
              {ramNotifs.map(n => (
                <div key={n.id} onClick={() => !n.is_read && onMarkApNotifRead(n.id)}
                  style={{ padding: '14px 18px', borderBottom: '0.5px solid #f0f0f0', cursor: n.is_read ? 'default' : 'pointer', background: n.is_read ? 'white' : '#FCEBEB' }}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                    <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: '#FCEBEB', color: '#791F1F', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', flexShrink: 0 }}>⚠️</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                        {!n.is_read && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#791F1F', flexShrink: 0 }} />}
                        <span style={{ fontSize: '13px', fontWeight: '500', color: '#791F1F' }}>{n.title}</span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#888', marginBottom: '2px' }}>{n.message}</div>
                      <div style={{ fontSize: '11px', color: '#aaa' }}>{formatTime(n.created_at)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
        <div style={{ padding: '12px 18px', borderTop: '0.5px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: '11px', color: '#aaa' }}>จัดการแล้วจะหายอัตโนมัติใน 24 ชม.</span>
          {isOwner && (
            <button onClick={onGoAccess} style={{ fontSize: '12px', padding: '5px 14px', borderRadius: '6px', border: '0.5px solid #1a3a5c', background: 'white', color: '#1a3a5c', cursor: 'pointer', fontWeight: '500' }}>
              ไป Access Control →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// IncomingToast — แจ้งเตือนเมื่อมี batch ส่งมาให้ (global, render ทุกหน้า)
// ─────────────────────────────────────────────────────────────────────────────
function IncomingToast({ request, currentUser, userName, onDismiss }) {
  const [rejectNote, setRejectNote] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [acting, setActing]         = useState(false);

  if (!request) return null;

  const fromName = request.requester_name || request.created_by || 'ผู้ส่ง';
  const detail = typeof request.detail === 'string' ? (() => { try { return JSON.parse(request.detail || '{}'); } catch { return {}; } })() : (request.detail || {});
  const ids = detail.ids || (request.id && !request._bucketToast ? [request.id] : []);
  const note = detail.note || request.note || request.sent_note || '';

  const handleAccept = async () => {
    setActing(true);
    try {
      const token = sessionStorage.getItem('fastapn_token');
      // 1. update bucket_list → pending (โอน ownership ให้ผู้รับ) ใช้ PUT รายตัว
      if (ids.length) {
        await Promise.all(ids.map(id =>
          fetch(`${API}/api/bucket_list/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              status: 'pending',
              created_by: userName || currentUser?.email || '',
              sent_to_user_id: null,
              sent_to_username: null,
              responded_at: new Date().toISOString(),
            }),
          })
        ));
      }
      // 2. log BATCH_ACCEPT
      await fetch(`${API}/api/activity_log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          username: userName || currentUser?.email || '',
          module: 'AP',
          action: 'BATCH_ACCEPT',
          detail: JSON.stringify({ count: ids.length, ids, ref_log_id: request.id }),
          received_by: request.username || '',
        }),
      });
      // 3. mark responded ใน activity_log เดิม (ข้ามถ้าเป็น bucket toast)
      if (!request._bucketToast) {
        await fetch(`${API}/api/activity_log/${request.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ detail: JSON.stringify({ ...(typeof request.detail === 'string' ? JSON.parse(request.detail||'{}') : request.detail||{}), responded: true, responded_by: userName || currentUser?.email || '', responded_at: new Date().toISOString() }) }),
        });
      }
      // 4. Broadcast แบบ Real-time ให้ฝั่งผู้ส่งเห็นการเปลี่ยนแปลงทันที ──────────
      // ── (เดิมมีแค่ dispatchEvent('bucketAccepted') ซึ่งทำงานแค่ใน Tab เดียวกัน ──
      // ── กับที่ IncomingToast render อยู่ ไม่ถึงฝั่งผู้ส่งที่อยู่คนละ Session/User) ──
      broadcastWs('bucket_accepted', { batch_id: ids.join(','), status: 'accepted' });
      onDismiss('accepted');
    } catch (e) { confirmDialog.alert('รับไม่สำเร็จ: ' + e.message, { variant: 'danger' }); }
    setActing(false);
  };

  const handleReject = async () => {
    setActing(true);
    try {
      const token = sessionStorage.getItem('fastapn_token');
      // 1. update bucket_list → rejected ใช้ PUT รายตัว
      if (ids.length) {
        await Promise.all(ids.map(id =>
          fetch(`${API}/api/bucket_list/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              status: 'rejected',
              reject_note: rejectNote || '',
              responded_at: new Date().toISOString(),
            }),
          })
        ));
      }
      // 2. log BATCH_REJECT
      await fetch(`${API}/api/activity_log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          username: userName || currentUser?.email || '',
          module: 'AP',
          action: 'BATCH_REJECT',
          detail: JSON.stringify({ count: ids.length, ids, note: rejectNote || '', ref_log_id: request.id }),
          received_by: request.username || '',
        }),
      });
      // 3. mark responded (ข้ามถ้าเป็น bucket toast)
      if (!request._bucketToast) {
        await fetch(`${API}/api/activity_log/${request.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ detail: JSON.stringify({ ...(typeof request.detail === 'string' ? JSON.parse(request.detail||'{}') : request.detail||{}), responded: true, reject_note: rejectNote || '', responded_by: userName || currentUser?.email || '', responded_at: new Date().toISOString() }) }),
        });
      }
      // 4. Broadcast แบบ Real-time ให้ฝั่งผู้ส่งเห็นการเปลี่ยนแปลงทันที (เหมือนขั้นตอน Accept) ──
      broadcastWs('bucket_rejected', { batch_id: ids.join(','), status: 'rejected' });
      onDismiss('rejected');
    } catch (e) { confirmDialog.alert('ปฏิเสธไม่สำเร็จ: ' + e.message, { variant: 'danger' }); }
    setActing(false);
  };

  return (
    <div style={{ position: 'fixed', bottom: '24px', right: '24px', width: '320px', background: 'white', border: '0.5px solid #c5d8f0', borderRadius: '12px', boxShadow: '0 8px 24px rgba(26,58,92,0.18)', zIndex: 9999, overflow: 'hidden' }}>
      <div style={{ background: '#1a3a5c', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '16px' }}>📦</span>
        <span style={{ fontSize: '13px', fontWeight: '500', color: 'white', flex: 1 }}>มี Batch ส่งมาให้คุณ</span>
        <button onClick={() => onDismiss('dismissed')} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: '16px', lineHeight: 1 }}>×</button>
      </div>
      <div style={{ padding: '12px 14px' }}>
        <div style={{ fontSize: '13px', color: '#1a3a5c', marginBottom: '4px' }}>
          <strong>{fromName}</strong> ส่ง <strong>{ids.length} invoice{ids.length > 1 ? 's' : ''}</strong> มาให้
        </div>
        {note && <div style={{ fontSize: '11px', color: '#888', marginBottom: '8px', fontStyle: 'italic' }}>"{note}"</div>}
        {showReject ? (
          <div style={{ marginTop: '8px' }}>
            <textarea value={rejectNote} onChange={e => setRejectNote(e.target.value)} placeholder="เหตุผลที่ปฏิเสธ (ถ้ามี)"
              style={{ width: '100%', height: '56px', padding: '6px 8px', fontSize: '12px', border: '0.5px solid #ddd', borderRadius: '6px', resize: 'none', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: '8px' }} />
            <div style={{ display: 'flex', gap: '6px' }}>
              <button onClick={() => setShowReject(false)} style={{ flex: 1, padding: '6px 0', borderRadius: '6px', border: '0.5px solid #ddd', background: 'white', color: '#555', fontSize: '12px', cursor: 'pointer' }}>ยกเลิก</button>
              <button onClick={handleReject} disabled={acting}
                style={{ flex: 1, padding: '6px 0', borderRadius: '6px', border: 'none', background: acting ? '#aaa' : '#c0392b', color: 'white', fontSize: '12px', cursor: acting ? 'default' : 'pointer', fontWeight: '500' }}>
                {acting ? '...' : '❌ ยืนยันปฏิเสธ'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
            <button onClick={handleAccept} disabled={acting}
              style={{ flex: 1, padding: '7px 0', borderRadius: '6px', border: 'none', background: acting ? '#aaa' : '#0F6E56', color: 'white', fontSize: '12px', cursor: acting ? 'default' : 'pointer', fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
              ✅ {acting ? '...' : 'Accept'}
            </button>
            <button onClick={() => setShowReject(true)} disabled={acting}
              style={{ flex: 1, padding: '7px 0', borderRadius: '6px', border: '0.5px solid #f7c1c1', background: '#FCEBEB', color: '#791F1F', fontSize: '12px', cursor: acting ? 'default' : 'pointer', fontWeight: '500', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
              ❌ Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const getBuildVersion = () => {
  const ts = Number(process.env.REACT_APP_BUILD_TIME);
  const commit = process.env.REACT_APP_COMMIT_SHA?.slice(0, 7);
  const envRaw = process.env.REACT_APP_ENV || process.env.NODE_ENV;
  const envMap = { production: 'PROD', preview: 'PREVIEW', development: 'DEV' };
  const env = envMap[envRaw] || envRaw?.toUpperCase();
  const d = new Date(ts);
  if (isNaN(d.getTime())) return `v-- · ${env}`;
  const dateStr = `${String(d.getFullYear()).slice(2)}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
  return `Link3ase · v${dateStr} · ${env}${commit ? ` · ${commit}` : ''}`;
};

function MainApp() {
  const { fetchCollection } = useDataCache(); // ── ใช้ Force Refresh Cache หลัง Action ที่กระทบ CompanyList ──
  const [activePage, setActivePage] = useState('home');
  // MARKER_APP_OPEN_INBOX_FROM_NOTIF_V1
  // ── จำว่าต้องเปิด Tab ไหนใน APController หลัง Navigate มาจาก Notification ──
  const [pendingHistoryTab, setPendingHistoryTab] = useState(null);
  // MARKER_NOTIF_CLICK_TARGET_BY_AUDIENCE_V1
  const handleOpenInbox = (tab = 'inbox') => { setPendingHistoryTab(tab); setActivePage('ap-gr'); };
  const [showBell, setShowBell] = useState(false);
  const [requests, setRequests] = useState([]);
  const [apNotifications, setApNotifications] = useState([]);
  const [maintenanceMenus, setMaintenanceMenus] = useState([]);
  const [incomingBatch, setIncomingBatch] = useState(null); // ✅ batch transfer notification
  const [toast, setToast] = useState(null); // { type: 'success' | 'error', message }
  const toastTimerRef = useRef(null);
  const showToast = (type, message) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ type, message });
    toastTimerRef.current = setTimeout(() => setToast(null), 10000);
  };
  const bellRef = React.useRef(null);
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [openMenu, setOpenMenu] = useState(null);
  const closeTimerRef = useRef(null);
  const sidebarRef = useRef(null);
  const { currentUser, userRole, userName, logout, userPermissions } = useAuth();
  const { isOwner, isAdmin, isEditor } = useUserRole();
  const screenWidth = useWindowWidth();
  const hasAnyDocAccess = Object.values(userPermissions?.docAccess || {}).some(v => v === true);

  // ── Reset pendingHistoryTab ทันทีหลัง Consume (กันบังคับ Inbox ซ้ำตอน Navigate ปกติ) ──
  useEffect(() => {
    if (activePage === 'ap-gr' && pendingHistoryTab) setPendingHistoryTab(null);
  }, [activePage]);



  // ── Page groups ──────────────────────────────────────────────────────────────
  const AP_PAGES     = ['ap-gr', 'ap-ocr', 'ap-form', 'ap-drafts'];
  const VAT_PAGES    = ['vat-incomplete-report', 'vat-amagno-reconcile', 'vat-popvat-report', 'vat-simple-input-report'];
  // [CHANGE 1] เพิ่ม 'condition-rule' เข้า MASTER_PAGES เพื่อให้ sidebar highlight ถูกต้อง
  const MASTER_PAGES = ['bu-info','bu-branch','coa-costcenter','coa-account','coa-subaccount','itemcode','vendor-apcode','vendor-smcode','vendor-iecode','vendor-category','condition-rule'];
  const isAPActive     = AP_PAGES.includes(activePage);
  const isVATActive    = VAT_PAGES.includes(activePage);
  const isMasterActive = MASTER_PAGES.includes(activePage);

  useEffect(() => {
    const handler = (e) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target)) {
        setSidebarExpanded(true);
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    fetchRequests();
    fetchApNotifications();
    const interval = setInterval(() => { fetchRequests(); fetchApNotifications(); }, 30000);
    return () => clearInterval(interval);
  }, [currentUser]);

  // ── Real-time: ฟัง broadcast 'bucket_sent'/'bucket_recalled' จาก server ────
  // ── ให้ Toast ขึ้น/หายทันที ไม่ต้องรอ Poll รอบ 30 วิด้านบน ─────────────────
  // ── ใช้ Shared WS Connection (wsManager) แทนเปิด Connection แยกของตัวเอง ──
  useRealtimeRefresh(['bucket_sent', 'bucket_recalled'], () => fetchRequests());

  // ── ดึง AP Period Notifications (Close Period / Override) เฉพาะ User ที่มี Permission Manual ──
  const fetchApNotifications = async () => {
    if (!userPermissions?.Manual && !isOwner) return;
    try {
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${API}/api/ap/period/notifications`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setApNotifications(Array.isArray(data) ? data : []);
    } catch (err) { console.error('fetchApNotifications error:', err); }
  };

  const handleMarkApNotifRead = async (id) => {
    try {
      const token = sessionStorage.getItem('fastapn_token');
      await fetch(`${API}/api/ap/period/notifications/${id}/read`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      // ── กดแล้วลบออกจาก List ทันที ไม่ใช่แค่ทำสีจาง (Backend กรองไม่ส่งกลับมาอีกแล้ว) ──
      setApNotifications(prev => prev.filter(n => n.id !== id));
    } catch (err) { console.error('markApNotifRead error:', err); }
  };

  // ── กด "เคลียร์เลย" ในกระดิ่ง — เรียก Endpoint เดิม แล้วลบ Notification ออกจาก List ทันที ──
  const handleClearOrphanSafe = async () => {
    // ── ลบออกจาก List ทันทีที่กด ไม่ต้องรอผล กันกดซ้ำ ──
    setApNotifications(prev => prev.filter(n => n.category !== 'RAM_ORPHAN_SAFE'));
    try {
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${API}/api/system/kill-orphans/confirm-safe`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
      showToast('success', `เคลียร์สำเร็จ ${data.killedCount} โปรแกรม — RAM ตอนนี้ ${data.ramAfter?.pct ?? '-'}%`);
    } catch (err) {
      showToast('error', 'เคลียร์ไม่สำเร็จ: ' + err.message);
    }
  };

  // ── กด "ปิด Period" ในกระดิ่ง (Owner/Admin เท่านั้น) — ลบออกจาก List ทันที กันกดซ้ำ ──
  const handleClosePeriodFromBell = async (notifId) => {
    setApNotifications(prev => prev.filter(n => n.id !== notifId));
    try {
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${API}/api/ap/period/close`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      // ── Force Refresh ให้หน้า AP Controller เห็นสถานะใหม่ทันที ไม่ต้อง Refresh หน้าเว็บเอง ──
      await fetchCollection('CompanyList', true);
      showToast('success', 'ปิด Period สำเร็จ');
    } catch (err) {
      showToast('error', 'ปิด Period ไม่สำเร็จ: ' + err.message);
    }
  };

  const fetchRequests = async () => {
    try {
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${API}/api/access_requests?order=created_at.desc`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      const all = Array.isArray(data) ? data : [];
      setRequests(all.filter(r => r.request_type !== 'batch_transfer'));
      // ── poll bucket_list ที่ส่งมาให้เรา (status=sent) ──
      const myUsername = userName || currentUser?.email || '';
      if (myUsername) {
        const bucketRes = await fetch(
          `${API}/api/bucket_list?eq_status=sent&eq_sent_to_username=${encodeURIComponent(myUsername)}&order=sent_at.desc&limit=10`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (bucketRes.ok) {
          const buckets = await bucketRes.json();
          const sentItems = Array.isArray(buckets) ? buckets : [];
          if (sentItems.length > 0 && (!incomingBatch || incomingBatch._bucketToast)) {
            // group by sent_at+sender เป็น 1 toast
            const firstItem = sentItems[0];
            const sameGroup = sentItems.filter(b =>
              b.sent_to_username === firstItem.sent_to_username &&
              b.created_by === firstItem.created_by
            );
            const toastData = {
              id: `bucket-toast-${firstItem.sent_at || firstItem.id}`,
              _bucketToast: true,
              requester_name: firstItem.created_by || 'ผู้ส่ง',
              note: firstItem.sent_note || '',
              detail: JSON.stringify({
                ids: sameGroup.map(b => b.id),
                count: sameGroup.length,
                note: firstItem.sent_note || '',
              }),
            };
            if (!incomingBatch || incomingBatch.id !== toastData.id) {
              setIncomingBatch(toastData);
            }
          } else if (sentItems.length === 0 && incomingBatch?._bucketToast) {
            setIncomingBatch(null);
          }
        }
      }
    } catch (err) { console.error('fetchRequests error:', err); }
  };

  useEffect(() => {
    if (!currentUser) return;
    const checkMaintenance = async () => {
      try {
        const { data } = await db.from('system_settings').select('key, value').in('key', ['maintenance_mode', 'maintenance_menus']);
        if (data) {
          const fullMode = data.find(d => d.key === 'maintenance_mode');
          const menusRow = data.find(d => d.key === 'maintenance_menus');
          if (fullMode?.value === 'true' && !isOwner) { await logout(); return; }
          try { setMaintenanceMenus(JSON.parse(menusRow?.value || '[]')); } catch { setMaintenanceMenus([]); }
        }
      } catch (err) { console.error('maintenance check error:', err); }
    };
    checkMaintenance();
    const interval = setInterval(checkMaintenance, 30000);
    return () => clearInterval(interval);
  }, [currentUser, isOwner]);

  const handleApprove = async (req) => {
    try {
      const token = sessionStorage.getItem('fastapn_token');
      if (req.request_type === 'signup') {
        const res = await fetch(`${API}/api/auth/approve-signup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ userId: req.ref_user_id, action: 'approve' }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
        // ── กัน Bug ค้างเกิน 24 ชม.: Signup ก็ต้อง Set handled_at ด้วย ไม่ใช่พึ่ง Backend อย่างเดียว ──
        await db.from('access_requests').update({
          status: 'approved', handled_by: userName || currentUser?.email || '', handled_at: new Date().toISOString(),
        }).eq('id', req.id);
      } else {
        await db.from('doc_access_override').upsert({
          user_id: req.requester_id, folder_key: req.folder_key, allowed: true,
          updated_by: userName || currentUser?.email || '', updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,folder_key' });
        await db.from('access_requests').update({
          status: 'approved', handled_by: userName || currentUser?.email || '', handled_at: new Date().toISOString(),
        }).eq('id', req.id);
        // ── Broadcast แบบ Real-time — ผู้ขอสิทธิ์ (login ค้างอยู่) เห็นผลทันที ──
        // ── ไม่ต้อง Logout/Login ใหม่ (เหมือน handleSaveFolder ใน UserManagement) ──
        broadcastWs('doc_access_updated', { folder_key: req.folder_key });
      }
      fetchRequests();
    } catch (err) { confirmDialog.alert('เกิดข้อผิดพลาด: ' + err.message, { variant: 'danger' }); }
  };

  const handleReject = async (req) => {
    try {
      const token = sessionStorage.getItem('fastapn_token');
      if (req.request_type === 'signup') {
        const res = await fetch(`${API}/api/auth/approve-signup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ userId: req.ref_user_id, action: 'reject' }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
        // ── กัน Bug ค้างเกิน 24 ชม.: Signup ก็ต้อง Set handled_at ด้วย ไม่ใช่พึ่ง Backend อย่างเดียว ──
        await db.from('access_requests').update({
          status: 'rejected', handled_by: userName || currentUser?.email || '', handled_at: new Date().toISOString(),
        }).eq('id', req.id);
      } else {
        await db.from('access_requests').update({
          status: 'rejected', handled_by: userName || currentUser?.email || '', handled_at: new Date().toISOString(),
        }).eq('id', req.id);
      }
      fetchRequests();
    } catch (err) { confirmDialog.alert('เกิดข้อผิดพลาด: ' + err.message, { variant: 'danger' }); }
  };

  useEffect(() => {
    if (!currentUser) return;
    const IDLE_TIMEOUT = 60 * 60 * 1000;
    let timer = null;
    const resetTimer = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => { await logout(); }, IDLE_TIMEOUT);
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach(e => window.addEventListener(e, resetTimer));
    resetTimer();
    return () => {
      if (timer) clearTimeout(timer);
      events.forEach(e => window.removeEventListener(e, resetTimer));
    };
  }, [currentUser]);

  // MARKER_FIX_HEARTBEAT_HOOKS_ORDER_V1
  // ── Heartbeat: เขียนว่ากำลังอยู่เมนูไหน ทุก 30 วิ (สำหรับกล่อง "ทีม" ที่ Home) ──
  // ── session_id = Username เอง -> Upsert ทับ Row เดิมเสมอ ไม่มี Row ซ้ำต่อคน ──
  // ── ต้องอยู่ "ก่อน" Early Return เสมอ (Rules of Hooks — เรียก Hook จำนวน ──
  // ── เท่ากันทุก Render) เช็ค currentUser ข้างในตัว Effect เอง ไม่ใช่ข้างนอก ──
  useEffect(() => {
    const me = userName || currentUser?.email || '';
    if (!me || !activePage) return;
    const beat = async () => {
      try {
        await db.from('menu_active_sessions').upsert(
          { session_id: me, menu_id: activePage, user_name: me, last_seen: new Date().toISOString() },
          { onConflict: 'session_id' }
        );
      } catch (e) { console.error('[menu heartbeat]', e); }
    };
    beat();
    const interval = setInterval(beat, 30000);
    return () => clearInterval(interval);
  }, [activePage, userName, currentUser]);

  if (!currentUser) return <Login />;

  const roleColor = { Owner: '#5DCAA5', Admin: '#e74c3c', Editor: '#0F6E56', Viewer: '#888' };
  // ── รวม Badge count จากทั้ง Access Request (pending) และ AP Period Notification (ยังไม่อ่าน) ──
  const pendingRequestCount = requests.filter(r => r.status === 'pending').length;
  const unreadApCount = apNotifications.filter(n => !n.is_read).length;
  const totalBadgeCount = pendingRequestCount + unreadApCount;
  const initial = (userName || currentUser.email || '?')[0].toUpperCase();

  const handleProfileIconClick = () => { selectPage('users'); };
  const clearCloseTimer = () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); };
  const startCloseTimer = () => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => { setSidebarExpanded(true); setOpenMenu(null); }, 300);
  };

  const handleSidebarEnter = () => { clearCloseTimer(); setSidebarExpanded(true); setOpenMenu(null); };
  const handleMasterEnter  = () => { clearCloseTimer(); setSidebarExpanded(false); setOpenMenu('master'); };
  const handleAPEnter      = () => { clearCloseTimer(); setSidebarExpanded(false); setOpenMenu('ap'); };
  const handleFlyoutEnter  = () => { clearCloseTimer(); };
  const handleVATEnter     = () => { clearCloseTimer(); setSidebarExpanded(false); setOpenMenu('vat'); };
  const handleMouseLeave   = () => { startCloseTimer(); };
  const selectPage = (id) => { setActivePage(id); setSidebarExpanded(true); setOpenMenu(null); };

  const ALL_FUNCTION_MENUS = [
    { id: 'ap-gr',         icon: '🧾', label: 'AP Controller',   permKey: 'Manual'   },
    { id: 'vat-controller',icon: '💹', label: 'VAT Controller',  permKey: 'VAT'   },
    { id: 'i-expense',     icon: '💸', label: 'I-Expense',       permKey: 'IE'    },
    { id: 'gl-functional', icon: '📊', label: 'GL Functional',   permKey: 'GL'    },
    { id: 'i-pro-interface',icon:'🔗', label: 'I-Pro Interface', permKey: 'I-Pro' },
  ];
  const FUNCTION_MENUS = isOwner
    ? ALL_FUNCTION_MENUS
    : ALL_FUNCTION_MENUS.filter(m => userPermissions?.[m.permKey] === true && !maintenanceMenus.includes(PAGE_MAINTENANCE_MAP[m.id] || m.id));

  // ── renderPage ───────────────────────────────────────────────────────────────
  const renderPage = () => {
    // ✅ Enforce maintenance mode for the CONTENT area too (not just the
    // sidebar). Owner is exempt so they can still verify / turn it off.
    const maintKey = PAGE_MAINTENANCE_MAP[activePage];
    if (maintKey && maintenanceMenus.includes(maintKey) && !isOwner) {
      return <MaintenancePage />;
    }
    switch (activePage) {
      // AP Controller
    case 'ap-gr':
      return (isEditor || userPermissions?.['Manual'])
        ? <APController
            activeSubTab={activePage.replace('ap-', '')}
            onSubTabChange={sub => setActivePage(`ap-${sub}`)}
            flyoutOpen={openMenu === 'ap'}
            initialHistoryTab={pendingHistoryTab}
          />
        : <NoAccessPage />;

    case 'ap-ocr':
      return (isEditor || userPermissions?.['Manual'])
        ? <APScanOCR />
        : <NoAccessPage />;

    case 'ap-form':
      return (isEditor || userPermissions?.['Manual'])
        ? <PlaceholderPage title="Purchase Order" icon="📝" />
        : <NoAccessPage />;

    case 'ap-drafts':
      return (isEditor || userPermissions?.['Manual'])
        ? <InvoiceHistoryPage currentUser={currentUser} userName={userName} isOwner={isOwner} isAdmin={isAdmin} />
        : <NoAccessPage />;

      // Functions (placeholder)
      case 'vat-incomplete-report':
      case 'vat-amagno-reconcile':
      case 'vat-popvat-report':
      case 'vat-simple-input-report':
        return (isOwner || userPermissions?.['VAT'])
          ? <VatController
              activeSubTab={activePage.replace('vat-', '')}
              onSubTabChange={sub => setActivePage(`vat-${sub}`)}
              flyoutOpen={openMenu === 'vat'}
            />
          : <NoAccessPage />;
      case 'i-expense':       return (isOwner || userPermissions?.['IE'])    ? <PlaceholderPage title="I-Expense" icon="💸" />       : <NoAccessPage />;
      case 'gl-functional':   return (isOwner || userPermissions?.['GL'])    ? <PlaceholderPage title="GL Functional" icon="📊" />   : <NoAccessPage />;
      case 'i-pro-interface': return (isOwner || userPermissions?.['I-Pro']) ? <PlaceholderPage title="I-Pro Interface" icon="🔗" /> : <NoAccessPage />;

      // Master Data
      case 'bu-info':         return <BusinessUnit activeSubTab="info"        onSubTabChange={sub => setActivePage(`bu-${sub}`)} />;
      case 'bu-branch':       return <BusinessUnit activeSubTab="branch"      onSubTabChange={sub => setActivePage(`bu-${sub}`)} />;
      case 'coa-costcenter':  return <ChartOfAccounts activeSubTab="costcenter"  onSubTabChange={sub => setActivePage(`coa-${sub}`)} flyoutOpen={openMenu === 'master'} />;
      case 'coa-account':     return <ChartOfAccounts activeSubTab="account"     onSubTabChange={sub => setActivePage(`coa-${sub}`)} flyoutOpen={openMenu === 'master'} />;
      case 'coa-subaccount':  return <ChartOfAccounts activeSubTab="subaccount"  onSubTabChange={sub => setActivePage(`coa-${sub}`)} flyoutOpen={openMenu === 'master'} />;
      case 'vendor-apcode':   return (isEditor && (userPermissions?.['VAT'] || userPermissions?.['Manual']))
        ? <VendorMaster activeSubTab="apcode"   onSubTabChange={sub => setActivePage(`vendor-${sub}`)} flyoutOpen={openMenu === 'master'} /> : <NoAccessPage />;
      case 'vendor-smcode':   return (isEditor && (userPermissions?.['VAT'] || userPermissions?.['Manual']))
        ? <VendorMaster activeSubTab="smcode"   onSubTabChange={sub => setActivePage(`vendor-${sub}`)} flyoutOpen={openMenu === 'master'} /> : <NoAccessPage />;
      case 'vendor-category': return (isEditor && (userPermissions?.['VAT'] || userPermissions?.['Manual']))
        ? <VendorMaster activeSubTab="category" onSubTabChange={sub => setActivePage(`vendor-${sub}`)} flyoutOpen={openMenu === 'master'} /> : <NoAccessPage />;
      case 'vendor-iecode':   return (isEditor && userPermissions?.['IE'])
        ? <VendorMaster activeSubTab="iecode"   onSubTabChange={sub => setActivePage(`vendor-${sub}`)} flyoutOpen={openMenu === 'master'} /> : <NoAccessPage />;
    case 'condition-rule': return (isOwner)
      ? <VendorMaster 
          activeSubTab="vendor_rule" 
          onSubTabChange={sub => setActivePage(sub === 'vendor_rule' ? 'condition-rule' : `vendor-${sub}`)} 
          flyoutOpen={openMenu === 'master'} /> : <NoAccessPage />;
        
      
      case 'itemcode':        return <ItemCodeList />;

      case 'upload':
      return (isOwner || hasAnyDocAccess)
        ? <UploadGen />
        : <NoAccessPage />;
      case 'users':           return <UserManagement />;
      case 'home':
      default:
        return <Homepage onOpenInbox={handleOpenInbox} />;
    }
  };

  const sidebarW = sidebarExpanded ? 220 : 56;

  // ── Sidebar helpers ──────────────────────────────────────────────────────────
  const navItem = (id, icon, label) => (
    <div key={id} onClick={() => selectPage(id)} title={!sidebarExpanded ? label : ''}
      style={{ height: '38px', display: 'flex', alignItems: 'center', justifyContent: sidebarExpanded ? 'flex-start' : 'center', padding: sidebarExpanded ? '0 16px' : '0', gap: '8px', cursor: 'pointer', fontSize: '13px', borderLeft: activePage === id ? '3px solid #5DCAA5' : '3px solid transparent', background: activePage === id ? 'rgba(255,255,255,0.1)' : 'transparent', color: activePage === id ? 'white' : 'rgba(255,255,255,0.7)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
      <span style={{ fontSize: '16px', flexShrink: 0 }}>{icon}</span>
      {sidebarExpanded && <span>{label}</span>}
    </div>
  );

  const fpSub = (id, icon, label) => {
    if (!isOwner && maintenanceMenus.includes(id)) return null;
    return (
      <div key={id} onClick={() => selectPage(id)}
        style={{ padding: '7px 16px 7px 36px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', borderLeft: activePage === id ? '3px solid #5DCAA5' : '3px solid transparent', background: activePage === id ? '#f0faf6' : 'transparent', color: activePage === id ? '#0F6E56' : '#555', fontWeight: activePage === id ? '500' : '400' }}>
        <span>{icon}</span> {label}
      </div>
    );
  };

  const fpItem = (id, icon, label) => (
    <div key={id} onClick={() => selectPage(id)}
      style={{ padding: '8px 16px', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', borderLeft: activePage === id ? '3px solid #5DCAA5' : '3px solid transparent', background: activePage === id ? '#f0faf6' : 'transparent', color: activePage === id ? '#0F6E56' : '#333', fontWeight: activePage === id ? '500' : '400' }}>
      <span>{icon}</span> {label}
    </div>
  );

  const fpGroup = (icon, label) => (
    <div style={{ padding: '8px 16px 3px', fontSize: '10px', fontWeight: '500', color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{icon} {label}</div>
  );

  const fpDiv = () => <div style={{ height: '0.5px', background: '#e8eaf0', margin: '4px 16px' }} />;

  const flyoutOpen = openMenu === 'master' || openMenu === 'ap' || openMenu === 'vat';

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif', overflow: 'clip' }}>

      <div ref={sidebarRef} style={{ position: 'relative', zIndex: 30, display: 'flex', flexShrink: 0 }} onMouseLeave={handleMouseLeave}>

        {/* ── Sidebar ── */}
        <div style={{ width: `${sidebarW}px`, minWidth: `${sidebarW}px`, background: '#1a3a5c', color: 'white', display: 'flex', flexDirection: 'column', transition: 'width 0.2s ease, min-width 0.2s ease', overflow: 'hidden', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>

          {/* Logo */}
          <div onMouseEnter={handleSidebarEnter} style={{ padding: sidebarExpanded ? '12px 16px' : '12px 0', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: sidebarExpanded ? 'flex-start' : 'center', gap: '10px', overflow: 'hidden', flexShrink: 0 }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#5DCAA5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: '700', color: '#1a3a5c', flexShrink: 0 }}>{initial}</div>
            {sidebarExpanded && (
              <div style={{ overflow: 'hidden' }}>
                <div style={{ fontSize: '15px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>FAST<span style={{ color: '#5DCAA5' }}>APN</span></div>
                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap' }}>{getBuildVersion()}</div>
              </div>
            )}
          </div>

          {/* Nav */}
          <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
            
            {navItem('home', '🏠', 'Home')}

            {sidebarExpanded && (
              <div style={{ padding: '6px 16px', fontSize: '11px', fontWeight: '600', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>Functions</div>
            )}

            {/* AP Controller — flyout trigger */}
            {(isOwner || (userPermissions?.['Manual'] && !maintenanceMenus.includes('ap-controller'))) && (
              <div onClick={handleAPEnter} title={!sidebarExpanded ? 'AP Controller' : ''}
                style={{ height: '38px', display: 'flex', alignItems: 'center', justifyContent: sidebarExpanded ? 'space-between' : 'center', padding: sidebarExpanded ? '0 16px' : '0', cursor: 'pointer', fontSize: sidebarExpanded ? '13px' : '16px', borderLeft: isAPActive || openMenu === 'ap-gr' ? '3px solid #5DCAA5' : '3px solid transparent', background: openMenu === 'ap' ? 'rgba(93,202,165,0.12)' : isAPActive ? 'rgba(255,255,255,0.08)' : 'transparent', color: isAPActive || openMenu === 'ap' ? '#5DCAA5' : 'rgba(255,255,255,0.7)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                {sidebarExpanded ? <><span>🧾 AP Controller</span><span style={{ fontSize: '10px' }}>▸</span></> : <span>🧾</span>}
              </div>
            )}

            {/* Other function menus (skip ap-gr and vat-controller, handled separately) */}
            {/* VAT Controller — flyout trigger */}
            {(isOwner || (userPermissions?.['VAT'] && !maintenanceMenus.includes('vat-controller'))) && (
              <div onClick={handleVATEnter} title={!sidebarExpanded ? 'VAT Controller' : ''}
                style={{ height: '38px', display: 'flex', alignItems: 'center', justifyContent: sidebarExpanded ? 'space-between' : 'center', padding: sidebarExpanded ? '0 16px' : '0', cursor: 'pointer', fontSize: sidebarExpanded ? '13px' : '16px', borderLeft: isVATActive || openMenu === 'vat' ? '3px solid #5DCAA5' : '3px solid transparent', background: openMenu === 'vat' ? 'rgba(93,202,165,0.12)' : isVATActive ? 'rgba(255,255,255,0.08)' : 'transparent', color: isVATActive || openMenu === 'vat' ? '#5DCAA5' : 'rgba(255,255,255,0.7)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                {sidebarExpanded ? <><span>💹 VAT Controller</span><span style={{ fontSize: '10px' }}>▸</span></> : <span>💹</span>}
              </div>
            )}
            {FUNCTION_MENUS.filter(m => m.id !== 'ap-gr' && m.id !== 'vat-controller').map(m => navItem(m.id, m.icon, m.label))}

            <div style={{ margin: '4px 8px', borderTop: '1px solid rgba(255,255,255,0.08)' }} />

            {/* Master Data — flyout trigger */}
            <div onClick={handleMasterEnter} title={!sidebarExpanded ? 'Master Data' : ''}
              style={{ height: '38px', display: 'flex', alignItems: 'center', justifyContent: sidebarExpanded ? 'space-between' : 'center', padding: sidebarExpanded ? '0 16px' : '0', cursor: 'pointer', fontSize: sidebarExpanded ? '11px' : '16px', fontWeight: '600', letterSpacing: '0.5px', textTransform: 'uppercase', borderLeft: isMasterActive || openMenu === 'master' ? '3px solid #5DCAA5' : '3px solid transparent', background: openMenu === 'master' ? 'rgba(93,202,165,0.12)' : isMasterActive ? 'rgba(255,255,255,0.08)' : 'transparent', color: isMasterActive || openMenu === 'master' ? '#5DCAA5' : 'rgba(255,255,255,0.7)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
              {sidebarExpanded ? <><span>📦 Master Data</span><span style={{ fontSize: '10px' }}>▸</span></> : <span>📦</span>}
            </div>

            <div style={{ margin: '4px 8px', borderTop: '1px solid rgba(255,255,255,0.08)' }} />
            {navItem('upload', '📁', 'Document Center')}
          </nav>

          {/* Bottom */}
          <div onMouseEnter={handleSidebarEnter} style={{ padding: sidebarExpanded ? '12px 16px' : '12px 0', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', alignItems: sidebarExpanded ? 'stretch' : 'center', gap: '8px', flexShrink: 0 }}>
            {sidebarExpanded ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userName || currentUser.email}</div>
                    <div style={{ fontSize: '11px', color: roleColor[userRole] || '#fff', fontWeight: '500' }}>{userRole}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    <button onClick={() => setShowBell(v => !v)}
                      style={{ background: showBell ? 'rgba(93,202,165,0.2)' : 'rgba(255,255,255,0.08)', border: `1px solid ${showBell ? '#5DCAA5' : 'rgba(255,255,255,0.2)'}`, borderRadius: '6px', width: '30px', height: '30px', cursor: 'pointer', color: showBell ? '#5DCAA5' : 'rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                      <BellIcon />
                      {totalBadgeCount > 0 && (
                        <span style={{ position: 'absolute', top: '-4px', right: '-4px', width: '16px', height: '16px', background: '#e74c3c', borderRadius: '50%', fontSize: '9px', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '500', border: '1.5px solid #1a3a5c' }}>
                          {Math.min(totalBadgeCount, 9)}
                        </span>
                      )}
                    </button>
                    <button onClick={handleProfileIconClick}
                      style={{ background: activePage === 'users' ? 'rgba(93,202,165,0.2)' : 'rgba(255,255,255,0.08)', border: `1px solid ${activePage === 'users' ? '#5DCAA5' : 'rgba(255,255,255,0.2)'}`, borderRadius: '6px', width: '30px', height: '30px', cursor: 'pointer', color: activePage === 'users' ? '#5DCAA5' : 'rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <UserIcon />
                    </button>
                  </div>
                </div>
                <button onClick={() => { setActivePage('home'); logout(); }} style={{ width: '100%', padding: '7px', background: 'rgba(192,57,43,0.15)', border: '1px solid rgba(192,57,43,0.4)', borderRadius: '6px', color: '#e74c3c', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                  <LogoutIcon /> Logout
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setShowBell(v => !v)}
                  style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', width: '32px', height: '32px', cursor: 'pointer', color: 'rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                  <BellIcon />
                  {totalBadgeCount > 0 && (
                    <span style={{ position: 'absolute', top: '-4px', right: '-4px', width: '8px', height: '8px', background: '#e74c3c', borderRadius: '50%', border: '1.5px solid #1a3a5c' }} />
                  )}
                </button>
                <button onClick={handleProfileIconClick}
                  style={{ background: activePage === 'users' ? 'rgba(93,202,165,0.2)' : 'rgba(255,255,255,0.08)', border: `1px solid ${activePage === 'users' ? '#5DCAA5' : 'rgba(255,255,255,0.2)'}`, borderRadius: '6px', width: '32px', height: '32px', cursor: 'pointer', color: activePage === 'users' ? '#5DCAA5' : 'rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <UserIcon />
                </button>
                <button onClick={logout}
                  style={{ background: 'rgba(192,57,43,0.15)', border: '1px solid rgba(192,57,43,0.4)', borderRadius: '6px', width: '32px', height: '32px', cursor: 'pointer', color: '#e74c3c', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <LogoutIcon />
                </button>
              </>
            )}
          </div>
        </div>

        {/* ── Flyout: AP Controller ── */}
        {openMenu === 'ap' && (
          <div onMouseEnter={handleFlyoutEnter} onMouseLeave={handleMouseLeave}
            style={{ position: 'absolute', left: '56px', top: 0, bottom: 0, width: '164px', background: 'white', borderRight: '0.5px solid #e8eaf0', zIndex: 20, display: 'flex', flexDirection: 'column', boxShadow: '4px 0 12px rgba(0,0,0,0.08)' }}>
            <div style={{ padding: '14px 16px 10px', borderBottom: '0.5px solid #e8eaf0' }}>
              <div style={{ fontSize: '13px', fontWeight: '500', color: '#1a3a5c' }}>🧾 AP Controller</div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0', scrollbarWidth: 'none' }}>
              {fpGroup('📥', 'Invoice Entry')}
              {fpSub('ap-gr',   '📋', 'AP Manual')}
              {fpSub('ap-ocr',  '🔍', 'Scan OCR')} 
              {fpSub('ap-form', '📝', 'Purchase Order')}
              {fpDiv()}
              {fpGroup('🗂️', 'จัดการ')}
              {fpSub('ap-drafts', '📄', 'Invoice History')}
            </div>
          </div>
        )}

        {/* ── Flyout: VAT Controller ── */}
        {openMenu === 'vat' && (
          <div onMouseEnter={handleFlyoutEnter} onMouseLeave={handleMouseLeave}
            style={{ position: 'absolute', left: '56px', top: 0, bottom: 0, width: '164px', background: 'white', borderRight: '0.5px solid #e8eaf0', zIndex: 20, display: 'flex', flexDirection: 'column', boxShadow: '4px 0 12px rgba(0,0,0,0.08)' }}>
            <div style={{ padding: '14px 16px 10px', borderBottom: '0.5px solid #e8eaf0' }}>
              <div style={{ fontSize: '13px', fontWeight: '500', color: '#1a3a5c' }}>💹 VAT Controller</div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0', scrollbarWidth: 'none' }}>
              {fpGroup('⚙️', 'Operation')}
              {fpSub('vat-incomplete-report',   '📋', 'Incomplete Report')}
              {fpSub('vat-amagno-reconcile',    '🔄', 'Amagno Reconcile')}
              {fpDiv()}
              {fpGroup('📊', 'Results')}
              {fpSub('vat-popvat-report',       '📊', 'Popvat Report')}
              {fpSub('vat-simple-input-report', '📄', 'Simple Input Report')}
            </div>
          </div>
        )}

        {/* ── Flyout: Master Data ── */}
        {openMenu === 'master' && (
          <div onMouseEnter={handleFlyoutEnter} onMouseLeave={handleMouseLeave}
            style={{ position: 'absolute', left: '56px', top: 0, bottom: 0, width: '164px', background: 'white', borderRight: '0.5px solid #e8eaf0', zIndex: 20, display: 'flex', flexDirection: 'column', boxShadow: '4px 0 12px rgba(0,0,0,0.08)' }}>
            <div style={{ padding: '14px 16px 10px', borderBottom: '0.5px solid #e8eaf0' }}>
              <div style={{ fontSize: '13px', fontWeight: '500', color: '#1a3a5c' }}>📦 Master Data</div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0', scrollbarWidth: 'none' }}>
              {fpGroup('🏢', 'Business Unit')}
              {fpSub('bu-info', '📋', 'Info')}
              {fpSub('bu-branch', '🏪', 'Branch')}
              {fpDiv()}
              {fpGroup('💰', 'Chart of Accounts')}
              {fpSub('coa-costcenter', '🏷️', 'Cost Center')}
              {fpSub('coa-account', '📒', 'Account')}
              {fpSub('coa-subaccount', '🔖', 'Sub Account')}
              {fpDiv()}
              {fpGroup('👥', 'Vendor Master')}
              {(isEditor && (userPermissions?.['VAT'] || userPermissions?.['Manual'])) && fpSub('vendor-apcode', '🏭', 'AP-Code')}
              {(isEditor && (userPermissions?.['VAT'] || userPermissions?.['Manual'])) && fpSub('vendor-smcode', '🔖', 'SM-Code')}
              {(isEditor && userPermissions?.['IE']) && fpSub('vendor-iecode', '💸', 'IE-Code')}
              {(isEditor && (userPermissions?.['VAT'] || userPermissions?.['Manual'])) && fpSub('vendor-category', '🗂️', 'Category')}
              {isOwner && fpSub('condition-rule', '📐', 'Condition / Rule')}
              {fpDiv()}
              {fpItem('itemcode', '🔖', 'Item Code')}
            </div>
          </div>
        )}
      </div>

      {/* ── Content area ── */}
      <div className="main-scroll" style={{ flex: 1, overflow: 'auto', background: '#f5f5f5', minWidth: 0, marginLeft: flyoutOpen ? '164px' : '0', transition: 'margin-left 0.2s ease' }}>
        {renderPage()}
      </div>

      {showBell && (
        <BellModal
          requests={requests} isOwner={isOwner} isAdmin={isAdmin}
          onApprove={handleApprove} onReject={handleReject}
          onClose={() => setShowBell(false)}
          onGoAccess={() => { selectPage('users'); setShowBell(false); }}
          apNotifications={apNotifications}
          onMarkApNotifRead={handleMarkApNotifRead}
          onClearOrphanSafe={handleClearOrphanSafe}
          onClosePeriod={handleClosePeriodFromBell}
        />
      )}
      {toast && (
        <div style={{ position: 'fixed', top: '16px', left: '50%', transform: 'translateX(-50%)', zIndex: 10000, padding: '10px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: '500', color: toast.type === 'success' ? '#27500A' : '#791F1F', background: toast.type === 'success' ? '#EAF3DE' : '#FCEBEB', border: `0.5px solid ${toast.type === 'success' ? '#c0dd97' : '#f7c1c1'}`, boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
          {toast.type === 'success' ? '✓ ' : '✕ '}{toast.message}
        </div>
      )}

      {incomingBatch && (
        <IncomingToast
          request={incomingBatch}
          currentUser={currentUser}
          userName={userName}
          onDismiss={(result) => {
            setIncomingBatch(null);
            if (result === 'accepted' || result === 'rejected') {
              fetchRequests();
              window.dispatchEvent(new CustomEvent('bucketAccepted', { detail: { result } }));
            }
          }}
        />
      )}
      <GlobalChatBubble currentUsername={userName || currentUser?.email || ''} />
    </div>
  );
}

function App() {
  return (
    <>
      {/* ── Mount ครั้งเดียวที่นี่ — ให้ confirmDialog.confirm()/alert() ────── */}
      {/* ── เรียกใช้ได้จากทุกไฟล์ในแอพ แทน window.confirm()/alert() เดิม ────── */}
      <ConfirmDialogHost />
      <AuthProvider>
        <DataCacheProvider>
          <MainApp />
        </DataCacheProvider>
      </AuthProvider>
    </>
  );
}

export default App;