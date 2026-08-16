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

// MARKER_VATWATCHLISTOPS_PARSE_REAL_V1
// ── Port จาก VBA Option_Cutting_IncompleteforOfinyes (A_SystemAll_UI.xlam) ──
// ── Fixed-width Column Position ตรงกับ Header มาตรฐาน 21 คอลัมน์ ───────────
const VAT_WATCHLIST_COLUMNS = [
  { key: 'doc_date',        start: 0,   end: 10  },
  { key: 'doc_no',          start: 10,  end: 26  },
  { key: 'site',            start: 26,  end: 40  },
  { key: 'pay_group',       start: 40,  end: 50  },
  { key: 'branch',          start: 50,  end: 57  },
  { key: 'tax_type',        start: 57,  end: 75  },
  { key: 'invoice_ref',     start: 75,  end: 107 },
  { key: 'supplier_code',   start: 107, end: 123 },
  { key: 'vendor_name',     start: 123, end: 166 },
  { key: 'phone',           start: 166, end: 183 },
  { key: 'payment_date',    start: 183, end: 193 },
  { key: 'check_date',      start: 193, end: 205 },
  { key: 'check_no',        start: 205, end: 223 },
  { key: 'receive_doc_date',start: 223, end: 246 },
  { key: 'receive_doc_no',  start: 246, end: 262 },
  { key: 'exp_amount',      start: 262, end: 281 },
  { key: 'exp_vat',         start: 281, end: 298 },
  { key: 'avg_amount',      start: 298, end: 317 },
  { key: 'avg_vat',         start: 317, end: 333 },
  { key: 'ap_source',       start: 333, end: 359 },
  { key: 'ap_batch_name',   start: 359, end: null },
];

// ── บรรทัดข้อมูลจริงต้องขึ้นต้นด้วยรูปแบบวันที่ DD-MMM-YY (ข้าม Header/Dash/บรรทัดว่าง) ──
const VAT_WATCHLIST_DATE_LINE_RE = /^\s*\d{2}-[A-Z]{3}-\d{2}\b/;

function parseVatWatchlistRawText(rawText) {
  if (!rawText) return [];
  const lines = rawText.split(/\r?\n/);
  const rows = [];
  for (const line of lines) {
    if (!VAT_WATCHLIST_DATE_LINE_RE.test(line)) continue; // ข้าม Header/Dash/บรรทัดว่าง
    const row = {};
    for (const col of VAT_WATCHLIST_COLUMNS) {
      const raw = col.end != null ? line.slice(col.start, col.end) : line.slice(col.start);
      row[col.key] = (raw || '').trim();
    }
    rows.push(row);
  }
  return rows;
}

// MARKER_VATWATCHLISTOPS_TAXTYPE_CLASSIFY_V1
// ── Classify ประเภทภาษี: [Prefix?][Branch]-[N|M] [S]VAT7 -> N / A / T / F / M ──
const VAT_WATCHLIST_TAXTYPE_RE = /^([ATF]?)\d+-(N|M)\s+S?VAT7$/;

function classifyVatWatchlistTaxType(taxType) {
  if (!taxType) return null;
  const m = taxType.trim().match(VAT_WATCHLIST_TAXTYPE_RE);
  if (!m) return null;
  const prefix = m[1]; // '', 'A', 'T', 'F'
  const suffix = m[2]; // 'N' หรือ 'M'
  if (suffix === 'M') return 'M';
  if (prefix === 'A') return 'A';
  if (prefix === 'T') return 'T';
  if (prefix === 'F') return 'F';
  return 'N';
}

