// useRealtimeRefresh.js
// ── Hook มาตรฐานสำหรับทุกจุดที่ต้อง "Update แบบ Event ทันที + ไม่หนัก Server" ──
//
// ใช้ยังไง:
//   useRealtimeRefresh(['batch_deleted', 'batch_approved'], fetchHistory);
//
// พฤติกรรม:
//   1. Subscribe ผ่าน Shared WS Connection (wsManager) — พอมี Event ตรงเข้ามา
//      เรียก callback ทันที (Real-time, ไม่ต้องรอ Poll)
//   2. มี Poll Fallback ในตัว (Default 60 วิ) เผื่อ WS หลุด/พลาด Event ระหว่างที่
//      Tab อยู่ Background หรือกำลัง Reconnect — กวาด Refetch ซ้ำให้ชัวร์
//   3. ใช้ Shared Connection เดียวกับทุกจุดในแอพ (ผ่าน wsManager) ไม่เปิด
//      Connection ซ้ำซ้อนต่อ Component เหมือนที่เคยทำแบบ Ad-hoc ก่อนหน้า
//
// ใส่ pollMs = 0 เพื่อปิด Poll Fallback (ใช้ WS อย่างเดียว) ถ้ามั่นใจว่า Event
// นั้นไม่สำคัญถึงขั้นต้องมี Fallback

import { useEffect, useRef } from 'react';
import { subscribeWs } from './wsManager';

export function useRealtimeRefresh(events, onEvent, pollMs = 60000) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent; // ── กัน stale closure โดยไม่ต้อง re-subscribe ทุก render ──

  const eventsKey = events.join(',');

  useEffect(() => {
    const unsubscribe = subscribeWs(events, () => onEventRef.current());
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsKey]);

  useEffect(() => {
    if (!pollMs) return undefined;
    const interval = setInterval(() => onEventRef.current(), pollMs);
    return () => clearInterval(interval);
  }, [pollMs]);
}