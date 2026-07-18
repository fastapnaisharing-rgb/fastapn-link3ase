import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';

// ── FilePreviewPopup — Popup Preview ไฟล์ Excel แบบ Read-only (ดูอย่างเดียว) ──
// ── ใช้ร่วมกันได้ทุกที่ในระบบ (App.js Bell / APController.js My Jobs ฯลฯ) ────
// ── ต่างจาก Preview ใน APController.js เดิมที่แก้ไข/บันทึกได้ — ตัวนี้ดูอย่าง ──
// ── เดียว เบากว่า ไม่ผูกกับ State อื่นในไฟล์ใดไฟล์หนึ่ง เอาไปวางที่ไหนก็ได้ ──
//
// Props:
//   fileId      - ID ของไฟล์ใน file_storage (จำเป็น)
//   fileName    - ชื่อไฟล์ที่จะโชว์ (Optional)
//   onClose     - callback ปิด Popup
//   apiBase     - Override API Base URL (Optional — Default อ่านจาก process.env)

const DEFAULT_API_BASE = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');

function getToken() {
  return sessionStorage.getItem('fastapn_token');
}

export default function FilePreviewPopup({ fileId, fileName, onClose, apiBase = DEFAULT_API_BASE }) {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!fileId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const token = getToken();
        const res = await fetch(`${apiBase}/api/file-storage/${fileId}/download`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'โหลดไฟล์ไม่สำเร็จ');
        }
        const arrayBuffer = await res.arrayBuffer();
        const wb = XLSX.read(arrayBuffer, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const parsedRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        if (!cancelled) setRows(parsedRows);
      } catch (e) {
        if (!cancelled) setError(e.message || 'เกิดข้อผิดพลาด');
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [fileId, apiBase]);

  const handleDownload = async () => {
    try {
      const token = getToken();
      const res = await fetch(`${apiBase}/api/file-storage/${fileId}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || 'invoice_register.xls';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => window.URL.revokeObjectURL(url), 10000);
    } catch (e) {
      console.error('[FilePreviewPopup] download error:', e);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'white', borderRadius: '10px', width: '100%', maxWidth: '900px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <p style={{ fontSize: '14px', fontWeight: 600, margin: 0, color: '#1a3a5c' }}>{fileName || 'Preview ไฟล์'}</p>
            <p style={{ fontSize: '11px', color: '#8a94a3', margin: '2px 0 0' }}>ดูอย่างเดียว — แก้ไขไม่ได้</p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button onClick={handleDownload} title="ดาวน์โหลด"
              style={{ width: '30px', height: '30px', borderRadius: '6px', border: '0.5px solid #b7dfc8', background: '#eaf6f0', color: '#0F6E56', fontSize: '14px', cursor: 'pointer' }}>⬇</button>
            <button onClick={onClose} title="ปิด"
              style={{ width: '30px', height: '30px', borderRadius: '6px', border: 'none', background: 'none', color: '#888', fontSize: '18px', cursor: 'pointer' }}>✕</button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
          {loading && <p style={{ textAlign: 'center', color: '#8a94a3', fontSize: '13px', padding: '40px 0' }}>กำลังโหลด...</p>}
          {error && <p style={{ textAlign: 'center', color: '#c0392b', fontSize: '13px', padding: '40px 0' }}>{error}</p>}
          {!loading && !error && rows && (
            <table style={{ borderCollapse: 'collapse', fontSize: '12px', width: '100%' }}>
              <tbody>
                {rows.map((row, rIdx) => (
                  <tr key={rIdx}>
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} style={{ border: '0.5px solid #e5e7eb', padding: '5px 8px', whiteSpace: 'nowrap', color: '#333' }}>
                        {String(cell ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
