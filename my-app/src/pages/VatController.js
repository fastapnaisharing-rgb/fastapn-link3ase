import React from "react";
import { VAT_CONTROLLER_MENU } from "../menuConfig";
import { apiFetch } from "../api"; // MARKER_VATWATCHLISTOPS_APIFETCH_IMPORT_V1

// MARKER_VATCONTROLLER_PLACEHOLDER_AUTOMAP_V1
// ── ดึง Label จาก menuConfig.js อัตโนมัติ — ไม่ Hardcode ชื่อเมนูซ้ำในไฟล์นี้ ──
// ── เพิ่มเมนูใหม่ในอนาคต: แก้แค่ menuConfig.js ที่เดียว หน้านี้ตามเองเสมอ ────
const VAT_MENU_LABEL_MAP = VAT_CONTROLLER_MENU.groups
  .flatMap(g => g.items)
  .reduce((acc, item) => { acc[item.id] = item.label; return acc; }, {});

function PlaceholderPage({ title }) {
  return (
    <div style={{ padding: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888' }}>
      <div style={{ fontSize: '48px', marginBottom: '16px' }}>💹</div>
      <div style={{ fontSize: '18px', fontWeight: '500', color: '#1a3a5c', marginBottom: '8px' }}>{title}</div>
      <div style={{ fontSize: '13px', color: '#aaa' }}>อยู่ระหว่างการพัฒนา</div>
    </div>
  );
}

// MARKER_VATWATCHLISTOPS_INLINE_LAYOUT_V1
// ── Lobby ของ "VAT Watchlist Ops." — Layout เปล่า 3 Zone (รอ Confirm Content) ──
// ── Zone 70%/30% (บน) ว่างไว้ก่อน / Zone Monitor (ล่าง 65%) รอ company_list ──
const vatWatchlistZoneStyle = {
  border: '1.5px dashed #ccc',
  borderRadius: '10px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#999',
  fontSize: '13px',
};

// MARKER_VATWATCHLISTOPS_UPLOADZONE_V1
// ── Zone 35% (ขวา) — Upload Zone จริง (Drag&Drop + Browse) ────────────────
// ── ยังไม่ผูก Backend จริง รอ Endpoint Auto-Match BU จากไฟล์ Incomplete ────
// MARKER_VATWATCHLISTOPS_UPLOADBUTTON_POPUP_V2
// ── ปุ่ม Upload เดียว -> เด้ง Popup (มีแค่ Drag Drop) ──────────────────────
// ── Mini Monitor 5 แถวล่าสุด อยู่ใต้ปุ่ม คนละเรื่องกับ Popup ────────────────
// ── ข้อมูล Mini Monitor เป็น Static ตัวอย่างไปก่อน รอต่อ Backend จริง ───────
// MARKER_VATWATCHLISTOPS_REALDATA_V1
// ── ดึงข้อมูลจริงจาก company_list แทน Mockup ──────────────────────────────
const VAT_WATCHLIST_OVERDUE_DAYS = 14; // เกินกี่วันถือว่า "ค้างนาน" (สีแดง)

function useVatWatchlistRecentUploads(limit = 5) {
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch('/company_list');
        const list = Array.isArray(data) ? data : [];
        const withUpdate = list.filter(c => c.vat_watchlist_last_incomplete_update);
        withUpdate.sort((a, b) =>
          new Date(b.vat_watchlist_last_incomplete_update) - new Date(a.vat_watchlist_last_incomplete_update)
        );
        const now = Date.now();
        const top = withUpdate.slice(0, limit).map(c => {
          const updatedDate = new Date(c.vat_watchlist_last_incomplete_update);
          const daysAgo = (now - updatedDate.getTime()) / (1000 * 60 * 60 * 24);
          return {
            bu: c.bu,
            taxId: c['TAX ID'] || '',
            updatedAt: updatedDate.toLocaleDateString('th-TH', { day: '2-digit', month: 'short' }),
            overdue: daysAgo > VAT_WATCHLIST_OVERDUE_DAYS,
          };
        });
        if (!cancelled) setRows(top);
      } catch (err) {
        console.error('useVatWatchlistRecentUploads error:', err);
        if (!cancelled) setRows([]);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [limit]);

  return { rows, loading };
}

function VatWatchlistUploadModal({ onClose }) {
  const fileInputRef = React.useRef(null);
  const textareaRef = React.useRef(null);
  const [selectedFile, setSelectedFile] = React.useState(null);
  const [pastedText, setPastedText] = React.useState('');
  const [isDragging, setIsDragging] = React.useState(false);
  const [isFocused, setIsFocused] = React.useState(false);
  const [previewRows, setPreviewRows] = React.useState(null);

  // MARKER_VATWATCHLISTOPS_SCROLLRESET_V1
  // ── หลัง Paste Cursor จะอยู่ท้ายข้อความ ทำให้ Browser Auto-Scroll ไปขวา ──────
  // ── Reset ไปซ้ายสุด-บนสุดเสมอ จะได้เห็นคอลัมน์สำคัญ (วันที่/เลขที่) ก่อน ─────
  React.useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.scrollLeft = 0;
      textareaRef.current.scrollTop = 0;
      textareaRef.current.setSelectionRange(0, 0);
    }
  }, [pastedText]);

  const handleFiles = (files) => {
    if (files && files[0]) { setSelectedFile(files[0]); setPastedText(''); }
  };

  const hasInput = !!selectedFile || pastedText.trim().length > 0;

  const handleCheckData = () => {
    // MARKER_VATWATCHLISTOPS_PREVIEW_MOCK — รอต่อ Backend Parse จริงทีหลัง
    setPreviewRows([
      { doc_no: 'N230512019', bu: 'CRG', amount: '-109.35' },
      { doc_no: 'N230509080', bu: 'OTY', amount: '-109.35' },
    ]);
  };

  const boxActive = isDragging || isFocused;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div style={{ background: 'white', borderRadius: '10px', padding: '28px', width: '97vw', maxWidth: 'none', height: '94vh', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
        <div style={{ fontSize: '16px', fontWeight: '500', marginBottom: '16px' }}>Upload Incomplete</div>

        {!previewRows ? (
          // MARKER_VATWATCHLISTOPS_SIMPLIFY_V1
          // ── ดูเรียบเหมือนกล่อง Paste Text ธรรมดา แต่ยัง Drop File / Double-Click ──
          // ── Browse ได้เหมือนเดิม แค่ไม่มี UI โชว์แยกให้ดูรก ───────────────────────
          <textarea
            ref={textareaRef}
            value={selectedFile ? '' : pastedText}
            onChange={(e) => { setPastedText(e.target.value); if (e.target.value) setSelectedFile(null); }}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); }}
            onDoubleClick={() => fileInputRef.current && fileInputRef.current.click()}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={selectedFile ? `เลือกไฟล์แล้ว: ${selectedFile.name}` : 'วางข้อมูล (Ctrl+V) หรือลากไฟล์มาวางที่นี่'}
            wrap="off"
            style={{
              flex: 1,
              border: `2px dashed ${boxActive ? '#1a3a5c' : '#ccc'}`,
              borderRadius: '10px',
              background: boxActive ? '#eef3f9' : '#fafafa',
              boxShadow: isFocused ? '0 0 0 3px rgba(26,58,92,0.15)' : 'none',
              padding: '16px', fontSize: '13px', color: '#1a3a5c', resize: 'none',
              outline: 'none', transition: 'border-color 0.15s, background 0.15s, box-shadow 0.15s',
              fontFamily: 'Consolas, Menlo, monospace', marginBottom: '16px',
              whiteSpace: 'pre', overflowX: 'auto', overflowY: 'auto',
            }}
          />
        ) : (
          <div style={{ flex: 1, overflow: 'auto', border: '0.5px solid #e8e8e8', borderRadius: '10px', padding: '12px', marginBottom: '16px' }}>
            <div style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>Preview ข้อมูลที่ตรวจพบ ({previewRows.length} รายการ)</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#888' }}>
                  <th style={{ padding: '6px 8px' }}>Doc No.</th>
                  <th style={{ padding: '6px 8px' }}>BU</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, i) => (
                  <tr key={i} style={{ borderTop: '0.5px solid #f0f0f0' }}>
                    <td style={{ padding: '6px 8px' }}>{row.doc_no}</td>
                    <td style={{ padding: '6px 8px' }}>{row.bu}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{row.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <input ref={fileInputRef} type="file" onChange={(e) => handleFiles(e.target.files)} style={{ display: 'none' }} />

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '10px 16px', fontSize: '13px', border: '0.5px solid #ccc', background: 'transparent', borderRadius: '8px', cursor: 'pointer' }}>ปิด</button>
          {!previewRows ? (
            <button
              onClick={handleCheckData}
              disabled={!hasInput}
              style={{ padding: '10px 16px', fontSize: '13px', border: 'none', background: hasInput ? '#1a3a5c' : '#ccc', color: 'white', borderRadius: '8px', cursor: hasInput ? 'pointer' : 'not-allowed' }}
            >
              ตรวจสอบข้อมูล →
            </button>
          ) : (
            <button style={{ padding: '10px 16px', fontSize: '13px', border: 'none', background: '#0F6E56', color: 'white', borderRadius: '8px', cursor: 'pointer' }}>
              ยืนยันบันทึก
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function VatWatchlistUploadZone() {
  const [showModal, setShowModal] = React.useState(false);
  const { rows: recentUploads, loading: recentUploadsLoading } = useVatWatchlistRecentUploads(5);

  return (
    <div style={{ border: '0.5px solid #e8e8e8', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px', height: '100%', boxSizing: 'border-box' }}>
      <button
        onClick={() => setShowModal(true)}
        style={{ width: '100%', padding: '10px', fontSize: '13px', fontWeight: '500', border: 'none', borderRadius: '8px', background: '#1a3a5c', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
      >
        ⬆️ Upload Incomplete
      </button>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: '10px', fontWeight: '600', color: '#888', letterSpacing: '0.4px' }}>อัปโหลดล่าสุด</div>
        <div style={{ fontSize: '10px', color: '#555', cursor: 'pointer', textDecoration: 'underline' }}>ดูทั้งหมด</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '50px 1fr 60px', gap: '4px', padding: '2px 4px', fontSize: '10px', color: '#888' }}>
        <div>BU</div><div>Tax ID</div><div>Last update</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {recentUploadsLoading && <div style={{ fontSize: '11px', color: '#aaa', padding: '5px 4px' }}>กำลังโหลด...</div>}
        {!recentUploadsLoading && recentUploads.length === 0 && (
          <div style={{ fontSize: '11px', color: '#aaa', padding: '5px 4px' }}>ยังไม่มีการอัปโหลด</div>
        )}
        {recentUploads.map((row) => (
          <div key={row.bu} style={{ display: 'grid', gridTemplateColumns: '50px 1fr 60px', gap: '4px', padding: '5px 4px', fontSize: '11px', borderTop: '0.5px solid #f0f0f0' }}>
            <div style={{ fontWeight: '500' }}>{row.bu}</div>
            <div style={{ color: '#555', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.taxId}</div>
            <div style={{ color: row.overdue ? '#c0392b' : '#333' }} title="Cut Off Incomplete Time">{row.updatedAt}</div>
          </div>
        ))}
      </div>

      {showModal && <VatWatchlistUploadModal onClose={() => setShowModal(false)} />}
    </div>
  );
}

function VatWatchlistOpsLobby() {
  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', gap: '12px', flex: '35 1 0%' }}>
        <div style={{ ...vatWatchlistZoneStyle, flex: '65 1 0%' }}>65%</div>
        <div style={{ flex: '35 1 0%' }}><VatWatchlistUploadZone /></div>
      </div>
      <div style={{ ...vatWatchlistZoneStyle, flex: '65 1 0%' }}>
        MONITOR (company_list) — 65%
      </div>
    </div>
  );
}

export default function VatController({ activeSubTab = 'vat-watchlist-ops', onSubTabChange }) {
  if (activeSubTab === 'vat-watchlist-ops') {
    return <VatWatchlistOpsLobby />;
  }
  const title = VAT_MENU_LABEL_MAP[activeSubTab] || 'VAT Controller';
  return <PlaceholderPage title={title} />;
}