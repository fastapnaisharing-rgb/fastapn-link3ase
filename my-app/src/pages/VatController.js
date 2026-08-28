import React from "react";
import { VAT_CONTROLLER_MENU } from "../menuConfig";
import { apiFetch } from "../api"; // MARKER_VATWATCHLISTOPS_FIX_TR_WHITESPACE_V1 // MARKER_VATWATCHLISTOPS_APIFETCH_IMPORT_V1
import { subscribeWs, broadcastWs } from "../wsManager"; // MARKER_VATWATCHLISTOPS_BROADCAST_LISTENER_V1 MARKER_VATWATCHLISTOPS_DELETE_BU_ACTION_V1
import { useAuth } from "../contexts/AuthContext"; // MARKER_VATWATCHLISTOPS_ACTION_LOG_V1
import { confirmDialog } from "../confirmDialog"; // MARKER_VATWATCHLISTOPS_CONFIRMDIALOG_IMPORT_V1

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

  // MARKER_VATWATCHLISTOPS_RECENTUPLOADS_REALTIME_FIX_V1
  // ── แยก fetchData ออกมาเรียกซ้ำได้ + เพิ่ม subscribeWs ให้ Refresh อัตโนมัติ ──
  const fetchData = React.useCallback(async () => {
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
          updatedAt: `${String(updatedDate.getDate()).padStart(2, '0')}-${String(updatedDate.getMonth() + 1).padStart(2, '0')}-${updatedDate.getFullYear()}`, // MARKER_VATWATCHLISTOPS_DATE_DDMMYYYY_V1
          overdue: daysAgo > VAT_WATCHLIST_OVERDUE_DAYS,
        };
      });
      setRows(top);
    } catch (err) {
      console.error('useVatWatchlistRecentUploads error:', err);
      setRows([]);
    }
    setLoading(false);
  }, [limit]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await fetchData();
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [fetchData]);

  // ── รับ Broadcast Real-time เวลา Company ถูกแก้จากหน้าอื่น (Upload/Delete/Config) ──
  React.useEffect(() => {
    const unsubscribe = subscribeWs(['company_list_updated'], () => {
      fetchData();
    });
    return unsubscribe;
  }, [fetchData]);

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

// MARKER_VATWATCHLISTOPS_NUMERIC_COMMA_FIX_V1
// ── Field ตัวเลขที่ต้องตัด Comma คั่นหลักพันออกก่อนส่งเข้า Column numeric ────
const VAT_WATCHLIST_NUMERIC_FIELDS = ['exp_amount', 'exp_vat', 'avg_amount', 'avg_vat'];

function parseVatWatchlistRawText(rawText) {
  if (!rawText) return [];
  const lines = rawText.split(/\r?\n/);
  const rows = [];
  for (const line of lines) {
    if (!VAT_WATCHLIST_DATE_LINE_RE.test(line)) continue; // ข้าม Header/Dash/บรรทัดว่าง
    const row = {};
    for (const col of VAT_WATCHLIST_COLUMNS) {
      const raw = col.end != null ? line.slice(col.start, col.end) : line.slice(col.start);
      let value = (raw || '').trim();
      if (VAT_WATCHLIST_NUMERIC_FIELDS.includes(col.key)) {
        value = value.replace(/,/g, ''); // ตัด Comma คั่นหลักพันออก -> Postgres numeric รับได้
      }
      row[col.key] = value;
    }
    rows.push(row);
  }
  return rows;
}

// MARKER_VATWATCHLISTOPS_TAXTYPE_CLASSIFY_V1
// ── Classify ประเภทภาษี: [Prefix?][Branch]-[N|M] [S]VAT7 -> N / A / T / F / M ──
const VAT_WATCHLIST_TAXTYPE_RE = /^([ATF]?)\d+-(N|M)\s+S?VAT7$/;

// MARKER_VATWATCHLISTOPS_INCOMPLETE_TO_PARSE_V1
// ── ดึงวันที่ตัวหลังจากบรรทัดหัวรายงาน "ตั้งแต่วันที่ : DD-MMM-YY - DD-MMM-YY" ──
// ── เก็บเป็น vat_watchlist_incomplete_to (Column เดิมที่ยังไม่เคยมีใครเขียนค่าเข้า) ──
const VAT_WATCHLIST_INCOMPLETE_TO_RE = /\u0e15\u0e31\u0e49\u0e07\u0e41\u0e15\u0e48\u0e27\u0e31\u0e19\u0e17\u0e35\u0e48\s*:?\s*\d{2}-[A-Z]{3}-\d{2}\s*-\s*(\d{2}-[A-Z]{3}-\d{2})/;

