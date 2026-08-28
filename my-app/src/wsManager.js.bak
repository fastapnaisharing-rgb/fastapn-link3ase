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

function getApiBase() {
  return (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
}

function getWsUrl() {
  return getApiBase().replace(/^http/, 'ws');
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  ws = new WebSocket(getWsUrl());

  ws.onmessage = ({ data }) => {
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
  ws.onerror = () => console.warn('[wsManager] connection error');
  ws.onclose = () => {
    ws = null;
    // ── Reconnect เฉพาะตอนยังมีคน Subscribe อยู่จริง ไม่งั้นปล่อยปิดไปเลย ──
    if (listeners.size > 0) {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 5000);
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