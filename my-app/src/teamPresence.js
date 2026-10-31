// teamPresence.js
// MARKER_TEAM_PRESENCE_SHARED_V1
// ── แหล่งเดียวของสถานะ Online/Offline ทีม ใช้ร่วมกันทุกหน้า (Home การ์ดทีม, Popup ทีม Online ใน App, User Management) ──
// ทุกหน้าเห็นข้อมูลชุดเดียวกัน อัปเดตพร้อมกัน:
//   1. ดึง user_roles + menu_active_sessions ครั้งเดียวแล้วแจกให้ทุกคนที่ใช้ (ไม่ดึงแยกคนละจังหวะ)
//   2. User ที่มีหลายแถวใน menu_active_sessions ใช้แถวที่ last_seen ใหม่สุด
//   3. Refresh ทันทีเมื่อมี Event 'team_status_updated' / 'team_presence' (Login, Logout, เปลี่ยนเมนู, กลับมาจาก Idle)
//   4. Poll สำรองทุก 30 วิ + Refresh ตอนกลับมาที่แท็บ + เช็คหมดเวลา (5 นาที) ในเครื่องทุก 15 วิ ให้คนที่เงียบไปกลายเป็น Offline เอง
import { useEffect, useMemo, useState } from 'react';
import { db } from './lib/db';
import { subscribeWs } from './wsManager';

export const TEAM_ONLINE_WINDOW_MS = 5 * 60 * 1000; // Online = Activity ใน 5 นาทีล่าสุด

let snapshot = { roles: [], sessByUser: {}, loaded: false };
let inflight = null;
let wsUnsub = null;
let pollTimer = null;
let tickTimer = null;
let onFocus = null;
let version = 0;
const listeners = new Set();

const ts = (s) => (s && s.last_seen ? new Date(s.last_seen).getTime() : 0);
const emit = () => { version += 1; listeners.forEach((fn) => fn()); };

export function refreshTeamPresence() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const [{ data: roles }, { data: sessions }] = await Promise.all([
        db.from('user_roles').select('*'),
        db.from('menu_active_sessions').select('*'),
      ]);
      const sessByUser = {};
      (sessions || []).forEach((s) => {
        if (!s || !s.user_name) return;
        const prev = sessByUser[s.user_name];
        if (!prev || ts(s) >= ts(prev)) sessByUser[s.user_name] = s;
      });
      snapshot = { roles: roles || [], sessByUser, loaded: true };
      emit();
    } catch (e) {
      console.error('[team presence]', e);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function start() {
  if (wsUnsub) return;
  wsUnsub = subscribeWs(['team_status_updated', 'team_presence'], () => { refreshTeamPresence(); });
  pollTimer = setInterval(refreshTeamPresence, 30000);
  tickTimer = setInterval(emit, 15000);
  onFocus = () => { refreshTeamPresence(); };
  window.addEventListener('focus', onFocus);
  refreshTeamPresence();
}

function stop() {
  if (wsUnsub) { wsUnsub(); wsUnsub = null; }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  if (onFocus) { window.removeEventListener('focus', onFocus); onFocus = null; }
}

// enabled = false -> ไม่ดึง/ไม่ Subscribe (เช่น User ที่ไม่มีสิทธิ์เห็น Popup)
export function useTeamPresence(enabled = true) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    if (listeners.size === 1) start();
    else if (!snapshot.loaded) refreshTeamPresence();
    return () => {
      listeners.delete(fn);
      if (listeners.size === 0) stop();
    };
  }, [enabled]);

  const now = Date.now();
  const cutoff = now - TEAM_ONLINE_WINDOW_MS;
  const { roles, sessByUser, loaded } = snapshot;
  // คีย์ของสถานะ Online ณ ตอนนี้ — เปลี่ยนเฉพาะเมื่อมีคน Online/Offline เปลี่ยน หรือข้อมูลชุดใหม่เข้ามา (ไม่สร้าง Array ใหม่ทุก Tick)
  const onlineKey = roles.map((r) => (ts(sessByUser[r.username]) >= cutoff ? '1' : '0')).join('') + '|' + Object.keys(sessByUser).filter((u) => ts(sessByUser[u]) >= cutoff).sort().join(',');

  return useMemo(() => {
    const onlineUsers = [];
    const offlineUsers = [];
    roles.forEach((r) => {
      const sess = sessByUser[r.username];
      const entry = { ...r, menu_id: sess?.menu_id, lastSeen: sess?.last_seen };
      if (ts(sess) >= Date.now() - TEAM_ONLINE_WINDOW_MS) onlineUsers.push(entry); else offlineUsers.push(entry);
    });
    const onlineSet = new Set();
    Object.keys(sessByUser).forEach((u) => { if (ts(sessByUser[u]) >= Date.now() - TEAM_ONLINE_WINDOW_MS) onlineSet.add(u); });
    return { roles, sessByUser, loaded, onlineUsers, offlineUsers, onlineSet, refresh: refreshTeamPresence };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, onlineKey]);
}
