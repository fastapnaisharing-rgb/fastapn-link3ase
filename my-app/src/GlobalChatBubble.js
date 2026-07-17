import { useState, useEffect, useCallback, useRef } from 'react';
import { db } from './lib/db';
import { subscribeWs } from './wsManager';
import BatchChatDrawer from './pages/BatchChatDrawer';

// ── วงกลมลอย Global v2 — โผล่เฉพาะตอนมี Batch ที่มีข้อความ "ยังไม่อ่าน" ────
// จริงๆ (ไม่ใช่แค่มีข้อความ) ค้างอยู่อย่างน้อย 1 Batch — พอเปิดอ่านหมดแล้ว
// วงกลมหายไปทันที (ไม่ใช่แค่ Badge=0) จนกว่าจะมีข้อความใหม่เข้ามาอีก
//
// คลิกวงกลมหลัก -> เปิด List Panel เลือก Batch (เผื่อมีหลาย Batch ที่ Unread
// ค้างพร้อมกัน) -> คลิกเลือก Batch ที่ต้องการ -> เปิด BatchChatDrawer จริง

const API_BASE = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');

function getToken() {
  return sessionStorage.getItem('fastapn_token');
}

export default function GlobalChatBubble({ currentUsername }) {
  const [candidates, setCandidates] = useState([]); // เฉพาะที่ยังมี Unread > 0
  const [showList, setShowList] = useState(false);
  const [openBatch, setOpenBatch] = useState(null);
  const meRef = useRef(currentUsername);
  meRef.current = currentUsername;

  const fetchCandidates = useCallback(async () => {
    const me = meRef.current;
    if (!me) { setCandidates([]); return; }
    try {
      const [{ data: asOwner }, { data: asReviewer }] = await Promise.all([
        db.from('batch_list').select('*').eq('status', 'rejected').eq('created_by', me),
        db.from('batch_list').select('*').eq('status', 'rejected').eq('reported_to_username', me),
      ]);
      const merged = [...(asOwner || []), ...(asReviewer || [])];
      const uniqueById = Object.values(
        merged.reduce((acc, b) => { acc[b.id] = b; return acc; }, {})
      );

      if (uniqueById.length === 0) { setCandidates([]); return; }

      const token = getToken();
      const withInfo = await Promise.all(
        uniqueById.map(async (b) => {
          const batchId = b.batch_id || b.id;
          try {
            const res = await fetch(`${API_BASE}/api/batch-comments/${encodeURIComponent(batchId)}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const messages = res.ok ? await res.json() : [];
            const unread = messages.filter((m) => {
              const readBy = Array.isArray(m.read_by) ? m.read_by : [];
              return !readBy.includes(me);
            });
            const last = messages[messages.length - 1];
            return {
              batch: b,
              batch_id: batchId,
              unreadCount: unread.length,
              lastMessage: last?.message || (last?.image_url ? '📷 รูปภาพ' : ''),
              lastAt: last?.created_at || b.created_at,
            };
          } catch {
            return { batch: b, batch_id: batchId, unreadCount: 0, lastMessage: '', lastAt: b.created_at };
          }
        })
      );

      // ── เอาเฉพาะ Batch ที่มี Unread จริงๆ เท่านั้น (ตาม Rule ใหม่) ─────
      const withUnread = withInfo.filter((c) => c.unreadCount > 0);
      withUnread.sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
      setCandidates(withUnread);
    } catch (e) {
      console.error('[GlobalChatBubble] fetchCandidates error:', e);
    }
  }, []);

  useEffect(() => {
    fetchCandidates();
  }, [fetchCandidates, currentUsername]);

  useEffect(() => {
    const unsubscribe = subscribeWs(
      ['batch_comment_new', 'batch_comment_read', 'batch_rejected', 'batch_approved'],
      () => fetchCandidates()
    );
    return unsubscribe;
  }, [fetchCandidates]);

  if (candidates.length === 0) return null;

  const totalUnread = candidates.reduce((sum, c) => sum + c.unreadCount, 0);

  return (
    <>
      {showList && !openBatch && (
        <div style={{
          position: 'fixed', bottom: '80px', right: '20px', zIndex: 1950,
          width: '260px', background: 'white', borderRadius: '10px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.18)', overflow: 'hidden',
        }}>
          <div style={{ padding: '10px 12px', background: '#1a3a5c' }}>
            <p style={{ fontSize: '12px', fontWeight: 600, color: 'white', margin: 0 }}>
              Batch ที่มีข้อความ ({candidates.length})
            </p>
          </div>
          {candidates.map((c, i) => (
            <div
              key={c.batch_id}
              onClick={() => { setOpenBatch(c.batch); setShowList(false); }}
              style={{
                padding: '10px 12px', cursor: 'pointer',
                borderBottom: i < candidates.length - 1 ? '1px solid #f0f0f0' : 'none',
                background: i % 2 === 1 ? '#fafbfc' : 'white',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#f0f4f8'}
              onMouseLeave={(e) => e.currentTarget.style.background = i % 2 === 1 ? '#fafbfc' : 'white'}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p style={{ fontSize: '12px', color: '#1a3a5c', margin: 0, fontWeight: 500 }}>{c.batch_id}</p>
                <span style={{ background: '#c0392b', color: 'white', fontSize: '9px', minWidth: '15px', height: '15px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>
                  {c.unreadCount}
                </span>
              </div>
              <p style={{ fontSize: '11px', color: '#8a94a3', margin: '2px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {c.lastMessage}
              </p>
            </div>
          ))}
        </div>
      )}

      <div
        onClick={() => setShowList((v) => !v)}
        style={{
          position: 'fixed', bottom: '20px', right: '20px', zIndex: 1900,
          width: '48px', height: '48px', borderRadius: '50%', background: '#1a3a5c',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        }}
        title={`${candidates.length} Batch มีข้อความยังไม่อ่าน`}
      >
        <span style={{ fontSize: '22px', color: 'white' }}>💬</span>
        <span style={{
          position: 'absolute', top: '-3px', right: '-3px', background: '#c0392b', color: 'white',
          fontSize: '10px', minWidth: '16px', height: '16px', borderRadius: '8px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #f5f6f8',
        }}>
          {totalUnread > 99 ? '99+' : totalUnread}
        </span>
      </div>

      {openBatch && (
        <BatchChatDrawer
          batch={openBatch}
          isRejectMode={false}
          currentUsername={currentUsername}
          onClose={() => setOpenBatch(null)}
          onMinimize={() => setOpenBatch(null)}
        />
      )}
    </>
  );
}