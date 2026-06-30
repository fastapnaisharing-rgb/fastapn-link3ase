import React, { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';

const ROLE_STYLE = {
  Owner:  { background: '#d4f0e7', color: '#0F6E56' },
  Admin:  { background: '#FCEBEB', color: '#791F1F' },
  Editor: { background: '#EAF3DE', color: '#27500A' },
  Viewer: { background: '#f0f0f0', color: '#888'    },
};

function getTodayThai() {
  const d = new Date();
  const days   = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
  const months = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                  'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  return `วัน${days[d.getDay()]}ที่ ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`;
}

function Homepage() {
  const { userName, userRole, currentUser } = useAuth();
  const today = useMemo(() => getTodayThai(), []);
  const displayName = userName || currentUser?.email || '-';
  const roleStyle = ROLE_STYLE[userRole] || ROLE_STYLE.Viewer;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: '#f5f5f5',
      fontFamily: 'sans-serif',
      overflowY: 'auto',
    }}>

      {/* ── Header ── */}
      <div style={{
        background: 'white',
        borderBottom: '1px solid #e8eaf0',
        padding: '24px 32px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '12px',
        flexShrink: 0,
      }}>

        {/* Left: ชื่อระบบ */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {/* accent bar */}
          <div style={{ width: '4px', height: '42px', background: '#5DCAA5', borderRadius: '4px', flexShrink: 0 }} />
          <div>
            <p style={{
              fontSize: '11px', fontWeight: '600', color: '#5DCAA5',
              margin: '0 0 3px', letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>
              AP Controller
            </p>
            <h1 style={{
              fontSize: '22px', fontWeight: '700', color: '#1a3a5c',
              margin: '0 0 2px', lineHeight: 1.2,
            }}>
              FAST<span style={{ color: '#5DCAA5' }}>APN</span> Link3ase
            </h1>
            <p style={{ fontSize: '12px', color: '#aaa', margin: 0 }}>
              Accounts Payable Invoice Management
            </p>
          </div>
        </div>

        {/* Right: วันที่ + user */}
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: '13px', color: '#555', margin: '0 0 6px', fontWeight: '500' }}>
            {today}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: '#888' }}>{displayName}</span>
            {userRole && (
              <span style={{
                fontSize: '11px', fontWeight: '600',
                padding: '3px 10px', borderRadius: '99px',
                ...roleStyle,
              }}>
                {userRole}
              </span>
            )}
          </div>
        </div>

      </div>

      {/* ── Content area (ว่างไว้ก่อน เพิ่มทีหลัง) ── */}
      <div style={{ flex: 1 }} />

    </div>
  );
}

export default Homepage;