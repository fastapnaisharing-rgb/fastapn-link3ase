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
import APController, { InvoiceHistoryPage, BatchControlPage } from './pages/APController'; // MARKER_APP_BATCH_CONTROL_PAGE_ROUTE
import APScanOCR from './pages/APScanOCR';
import VatController from './pages/VatController';
import './App.css';
import { useUserRole } from './contexts/useUserRole';
import { db } from './lib/db';
import { useRealtimeRefresh } from './useRealtimeRefresh';
import { broadcastWs } from './wsManager';
// MARKER_APP_BATCH_REVIEW_BELL_V1
import BatchChatDrawer from './pages/BatchChatDrawer';
import FilePreviewPopup from './FilePreviewPopup';
import { confirmDialog } from './confirmDialog';
import ConfirmDialogHost from './ConfirmDialogHost';
import { ALL_FUNCTION_MENUS, AP_CONTROLLER_MENU, VAT_CONTROLLER_MENU } from './menuConfig'; // MARKER_MENUCONFIG_SYNCED_AP_FLYOUT

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

// MARKER_APP_SUPPORT_BELL_UPGRADE_V1
// ── สีเดียวกับ SEVERITY_META ใน Homepage.js / SEVERITY_LEVELS ใน UploadGen.js ──
const SEVERITY_META = {
  incident:  { label: 'Incident',  color: '#791F1F', bg: '#FCEBEB' },
  important: { label: 'Important', color: '#8a4a00', bg: '#FDF0E0' },
  issue:     { label: 'Issue',     color: '#856404', bg: '#FAEEDA' },
  request:   { label: 'Request',   color: '#27500A', bg: '#EAF3DE' },
};

