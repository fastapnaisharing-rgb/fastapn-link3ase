import React, { useState, useEffect, useRef } from 'react';
import { registerConfirmDialogHost } from './confirmDialog';

// ConfirmDialogHost.jsx
// ── Mount ตัวนี้แค่ครั้งเดียวที่ App.js (ระดับบนสุด นอก Router/Page ใดๆ) ──────
// ── ใช้แทน window.confirm()/alert() ทั้งระบบ — Style ตรง Theme FASTAPN ──────
// ── (Navy #1a3a5c, Teal Accent #5DCAA5, Danger #791F1F/#FCEBEB, ────────────
// ──  Success #27500A/#EAF3DE — สีชุดเดียวกับที่ใช้ทั่วทั้งแอพอยู่แล้ว) ──────

const VARIANTS = {
  default: { accent: '#1a3a5c', accentBg: '#eef4fb', accentBorder: '#c5d8f0', icon: 'i' },
  danger:  { accent: '#791F1F', accentBg: '#FCEBEB', accentBorder: '#f7c1c1', icon: '!' },
  success: { accent: '#27500A', accentBg: '#EAF3DE', accentBorder: '#97C459', icon: '✓' },
};

export default function ConfirmDialogHost() {
  const [dialog, setDialog] = useState(null);
  const resolveRef = useRef(null);
  const cancelBtnRef = useRef(null);

  useEffect(() => {
    registerConfirmDialogHost((config) => {
      return new Promise((resolve) => {
        resolveRef.current = resolve;
        setDialog(config);
      });
    });
  }, []);

  useEffect(() => {
    if (!dialog) return undefined;
    // ── Focus ปุ่ม Cancel เป็นค่าเริ่มต้น (กัน Enter รัวแล้วเผลอ Confirm) ──────
    setTimeout(() => cancelBtnRef.current?.focus(), 30);
    const onKeyDown = (e) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') close(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog]);

  const close = (result) => {
    setDialog(null);
    resolveRef.current?.(result);
    resolveRef.current = null;
  };

  if (!dialog) return null;

  const v = VARIANTS[dialog.variant] || VARIANTS.default;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(26,58,92,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 99999, animation: 'confirmDialogFadeIn 0.15s ease-out',
      }}
      onClick={() => dialog.mode === 'confirm' && close(false)}
    >
      <style>{`
        @keyframes confirmDialogFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes confirmDialogPopIn { from { opacity: 0; transform: translateY(-8px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
      `}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: '14px', padding: '26px',
          width: '400px', maxWidth: '90vw',
          boxShadow: '0 16px 40px rgba(26,58,92,0.28)',
          border: `1px solid ${v.accentBorder}`,
          animation: 'confirmDialogPopIn 0.18s ease-out',
        }}
      >
        <div style={{
          width: '42px', height: '42px', borderRadius: '50%', background: v.accentBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px',
        }}>
          <span style={{ color: v.accent, fontSize: '20px', fontWeight: 800, lineHeight: 1 }}>{v.icon}</span>
        </div>

        {dialog.title && (
          <div style={{ fontSize: '15.5px', fontWeight: 700, color: '#1a3a5c', marginBottom: '8px' }}>
            {dialog.title}
          </div>
        )}

        <div style={{ fontSize: '13.5px', color: '#333', lineHeight: 1.65, marginBottom: '22px', whiteSpace: 'pre-line' }}>
          {dialog.message}
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          {dialog.mode === 'confirm' && (
            <button
              ref={cancelBtnRef}
              onClick={() => close(false)}
              style={{
                padding: '9px 20px', borderRadius: '8px', border: '1px solid #e2e6ed',
                background: '#fff', color: '#1a3a5c', fontSize: '13px', fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {dialog.cancelText || 'ยกเลิก'}
            </button>
          )}
          <button
            onClick={() => close(true)}
            style={{
              padding: '9px 22px', borderRadius: '8px', border: 'none',
              background: v.accent, color: '#fff', fontSize: '13px', fontWeight: 600,
              cursor: 'pointer', boxShadow: `0 2px 8px ${v.accent}55`,
            }}
          >
            {dialog.confirmText || 'ตกลง'}
          </button>
        </div>
      </div>
    </div>
  );
}
