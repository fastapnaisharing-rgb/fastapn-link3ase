// wsManager.js
// ── Shared WebSocket connection ตัวเดียวสำหรับทั้งแอพ ───────────────────────
// ── กันปัญหาที่แต่ละหน้า/component เปิด WS Connection ของตัวเองซ้ำซ้อน ──────
// ── (เช่น BatchSetup + InvoiceEntry + InvoiceHistoryPage เปิดพร้อมกัน 3 เส้น) ──
// ── ตอนนี้เหลือแค่ 1 Connection ต่อ Browser Tab ไม่ว่าจะมีกี่ Component Subscribe ──
//
// หลักการ: ทุกจุดที่มีการ Update ข้อมูลแบบ P2P หรือ Cross-session ต้องเป็น
// Event-driven (Push ผ่าน WS) ไม่ใช่รอ Poll ถี่ๆ — แต่ก็ต้องไม่เปิด Connection
// ซ้ำซ้อนจนกลายเป็นภาระ Server เหมือนกัน ตัวนี้แก้ทั้ง 2 โจทย์พร้อมกัน
//
// ไฟล์นี้มี 2 ฝั่ง (สมมาตรกัน) — เดิมทำแค่ฝั่งรับ (subscribeWs) ทำให้จุดที่
// ต้อง "ส่ง" Event ยังคง copy-paste fetch('/api/ws-notify') + token + apiBase
// ซ้ำกันเองอยู่หลายจุด (handleSendTo, handleRecallSelected, handleAccept,
// handleReject, ฯลฯ) — broadcastWs() ด้านล่างคือตัวรวมฝั่ง "ส่ง" ให้เป็น
// จุดเดียวเหมือนกัน:
//   ฝั่งรับ (Listen)  → subscribeWs(events, callback) / useRealtimeRefresh(...)
//   ฝั่งส่ง (Notify)  → broadcastWs(event, data)

let ws = null;
let reconnectTimer = null;
const listeners = new Set(); // { events: string[], onEvent: (event, payload) => void }
// MARKER_WSMANAGER_RECONNECT_BACKOFF_V1 -- ครั้งแรกต่อทันที (0ms) แล้วค่อยหน่วงเพิ่มขึ้นถ้ายังไม่สำเร็จ เพดานเท่าของเดิม (5s)
let reconnectAttempts = 0;
const RECONNECT_DELAYS = [0, 1000, 2000, 4000, 5000];

// MARKER_WSMANAGER_CONNECTION_STATUS_V1
// ── Track สถานะ Connection ('connected' | 'reconnecting' | 'disconnected') ──
// ── เดิมรู้แค่ภายในไฟล์นี้ไฟล์เดียว ไม่มีจุดอื่นในแอพ Subscribe ดูได้เลย ──
// ── ใช้สำหรับ Signal Dot หน้าชื่อ User (บอกความเสี่ยงขาดการเชื่อมต่อ เน็ต/VPN หลุด) ──
let wsStatus = 'disconnected';
const statusListeners = new Set(); // (status: string) => void
// Reconnect ไม่สำเร็จติดกันครบเท่านี้ถือว่าเสี่ยงจะเป็น "ขาดการเชื่อมต่อจริงๆ ต่อเนื่อง" (Backend ไม่ตอบสนอง)
// ตั้งไว้ 2 ครั้ง (~3-4 วิ) แทนที่จะรอ 3 ครั้ง (~7-8 วิ) เพื่อให้ขึ้นแดง "ก่อน" จะกลายเป็นวิกฤตจริง
// (สะดุดครั้งเดียวจากจราจรหนา ยังเป็นเหลืองอยู่ ไม่โดนตัดสินเป็นแดงจนกว่าจะพลาดต่อกัน 2 ครั้ง)
const RED_THRESHOLD = 2;

function setWsStatus(next) {
  if (wsStatus === next) return;
  wsStatus = next;
  statusListeners.forEach((cb) => {
    try { cb(wsStatus); } catch (e) { console.error('[wsManager] status listener error:', e); }
  });
}