// MARKER_APP_BELLMODAL_SUPPORT_SECTION_V1
function BellModal({ requests, isOwner, isAdmin, onApprove, onReject, onClose, onGoAccess, apNotifications, onMarkApNotifRead, onClearOrphanSafe, onClosePeriod, onGotoBatch, onOpenChatBatch, onRejectBatch, onPreviewFile, onDismissHandled, onDismissSupportNotif, bellRef, onGotoUpload, currentUsername }) {
  // MARKER_APP_BELL_AGREEMENT_SYSTEM_V1
  const [supportPopupAgreeing, setSupportPopupAgreeing] = useState(false);
  const [supportPopupDisagreeing, setSupportPopupDisagreeing] = useState(false);

  const handleSupportPopupAgree = async () => {
    if (!supportPopup) return;
    setSupportPopupAgreeing(true);
    try {
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${API}/api/support/threads/${supportPopup.thread.id}/agree`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!data.ok) { alert('Agree ไม่สำเร็จ: ' + (data.error || '')); setSupportPopupAgreeing(false); return; }
      // MARKER_APP_BELL_AGREE_INSTANT_DISMISS_V1 -- เคลียร์ออกจาก List ทันที ไม่ต้องรอ Poll
      onDismissSupportNotif?.(supportPopup.notifId);
      // MARKER_APP_BELL_AGREEMENT_SYNC_V1 -- Broadcast ให้ Home/UploadGen Sync ทันที
      broadcastWs('support_agreement_updated', { threadId: supportPopup.thread.id });
      setSupportPopup(null);
    } catch (err) { alert('Agree ไม่สำเร็จ: ' + err.message); }
    setSupportPopupAgreeing(false);
  };

  const handleSupportPopupDisagree = async () => {
    if (!supportPopup) return;
    setSupportPopupDisagreeing(true);
    try {
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${API}/api/support/threads/${supportPopup.thread.id}/disagree`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!data.ok) { alert('Disagree ไม่สำเร็จ: ' + (data.error || '')); setSupportPopupDisagreeing(false); return; }
      // MARKER_APP_BELL_AGREEMENT_SYNC_V1 -- ยังไม่ Commit จริง (Backend แค่ตรวจสอบ+คืนข้อมูล)
      // ── ต้อง Submit กระทู้ใหม่ที่ UploadGen.js สำเร็จก่อนถึงจะ Commit จริง (Disagree ยกเลิกได้) ──
      // ── ไม่เคลียร์ Notification ที่นี่แล้ว เพราะยังไม่ได้ตัดสินใจจริง (กด Cancel ได้) ──────────
      sessionStorage.setItem('pendingDisagreeRef', JSON.stringify({ logNumber: data.refLogNumber, title: data.refTitle, menuSource: data.refMenuSource, threadId: data.refThreadId }));
      setSupportPopup(null);
      onGotoUpload?.();
    } catch (err) { alert('Disagree ไม่สำเร็จ: ' + err.message); }
    setSupportPopupDisagreeing(false);
  };

  const isAgreementWindowOpen = (thread) => {
    if (!thread?.resolved_at) return false;
    const hoursSince = (Date.now() - new Date(thread.resolved_at).getTime()) / (1000 * 60 * 60);
    return hoursSince < 72; // 3 วัน
  };
  // MARKER_APP_BELL_DROPDOWN_STYLE_V1
  // ── คำนวณตำแหน่งกล่อง Dropdown จากตำแหน่งจริงของปุ่มกระดิ่ง (bellRef) ──
  const [dropdownPos, setDropdownPos] = useState(null); // { bottom, left }
  useEffect(() => {
    if (bellRef?.current) {
      const rect = bellRef.current.getBoundingClientRect();
      setDropdownPos({ bottom: window.innerHeight - rect.top + 8, left: rect.left });
    }
  }, [bellRef]);

  // MARKER_APP_BELL_LIST_5ITEMS_FIX_V1
  // ── Fix Height คำนวณจากขนาดการ์ดจริง (Padding 28px + เนื้อหา ~3 บรรทัด ~58px = 86px/การ์ด) x 5 ──
  const bellListRef = useRef(null);
  const bellListMaxHeight = 430;
  const [supportPopup, setSupportPopup] = useState(null); // { notifId, thread }
  const [supportPopupLoading, setSupportPopupLoading] = useState(false);
  const [supportPopupComments, setSupportPopupComments] = useState([]);
  const [supportPopupImages, setSupportPopupImages] = useState([]);
  const [supportPopupImageUrls, setSupportPopupImageUrls] = useState({});
  const [supportPopupLightboxUrl, setSupportPopupLightboxUrl] = useState(null);
  const [supportPopupReplyText, setSupportPopupReplyText] = useState('');
  const [supportPopupSending, setSupportPopupSending] = useState(false);
  const [supportPopupFinishing, setSupportPopupFinishing] = useState(false);
  const [supportPopupRejecting, setSupportPopupRejecting] = useState(false);
  // MARKER_APP_BELL_POPUP_RESIZABLE_V1
  const [isPopupExpanded, setIsPopupExpanded] = useState(false);
  // MARKER_APP_BELL_POPUP_RESIZE_PERSIST_FIX_V1
  // ── ตั้งขนาดเริ่มต้นผ่าน Ref แค่ครั้งเดียวตอนเปิด Popup/สลับ Expand ──
  // ── ไม่ให้ width/height อยู่ใน Style Object ที่ Reconcile ทุก Re-render (กัน Resize ที่ลากไว้โดนรีเซ็ต) ──
  const popupBoxRef = useRef(null);
  // MARKER_APP_BELL_POPUP_BACKDROP_CLOSE_FIX_V1
  const backdropMouseDownOnSelfRef = useRef(false);
  useEffect(() => {
    if (!popupBoxRef.current || !supportPopup) return;
    if (!isPopupExpanded) {
      popupBoxRef.current.style.width = '440px';
      popupBoxRef.current.style.height = '600px';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supportPopup?.notifId, isPopupExpanded]);

  const supportFmtTime = (ts) => {
    if (!ts) return '—';
    const d = new Date(ts);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };

  // MARKER_APP_BELL_SUPPORT_POPUP_IMAGES_V1
  // ── รูปภาพที่แนบมากับ Thread/Comment -- Backend ส่ง images มาให้อยู่แล้ว ──
  // ── เดิมไม่เคยดึง/Render เลย (ต่างจาก UploadGen.js ที่ทำถูกอยู่แล้ว) ─────────
  const loadSupportPopupImages = async (images) => {
    const token = sessionStorage.getItem('fastapn_token');
    const urls = {};
    for (const img of images) {
      try {
        const res = await fetch(`${API}/api/file-storage/${img.id}/view-image`, { headers: { Authorization: `Bearer ${token}` } });
        const blob = await res.blob();
        urls[img.id] = URL.createObjectURL(blob);
      } catch (err) { console.error('load support popup image error:', err); }
    }
    setSupportPopupImageUrls(urls);
    setSupportPopupImages(images);
  };

  const openSupportPopup = async (n) => {
    setSupportPopupLoading(true);
    setSupportPopupComments([]);
    setSupportPopupImages([]);
    setSupportPopupImageUrls({});
    setSupportPopupReplyText('');
    try {
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${API}/api/support/threads/${n.link_to}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.ok) {
        setSupportPopup({ notifId: n.id, thread: data.thread });
        setSupportPopupComments(data.comments || []);
        loadSupportPopupImages(data.images || []);
      }
    } catch (err) { console.error('load support thread error:', err); }
    setSupportPopupLoading(false);
  };

  const handleSupportPopupSend = async () => {
    if (!supportPopup || !supportPopupReplyText.trim()) return;
    setSupportPopupSending(true);
    try {
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${API}/api/support/threads/${supportPopup.thread.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: supportPopupReplyText.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setSupportPopupComments(prev => [...prev, data.comment]);
        setSupportPopupReplyText('');
        // MARKER_APP_BELL_COMMENT_BROADCAST_V1 -- แจ้ง Realtime ให้อีกฝ่าย (Home/Bell) Refresh ทันที
        broadcastWs('support_comment_added', { threadId: supportPopup.thread.id });
      } else {
        alert('ส่งข้อความไม่สำเร็จ: ' + (data.error || ''));
      }
    } catch (err) { alert('ส่งข้อความไม่สำเร็จ: ' + err.message); }
    setSupportPopupSending(false);
  };

  // MARKER_APP_BELL_ACCEPT_BUTTON_V1
  const [supportPopupAccepting, setSupportPopupAccepting] = useState(false);
  const handleSupportPopupAccept = async () => {
    if (!supportPopup) return;
    setSupportPopupAccepting(true);
    try {
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${API}/api/support/threads/${supportPopup.thread.id}/start-process`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.ok) {
        // MARKER_APP_BELL_ACCEPT_SYNC_V1 -- Broadcast ให้ Home/UploadGen Sync ทันที
        broadcastWs('support_thread_status_updated', { threadId: supportPopup.thread.id });
        setSupportPopup(prev => prev ? { ...prev, thread: { ...prev.thread, status: 'in_process' } } : prev);
      } else {
        alert('Accept ไม่สำเร็จ: ' + (data.error || ''));
      }
    } catch (err) { alert('Accept ไม่สำเร็จ: ' + err.message); }
    setSupportPopupAccepting(false);
  };

  const handleSupportPopupResolve = async () => {
    if (!supportPopup) return;
    // MARKER_APP_BELL_CONFIRMDIALOG_STYLE_V1
    if (!(await confirmDialog.confirm('ยืนยันปิดกระทู้นี้เป็น Resolve?', { confirmText: 'Resolve' }))) return;
    setSupportPopupFinishing(true);
    try {
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${API}/api/support/threads/${supportPopup.thread.id}/finish`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.ok) {
        // MARKER_APP_BELL_RESOLVE_SYNC_FIX_V1 -- Broadcast ให้ Home/UploadGen/List Sync ทันที (เดิมขาดหาย)
        broadcastWs('support_thread_status_updated', { threadId: supportPopup.thread.id });
        setSupportPopup(prev => prev ? { ...prev, thread: { ...prev.thread, status: 'resolved' } } : prev);
      } else {
        alert('ปิดกระทู้ไม่สำเร็จ: ' + (data.error || ''));
      }
    } catch (err) { alert('ปิดกระทู้ไม่สำเร็จ: ' + err.message); }
    setSupportPopupFinishing(false);
  };

  // MARKER_APP_BELL_TESTING_FLOW_V1
  const [supportPopupSendingToTest, setSupportPopupSendingToTest] = useState(false);
  const [supportPopupConfirmingResolve, setSupportPopupConfirmingResolve] = useState(false);
  const [supportPopupRejectingTest, setSupportPopupRejectingTest] = useState(false);

  const handleSupportPopupSendToTest = async () => {
    if (!supportPopup) return;
    if (!(await confirmDialog.confirm('ส่งกระทู้นี้ให้ผู้แจ้งไป Test ก่อนใช่ไหม?', { confirmText: 'ส่งให้ Test' }))) return;
    setSupportPopupSendingToTest(true);
    try {
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${API}/api/support/threads/${supportPopup.thread.id}/send-to-test`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.ok) {
        // MARKER_APP_BELL_SENDTOTEST_SYNC_FIX_V1 -- Broadcast ให้ Home/UploadGen/List Sync ทันที (เดิมขาดหาย)
        broadcastWs('support_thread_status_updated', { threadId: supportPopup.thread.id });
        setSupportPopup(prev => prev ? { ...prev, thread: { ...prev.thread, status: 'testing' } } : prev);
      } else {
        alert('ส่งให้ Test ไม่สำเร็จ: ' + (data.error || ''));
      }
    } catch (err) { alert('ส่งให้ Test ไม่สำเร็จ: ' + err.message); }
    setSupportPopupSendingToTest(false);
  };

  // ── ผู้แจ้งกระทู้ Confirm ว่า Test ผ่าน -> Resolve ทันที ──
  const handleSupportPopupConfirmResolve = async () => {
    if (!supportPopup) return;
    if (!(await confirmDialog.confirm('ยืนยันว่างานเสร็จสมบูรณ์ ปิดกระทู้นี้เลยใช่ไหม?', { confirmText: 'Confirm' }))) return;
    setSupportPopupConfirmingResolve(true);
    try {
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${API}/api/support/threads/${supportPopup.thread.id}/request-resolve`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.ok) {
        // MARKER_APP_BELL_CONFIRMRESOLVE_SYNC_FIX_V1 -- Broadcast ให้ Home/UploadGen/List Sync ทันที (เดิมขาดหาย -- นี่คือจุดที่ผู้ใช้แจ้งบั๊กเข้ามา)
        broadcastWs('support_thread_status_updated', { threadId: supportPopup.thread.id });
        setSupportPopup(prev => prev ? { ...prev, thread: { ...prev.thread, status: 'resolved' } } : prev);
      } else {
        alert('Resolve ไม่สำเร็จ: ' + (data.error || ''));
      }
    } catch (err) { alert('Resolve ไม่สำเร็จ: ' + err.message); }
    setSupportPopupConfirmingResolve(false);
  };

  const handleSupportPopupRejectTest = async () => {
    if (!supportPopup) return;
    const reason = window.prompt('ระบุเหตุผลที่ Test ไม่ผ่าน (บังคับกรอก):');
    if (reason === null) return;
    if (!reason.trim()) { alert('กรุณากรอกเหตุผล'); return; }
    setSupportPopupRejectingTest(true);
    try {
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${API}/api/support/threads/${supportPopup.thread.id}/reject-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        // MARKER_APP_BELL_REJECTTEST_SYNC_FIX_V1 -- Broadcast ให้ Home/UploadGen/List Sync ทันที (เดิมขาดหาย)
        broadcastWs('support_thread_status_updated', { threadId: supportPopup.thread.id });
        setSupportPopup(prev => prev ? { ...prev, thread: { ...prev.thread, status: 'in_process' } } : prev);
      } else {
        alert('ตีกลับไม่สำเร็จ: ' + (data.error || ''));
      }
    } catch (err) { alert('ตีกลับไม่สำเร็จ: ' + err.message); }
    setSupportPopupRejectingTest(false);
  };

  const handleSupportPopupReject = async () => {
    if (!supportPopup) return;
    if (!(await confirmDialog.confirm('ยืนยัน Reject กระทู้นี้?', { variant: 'danger', confirmText: 'Reject' }))) return;
    setSupportPopupRejecting(true);
    try {
      const token = sessionStorage.getItem('fastapn_token');
      const res = await fetch(`${API}/api/support/threads/${supportPopup.thread.id}/reject`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.ok) {
        // MARKER_APP_BELL_REJECT_SYNC_FIX_V1 -- Broadcast ให้ Home/UploadGen/List Sync ทันที (เดิมขาดหาย)
        broadcastWs('support_thread_status_updated', { threadId: supportPopup.thread.id });
        setSupportPopup(prev => prev ? { ...prev, thread: { ...prev.thread, status: 'resolved', resolution_type: 'rejected' } } : prev);
      } else {
        alert('Reject กระทู้ไม่สำเร็จ: ' + (data.error || ''));
      }
    } catch (err) { alert('Reject กระทู้ไม่สำเร็จ: ' + err.message); }
    setSupportPopupRejecting(false);
  };

  // MARKER_APP_BELL_SUPPORT_DISMISS_SCOPE_FIX_V1
  // ── ปิด Chat = ถือว่าอ่านจบแล้ว -- ลบ Notification ฝั่งตัวเองสำหรับ Thread นี้ ──
  // ── FIX: setApNotifications อยู่คนละ Scope กับ BellModal (Compile Error) ──
  // ── ต้องส่งผ่าน onDismissSupportNotif Callback Prop แทนเรียก Setter ตรงๆ ──────
  const handleSupportPopupClose = async () => {
    const threadId = supportPopup?.thread?.id;
    const threadStatus = supportPopup?.thread?.status;
    setSupportPopup(null);
    if (!threadId) return;
    // MARKER_APP_BELL_CLOSE_DISMISS_ACTION_SCOPE_FIX_V1
    // ── resolved (รอ Agree/Disagree) / testing (รอ Confirm/ไม่ผ่าน Test) ──
    // ── ต้องรอ Action จริงเท่านั้นถึงจะหายจาก Bell -- ปิดเฉยๆ ไม่ Dismiss ──────
    if (threadStatus === 'resolved' || threadStatus === 'testing') return;
    try {
      const token = sessionStorage.getItem('fastapn_token');
      await fetch(`${API}/api/support/threads/${threadId}/dismiss`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      onDismissSupportNotif?.(threadId, { byThreadId: true });
      broadcastWs('support_dismissed', { threadId });
    } catch (err) { console.error('dismiss error:', err); }
  };

  const handleSupportNotifConfirm = () => {
    if (!supportPopup) return;
    onDismissSupportNotif?.(supportPopup.notifId);
    setSupportPopup(null);
  };
  const pendingCount = requests.filter(r => r.status === 'pending').length;
  // MARKER_APP_BELL_BATCH_REVIEW_TIMEOUT_V1
  // MARKER_APP_BELL_BATCH_REVIEW_NO_TIMEOUT_V1
  // ── แก้ Bug: เดิม batch_review หมดอายุ 2 ชม. ทั้งที่ยังไม่ได้ Action จริง ──────
  // ── ทำให้ Bell กับ Badge/Home ไม่ตรงกัน (Badge ยังนับ 1 แต่ List ไม่โชว์) ──────
  // ── เอา Timeout ออก -- ค้างจนกว่าจะมี Action จริง (Approve/Reject) เหมือน Home ──
  const pendingReqs = requests.filter(r => r.status === 'pending');
  // ── แก้ Bug: เดิมไม่มี Filter 24 ชม. เลย ทำให้ Request เก่าค้างอยู่ตลอดไป ──
  const handledReqs = requests.filter(r => {
    if (r.status === 'pending') return false;
    if (!r.handled_at) return true; // กันกรณีไม่มี handled_at (Bug เดิม) ให้โชว์ไปก่อน
    const hoursSinceHandled = (Date.now() - new Date(r.handled_at).getTime()) / (1000 * 60 * 60);
    // MARKER_APP_BELL_BATCHREVIEW_24H_UNIFY_V1
    // ── batch_review ใช้ 24 ชม. เท่ากับ Type อื่นทั้งหมด (Confirm แล้ว) ──────────────
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
    // MARKER_APP_NOTIF_1HOUR_V1
    const hoursSinceHandled = (Date.now() - new Date(req.handled_at).getTime()) / (1000*60*60);
    return hoursSinceHandled < 1; // แสดงเฉพาะที่ยังไม่เกิน 1 ชม.
  });

  // ── แยก Notification ตาม category — AP Period / Orphan ปลอดภัย / System Alert (RAM) แสดงคนละ Section ──
  const apPeriodNotifs = (apNotifications || []).filter(n => n.category !== 'RAM_ANOMALY' && n.category !== 'RAM_ORPHAN_SAFE' && n.category !== 'support-feedback');
  const orphanSafeNotifs = (apNotifications || []).filter(n => n.category === 'RAM_ORPHAN_SAFE');
  const ramNotifs = (apNotifications || []).filter(n => n.category === 'RAM_ANOMALY');
  const supportFeedbackNotifs = (apNotifications || []).filter(n => n.category === 'support-feedback');

  // MARKER_APP_SUPPORT_BELL_LIST_REVERT_V1
  return (
    <div onClick={onClose} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'transparent', zIndex: 999 }}>
      <div onClick={e => e.stopPropagation()} style={{
        position: 'fixed',
        bottom: dropdownPos ? `${dropdownPos.bottom}px` : '76px',
        left: dropdownPos ? `${dropdownPos.left}px` : '68px',
        background: 'white', borderRadius: '12px', border: '0.5px solid #e0e0e0', boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        width: '380px', maxHeight: '70vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
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
        <style>{`.bell-list-hide-scrollbar::-webkit-scrollbar { display: none; }`}</style>
        {/* MARKER_APP_BELL_LIST_MIN_HEIGHT_V1 -- คงพื้นที่ 5 Row เสมอแม้ไม่มี Notification */}
        <div ref={bellListRef} className="bell-list-hide-scrollbar" style={{ overflowY: 'auto', minHeight: `${bellListMaxHeight}px`, maxHeight: `${bellListMaxHeight}px`, scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {visibleRequests.length === 0 && apPeriodNotifs.length === 0 && orphanSafeNotifs.length === 0 && ramNotifs.length === 0 && supportFeedbackNotifs.length === 0 && (
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
                const isBatchReview = req.request_type === 'batch_review';
                const batchIdForReview = (req.ref_batch_ids || [])[0];
                const folderLabel = DOC_FOLDER_LABELS[req.folder_key] || req.folder_key;
                const initial = (req.requester_name || '?')[0].toUpperCase();
                const title = isSignup
                  ? `${req.requester_name} ขอสมัครเข้าใช้งานระบบ`
                  : isBatchTransfer
                    ? `${req.requester_name} ส่ง Batch มาให้ (${(req.ref_batch_ids || []).length} invoices)`
                    : isBatchReview
                      ? `${req.requester_name} ส่ง Batch ${batchIdForReview} มาให้ตรวจ`
                      : (isOwner ? `${req.requester_name} ขอสิทธิ์เข้า ${folderLabel}` : `คำขอเข้า ${folderLabel}`);
                return (
                  <div key={req.id} style={{ padding: '14px 18px', borderBottom: '0.5px solid #f0f0f0', background: '#f8fbff' }}>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                      <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: isSignup ? '#EAF3DE' : '#e8f0fb', color: isSignup ? '#27500A' : '#0C447C', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: '500', flexShrink: 0 }}>{initial}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          onClick={isBatchReview ? () => onGotoBatch?.(batchIdForReview) : undefined}
                          style={{ fontSize: '13px', fontWeight: '500', color: isBatchReview ? '#0C447C' : '#1a3a5c', marginBottom: '2px', cursor: isBatchReview ? 'pointer' : 'default', textDecoration: isBatchReview ? 'underline' : 'none', textUnderlineOffset: '2px' }}
                        >
                          {isSignup && <span style={{ fontSize: '10px', background: '#EAF3DE', color: '#27500A', padding: '1px 6px', borderRadius: '20px', marginRight: '6px', textDecoration: 'none', display: 'inline-block' }}>สมัครใหม่</span>}
                          {isBatchReview && <span style={{ fontSize: '10px', background: '#E6F1FB', color: '#0C447C', padding: '1px 6px', borderRadius: '20px', marginRight: '6px', textDecoration: 'none', display: 'inline-block' }}>ส่งตรวจ</span>}
                          {title}
                        </div>
                        <div style={{ fontSize: '11px', color: '#888', marginBottom: (isOwner || isBatchReview) ? '10px' : '0' }}>
                          {req.requester_name} · {formatTime(req.created_at)}{isBatchReview ? ' · ยังไม่ Approve' : ''}
                        </div>
                        {isBatchReview && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', gap: '4px' }}>
                              <button onClick={() => onPreviewFile?.(req)} title="ดูไฟล์ Invoice Register" style={{ width: '28px', height: '28px', padding: 0, fontSize: '13px', borderRadius: '6px', border: '0.5px solid #ddd', background: 'white', cursor: 'pointer' }}>👁</button>
                              <button onClick={() => onOpenChatBatch?.(batchIdForReview)} title="Chat" style={{ width: '28px', height: '28px', padding: 0, fontSize: '13px', borderRadius: '6px', border: '0.5px solid #ddd', background: 'white', cursor: 'pointer' }}>💬</button>
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button onClick={() => onApprove(req)} style={{ fontSize: '12px', padding: '5px 14px', borderRadius: '6px', border: 'none', background: '#EAF3DE', color: '#27500A', cursor: 'pointer', fontWeight: '500' }}>อนุมัติ</button>
                              <button onClick={() => onRejectBatch?.(req)} style={{ fontSize: '12px', padding: '5px 14px', borderRadius: '6px', border: '0.5px solid #ddd', background: 'white', color: '#555', cursor: 'pointer' }}>ปฏิเสธ</button>
                            </div>
                          </div>
                        )}
                        {!isBatchReview && isOwner && (
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={() => onApprove(req)} style={{ fontSize: '12px', padding: '5px 14px', borderRadius: '6px', border: 'none', background: '#EAF3DE', color: '#27500A', cursor: 'pointer', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '4px' }}>✅ อนุมัติ</button>
                            <button onClick={() => onReject(req)} style={{ fontSize: '12px', padding: '5px 14px', borderRadius: '6px', border: '0.5px solid #ddd', background: 'white', color: '#555', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>❌ ปฏิเสธ</button>
                          </div>
                        )}
                        {!isBatchReview && !isOwner && (
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
                  // MARKER_APP_BELL_DISMISS_HANDLED_V1
                  // ── คลิก Notification ที่ "จัดการแล้ว" (แค่แจ้งเพื่อทราบ) -> หายทันที ──────
                  // ── รวม batch_review ด้วย (Confirm แล้วว่าเลิก Goto Batch -- แค่รับทราบก็พอ) ──
                  <div key={req.id}
                    onClick={() => onDismissHandled?.(req)}
                    title="คลิกเพื่อปิดการแจ้งเตือนนี้"
                    style={{ padding: '14px 18px', borderBottom: '0.5px solid #f0f0f0', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                      <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: '#f5f5f5', color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: '500', flexShrink: 0 }}>{initial}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', color: '#555', marginBottom: '4px' }}>
                          {/* MARKER_APP_BELL_HANDLED_MESSAGE_FALLBACK_V1 */}
                          {/* ── ใช้ req.message ตรงๆ ถ้ามี (เช่น batch_review) — เดิม Fallback ── */}
                          {/* ── ไปใช้ข้อความ "ขอสิทธิ์เข้า Folder" เสมอ ทั้งที่บาง Type ไม่เกี่ยว ── */}
                          {req.message || (isOwner ? `${req.requester_name} ขอสิทธิ์เข้า ${folderLabel}` : `คำขอเข้า ${folderLabel}`)}
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

          {/* ── Section: Support & Feedback ── */}
          {supportFeedbackNotifs.length > 0 && (
            <>
              <div style={{ padding: '6px 18px', background: '#f8f9fa', borderBottom: '0.5px solid #f0f0f0' }}>
                <span style={{ fontSize: '11px', fontWeight: '500', color: '#888', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Support & Feedback</span>
              </div>
              {supportFeedbackNotifs.map(n => (
                <div key={n.id} onClick={() => openSupportPopup(n)}
                  style={{ padding: '14px 18px', borderBottom: '0.5px solid #f0f0f0', cursor: 'pointer', background: '#f8fbff' }}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                    <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: n.action_type === 'resolved' ? '#EAF3DE' : '#E6F1FB', color: n.action_type === 'resolved' ? '#27500A' : '#0C447C', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', flexShrink: 0 }}>
                      {n.action_type === 'resolved' ? '✅' : '💬'}
                    </div>
                    {/* MARKER_APP_BELL_SEVERITY_BADGE_V1 -- Badge ระดับความสำคัญ (Incident/Important/Issue/Request) */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '13px', fontWeight: '500', color: '#1a3a5c' }}>{n.title}</span>
                        {n.thread_severity && (
                          <span style={{
                            fontSize: '9px', fontWeight: '600', padding: '1px 7px', borderRadius: '8px', flexShrink: 0,
                            background: n.thread_severity === 'incident' ? '#FCEBEB' : n.thread_severity === 'important' ? '#FDF0E0' : n.thread_severity === 'issue' ? '#FAEEDA' : '#EAF3DE',
                            color: n.thread_severity === 'incident' ? '#791F1F' : n.thread_severity === 'important' ? '#8a4a00' : n.thread_severity === 'issue' ? '#856404' : '#27500A',
                          }}>
                            {n.thread_severity === 'incident' ? 'Incident' : n.thread_severity === 'important' ? 'Important' : n.thread_severity === 'issue' ? 'Issue' : 'Request'}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '11px', color: '#888', margin: '2px 0' }}>{n.message}</div>
                      <div style={{ fontSize: '11px', color: '#aaa' }}>{formatTime(n.created_at)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
        <div style={{ padding: '12px 18px', borderTop: '0.5px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: '11px', color: '#aaa' }}>จัดการแล้วจะหายอัตโนมัติใน 1 ชม.</span>
          {isOwner && (
            <button onClick={onGoAccess} style={{ fontSize: '12px', padding: '5px 14px', borderRadius: '6px', border: '0.5px solid #1a3a5c', background: 'white', color: '#1a3a5c', cursor: 'pointer', fontWeight: '500' }}>
              ไป Access Control →
            </button>
          )}
        </div>
      </div>

      {/* MARKER_APP_BELL_POPUP_BACKDROP_CLOSE_FIX_V1 */}
      {supportPopup && (
        <div
          onMouseDown={(e) => { backdropMouseDownOnSelfRef.current = (e.target === e.currentTarget); }}
          onClick={(e) => { if (backdropMouseDownOnSelfRef.current && e.target === e.currentTarget) handleSupportPopupClose(); }}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div ref={popupBoxRef} onClick={e => e.stopPropagation()} style={isPopupExpanded ? {
            background: 'white', borderRadius: '12px', width: '90vw', height: '90vh', maxWidth: '90vw', maxHeight: '90vh',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          } : {
            background: 'white', borderRadius: '12px', minWidth: '320px', minHeight: '400px',
            maxWidth: '92vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'auto', resize: 'both',
          }}>
            {supportPopupLoading ? (
              <p style={{ fontSize: '13px', color: '#999', textAlign: 'center', margin: '40px 0' }}>กำลังโหลด...</p>
            ) : supportPopup.thread ? (
              <>
                <div style={{ padding: '16px 18px', borderBottom: '0.5px solid #eee', flexShrink: 0 }}>
                  {supportPopup.thread.log_number && (
                    <p style={{ fontSize: '10px', color: '#999', fontFamily: 'monospace', margin: '0 0 3px' }}>{supportPopup.thread.log_number}</p>
                  )}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
                    <p style={{ fontSize: '14px', fontWeight: '600', color: '#1a3a5c', margin: 0, flex: 1 }}>{supportPopup.thread.title}</p>
                    <button onClick={() => setIsPopupExpanded(v => !v)} title={isPopupExpanded ? 'ย่อกลับ' : 'ขยายเต็มจอ'}
                      style={{ background: 'none', border: 'none', fontSize: '14px', color: '#999', cursor: 'pointer', flexShrink: 0, lineHeight: 1, marginRight: '4px' }}>{isPopupExpanded ? '⤡' : '⤢'}</button>
                    <button onClick={handleSupportPopupClose} style={{ background: 'none', border: 'none', fontSize: '16px', color: '#999', cursor: 'pointer', flexShrink: 0, lineHeight: 1 }}>×</button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                    {/* MARKER_APP_BELL_TESTING_BADGE_ROLE_V1 -- testing แยก Text ตาม Role + สีฟ้า */}
                    <span style={{
                      display: 'inline-block', fontSize: '10px', padding: '2px 10px', borderRadius: '10px',
                      background: supportPopup.thread.status === 'new' ? '#FCEBEB' : supportPopup.thread.status === 'in_process' ? '#FAEEDA' : supportPopup.thread.status === 'testing' ? '#E3F2FD' : '#EAF3DE',
                      color: supportPopup.thread.status === 'new' ? '#791F1F' : supportPopup.thread.status === 'in_process' ? '#633806' : supportPopup.thread.status === 'testing' ? '#1565C0' : '#27500A',
                    }}>
                      {/* MARKER_APP_BELL_INPROCESS_LABEL_V1 */}
                      {supportPopup.thread.status === 'new' ? 'ใหม่' : supportPopup.thread.status === 'in_process' ? 'In process' : supportPopup.thread.status === 'testing' ? (isOwner ? 'Wait to Resolve' : 'Request to Test') : 'แก้ไขแล้ว'}
                    </span>
                    {supportPopup.thread.severity && SEVERITY_META[supportPopup.thread.severity] && (
                      <span style={{ fontSize: '9px', padding: '2px 8px', borderRadius: '10px', fontWeight: '500', background: SEVERITY_META[supportPopup.thread.severity].bg, color: SEVERITY_META[supportPopup.thread.severity].color }}>
                        {SEVERITY_META[supportPopup.thread.severity].label}
                      </span>
                    )}
                  </div>
                </div>

                {/* MARKER_APP_BELL_POPUP_CHAT_FLEX_V1 -- flex:1 แทน maxHeight Fix ให้เต็มพื้นที่เหลือเสมอ */}
                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '12px', background: '#fafbfc' }}>
                  <div style={{ display: 'flex', gap: '8px', maxWidth: '85%' }}>
                    <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: '#E6F1FB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: '500', color: '#0C447C', flexShrink: 0 }}>
                      {(supportPopup.thread.created_by || '?').slice(0, 2).toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '10px', color: '#999', marginBottom: '3px' }}>{supportPopup.thread.created_by} · {supportFmtTime(supportPopup.thread.created_at)}</div>
                      <div style={{ background: 'white', border: '0.5px solid #e8e8e8', borderRadius: '12px', borderTopLeftRadius: '3px', padding: '8px 10px' }}>
                        <div style={{ fontSize: '12px', color: '#333', whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>{supportPopup.thread.body}</div>
                        {/* MARKER_APP_BELL_SUPPORT_POPUP_IMAGES_V1 */}
                        {supportPopupImages.filter(img => !img.sub_ref_id).length > 0 && (
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                            {supportPopupImages.filter(img => !img.sub_ref_id).map(img => (
                              <img key={img.id} src={supportPopupImageUrls[img.id]} alt="แนบ" onClick={() => setSupportPopupLightboxUrl(supportPopupImageUrls[img.id])}
                                style={{ width: '90px', height: '64px', borderRadius: '8px', objectFit: 'cover', border: '0.5px solid #ddd', cursor: 'pointer' }}/>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* MARKER_HIDE_RESOLVE_COMMENT_OWNER_V1 -- Owner ไม่ต้องเห็น Comment Auto ตอน Resolve ตัวเอง (User อื่นเห็นปกติ) */}
                  {supportPopupComments.filter(c => !(isOwner && c.message === 'ดำเนินการเรียบร้อยแล้ว')).map(c => {
                    const isFromCreator = c.username === supportPopup.thread.created_by;
                    // MARKER_APP_BELL_SUPPORT_POPUP_IMAGES_V1
                    const commentImages = supportPopupImages.filter(img => img.sub_ref_id === c.id);
                    return (
                      <div key={c.id} style={{ display: 'flex', gap: '8px', maxWidth: '85%', marginLeft: isFromCreator ? '0' : 'auto', flexDirection: isFromCreator ? 'row' : 'row-reverse' }}>
                        <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: isFromCreator ? '#E6F1FB' : '#27500A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: '500', color: isFromCreator ? '#0C447C' : 'white', flexShrink: 0 }}>
                          {(c.username || '?').slice(0, 2).toUpperCase()}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '10px', color: '#999', marginBottom: '3px', textAlign: isFromCreator ? 'left' : 'right' }}>{c.username}{!isFromCreator ? ' (Owner)' : ''} · {supportFmtTime(c.created_at)}</div>
                          <div style={{
                            background: isFromCreator ? 'white' : '#27500A', border: isFromCreator ? '0.5px solid #e8e8e8' : 'none', borderRadius: '12px', padding: '8px 10px',
                            borderTopLeftRadius: isFromCreator ? '3px' : '12px', borderTopRightRadius: isFromCreator ? '12px' : '3px',
                          }}>
                            <div style={{ fontSize: '12px', color: isFromCreator ? '#333' : 'white', whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>{c.message}</div>
                        {commentImages.length > 0 && (
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                            {commentImages.map(img => (
                              <img key={img.id} src={supportPopupImageUrls[img.id]} alt="แนบ" onClick={() => setSupportPopupLightboxUrl(supportPopupImageUrls[img.id])}
                                style={{ width: '80px', height: '56px', borderRadius: '8px', objectFit: 'cover', border: isFromCreator ? '0.5px solid #ddd' : '0.5px solid rgba(255,255,255,0.4)', cursor: 'pointer' }}/>
                            ))}
                          </div>
                        )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {supportPopup.thread.status !== 'resolved' && (
                  <div style={{ padding: '12px 18px', borderTop: '0.5px solid #eee', flexShrink: 0 }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                      <textarea value={supportPopupReplyText} onChange={e => setSupportPopupReplyText(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSupportPopupSend(); } }}
                        rows={1} placeholder="พิมพ์ข้อความตอบกลับ..."
                        style={{ flex: 1, padding: '8px 12px', borderRadius: '16px', border: '0.5px solid #ddd', fontSize: '12px', boxSizing: 'border-box', resize: 'none' }} />
                      <button onClick={handleSupportPopupSend} disabled={supportPopupSending || !supportPopupReplyText.trim()}
                        style={{ fontSize: '12px', padding: '8px 16px', borderRadius: '16px', border: 'none', background: '#1a3a5c', color: 'white', cursor: 'pointer', opacity: (supportPopupSending || !supportPopupReplyText.trim()) ? 0.5 : 1, flexShrink: 0 }}>
                        {supportPopupSending ? '...' : 'ส่ง'}
                      </button>
                    </div>
                    {isOwner && (
                      <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {/* MARKER_APP_BELL_ACCEPT_BUTTON_V1 -- โชว์เฉพาะ Status ใหม่ */}
                        {supportPopup.thread.status === 'new' && (
                          <button onClick={handleSupportPopupAccept} disabled={supportPopupAccepting}
                            style={{ flex: 1, fontSize: '12px', padding: '7px', borderRadius: '8px', border: 'none', background: '#0C447C', color: 'white', cursor: 'pointer', opacity: supportPopupAccepting ? 0.6 : 1, fontWeight: '500' }}>
                            {supportPopupAccepting ? '...' : 'Accept'}
                          </button>
                        )}
                        <button onClick={handleSupportPopupResolve} disabled={supportPopupFinishing || supportPopupRejecting}
                          style={{ flex: 1, fontSize: '12px', padding: '7px', borderRadius: '8px', border: 'none', background: '#27500A', color: 'white', cursor: 'pointer', opacity: (supportPopupFinishing || supportPopupRejecting) ? 0.6 : 1, fontWeight: '500' }}>
                          {supportPopupFinishing ? '...' : '✓ Resolve'}
                        </button>
                        <button onClick={handleSupportPopupReject} disabled={supportPopupFinishing || supportPopupRejecting}
                          style={{ width: '70px', fontSize: '12px', padding: '7px', borderRadius: '8px', border: '0.5px solid #d9534f', background: 'white', color: '#d9534f', cursor: 'pointer', opacity: (supportPopupFinishing || supportPopupRejecting) ? 0.6 : 1, fontWeight: '500' }}>
                          {supportPopupRejecting ? '...' : 'Reject'}
                        </button>
                        {/* MARKER_APP_BELL_TESTING_FLOW_V1 -- ตัวเลือกเสริม ไม่บังคับ */}
                        {supportPopup.thread.status === 'in_process' && (
                          <button onClick={handleSupportPopupSendToTest} disabled={supportPopupSendingToTest}
                            style={{ flex: '1 1 100%', fontSize: '12px', padding: '7px', borderRadius: '8px', border: '0.5px solid #0C447C', background: 'white', color: '#0C447C', cursor: 'pointer', opacity: supportPopupSendingToTest ? 0.6 : 1, fontWeight: '500' }}>
                            {supportPopupSendingToTest ? '...' : 'ส่งให้ Test ก่อน'}
                          </button>
                        )}
                      </div>
                    )}
                    {/* MARKER_APP_BELL_TESTING_FLOW_V1 -- ผู้แจ้งกระทู้เอง Test อยู่ */}
                    {!isOwner && supportPopup.thread.status === 'testing' && supportPopup.thread.created_by === currentUsername && (
                      <div style={{ marginTop: '8px', display: 'flex', gap: '6px' }}>
                        <button onClick={handleSupportPopupConfirmResolve} disabled={supportPopupConfirmingResolve || supportPopupRejectingTest}
                          style={{ flex: 1, fontSize: '12px', padding: '7px', borderRadius: '8px', border: 'none', background: '#27500A', color: 'white', cursor: 'pointer', opacity: (supportPopupConfirmingResolve || supportPopupRejectingTest) ? 0.6 : 1, fontWeight: '500' }}>
                          {supportPopupConfirmingResolve ? '...' : '✓ Confirm - งานเสร็จสมบูรณ์'}
                        </button>
                        <button onClick={handleSupportPopupRejectTest} disabled={supportPopupConfirmingResolve || supportPopupRejectingTest}
                          style={{ fontSize: '12px', padding: '7px 10px', borderRadius: '8px', border: '0.5px solid #d9534f', background: 'white', color: '#d9534f', cursor: 'pointer', opacity: (supportPopupConfirmingResolve || supportPopupRejectingTest) ? 0.6 : 1, fontWeight: '500' }}>
                          ไม่ผ่าน
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {/* MARKER_APP_BELL_AGREEMENT_PERUSER_V1 -- เช็คคำตอบของตัวเอง ไม่เช็คระดับกระทู้ */}
                {!isOwner && supportPopup.thread.status === 'resolved' && !supportPopup.thread.myAgreementResponse && isAgreementWindowOpen(supportPopup.thread) && (
                  <div style={{ display: 'flex', gap: '8px', padding: '12px 18px', borderTop: '0.5px solid #eee', flexShrink: 0 }}>
                    <button onClick={handleSupportPopupAgree} disabled={supportPopupAgreeing || supportPopupDisagreeing}
                      style={{ flex: 1, fontSize: '12px', padding: '9px', borderRadius: '20px', border: 'none', background: '#27500A', color: 'white', cursor: 'pointer', opacity: (supportPopupAgreeing || supportPopupDisagreeing) ? 0.6 : 1, fontWeight: '500' }}>
                      {supportPopupAgreeing ? '...' : '✓ Agree'}
                    </button>
                    <button onClick={handleSupportPopupDisagree} disabled={supportPopupAgreeing || supportPopupDisagreeing}
                      style={{ flex: 1, fontSize: '12px', padding: '9px', borderRadius: '20px', border: '0.5px solid #d9534f', background: 'white', color: '#d9534f', cursor: 'pointer', opacity: (supportPopupAgreeing || supportPopupDisagreeing) ? 0.6 : 1, fontWeight: '500' }}>
                      {supportPopupDisagreeing ? '...' : 'Disagree'}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p style={{ fontSize: '13px', color: '#999', textAlign: 'center', margin: '20px 0' }}>ไม่พบกระทู้นี้ (อาจถูกลบไปแล้ว)</p>
            )}
            {/* MARKER_APP_BELL_REMOVE_FOOTER_PERMANENT_V1 -- เอาปุ่ม ปิด/Confirm ออกถาวร ใช้ × ที่หัว Popup ปิดอย่างเดียวพอ */}
          </div>
        </div>
      )}

      {/* MARKER_APP_BELL_SUPPORT_POPUP_LIGHTBOX_V1 */}
      {supportPopupLightboxUrl && (
        <div onClick={() => setSupportPopupLightboxUrl(null)}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', zIndex: 10010, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}>
          <img src={supportPopupLightboxUrl} alt="แนบ (ขยาย)" onClick={e => e.stopPropagation()}
            style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: '8px', boxShadow: '0 4px 30px rgba(0,0,0,0.5)' }}/>
          <button onClick={() => setSupportPopupLightboxUrl(null)}
            style={{ position: 'absolute', top: '20px', right: '20px', width: '36px', height: '36px', borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.9)', color: '#333', fontSize: '18px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>
      )}
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
  const [setupReturnPage, setSetupReturnPage] = useState(null);
  const [setupJumpToken, setSetupJumpToken] = useState(0);
  const goToOutlookSetup = () => { setSetupReturnPage(activePage); setSetupJumpToken(t => t + 1); setActivePage('upload'); };
  const backFromOutlookSetup = () => { if (setupReturnPage) { setActivePage(setupReturnPage); setSetupReturnPage(null); } };
  // MARKER_APP_OPEN_INBOX_FROM_NOTIF_V1
  // ── จำว่าต้องเปิด Tab ไหนใน APController หลัง Navigate มาจาก Notification ──
  const [pendingHistoryTab, setPendingHistoryTab] = useState(null);
  // MARKER_NOTIF_CLICK_TARGET_BY_AUDIENCE_V1
  const handleOpenInbox = (tab = 'inbox') => { setPendingHistoryTab(tab); setActivePage('ap-gr'); };
  const [showBell, setShowBell] = useState(false);
  const [requests, setRequests] = useState([]);
  // MARKER_APP_BATCH_REVIEW_BELL_V1
  const [rejectChatReq, setRejectChatReq] = useState(null); // { batch_id } สำหรับ Reject จาก Bell
  // MARKER_APP_BELL_REJECT_CHOICE_DIALOG_V1
  // ── เก็บ req เต็มไว้ ระหว่างรอเลือกว่าจะใส่ Comment หรือปฏิเสธเฉยๆ ──────
  const [rejectChoiceReq, setRejectChoiceReq] = useState(null);
  const [viewChatBatchId, setViewChatBatchId] = useState(null); // Batch ID สำหรับดู Chat อย่างเดียว
  const [previewFile, setPreviewFile] = useState(null); // { fileId, fileName }
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
    // MARKER_APP_POLL_INTERVAL_RELAX_V1 -- ยืดจาก 30 วิ เป็น 5 นาที
    // useRealtimeRefresh ด้านล่าง Refresh ทันทีอยู่แล้วตอนมี Event จริง
    // ตัวนี้เป็นแค่ Fallback กันเหตุการณ์ที่ WebSocket หลุดโดยไม่รู้ตัว
    const interval = setInterval(() => { fetchRequests(); fetchApNotifications(); }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [currentUser]);

  // ── Real-time: ฟัง broadcast 'bucket_sent'/'bucket_recalled' จาก server ────
  // ── ให้ Toast ขึ้น/หายทันที ไม่ต้องรอ Poll รอบ 30 วิด้านบน ─────────────────
  // ── ใช้ Shared WS Connection (wsManager) แทนเปิด Connection แยกของตัวเอง ──
  // MARKER_APP_ACCESS_REQUEST_LISTENER_V1
  // ── เพิ่ม 'access_request_new' — Signup ใหม่ (auth.js) + ขอสิทธิ์ Folder ──
  // ── ใหม่ (UploadGen.js) เห็นแบบ Real-time ไม่ต้องรอ Poll 30 วิ ──────────
  useRealtimeRefresh(['bucket_sent', 'bucket_recalled', 'access_request_new'], () => fetchRequests());
  // MARKER_APP_BELL_AGREEMENT_SYNC_V1 -- รับ Sync ตอน Agree/Disagree Commit จากหน้า Home หรือ UploadGen.js
  // MARKER_APP_BELL_ACCEPT_SYNC_V1 -- เพิ่ม Event Accept เข้ารายการเดิม
  useRealtimeRefresh(['support_agreement_updated', 'support_thread_status_updated', 'support_dismissed'], () => fetchApNotifications());

  // ── ดึง AP Period Notifications (Close Period / Override) เฉพาะ User ที่มี Permission Manual ──
  const fetchApNotifications = async () => {
    // MARKER_APP_FETCH_NOTIF_ALL_USERS_V1
    // ── เอา Gate Manual/Owner ออก -- Endpoint /api/ap/period/notifications คืน Support & Feedback
    // ── (และ RAM Alert อื่นๆ) ให้ทุก User ด้วย ไม่ใช่แค่ AP Period -- ฝั่ง Backend (apPeriod.js)
    // ── กรองตาม target_permission/target_role/recipient_username ให้ถูกคนอยู่แล้ว การ Gate
    // ── ที่นี่ซ้ำซ้อนและทำให้ User ที่ไม่มีสิทธิ์ Manual/ไม่ใช่ Owner ไม่เคยเห็น Notification ของตัวเองเลย
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
  // MARKER_APP_BELL_DISMISS_HANDLED_V1
  // ── คลิก Notification ที่ "จัดการแล้ว" (แค่แจ้งเพื่อทราบ เช่น Approve แล้ว) ──
  // ── ให้หายทันที ไม่ต้องรอ Auto-expire 1 ชม. เหมือน Pending ที่ต้อง Goto/Approve ก่อน ──
  const handleDismissNotif = async (req) => {
    setRequests(prev => prev.filter(r => r.id !== req.id));
    try {
      await db.from('access_requests').delete().eq('id', req.id);
    } catch (err) {
      console.error('[dismiss notif]', err);
    }
  };

  // ── กด Confirm ใน Bell (Support & Feedback) — ลบออกจาก List ทันที + เรียก Endpoint ลบจริง ──
  // ── รองรับ 2 แบบ: (1) notifId ตรงๆ จาก List "จัดการแล้ว" (2) threadId + ──
  // ── { byThreadId: true } จาก Popup Close -- Backend ลบไปแล้วจาก /dismiss ──
  // ── Endpoint ตอน Popup Close ไม่ต้องยิง DELETE ซ้ำอีก แค่ Filter Local ──────
  const handleDismissSupportNotif = async (idOrThreadId, opts) => {
    if (opts?.byThreadId) {
      setApNotifications(prev => prev.filter(n => n.link_to !== idOrThreadId));
      return;
    }
    setApNotifications(prev => prev.filter(n => n.id !== idOrThreadId));
    try {
      const token = sessionStorage.getItem('fastapn_token');
      await fetch(`${API}/api/support/notifications/${idOrThreadId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) { console.error('dismiss support notif error:', err); }
  };

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
      const myUsernameLower = (userName || currentUser?.email || '').trim().toLowerCase();
      setRequests(all.filter(r => {
        if (r.request_type === 'batch_transfer') return false;
        if (r.request_type === 'batch_review') {
          return String(r.target_username || '').trim().toLowerCase() === myUsernameLower;
        }
        return true;
      }));
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

  // MARKER_APP_MAINTENANCE_EVENT_V1
  // ── เดิม checkMaintenance ถูกประกาศซ้อนอยู่ใน useEffect เข้าถึงจากข้างนอกไม่ได้ ──
  // ── ย้ายออกมาเป็นฟังก์ชันระดับ Component เพื่อให้ useRealtimeRefresh เรียกได้ด้วย ──
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

  useEffect(() => {
    if (!currentUser) return;
    checkMaintenance();
    // MARKER_APP_POLL_INTERVAL_RELAX_V1 -- ยืดจาก 30 วิ เป็น 5 นาที
    // ตอนนี้มี useRealtimeRefresh('maintenance_mode_changed') คอยเช็คทันทีแล้ว
    // ตัวนี้เป็นแค่ Fallback กันเหตุการณ์ที่ WebSocket หลุดโดยไม่รู้ตัว
    const interval = setInterval(checkMaintenance, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [currentUser, isOwner]);

  // ── Real-time: ฟัง 'maintenance_mode_changed' -- Admin เพิ่ง Toggle Maintenance ──
  // ── Mode เช็คทันที ไม่ต้องรอ Poll รอบ Fallback ด้านบน (ฝั่งส่งต้องเพิ่มที่จุด ──
  // ── Admin Toggle เอง — ยังไม่มีไฟล์นั้นตอนนี้ รอ Patch แยกอีกจุด) ──────────
  useRealtimeRefresh(['maintenance_mode_changed'], () => checkMaintenance());

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
        // MARKER_APP_SIGNUP_BROADCAST_V1
        // ── Broadcast แบบ Real-time — Owner/Admin คนอื่นเห็น User ใหม่โผล่ ──
        // ── ในหน้า Users Tab ทันที ไม่ต้อง Refresh หน้าเอง (ฝั่งรับอยู่ที่ ──
        // ── UserManagement.js — subscribeWs('signup_approved')) ──────────
        broadcastWs('signup_approved', { user_id: req.ref_user_id });
      } else if (req.request_type === 'batch_review') {
        const batchId = (req.ref_batch_ids || [])[0];
        const meNow = userName || currentUser?.email || '';
        const nowIso = new Date().toISOString();
        // MARKER_APP_BELL_BATCH_UPDATE_ID_FIX_V1 -- ต้อง Update ด้วย id (Primary Key) เท่านั้น ใช้ batch_id ไม่ได้ (Silent Fail)
        const { data: batchRow } = await db.from('batch_list').select('id, bu, created_by').eq('batch_id', batchId).single();
        if (batchRow?.id) {
          await db.from('batch_list').update({
            status: 'approved', approved_at: nowIso,
          }).eq('id', batchRow.id);
        } else {
          console.error('[handleApprove] ไม่พบ batch_list.id สำหรับ batch_id:', batchId);
        }
        await db.from('access_requests').update({
          status: 'approved', handled_by: meNow, handled_at: nowIso,
        }).eq('id', req.id);
        // MARKER_APP_BELL_APPROVE_NOTIFY_BACK_V1
        // ── Bell กับหน้า Inbox หลัก เป็นคนละ Code Path กัน -- ต้องเพิ่ม Notify-back ──
        // ── (อ้างอิงเป็น BU) ให้ตรงกับที่ทำไว้ใน handleApproveReview แยกอีกจุด ──────
        try {
          await db.from('access_requests').insert([{
            request_type: 'batch_review', requester_name: meNow, target_username: batchRow?.created_by || '',
            ref_batch_ids: [batchId], status: 'approved', handled_by: meNow, handled_at: nowIso,
            created_at: nowIso,
            message: `อนุมัติ Batch ของ BU ${batchRow?.bu || '-'} เรียบร้อยแล้ว`,
          }]);
          broadcastWs('access_request_new', { target_username: batchRow?.created_by || '' });
        } catch (nErr) { console.error('[notify sender on approve from bell]', nErr); }
        broadcastWs('batch_approved', { batch_id: batchId });
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

  const handleGotoBatch = () => { handleOpenInbox('inbox'); setShowBell(false); };
  const handleOpenChatBatch = (batchId) => setViewChatBatchId(batchId);
  // MARKER_APP_BELL_REJECT_CHOICE_DIALOG_V1
  // ── เปิด Choice Dialog ("ใส่ Comment หรือไม่") ก่อนเสมอ -- แบบเดียวกับหน้า Inbox ──
  // ── หลัก (rejectChoiceBatch ใน APController.js) แทนที่จะเด้งเข้า Chat ตรงๆ ──────
  const handleRejectBatchFromBell = (req) => {
    setRejectChoiceReq(req);
  };
  const handleRejectChoiceComment = (req) => {
    setRejectChoiceReq(null);
    setRejectChatReq({ id: req.id, batch_id: (req.ref_batch_ids || [])[0] });
  };
  const handleRejectChoiceDirect = async (req) => {
    setRejectChoiceReq(null);
    await handleRejectConfirmedFromBell({ id: req.id, batch_id: (req.ref_batch_ids || [])[0] });
  };
  const handleRejectConfirmedFromBell = async (batch) => {
    try {
      const meNow = userName || currentUser?.email || '';
      const nowIso = new Date().toISOString();
      // MARKER_APP_BELL_BATCH_UPDATE_ID_FIX_V1 -- ต้อง Update ด้วย id (Primary Key) เท่านั้น ใช้ batch_id ไม่ได้ (Silent Fail)
      const { data: batchRow } = await db.from('batch_list').select('id, bu, created_by').eq('batch_id', batch.batch_id).single();
      if (batchRow?.id) {
        await db.from('batch_list').update({ status: 'rejected', approved_at: null }).eq('id', batchRow.id);
      } else {
        console.error('[handleRejectConfirmedFromBell] ไม่พบ batch_list.id สำหรับ batch_id:', batch.batch_id);
      }
      broadcastWs('batch_rejected', { batch_id: batch.batch_id });
      // MARKER_APP_BELL_REJECT_NOTIFY_BACK_V1
      // ── เดิมไม่เคย Update access_requests ของผู้รับเลย (ค้าง pending ตลอดไป) ──
      // ── และไม่เคยแจ้งกลับผู้ส่งด้วย -- เพิ่มให้ตรงกับ handleRejectReview ────────
      if (batch.id) {
        await db.from('access_requests').update({
          status: 'rejected', handled_by: meNow, handled_at: nowIso,
        }).eq('id', batch.id);
      }
      try {
        await db.from('access_requests').insert([{
          request_type: 'batch_review', requester_name: meNow, target_username: batchRow?.created_by || '',
          ref_batch_ids: [batch.batch_id], status: 'rejected', handled_by: meNow, handled_at: nowIso,
          created_at: nowIso,
          message: `ตีกลับ Batch ของ BU ${batchRow?.bu || '-'} — กรุณาตรวจสอบ`,
        }]);
        broadcastWs('access_request_new', { target_username: batchRow?.created_by || '' });
      } catch (nErr) { console.error('[notify sender on reject from bell]', nErr); }
    } catch (e) { console.error('[reject batch from bell]', e); }
    setRejectChatReq(null);
    fetchRequests();
  };
  const handlePreviewFileForReq = async (req) => {
    const batchId = (req.ref_batch_ids || [])[0];
    try {
      const { data } = await db.from('batch_list').select('invoice_register_file_id, invoice_register_file_name').eq('batch_id', batchId).single();
      if (!data?.invoice_register_file_id) { confirmDialog.alert('ยังไม่มีไฟล์สำหรับ Batch นี้'); return; }
      setPreviewFile({ fileId: data.invoice_register_file_id, fileName: data.invoice_register_file_name });
    } catch (e) { confirmDialog.alert('โหลดไฟล์ไม่สำเร็จ: ' + e.message, { variant: 'danger' }); }
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
    // MARKER_APP_TEAM_STATUS_REALTIME_LOGIN_V1 -- แจ้ง Home ให้ Refresh การ์ดทีมทันทีตอน Login/เปลี่ยนเมนู ไม่ต้องรอ Poll 30 วิ
    broadcastWs('team_status_updated', { username: me });
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

  // MARKER_MENUCONFIG_SYNCED_AP_FLYOUT — ALL_FUNCTION_MENUS มาจาก menuConfig.js แล้ว (ลบ Local Array ซ้ำออก)
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

    case 'ap-batchctrl':
      return (isEditor || userPermissions?.['Manual'])
        ? <BatchControlPage currentUser={currentUser} userName={userName} onGotoOutlookSetup={goToOutlookSetup} />
        : <NoAccessPage />;

      // Functions (placeholder)
      // MARKER_APP_VAT_ROUTING_RESTRUCTURE_V2 — 12 เมนู ตามโครงสร้างใหม่ (OPERATION/RECONCILE/RESULTS/BACKUP)
      case 'vat-watchlist-ops':
      case 'vat-reconcile-ap01-05':
      case 'vat-simple-input-ops':
      case 'vat-input-rec':
      case 'vat-suspense-rec':
      case 'vat-direct-debit-recon':
      case 'vat-timeline':
      case 'vat-dashboard':
      case 'vat-upload-file':
      case 'vat-monthly-report':
      case 'vat-backup-transaction':
      case 'vat-backup-tax-invoice':
        return (isOwner || userPermissions?.['VAT'])
          ? <VatController
              activeSubTab={activePage}
              onSubTabChange={sub => setActivePage(sub)}
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
        ? <UploadGen jumpToSetupToken={setupJumpToken} returnPage={setupReturnPage} onBackToCaller={backFromOutlookSetup} />
        : <NoAccessPage />;
      case 'users':           return <UserManagement />;
      case 'home':
      default:
        // MARKER_APP_HOMEPAGE_GOTOUPLOAD_PROP_V1
        return <Homepage onOpenInbox={handleOpenInbox} onGotoUpload={() => setActivePage('upload')} />;
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
            {navItem('upload', '📁', 'Resource Center')}
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
                    <button ref={bellRef} onClick={() => setShowBell(v => !v)}
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
                <button ref={bellRef} onClick={() => setShowBell(v => !v)}
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
              {/* MARKER_MENUCONFIG_SYNCED_AP_FLYOUT — Loop จาก menuConfig.js (AP_CONTROLLER_MENU.groups) เพิ่มเมนูใหม่ที่ menuConfig.js ที่เดียวพอ */}
              {AP_CONTROLLER_MENU.groups.map((g, gi) => (
                <React.Fragment key={g.label}>
                  {gi > 0 && fpDiv()}
                  {fpGroup(g.icon, g.label)}
                  {g.items.map(it => fpSub(it.id, it.icon, it.label))}
                </React.Fragment>
              ))}
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
              {/* MARKER_MENUCONFIG_SYNCED_AP_FLYOUT — Loop จาก menuConfig.js (VAT_CONTROLLER_MENU.groups) */}
              {VAT_CONTROLLER_MENU.groups.map((g, gi) => (
                <React.Fragment key={g.label}>
                  {gi > 0 && fpDiv()}
                  {fpGroup(g.icon, g.label)}
                  {g.items.map(it => fpSub(it.id, it.icon, it.label))}
                </React.Fragment>
              ))}
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
      <div className="main-scroll" style={{ flex: 1, overflow: activePage === 'upload' ? 'hidden' : 'auto', background: '#f5f5f5', minWidth: 0, marginLeft: flyoutOpen ? '164px' : '0', transition: 'margin-left 0.2s ease', display: activePage === 'upload' ? 'flex' : 'block', flexDirection: 'column' }}>
        {renderPage()}
      </div>

      {showBell && (
        <BellModal
          currentUsername={userName || currentUser?.email || ''}
          onGotoUpload={() => { setActivePage('upload'); setShowBell(false); }}
          bellRef={bellRef}
          requests={requests} isOwner={isOwner} isAdmin={isAdmin}
          onApprove={handleApprove} onReject={handleReject}
          onClose={() => setShowBell(false)}
          onGoAccess={() => { selectPage('users'); setShowBell(false); }}
          apNotifications={apNotifications}
          onMarkApNotifRead={handleMarkApNotifRead}
          onClearOrphanSafe={handleClearOrphanSafe}
          onClosePeriod={handleClosePeriodFromBell}
          onGotoBatch={handleGotoBatch}
          onOpenChatBatch={handleOpenChatBatch}
          onRejectBatch={handleRejectBatchFromBell}
          onPreviewFile={handlePreviewFileForReq}
          onDismissHandled={handleDismissNotif}
          onDismissSupportNotif={handleDismissSupportNotif}
        />
      )}
      {/* MARKER_APP_BELL_REJECT_CHOICE_DIALOG_V1 */}
      {rejectChoiceReq && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10002, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setRejectChoiceReq(null)}>
          <div style={{ background: 'white', borderRadius: '10px', width: '340px', maxWidth: '92vw', padding: '18px 20px', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a3a5c', marginBottom: '4px' }}>ปฏิเสธ Batch นี้</div>
            <div style={{ fontSize: '12px', color: '#666', marginBottom: '16px' }}>ต้องการใส่ Comment บอกเหตุผลด้วยไหม?</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button onClick={() => handleRejectChoiceComment(rejectChoiceReq)}
                style={{ padding: '8px 14px', borderRadius: '7px', border: '0.5px solid #c5d8f0', background: '#eef4fb', color: '#1a3a5c', fontSize: '12px', fontWeight: '500', cursor: 'pointer' }}>
                💬 ใส่ Comment
              </button>
              <button onClick={() => handleRejectChoiceDirect(rejectChoiceReq)}
                style={{ padding: '8px 14px', borderRadius: '7px', border: '0.5px solid #f7c1c1', background: '#FCEBEB', color: '#791F1F', fontSize: '12px', fontWeight: '500', cursor: 'pointer' }}>
                ✗ ปฏิเสธเฉยๆ (ไม่ใส่ Comment)
              </button>
              <button onClick={() => setRejectChoiceReq(null)}
                style={{ padding: '8px 14px', borderRadius: '7px', border: '0.5px solid #ddd', background: 'white', color: '#666', fontSize: '12px', cursor: 'pointer' }}>
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}
      {rejectChatReq && (
        <BatchChatDrawer
          batch={rejectChatReq}
          isRejectMode={true}
          currentUsername={userName || currentUser?.email || ''}
          onClose={() => setRejectChatReq(null)}
          onMinimize={() => setRejectChatReq(null)}
          onRejectConfirmed={handleRejectConfirmedFromBell}
        />
      )}
      {viewChatBatchId && (
        <BatchChatDrawer
          batch={{ batch_id: viewChatBatchId }}
          isRejectMode={false}
          currentUsername={userName || currentUser?.email || ''}
          onClose={() => setViewChatBatchId(null)}
          onMinimize={() => setViewChatBatchId(null)}
        />
      )}
      {previewFile && (
        <FilePreviewPopup
          fileId={previewFile.fileId}
          fileName={previewFile.fileName}
          onClose={() => setPreviewFile(null)}
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