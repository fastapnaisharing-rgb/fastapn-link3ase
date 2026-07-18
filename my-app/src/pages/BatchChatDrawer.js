import { useState, useEffect, useRef, useCallback } from 'react';
import { subscribeWs, broadcastWs } from '../wsManager';

// ── Batch Comments (Chat) Drawer — กล่องเล็กลอยมุมขวาล่างแบบ Messenger ──────
// v2: เพิ่ม Mark-Read อัตโนมัติตอนเปิด + Lightbox ขยายรูป + แก้ Bug โหลดรูปไม่ขึ้น
//
// Props:
//   batch            - { id, batch_id } (จำเป็น)
//   isRejectMode     - true = เปิดตอนกด Reject (ยังไม่ Reject จริง จนกว่าจะส่งข้อความแรก)
//   onClose          - callback ปิด Drawer
//   onMinimize       - callback พับ
//   onRejectConfirmed - callback หลังส่งข้อความแรกสำเร็จตอน isRejectMode
//   currentUsername  - ชื่อผู้ใช้ปัจจุบัน

const API_BASE = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');

function getToken() {
  return sessionStorage.getItem('fastapn_token');
}

// MARKER_CHATDRAWER_AUTHED_IMAGE_V1
// ── AuthedImage — โหลดรูปที่ต้อง Auth (<img src> ธรรมดาแนบ Token ไปด้วย ────
// ── ไม่ได้ — ต้อง fetch() พร้อม Token ก่อน แล้วแปลงเป็น Blob URL แทน) ──────
function AuthedImage({ url, alt, onClick, style }) {
  const [blobUrl, setBlobUrl] = useState(null);

  useEffect(() => {
    let revoked = false;
    let objectUrl = null;
    (async () => {
      try {
        const token = getToken();
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!revoked) setBlobUrl(objectUrl);
      } catch (e) {
        console.error('[AuthedImage] load error:', e);
      }
    })();
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  if (!blobUrl) {
    return <div style={{ ...style, background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#8a94a3' }}>โหลด...</div>;
  }
  return <img src={blobUrl} alt={alt} onClick={() => onClick?.(blobUrl)} style={style} />;
}

export default function BatchChatDrawer({ batch, isRejectMode = false, onClose, onMinimize, onRejectConfirmed, currentUsername = '' }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);

  const batchId = batch?.batch_id || batch?.id;

  const fetchMessages = useCallback(async () => {
    if (!batchId) return;
    try {
      const token = getToken();
      const res = await fetch(`${API_BASE}/api/batch-comments/${encodeURIComponent(batchId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data);
      }
    } catch (e) {
      console.error('[BatchChatDrawer] fetchMessages error:', e);
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  const markAsRead = useCallback(async () => {
    if (!batchId) return;
    try {
      const token = getToken();
      await fetch(`${API_BASE}/api/batch-comments/${encodeURIComponent(batchId)}/mark-read`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      broadcastWs('batch_comment_read', { batch_id: batchId, username: currentUsername });
    } catch (e) {
      console.error('[BatchChatDrawer] markAsRead error:', e);
    }
  }, [batchId, currentUsername]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // ── เปิด Drawer ปุ๊บ Mark ว่าอ่านแล้วทันที (ไม่รอ Interaction อื่น) ──────
  useEffect(() => {
    if (!isRejectMode) markAsRead();
  }, [batchId, isRejectMode, markAsRead]);

  useEffect(() => {
    const unsubscribe = subscribeWs(['batch_comment_new'], (event, payload) => {
      if (String(payload.batch_id) === String(batchId)) {
        fetchMessages();
        if (!isRejectMode) markAsRead();
      }
    });
    return unsubscribe;
  }, [batchId, fetchMessages, isRejectMode, markAsRead]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const setImageFromFile = (file) => {
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result);
    reader.readAsDataURL(file);
  };

  const handlePickImage = (e) => {
    const file = e.target.files?.[0];
    if (file) setImageFromFile(file);
  };

  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (!file) continue;
        e.preventDefault();
        setImageFromFile(file);
        break;
      }
    }
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSend = async () => {
    if (!text.trim() && !imageFile) return;
    setSending(true);
    try {
      const token = getToken();
      let image_base64 = null;
      if (imageFile) {
        image_base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(imageFile);
        });
      }

      const res = await fetch(`${API_BASE}/api/batch-comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          batch_id: batchId,
          message: text.trim(),
          image_base64,
          image_filename: imageFile?.name || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'ส่งข้อความไม่สำเร็จ');
      }

      const wasFirstMessageInRejectMode = isRejectMode && messages.length === 0;

      setText('');
      clearImage();
      await fetchMessages();
      broadcastWs('batch_comment_new', { batch_id: batchId });

      if (wasFirstMessageInRejectMode && onRejectConfirmed) {
        await onRejectConfirmed(batch);
      }
    } catch (e) {
      alert('ส่งข้อความไม่สำเร็จ: ' + e.message);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const imgSrc = (m) => `${API_BASE}/api/batch-comments/image-by-id/${m.id}`;

  return (
    <div style={{
      position: 'fixed', bottom: '20px', right: '20px', zIndex: 2000,
      width: '320px', height: '440px', background: '#ffffff', borderRadius: '10px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>

      <div style={{ padding: '10px 14px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1a3a5c', flexShrink: 0 }}>
        <div>
          <p style={{ fontSize: '13px', fontWeight: 600, margin: 0, color: '#ffffff' }}>{batchId}</p>
          <p style={{ fontSize: '10px', color: '#c9d6e4', margin: '2px 0 0' }}>{isRejectMode ? 'Reject batch' : 'Batch chat'}</p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button onClick={() => onMinimize?.()} title="พับ" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: '#c9d6e4' }}>─</button>
          <button onClick={() => onClose?.()} title="ปิด" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '15px', color: '#c9d6e4' }}>✕</button>
        </div>
      </div>

      {isRejectMode && messages.length === 0 && (
        <div style={{ padding: '6px 14px', background: '#fdecea', flexShrink: 0 }}>
          <p style={{ fontSize: '10px', color: '#c0392b', margin: 0, fontWeight: 500 }}>พิมพ์เหตุผลที่ Reject batch นี้</p>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {loading ? (
          <p style={{ fontSize: '11px', color: '#8a94a3', textAlign: 'center' }}>กำลังโหลด...</p>
        ) : messages.length === 0 ? (
          <p style={{ fontSize: '11px', color: '#8a94a3', textAlign: 'center' }}>ยังไม่มีข้อความ</p>
        ) : (
          messages.map((m) => {
            const isMine = m.sender_username === currentUsername;
            return (
              <div key={m.id} style={{ alignSelf: isMine ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
                {!isMine && <p style={{ fontSize: '9px', color: '#8a94a3', margin: '0 0 2px 3px' }}>{m.sender_username}</p>}
                {m.message && (
                  <div style={{ background: isMine ? '#eaf3de' : '#fdecea', borderRadius: '9px', padding: '6px 10px' }}>
                    <p style={{ fontSize: '12px', color: isMine ? '#27500a' : '#7a2419', margin: 0, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{m.message}</p>
                  </div>
                )}
                {m.image_url && (
                  <AuthedImage
                    url={imgSrc(m)}
                    alt="attachment"
                    onClick={(blobUrl) => setLightboxSrc(blobUrl)}
                    style={{ maxWidth: '130px', maxHeight: '130px', borderRadius: '6px', border: '0.5px solid #97C459', marginTop: '3px', display: 'block', cursor: 'zoom-in' }}
                  />
                )}
                <p style={{ fontSize: '9px', color: '#8a94a3', margin: '2px 3px 0', textAlign: isMine ? 'right' : 'left' }}>
                  {new Date(m.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {imagePreview && (
        <div style={{ padding: '6px 14px', borderTop: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <img src={imagePreview} alt="preview" style={{ width: '36px', height: '36px', objectFit: 'cover', borderRadius: '6px', border: '0.5px solid #97C459' }} />
          <button onClick={clearImage} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', color: '#c0392b' }}>ลบรูป</button>
        </div>
      )}

      <div style={{ padding: '8px 10px', borderTop: '1px solid #e5e7eb', display: 'flex', alignItems: 'flex-end', gap: '6px', flexShrink: 0 }}>
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePickImage} style={{ display: 'none' }} />
        <button onClick={() => fileInputRef.current?.click()} title="แนบรูป" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '15px', color: '#1a3a5c' }}>📎</button>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="พิมพ์ข้อความ..."
          rows={1}
          style={{ flex: 1, border: '0.5px solid #97C459', borderRadius: '14px', padding: '5px 12px', fontSize: '12px', resize: 'none', maxHeight: '60px' }}
        />
        <button onClick={handleSend} disabled={sending || (!text.trim() && !imageFile)}
          style={{ background: isRejectMode ? '#c0392b' : '#1a3a5c', color: 'white', border: 'none', borderRadius: '14px', padding: '6px 10px', fontSize: '11px', cursor: 'pointer', opacity: sending ? 0.6 : 1 }}>
          {isRejectMode && messages.length === 0 ? 'Reject' : '➤'}
        </button>
      </div>

      {lightboxSrc && (
        <div
          onClick={() => setLightboxSrc(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}
        >
          <img src={lightboxSrc} alt="expanded" style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: '6px' }} />
          <button onClick={() => setLightboxSrc(null)} style={{ position: 'absolute', top: '20px', right: '20px', background: 'none', border: 'none', color: 'white', fontSize: '24px', cursor: 'pointer' }}>✕</button>
        </div>
      )}
    </div>
  );
}