function getApiBase() {
  return (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
}

// MARKER_WSMANAGER_USERNAME_V1
// ── เก็บ Username ปัจจุบันไว้ ส่งติดไปกับ URL ตอนเปิด WS Connection ──────
// ── Backend จะได้รู้ว่า Connection ไหนเป็นของใคร สำหรับ Real-time Offline ──
// ── Detection ตอนปิด Tab -- ดู app.js wss.on('connection', ...) ────────
let currentWsUsername = null;

export function setWsUsername(username) {
  const changed = currentWsUsername !== username;
  currentWsUsername = username;
  // ── Username เปลี่ยน (Login/Logout) และ Connection เปิดอยู่แล้ว -> ต้อง ──
  // ── Reconnect ใหม่ให้ Server รู้ Username ล่าสุด (URL Query String เดิม ──
  // ── ผูกกับตอนเปิด Connection ครั้งแรกเท่านั้น เปลี่ยนทีหลังไม่มีผลอัตโนมัติ) ──
  if (changed && ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    // MARKER_WSMANAGER_LOGOUT_CLOSE_CODE_V1 -- Logout/Force Logout (username -> null) ปิดด้วย code 4000 ให้ Backend รู้ว่าเป็น Logout จริง (Offline ทันที)
    // -- Refresh/ปิดแท็บ/เน็ตหลุดไม่ใช่ code นี้ -> Backend รอ Grace ก่อนประกาศ Offline
    if (username) ws.close(); else ws.close(4000, 'logout');
    ws = null;
    if (listeners.size > 0) connect();
  }
}

function getWsUrl() {
  const base = getApiBase().replace(/^http/, 'ws');
  return currentWsUsername ? `${base}?user=${encodeURIComponent(currentWsUsername)}` : base;
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const sock = new WebSocket(getWsUrl());
  ws = sock;
  setWsStatus('reconnecting'); // MARKER_WSMANAGER_CONNECTION_STATUS_V1 -- กำลังพยายามเชื่อมต่อ (ครั้งแรก หรือหลังหลุด)

  sock.onopen = () => { reconnectAttempts = 0; setWsStatus('connected'); }; // MARKER_WSMANAGER_RECONNECT_BACKOFF_V1 -- เชื่อมต่อสำเร็จ รีเซ็ต Backoff กลับเป็นต่อทันทีในรอบหน้า -- MARKER_WSMANAGER_CONNECTION_STATUS_V1

  sock.onmessage = ({ data }) => {
    let parsed;
    try { parsed = JSON.parse(data); } catch { return; }
    const { event } = parsed || {};
    if (!event) return;
    listeners.forEach((l) => {
      if (l.events.includes(event)) {
        try { l.onEvent(event, parsed); } catch (e) { console.error('[wsManager] listener error:', e); }
      }
    });
  };
  sock.onerror = () => console.warn('[wsManager] connection error');
  sock.onclose = () => {
    // MARKER_WSMANAGER_STALE_SOCKET_GUARD_V1 -- Socket เก่า (ที่ถูกแทนด้วย Connection ใหม่แล้ว เช่น Username เปลี่ยน) ปิดทีหลัง ห้ามไปเคลียร์/Reconnect ทับ Connection ใหม่
    // -- เดิม onclose ของตัวเก่าเซ็ต ws = null ทับตัวใหม่ -> เปิด Connection ซ้ำค้างเป็น "ผี" ทำให้ Backend คิดว่า User ยัง Online
    if (ws && ws !== sock) return;
    ws = null;
    // ── Reconnect เฉพาะตอนยังมีคน Subscribe อยู่จริง ไม่งั้นปล่อยปิดไปเลย ──
    if (listeners.size > 0) {
      clearTimeout(reconnectTimer);
      const delay = RECONNECT_DELAYS[Math.min(reconnectAttempts, RECONNECT_DELAYS.length - 1)]; // MARKER_WSMANAGER_RECONNECT_BACKOFF_V1
      reconnectAttempts += 1;
      // MARKER_WSMANAGER_CONNECTION_STATUS_V1 -- ยังไม่ถึงเกณฑ์ = แค่สะดุด (เหลือง), เกินเกณฑ์ = เน็ต/VPN หลุดจริง (แดง)
      setWsStatus(reconnectAttempts >= RED_THRESHOLD ? 'disconnected' : 'reconnecting');
      reconnectTimer = setTimeout(connect, delay);
    } else {
      setWsStatus('disconnected'); // MARKER_WSMANAGER_CONNECTION_STATUS_V1 -- ไม่มีใคร Subscribe แล้ว (เช่น Logout) ถือว่าไม่เชื่อมต่อ
    }
  };
}

/**
 * Subscribe ฟัง Event เฉพาะที่สนใจจาก Shared WS Connection
 * @param {string[]} events - รายชื่อ Event ที่สนใจ (ต้องตรงกับที่ Backend wsBroadcast ส่งมา)
 * @param {(event: string, payload: object) => void} onEvent - Callback เมื่อมี Event ตรง
 * @returns {() => void} unsubscribe function — ต้องเรียกตอน component unmount เสมอ
 */
export function subscribeWs(events, onEvent) {
  const entry = { events, onEvent };
  listeners.add(entry);
  connect(); // เปิด connection ถ้ายังไม่มี (หรือ no-op ถ้ามีอยู่แล้ว)
  return () => {
    listeners.delete(entry);
    // ── ไม่มีใคร Subscribe แล้ว -> ปิด Connection ประหยัด Resource ──────────
    if (listeners.size === 0 && ws) {
      clearTimeout(reconnectTimer);
      ws.close();
      ws = null;
    }
  };
}

/**
 * คืนสถานะ Connection ปัจจุบัน ('connected' | 'reconnecting' | 'disconnected')
 * MARKER_WSMANAGER_CONNECTION_STATUS_V1
 */
export function getWsStatus() {
  return wsStatus;
}

/**
 * Subscribe ฟังการเปลี่ยนสถานะ Connection (สำหรับ Signal Dot หน้าชื่อ User เป็นต้น)
 * @param {(status: string) => void} onChange
 * @returns {() => void} unsubscribe function
 * MARKER_WSMANAGER_CONNECTION_STATUS_V1
 */
export function subscribeWsStatus(onChange) {
  statusListeners.add(onChange);
  onChange(wsStatus); // แจ้งสถานะปัจจุบันทันทีตอน Subscribe ครั้งแรก กันหน้าจอค้างค่า Default ผิด
  return () => statusListeners.delete(onChange);
}

/**
 * ส่ง Event ไป Broadcast ผ่าน Backend (/api/ws-notify) — ใช้แทนทุกจุดที่เคย
 * เขียน fetch(...) + token + apiBase เองซ้ำๆ กระจายอยู่ทั่วโค้ด
 * @param {string} event - ชื่อ Event (ฝั่งที่ subscribeWs ต้อง match ชื่อนี้)
 * @param {object} data - ข้อมูลเพิ่มเติม (เช่น { batch_id, status })
 */
export async function broadcastWs(event, data = {}) {
  try {
    const token = sessionStorage.getItem('fastapn_token');
    await fetch(`${getApiBase()}/api/ws-notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ event, ...data }),
    });
  } catch (e) {
    console.error('[wsManager] broadcastWs error:', e);
  }
}