function VatWatchlistUploadModal({ onClose }) {
  const fileInputRef = React.useRef(null);
  const textareaRef = React.useRef(null);
  const previewHeaderRef = React.useRef(null);
  const previewBodyRef = React.useRef(null);
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

  const [isChecking, setIsChecking] = React.useState(false);
  const [checkSkippedCount, setCheckSkippedCount] = React.useState(0);

  const handleCheckData = async () => {
    // MARKER_VATWATCHLISTOPS_TAXTYPE_FILTER_WIRED_V1
    const sourceText = selectedFile ? '' : pastedText; // ไฟล์ยังไม่รองรับ Parse (รอ cp874 decode)
    const rawRows = parseVatWatchlistRawText(sourceText);

    setIsChecking(true);
    try {
      const [branches, companies] = await Promise.all([
        apiFetch('/branch_list'),
        apiFetch('/company_list'),
      ]);

      const branchToBu = {};
      (Array.isArray(branches) ? branches : []).forEach((b) => {
        branchToBu[b['Branch Code']] = b.bu;
      });
      const buToCompany = {};
      (Array.isArray(companies) ? companies : []).forEach((c) => {
        buToCompany[c.bu] = c;
      });

      let skipped = 0;
      const validRows = [];
      for (const row of rawRows) {
        const bu = branchToBu[row.branch];
        const company = bu ? buToCompany[bu] : null;
        const cls = classifyVatWatchlistTaxType(row.tax_type);
        const allowedRaw = company ? company.allowed_tax_type : null;

        // ── ไม่รู้ BU/Book หรือ Classify Tax Type ไม่ได้ -> ตัดออก (ปลอดภัยไว้ก่อน) ──
        if (!bu || !company || !allowedRaw || !cls) { skipped++; continue; }

        const allowedList = allowedRaw === 'All Type' ? null : allowedRaw.split(',').map((s) => s.trim());
        // ── Tax Type ไม่อยู่ใน List ที่ Book นั้นอนุญาต -> ตัดออก ไม่บันทึกเข้า Database ──
        if (allowedList && !allowedList.includes(cls)) { skipped++; continue; }

        validRows.push({ ...row, bu, book: company.BOOK, tax_class: cls });
      }

      setCheckSkippedCount(skipped);
      setPreviewRows(validRows);
    } catch (err) {
      console.error('handleCheckData error:', err);
      setPreviewRows(rawRows); // Fallback: Match ไม่ได้ก็โชว์ดิบไปก่อน ไม่ปิดกั้นผู้ใช้
    }
    setIsChecking(false);
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
          <div style={{ flex: 1, border: '0.5px solid #e8e8e8', borderRadius: '10px', marginBottom: '16px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ fontSize: '12px', color: '#888', padding: '10px 12px', borderBottom: '0.5px solid #e8e8e8', flexShrink: 0 }}>Preview ข้อมูลที่ตรวจพบ ({previewRows.length.toLocaleString()} รายการ)</div>

            {(() => {
              const VAT_PREVIEW_COLS = [
                { key: 'doc_date',        label: 'ว.ด.ป.',        width: 90  },
                { key: 'doc_no',          label: 'เลขที่',         width: 130 },
                { key: 'site',            label: 'Site',           width: 100 },
                { key: 'pay_group',       label: 'Pay Group',      width: 100 },
                { key: 'branch',          label: 'Branch',         width: 90  },
                { key: 'tax_type',        label: 'ประเภทภาษี',     width: 130 },
                { key: 'invoice_ref',     label: 'ใบแจ้งหนี้',      width: 160 },
                { key: 'supplier_code',   label: 'Supplier Code',  width: 120 },
                { key: 'vendor_name',     label: 'ชื่อผู้ค้า',       width: 260 },
                { key: 'phone',           label: 'เบอร์โทรศัพท์',   width: 130 },
                { key: 'payment_date',    label: 'ชำระเงิน',       width: 100 },
                { key: 'check_date',      label: 'เช็ค',            width: 100 },
                { key: 'check_no',        label: 'เลขที่เช็ค',      width: 150 },
                { key: 'receive_doc_date',label: 'Receive Doc.',   width: 130 },
                { key: 'receive_doc_no',  label: 'เลขที่ GRT',      width: 130 },
                { key: 'exp_amount',      label: 'มูลค่าสินค้า',    width: 110, align: 'right' },
                { key: 'exp_vat',         label: 'เงินภาษี',        width: 100, align: 'right' },
                { key: 'avg_amount',      label: 'มูลค่าสินค้า',    width: 110, align: 'right' },
                { key: 'avg_vat',         label: 'เงินภาษี',        width: 100, align: 'right' },
                { key: 'ap_source',       label: 'AP Source',      width: 130 },
                { key: 'ap_batch_name',   label: 'AP Batch Name',  width: 200 },
              ];
              const totalWidth = VAT_PREVIEW_COLS.reduce((sum, c) => sum + c.width, 0);

              const handleHeaderScroll = (e) => {
                if (previewBodyRef.current) previewBodyRef.current.scrollLeft = e.target.scrollLeft;
              };
              const handleBodyScroll = (e) => {
                if (previewHeaderRef.current) previewHeaderRef.current.scrollLeft = e.target.scrollLeft;
              };

              return (
                <>
                  {/* MARKER_VATWATCHLISTOPS_FREEZE_HEADER_V1 — Header แยกคนละตารางจาก Body เด็ดขาด */}
                  <div ref={previewHeaderRef} onScroll={handleHeaderScroll} style={{ overflowX: 'hidden', overflowY: 'hidden', flexShrink: 0 }}>
                    <table style={{ width: totalWidth, borderCollapse: 'collapse', fontSize: '12px', whiteSpace: 'nowrap' }}>
                      <thead>
                        <tr>
                          {VAT_PREVIEW_COLS.map((col) => (
                            <th key={col.key} style={{ width: col.width, minWidth: col.width, padding: '8px 10px', background: '#1a3a5c', color: 'white', fontWeight: '500', textAlign: col.align || 'left' }}>
                              {col.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                    </table>
                  </div>

                  {/* Body — Scroll แนวตั้งอิสระ, Scroll แนวนอน Sync กับ Header ด้านบน */}
                  <div ref={previewBodyRef} onScroll={handleBodyScroll} style={{ flex: 1, overflow: 'auto' }}>
                    <table style={{ width: totalWidth, borderCollapse: 'collapse', fontSize: '12px', whiteSpace: 'nowrap' }}>
                      <tbody>
                        {previewRows.map((row, i) => (
                          <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#f7f9fb', borderTop: '0.5px solid #e8e8e8' }}>
                            {VAT_PREVIEW_COLS.map((col) => (
                              <td key={col.key} style={{ width: col.width, minWidth: col.width, padding: '6px 10px', textAlign: col.align || 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {row[col.key]}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              );
            })()}
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