function extractVatWatchlistIncompleteToDate(rawText) {
  if (!rawText) return null;
  const m = rawText.match(VAT_WATCHLIST_INCOMPLETE_TO_RE);
  if (!m) return null;
  const d = new Date(m[1]); // Format เดียวกับที่ระบบใช้ Parse Data Row อยู่แล้ว (DD-MMM-YY)
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function classifyVatWatchlistTaxType(taxType) {
  if (!taxType) return null;
  const m = taxType.trim().match(VAT_WATCHLIST_TAXTYPE_RE);
  if (!m) return null;
  const prefix = m[1]; // '', 'A', 'T', 'F'
  const suffix = m[2]; // 'N' หรือ 'M'
  const cls = suffix === 'M' ? 'M' : (prefix === 'A' ? 'A' : prefix === 'T' ? 'T' : prefix === 'F' ? 'F' : 'N');
  return { cls, prefix, suffix };
}

// MARKER_VATWATCHLISTOPS_SAVE_INCOMPLETE_V1
// ── Field คำนวณสำหรับ vat_watchlist_report (Validate กับข้อมูลจริง 100% แล้ว) ──
function vatWatchlistMonthsDiff(d1, d2) {
  if (!d1 || !d2) return null;
  const a = new Date(d1);
  const b = new Date(d2);
  let months = (a.getFullYear() - b.getFullYear()) * 12 + (a.getMonth() - b.getMonth());
  if (a.getDate() < b.getDate()) months -= 1;
  return months;
}

// MARKER_VATWATCHLISTOPS_GRT_TRUECATEGORY_V1
// ── Category จริงของ Vendor (ไม่สน Unpaid) — ใช้กับ GRT Matching โดยเฉพาะ ──
function computeVatWatchlistTrueCategory(row, vendorCategoryByCode) {
  const supplierCode = (row.supplier_code || '').trim();
  const matched = vendorCategoryByCode[supplierCode];
  return (matched && matched['TYPE']) || 'OTH';
}

function computeVatWatchlistBusiness(row, vendorCategoryByCode, today) {
  const paymentDate = row.payment_date;
  const supplierCode = (row.supplier_code || '').trim();
  if (!paymentDate) {
    const months = vatWatchlistMonthsDiff(today, row.doc_date);
    return (months !== null && months >= 3) ? 'N-PO3' : 'N-PAY';
  }
  return computeVatWatchlistTrueCategory(row, vendorCategoryByCode);
}

function computeVatWatchlistSubType(business, row, vendorCategoryByCode) {
  if (business === 'N-PAY' || business === 'N-PO3') return business;
  const supplierCode = (row.supplier_code || '').trim();
  const matched = vendorCategoryByCode[supplierCode];
  return (matched && matched['SUB TYPE']) || 'OTH'; // MARKER_VATWATCHLISTOPS_FIX_SUBTYPE_FALLBACK_V1
}

function computeVatWatchlistPaymentType(business, row) { // MARKER_VATWATCHLISTOPS_FIX_PAYMENTTYPE_UNPAID_V1
  if (business === 'N-PAY' || business === 'N-PO3') return 'Unpaid';
  const vendorName = row.vendor_name || '';
  if (vendorName.includes('Check Return') || vendorName.includes('Check Cancel')) return 'Cheque Return';
  const checkNo = row.check_no || '';
  if (checkNo.includes('-EFT')) return 'Electronic';
  if (checkNo.includes('-CHECK')) return 'Cheque';
  return '';
}

function computeVatWatchlistRelatedPersons(business, row) {
  if (business === 'N-PAY') return 'Unpaid';
  if (business === 'N-PO3') return 'HOLD/CONVERT';
  const invoiceRef = row.invoice_ref || '';
  const apBatchName = row.ap_batch_name || '';
  const site = row.site || '';
  const checkNo = row.check_no || '';
  const receiveDoc = row.receive_doc_no;
  const payGroup = row.pay_group || '';
  const supplierCode = (row.supplier_code || '').trim();

  if ((business === 'ITC' && invoiceRef[0] === 'A') || (business === 'CPN' && invoiceRef[0] === 'P')) {
    if (apBatchName.includes('ITC')) {
      if (site.slice(0, 3) === 'CRG') return 'E-TAX';
      return business === 'CPN' ? 'E-TAX' : 'INTERCOM';
    }
    return 'E-TAX';
  }
  if (business === 'LAND' && checkNo.includes('-EFT')) return 'BU';
  if (business === 'OTH' && (payGroup.includes('ALREADY') || checkNo.includes('-EFT'))) return 'BU';
  if (checkNo.includes('CHECK') && !receiveDoc) return 'FIN-PAY';
  if ((business === 'OTH' || business === 'UTL') && checkNo.includes('CHECK') && receiveDoc) return 'Docroom';
  if (business === 'UTL' && checkNo.includes('-EFT')) return supplierCode === 'N-130145' ? 'E-TAX' : 'Docroom';
  return business === 'ITC' ? 'E-TAX' : 'BU';
}

// ── Aging: 0-6 Month + Expired, เทียบ ชำระเงิน กับ Current Period ──────────
// ── N-PAY/N-PO3 (ยังไม่จ่าย) -> 'IV-Aging Uncount' เสมอ ────────────────────
// MARKER_VATWATCHLISTOPS_PERIOD_MODE_OVERRIDE_V1
// ── BU ที่ vat_period_mode='prev' → ใช้ Period ก่อนหน้า Global Current Period อีก 1 เดือน ──
function getEffectivePeriodMonth(company, currentPeriodMonth) {
  if (!currentPeriodMonth) return null;
  if (!company || company.vat_period_mode !== 'prev') return currentPeriodMonth;
  const d = new Date(currentPeriodMonth + '-01');
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// MARKER_VATWATCHLISTOPS_COMPUTE_GRT_V1
// ── GRT: คำนวณจาก Invoice Ref ตาม Logic Macro (A_SystemAll_UI.xlam) ────────
// ── เฉพาะ Type CPN/ITC เท่านั้น — Type อื่นใช้ receive_doc_no เดิมตรงๆ ──────
// MARKER_VATWATCHLISTOPS_COMPUTE_GRT_V2 — เวอร์ชันใหม่ ครอบคลุมกว่าเดิม
// MARKER_VATWATCHLISTOPS_COMPUTE_GRT_V3 — Decision Tree Confirm แล้ว, แก้ Dead Code Fallback
// MARKER_VATWATCHLISTOPS_COMPUTE_GRT_V4 — เพิ่มด่านแรกสุด: GRT เดิม <=14 ตัว เชื่อไว้ก่อน
// MARKER_VATWATCHLISTOPS_COMPUTE_GRT_V3_REVERTED — ตรงกับ Macro 100% ไม่มี Rule เพิ่มเอง
// MARKER_VATWATCHLISTOPS_COMPUTE_GRT_TRUE_V1 — ตรงกับ Sub จริง (Cut เข้า Column O) Validate 81.9%
// MARKER_VATWATCHLISTOPS_GRT_FINAL_V2 — สรุปรวม Logic ทั้งหมด Confirm จาก Screenshot Oracle EBS จริง
// MARKER_VATWATCHLISTOPS_GRT_FINAL_V3 — แก้ด่าน 0 (เชื่อ raw เมื่อมี /) + Mid-word Truncation ทุกตำแหน่ง
// MARKER_VATWATCHLISTOPS_GRT_FINAL_V4 — เช็ค Mid-word Truncation ก่อนด่าน 0 แม้ raw จะมี Slash
// MARKER_VATWATCHLISTOPS_GRT_FINAL_V5 — เช็ค Suffix ของ raw เองด้วยก่อนเชื่อเต็มๆ
// MARKER_VATWATCHLISTOPS_GRT_FINAL_V6 — เพิ่ม Rule Slash เดียว (เอาข้อความหลัง Slash)
// MARKER_VATWATCHLISTOPS_GRT_FINAL_V7 — Unified Logic (Suffix Type + Slash Count)
function computeVatWatchlistGrtDecideFromRef(refStr) {
  const last2 = refStr.slice(-2);
  const isLetterSuffix = ['/H', '/P'].includes(last2);
  const isNumberSuffix = ['/1', '/2', '/3', '.1', '.2', '.3'].includes(last2);
  const pos6Slash = refStr.length >= 6 && refStr.charAt(5) === '/';

  if (isLetterSuffix) {
    if (pos6Slash) {
      // ── Format P (ตำแหน่ง 6 เป็น /): ตัดข้อความกลาง Slash 1-2 ──
      const fs = refStr.indexOf('/');
      const ss = fs === -1 ? -1 : refStr.indexOf('/', fs + 1);
      if (fs !== -1 && ss !== -1 && ss > fs + 1) {
        return refStr.substring(fs + 1, ss);
      }
      return refStr;
    }
    // ── Format I (ตำแหน่ง 6 ไม่ใช่ /): ตัดแค่ 2 ตัวท้ายทิ้ง ──
    return refStr.length > 2 ? refStr.slice(0, -2) : refStr;
  }

  if (isNumberSuffix) {
    // ── ตัวเลข (/1,/2,/3,.1,.2,.3) -> ตัดแค่ท่อนสุดท้ายทิ้ง เก็บที่เหลือ ──
    const lastSlash = refStr.lastIndexOf('/');
    if (lastSlash > 0) {
      return refStr.substring(0, lastSlash);
    }
    return refStr;
  }

  // ── ไม่มี Suffix พิเศษ -> เช็คจำนวน Slash ทั้งหมด ──────────────────
  const slashCount = (refStr.match(/\//g) || []).length;
  if (slashCount === 2) {
    const fs = refStr.indexOf('/');
    const ss = refStr.indexOf('/', fs + 1);
    if (ss > fs + 1) {
      return refStr.substring(fs + 1, ss);
    }
    return refStr;
  }
  if (slashCount === 1) {
    const fs = refStr.indexOf('/');
    if (fs < refStr.length - 1) {
      return refStr.substring(fs + 1);
    }
    return refStr;
  }
  // 0 หรือ 3+ Slash -> เก็บเต็มๆ ทั้งหมด
  return refStr;
}

function computeVatWatchlistGrt(row, business) {
  const ref = row.invoice_ref || '';
  const raw = row.receive_doc_no || '';

  // ── ตรวจจับ Mid-word Truncation ก่อนทุกอย่าง ──────────────────
  function isMidWordTruncation(refStr, rawStr) {
    if (!rawStr) return false;
    const idx = refStr.indexOf(rawStr);
    if (idx === -1) return false;
    if (refStr.length <= idx + rawStr.length) return false;
    return refStr.charAt(idx + rawStr.length) !== '/';
  }
  const truncated = isMidWordTruncation(ref, raw);

  // ── ด่านที่ 0: raw มี "/" และ "ไม่เท่ากับ ref" และไม่ใช่ Truncation ──
  // ── (raw != ref แปลว่าผ่านการ Process มาแล้วบางส่วน เชื่อได้) ──
  if (raw.indexOf('/') !== -1 && raw !== ref && !truncated) {
    return raw;
  }

  // ── ด่านที่ 1: raw สั้น <=14 ตัว และไม่ใช่ Truncation -> เชื่อไว้เลย ──
  if (raw && raw.length <= 14 && !truncated) {
    return raw;
  }

  // ── ด่านที่ 2: เข้าเงื่อนไข CPN/ITC หรือไม่ ──────────────────────
  const apSource = row.ap_source || '';
  const payGroup = row.pay_group || '';
  const isSpecialType = business === 'CPN' || business === 'ITC' ||
    apSource === 'ITCCPN' || payGroup === 'ITCCPN' || apSource === 'ITC';
  if (!isSpecialType) {
    return truncated ? (ref || raw) : raw;
  }

  // ── ด่านที่ 3: ref มี Underscore -> ตัดก่อน Underscore ──────────────
  const underscoreIdx = ref.indexOf('_');
  if (underscoreIdx > 0) {
    return ref.substring(0, underscoreIdx);
  }

  // ── ด่านที่ 4: ใช้ Unified Logic กับ ref ────────────────────────
  return computeVatWatchlistGrtDecideFromRef(ref) || raw;
}

function computeVatWatchlistAging(business, row, currentPeriodMonth) {
  if (business === 'N-PAY' || business === 'N-PO3') {
    return { months: null, label: 'IV-Aging Uncount' };
  }
  if (!currentPeriodMonth || !row.payment_date) {
    return { months: null, label: null };
  }
  const parts = currentPeriodMonth.split('-').map(Number);
  const cy = parts[0], cm = parts[1];
  const pd = new Date(row.payment_date);
  const py = pd.getFullYear();
  const pm = pd.getMonth() + 1;
  const diff = (cy - py) * 12 + (cm - pm);
  if (diff <= 0) return { months: 0, label: 'Aging 0 Month' };
  if (diff <= 6) return { months: diff, label: `Aging ${diff} Month` };
  return { months: diff, label: 'Expired' };
}

// MARKER_VATWATCHLISTOPS_PREVIEW_PAGINATION_SIZE_V1
const VAT_WATCHLIST_PREVIEW_PAGE_SIZE = 200; // จำนวนแถว/หน้า ของตาราง Preview (กัน Render ทีเดียวหมื่นกว่าแถว)

function VatWatchlistUploadModal({ onClose }) {
  const { userName, currentUser } = useAuth(); // MARKER_VATWATCHLISTOPS_ACTION_LOG_V1
  const fileInputRef = React.useRef(null);
  const textareaRef = React.useRef(null);
  const previewHeaderRef = React.useRef(null);
  const previewBodyRef = React.useRef(null);
  const [selectedFile, setSelectedFile] = React.useState(null);
  // MARKER_VATWATCHLISTOPS_UNCONTROLLED_TEXTAREA_V1
  const [hasTextInput, setHasTextInput] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const [isFocused, setIsFocused] = React.useState(false);
  const [previewRows, setPreviewRows] = React.useState(null);
  const [buFilter, setBuFilter] = React.useState(null); // MARKER_VATWATCHLISTOPS_FILTER_BY_BU_V1
  // MARKER_VATWATCHLISTOPS_FIX_DISPLAYROWS_SCOPE_V1 — ย้ายมาไว้บนสุด กัน TDZ Bug (ใช้ก่อนประกาศ)
  const displayRows = previewRows ? (buFilter ? previewRows.filter((r) => r.bu === buFilter) : previewRows) : [];
  const previewBuTabs = previewRows ? [...new Set(previewRows.map((r) => r.bu).filter(Boolean))].sort() : [];
  // MARKER_VATWATCHLISTOPS_PREVIEW_PAGINATION_V1
  // ── Preview เป็นหน้า กัน Render 10,000+ แถวพร้อมกันทีเดียวจนจอค้าง ──
  // ── (ข้อมูล Save ยังอ่านจาก previewRows ครบทุกแถวเหมือนเดิม ไม่กระทบ) ──
  const [previewPage, setPreviewPage] = React.useState(1);
  const previewTotalPages = Math.max(1, Math.ceil(displayRows.length / VAT_WATCHLIST_PREVIEW_PAGE_SIZE));
  const previewPageStart = (previewPage - 1) * VAT_WATCHLIST_PREVIEW_PAGE_SIZE;
  const previewPageEnd = Math.min(previewPageStart + VAT_WATCHLIST_PREVIEW_PAGE_SIZE, displayRows.length);
  const pagedDisplayRows = displayRows.slice(previewPageStart, previewPageEnd);
  React.useEffect(() => { setPreviewPage(1); }, [buFilter, previewRows]);
  const [incompleteToIso, setIncompleteToIso] = React.useState(null); // MARKER_VATWATCHLISTOPS_INCOMPLETE_TO_STATE_V1

  // MARKER_VATWATCHLISTOPS_SCROLLRESET_V1
  // ── หลัง Paste Cursor จะอยู่ท้ายข้อความ ทำให้ Browser Auto-Scroll ไปขวา ──────
  // ── Reset ไปซ้ายสุด-บนสุดเสมอ จะได้เห็นคอลัมน์สำคัญ (วันที่/เลขที่) ก่อน ─────
  // (Scroll Reset Logic ย้ายเข้า onChange ของ Textarea โดยตรงแล้ว — ไม่ต้องพึ่ง pastedText Dependency อีก)

  const handleFiles = (files) => {
    if (files && files[0]) {
      setSelectedFile(files[0]);
      setHasTextInput(false);
      if (textareaRef.current) textareaRef.current.value = '';
    }
  };

  const hasInput = !!selectedFile || hasTextInput;

  const [isChecking, setIsChecking] = React.useState(false);
  const [checkSkippedCount, setCheckSkippedCount] = React.useState(0);

  // MARKER_VATWATCHLISTOPS_BU_GROUP_RANGE_FALLBACK_V1
  // ── Match Branch Code กับ Group Range Config (เช่น CRG 5000-5249) ──────────
  // ── ใช้เฉพาะตอน Branch->branch_list และ Segment3 Fallback หา BU ไม่เจอทั้งคู่ ──
  const matchVatWatchlistBuGroup = (branchCode, groupRanges) => {
    if (!branchCode || !groupRanges || groupRanges.length === 0) return null;
    let bestMatch = null;
    let bestSpan = Infinity;
    for (const r of groupRanges) {
      const len = r.prefix_length; // 3, 4, หรือ null (Full)
      const key = len ? String(branchCode).slice(0, len) : String(branchCode);
      if (r.exclude_start && r.exclude_end && key >= r.exclude_start && key <= r.exclude_end) continue;
      if (key >= r.range_start && key <= r.range_end) {
        // Range แคบสุด (Specific สุด) ชนะ ถ้า Match หลาย Config พร้อมกัน
        const span = (Number(r.range_end) || 0) - (Number(r.range_start) || 0);
        if (span < bestSpan) { bestSpan = span; bestMatch = r.group_name; }
      }
    }
    return bestMatch;
  };

  const handleCheckData = async () => {
    // MARKER_VATWATCHLISTOPS_TAXTYPE_FILTER_WIRED_V1
    // MARKER_VATWATCHLISTOPS_FILE_DECODE_V1
    // ── รองรับทั้ง Paste และเลือกไฟล์ — ไฟล์ต้นทางเป็น Encoding windows-874 (Thai Legacy) ──
    let sourceText = textareaRef.current ? textareaRef.current.value : '';
    if (selectedFile) {
      const buffer = await selectedFile.arrayBuffer();
      try {
        sourceText = new TextDecoder('windows-874').decode(buffer);
      } catch (err) {
        console.error('decode windows-874 failed, fallback to utf-8:', err);
        sourceText = new TextDecoder('utf-8').decode(buffer);
      }
    }
    const rawRows = parseVatWatchlistRawText(sourceText);
    setIncompleteToIso(extractVatWatchlistIncompleteToDate(sourceText));

    setIsChecking(true);
    try {
      const [branches, companies, vendorCategories, periodStatus, buGroupRanges] = await Promise.all([
        apiFetch('/branch_list'),
        apiFetch('/company_list'),
        apiFetch('/vendor_category'),
        apiFetch('/vat/period/status').catch(() => null),
        apiFetch('/vat_watchlist_bu_group_range').catch(() => []), // MARKER_VATWATCHLISTOPS_BU_GROUP_RANGE_FALLBACK_V1
      ]);
      const groupRangesList = Array.isArray(buGroupRanges) ? buGroupRanges : [];

      const vendorCategoryByCode = {};
      (Array.isArray(vendorCategories) ? vendorCategories : []).forEach((v) => {
        const code = String(v['Code'] || '').trim();
        if (code) vendorCategoryByCode[code] = v;
      });
      // MARKER_VATWATCHLISTOPS_SIMPLIFY_CURRENT_PERIOD_V1
      // ── Backend (/vat/period/status) คำนวณ +1 เดือนให้แล้วใน vat_period_current_month ──
      // ── ใช้ตรงๆ ไม่ต้องคำนวณซ้ำที่ Frontend อีกต่อไป ──
      const currentPeriodMonth = periodStatus ? periodStatus.vat_period_current_month : null;
      const today = new Date();

      const branchToBu = {};
      (Array.isArray(branches) ? branches : []).forEach((b) => {
        branchToBu[b['Branch Code']] = b.bu;
      });
      const buToCompany = {};
      (Array.isArray(companies) ? companies : []).forEach((c) => {
        buToCompany[c.bu] = c;
      });
      // MARKER_VATWATCHLISTOPS_SEGMENT3_FALLBACK_V1
      // ── Fallback: Branch หา BU ไม่เจอใน branch_list -> ลองตัด Branch 4 หลักแรก
      // ── เทียบกับ company_list.SEGMENT3 แทน (กัน Branch หายไปเงียบๆ) ──────────
      const segment3ToCompany = {};
      (Array.isArray(companies) ? companies : []).forEach((c) => {
        if (c.SEGMENT3) segment3ToCompany[c.SEGMENT3] = c;
      });

      let skipped = 0;
      const validRows = [];
      for (const row of rawRows) {
        let bu = branchToBu[row.branch];
        let company = bu ? buToCompany[bu] : null;
        if (!company) {
          const seg = (row.branch || '').slice(0, 4);
          const matchedBySeg = segment3ToCompany[seg];
          if (matchedBySeg) {
            company = matchedBySeg;
            bu = matchedBySeg.bu;
          }
        }
        // MARKER_VATWATCHLISTOPS_BU_GROUP_RANGE_FALLBACK_V1
        // ── ยังหา BU ไม่เจอ (ทั้ง branch_list และ Segment3) -> ลอง Group Range Config ──
        let groupName = null;
        if (!company) {
          const matchedGroup = matchVatWatchlistBuGroup(row.branch, groupRangesList);
          if (matchedGroup) {
            const groupCompany = buToCompany[matchedGroup];
            if (groupCompany) {
              company = groupCompany;
              bu = matchedGroup;
              groupName = matchedGroup;
            }
          }
        }
        const classified = classifyVatWatchlistTaxType(row.tax_type);
        const allowedRaw = company ? company.allowed_tax_type : null;

        // ── ไม่รู้ BU/Book หรือ Classify Tax Type ไม่ได้ -> ตัดออก (ปลอดภัยไว้ก่อน) ──
        if (!bu || !company || !allowedRaw || !classified) { skipped++; continue; }

        const { cls, suffix } = classified;
        const allowedList = allowedRaw === 'All Type' ? null : allowedRaw.split(',').map((s) => s.trim());
        // MARKER_VATWATCHLISTOPS_ALLTYPE_EXCLUDE_M_V1
        // ── All Type ไม่นับรวม M อัตโนมัติ -- ต้องระบุ M เจาะจงใน allowed_tax_type เองเท่านั้นถึงจะรับ ──
        if (allowedList === null && cls === 'M') { skipped++; continue; }

        const isAllowed = allowedList === null || allowedList.includes(cls);
        let needsRecheck = false;
        if (!isAllowed) {
          // MARKER_VATWATCHLISTOPS_RECHECK_RULE_V1
          // ── Suffix=N (ไม่ใช่ M) และ BU อนุญาต 'N' อยู่แล้ว -> Prefix (A/T/F) อาจพิมพ์ผิด ──
          // ── เนื้อในยังเป็น N ที่ถูกต้อง -> ไม่ตัดออก แค่ Flag Recheck ไว้ ──────────────
          const canRecheck = suffix === 'N' && allowedList && allowedList.includes('N');
          if (!canRecheck) { skipped++; continue; }
          needsRecheck = true;
        }

        const business = computeVatWatchlistBusiness(row, vendorCategoryByCode, today);
        const trueCategory = computeVatWatchlistTrueCategory(row, vendorCategoryByCode); // MARKER_VATWATCHLISTOPS_GRT_TRUECATEGORY_V1
        // MARKER_VATWATCHLISTOPS_TYPE_OVERRIDE_CPNITC_V1
        // ── Override Type เป็น CPN/ITC ตรงๆ เมื่อ Category จริงเป็น CPN/ITC แม้ยังไม่จ่าย ──
        const wasUnpaidOverride = (business === 'N-PAY' || business === 'N-PO3') &&
          (trueCategory === 'CPN' || trueCategory === 'ITC');
        const effectiveBusiness = wasUnpaidOverride ? trueCategory : business;
        const subType = wasUnpaidOverride ? effectiveBusiness : computeVatWatchlistSubType(business, row, vendorCategoryByCode);
        const paymentType = computeVatWatchlistPaymentType(business, row);
        const relatedPersons = computeVatWatchlistRelatedPersons(business, row);
        const effectivePeriodMonth = getEffectivePeriodMonth(company, currentPeriodMonth);
        const aging = computeVatWatchlistAging(business, row, effectivePeriodMonth);
        const computedGrt = computeVatWatchlistGrt(row, trueCategory); // ใช้ Category จริง ไม่สน Unpaid

        validRows.push({
          ...row, bu, book: company.BOOK, tax_class: cls, needs_recheck: needsRecheck, group_name: groupName, // MARKER_VATWATCHLISTOPS_BU_GROUP_RANGE_FALLBACK_V1
          bus_type: effectiveBusiness, sub_type: subType, payment_type: paymentType,
          related_persons: relatedPersons, period: effectivePeriodMonth,
          aging_months: aging.months, aging_label: aging.label,
          receive_doc_no: computedGrt,
        });
      }

      setCheckSkippedCount(skipped);
      setPreviewRows(validRows);
    } catch (err) {
      console.error('handleCheckData error:', err);
      setPreviewRows(rawRows); // Fallback: Match ไม่ได้ก็โชว์ดิบไปก่อน ไม่ปิดกั้นผู้ใช้
    }
    setIsChecking(false);
  };

  const [isSaving, setIsSaving] = React.useState(false);
  const [saveProgress, setSaveProgress] = React.useState(0); // MARKER_VATWATCHLISTOPS_SAVE_PROGRESS_V1

  const handleConfirmSave = async () => {
    if (!previewRows || previewRows.length === 0) return;
    setIsSaving(true);
    setSaveProgress(0);
    try {
      const bus = [...new Set(previewRows.map((r) => r.bu).filter(Boolean))];

      // MARKER_VATWATCHLISTOPS_BULK_SAVE_V1
      // ── ดึงข้อมูลเก่ามาไว้คำนวณ Summary + clearedBus เท่านั้น (ไม่ได้ใช้ Delete อีกต่อไป) ──
      const existing = await apiFetch('/vat_watchlist_report');
      const toDelete = (Array.isArray(existing) ? existing : []).filter((r) => bus.includes(r.bu));

      // ── สร้าง Payload ข้อมูลใหม่ทั้งหมด ──
      const payloads = previewRows.map((row) => ({
        doc_date: row.doc_date || null, doc_no: row.doc_no || null,
        site: row.site || null, pay_group: row.pay_group || null,
        branch: row.branch || null, tax_type: row.tax_type || null,
        invoice_ref: row.invoice_ref || null, supplier_code: row.supplier_code || null,
        vendor_name: row.vendor_name || null, phone: row.phone || null,
        payment_date: row.payment_date || null, check_date: row.check_date || null,
        check_no: row.check_no || null, receive_doc_date: row.receive_doc_date || null,
        receive_doc_no: row.receive_doc_no || null, exp_amount: row.exp_amount || null,
        exp_vat: row.exp_vat || null, avg_amount: row.avg_amount || null,
        avg_vat: row.avg_vat || null, ap_source: row.ap_source || null,
        ap_batch_name: row.ap_batch_name || null, bu: row.bu || null,
        bus_type: row.bus_type || null, sub_type: row.sub_type || null,
        payment_type: row.payment_type || null, related_persons: row.related_persons || null,
        period: row.period || null, aging_months: row.aging_months,
        aging_label: row.aging_label || null, status: 'pending',
      }));

      // MARKER_VATWATCHLISTOPS_TRANSACTION_REPLACE_V1
      // ── Delete BU เก่า + Insert ข้อมูลใหม่ทั้งหมด ในธุรกรรมเดียวกันที่ Backend ──
      // ── (All-or-Nothing: พังจุดไหนก็ตาม Backend จะ ROLLBACK กลับเป็นข้อมูลเก่าเป๊ะ) ──
      setSaveProgress(10);
      await apiFetch('/vat_watchlist_report/replace_bu', { method: 'POST', body: JSON.stringify({ bus, rows: payloads }) });
      setSaveProgress(100);

      // MARKER_VATWATCHLISTOPS_SAVE_UPDATE_COMPANYLIST_V1
      // ── Update company_list.vat_watchlist_last_incomplete_update ───────────────
      // MARKER_VATWATCHLISTOPS_FIX_CLEAR_OTHER_BU_V1
      // ── อัปเดตแค่ BU ที่อยู่ใน Batch รอบนี้เท่านั้น (Upload อาจเป็นแค่บาง BU ไม่ใช่ทั้งระบบ
      //    เดิมเข้าใจผิดว่า "1 Upload = ทุก BU ในระบบ" เลยไป Clear BU อื่นที่ไม่ได้อยู่ใน
      //    Batch นี้โดยไม่ตั้งใจ ทั้งที่ข้อมูลจริงของ BU นั้นยังอยู่ในตารางปกติ) ──
      const companiesForUpdate = await apiFetch('/company_list');
      const companyIdByBu = {};
      (Array.isArray(companiesForUpdate) ? companiesForUpdate : []).forEach((c) => {
        if (c.bu) companyIdByBu[c.bu] = c.id;
      });

      const nowIso = new Date().toISOString();

      for (const buCode of bus) {
        const cid = companyIdByBu[buCode];
        if (!cid) continue;
        await apiFetch(`/company_list/${cid}`, { method: 'PUT', body: JSON.stringify({
          vat_watchlist_last_incomplete_update: nowIso, vat_watchlist_incomplete_to: incompleteToIso,
          vat_watchlist_last_action: 'Uploaded', vat_watchlist_last_action_by: userName || currentUser?.email || '', vat_watchlist_last_action_at: nowIso, // MARKER_VATWATCHLISTOPS_ACTION_LOG_V1
        }) }); // MARKER_VATWATCHLISTOPS_INCOMPLETE_TO_SAVE_V1
      }

      // MARKER_VATWATCHLISTOPS_CONFIRMSAVE_BROADCAST_V1 — Refresh ตาราง Lobby แบบ Real-time
      broadcastWs('company_list_updated', { bus: [...bus] });

      // MARKER_VATWATCHLISTOPS_SAVE_SUMMARY_BY_BU_V1
      // ── สรุปยอดบันทึกแยกตาม BU (แทน Native window.alert() ตัวเก่า) เรียงมาก -> น้อย ──
      const countsByBu = previewRows.reduce((acc, r) => {
        const key = r.bu || '-';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      const summaryLines = Object.entries(countsByBu)
        .sort((a, b) => b[1] - a[1])
        .map(([buName, count]) => `${buName}: ${count.toLocaleString()} รายการ`)
        .join('\n');
      await confirmDialog.alert(
        `บันทึกสำเร็จทั้งหมด ${previewRows.length.toLocaleString()} รายการ (ลบของเก่า ${toDelete.length.toLocaleString()} รายการ)\n\nแยกตาม BU:\n${summaryLines}`,
        { title: 'บันทึกสำเร็จ', variant: 'success' }
      );
      onClose();
    } catch (err) {
      console.error('handleConfirmSave error:', err);
      alert('บันทึกไม่สำเร็จ: ' + err.message);
    }
    setIsSaving(false);
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
            defaultValue=""
            onChange={(e) => {
              const val = e.target.value;
              setHasTextInput(val.trim().length > 0);
              if (val) setSelectedFile(null);
              if (textareaRef.current) {
                textareaRef.current.scrollLeft = 0;
                textareaRef.current.scrollTop = 0;
                textareaRef.current.setSelectionRange(0, 0);
              }
            }}
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
            <div style={{ fontSize: '12px', color: '#888', padding: '10px 12px', borderBottom: '0.5px solid #e8e8e8', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span>Preview ข้อมูลที่ตรวจพบ ({displayRows.length.toLocaleString()} รายการ{buFilter ? ` จากทั้งหมด ${previewRows.length.toLocaleString()}` : ''})</span>
              {previewBuTabs.length > 1 && (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setBuFilter(null)}
                    style={{ padding: '4px 12px', fontSize: '12px', borderRadius: '14px', border: '0.5px solid #ccc', background: !buFilter ? '#1a3a5c' : 'white', color: !buFilter ? 'white' : '#555', cursor: 'pointer' }}
                  >All</button>
                  {previewBuTabs.map((b) => (
                    <button
                      key={b}
                      onClick={() => setBuFilter(b)}
                      style={{ padding: '4px 12px', fontSize: '12px', borderRadius: '14px', border: '0.5px solid #ccc', background: buFilter === b ? '#1a3a5c' : 'white', color: buFilter === b ? 'white' : '#555', cursor: 'pointer' }}
                    >{b}</button>
                  ))}
                </div>
              )}
            </div>

            {(() => {
              const VAT_PREVIEW_COLS = [
                { key: 'doc_date',        label: 'ว.ด.ป.',        width: 90  },
                { key: 'doc_no',          label: 'เลขที่',         width: 130 },
                { key: 'site',            label: 'Site',           width: 100 },
                { key: 'pay_group',       label: 'Pay Group',      width: 100 },
                { key: 'branch',          label: 'Branch',         width: 90  },
                { key: 'tax_type',        label: 'ประเภทภาษี',     width: 130 },
                { key: 'tax_class',       label: 'Tax Class',      width: 100 },
                { key: 'invoice_ref',     label: 'ใบแจ้งหนี้',      width: 240 }, // MARKER_VATWATCHLISTOPS_WIDEN_INVOICEREF_COL_V1
                { key: 'supplier_code',   label: 'Supplier Code',  width: 140 }, // MARKER_VATWATCHLISTOPS_FIX_COL_WIDTHS_V1
                { key: 'vendor_name',     label: 'ชื่อผู้ค้า',       width: 260 },
                { key: 'phone',           label: 'เบอร์โทรศัพท์',   width: 150 },
                { key: 'payment_date',    label: 'ชำระเงิน',       width: 100 },
                { key: 'check_date',      label: 'เช็ค',            width: 100 },
                { key: 'check_no',        label: 'เลขที่เช็ค',      width: 150 },
                { key: 'receive_doc_date',label: 'Receive Doc.',   width: 130 },
                { key: 'receive_doc_no',  label: 'เลขที่ GRT',      width: 200 }, // MARKER_VATWATCHLISTOPS_WIDEN_GRT_COL_V1
                { key: 'exp_amount',      label: 'มูลค่าสินค้า',    width: 130, align: 'right' },
                { key: 'exp_vat',         label: 'เงินภาษี',        width: 100, align: 'right' },
                { key: 'avg_amount',      label: 'มูลค่าสินค้า',    width: 130, align: 'right' },
                { key: 'avg_vat',         label: 'เงินภาษี',        width: 100, align: 'right' },
                { key: 'ap_source',       label: 'AP Source',      width: 130 },
                { key: 'ap_batch_name',   label: 'AP Batch Name',  width: 200 },
                { key: 'bu',              label: 'BU ที่จับได้แล้ว', width: 110, isMatch: true }, // MARKER_VATWATCHLISTOPS_MOVE_BU_BOOK_TO_COMPUTED_ZONE_V1
                { key: 'book',            label: 'Book (Match)',   width: 90,  isMatch: true },
                { key: 'bus_type',        label: 'Type',            width: 110, isMatch: true }, // MARKER_VATWATCHLISTOPS_RENAME_BUSINESS_TO_TYPE_V1 // MARKER_VATWATCHLISTOPS_PREVIEW_COMPUTED_COLS_V1
                { key: 'sub_type',        label: 'Sub Type',        width: 130, isMatch: true },
                { key: 'payment_type',    label: 'Payment Type',    width: 140, isMatch: true },
                { key: 'related_persons', label: 'Related Persons', width: 150, isMatch: true },
                { key: 'aging_label',     label: 'Aging',           width: 130, isMatch: true },
              ];
              const totalWidth = VAT_PREVIEW_COLS.reduce((sum, c) => sum + c.width, 0);

              return (
                <div style={{ flex: 1, overflow: 'auto' }}>
                  {/* MARKER_VATWATCHLISTOPS_FIX_TABLE_WHITESPACE_V1 — ย้าย Comment ออกจากการเป็น Child ของ table */}
                  <table style={{ width: totalWidth, borderCollapse: 'collapse', fontSize: '12px', whiteSpace: 'nowrap', tableLayout: 'fixed' }}>
                    <thead>
                      <tr>
                        {VAT_PREVIEW_COLS.map((col) => (
                          <th key={col.key} style={{ position: 'sticky', top: 0, zIndex: 1, width: col.width, minWidth: col.width, padding: '8px 10px', background: col.isMatch ? '#0F6E56' : '#1a3a5c', color: 'white', fontWeight: '500', textAlign: col.align || 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}> {/* MARKER_VATWATCHLISTOPS_PREVIEW_COMPUTED_COLOR_V1 */}
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pagedDisplayRows.map((row, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#f7f9fb', borderTop: '0.5px solid #e8e8e8' }}>
                          {VAT_PREVIEW_COLS.map((col) => (
                            col.key === 'bu' ? (
                              <td key={col.key} style={{ width: col.width, minWidth: col.width, padding: '6px 10px', textAlign: col.align || 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                <span
                                  onClick={() => setBuFilter((prev) => (prev === row.bu ? null : row.bu))}
                                  title="กดเพื่อกรองเฉพาะ BU นี้"
                                  style={{ cursor: 'pointer', textDecoration: 'underline', color: buFilter === row.bu ? '#0F6E56' : 'inherit', fontWeight: buFilter === row.bu ? '600' : 'normal' }}
                                >
                                  {row.bu}
                                </span>
                              </td>
                            ) : (
                              <td key={col.key} style={{ width: col.width, minWidth: col.width, padding: '6px 10px', textAlign: col.align || 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {row[col.key]}
                              </td>
                            )
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}

            {/* MARKER_VATWATCHLISTOPS_PREVIEW_PAGINATION_BAR_V1 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderTop: '0.5px solid #e8e8e8', flexShrink: 0, fontSize: '12px', color: '#666' }}>
              <span>แสดง {displayRows.length === 0 ? 0 : (previewPageStart + 1).toLocaleString()}–{previewPageEnd.toLocaleString()} จาก {displayRows.length.toLocaleString()} รายการ</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button
                  onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                  disabled={previewPage <= 1}
                  style={{ padding: '5px 12px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '6px', background: previewPage <= 1 ? '#f5f5f5' : 'white', color: previewPage <= 1 ? '#bbb' : '#333', cursor: previewPage <= 1 ? 'not-allowed' : 'pointer' }}
                >‹ ก่อนหน้า</button>
                <span>หน้า {previewPage} / {previewTotalPages}</span>
                <button
                  onClick={() => setPreviewPage((p) => Math.min(previewTotalPages, p + 1))}
                  disabled={previewPage >= previewTotalPages}
                  style={{ padding: '5px 12px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '6px', background: previewPage >= previewTotalPages ? '#f5f5f5' : 'white', color: previewPage >= previewTotalPages ? '#bbb' : '#333', cursor: previewPage >= previewTotalPages ? 'not-allowed' : 'pointer' }}
                >ถัดไป ›</button>
              </div>
            </div>
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
            <button
              onClick={handleConfirmSave}
              disabled={isSaving}
              style={{ padding: '10px 16px', fontSize: '13px', border: 'none', background: isSaving ? '#ccc' : '#0F6E56', color: 'white', borderRadius: '8px', cursor: isSaving ? 'not-allowed' : 'pointer' }}
            >
              {isSaving ? `กำลังบันทึก... ${saveProgress}%` : 'ยืนยันบันทึก'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// MARKER_VATWATCHLISTOPS_VIEWALL_MODAL_V1
// ── Modal "ดูทั้งหมด" — BU ที่ Active ทุกตัว + Action ล่าสุด (Uploaded/Deleted) ──
function VatWatchlistAllActiveModal({ onClose }) {
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState(''); // MARKER_VATWATCHLISTOPS_VIEWALL_SEARCH_FILTER_V1
  const [baseFilter, setBaseFilter] = React.useState('');
  // MARKER_VATWATCHLISTOPS_AGING_SUMMARY_V1
  const [agingSummary, setAgingSummary] = React.useState([]); // [{bu, aging_label, count}] จาก Backend Aggregation
  const [agingFilter, setAgingFilter] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // MARKER_VATWATCHLISTOPS_AGING_SUMMARY_FETCH_V1
        const [data, agingData] = await Promise.all([
          apiFetch('/company_list'),
          apiFetch('/vat_watchlist_report/aging_summary').catch(() => []),
        ]);
        const list = (Array.isArray(data) ? data : []).filter((c) => !c.deleted);
        const active = list.filter((c) => getVatWatchlistEffectiveStatus(c) === 'active');
        active.sort((a, b) => {
          const at = a.vat_watchlist_last_action_at ? new Date(a.vat_watchlist_last_action_at).getTime() : 0;
          const bt = b.vat_watchlist_last_action_at ? new Date(b.vat_watchlist_last_action_at).getTime() : 0;
          return bt - at;
        });
        if (!cancelled) {
          setRows(active);
          setAgingSummary(Array.isArray(agingData) ? agingData : []);
        }
      } catch (err) {
        console.error('VatWatchlistAllActiveModal error:', err);
        if (!cancelled) setRows([]);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const baseOptionsAll = React.useMemo(() => {
    const set = new Set(rows.map((c) => c.base).filter(Boolean));
    return Array.from(set).sort();
  }, [rows]);

  // MARKER_VATWATCHLISTOPS_AGING_SUMMARY_MAPS_V1
  // ── สรุปจำนวนแถวจาก vat_watchlist_report แยกตาม BU และ BU+Aging (มาจาก Backend GROUP BY) ──
  const countsByBu = React.useMemo(() => {
    const map = {};
    agingSummary.forEach((r) => { map[r.bu] = (map[r.bu] || 0) + Number(r.count || 0); });
    return map;
  }, [agingSummary]);

  const countsByBuAging = React.useMemo(() => {
    const map = {};
    agingSummary.forEach((r) => {
      const key = r.aging_label || '-';
      if (!map[r.bu]) map[r.bu] = {};
      map[r.bu][key] = Number(r.count || 0);
    });
    return map;
  }, [agingSummary]);

  const agingOptionsAll = React.useMemo(() => {
    const set = new Set(agingSummary.map((r) => r.aging_label || '-').filter(Boolean));
    return Array.from(set).sort();
  }, [agingSummary]);

  const filteredRows = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((c) => {
      if (baseFilter && c.base !== baseFilter) return false;
      // MARKER_VATWATCHLISTOPS_AGING_FILTER_V1 — เหลือเฉพาะ BU ที่มี Invoice ติด Aging ที่เลือกอยู่จริง
      if (agingFilter && !(countsByBuAging[c.bu] && countsByBuAging[c.bu][agingFilter] > 0)) return false;
      if (!q) return true;
      return (c.bu || '').toLowerCase().includes(q)
        || (c['ENGLISH COMPANY NAME'] || '').toLowerCase().includes(q)
        || (c['THAI COMPANY NAME'] || '').toLowerCase().includes(q)
        || (c['TAX ID'] || '').toLowerCase().includes(q);
    });
  }, [rows, search, baseFilter, agingFilter, countsByBuAging]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'white', borderRadius: '12px', width: '1000px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '0.5px solid #e8e8e8' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ fontSize: '15px', fontWeight: '500' }}>BU ทั้งหมด (Active)</div>
            {/* MARKER_VATWATCHLISTOPS_VIEWALL_COUNT_PILL_V1 — กล่องจำนวน Style เดียวกับ "Preview ข้อมูลที่ตรวจพบ" */}
            <div style={{ fontSize: '12px', color: '#666', background: '#f5f5f3', padding: '4px 12px', borderRadius: '14px' }}>{filteredRows.length.toLocaleString()} รายการ</div>
          </div>
          <button onClick={onClose} style={{ width: '28px', height: '28px', padding: 0, border: 'none', borderRadius: '50%', background: '#f0f0f0', cursor: 'pointer', fontSize: '14px', color: '#666' }}>×</button>
        </div>
        <div style={{ display: 'flex', gap: '10px', padding: '12px 20px', borderBottom: '0.5px solid #e8e8e8' }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            style={{ width: '300px', flex: '0 0 auto', padding: '7px 10px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '8px', boxSizing: 'border-box' }} // MARKER_VATWATCHLISTOPS_VIEWALL_SEARCH_WIDTH_V1
          />
          <select
            value={baseFilter}
            onChange={(e) => setBaseFilter(e.target.value)}
            style={{ padding: '7px 10px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '8px', minWidth: '140px' }}
          >
            <option value="">Base: ทั้งหมด</option>
            {baseOptionsAll.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          {/* MARKER_VATWATCHLISTOPS_AGING_FILTER_SELECT_V1 */}
          <select
            value={agingFilter}
            onChange={(e) => setAgingFilter(e.target.value)}
            style={{ padding: '7px 10px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '8px', minWidth: '140px' }}
          >
            <option value="">Aging: ทั้งหมด</option>
            {agingOptionsAll.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0px 20px 16px' }}> {/* MARKER_VATWATCHLISTOPS_VIEWALL_HEADER_FLUSH_V1 */}
          {loading && <div style={{ fontSize: '12px', color: '#aaa', padding: '12px 4px' }}>กำลังโหลด...</div>}
          {!loading && filteredRows.length === 0 && <div style={{ fontSize: '12px', color: '#aaa', padding: '12px 4px' }}>ไม่พบ BU ที่ตรงกับเงื่อนไข</div>}
          {!loading && filteredRows.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: '12px' }}>
              {/* MARKER_VATWATCHLISTOPS_VIEWALL_RESTYLE_V1 */}
              <thead>
                {/* MARKER_VATWATCHLISTOPS_VIEWALL_STICKY_V1 */}
                <tr>
                  <th style={{ padding: '14px 12px', textAlign: 'left', background: '#1a3a5c', color: 'white', fontWeight: '500', borderTopLeftRadius: '8px', position: 'sticky', top: 0, zIndex: 1 }}>BU</th>
                  <th style={{ padding: '14px 12px', textAlign: 'left', background: '#1a3a5c', color: 'white', fontWeight: '500', position: 'sticky', top: 0, zIndex: 1 }}>Company Name</th>
                  <th style={{ padding: '14px 12px', textAlign: 'right', background: '#1a3a5c', color: 'white', fontWeight: '500', position: 'sticky', top: 0, zIndex: 1 }}>จำนวนรายการ</th> {/* MARKER_VATWATCHLISTOPS_AGING_COUNT_COL_V1 */}
                  <th style={{ padding: '14px 12px', textAlign: 'left', background: '#1a3a5c', color: 'white', fontWeight: '500', position: 'sticky', top: 0, zIndex: 1 }}>Action ล่าสุด</th>
                  <th style={{ padding: '14px 12px', textAlign: 'left', background: '#1a3a5c', color: 'white', fontWeight: '500', position: 'sticky', top: 0, zIndex: 1 }}>โดย</th>
                  <th style={{ padding: '14px 12px', textAlign: 'left', background: '#1a3a5c', color: 'white', fontWeight: '500', borderTopRightRadius: '8px', position: 'sticky', top: 0, zIndex: 1 }}>เมื่อไหร่</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((c) => (
                  <tr
                    key={c.id}
                    style={{ borderTop: '0.5px solid #f0f0f0' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#f7f9fb'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <td style={{ padding: '9px 12px', fontWeight: '500' }}>{c.bu}</td>
                    <td style={{ padding: '9px 12px', color: '#555' }}>{c['ENGLISH COMPANY NAME']}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: '#555' }}> {/* MARKER_VATWATCHLISTOPS_AGING_COUNT_CELL_V1 */}
                      {(agingFilter ? ((countsByBuAging[c.bu] && countsByBuAging[c.bu][agingFilter]) || 0) : (countsByBu[c.bu] || 0)).toLocaleString()}
                    </td>
                    <td style={{ padding: '9px 12px' }}>
                      {c.vat_watchlist_last_action ? (
                        <span style={{
                          padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: '600',
                          background: c.vat_watchlist_last_action === 'Deleted' ? '#FCEBEB' : '#EAF3DE',
                          color: c.vat_watchlist_last_action === 'Deleted' ? '#791F1F' : '#27500A',
                        }}>
                          {c.vat_watchlist_last_action}
                        </span>
                      ) : '—'}
                    </td>
                    <td style={{ padding: '9px 12px', color: '#555' }}>{c.vat_watchlist_last_action_by || '—'}</td>
                    <td style={{ padding: '9px 12px', color: '#555' }}>{formatVatWatchlistDateTime(c.vat_watchlist_last_action_at)}</td>
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

function VatWatchlistUploadZone() {
  const [showModal, setShowModal] = React.useState(false);
  const [showAllModal, setShowAllModal] = React.useState(false); // MARKER_VATWATCHLISTOPS_VIEWALL_MODAL_V1
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
        <div onClick={() => setShowAllModal(true)} style={{ fontSize: '10px', color: '#555', cursor: 'pointer', textDecoration: 'underline' }}>ดูทั้งหมด</div>
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
      {showAllModal && <VatWatchlistAllActiveModal onClose={() => setShowAllModal(false)} />}
    </div>
  );
}

// MARKER_VATWATCHLISTOPS_MONITOR_TABLE_V1
// ── Zone Monitor (65% ล่าง) — ตาราง company_list พร้อม Tab/Search/Base Filter ──
// ── "Last incomplete date" ใช้ vat_watchlist_incomplete_to (Column ใหม่ —
//      รอ Migration + Parser Header รายงาน ถ้ายังไม่มีข้อมูลจะโชว์ "—") ──────────
// ── "Last update at" ใช้ vat_watchlist_last_incomplete_update (Column เดิม) ────
// MARKER_VATWATCHLISTOPS_STATUS_SYNC_V1
const VAT_WATCHLIST_MONITOR_TABS = [
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Inactive' },
  { key: 'unclaim', label: 'Unclaim' },
  { key: 'out_of_scope', label: 'Out of Scope' },
];

const VAT_WATCHLIST_MONITOR_EMPTY_TEXT = {
  active: 'ไม่พบข้อมูล',
  inactive: 'ยังไม่มี BU ที่ถูกกำหนดสถานะ Inactive',
  unclaim: 'ไม่มี BU ที่ VAT % เท่ากับ 0',
  out_of_scope: 'ยังไม่มี BU ที่ถูกกำหนดสถานะ Out of Scope',
};

function useVatWatchlistMonitorRows() {
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  const reloadRows = React.useCallback(async () => {
    try {
      const data = await apiFetch('/company_list');
      const list = (Array.isArray(data) ? data : []).filter((c) => !c.deleted);
      setRows(list);
    } catch (err) {
      console.error('useVatWatchlistMonitorRows error:', err);
      setRows([]);
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      await reloadRows();
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [reloadRows]);

  // ---------------- รับ Broadcast Real-time เวลา Company ถูกแก้จากหน้าอื่น ----------------
  React.useEffect(() => {
    const unsubscribe = subscribeWs(['company_list_updated'], () => {
      reloadRows();
    });
    return unsubscribe;
  }, [reloadRows]);

  return { rows, loading };
}

function formatVatWatchlistDate(value) { // MARKER_VATWATCHLISTOPS_DATE_DDMMYYYY_V1
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

function formatVatWatchlistDateTime(value) { // MARKER_VATWATCHLISTOPS_DATETIME_FORMAT_DDMMYYYY_V1
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// MARKER_VATWATCHLISTOPS_UNCLAIM_VATZERO_V1
// ── กฎจัด Tab: inactive (Manual Set) ชนะก่อนเสมอ > VAT%=0 -> unclaim (Auto) > active ──
// MARKER_VATWATCHLISTOPS_STATUS_SYNC_V1
// MARKER_VATWATCHLISTOPS_STATUS_NORMALIZE_V1
// ── Normalize รองรับทั้ง "Out of Scope" (เว้นวรรค จาก BusinessUnit.js) และ ──
// ── "out_of_scope" (Underscore จาก Config Modal ในหน้านี้เอง) ให้เป็นรูปแบบเดียวกัน ──
function getVatWatchlistEffectiveStatus(c) {
  const raw = (c.vat_watchlist_status || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (raw === 'inactive') return 'inactive';
  if (raw === 'unclaim') return 'unclaim';
  if (raw === 'out_of_scope') return 'out_of_scope';
  if (raw === 'active') return 'active';
  const vatPct = parseFloat(c['VAT %']);
  if (!isNaN(vatPct) && vatPct === 0) return 'unclaim';
  return 'active';
}

const VAT_MONITOR_COLS = [
  { key: 'bu', label: 'BU', width: 60, sortable: true }, // MARKER_VATWATCHLISTOPS_MONITOR_SORT_V1
  { key: 'name', label: 'English company name', width: 220 },
  { key: 'taxId', label: 'Tax ID', width: 120 },
  { key: 'vatPct', label: 'VAT %', width: 60, align: 'center' }, // MARKER_VATWATCHLISTOPS_VATPCT_CENTER_V1
  { key: 'book', label: 'Book', width: 60 },
  { key: 'taxType', label: 'Tax type', width: 110 }, // MARKER_VATWATCHLISTOPS_TAXTYPE_COL_V1
  { key: 'prepareBy', label: 'Prepare by', width: 110 },
  { key: 'lastIncomplete', label: 'Last incomplete date', width: 140, sortable: true },
  { key: 'lastUpdate', label: 'Last update at', width: 150, sortable: true },
  { key: 'action', label: 'Action', width: 80, align: 'center' }, // MARKER_VATWATCHLISTOPS_ACTION_COL_V1
];

// MARKER_VATWATCHLISTOPS_CONFIG_MODAL_V1
// MARKER_VATWATCHLISTOPS_CONFIG_MODAL_EXPAND_V1
// ── Config Modal ขยาย — ดึง Company Info + VAT Setting เต็มๆ จากหน้า Business Unit ──
// MARKER_VATWATCHLISTOPS_CONFIG_MODAL_RESTYLE_V1
// ── Config Modal — Style ตาม Mockup (Segmented Control, Section คั่นเส้น) ──
// MARKER_VATWATCHLISTOPS_CONFIG_MODAL_BOXSTYLE_V1
// ── Config Modal — Box Grid Style ตรงจากหน้า Business Unit เป๊ะ ────────────
function VatWatchlistConfigModal({ company, baseOptions, prepareByOptions, taxTypeOptions, onClose }) {
  const [form, setForm] = React.useState({
    bu: company.bu || '',
    BOOK: company.BOOK || '',
    'THAI COMPANY NAME': company['THAI COMPANY NAME'] || '',
    'ENGLISH COMPANY NAME': company['ENGLISH COMPANY NAME'] || '',
    'TAX ID': company['TAX ID'] || '',
    'COMPANY CODE': company['COMPANY CODE'] || '',
    SEGMENT3: company['SEGMENT3'] || '',
    'VAT %': company['VAT %'] || '',
    'Last Rate (%)': company['Last Rate (%)'] || '',
    'VAT GRT Control': company['VAT GRT Control'] || 'Auto', // MARKER_VATWATCHLISTOPS_GRTCONTROL_DEFAULT_AUTO_V1
    'PREPARE BY': company['PREPARE BY'] || '',
    DEPARTMENT: company['DEPARTMENT'] || '',
    vat_grn_pattern: company.vat_grn_pattern || '',
    vat_grn: company.vat_grn ?? 0,
    vat_digit: company.vat_digit || '',
    vat_watchlist_status: company.vat_watchlist_status || 'active',
    base: company.base || '',
    allowed_tax_type: company.allowed_tax_type || '',
  });
  const [saving, setSaving] = React.useState(false);
  const [prepareByOpen, setPrepareByOpen] = React.useState(false); // MARKER_VATWATCHLISTOPS_PREPAREBY_COMBO_V1
  const [taxTypeOpen, setTaxTypeOpen] = React.useState(false); // MARKER_VATWATCHLISTOPS_TAXTYPE_COMBO_V1

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiFetch(`/company_list/${company.id}`, {
        method: 'PUT',
        body: JSON.stringify(form),
      });
      broadcastWs('company_list_updated', { bu: company.bu });
      onClose();
    } catch (err) {
      console.error('VatWatchlistConfigModal save error:', err);
      alert('บันทึกไม่สำเร็จ: ' + err.message);
    }
    setSaving(false);
  };

  const boxWrap = { border: '0.5px solid #e0e0e0', borderRadius: '8px', overflow: 'hidden', marginBottom: '10px' };
  const headCell = (last) => ({ padding: '6px 10px', fontSize: '11px', fontWeight: '600', color: '#666', textAlign: 'center', background: '#f5f5f3', borderRight: last ? 'none' : '0.5px solid #e0e0e0', borderBottom: '0.5px solid #e0e0e0' });
  const inputCell = (last) => ({ padding: '6px 10px', borderRight: last ? 'none' : '0.5px solid #e0e0e0' });
  const cellInputStyle = { width: '100%', border: 'none', outline: 'none', background: 'transparent', fontSize: '13px', color: '#1a3a5c', padding: 0, boxSizing: 'border-box', textAlign: 'center' }; // MARKER_VATWATCHLISTOPS_CENTER_ALIGN_V1

  const renderRow = (fields) => (
    <div style={{ ...boxWrap, display: 'grid', gridTemplateColumns: `repeat(${fields.length}, 1fr)` }}>
      {fields.map(([key, label], i) => <div key={key + '_h'} style={headCell(i === fields.length - 1)}>{label}</div>)}
      {fields.map(([key, label, options], i) => (
        <div key={key + '_i'} style={inputCell(i === fields.length - 1)}>
          {options ? (
            <select style={cellInputStyle} value={form[key]} onChange={(e) => setField(key, e.target.value)}>
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input style={cellInputStyle} value={form[key]} onChange={(e) => setField(key, e.target.value)} />
          )}
        </div>
      ))}
    </div>
  );

  const renderFullRow = (key, label) => ( // MARKER_VATWATCHLISTOPS_BUMODAL_LEFTALIGN_V1
    <div style={boxWrap}>
      <div style={{ padding: '6px 10px', fontSize: '11px', fontWeight: '600', color: '#666', textAlign: 'center', background: '#f5f5f3', borderBottom: '0.5px solid #e0e0e0' }}>{label}</div>
      <div style={{ padding: '8px 10px' }}><input style={{ ...cellInputStyle, textAlign: 'left' }} value={form[key]} onChange={(e) => setField(key, e.target.value)} /></div>
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'white', borderRadius: '12px', width: '760px', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '16px 20px 12px', borderBottom: '0.5px solid #e8e8e8' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: '500' }}>{company.bu}</div>
            <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>{company['ENGLISH COMPANY NAME']}</div>
          </div>
          <button onClick={onClose} style={{ width: '28px', height: '28px', padding: 0, border: 'none', borderRadius: '50%', background: '#f0f0f0', cursor: 'pointer', fontSize: '14px', color: '#666' }}>×</button>
        </div>

        <div style={{ padding: '14px 20px', maxHeight: '78vh', overflowY: 'auto' }}>

          {renderRow([['bu', 'BU'], ['TAX ID', 'Tax ID'], ['COMPANY CODE', 'Company Code'], ['BOOK', 'Book']])}
          {renderFullRow('THAI COMPANY NAME', 'Thai Company Name')}
          {renderFullRow('ENGLISH COMPANY NAME', 'English Company Name')}
          {/* MARKER_VATWATCHLISTOPS_BASE_REVERT_DROPDOWN_V1 — Base กลับเป็น Dropdown ธรรมดาตามเดิม */}
          {renderRow([['VAT %', 'VAT %'], ['Last Rate (%)', 'Last Rate (%)'], ['SEGMENT3', 'Segment3'], ['base', 'Base', baseOptions.map((b) => ({ value: b, label: b }))]])}

          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', margin: '18px 0 10px' }}>
            <div style={{ width: '3px', height: '14px', background: '#0F6E56', borderRadius: '2px' }} />
            <div style={{ fontSize: '13px', fontWeight: '600', color: '#0F6E56' }}>VAT Setting</div>
            <div style={{ fontSize: '12px', color: '#999' }}>— VAT permission</div>
          </div>

          <div style={{ ...boxWrap, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
            <div style={headCell(false)}>GRT Control</div>
            <div style={headCell(false)}>Prepare By</div>
            <div style={headCell(true)}>Department</div>
            <div style={inputCell(false)}>
              <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                {['Manual', 'Semi-Auto', 'Auto'].map((m) => (
                  <button
                    key={m}
                    onClick={() => setField('VAT GRT Control', m)}
                    style={{
                      padding: '4px 10px', fontSize: '11px', fontWeight: '600', border: 'none', borderRadius: '14px', cursor: 'pointer',
                      background: form['VAT GRT Control'] === m ? '#1a3a5c' : '#f0f0ee',
                      color: form['VAT GRT Control'] === m ? 'white' : '#999',
                    }}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ ...inputCell(false), position: 'relative' }}>
              <input
                style={cellInputStyle}
                value={form['PREPARE BY']}
                onChange={(e) => setField('PREPARE BY', e.target.value)}
                onFocus={() => setPrepareByOpen(true)}
                onBlur={() => setTimeout(() => setPrepareByOpen(false), 150)}
                placeholder="พิมพ์หรือเลือกชื่อ"
              />
              {prepareByOpen && prepareByOptions && prepareByOptions.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '0.5px solid #ccc', borderRadius: '8px', marginTop: '4px', maxHeight: '160px', overflowY: 'auto', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.12)' }}>
                  {prepareByOptions
                    .filter((n) => n.toLowerCase().includes((form['PREPARE BY'] || '').toLowerCase()))
                    .map((n) => (
                      <div
                        key={n}
                        onMouseDown={() => { setField('PREPARE BY', n); setPrepareByOpen(false); }}
                        style={{ padding: '7px 10px', fontSize: '12px', cursor: 'pointer' }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f5f3')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'white')}
                      >
                        {n}
                      </div>
                    ))}
                </div>
              )}
            </div>
            <div style={inputCell(true)}><input style={cellInputStyle} value={form.DEPARTMENT} onChange={(e) => setField('DEPARTMENT', e.target.value)} /></div>
          </div>

          <div style={{ ...boxWrap, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr' }}>
            <div style={headCell(false)}>Status</div>
            <div style={headCell(false)}>Tax Type</div>
            <div style={headCell(false)}>GRN Pattern</div>
            <div style={headCell(false)}>GRN</div>
            <div style={headCell(true)}>Digit</div>
            <div style={inputCell(false)}>
              {(() => {
                // MARKER_VATWATCHLISTOPS_STATUS_CYCLE_BUTTON_V1
                // ── ปุ่มเดียว Cycle ไปเรื่อยๆ เหมือนหน้า Business Unit เป๊ะ ──────
                const STATUS_CYCLE = [
                  { value: 'active', label: 'Active', bg: '#EAF3DE', color: '#27500A' },
                  { value: 'inactive', label: 'Inactive', bg: '#F1EFE8', color: '#444441' },
                  { value: 'unclaim', label: 'Unclaim', bg: '#FAEEDA', color: '#854F0B' },
                  { value: 'out_of_scope', label: 'Out of scope', bg: '#E6F1FB', color: '#0C447C' },
                ];
                const idx = STATUS_CYCLE.findIndex((s) => s.value === form.vat_watchlist_status);
                const current = STATUS_CYCLE[idx >= 0 ? idx : 0];
                const cycleStatus = () => {
                  const next = STATUS_CYCLE[((idx >= 0 ? idx : 0) + 1) % STATUS_CYCLE.length];
                  setField('vat_watchlist_status', next.value);
                };
                return (
                  <button
                    onClick={cycleStatus}
                    style={{ width: '100%', padding: '5px 0', fontSize: '11px', fontWeight: '600', border: 'none', borderRadius: '14px', cursor: 'pointer', background: current.bg, color: current.color }}
                  >
                    {current.label}
                  </button>
                );
              })()}
            </div>
            <div style={{ ...inputCell(false), position: 'relative' }}>
              <input
                style={cellInputStyle}
                value={form.allowed_tax_type}
                onChange={(e) => setField('allowed_tax_type', e.target.value)}
                onFocus={() => setTaxTypeOpen(true)}
                onBlur={() => setTimeout(() => setTaxTypeOpen(false), 150)}
                placeholder="N,T"
              />
              {taxTypeOpen && taxTypeOptions && taxTypeOptions.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '0.5px solid #ccc', borderRadius: '8px', marginTop: '4px', maxHeight: '160px', overflowY: 'auto', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.12)' }}>
                  {taxTypeOptions
                    .filter((n) => n.toLowerCase().includes((form.allowed_tax_type || '').toLowerCase()))
                    .map((n) => (
                      <div
                        key={n}
                        onMouseDown={() => { setField('allowed_tax_type', n); setTaxTypeOpen(false); }}
                        style={{ padding: '7px 10px', fontSize: '12px', cursor: 'pointer', textAlign: 'center' }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f5f3')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'white')}
                      >
                        {n}
                      </div>
                    ))}
                </div>
              )}
            </div>
            <div style={inputCell(false)}><input style={cellInputStyle} value={form.vat_grn_pattern} onChange={(e) => setField('vat_grn_pattern', e.target.value)} /></div>
            <div style={inputCell(false)}><input style={cellInputStyle} value={form.vat_grn} onChange={(e) => setField('vat_grn', e.target.value)} /></div>
            <div style={inputCell(true)}><input style={cellInputStyle} value={form.vat_digit} onChange={(e) => setField('vat_digit', e.target.value)} /></div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', padding: '12px 20px', borderTop: '0.5px solid #e8e8e8' }}>
          <button onClick={onClose} style={{ padding: '7px 16px', fontSize: '13px', border: '0.5px solid #ccc', background: 'transparent', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: '7px 16px', fontSize: '13px', border: 'none', background: '#1a3a5c', color: 'white', borderRadius: '8px', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'กำลังบันทึก...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function VatWatchlistMonitorTable({ onGoto } = {}) { // MARKER_VATWATCHLISTOPS_INCOMPLETE_BU_OPS_TEST_V1
  const { rows, loading } = useVatWatchlistMonitorRows();
  const { userName, currentUser } = useAuth(); // MARKER_VATWATCHLISTOPS_ACTION_LOG_V1

  // MARKER_VATWATCHLISTOPS_DELETE_BU_ACTION_V1
  // ── Icon ขวา (Action Column): ลบ vat_watchlist_report ของ BU + ล้าง Last Update/Incomplete ──
  const handleDeleteVatWatchlistBu = async (c) => {
    // MARKER_VATWATCHLISTOPS_CONFIRMDIALOG_DELETE_V1
    const confirmed = await confirmDialog.confirm(
      `ลบข้อมูล VAT Watchlist ทั้งหมดของ BU "${c.bu}" ?\nการลบนี้ไม่สามารถย้อนกลับได้`,
      { title: 'ลบข้อมูล VAT Watchlist', variant: 'danger' }
    );
    if (!confirmed) return;
    try {
      await apiFetch(`/vat_watchlist_report?eq_bu=${encodeURIComponent(c.bu)}&hard=true`, { method: 'DELETE' });
      await apiFetch(`/company_list/${c.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          vat_watchlist_last_incomplete_update: null, vat_watchlist_incomplete_to: null,
          vat_watchlist_last_action: 'Deleted', vat_watchlist_last_action_by: userName || currentUser?.email || '', vat_watchlist_last_action_at: new Date().toISOString(), // MARKER_VATWATCHLISTOPS_ACTION_LOG_V1
        }),
      });
      broadcastWs('company_list_updated', { bu: c.bu });
    } catch (err) {
      console.error('handleDeleteVatWatchlistBu error:', err);
      alert('ลบไม่สำเร็จ: ' + err.message);
    }
  };

  const [activeTab, setActiveTab] = React.useState('active');
  const [search, setSearch] = React.useState('');
  const [baseFilter, setBaseFilter] = React.useState('');
  const [page, setPage] = React.useState(1); // MARKER_VATWATCHLISTOPS_PAGINATION_V1
  const [pageSize, setPageSize] = React.useState(100);
  const [configBu, setConfigBu] = React.useState(null);
  // MARKER_VATWATCHLISTOPS_MONITOR_SORT_V1
  const [sortKey, setSortKey] = React.useState(null);
  const [sortDir, setSortDir] = React.useState('asc');
  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const baseOptions = React.useMemo(() => {
    const set = new Set(rows.map((c) => c.base).filter(Boolean));
    return Array.from(set).sort();
  }, [rows]);

  // MARKER_VATWATCHLISTOPS_PREPAREBY_OPTIONS_V1 — ดึงชื่อ PREPARE BY ที่ไม่ซ้ำกันทั้งระบบ
  const prepareByOptions = React.useMemo(() => {
    const set = new Set(rows.map((c) => c['PREPARE BY']).filter(Boolean));
    return Array.from(set).sort();
  }, [rows]);

  // MARKER_VATWATCHLISTOPS_TAXTYPE_OPTIONS_V1 — ดึงค่า allowed_tax_type ที่ไม่ซ้ำกันทั้งระบบ
  const taxTypeOptions = React.useMemo(() => {
    const set = new Set(rows.map((c) => c.allowed_tax_type).filter(Boolean));
    return Array.from(set).sort();
  }, [rows]);

  const filteredRows = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((c) => {
      const status = getVatWatchlistEffectiveStatus(c);
      if (status !== activeTab) return false;
      if (baseFilter && c.base !== baseFilter) return false;
      if (q) {
        // MARKER_VATWATCHLISTOPS_SEARCH_ALL_FIELDS_V1 -- Filter ได้ทุกคอลัมน์ที่โชว์ในตาราง
        const hay = [
          c.bu, c['ENGLISH COMPANY NAME'], c['TAX ID'], c['VAT %'],
          c.BOOK, c.allowed_tax_type, c['PREPARE BY'],
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, activeTab, baseFilter, search]);

  React.useEffect(() => { setPage(1); }, [activeTab, baseFilter, search, pageSize, sortKey, sortDir]); // MARKER_VATWATCHLISTOPS_PAGINATION_V1

  // MARKER_VATWATCHLISTOPS_MONITOR_SORT_ROWS_V1
  // ── ค่าว่าง (—) ของ Last incomplete date / Last update at ไปท้ายสุดเสมอไม่ว่า Sort ทิศไหน ──
  const sortedRows = React.useMemo(() => {
    if (!sortKey) return filteredRows;
    const dir = sortDir === 'asc' ? 1 : -1;
    const arr = [...filteredRows];
    arr.sort((a, b) => {
      if (sortKey === 'bu') {
        return dir * String(a.bu || '').localeCompare(String(b.bu || ''));
      }
      const field = sortKey === 'lastIncomplete' ? 'vat_watchlist_incomplete_to' : 'vat_watchlist_last_incomplete_update';
      const av = a[field];
      const bv = b[field];
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      return dir * (new Date(av).getTime() - new Date(bv).getTime());
    });
    return arr;
  }, [filteredRows, sortKey, sortDir]);

  const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedRows = pageSize === 'all'
    ? sortedRows
    : sortedRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const totalWidth = VAT_MONITOR_COLS.reduce((s, c) => s + c.width, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: '4px', borderBottom: '0.5px solid #e8e8e8', flexShrink: 0 }}>
        {VAT_WATCHLIST_MONITOR_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: '8px 16px', fontSize: '13px', fontWeight: '500', border: 'none',
              background: 'transparent', cursor: 'pointer',
              borderBottom: activeTab === t.key ? '2px solid #1a3a5c' : '2px solid transparent',
              color: activeTab === t.key ? '#1a3a5c' : '#888',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 4px', flexShrink: 0 }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search"
          style={{ flex: 1, maxWidth: '260px', padding: '7px 10px', fontSize: '13px', border: '0.5px solid #ccc', borderRadius: '8px', outline: 'none', boxSizing: 'border-box' }}
        />
        <select
          value={baseFilter}
          onChange={(e) => setBaseFilter(e.target.value)}
          style={{ width: '140px', padding: '7px 10px', fontSize: '13px', border: '0.5px solid #ccc', borderRadius: '8px', outline: 'none' }}
        >
          <option value="">Base: ทั้งหมด</option>
          {baseOptions.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%', minWidth: totalWidth, borderCollapse: 'collapse', fontSize: '13px', tableLayout: 'fixed' }}>
          <colgroup>
            {VAT_MONITOR_COLS.map((c) => <col key={c.key} style={{ width: c.width }} />)}
          </colgroup>
          <thead>
            <tr>
              {/* MARKER_VATWATCHLISTOPS_MONITOR_SORT_V1 */}
              {VAT_MONITOR_COLS.map((c) => (
                <th
                  key={c.key}
                  onClick={c.sortable ? () => handleSort(c.key) : undefined}
                  style={{ padding: '8px 8px', background: '#1a3a5c', color: 'white', fontWeight: '500', textAlign: c.align || 'left', position: 'sticky', top: 0, cursor: c.sortable ? 'pointer' : 'default', userSelect: c.sortable ? 'none' : 'auto' }}
                >
                  {c.label}{c.sortable && sortKey === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={VAT_MONITOR_COLS.length} style={{ padding: '32px 8px', textAlign: 'center', color: '#aaa' }}>กำลังโหลด...</td></tr>
            )}
            {!loading && filteredRows.length === 0 && (
              <tr><td colSpan={VAT_MONITOR_COLS.length} style={{ padding: '32px 8px', textAlign: 'center', color: '#aaa' }}>
                {VAT_WATCHLIST_MONITOR_EMPTY_TEXT[activeTab] || 'ไม่พบข้อมูล'}
              </td></tr>
            )}
            {!loading && paginatedRows.map((c, i) => {
              const lastIncompleteRaw = c.vat_watchlist_incomplete_to;
              let overdue = false;
              if (lastIncompleteRaw) {
                const d = new Date(lastIncompleteRaw);
                if (!isNaN(d.getTime())) {
                  const daysAgo = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
                  overdue = daysAgo > VAT_WATCHLIST_OVERDUE_DAYS;
                }
              }
              return (
                <tr key={c.id || c.bu} style={{ background: i % 2 === 0 ? 'white' : '#f7f9fb', borderTop: '0.5px solid #e8e8e8' }}>
                  <td style={{ padding: '7px 8px' }}>{c.bu}</td>
                  <td style={{ padding: '7px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c['ENGLISH COMPANY NAME']}</td>
                  <td style={{ padding: '7px 8px', color: '#555' }}>{c['TAX ID']}</td>
                  <td style={{ padding: '7px 8px', textAlign: 'center', color: '#555' }}>{c['VAT %'] || '—'}</td>
                  <td style={{ padding: '7px 8px', color: '#555' }}>{c.BOOK}</td>
                  <td style={{ padding: '7px 8px', color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.allowed_tax_type || '—'}</td>
                  <td style={{ padding: '7px 8px', color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c['PREPARE BY']}</td>
                  <td style={{ padding: '7px 8px', color: overdue ? '#c0392b' : '#333' }}>{formatVatWatchlistDate(lastIncompleteRaw)}</td>
                  <td style={{ padding: '7px 8px', color: '#555' }}>{formatVatWatchlistDateTime(c.vat_watchlist_last_incomplete_update)}</td>
                  <td style={{ padding: '7px 8px', textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                      <button
                        onClick={() => setConfigBu(c)}
                        title="Config BU"
                        style={{ width: '16px', height: '16px', padding: 0, border: '1px solid #888', borderRadius: '3px', background: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: '10px', lineHeight: 1 }}
                      >⚙</button>
                      <button
                        onClick={() => onGoto && onGoto(c)}
                        title="Goto Incomplete BU Operation"
                        style={{ width: '16px', height: '16px', padding: 0, border: '1px solid #1a3a5c', borderRadius: '3px', background: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1a3a5c', fontSize: '10px', lineHeight: 1 }}
                      >→</button>
                      <button
                        onClick={() => handleDeleteVatWatchlistBu(c)}
                        title="ลบข้อมูล VAT Watchlist ของ BU นี้"
                        style={{ width: '16px', height: '16px', padding: 0, border: '1px solid #c0392b', borderRadius: '3px', background: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c0392b', fontSize: '10px', lineHeight: 1 }}
                      >🗑</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '8px 4px', borderTop: '0.5px solid #e8e8e8', flexShrink: 0, fontSize: '12px', color: '#666' }}>
        <div>
          {filteredRows.length === 0 ? '0 รายการ' : `แสดง ${(currentPage - 1) * (pageSize === 'all' ? filteredRows.length : pageSize) + 1}–${Math.min(currentPage * (pageSize === 'all' ? filteredRows.length : pageSize), filteredRows.length)} จาก ${filteredRows.length} รายการ`}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            style={{ padding: '5px 8px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '6px', outline: 'none' }}
          >
            <option value="10">10 / หน้า</option>
            <option value="20">20 / หน้า</option>
            <option value="50">50 / หน้า</option>
            <option value="100">100 / หน้า</option>
            <option value="500">500 / หน้า</option>
            <option value="all">ทั้งหมด</option>
          </select>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            style={{ padding: '5px 10px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '6px', background: currentPage <= 1 ? '#f5f5f5' : 'white', cursor: currentPage <= 1 ? 'not-allowed' : 'pointer' }}
          >‹ ก่อนหน้า</button>
          <span>หน้า {currentPage} / {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            style={{ padding: '5px 10px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '6px', background: currentPage >= totalPages ? '#f5f5f5' : 'white', cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer' }}
          >ถัดไป ›</button>
        </div>
      </div>
      {configBu && (
        <VatWatchlistConfigModal company={configBu} baseOptions={baseOptions} prepareByOptions={prepareByOptions} taxTypeOptions={taxTypeOptions} onClose={() => setConfigBu(null)} />
      )}
    </div>
  );
}

// MARKER_VATWATCHLISTOPS_INCOMPLETE_BU_OPS_TEST_V1
// -- หน้าทดสอบ "Incomplete BU Operation" -- Local State ในไฟล์เดียว --
// -- ยังไม่ผูกกับ App.js/menuConfig.js จริง รอ Design นิ่งก่อน --
// MARKER_VATWATCHLISTOPS_INCOMPLETE_DETAIL_REAL_V1
const VAT_INCOMPLETE_ALL_FIELDS = [
  { key: 'doc_date', label: 'ว.ด.ป.' }, { key: 'doc_no', label: 'เลขที่' },
  { key: 'site', label: 'Site' }, { key: 'pay_group', label: 'Pay Group' },
  { key: 'branch', label: 'Branch' }, { key: 'tax_type', label: 'ประเภทภาษี' },
  { key: 'invoice_ref', label: 'ใบแจ้งหนี้' }, { key: 'supplier_code', label: 'Supplier Code' },
  { key: 'vendor_name', label: 'ชื่อผู้ค้า' }, { key: 'phone', label: 'เบอร์โทรศัพท์' },
  { key: 'payment_date', label: 'ชำระเงิน' }, { key: 'check_date', label: 'เช็ค' },
  { key: 'check_no', label: 'เลขที่เช็ค' }, { key: 'receive_doc_date', label: 'Receive Doc.' },
  { key: 'receive_doc_no', label: 'เลขที่ GRT' }, { key: 'exp_amount', label: 'มูลค่าสินค้า' },
  { key: 'exp_vat', label: 'เงินภาษี' }, { key: 'avg_amount', label: 'มูลค่าสินค้า (Rate)' },
  { key: 'avg_vat', label: 'เงินภาษี (Rate)' }, { key: 'ap_source', label: 'AP Source' },
  { key: 'ap_batch_name', label: 'AP Batch Name' }, { key: 'bu', label: 'BU' },
  { key: 'bus_type', label: 'Type' }, // MARKER_VATWATCHLISTOPS_INCOMPLETE_FIELD_TRIM_V1 (period ตัดออกแล้ว)
  { key: 'aging_label', label: 'Aging' }, // MARKER_VATWATCHLISTOPS_CONFIG_COLUMNS_REMOVE_AGING_STATUS_V1 (aging_months, status ตัดออกแล้ว)
  { key: 'note', label: 'Note' }, { key: 'remark', label: 'Remark' },
  { key: 'sub_type', label: 'Sub Type' },
  { key: 'related_persons', label: 'Related Persons' }, // (payment_type ตัดออกแล้ว)
];

// MARKER_VATWATCHLISTOPS_INCOMPLETE_DATE_FORMAT_V1
const VAT_INCOMPLETE_DATE_KEYS = new Set(['doc_date', 'payment_date', 'check_date', 'receive_doc_date']);
function formatVatIncompleteDate(val) {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  const day = String(d.getDate()).padStart(2, '0');
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const mon = months[d.getMonth()];
  const yr = String(d.getFullYear()).slice(-2);
  return `${day}-${mon}-${yr}`;
}

function VatIncompleteConfigModal({ allConfigs, currentUsername, currentVisible, onClose, onSaved }) {
  const [selected, setSelected] = React.useState(new Set(currentVisible));
  const [loadFromUser, setLoadFromUser] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const toggle = (key) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleLoadFrom = () => {
    const cfg = allConfigs.find((c) => c.username === loadFromUser);
    if (cfg && Array.isArray(cfg.visible_columns)) {
      setSelected(new Set(cfg.visible_columns));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const existing = allConfigs.find((c) => c.username === currentUsername);
      const payload = { username: currentUsername, visible_columns: JSON.stringify([...selected]) }; // MARKER_VATWATCHLISTOPS_FIX_JSONB_STRINGIFY_V1
      let saved;
      if (existing) {
        saved = await apiFetch(`/vat_incomplete_column_config/${existing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        saved = await apiFetch('/vat_incomplete_column_config', { method: 'POST', body: JSON.stringify(payload) });
      }
      const savedRow = Array.isArray(saved) ? saved[0] : saved;
      onSaved(savedRow || { username: currentUsername, visible_columns: [...selected] }); // MARKER_VATWATCHLISTOPS_FIX_DUPLICATE_KEY_V1
    } catch (err) {
      console.error('VatIncompleteConfigModal save error:', err);
      alert('บันทึกไม่สำเร็จ: ' + err.message);
    }
    setSaving(false);
  };

  const otherUsers = [...new Set(allConfigs.map((c) => c.username))].filter((u) => u !== currentUsername);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'white', borderRadius: '12px', width: '480px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
        <div style={{ padding: '20px 24px 12px', fontSize: '16px', fontWeight: '500' }}>Config Columns — Detail Incomplete</div>
        {otherUsers.length > 0 && (
          <div style={{ padding: '0 24px 12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select value={loadFromUser} onChange={(e) => setLoadFromUser(e.target.value)} style={{ flex: 1, padding: '7px 10px', fontSize: '13px', border: '0.5px solid #ccc', borderRadius: '8px' }}>
              <option value="">โหลด Format จาก User อื่น...</option>
              {otherUsers.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <button onClick={handleLoadFrom} disabled={!loadFromUser} style={{ padding: '7px 14px', fontSize: '13px', border: '0.5px solid #ccc', borderRadius: '8px', background: 'white', cursor: loadFromUser ? 'pointer' : 'not-allowed' }}>โหลด</button>
          </div>
        )}
        <div style={{ padding: '0 24px', overflowY: 'auto', flex: 1 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
            {VAT_INCOMPLETE_ALL_FIELDS.map((f) => (
              <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                <input type="checkbox" checked={selected.has(f.key)} onChange={() => toggle(f.key)} />
                {f.label}
              </label>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '16px 24px', borderTop: '0.5px solid #eee' }}>
          <button onClick={onClose} disabled={saving} style={{ padding: '8px 16px', fontSize: '13px', border: '0.5px solid #ccc', borderRadius: '8px', background: 'white', cursor: 'pointer' }}>ยกเลิก</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', fontSize: '13px', border: 'none', borderRadius: '8px', background: saving ? '#ccc' : '#1a3a5c', color: 'white', cursor: saving ? 'not-allowed' : 'pointer' }}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
        </div>
      </div>
    </div>
  );
}

function IncompleteBuOperationTest({ bu, onBack }) {
  const { userName, currentUser } = useAuth();
  const username = userName || currentUser?.email || 'unknown';

  // MARKER_VATWATCHLISTOPS_DETAIL_SERVERSIDE_V1
  const [detailRows, setDetailRows] = React.useState([]);
  const [detailTotalCount, setDetailTotalCount] = React.useState(0);
  const [loadingDetail, setLoadingDetail] = React.useState(true);
  const [allConfigs, setAllConfigs] = React.useState([]);
  const VAT_INCOMPLETE_DEFAULT_VISIBLE = ['doc_date','doc_no','site','pay_group','branch','tax_type','invoice_ref','supplier_code','vendor_name','payment_date','check_date','check_no','receive_doc_date','receive_doc_no','exp_amount','exp_vat','avg_amount','avg_vat','ap_source','ap_batch_name','bu','bus_type','sub_type','aging_label']; // MARKER_VATWATCHLISTOPS_DEFAULT_VISIBLE_ADD_TYPE_AGING_V1
  const [visibleColumns, setVisibleColumns] = React.useState(VAT_INCOMPLETE_DEFAULT_VISIBLE);
  const [columnFilters, setColumnFilters] = React.useState({});
  const [openFilterKey, setOpenFilterKey] = React.useState(null);
  const [expandedFilterGroups, setExpandedFilterGroups] = React.useState({});
  const [filterSearchText, setFilterSearchText] = React.useState('');
  const [columnDistinctCache, setColumnDistinctCache] = React.useState({});
  const [columnDistinctLoading, setColumnDistinctLoading] = React.useState({});
  const [showConfigModal, setShowConfigModal] = React.useState(false);
  const [detailPageSize, setDetailPageSize] = React.useState(200);
  const [detailPage, setDetailPage] = React.useState(1);
  React.useEffect(() => { setDetailPage(1); }, [detailPageSize]);
  const [detailSearch, setDetailSearch] = React.useState('');
  const [detailSearchDebounced, setDetailSearchDebounced] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setDetailSearchDebounced(detailSearch), 400);
    return () => clearTimeout(t);
  }, [detailSearch]);

  // MARKER_VATWATCHLISTOPS_NOTES_FEATURE_V1
  // ── Note ผูกกับ (bu, invoice_ref, supplier_code) ไม่ใช่ Row ID ──
  // ── (Row ID เปลี่ยนทุกรอบ Upload เพราะ Delete+Insert ทั้ง BU) ──
  const [noteMap, setNoteMap] = React.useState({});
  const [noteModalRow, setNoteModalRow] = React.useState(null);
  const [noteDraftText, setNoteDraftText] = React.useState('');
  const [noteDraftAccept, setNoteDraftAccept] = React.useState(false); // MARKER_VATWATCHLISTOPS_NOTES_STATUS_V1
  const [noteSaving, setNoteSaving] = React.useState(false);
  const getNoteKey = (row) => `${row.invoice_ref || ''}|${row.supplier_code || ''}`;
  const [noteDraftRemark, setNoteDraftRemark] = React.useState(''); // MARKER_VATWATCHLISTOPS_NOTES_REMARK_V1
  const [noteDraftCheckNo, setNoteDraftCheckNo] = React.useState(''); // MARKER_VATWATCHLISTOPS_NOTES_REMARK_DROPDOWN_V1
  const NOTE_REMARK_OPTIONS = ['Check Return', 'Check On Hand', 'Issue']; // MARKER_VATWATCHLISTOPS_NOTES_REMARK_DROPDOWN_V1
  const [noteTrackMode, setNoteTrackMode] = React.useState('single'); // MARKER_VATWATCHLISTOPS_NOTES_TRACK_BY_CHECK_V1 -- 'single' | 'all_check'
  const openNoteModal = (row) => {
    const key = getNoteKey(row);
    const entry = noteMap[key];
    setNoteDraftText((entry && entry.note) || '');
    setNoteDraftAccept(!!(entry && entry.status === 'accept_with_condition'));
    setNoteDraftRemark((entry && entry.remark) || '');
    setNoteDraftCheckNo((entry && entry.check_no) || '');
    setNoteTrackMode('single'); // MARKER_VATWATCHLISTOPS_NOTES_TRACK_BY_CHECK_V1
    setNoteModalRow(row);
  };
  const saveNote = async () => {
    if (!noteModalRow) return;
    // MARKER_VATWATCHLISTOPS_NOTES_TRACK_BY_CHECK_V1
    // ── ถ้าเลือก 'บันทึกทุก Invoice ที่ใช้เช็คเลขนี้' -- หา Invoice อื่นที่ check_no ตรงกันก่อน ──
    let targets = [{ invoice_ref: noteModalRow.invoice_ref, supplier_code: noteModalRow.supplier_code }];
    if (noteDraftCheckNo.trim() && noteTrackMode === 'all_check') {
      let matches = [];
      try {
        const found = await apiFetch(`/vat_watchlist_report?eq_bu=${encodeURIComponent(bu.bu)}&eq_check_no=${encodeURIComponent(noteDraftCheckNo.trim())}`);
        matches = Array.isArray(found) ? found : [];
      } catch (err) {
        console.error('find by check_no error:', err);
      }
      if (matches.length === 0) {
        confirmDialog.alert('ไม่พบ Invoice อื่นที่ใช้เลขที่เช็คนี้ในระบบ จะบันทึกเฉพาะ Invoice นี้แทน', { title: 'ไม่พบข้อมูล' });
      } else {
        const confirmed = await confirmDialog.confirm(
          `พบ ${matches.length} Invoice ที่ใช้เช็คเลขที่ "${noteDraftCheckNo.trim()}" จะบันทึก Note นี้ให้ครบทุกใบ ยืนยันไหม?`,
          { title: 'ยืนยันบันทึก Note หลาย Invoice' }
        );
        if (!confirmed) return;
        targets = matches.map((m) => ({ invoice_ref: m.invoice_ref, supplier_code: m.supplier_code }));
      }
    }
    setNoteSaving(true);
    try {
      const nextEntries = {};
      for (const t of targets) {
        const payload = {
          bu: bu.bu,
          invoice_ref: t.invoice_ref,
          supplier_code: t.supplier_code,
          note: noteDraftText,
          remark: noteDraftRemark,
          check_no: noteDraftCheckNo,
          status: noteDraftAccept ? 'accept_with_condition' : 'pending',
          note_by: username,
          note_at: new Date().toISOString(),
        };
        await apiFetch('/vat_watchlist_notes/upsert?onConflict=bu,invoice_ref,supplier_code', { method: 'POST', body: JSON.stringify(payload) });
        nextEntries[`${t.invoice_ref || ''}|${t.supplier_code || ''}`] = payload;
      }
      setNoteMap((prev) => ({ ...prev, ...nextEntries }));
      setNoteModalRow(null);
    } catch (err) {
      console.error('saveNote error:', err);
      confirmDialog.alert('บันทึก Note ไม่สำเร็จ: ' + (err?.message || ''), { title: 'ผิดพลาด', variant: 'danger' });
    }
    setNoteSaving(false);
  };

  // MARKER_VATWATCHLISTOPS_NOTES_DELETE_BUTTON_V1
  const deleteNote = async () => {
    if (!noteModalRow) return;
    const confirmed = await confirmDialog.confirm(
      `ลบ Note ของ Invoice "${noteModalRow.invoice_ref}" ทิ้ง? (Remark/เลขที่เช็ค/Note/Status ทั้งหมดจะถูกลบไปด้วย)`,
      { title: 'ยืนยันการลบ Note', variant: 'danger' }
    );
    if (!confirmed) return;
    setNoteSaving(true);
    try {
      await apiFetch(`/vat_watchlist_notes?eq_bu=${encodeURIComponent(bu.bu)}&eq_invoice_ref=${encodeURIComponent(noteModalRow.invoice_ref)}&eq_supplier_code=${encodeURIComponent(noteModalRow.supplier_code)}&hard=true`, { method: 'DELETE' }); // MARKER_VATWATCHLISTOPS_NOTES_DELETE_HARD_V1
      const key = getNoteKey(noteModalRow);
      setNoteMap((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setNoteModalRow(null);
    } catch (err) {
      console.error('deleteNote error:', err);
      confirmDialog.alert('ลบ Note ไม่สำเร็จ: ' + (err?.message || ''), { title: 'ผิดพลาด', variant: 'danger' });
    }
    setNoteSaving(false);
  };

  const VAT_MONTH_ORDER = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

  const columnFiltersKey = React.useMemo(
    () => JSON.stringify(Object.keys(columnFilters).sort().map((k) => [k, Array.from(columnFilters[k]).sort()])),
    [columnFilters]
  );

  React.useEffect(() => { setDetailPage(1); }, [detailSearchDebounced, columnFiltersKey]);

  const buildDetailParams = React.useCallback(() => {
    const params = new URLSearchParams();
    if (bu?.bu) params.set('eq_bu', bu.bu);
    if (detailSearchDebounced.trim()) {
      params.set('search', detailSearchDebounced.trim());
      params.set('search_cols', 'invoice_ref,supplier_code,vendor_name,check_no');
    }
    Object.keys(columnFilters).forEach((key) => {
      const set = columnFilters[key];
      if (!set || set.size === 0) return;
      const values = Array.from(set).filter((v) => v !== '(ว่าง)');
      if (values.length > 0) params.set(`in_${key}`, values.join(','));
    });
    return params;
  }, [bu?.bu, detailSearchDebounced, columnFiltersKey]);

  React.useEffect(() => {
    let active = true;
    (async () => {
      setLoadingDetail(true);
      try {
        const dataParams = buildDetailParams();
        dataParams.set('order', 'aging_months.desc.nullslast');
        dataParams.set('limit', String(detailPageSize));
        dataParams.set('offset', String((detailPage - 1) * detailPageSize));
        const countParams = buildDetailParams();
        countParams.set('count', 'true');

        const [rows, countRes, configs, notes] = await Promise.all([
          bu?.bu ? apiFetch(`/vat_watchlist_report?${dataParams.toString()}`) : Promise.resolve([]),
          bu?.bu ? apiFetch(`/vat_watchlist_report?${countParams.toString()}`) : Promise.resolve({ total: 0 }),
          apiFetch('/vat_incomplete_column_config'),
          bu?.bu ? apiFetch(`/vat_watchlist_notes?eq_bu=${encodeURIComponent(bu.bu)}`).catch(() => []) : Promise.resolve([]), // MARKER_VATWATCHLISTOPS_NOTES_FETCH_V1
        ]);
        if (!active) return;
        setDetailRows(Array.isArray(rows) ? rows : []);
        setDetailTotalCount(countRes && typeof countRes.total === 'number' ? countRes.total : 0);
        const noteList = Array.isArray(notes) ? notes : [];
        const nextNoteMap = {};
        noteList.forEach((n) => { nextNoteMap[`${n.invoice_ref || ''}|${n.supplier_code || ''}`] = n; });
        setNoteMap(nextNoteMap);
        const configList = Array.isArray(configs) ? configs : [];
        setAllConfigs(configList);
        const myConfig = configList.find((c) => c.username === username);
        if (myConfig && Array.isArray(myConfig.visible_columns) && myConfig.visible_columns.length > 0) {
          setVisibleColumns(myConfig.visible_columns);
        }
      } catch (err) {
        console.error('IncompleteBuOperationTest load error:', err);
      }
      if (active) setLoadingDetail(false);
    })();
    return () => { active = false; };
  }, [bu?.bu, username, detailPage, detailPageSize, buildDetailParams]);

  const activeCols = VAT_INCOMPLETE_ALL_FIELDS.filter((f) => visibleColumns.includes(f.key));

  const fetchColumnDistinct = React.useCallback(async (key) => {
    if (columnDistinctCache[key] || !bu?.bu) return;
    setColumnDistinctLoading((prev) => ({ ...prev, [key]: true }));
    try {
      const params = new URLSearchParams();
      params.set('eq_bu', bu.bu);
      params.set('distinct', key);
      const res = await apiFetch(`/vat_watchlist_report?${params.toString()}`);
      const rawValues = Array.isArray(res?.values) ? res.values : [];
      let entry;
      if (VAT_INCOMPLETE_DATE_KEYS.has(key)) {
        let hasEmpty = false;
        const years = {};
        for (const raw of rawValues) {
          if (!raw) { hasEmpty = true; continue; }
          const d = new Date(raw);
          if (isNaN(d.getTime())) { hasEmpty = true; continue; }
          const iso = d.toISOString().slice(0, 10);
          const y = d.getUTCFullYear();
          const m = d.getUTCMonth();
          years[y] = years[y] || {};
          years[y][m] = years[y][m] || [];
          years[y][m].push({ iso, label: formatVatIncompleteDate(raw), day: d.getUTCDate() });
        }
        const yearKeys = Object.keys(years).map(Number).sort((a, b) => a - b);
        const tree = yearKeys.map((y) => ({
          year: y,
          months: Object.keys(years[y]).map(Number).sort((a, b) => a - b).map((m) => ({
            month: m,
            monthLabel: VAT_MONTH_ORDER[m],
            days: years[y][m].sort((a, b) => a.day - b.day),
          })),
        }));
        entry = { type: 'date', tree, hasEmpty };
      } else {
        const values = Array.from(new Set(rawValues.map((v) => String(v ?? '')))).sort();
        entry = { type: 'flat', values };
      }
      setColumnDistinctCache((prev) => ({ ...prev, [key]: entry }));
    } catch (err) {
      console.error('fetchColumnDistinct error:', err);
    }
    setColumnDistinctLoading((prev) => ({ ...prev, [key]: false }));
  }, [bu?.bu, columnDistinctCache]);

  const openFilterDropdown = (key, isOpenNow) => {
    setOpenFilterKey(isOpenNow ? null : key);
    setFilterSearchText('');
    if (!isOpenNow) fetchColumnDistinct(key);
  };

  const toggleFilterGroup = (key, values) => {
    setColumnFilters((prev) => {
      const next = { ...prev };
      const current = new Set(next[key] || []);
      const allSelected = values.every((v) => current.has(v));
      if (allSelected) values.forEach((v) => current.delete(v));
      else values.forEach((v) => current.add(v));
      if (current.size === 0) delete next[key]; else next[key] = current;
      return next;
    });
  };

  const toggleExpandGroup = (groupKey) => {
    setExpandedFilterGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };

  const toggleColumnFilterValue = (key, value) => {
    setColumnFilters((prev) => {
      const next = { ...prev };
      const current = new Set(next[key] || []);
      if (current.has(value)) current.delete(value); else current.add(value);
      if (current.size === 0) delete next[key]; else next[key] = current;
      return next;
    });
  };

  const clearColumnFilter = (key) => {
    setColumnFilters((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  // MARKER_VATWATCHLISTOPS_DETAIL_ESC_KEY_V1
  // ── Esc 2 ชั้น: ชั้น 1 ปิด Filter Dropdown ที่เปิดอยู่ก่อน / ชั้น 2 (ไม่มี Dropdown เปิด) = กด Back ──
  React.useEffect(() => {
    const handleEscKey = (e) => {
      if (e.key !== 'Escape') return;
      if (openFilterKey) {
        setOpenFilterKey(null);
      } else if (onBack) {
        onBack();
      }
    };
    document.addEventListener('keydown', handleEscKey);
    return () => document.removeEventListener('keydown', handleEscKey);
  }, [openFilterKey, onBack]);

  const detailTotalPages = Math.max(1, Math.ceil(detailTotalCount / detailPageSize));
  const detailPageStart = detailTotalCount === 0 ? 0 : (detailPage - 1) * detailPageSize;
  const detailPageEnd = detailPageStart + detailRows.length;

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 12px', fontSize: '13px', border: '0.5px solid #ccc', borderRadius: '8px', background: 'white', cursor: 'pointer' }}>← Back</button>
      </div>

      <div style={{ background: 'white', borderRadius: '12px', border: '0.5px solid #e8e8e8', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '28px', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '12px', color: '#999' }}>Company info</div>
        <div style={{ fontSize: '13px' }}><span style={{ color: '#888' }}>Company </span><span style={{ fontWeight: '500' }}>{bu?.['ENGLISH COMPANY NAME'] || '—'}</span></div>
        <div style={{ fontSize: '13px' }}><span style={{ color: '#888' }}>Tax ID </span><span>{bu?.['TAX ID'] || '—'}</span></div>
        <div style={{ fontSize: '13px' }}><span style={{ color: '#888' }}>BU </span><span style={{ fontWeight: '500' }}>{bu?.bu || '—'}</span></div>
        <div style={{ fontSize: '13px' }}><span style={{ color: '#888' }}>VAT % </span><span>{bu?.['VAT %'] || '—'}</span></div>
      </div>

      <div style={{ flex: 1, background: 'white', borderRadius: '12px', border: '0.5px solid #e8e8e8', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '0.5px solid #e8e8e8', gap: '12px' }}> {/* MARKER_VATWATCHLISTOPS_RESTORE_DETAIL_SEARCH_V1 */}
          <input
            type="text"
            value={detailSearch}
            onChange={(e) => setDetailSearch(e.target.value)}
            placeholder="Search"
            style={{ flex: 1, maxWidth: '320px', padding: '6px 10px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '8px', outline: 'none', boxSizing: 'border-box' }}
          />
          <button onClick={() => setShowConfigModal(true)} style={{ padding: '6px 12px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '8px', background: 'white', cursor: 'pointer', flexShrink: 0 }}>⚙ Config Columns</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {loadingDetail ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#999', fontSize: '13px' }}>กำลังโหลด...</div>
          ) : detailTotalCount === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#999', fontSize: '13px' }}>
              {detailSearchDebounced.trim() || Object.keys(columnFilters).length > 0 ? 'ไม่พบรายการที่ตรงกับคำค้นหา' : 'ไม่มีข้อมูล Incomplete สำหรับ BU นี้'}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', whiteSpace: 'nowrap' }}>
              <thead>
                <tr>
                  <th style={{ position: 'sticky', top: 0, padding: '8px 6px', background: '#1a3a5c', color: 'white', fontWeight: '500', textAlign: 'center', width: '40px' }}>Note</th> {/* MARKER_VATWATCHLISTOPS_NOTES_FEATURE_V1 */} {/* MARKER_VATWATCHLISTOPS_REMOVE_NOTE_STATUS_COL_V1 */}
                  {activeCols.map((c) => {
                    const isFiltered = !!(columnFilters[c.key] && columnFilters[c.key].size > 0);
                    const isOpen = openFilterKey === c.key;
                    const distinctEntry = columnDistinctCache[c.key];
                    const isDistinctLoading = !!columnDistinctLoading[c.key];
                    return (
                      <th
                        key={c.key}
                        onClick={() => openFilterDropdown(c.key, isOpen)}
                        style={{ position: 'sticky', top: 0, padding: 0, background: '#1a3a5c', color: 'white', fontWeight: '500', textAlign: 'left', cursor: 'pointer' }}
                        title="กดเพื่อ Filter"
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', position: 'relative', padding: '8px 10px', width: '100%', boxSizing: 'border-box' }}>
                          <span>{c.label}</span>
                          <span style={{ color: isFiltered ? '#7DD3FC' : 'rgba(255,255,255,0.6)', fontSize: '10px', lineHeight: 1 }}>▾</span>
                          {isOpen && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              style={{ position: 'absolute', top: '100%', left: 0, marginTop: '4px', background: 'white', color: '#333', border: '0.5px solid #ccc', borderRadius: '8px', width: '200px', maxHeight: '260px', display: 'flex', flexDirection: 'column', zIndex: 20, boxShadow: '0 6px 16px rgba(0,0,0,0.18)', fontWeight: '400', textAlign: 'left' }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', borderBottom: '0.5px solid #eee', flexShrink: 0, background: 'white', borderRadius: '8px 8px 0 0' }}>
                                <button type="button" onClick={() => clearColumnFilter(c.key)} style={{ fontSize: '11px', border: 'none', background: 'transparent', color: '#1a3a5c', cursor: 'pointer' }}>ล้าง Filter</button>
                                <button type="button" onClick={() => setOpenFilterKey(null)} style={{ fontSize: '11px', border: 'none', background: 'transparent', color: '#999', cursor: 'pointer' }}>ปิด</button>
                              </div>
                              <div style={{ padding: '6px 8px', borderBottom: '0.5px solid #eee', flexShrink: 0 }}>
                                <input
                                  type="text"
                                  value={filterSearchText}
                                  onChange={(e) => setFilterSearchText(e.target.value)}
                                  placeholder="Search"
                                  style={{ width: '100%', padding: '4px 8px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '6px', outline: 'none', boxSizing: 'border-box' }}
                                />
                              </div>
                              <div style={{ overflowY: 'auto', flex: 1 }}>
                              {isDistinctLoading || !distinctEntry ? (
                                <div style={{ padding: '12px', fontSize: '12px', color: '#aaa', textAlign: 'center' }}>กำลังโหลด...</div>
                              ) : distinctEntry.type === 'date' ? (
                                <>
                                  {(() => {
                                    const q = filterSearchText.trim().toLowerCase();
                                    const searching = q.length > 0;
                                    return distinctEntry.tree.map((yGroup) => {
                                      const monthsFiltered = yGroup.months
                                        .map((mGroup) => ({ ...mGroup, days: mGroup.days.filter((d) => !searching || d.label.toLowerCase().includes(q)) }))
                                        .filter((mGroup) => mGroup.days.length > 0);
                                      if (searching && monthsFiltered.length === 0) return null;
                                      const yValues = yGroup.months.flatMap((mG) => mG.days.map((d) => d.iso));
                                      const yKey = `${c.key}-y${yGroup.year}`;
                                      const selectedSet = columnFilters[c.key] || new Set();
                                      const yChecked = yValues.length > 0 && yValues.every((v) => selectedSet.has(v));
                                      const yExpanded = searching ? true : !!expandedFilterGroups[yKey];
                                      return (
                                        <div key={yKey}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 8px', fontSize: '12px', fontWeight: '600', background: '#f9f9f9' }}>
                                            <button type="button" onClick={() => toggleExpandGroup(yKey)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, fontSize: '10px' }}>{yExpanded ? '▾' : '▸'}</button>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', flex: 1 }}>
                                              <input type="checkbox" checked={yChecked} onChange={() => toggleFilterGroup(c.key, yValues)} />
                                              <span>{yGroup.year}</span>
                                            </label>
                                          </div>
                                          {yExpanded && monthsFiltered.map((mGroup) => {
                                            const mValues = mGroup.days.map((d) => d.iso);
                                            const mKey = `${yKey}-m${mGroup.month}`;
                                            const mChecked = mValues.length > 0 && mValues.every((v) => selectedSet.has(v));
                                            const mExpanded = searching ? true : !!expandedFilterGroups[mKey];
                                            return (
                                              <div key={mKey}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px 4px 20px', fontSize: '12px', fontWeight: '500' }}>
                                                  <button type="button" onClick={() => toggleExpandGroup(mKey)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, fontSize: '10px' }}>{mExpanded ? '▾' : '▸'}</button>
                                                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', flex: 1 }}>
                                                    <input type="checkbox" checked={mChecked} onChange={() => toggleFilterGroup(c.key, mValues)} />
                                                    <span>{mGroup.monthLabel}</span>
                                                  </label>
                                                </div>
                                                {mExpanded && mGroup.days.map((d) => (
                                                  <label key={d.iso} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px 4px 34px', fontSize: '12px', cursor: 'pointer' }}>
                                                    <input type="checkbox" checked={selectedSet.has(d.iso)} onChange={() => toggleColumnFilterValue(c.key, d.iso)} />
                                                    <span>{d.label}</span>
                                                  </label>
                                                ))}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      );
                                    });
                                  })()}
                                  {distinctEntry.hasEmpty && (
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 8px', fontSize: '12px', cursor: 'pointer', borderTop: '0.5px solid #eee' }}>
                                      <input type="checkbox" checked={(columnFilters[c.key] || new Set()).has('(ว่าง)')} onChange={() => toggleColumnFilterValue(c.key, '(ว่าง)')} />
                                      <span>(ว่าง)</span>
                                    </label>
                                  )}
                                </>
                              ) : (
                                (distinctEntry.values || [])
                                  .filter((v) => !filterSearchText.trim() || v.toLowerCase().includes(filterSearchText.trim().toLowerCase()))
                                  .map((v) => (
                                  <label key={v || '(ว่าง)'} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 8px', fontSize: '12px', cursor: 'pointer' }}>
                                    <input
                                      type="checkbox"
                                      checked={!columnFilters[c.key] || columnFilters[c.key].size === 0 ? false : columnFilters[c.key].has(v)}
                                      onChange={() => toggleColumnFilterValue(c.key, v)}
                                    />
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v || '(ว่าง)'}</span>
                                  </label>
                                ))
                              )}
                              </div>
                            </div>
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {detailRows.map((row, i) => {
                  // MARKER_VATWATCHLISTOPS_DETAIL_AGING_HIGHLIGHT_V1 — Highlight สีพื้นหลังตาม Aging
                  const am = row.aging_months;
                  let rowBg = i % 2 === 0 ? 'white' : '#f7f9fb';
                  if (am != null) {
                    if (am > 6) rowBg = '#F1EFE8';
                    else if (am >= 5) rowBg = '#FAEEDA';
                    else if (am >= 3) rowBg = '#FEF9E4';
                    else if (am >= 1) rowBg = '#EAF3DE';
                    else if (am === 0) rowBg = '#E6F1FB';
                  }
                  const noteEntry = noteMap[getNoteKey(row)];
                  const hasNote = !!(noteEntry && noteEntry.note && noteEntry.note.trim());
                  const isAccepted = !!(noteEntry && noteEntry.status === 'accept_with_condition'); // MARKER_VATWATCHLISTOPS_NOTES_STATUS_V1
                  const hasRemark = !!(noteEntry && noteEntry.remark && noteEntry.remark.trim()); // MARKER_VATWATCHLISTOPS_NOTES_HIGHLIGHT_TOOLTIP_V1
                  const noteHighlight = hasNote || isAccepted || hasRemark;
                  const noteTitle = (() => {
                    if (!noteEntry) return 'เพิ่ม Note';
                    const lines = [];
                    if (isAccepted) lines.push('สถานะ: Accept with Condition');
                    if (noteEntry.remark) lines.push(`Remark: ${noteEntry.remark}`);
                    if (noteEntry.check_no) lines.push(`เลขที่เช็ค: ${noteEntry.check_no}`);
                    if (noteEntry.note) lines.push(`Note: ${noteEntry.note}`);
                    return lines.length > 0 ? lines.join('\n') : 'เพิ่ม Note';
                  })();
                  // MARKER_VATWATCHLISTOPS_NOTES_ROW_HIGHLIGHT_V1
                  // ── มี Note/Remark/Accept with Condition -> Highlight ทั้งแถวเป็นสีเทา (Override Aging) ──
                  if (noteHighlight) rowBg = '#E4E4E4';
                  return (
                    <tr key={row.id || i} title={noteHighlight ? noteTitle : undefined} style={{ background: rowBg, borderTop: '0.5px solid #e8e8e8' }}>
                      <td style={{ padding: '4px', textAlign: 'center' }}> {/* MARKER_VATWATCHLISTOPS_NOTES_FEATURE_V1 */}
                        <button
                          type="button"
                          onClick={() => openNoteModal(row)}
                          title={noteTitle}
                          style={{ border: noteHighlight ? '0.5px solid #EF9F27' : '0.5px solid #ccc', background: noteHighlight ? '#FAEEDA' : 'transparent', width: '26px', height: '26px', borderRadius: '6px', cursor: 'pointer', color: noteHighlight ? '#854F0B' : '#999', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', padding: 0 }}
                        >📝</button>
                      </td>
                      {/* MARKER_VATWATCHLISTOPS_NOTES_REMAP_LEGACY_COLS_V1 */}
                      {activeCols.map((c) => {
                        // MARKER_VATWATCHLISTOPS_NOTES_REMAP_LEGACY_COLS_V1 -- Column "remark"/"note" เดิม (ว่างตลอด) ดึงจาก noteEntry แทน row
                        let cellValue;
                        if (c.key === 'remark') cellValue = (noteEntry && noteEntry.remark) || '';
                        else if (c.key === 'note') cellValue = (noteEntry && noteEntry.note) || '';
                        else cellValue = VAT_INCOMPLETE_DATE_KEYS.has(c.key) ? formatVatIncompleteDate(row[c.key]) : (row[c.key] ?? '');
                        return <td key={c.key} style={{ padding: '7px 10px' }}>{cellValue}</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {!loadingDetail && detailTotalCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', borderTop: '0.5px solid #e8e8e8', flexShrink: 0, fontSize: '12px', color: '#666' }}>
            <span>แสดง {(detailPageStart + 1).toLocaleString()}–{detailPageEnd.toLocaleString()} จาก {detailTotalCount.toLocaleString()} รายการ</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <select
                value={detailPageSize}
                onChange={(e) => setDetailPageSize(Number(e.target.value))}
                style={{ padding: '5px 8px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '6px', outline: 'none' }}
              >
                <option value="100">100 / หน้า</option>
                <option value="200">200 / หน้า</option>
                <option value="500">500 / หน้า</option>
                <option value="1000">1,000 / หน้า</option>
              </select>
              <button
                onClick={() => setDetailPage(1)}
                disabled={detailPage <= 1}
                style={{ padding: '5px 12px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '6px', background: detailPage <= 1 ? '#f5f5f5' : 'white', color: detailPage <= 1 ? '#bbb' : '#333', cursor: detailPage <= 1 ? 'not-allowed' : 'pointer' }}
              >« หน้าแรก</button>
              <button
                onClick={() => setDetailPage((p) => Math.max(1, p - 1))}
                disabled={detailPage <= 1}
                style={{ padding: '5px 12px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '6px', background: detailPage <= 1 ? '#f5f5f5' : 'white', color: detailPage <= 1 ? '#bbb' : '#333', cursor: detailPage <= 1 ? 'not-allowed' : 'pointer' }}
              >‹ ก่อนหน้า</button>
              <span>หน้า {detailPage} / {detailTotalPages}</span>
              <button
                onClick={() => setDetailPage((p) => Math.min(detailTotalPages, p + 1))}
                disabled={detailPage >= detailTotalPages}
                style={{ padding: '5px 12px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '6px', background: detailPage >= detailTotalPages ? '#f5f5f5' : 'white', color: detailPage >= detailTotalPages ? '#bbb' : '#333', cursor: detailPage >= detailTotalPages ? 'not-allowed' : 'pointer' }}
              >ถัดไป ›</button>
              <button
                onClick={() => setDetailPage(detailTotalPages)}
                disabled={detailPage >= detailTotalPages}
                style={{ padding: '5px 12px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '6px', background: detailPage >= detailTotalPages ? '#f5f5f5' : 'white', color: detailPage >= detailTotalPages ? '#bbb' : '#333', cursor: detailPage >= detailTotalPages ? 'not-allowed' : 'pointer' }}
              >หน้าสุดท้าย »</button>
            </div>
          </div>
        )}
      </div>

      {showConfigModal && (
        <VatIncompleteConfigModal
          allConfigs={allConfigs}
          currentUsername={username}
          currentVisible={visibleColumns}
          onClose={() => setShowConfigModal(false)}
          onSaved={(savedRow) => {
            setVisibleColumns(Array.isArray(savedRow.visible_columns) ? savedRow.visible_columns : []);
            setAllConfigs((prev) => [...prev.filter((c) => c.username !== savedRow.username), savedRow]);
            setShowConfigModal(false);
          }}
        />
      )}

      {/* MARKER_VATWATCHLISTOPS_NOTES_FEATURE_V1 -- Note Modal */}
      {noteModalRow && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: 'white', borderRadius: '12px', border: '0.5px solid #e8e8e8', padding: '1.25rem', width: '360px', maxWidth: '90vw' }}>
            <div style={{ fontWeight: '500', fontSize: '15px', marginBottom: '4px' }}>Note — {noteModalRow.invoice_ref || '—'}</div>
            <div style={{ fontSize: '12px', color: '#999', marginBottom: '12px' }}>
              {(() => {
                const entry = noteMap[getNoteKey(noteModalRow)];
                if (!entry || !entry.note) return 'ยังไม่เคยบันทึก Note';
                const dt = entry.note_at ? new Date(entry.note_at) : null;
                const dtStr = dt && !isNaN(dt.getTime()) ? `${String(dt.getDate()).padStart(2,'0')}-${String(dt.getMonth()+1).padStart(2,'0')}-${dt.getFullYear()} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}` : '';
                const statusLabel = entry.status === 'accept_with_condition' ? ' · Accept with Condition' : '';
                return `บันทึกโดย ${entry.note_by || '-'} · ${dtStr}${statusLabel}`;
              })()}
            </div>
            {/* MARKER_VATWATCHLISTOPS_NOTES_INVOICE_SUMMARY_V1 -- สรุปรายละเอียด Invoice */}
            <div style={{ fontSize: '12px', color: '#555', background: '#f7f7f7', borderRadius: '8px', padding: '8px 10px', marginBottom: '12px', lineHeight: '1.6' }}>
              <div><span style={{ color: '#999' }}>Supplier: </span>{noteModalRow.supplier_code || '—'} — {noteModalRow.vendor_name || '—'}</div>
              <div>
                <span style={{ color: '#999' }}>มูลค่าสินค้า: </span>
                {noteModalRow.exp_amount != null && noteModalRow.exp_amount !== '' ? Number(noteModalRow.exp_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                <span style={{ color: '#999', marginLeft: '12px' }}>เงินภาษี: </span>
                {noteModalRow.exp_vat != null && noteModalRow.exp_vat !== '' ? Number(noteModalRow.exp_vat).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
              </div>
            </div>
            {/* MARKER_VATWATCHLISTOPS_NOTES_REMARK_DROPDOWN_V1 -- Remark (Dropdown) + เลขที่เช็ค จับกลุ่มแถวเดียวกัน */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px' }}>Remark</label>
                <select
                  value={noteDraftRemark}
                  onChange={(e) => setNoteDraftRemark(e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px', fontSize: '13px', border: '0.5px solid #ccc', borderRadius: '8px', outline: 'none', fontFamily: 'inherit', background: 'white' }}
                >
                  <option value="">— เลือก —</option>
                  {NOTE_REMARK_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px' }}>เลขที่เช็ค</label>
                <div style={{ display: 'flex', gap: '4px' }}> {/* MARKER_VATWATCHLISTOPS_NOTES_PULL_CHECKNO_V1 */}
                  <input
                    type="text"
                    value={noteDraftCheckNo}
                    onChange={(e) => setNoteDraftCheckNo(e.target.value)}
                    style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', padding: '8px', fontSize: '13px', border: '0.5px solid #ccc', borderRadius: '8px', outline: 'none', fontFamily: 'inherit' }}
                    placeholder="เลขที่เช็ค..."
                  />
                  <button
                    type="button"
                    onClick={() => setNoteDraftCheckNo((noteModalRow && noteModalRow.check_no) || '')}
                    title="ดึงเลขที่เช็คของ Invoice นี้"
                    style={{ flexShrink: 0, width: '34px', border: '0.5px solid #ccc', borderRadius: '8px', background: 'white', cursor: 'pointer', fontSize: '13px' }}
                  >📥</button>
                </div>
              </div>
            </div>
            {noteDraftCheckNo.trim() && ( // MARKER_VATWATCHLISTOPS_NOTES_TRACK_BY_CHECK_V1
              <div style={{ marginBottom: '10px', padding: '8px 10px', background: '#f7f7f7', borderRadius: '8px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer', marginBottom: '4px' }}>
                  <input type="radio" name="noteTrackMode" checked={noteTrackMode === 'single'} onChange={() => setNoteTrackMode('single')} />
                  <span>บันทึกเฉพาะ Invoice นี้</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
                  <input type="radio" name="noteTrackMode" checked={noteTrackMode === 'all_check'} onChange={() => setNoteTrackMode('all_check')} />
                  <span>บันทึกทุก Invoice ที่ใช้เช็คเลขนี้</span>
                </label>
              </div>
            )}
            <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px' }}>Note (รายละเอียดว่า Return ด้วย Doc อะไร)</label>
            <textarea
              value={noteDraftText}
              onChange={(e) => setNoteDraftText(e.target.value)}
              rows={4}
              style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: '8px', fontSize: '13px', border: '0.5px solid #ccc', borderRadius: '8px', outline: 'none', fontFamily: 'inherit' }}
              placeholder="พิมพ์ Note ที่นี่..."
            />
            {/* MARKER_VATWATCHLISTOPS_NOTES_STATUS_V1 */}
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '10px', fontSize: '13px', cursor: 'pointer' }}>
              <input type="checkbox" checked={noteDraftAccept} onChange={(e) => setNoteDraftAccept(e.target.checked)} />
              <span>ทำเครื่องหมาย <b>Accept with Condition</b></span>
            </label>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginTop: '12px' }}> {/* MARKER_VATWATCHLISTOPS_NOTES_DELETE_BUTTON_V1 */}
              {(noteMap[getNoteKey(noteModalRow)]) ? (
                <button type="button" onClick={deleteNote} disabled={noteSaving} style={{ padding: '6px 14px', fontSize: '13px', border: '0.5px solid #E5484D', borderRadius: '8px', background: 'white', color: '#E5484D', cursor: 'pointer' }}>ลบ Note</button>
              ) : <div />}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" onClick={() => setNoteModalRow(null)} disabled={noteSaving} style={{ padding: '6px 14px', fontSize: '13px', border: '0.5px solid #ccc', borderRadius: '8px', background: 'white', cursor: 'pointer' }}>ยกเลิก</button>
                <button type="button" onClick={saveNote} disabled={noteSaving} style={{ padding: '6px 14px', fontSize: '13px', border: 'none', borderRadius: '8px', background: '#1a3a5c', color: 'white', cursor: 'pointer' }}>{noteSaving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// MARKER_VATWATCHLISTOPS_SUPPORTING_DATA_V1
// -- ดึง SM-Code / Branch / Vendor Category มาเตรียมไว้ก่อน --
// -- ยังไม่ผูก UI/Logic ใดๆ รอออกแบบเพิ่มเติมทีหลัง --
function useVatSupportingData() {
  const [smCodes, setSmCodes] = React.useState([]);
  const [branches, setBranches] = React.useState([]);
  const [vendorCategories, setVendorCategories] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sm, br, vc] = await Promise.all([
          apiFetch('/sm_code_list'),
          apiFetch('/branch_list'),
          apiFetch('/vendor_category'),
        ]);
        if (!cancelled) {
          setSmCodes(Array.isArray(sm) ? sm : []);
          setBranches(Array.isArray(br) ? br : []);
          setVendorCategories(Array.isArray(vc) ? vc : []);
        }
      } catch (err) {
        console.error('useVatSupportingData error:', err);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return { smCodes, branches, vendorCategories, loading };
}

function VatWatchlistOpsLobby() {
  const vatSupportingData = useVatSupportingData(); // MARKER_VATWATCHLISTOPS_SUPPORTING_DATA_V1 -- ยังไม่ได้ใช้ รอ Implement ทีหลัง
  const [testOpsBu, setTestOpsBu] = React.useState(null);
  const [showTestOps, setShowTestOps] = React.useState(false);

  if (showTestOps) {
    return <IncompleteBuOperationTest bu={testOpsBu} onBack={() => setShowTestOps(false)} />;
  }

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', gap: '12px', flex: '35 1 0%' }}>
        <div style={{ ...vatWatchlistZoneStyle, flex: '65 1 0%' }}>65%</div>
        <div style={{ flex: '35 1 0%' }}><VatWatchlistUploadZone /></div>
      </div>
      <div style={{ flex: '65 1 0%', border: '0.5px solid #e8e8e8', borderRadius: '10px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <VatWatchlistMonitorTable onGoto={(row) => { setTestOpsBu(row); setShowTestOps(true); }} />
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