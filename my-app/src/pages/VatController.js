import React from "react";
import ReactDOM from "react-dom"; // MARKER_VATWATCHLISTOPS_DROPDOWN_PORTAL_FIX_V1
import { VAT_CONTROLLER_MENU, VAT_UPLOAD_FILE_TABS } from "../menuConfig"; // MARKER_VATWATCHLISTOPS_UPLOAD_FILE_LOBBY_V1
import { apiFetch } from "../api"; // MARKER_VATWATCHLISTOPS_FIX_TR_WHITESPACE_V1 // MARKER_VATWATCHLISTOPS_APIFETCH_IMPORT_V1
import { subscribeWs, broadcastWs } from "../wsManager"; // MARKER_VATWATCHLISTOPS_BROADCAST_LISTENER_V1 MARKER_VATWATCHLISTOPS_DELETE_BU_ACTION_V1
import { useAuth } from "../contexts/AuthContext"; // MARKER_VATWATCHLISTOPS_ACTION_LOG_V1
import { confirmDialog } from "../confirmDialog"; // MARKER_VATWATCHLISTOPS_CONFIRMDIALOG_IMPORT_V1
import * as XLSX from "xlsx"; // MARKER_VATWATCHLISTOPS_EXPORT_EXCEL_V1
import ExcelJS from "exceljs"; // MARKER_VATWATCHLISTOPS_EXPORT_EXCELJS_STYLING_V1 -- ใช้เฉพาะจุด Export ที่ต้องการสีหัว/Autofit/Freeze (xlsx เดิมรองรับไม่ครบ)
import VatReconcileDashboard from "./VatReconcileDashboard"; // MARKER_VATCONTROLLER_MOUNT_DASHBOARD_V1
import { useUserRole } from "../contexts/useUserRole"; // MARKER_VATWATCHLISTOPS_ROUND_BASED_STATUS_V1 -- สำหรับเช็ค Owner/Admin ตอนกด Confirm รอบ
// MARKER_VATWATCHLISTOPS_IMPORT_ORDER_FIX_V1 -- ย้าย Import ทั้งหมดขึ้นมาไว้บนสุด (แก้ ESLint import/first)

// MARKER_VATWATCHLISTOPS_HYBRID_TAXINVOICEDATE_V1 -- Port มาจาก APController.js แบบเป๊ะ สำหรับ Hybrid Date Field (พิมพ์ได้ + เลือก Calendar ได้)
const isoIfValidFlexDate = (y, mo, d) => {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1000 || y > 9999) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};
const expandYear2Digit = (yyStr) => {
  const n = +yyStr;
  return n <= 49 ? 2000 + n : 1900 + n;
};
const parseFlexibleDate = (str) => {
  if (!str) return null;
  const s = String(str).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return isoIfValidFlexDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (m) {
    const ddmm = isoIfValidFlexDate(+m[3], +m[2], +m[1]);
    if (ddmm) return ddmm;
    return isoIfValidFlexDate(+m[3], +m[1], +m[2]);
  }
  m = s.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (m) {
    const y6 = expandYear2Digit(m[3]);
    const ddmm6 = isoIfValidFlexDate(y6, +m[2], +m[1]);
    if (ddmm6) return ddmm6;
    return isoIfValidFlexDate(y6, +m[1], +m[2]);
  }
  m = s.match(/^(\d{1,2})[\s\-\/]([A-Za-z]{3,})[\s\-\/](\d{2,4})$/);
  if (m) {
    const monthNames = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const idx = monthNames.indexOf(m[2].slice(0, 3).toLowerCase());
    const yName = m[3].length === 2 ? expandYear2Digit(m[3]) : +m[3];
    return idx >= 0 ? isoIfValidFlexDate(yName, idx + 1, +m[1]) : null;
  }
  m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    const y = m[3].length === 2 ? expandYear2Digit(m[3]) : +m[3];
    if (a > 12 && b <= 12) return isoIfValidFlexDate(y, b, a);
    if (b > 12 && a <= 12) return isoIfValidFlexDate(y, a, b);
    return isoIfValidFlexDate(y, a, b);
  }
  return null;
};
const formatDateDisplayMDY = (iso) => {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
};
// MARKER_VATWATCHLISTOPS_ADI_UPLOAD_FIX_DATEFORMAT_SCOPE_V1 -- Module-level version ของ formatQuickActionReceiveDateText (เดิมเป็น Local Scope เรียกข้าม Component ไม่ได้)
const MODULE_MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const formatDateDDMMMYY = (isoDateStr) => { // 'YYYY-MM-DD' -> 'DD-MMM-YY'
  if (!isoDateStr) return null;
  const parts = String(isoDateStr).split('-');
  if (parts.length !== 3) return isoDateStr;
  const [y, m, d] = parts;
  const monthAbbr = MODULE_MONTH_ABBR[parseInt(m, 10) - 1] || m;
  return `${d}-${monthAbbr}-${y.slice(-2)}`;
};

// MARKER_VATWATCHLISTOPS_ADI_ROUNDING_PRECISION_FIX_V1 -- ปัดเศษ/ตัดเศษเงินแบบกัน JS Floating Point Error (เช่น 0.29*100 = 28.999999999999996) เพิ่ม Number.EPSILON ก่อนคูณ 100 เสมอ
const roundMoney2 = (num) => Math.round((Number(num) + Number.EPSILON) * 100) / 100;
const truncateMoney2 = (num) => Math.floor((Number(num) + Number.EPSILON) * 100) / 100;

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
const VAT_WATCHLIST_TAXTYPE_RE = /^([ATF]?).*-(N|M)\s+S?VAT\s*7$/i; // MARKER_VATWATCHLISTOPS_TAXTYPE_REGEX_VAT7_SPACE_V4 -- เติม \s* หลัง VAT รองรับ "VAT 7" ที่มีช่องว่างคั่นด้วย

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
  const prefix = m[1] ? m[1].toUpperCase() : ''; // MARKER_VATWATCHLISTOPS_TAXTYPE_REGEX_CASE_INSENSITIVE_V3 -- แปลงเป็นตัวใหญ่เสมอ กันเทียบ Strict Equality พลาดตอน Prefix เป็นตัวเล็ก
  const suffix = m[2].toUpperCase(); // MARKER_VATWATCHLISTOPS_TAXTYPE_REGEX_CASE_INSENSITIVE_V3
  const cls = suffix === 'M' ? 'M' : (prefix === 'A' ? 'A' : prefix === 'T' ? 'T' : prefix === 'F' ? 'F' : 'N');
  return { cls, prefix, suffix };
}

// MARKER_VATWATCHLISTOPS_INVOICELIST_AVG_PREVIEW_TOOLTIP_V1 -- Preview คำนวณ Asset-Average ล่วงหน้า (ก่อนกด Add Data) คำนวณสดจาก tax_type/exp_vat/BU Rate ที่โหลดอยู่แล้ว ไม่ต้องแก้ DB
function buildAssetAverageTooltip(row, bu) {
  const cls = classifyVatWatchlistTaxType(row?.tax_type);
  const clsKey = (cls && cls.cls) || 'N';
  const buRate = parseFloat(bu?.['VAT %']);
  const isAssetAvg = (clsKey === 'T' || clsKey === 'F') && buRate !== 100;
  if (!isAssetAvg) return 'Normal: ใช้ยอดสินค้าตรงๆ (ไม่เข้าเงื่อนไข Asset-Average)';
  const vatAmt = Number(row?.exp_vat) || 0;
  const avgAmt = Math.round(vatAmt * (buRate || 0) / 100 * 100) / 100;
  const fmt = (n) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `Asset-Average (ถ้าเข้าเงื่อนไข IB): เงินภาษี ${fmt(vatAmt)} x BU Rate ${buRate}% = ${fmt(avgAmt)}`;
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
// MARKER_VATWATCHLISTOPS_FILTER_CURRENT_PERIOD_DOCNO_V1
// ── แปลง "DD-MMM-YY" (เช่น "10-AUG-26") -> "YYYY-MM" (เช่น "2026-08") ──
const VAT_WATCHLIST_MONTH_MAP = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
};
function vatWatchlistDocDateToYearMonth(docDate) {
  if (!docDate) return null;
  const m = String(docDate).trim().match(/^(\d{2})-([A-Z]{3})-(\d{2})/);
  if (!m) return null;
  const mon = VAT_WATCHLIST_MONTH_MAP[m[2]];
  if (!mon) return null;
  return `20${m[3]}-${mon}`;
}

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

// MARKER_VATWATCHLISTOPS_AGING_SYNC_REMOVED_V1 -- Sync Aging ย้ายไปทำที่ Database Trigger แล้ว
// (ดู migration_sync_aging_trigger.sql -- trg_sync_aging_on_accept_condition บนตาราง vat_watchlist_notes)
// ไม่ต้องพึ่ง Frontend เรียก API เพิ่มอีกต่อไป ครอบคลุมทุกช่องทางสร้าง Note อัตโนมัติ

// MARKER_VATWATCHLISTOPS_PREVIEW_PAGINATION_SIZE_V1
const VAT_WATCHLIST_PREVIEW_PAGE_SIZE = 200; // จำนวนแถว/หน้า ของตาราง Preview (กัน Render ทีเดียวหมื่นกว่าแถว)

// MARKER_VATWATCHLISTOPS_CHECKRETURN_MATCH_V1 -- Match ไฟล์ Report (Oracle fnd_gfm Style) กับ Incomplete ที่ Expired ด้วยเลขที่เช็ค+Supplier Code
// Cross-check ยอดด้วย WHT 5 อัตรา (ไม่หัก/1/2/3/5%) Tolerance 1 บาท -- แยก Component ต่างหาก
// ไม่แตะ Logic เดิมของ VatWatchlistUploadModal เลยแม้แต่บรรทัดเดียว (Trigger จาก handleFiles แทน)
function VatCheckReturnMatchContent({ file, onClose }) {
  const { userName } = useAuth();
  const [status, setStatus] = React.useState('parsing'); // parsing -> matching -> preview -> error
  const [errorMsg, setErrorMsg] = React.useState('');
  const [bu, setBu] = React.useState(null);
  const [results, setResults] = React.useState([]);
  const [saving, setSaving] = React.useState(false);
  const [saveDone, setSaveDone] = React.useState(false);
  // MARKER_VATWATCHLISTOPS_CHECKRETURN_TABS_MANUALMATCH_V1 -- Tab Matched/Unmatch + Manual Match State
  const [expiredRows, setExpiredRows] = React.useState([]); // เก็บไว้ใช้หา Candidate ตอน Manual Match
  const [activeTab, setActiveTab] = React.useState('matched'); // 'matched' | 'unmatch'
  const [manualMatchRow, setManualMatchRow] = React.useState(null);
  const [manualMatchSelected, setManualMatchSelected] = React.useState(() => new Set());
  const [manualMatchSaving, setManualMatchSaving] = React.useState(false);
  const [manualMatchedKeys, setManualMatchedKeys] = React.useState(() => new Set());

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setStatus('parsing');
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

        // ── หา BU จาก Liability Account Segment3 (ตัวที่ 3 หลัง Split ด้วย -) ──
        const liabAccounts = [...new Set(rows.map((r) => r['Liability Account']).filter(Boolean))];
        const segment3Set = new Set(liabAccounts.map((la) => String(la).split('-')[2]).filter(Boolean));
        if (segment3Set.size === 0) throw new Error('ไม่พบ Column "Liability Account" ที่ใช้หา BU ได้ในไฟล์นี้');
        if (segment3Set.size > 1) throw new Error(`ไฟล์นี้มี Liability Account หลาย Segment3 ปนกัน (${[...segment3Set].join(', ')}) -- ต้องเป็นไฟล์ BU เดียวเท่านั้น`);
        const segment3 = [...segment3Set][0];

        const [companies, vendorCategories, periodStatus] = await Promise.all([
          apiFetch('/company_list'),
          apiFetch('/vendor_category'),
          apiFetch('/vat/period/status').catch(() => null),
        ]);
        const matchedCompany = (Array.isArray(companies) ? companies : []).find((c) => String(c['SEGMENT3'] || '').trim() === segment3);
        if (!matchedCompany) throw new Error(`หา BU จาก SEGMENT3 "${segment3}" ไม่เจอใน company_list`);
        const detectedBu = matchedCompany.bu;
        if (cancelled) return;
        setBu(detectedBu);

        const vendorCategoryByCode = {};
        (Array.isArray(vendorCategories) ? vendorCategories : []).forEach((v) => {
          const code = String(v['Code'] || '').trim();
          if (code) vendorCategoryByCode[code] = v;
        });
        const currentPeriodMonth = periodStatus ? periodStatus.vat_period_current_month : null;
        const effectivePeriodMonth = getEffectivePeriodMonth(matchedCompany, currentPeriodMonth);
        const today = new Date();

        setStatus('matching');
        // MARKER_VATWATCHLISTOPS_CHECKRETURN_FOUNDNOTE_V1 -- Fetch Note เดิม (remark='Check Return') คู่กัน
        // เพื่อเช็คว่า Transaction นี้เคย Match (Auto/Manual) ไปแล้วในอดีตหรือยัง
        const [incompleteRows, existingNotesRaw] = await Promise.all([
          apiFetch(`/vat_watchlist_report?eq_bu=${encodeURIComponent(detectedBu)}`),
          apiFetch(`/vat_watchlist_notes?eq_bu=${encodeURIComponent(detectedBu)}`).catch(() => []),
        ]);
        const allRows = Array.isArray(incompleteRows) ? incompleteRows : [];
        const existingNotesList = Array.isArray(existingNotesRaw) ? existingNotesRaw : [];
        const foundNoteDescSet = new Set(
          existingNotesList.filter((n) => n.remark === 'Check Return' && n.note).map((n) => String(n.note).trim())
        );

        // ── หาแถวที่ Aging = Expired จริง (ใช้ Logic เดียวกับหน้าจอหลัก) ──
        // หมายเหตุ: ยังไม่รวม Override ปลีกย่อยบางจุด (เช่น มี Note Accept-with-condition
        // อยู่ก่อนแล้ว) -- ถ้าเจอ Note เดิมอยู่แล้วจะข้ามแถวนั้นไปเลย กันเขียนทับซ้ำ
        const expiredRows = allRows.filter((row) => {
          if (row.note_status === 'accept_with_condition') return false; // มี Note อยู่แล้ว ข้าม กันเขียนทับ
          const business = computeVatWatchlistBusiness(row, vendorCategoryByCode, today);
          const aging = computeVatWatchlistAging(business, row, effectivePeriodMonth);
          return aging.label === 'Expired';
        });
        // MARKER_VATWATCHLISTOPS_CHECKRETURN_TABS_MANUALMATCH_V1 -- เก็บไว้ใช้หา Candidate ตอน Manual Match
        if (!cancelled) setExpiredRows(expiredRows);

        // ── Group ตาม เลขที่เช็ค (ตัด -CHECK ท้าย) + Supplier Code ──
        const cleanCheckNo = (cn) => String(cn || '').replace(/-CHECK$/i, '').trim();
        const groupMap = new Map();
        expiredRows.forEach((r) => {
          const cn = cleanCheckNo(r.check_no);
          const sc = String(r.supplier_code || '').trim();
          if (!cn || !sc) return;
          const key = `${cn}|||${sc}`;
          if (!groupMap.has(key)) groupMap.set(key, []);
          groupMap.get(key).push(r);
        });

        function extractCheckFromDescription(desc) {
          const m = String(desc || '').match(/หน้าเช็คCheques Inhouse No\s*(\d+)/);
          return m ? m[1] : null;
        }

        const WHT_RATES = [{ rate: 0, label: 'ไม่หัก' }, { rate: 0.01, label: '1%' }, { rate: 0.02, label: '2%' }, { rate: 0.03, label: '3%' }, { rate: 0.05, label: '5%' }];
        const TOLERANCE = 1;

        const matchResults = [];
        rows.forEach((reportRow) => {
          const invoiceNum = String(reportRow['Invoice Num'] || '').trim();
          const supplierNum = String(reportRow['Supplier Num'] || '').trim();
          const reportAmount = Number(reportRow['Invoice Amount']) || 0;
          const description = reportRow['Description'] || '';

          let group = groupMap.get(`${invoiceNum}|||${supplierNum}`);
          let matchMethod = 'Invoice Num';
          if (!group) {
            const descCheck = extractCheckFromDescription(description);
            if (descCheck) {
              group = groupMap.get(`${descCheck}|||${supplierNum}`);
              matchMethod = 'Description';
            }
          }

          if (!group) {
            // MARKER_VATWATCHLISTOPS_CHECKRETURN_FOUNDNOTE_V1 -- เช็คว่าเคย Match (มี Note ตรง Description นี้) ไปแล้วหรือยัง
            const isFoundNote = !!description && foundNoteDescSet.has(String(description).trim());
            matchResults.push({ checkNo: invoiceNum, supplierCode: supplierNum, vendorName: reportRow['Supplier'] || '', matched: false, reportAmount, description, invoiceDate: reportRow['Invoice Date'] || null, foundNote: isFoundNote }); // MARKER_VATWATCHLISTOPS_CHECKRETURN_TABS_MANUALMATCH_V1
            return;
          }

          const preVatSum = group.reduce((s, r) => s + (Number(r.exp_amount) || 0), 0);
          const vatSum = group.reduce((s, r) => s + (Number(r.exp_vat) || 0), 0);

          let bestMatch = null;
          WHT_RATES.forEach(({ rate, label }) => {
            const calc = preVatSum * (1 - rate) + vatSum;
            const diff = Math.abs(calc - reportAmount);
            if (diff <= TOLERANCE && (!bestMatch || diff < bestMatch.diff)) bestMatch = { rateLabel: label, calc, diff };
          });

          matchResults.push({
            checkNo: invoiceNum,
            supplierCode: supplierNum,
            vendorName: group[0]?.vendor_name || reportRow['Supplier'] || '',
            invoiceCount: group.length,
            invoiceRefs: group.map((r) => r.invoice_ref),
            preVatSum, vatSum, reportAmount, description,
            matched: !!bestMatch,
            matchedRate: bestMatch ? bestMatch.rateLabel : null,
            calcAmount: bestMatch ? bestMatch.calc : null,
            matchMethod,
            invoiceDate: reportRow['Invoice Date'] || null, // MARKER_VATWATCHLISTOPS_CHECKRETURN_TABS_MANUALMATCH_V1
          });
        });

        if (cancelled) return;
        setResults(matchResults);
        setStatus('preview');
      } catch (err) {
        if (!cancelled) { setErrorMsg(err?.message || String(err)); setStatus('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [file]);

  const matchedResults = results.filter((r) => r.matched);
  const unmatchedResults = results.filter((r) => !r.matched);

  const handleConfirmSave = async () => {
    setSaving(true);
    try {
      for (const r of matchedResults) {
        for (const invoiceRef of r.invoiceRefs) {
          const payload = {
            bu, invoice_ref: invoiceRef, supplier_code: r.supplierCode,
            note: r.description, remark: 'Check Return', check_no: r.checkNo,
            status: 'accept_with_condition', note_by: userName, note_at: new Date().toISOString(),
            image_ids: JSON.stringify([]),
          };
          await apiFetch('/vat_watchlist_notes/upsert?onConflict=bu,invoice_ref,supplier_code', { method: 'POST', body: JSON.stringify(payload) });
        }
      }
      setSaveDone(true);
    } catch (err) {
      confirmDialog.alert('บันทึกไม่สำเร็จ: ' + (err?.message || ''), { title: 'ผิดพลาด', variant: 'danger' });
    }
    setSaving(false);
  };

  // MARKER_VATWATCHLISTOPS_CHECKRETURN_TABS_MANUALMATCH_V1 -- หา Candidate + Save Manual Match
  const getManualMatchCandidates = (row) => {
    const supplierCode = String(row.supplierCode || '').trim();
    return expiredRows.filter((r) => String(r.supplier_code || '').trim() === supplierCode);
  };

  const toggleManualMatchSelect = (invoiceRef) => {
    setManualMatchSelected((prev) => {
      const next = new Set(prev);
      if (next.has(invoiceRef)) next.delete(invoiceRef); else next.add(invoiceRef);
      return next;
    });
  };

  const handleManualMatchConfirm = async () => {
    if (!manualMatchRow || manualMatchSelected.size === 0) return;
    setManualMatchSaving(true);
    try {
      const candidates = getManualMatchCandidates(manualMatchRow);
      const targets = candidates.filter((c) => manualMatchSelected.has(c.invoice_ref));
      for (const t of targets) {
        const payload = {
          bu, invoice_ref: t.invoice_ref, supplier_code: t.supplier_code,
          note: manualMatchRow.description, remark: 'Check Return', check_no: manualMatchRow.checkNo,
          status: 'accept_with_condition', note_by: userName, note_at: new Date().toISOString(),
          image_ids: JSON.stringify([]),
        };
        await apiFetch('/vat_watchlist_notes/upsert?onConflict=bu,invoice_ref,supplier_code', { method: 'POST', body: JSON.stringify(payload) });
      }
      setManualMatchedKeys((prev) => {
        const next = new Set(prev);
        next.add(`${manualMatchRow.checkNo}|||${manualMatchRow.supplierCode}`);
        return next;
      });
      setManualMatchRow(null);
      setManualMatchSelected(new Set());
    } catch (err) {
      confirmDialog.alert('บันทึก Manual Match ไม่สำเร็จ: ' + (err?.message || ''), { title: 'ผิดพลาด', variant: 'danger' });
    }
    setManualMatchSaving(false);
  };

  const formatReportDate = (v) => {
    if (!v) return '—';
    try {
      let d = v;
      if (typeof v === 'number') d = new Date(Math.round((v - 25569) * 86400 * 1000));
      else if (!(v instanceof Date)) d = new Date(v);
      if (isNaN(d.getTime())) return String(v);
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
    } catch (e) { return String(v); }
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}> {/* MARKER_VATWATCHLISTOPS_CHECKRETURN_LAYOUT_V2 -- height:100% + flex Column บังคับให้เต็มพื้นที่ Modal เสมอ ไม่หด/ยืดตามเนื้อหา */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexShrink: 0 }}>
          <div style={{ fontSize: '16px', fontWeight: '500' }}>Check Return Matching{bu ? ` — BU: ${bu}` : ''}</div>
          <button onClick={onClose} style={{ width: '28px', height: '28px', padding: 0, border: 'none', borderRadius: '50%', background: '#f0f0f0', cursor: 'pointer', fontSize: '14px', color: '#666' }}>×</button>
        </div>

        {status === 'parsing' && <div style={{ padding: '2rem', textAlign: 'center', color: '#999', fontSize: '13px' }}>กำลังอ่านไฟล์...</div>}
        {status === 'matching' && <div style={{ padding: '2rem', textAlign: 'center', color: '#999', fontSize: '13px' }}>กำลัง Match ข้อมูล...</div>}
        {status === 'error' && (
          <div style={{ padding: '12px', background: '#FCEBEB', color: '#A32D2D', borderRadius: '8px', fontSize: '13px' }}>{errorMsg}</div>
        )}

        {status === 'preview' && !saveDone && (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}> {/* MARKER_VATWATCHLISTOPS_CHECKRETURN_LAYOUT_V2 */}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '1rem', flexShrink: 0 }}>
              <div style={{ flex: 1, background: '#EAF3DE', borderRadius: '8px', padding: '10px 14px' }}>
                <div style={{ fontSize: '12px', color: '#27500A' }}>Match สำเร็จ</div>
                <div style={{ fontSize: '20px', fontWeight: '500', color: '#27500A' }}>{matchedResults.length} รายการ</div>
              </div>
              <div style={{ flex: 1, background: '#f5f5f5', borderRadius: '8px', padding: '10px 14px' }}>
                <div style={{ fontSize: '12px', color: '#999' }}>ไม่พบ Match</div>
                <div style={{ fontSize: '20px', fontWeight: '500', color: '#666' }}>{unmatchedResults.length} รายการ</div>
              </div>
            </div>

            {/* MARKER_VATWATCHLISTOPS_CHECKRETURN_TABS_MANUALMATCH_V1 -- Tab Matched / Unmatch */}
            <div style={{ display: 'flex', gap: '4px', marginBottom: '10px', borderBottom: '0.5px solid #ddd', flexShrink: 0 }}>
              <button
                onClick={() => setActiveTab('matched')}
                style={{ padding: '8px 14px', fontSize: '12px', border: 'none', background: 'none', cursor: 'pointer', color: activeTab === 'matched' ? '#1a3a5c' : '#999', fontWeight: activeTab === 'matched' ? '500' : '400', borderBottom: activeTab === 'matched' ? '2px solid #1a3a5c' : '2px solid transparent' }}
              >Matched ({matchedResults.length})</button>
              <button
                onClick={() => setActiveTab('unmatch')}
                style={{ padding: '8px 14px', fontSize: '12px', border: 'none', background: 'none', cursor: 'pointer', color: activeTab === 'unmatch' ? '#1a3a5c' : '#999', fontWeight: activeTab === 'unmatch' ? '500' : '400', borderBottom: activeTab === 'unmatch' ? '2px solid #1a3a5c' : '2px solid transparent' }}
              >Unmatch ({unmatchedResults.length})</button>
            </div>

            {activeTab === 'matched' && (
            <div style={{ border: '0.5px solid #ddd', borderRadius: '8px', overflow: 'auto', flex: 1, minHeight: 0 }}> {/* MARKER_VATWATCHLISTOPS_CHECKRETURN_LAYOUT_V2 -- flex:1 แทน maxHeight ตายตัว ยืดเต็มพื้นที่ที่เหลือ */}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: '#f5f5f5', position: 'sticky', top: 0 }}> {/* MARKER_VATWATCHLISTOPS_CHECKRETURN_LAYOUT_V2 -- แถวหัวกลุ่ม: Incomplete / ไฟล์ Report / Results */}
                    <th colSpan={5} style={{ textAlign: 'left', padding: '6px 8px', fontSize: '11px', color: '#888', borderBottom: '0.5px solid #ddd' }}>Incomplete</th>
                    <th colSpan={1} style={{ textAlign: 'left', padding: '6px 8px', fontSize: '11px', color: '#888', borderBottom: '0.5px solid #ddd', borderLeft: '0.5px solid #ddd' }}>ไฟล์ Report</th>
                    <th colSpan={5} style={{ textAlign: 'left', padding: '6px 8px', fontSize: '11px', color: '#888', borderBottom: '0.5px solid #ddd', borderLeft: '0.5px solid #ddd' }}>Results</th>
                  </tr>
                  <tr style={{ background: '#f5f5f5', position: 'sticky', top: '25px' }}>
                    <th style={{ textAlign: 'left', padding: '8px' }}>เลขที่เช็ค</th>
                    <th style={{ textAlign: 'left', padding: '8px' }}>Supplier</th>
                    <th style={{ textAlign: 'center', padding: '8px' }}>Invoice</th>
                    <th style={{ textAlign: 'right', padding: '8px' }}>มูลค่าสินค้า</th>
                    <th style={{ textAlign: 'right', padding: '8px' }}>เงินภาษี</th>
                    <th style={{ textAlign: 'right', padding: '8px', borderLeft: '0.5px solid #ddd' }}>Amount</th>
                    <th style={{ textAlign: 'center', padding: '8px', borderLeft: '0.5px solid #ddd' }}>WHT ที่ตรง</th>
                    <th style={{ textAlign: 'right', padding: '8px', background: '#FFF7E0' }}>ยอดที่คำนวณได้</th> {/* MARKER_VATWATCHLISTOPS_CHECKRETURN_CALCAMOUNT_COL_V1 */}
                    <th style={{ textAlign: 'left', padding: '8px' }}>Remark</th>
                    <th style={{ textAlign: 'left', padding: '8px' }}>Description</th>
                    <th style={{ textAlign: 'left', padding: '8px' }}>สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {matchedResults.map((r, i) => (
                    <tr key={i} style={{ borderTop: '0.5px solid #eee' }}>
                      <td style={{ padding: '8px' }}>{r.checkNo}</td>
                      <td style={{ padding: '8px' }}>{r.supplierCode}{r.vendorName ? ` — ${r.vendorName}` : ''}</td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>{r.invoiceCount ?? '—'}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>{r.preVatSum != null ? r.preVatSum.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}) : '—'}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>{r.vatSum != null ? r.vatSum.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}) : '—'}</td>
                      <td style={{ padding: '8px', textAlign: 'right', borderLeft: '0.5px solid #eee' }}>{r.reportAmount.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                      <td style={{ padding: '8px', textAlign: 'center', borderLeft: '0.5px solid #eee' }}>{r.matchedRate || '—'}</td>
                      <td style={{ padding: '8px', textAlign: 'right', background: '#FFFBF0' }}>{r.calcAmount != null ? r.calcAmount.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}) : '—'}</td> {/* MARKER_VATWATCHLISTOPS_CHECKRETURN_CALCAMOUNT_COL_V1 */}
                      <td style={{ padding: '8px' }}>Check Return</td>
                      <td style={{ padding: '8px', maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.description || ''}>{r.description || '—'}</td>
                      <td style={{ padding: '8px' }}>
                        <span style={{ background: '#EAF3DE', color: '#27500A', fontSize: '11px', padding: '2px 8px', borderRadius: '6px' }}>Matched</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}

            {activeTab === 'unmatch' && (
            <div style={{ border: '0.5px solid #ddd', borderRadius: '8px', overflow: 'auto', flex: 1, minHeight: 0 }}> {/* MARKER_VATWATCHLISTOPS_CHECKRETURN_TABS_MANUALMATCH_V1 */}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: '#f5f5f5', position: 'sticky', top: 0 }}>
                    <th style={{ textAlign: 'left', padding: '8px' }}>Invoice Num</th>
                    <th style={{ textAlign: 'left', padding: '8px' }}>Supplier</th>
                    <th style={{ textAlign: 'left', padding: '8px' }}>Invoice Date</th>
                    <th style={{ textAlign: 'right', padding: '8px' }}>Invoice Amount</th>
                    <th style={{ textAlign: 'left', padding: '8px' }}>Description</th>
                    <th style={{ textAlign: 'left', padding: '8px', width: '150px' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {unmatchedResults.map((r, i) => {
                    const key = `${r.checkNo}|||${r.supplierCode}`;
                    const isManualMatched = manualMatchedKeys.has(key);
                    return (
                      <tr key={i} style={{ borderTop: '0.5px solid #eee' }}>
                        <td style={{ padding: '8px' }}>{r.checkNo}</td>
                        <td style={{ padding: '8px' }}>{r.supplierCode}{r.vendorName ? ` — ${r.vendorName}` : ''}</td>
                        <td style={{ padding: '8px' }}>{formatReportDate(r.invoiceDate)}</td>
                        <td style={{ padding: '8px', textAlign: 'right' }}>{r.reportAmount.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                        <td style={{ padding: '8px', maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.description || ''}>{r.description || '—'}</td>
                        <td style={{ padding: '8px' }}>
                          {isManualMatched ? (
                            <span style={{ background: '#EAF3DE', color: '#27500A', fontSize: '11px', padding: '3px 8px', borderRadius: '6px' }}>Matched (Manual)</span>
                          ) : r.foundNote ? ( // MARKER_VATWATCHLISTOPS_CHECKRETURN_FOUNDNOTE_V1 -- เคย Match ไปแล้วในอดีต ไม่ต้องทำอะไรต่อ
                            <span style={{ background: '#FAC775', color: '#412402', fontSize: '11px', fontWeight: '500', padding: '3px 8px', borderRadius: '6px' }}>Found Note!!!</span>
                          ) : (
                            <button
                              onClick={() => { setManualMatchRow(r); setManualMatchSelected(new Set()); }}
                              style={{ padding: '4px 10px', fontSize: '11px', border: '0.5px solid #ccc', borderRadius: '6px', background: 'white', cursor: 'pointer', color: '#1a3a5c' }}
                            >Manual Match</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '1rem', flexShrink: 0 }}>
              <button onClick={onClose} disabled={saving} style={{ padding: '8px 16px', fontSize: '13px', border: '0.5px solid #ccc', borderRadius: '8px', background: 'white', cursor: 'pointer' }}>ยกเลิก</button>
              <button
                onClick={handleConfirmSave}
                disabled={saving || matchedResults.length === 0}
                style={{ padding: '8px 16px', fontSize: '13px', border: 'none', borderRadius: '8px', background: '#1a3a5c', color: 'white', cursor: saving ? 'default' : 'pointer', opacity: matchedResults.length === 0 ? 0.5 : 1 }}
              >
                {saving ? 'กำลังบันทึก...' : `บันทึก ${matchedResults.length} รายการที่ Match`}
              </button>
            </div>
          </div>
        )}

        {saveDone && (
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <div style={{ fontSize: '15px', color: '#27500A', marginBottom: '12px' }}>บันทึกสำเร็จ {matchedResults.length} รายการ</div>
            <button onClick={onClose} style={{ padding: '8px 20px', fontSize: '13px', border: 'none', borderRadius: '8px', background: '#1a3a5c', color: 'white', cursor: 'pointer' }}>ปิด</button>
          </div>
        )}

        {/* MARKER_VATWATCHLISTOPS_CHECKRETURN_TABS_MANUALMATCH_V1 -- Manual Match Modal */}
        {manualMatchRow && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}>
            <div style={{ background: 'white', borderRadius: '12px', padding: '1.5rem', width: '620px', maxWidth: '95vw', maxHeight: '85vh', overflowY: 'auto', boxSizing: 'border-box' }}>
              <div style={{ fontSize: '14px', fontWeight: '500', marginBottom: '4px' }}>Manual Match — Invoice {manualMatchRow.checkNo}</div>
              <div style={{ fontSize: '12px', color: '#888', marginBottom: '14px' }}>
                Supplier {manualMatchRow.supplierCode}{manualMatchRow.vendorName ? ` — ${manualMatchRow.vendorName}` : ''} · Amount จากไฟล์ {manualMatchRow.reportAmount.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}
              </div>
              <div style={{ fontSize: '11px', color: '#999', marginBottom: '6px' }}>รายการ Incomplete ที่ Supplier Code เดียวกัน + Expired + ยังไม่มี Note (เลือกได้มากกว่า 1 รายการ)</div>
              {(() => {
                const candidates = getManualMatchCandidates(manualMatchRow);
                if (candidates.length === 0) {
                  return <div style={{ padding: '1.5rem', textAlign: 'center', color: '#999', fontSize: '13px' }}>ไม่พบ Incomplete ที่ Supplier Code นี้ (Expired + ยังไม่มี Note)</div>;
                }
                return (
                  <div style={{ border: '0.5px solid #ddd', borderRadius: '8px', overflow: 'hidden' }}>
                    {candidates.map((c, ci) => (
                      <label key={c.invoice_ref || ci} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderBottom: ci < candidates.length - 1 ? '0.5px solid #eee' : 'none', cursor: 'pointer' }}>
                        <input type="checkbox" checked={manualMatchSelected.has(c.invoice_ref)} onChange={() => toggleManualMatchSelect(c.invoice_ref)} style={{ margin: 0 }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '12px' }}>{c.invoice_ref} <span style={{ color: '#999' }}>· เช็คเลขที่ {c.check_no || '—'}</span></div>
                          <div style={{ fontSize: '11px', color: '#666' }}>
                            มูลค่าสินค้า {c.exp_amount != null ? Number(c.exp_amount).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}) : '—'} · เงินภาษี {c.exp_vat != null ? Number(c.exp_vat).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}) : '—'}
                          </div>
                        </div>
                        <span style={{ background: '#FCEBEB', color: '#A32D2D', fontSize: '10px', padding: '2px 7px', borderRadius: '6px' }}>Expired</span>
                      </label>
                    ))}
                  </div>
                );
              })()}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' }}>
                <button onClick={() => { setManualMatchRow(null); setManualMatchSelected(new Set()); }} disabled={manualMatchSaving} style={{ padding: '7px 14px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '8px', background: 'white', cursor: 'pointer' }}>ยกเลิก</button>
                <button
                  onClick={handleManualMatchConfirm}
                  disabled={manualMatchSaving || manualMatchSelected.size === 0}
                  style={{ padding: '7px 14px', fontSize: '12px', border: 'none', borderRadius: '8px', background: '#1a3a5c', color: 'white', cursor: manualMatchSaving ? 'default' : 'pointer', opacity: manualMatchSelected.size === 0 ? 0.5 : 1 }}
                >{manualMatchSaving ? 'กำลังบันทึก...' : `ยืนยัน Match (${manualMatchSelected.size} รายการ)`}</button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}

function VatWatchlistUploadModal({ onClose }) {
  const { userName, currentUser } = useAuth(); // MARKER_VATWATCHLISTOPS_ACTION_LOG_V1
  const fileInputRef = React.useRef(null);
  const textareaRef = React.useRef(null);
  const previewHeaderRef = React.useRef(null);
  const previewBodyRef = React.useRef(null);
  // MARKER_VATWATCHLISTOPS_MULTIFILE_CHECK_V1 -- เปลี่ยนจากไฟล์เดี่ยว เป็นรองรับหลายไฟล์
  const [selectedFiles, setSelectedFiles] = React.useState([]);
  const [fileCheckResults, setFileCheckResults] = React.useState([]); // [{fileName, dateStr, rawText, buRows:[{bu,count,taxTypes}], hasData}]
  const [isCheckingFiles, setIsCheckingFiles] = React.useState(false);
  // MARKER_VATWATCHLISTOPS_UNCONTROLLED_TEXTAREA_V1
  const [hasTextInput, setHasTextInput] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const [isFocused, setIsFocused] = React.useState(false);
  const [previewRows, setPreviewRows] = React.useState(null);
  const [completedRows, setCompletedRows] = React.useState(null); // MARKER_VATWATCHLISTOPS_PENDING_COMPLETED_TABS_V1
  const [previewTab, setPreviewTab] = React.useState('pending'); // MARKER_VATWATCHLISTOPS_PENDING_COMPLETED_TABS_V1
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

  // MARKER_VATWATCHLISTOPS_MULTIFILE_CHECK_V1
  const runQuickFileCheck = async (files) => { // MARKER_VATWATCHLISTOPS_MULTIFILE_CHECK_CONFIG_V1
    setIsCheckingFiles(true);
    try {
      const [branches, companies, buGroupRanges, periodStatus] = await Promise.all([apiFetch('/branch_list'), apiFetch('/company_list'), apiFetch('/vat_watchlist_bu_group_range').catch(() => []), apiFetch('/vat/period/status').catch(() => null)]); // MARKER_VATWATCHLISTOPS_MULTIFILE_CHECK_GROUPRANGE_V1 MARKER_VATWATCHLISTOPS_FILECHECK_PENDING_COMPLETED_COLS_V1
      const currentPeriodMonth = periodStatus ? periodStatus.vat_period_current_month : null; // MARKER_VATWATCHLISTOPS_FILECHECK_PENDING_COMPLETED_COLS_V1
      const branchToBu = {};
      (Array.isArray(branches) ? branches : []).forEach((b) => { branchToBu[b['Branch Code']] = b.bu; });
      const buToCompany = {};
      (Array.isArray(companies) ? companies : []).forEach((c) => { buToCompany[c.bu] = c; });
      const segment3ToCompany = {}; // MARKER_VATWATCHLISTOPS_FILECHECK_SEGMENT3_FALLBACK_V1 -- Fallback ตัวที่ 3 หา BU ด้วย Branch 4 หลักแรก
      (Array.isArray(companies) ? companies : []).forEach((c) => { if (c.SEGMENT3) segment3ToCompany[c.SEGMENT3] = c; });
      const groupRangesList = Array.isArray(buGroupRanges) ? buGroupRanges : [];
      const results = [];
      for (const file of files) {
        const buffer = await file.arrayBuffer();
        let text;
        try { text = new TextDecoder('windows-874').decode(buffer); }
        catch (err) { text = new TextDecoder('utf-8').decode(buffer); }
        const rawRows = parseVatWatchlistRawText(text);
        const dateIso = extractVatWatchlistIncompleteToDate(text);
        let dateStr = '—';
        if (dateIso) {
          const d = new Date(dateIso);
          if (!isNaN(d.getTime())) dateStr = `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
        }
        const byBu = {}; // MARKER_VATWATCHLISTOPS_FILECHECK_SPLIT_BY_TAXTYPE_V1 -- เปลี่ยนจากนับรวม (matchedCount) เป็นนับแยกตาม Type (byType)
        rawRows.forEach((row) => {
          // MARKER_VATWATCHLISTOPS_MULTIFILE_GROUPRANGE_PRIORITY_V1 -- Group Range เช็คก่อนเสมอ ชนะ branch_list ถ้าเจอ
          const seg3 = (row.branch || '').replace(/^[ATF]/, '').slice(0, 4); // MARKER_VATWATCHLISTOPS_FILECHECK_SEGMENT3_FALLBACK_V1 -- ตัด A/T/F นำหน้าออกก่อนเสมอ แล้วค่อยตัด 4 หลักแรก
          const bu = matchVatWatchlistBuGroup(row.branch, groupRangesList) || branchToBu[row.branch] || (segment3ToCompany[seg3] ? segment3ToCompany[seg3].bu : null) || '(ไม่พบ BU)'; // MARKER_VATWATCHLISTOPS_FILECHECK_SEGMENT3_FALLBACK_V1
          if (!byBu[bu]) byBu[bu] = { count: 0, byType: {} };
          byBu[bu].count += 1;
          // ── คำนวณคร่าวๆ ว่าแถวนี้ Tax Type ผ่าน allowed_tax_type ของ BU จริงไหม (ใกล้เคียง handleCheckData) ──
          const rowCompany = buToCompany[bu];
          const allowedRaw = rowCompany ? rowCompany.allowed_tax_type : null;
          if (allowedRaw) {
            const classified = classifyVatWatchlistTaxType(row.tax_type);
            if (classified) {
              const { cls } = classified;
              const allowedList = allowedRaw.trim().toLowerCase() === 'all type' ? null : allowedRaw.split(',').map((s) => s.trim().toUpperCase()); // MARKER_VATWATCHLISTOPS_ALLOWEDTAXTYPE_CASE_INSENSITIVE_V1 -- ไม่สนตัวพิมพ์ใหญ่-เล็กทั้ง "All Type" และรายการ Tax Type
              const blockedAllTypeM = allowedList === null && cls === 'M';
              const canFallbackNtoAFileCheck = cls === 'A' && allowedList && allowedList.includes('N'); // MARKER_VATWATCHLISTOPS_FILECHECK_TAXTYPE_FALLBACK_V1 -- เหมือน Rule จุดประมวลผลจริง
              const canFallbackTtoFFileCheck = cls === 'F' && allowedList && allowedList.includes('T'); // MARKER_VATWATCHLISTOPS_FILECHECK_TAXTYPE_FALLBACK_V1
              const isAllowed = !blockedAllTypeM && (allowedList === null || allowedList.includes(cls) || canFallbackNtoAFileCheck || canFallbackTtoFFileCheck);
              if (isAllowed) {
                if (!byBu[bu].byType[cls]) byBu[bu].byType[cls] = { pending: 0, complete: 0 }; // MARKER_VATWATCHLISTOPS_FILECHECK_PENDING_COMPLETED_COLS_V1
                const isCompleted = row.doc_no && String(row.doc_no).trim() !== '' && currentPeriodMonth && vatWatchlistDocDateToYearMonth(row.doc_date) === currentPeriodMonth; // MARKER_VATWATCHLISTOPS_FILECHECK_PENDING_COMPLETED_COLS_V1
                if (isCompleted) byBu[bu].byType[cls].complete += 1;
                else byBu[bu].byType[cls].pending += 1;
              }
            }
          }
        });
        // MARKER_VATWATCHLISTOPS_MULTIFILE_VATZERO_PRIORITY_V1 -- VAT 0% เป็นเงื่อนไขหลัก ไม่ต้องโชว์ "ยังไม่ Setup" ควบคู่
        const buRows = []; // MARKER_VATWATCHLISTOPS_FILECHECK_SPLIT_BY_TAXTYPE_V1 -- 1 แถวต่อ 1 (BU, Type) แทนที่จะรวมเป็นแถวเดียวต่อ BU
        Object.entries(byBu).forEach(([bu, v]) => {
          const company = buToCompany[bu];
          const vatPercent = company ? parseFloat(company['VAT %']) : null;
          if (vatPercent === 0) {
            buRows.push({ bu, pending: 0, complete: 0, taxTypes: '⚠️ ภาษี 0%', noData: true }); // MARKER_VATWATCHLISTOPS_FILECHECK_PENDING_COMPLETED_COLS_V1
            return;
          }
          if (!company || !company.allowed_tax_type) {
            buRows.push({ bu, pending: 0, complete: 0, taxTypes: '⚠️ ยังไม่ Setup', noData: true }); // MARKER_VATWATCHLISTOPS_FILECHECK_PENDING_COMPLETED_COLS_V1
            return;
          }
          const typeEntries = Object.entries(v.byType).sort((a, b) => (b[1].pending + b[1].complete) - (a[1].pending + a[1].complete)); // MARKER_VATWATCHLISTOPS_FILECHECK_PENDING_COMPLETED_COLS_V1 -- เรียงมาก -> น้อย
          if (typeEntries.length === 0) {
            buRows.push({ bu, pending: 0, complete: 0, taxTypes: company.allowed_tax_type, noData: true }); // MARKER_VATWATCHLISTOPS_FILECHECK_PENDING_COMPLETED_COLS_V1
            return;
          }
          typeEntries.forEach(([type, cnt]) => {
            buRows.push({ bu, pending: cnt.pending, complete: cnt.complete, taxTypes: type, noData: false }); // MARKER_VATWATCHLISTOPS_FILECHECK_PENDING_COMPLETED_COLS_V1
          });
        });
        results.push({ fileName: file.name, dateStr, rawText: text, buRows, hasData: rawRows.length > 0 });
      }
      setFileCheckResults((prev) => [...prev, ...results]); // MARKER_VATWATCHLISTOPS_MULTIFILE_APPEND_FIX_V1
    } catch (err) {
      console.error('runQuickFileCheck error:', err);
    }
    setIsCheckingFiles(false);
  };

  const [checkReturnFile, setCheckReturnFile] = React.useState(null); // MARKER_VATWATCHLISTOPS_CHECKRETURN_MATCH_V1

  const handleFiles = (files) => { // MARKER_VATWATCHLISTOPS_MULTIFILE_APPEND_FIX_V1
    const fileArr = Array.from(files || []);
    if (fileArr.length === 0) return;

    // MARKER_VATWATCHLISTOPS_CHECKRETURN_MATCH_V1 -- เช็คก่อนว่าไฟล์แรกเป็น Excel Binary จริง + Column "Pay Group" เป็น
    // "APN-RETURN CHQ" ล้วนทุกแถวไหม -- ถ้าใช่ แยกไป Flow Check Return Matching ทั้งหมด
    // ไม่ผสมกับ Flow Text-Parse เดิม (ถ้า Error หรือไม่ตรงเงื่อนไข ทำงานแบบเดิมทุกอย่าง)
    const firstFile = fileArr[0];
    firstFile.arrayBuffer().then((buf) => {
      let isCheckReturnFile = false;
      try {
        const wb = XLSX.read(buf, { type: 'array' });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
        const payGroups = [...new Set(rows.map((r) => r['Pay Group']).filter(Boolean))];
        isCheckReturnFile = rows.length > 0 && payGroups.length === 1 && payGroups[0] === 'APN-RETURN CHQ';
      } catch (e) { isCheckReturnFile = false; }

      if (isCheckReturnFile) {
        setCheckReturnFile(firstFile);
        return;
      }
      setSelectedFiles((prev) => [...prev, ...fileArr]);
      setHasTextInput(false);
      if (textareaRef.current) textareaRef.current.value = '';
      runQuickFileCheck(fileArr);
    }).catch(() => {
      setSelectedFiles((prev) => [...prev, ...fileArr]);
      setHasTextInput(false);
      if (textareaRef.current) textareaRef.current.value = '';
      runQuickFileCheck(fileArr);
    });
  };

  const hasInput = fileCheckResults.some((r) => r.hasData) || hasTextInput;

  const [isChecking, setIsChecking] = React.useState(false);
  const [checkSkippedCount, setCheckSkippedCount] = React.useState(0);
  // MARKER_VATWATCHLISTOPS_EMPTY_PREVIEW_DIAGNOSTIC_V1
  const [checkZeroVatBus, setCheckZeroVatBus] = React.useState([]);

  // MARKER_VATWATCHLISTOPS_BU_GROUP_RANGE_FALLBACK_V1
  // ── Match Branch Code กับ Group Range Config (เช่น CRG 5000-5249) ──────────
  // ── ใช้เฉพาะตอน Branch->branch_list และ Segment3 Fallback หา BU ไม่เจอทั้งคู่ ──
  const matchVatWatchlistBuGroup = (branchCode, groupRanges) => {
    if (!branchCode || !groupRanges || groupRanges.length === 0) return null;
    const cleanBranchCode = String(branchCode).replace(/^[ATF]/, ''); // MARKER_VATWATCHLISTOPS_GROUPRANGE_STRIP_ATF_PREFIX_V1 -- ตัด A/T/F นำหน้าออกก่อนเสมอ (Pattern เดียวกับ Segment3)
    let bestMatch = null;
    let bestSpan = Infinity;
    for (const r of groupRanges) {
      const len = r.prefix_length; // 3, 4, หรือ null (Full)
      const key = len ? cleanBranchCode.slice(0, len) : cleanBranchCode; // MARKER_VATWATCHLISTOPS_GROUPRANGE_STRIP_ATF_PREFIX_V1
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
    if (fileCheckResults.length > 0) { // MARKER_VATWATCHLISTOPS_MULTIFILE_CHECK_V1
      sourceText = fileCheckResults.filter((r) => r.hasData).map((r) => r.rawText).join('\n');
    }
    const rawRows = parseVatWatchlistRawText(sourceText);
    setIncompleteToIso(extractVatWatchlistIncompleteToDate(sourceText));

    setIsChecking(true);
    try {
      const [branches, companies, vendorCategories, periodStatus, buGroupRanges, existingNotes] = await Promise.all([
        apiFetch('/branch_list'),
        apiFetch('/company_list'),
        apiFetch('/vendor_category'),
        apiFetch('/vat/period/status').catch(() => null),
        apiFetch('/vat_watchlist_bu_group_range').catch(() => []), // MARKER_VATWATCHLISTOPS_BU_GROUP_RANGE_FALLBACK_V1
        apiFetch('/vat_watchlist_notes').catch(() => []), // MARKER_VATWATCHLISTOPS_AGING_ACCEPT_CONDITION_UNCOUNT_V1 -- ดึงทุก BU เพราะ Modal นี้ Process ได้หลาย BU พร้อมกัน
      ]);
      const existingNoteMap = {}; // MARKER_VATWATCHLISTOPS_AGING_ACCEPT_CONDITION_UNCOUNT_V1
      (Array.isArray(existingNotes) ? existingNotes : []).forEach((n) => {
        existingNoteMap[`${n.bu || ''}|${n.invoice_ref || ''}|${n.supplier_code || ''}`] = n;
      });
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
      let skippedCurrentPeriod = 0; // MARKER_VATWATCHLISTOPS_FILTER_CURRENT_PERIOD_DOCNO_V1
      const zeroVatBuSet = new Set(); // MARKER_VATWATCHLISTOPS_EMPTY_PREVIEW_DIAGNOSTIC_V1
      const validRows = [];
      const completedRowsList = []; // MARKER_VATWATCHLISTOPS_PENDING_COMPLETED_TABS_V1
      for (const row of rawRows) {
        let bu = branchToBu[row.branch];
        // MARKER_VATWATCHLISTOPS_EMPTY_PREVIEW_DIAGNOSTIC_V1 — เก็บ BU ที่ VAT%=0 ไว้เช็คทีหลัง
        {
          const preBuCompany = buToCompany[bu] || (Array.isArray(companies) ? companies.find((c) => c.bu === bu) : null);
          if (preBuCompany && parseFloat(preBuCompany['VAT %']) === 0 && !zeroVatBuSet.has(bu)) {
            zeroVatBuSet.add(bu);
          }
        }
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
        // MARKER_VATWATCHLISTOPS_PENDING_COMPLETED_TABS_V2 -- ย้าย Period-Check ไปไว้หลัง Classify+Allowed แล้ว (ดูจุดที่ 2 ด้านล่าง)
        const classified = classifyVatWatchlistTaxType(row.tax_type);
        const allowedRaw = company ? company.allowed_tax_type : null;

        // ── ไม่รู้ BU/Book หรือ Classify Tax Type ไม่ได้ -> ตัดออก (ปลอดภัยไว้ก่อน) ──
        if (!bu || !company || !allowedRaw || !classified) { skipped++; continue; }

        const { cls, suffix } = classified;
        const allowedList = allowedRaw.trim().toLowerCase() === 'all type' ? null : allowedRaw.split(',').map((s) => s.trim().toUpperCase()); // MARKER_VATWATCHLISTOPS_ALLOWEDTAXTYPE_CASE_INSENSITIVE_V1 -- ไม่สนตัวพิมพ์ใหญ่-เล็กทั้ง "All Type" และรายการ Tax Type
        // MARKER_VATWATCHLISTOPS_ALLTYPE_EXCLUDE_M_V1
        // ── All Type ไม่นับรวม M อัตโนมัติ -- ต้องระบุ M เจาะจงใน allowed_tax_type เองเท่านั้นถึงจะรับ ──
        if (allowedList === null && cls === 'M') { skipped++; continue; }

        const isAllowed = allowedList === null || allowedList.includes(cls);
        let needsRecheck = false;
        if (!isAllowed) {
          // MARKER_VATWATCHLISTOPS_RECHECK_RULE_V1
          // ── Suffix=N (ไม่ใช่ M) และ BU อนุญาต 'N' อยู่แล้ว -> Prefix (A/T/F) อาจพิมพ์ผิด ──
          // ── เนื้อในยังเป็น N ที่ถูกต้อง -> ไม่ตัดออก แค่ Flag Recheck ไว้ ──────────────
          const canRecheckSuffixN = suffix === 'N' && allowedList && allowedList.includes('N');
          // MARKER_VATWATCHLISTOPS_TAXTYPE_FALLBACK_N_TO_A_T_TO_F_V1 -- BU อนุญาต N ให้จับ A ได้ด้วย / BU อนุญาต T ให้จับ F ได้ด้วย (กันข้อมูลหล่นจาก Format เก่า)
          const canFallbackNtoA = cls === 'A' && allowedList && allowedList.includes('N');
          const canFallbackTtoF = cls === 'F' && allowedList && allowedList.includes('T');
          const canRecheck = canRecheckSuffixN || canFallbackNtoA || canFallbackTtoF;
          if (!canRecheck) { skipped++; continue; }
          needsRecheck = true;
        }

        // MARKER_VATWATCHLISTOPS_FILTER_CURRENT_PERIOD_DOCNO_V1
        // ── "เลขที่" มีข้อมูลแล้ว + วันที่ตรง Period ปัจจุบัน -> ตัดออก (ถือว่าดำเนินการแล้ว) ──
        // ── MARKER_VATWATCHLISTOPS_PENDING_COMPLETED_TABS_V2: ย้ายมาไว้ตรงนี้ (หลัง Classify+Allowed) กัน Type ที่ไม่ Allowed (เช่น M) หลุดเข้า Completed ──
        if (row.doc_no && String(row.doc_no).trim() !== '' &&
            currentPeriodMonth && vatWatchlistDocDateToYearMonth(row.doc_date) === currentPeriodMonth) {
          skippedCurrentPeriod++;
          completedRowsList.push({ ...row, bu, book: company.BOOK, tax_class: cls }); // MARKER_VATWATCHLISTOPS_PENDING_COMPLETED_TABS_V2
          continue;
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
        // MARKER_VATWATCHLISTOPS_AGING_DOCNO_UNCOUNT_V1
        // ── "เลขที่" มีข้อมูลแล้ว -> Override Aging เป็น IV-Aging Uncount เสมอ ──
        if (row.doc_no && String(row.doc_no).trim() !== '') {
          aging.months = null;
          aging.label = 'IV-Aging Uncount';
        }
        // MARKER_VATWATCHLISTOPS_AGING_ACCEPT_CONDITION_UNCOUNT_V1
        // ── มี Note สถานะ Accept with Condition อยู่แล้ว -> Override Aging เป็น Uncount เช่นกัน (Bucket เดียวกัน) ──
        {
          const existingNote = existingNoteMap[`${bu || ''}|${row.invoice_ref || ''}|${row.supplier_code || ''}`];
          if (existingNote && existingNote.status === 'accept_with_condition') {
            aging.months = null; // ต้องเป็น null เสมอ -- Backend นับ Bucket "Uncount" จาก aging_months IS NULL เท่านั้น
            aging.label = 'Accept'; // MARKER_VATWATCHLISTOPS_AGING_ACCEPT_LABEL_TEXT_V1 -- เดิม 'IV-Aging Uncount' เปลี่ยนข้อความให้แยกแยะได้ว่าเป็นเพราะ Accept with Condition (ยังนับ Uncount เหมือนเดิม)
          }
        }
        const computedGrt = computeVatWatchlistGrt(row, trueCategory); // ใช้ Category จริง ไม่สน Unpaid

        validRows.push({
          ...row, bu, book: company.BOOK, tax_class: cls, needs_recheck: needsRecheck, group_name: groupName, // MARKER_VATWATCHLISTOPS_BU_GROUP_RANGE_FALLBACK_V1
          bus_type: effectiveBusiness, sub_type: subType, payment_type: paymentType,
          related_persons: relatedPersons, period: effectivePeriodMonth,
          aging_months: aging.months, aging_label: aging.label,
          receive_doc_no: computedGrt,
        });
      }

      // MARKER_VATWATCHLISTOPS_NOTE_CROSSCHECK_UNMATCH_V1
      // ── Cross-Check Note เดิม (ของ BU ที่อยู่ในไฟล์นี้) กับ Transaction ในไฟล์ใหม่ ──
      // ── หาไม่เจอเลย (ทั้ง Pending และ Completed) -> Mark เป็น Unmatch ──────────────
      try {
        const allMatchedRowsThisUpload = [...validRows, ...completedRowsList];
        const matchedBusInThisUpload = new Set(allMatchedRowsThisUpload.map((r) => r.bu).filter(Boolean));
        const matchedKeysInThisUpload = new Set(
          allMatchedRowsThisUpload.map((r) => `${r.bu}|${r.invoice_ref || ''}|${r.supplier_code || ''}`)
        );
        const notesToUnmatch = (Array.isArray(existingNotes) ? existingNotes : []).filter((n) => {
          if (!matchedBusInThisUpload.has(n.bu)) return false; // ไม่แตะ Note ของ BU ที่ไม่ได้อยู่ในไฟล์นี้
          if (n.status === 'unmatch') return false; // Unmatch ไปแล้ว ไม่ยิงซ้ำ กัน Timestamp Reset
          const key = `${n.bu}|${n.invoice_ref || ''}|${n.supplier_code || ''}`;
          return !matchedKeysInThisUpload.has(key);
        });
        if (notesToUnmatch.length > 0) {
          await Promise.all(notesToUnmatch.map((n) =>
            apiFetch('/vat_watchlist_notes/upsert?onConflict=bu,invoice_ref,supplier_code', {
              method: 'POST',
              body: JSON.stringify({ ...n, status: 'unmatch' }),
            }).catch((err) => console.error('mark unmatch error:', n, err))
          ));
        }
      } catch (err) {
        console.error('note cross-check unmatch error:', err);
      }

      setCheckSkippedCount(skipped);
      setCheckZeroVatBus([...zeroVatBuSet]); // MARKER_VATWATCHLISTOPS_EMPTY_PREVIEW_DIAGNOSTIC_V1
      setPreviewRows(validRows);
      setCompletedRows(completedRowsList); // MARKER_VATWATCHLISTOPS_PENDING_COMPLETED_TABS_V1
    } catch (err) {
      console.error('handleCheckData error:', err);
      setPreviewRows(rawRows); // Fallback: Match ไม่ได้ก็โชว์ดิบไปก่อน ไม่ปิดกั้นผู้ใช้
    }
    setIsChecking(false);
  };

  const [isSaving, setIsSaving] = React.useState(false);
  const [saveProgress, setSaveProgress] = React.useState(0); // MARKER_VATWATCHLISTOPS_SAVE_PROGRESS_V1

  const handleConfirmSave = async () => {
    // MARKER_VATWATCHLISTOPS_SAVE_ZEROVATBU_V1 — ให้ผ่านได้ถ้ามี BU VAT%=0 แม้ previewRows ว่าง
    if ((!previewRows || previewRows.length === 0) && checkZeroVatBus.length === 0) return;
    setIsSaving(true);
    setSaveProgress(0);
    try {
      const buFromRows = [...new Set(previewRows.map((r) => r.bu).filter(Boolean))];
      // MARKER_VATWATCHLISTOPS_SAVE_ZEROVATBU_V1
      // ── รวม BU ที่ VAT%=0 เข้าด้วย แม้จะไม่มีแถวใน previewRows ก็ต้อง Update Timestamp ──
      const bus = [...new Set([...buFromRows, ...checkZeroVatBus])];

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

      // MARKER_VATWATCHLISTOPS_ROUND_BASED_STATUS_V1 -- เช็คว่าต้อง Reset รอบใหม่หรือไม่ ก่อนบันทึก
      const roundStateArrFP = await apiFetch('/vat_watchlist_round_state').catch(() => []);
      const roundStateFP = Array.isArray(roundStateArrFP) && roundStateArrFP.length > 0 ? roundStateArrFP[0] : null;
      const anyBuHadDataBeforeFP = bus.some((buCode) => {
        const cid = companyIdByBu[buCode];
        const companyFP = (Array.isArray(companiesForUpdate) ? companiesForUpdate : []).find((c) => c.id === cid);
        return !!(companyFP && companyFP.vat_watchlist_last_incomplete_update);
      });
      if (roundStateFP && roundStateFP.is_confirmed && anyBuHadDataBeforeFP) {
        const confirmedResetFP = await confirmDialog.confirm(
          'พบข้อมูลใหม่หลังจากปิดรอบล่าสุดไปแล้ว ระบบจะ Reset สถานะ "อัปเดตแล้ว" ของทุก Active BU กลับเป็น "ยังไม่ทำ" เพื่อเริ่มรอบใหม่ ต้องการดำเนินการต่อหรือไม่',
          { title: 'พบข้อมูลใหม่กว่ารอบก่อน', variant: 'warning' }
        );
        if (!confirmedResetFP) { setIsSaving(false); return; }
        await apiFetch(`/vat_watchlist_round_state/${roundStateFP.id}`, { method: 'PUT', body: JSON.stringify({ is_confirmed: false, round_started_at: nowIso }) });
        broadcastWs('vat_watchlist_round_state_updated', {});
      }

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
      <div style={{ background: 'white', borderRadius: '10px', padding: '28px', width: '97vw', maxWidth: 'none', height: '94vh', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', position: 'relative' }}>
        {checkReturnFile && ( // MARKER_VATWATCHLISTOPS_CHECKRETURN_INLINE_V1 -- คลุมทับพื้นที่ Modal เดิมทั้งกรอบ ใช้ Backdrop เดียวกัน ไม่ซ้อน 2 ชั้น
          <div style={{ position: 'absolute', inset: 0, background: 'white', borderRadius: '10px', padding: '28px', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', zIndex: 10 }}>
            <VatCheckReturnMatchContent file={checkReturnFile} onClose={() => setCheckReturnFile(null)} />
          </div>
        )}
        <div style={{ fontSize: '16px', fontWeight: '500', marginBottom: '16px' }}>Import Overall file</div>

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
              if (val) { setSelectedFiles([]); setFileCheckResults([]); } // MARKER_VATWATCHLISTOPS_MULTIFILE_CHECK_V1
              if (textareaRef.current) {
                textareaRef.current.scrollLeft = 0;
                textareaRef.current.scrollTop = 0;
                textareaRef.current.setSelectionRange(0, 0);
              }
            }}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); }}
            onPaste={(e) => { // MARKER_VATWATCHLISTOPS_PASTE_FILES_V1 -- Copy ไฟล์จาก File Explorer แล้ว Ctrl+V ได้เลย ไม่ต้องลาก
              if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
                e.preventDefault();
                handleFiles(e.clipboardData.files);
              }
            }}
            onDoubleClick={() => fileInputRef.current && fileInputRef.current.click()}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={selectedFiles.length > 0 ? `เลือกไฟล์แล้ว ${selectedFiles.length} ไฟล์` : 'วางข้อมูล (Ctrl+V) หรือลากไฟล์ (เลือกได้หลายไฟล์) มาวางที่นี่'}
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
        ) : null}
        {/* MARKER_VATWATCHLISTOPS_MULTIFILE_CHECK_V1 -- ตารางสรุปผลเช็คไฟล์ */}
        {!previewRows && (isCheckingFiles || fileCheckResults.length > 0) && (
          <div style={{ border: '0.5px solid #e8e8e8', borderRadius: '10px', marginBottom: '16px', maxHeight: '260px', overflow: 'auto' }}>
            {isCheckingFiles ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#999', fontSize: '13px' }}>กำลังเช็คไฟล์...</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ position: 'sticky', top: 0 }}>
                    <th style={{ padding: '8px 10px', background: '#1a3a5c', color: 'white', fontWeight: '500', textAlign: 'left' }}>Filename</th>
                    <th style={{ padding: '8px 10px', background: '#1a3a5c', color: 'white', fontWeight: '500', textAlign: 'left' }}>ข้อมูล ณ วันที่</th>
                    <th style={{ padding: '8px 10px', background: '#1a3a5c', color: 'white', fontWeight: '500', textAlign: 'left' }}>BU</th>
                    <th style={{ padding: '8px 10px', background: '#1a3a5c', color: 'white', fontWeight: '500', textAlign: 'left' }}>Tax type</th>
                    <th style={{ padding: '8px 10px', background: '#1a3a5c', color: 'white', fontWeight: '500', textAlign: 'left' }}>Pending</th> {/* MARKER_VATWATCHLISTOPS_FILECHECK_PENDING_COMPLETED_COLS_V1 */}
                    <th style={{ padding: '8px 10px', background: '#1a3a5c', color: 'white', fontWeight: '500', textAlign: 'left' }}>Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {fileCheckResults.map((r, ri) => (
                    r.hasData ? (
                      r.buRows.map((br, bi) => ( // MARKER_VATWATCHLISTOPS_MULTIFILE_TAXTYPE_MATCH_V1
                        <tr key={`${ri}-${bi}`} style={{ borderTop: '0.5px solid #e8e8e8', background: br.noData ? '#E4E4E4' : 'transparent' }}>
                          {bi === 0 && <td rowSpan={r.buRows.length} style={{ padding: '7px 10px', verticalAlign: 'top' }}>{r.fileName}</td>}
                          {bi === 0 && <td rowSpan={r.buRows.length} style={{ padding: '7px 10px', verticalAlign: 'top' }}>{r.dateStr}</td>}
                          <td style={{ padding: '7px 10px' }}>{br.bu}</td>
                          <td style={{ padding: '7px 10px' }}>{br.taxTypes}</td>
                          {br.noData ? ( // MARKER_VATWATCHLISTOPS_FILECHECK_PENDING_COMPLETED_COLS_V1
                            <td colSpan={2} style={{ padding: '7px 10px' }}>
                              <span style={{ background: '#FCEBEB', color: '#791F1F', fontSize: '11px', padding: '2px 8px', borderRadius: '8px' }}>No data</span>
                            </td>
                          ) : (
                            <>
                              <td style={{ padding: '7px 10px' }}>
                                <span style={{ background: '#EAF3DE', color: '#27500A', fontSize: '11px', padding: '2px 8px', borderRadius: '8px' }}>{br.pending.toLocaleString()} แถว</span>
                              </td>
                              <td style={{ padding: '7px 10px' }}>
                                <span style={{ background: '#EEF2F7', color: '#4B5A6B', fontSize: '11px', padding: '2px 8px', borderRadius: '8px' }}>{br.complete.toLocaleString()} แถว</span>
                              </td>
                            </>
                          )}
                        </tr>
                      ))
                    ) : (
                      <tr key={ri} style={{ borderTop: '0.5px solid #e8e8e8' }}>
                        <td style={{ padding: '7px 10px' }}>{r.fileName}</td>
                        <td style={{ padding: '7px 10px' }}>—</td>
                        <td style={{ padding: '7px 10px' }}>—</td>
                        <td style={{ padding: '7px 10px' }}>—</td>
                        <td colSpan={2} style={{ padding: '7px 10px' }}> {/* MARKER_VATWATCHLISTOPS_FILECHECK_PENDING_COMPLETED_COLS_V1 */}
                          <span style={{ background: '#FCEBEB', color: '#791F1F', fontSize: '11px', padding: '2px 8px', borderRadius: '8px' }}>No data</span>
                        </td>
                      </tr>
                    )
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        {previewRows && (
          <div style={{ flex: 1, border: '0.5px solid #e8e8e8', borderRadius: '10px', marginBottom: '16px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ fontSize: '12px', color: '#888', padding: '10px 12px', borderBottom: '0.5px solid #e8e8e8', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span>Preview ข้อมูลที่ตรวจพบ ({displayRows.length.toLocaleString()} รายการ{buFilter ? ` จากทั้งหมด ${previewRows.length.toLocaleString()}` : ''})</span>
              {/* MARKER_VATWATCHLISTOPS_EMPTY_PREVIEW_DIAGNOSTIC_V1 — โชว่เหตุผลเมื่อ 0 รายการ */}
              {previewRows.length === 0 && (checkSkippedCount > 0 || checkZeroVatBus.length > 0) && (
                <span style={{ color: '#b45309', background: '#fef3c7', padding: '3px 10px', borderRadius: '10px', fontSize: '11.5px' }}>
                  {checkSkippedCount > 0 && `มี ${checkSkippedCount.toLocaleString()} แถวถูกกรองออก เพราะ Tax Type ไม่ตรงกับ Config ของ BU`}
                  {checkSkippedCount > 0 && checkZeroVatBus.length > 0 && ' • '}
                  {checkZeroVatBus.length > 0 && `BU ที่ VAT %=0: ${checkZeroVatBus.join(', ')} (ไม่ควรมีรายการ VAT Incomplete อยู่แล้ว)`}
                </span>
              )}
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

            <div style={{ display: 'flex', gap: '6px', padding: '8px 12px', borderBottom: '0.5px solid #e8e8e8', flexShrink: 0 }}> {/* MARKER_VATWATCHLISTOPS_PENDING_COMPLETED_TABS_V1 */}
              <button
                onClick={() => setPreviewTab('pending')}
                style={{ padding: '5px 14px', fontSize: '12px', borderRadius: '14px', border: '0.5px solid #ccc', background: previewTab === 'pending' ? '#1a3a5c' : 'white', color: previewTab === 'pending' ? 'white' : '#555', cursor: 'pointer' }}
              >Pending ({previewRows.length.toLocaleString()})</button>
              <button
                onClick={() => setPreviewTab('completed')}
                style={{ padding: '5px 14px', fontSize: '12px', borderRadius: '14px', border: '0.5px solid #ccc', background: previewTab === 'completed' ? '#1a3a5c' : 'white', color: previewTab === 'completed' ? 'white' : '#555', cursor: 'pointer' }}
              >Completed ({(completedRows || []).length.toLocaleString()})</button>
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
                <div style={{ flex: 1, overflow: 'auto', display: previewTab === 'pending' ? 'block' : 'none' }}> {/* MARKER_VATWATCHLISTOPS_PENDING_COMPLETED_TABS_V1 */}
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
                    {/* MARKER_VATWATCHLISTOPS_PREVIEW_DOCNO_HOVER_V1 */}
                    <style>{`.vat-docno-row:hover { background: #dbeafe !important; }`}</style>
                    <tbody>
                      {pagedDisplayRows.map((row, i) => (
                        <tr key={i}
                          className={row.doc_no && String(row.doc_no).trim() !== '' ? 'vat-docno-row' : undefined}
                          style={{ background: i % 2 === 0 ? 'white' : '#f7f9fb', borderTop: '0.5px solid #e8e8e8' }}>
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

            {previewTab === 'completed' && (() => { // MARKER_VATWATCHLISTOPS_PENDING_COMPLETED_TABS_V1
              const VAT_COMPLETED_COLS = [ // MARKER_VATWATCHLISTOPS_COMPLETED_STANDARD_COLUMNS_V1 -- เหมือน Pending Table ทุก Column ยกเว้นโซนคำนวณ (isMatch)
                { key: 'doc_date',        label: 'ว.ด.ป.',        width: 90  },
                { key: 'doc_no',          label: 'เลขที่',         width: 130 },
                { key: 'site',            label: 'Site',           width: 100 },
                { key: 'pay_group',       label: 'Pay Group',      width: 100 },
                { key: 'branch',          label: 'Branch',         width: 90  },
                { key: 'tax_type',        label: 'ประเภทภาษี',     width: 130 },
                { key: 'tax_class',       label: 'Tax Class',      width: 100 },
                { key: 'invoice_ref',     label: 'ใบแจ้งหนี้',      width: 240 },
                { key: 'supplier_code',   label: 'Supplier Code',  width: 140 },
                { key: 'vendor_name',     label: 'ชื่อผู้ค้า',       width: 260 },
                { key: 'phone',           label: 'เบอร์โทรศัพท์',   width: 150 },
                { key: 'payment_date',    label: 'ชำระเงิน',       width: 100 },
                { key: 'check_date',      label: 'เช็ค',            width: 100 },
                { key: 'check_no',        label: 'เลขที่เช็ค',      width: 150 },
                { key: 'receive_doc_date',label: 'Receive Doc.',   width: 130 },
                { key: 'receive_doc_no',  label: 'เลขที่ GRT',      width: 200 },
                { key: 'exp_amount',      label: 'มูลค่าสินค้า',    width: 130, align: 'right' },
                { key: 'exp_vat',         label: 'เงินภาษี',        width: 100, align: 'right' },
                { key: 'avg_amount',      label: 'มูลค่าสินค้า',    width: 130, align: 'right' },
                { key: 'avg_vat',         label: 'เงินภาษี',        width: 100, align: 'right' },
                { key: 'ap_source',       label: 'AP Source',      width: 130 },
                { key: 'ap_batch_name',   label: 'AP Batch Name',  width: 200 },
              ];
              const completedTotalWidth = VAT_COMPLETED_COLS.reduce((sum, c) => sum + c.width, 0);
              const completedDisplayRows = (completedRows || []).filter((r) => !buFilter || r.bu === buFilter);
              return (
                <div style={{ flex: 1, overflow: 'auto' }}>
                  <table style={{ width: completedTotalWidth, borderCollapse: 'collapse', fontSize: '12px', whiteSpace: 'nowrap', tableLayout: 'fixed' }}>
                    <thead>
                      <tr>
                        {VAT_COMPLETED_COLS.map((col) => (
                          <th key={col.key} style={{ position: 'sticky', top: 0, zIndex: 1, width: col.width, minWidth: col.width, padding: '8px 10px', background: col.isMatch ? '#0F6E56' : '#1a3a5c', color: 'white', fontWeight: '500', textAlign: col.align || 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}> {/* MARKER_VATWATCHLISTOPS_COMPLETED_STANDARD_COLUMNS_V1 */}
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {completedDisplayRows.length === 0 ? (
                        <tr><td colSpan={VAT_COMPLETED_COLS.length} style={{ padding: '24px', textAlign: 'center', color: '#999' }}>ไม่มีรายการ</td></tr>
                      ) : (
                        completedDisplayRows.map((row, i) => (
                          <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#f7f9fb', borderTop: '0.5px solid #e8e8e8' }}>
                            {VAT_COMPLETED_COLS.map((col) => (
                              <td key={col.key} style={{ width: col.width, minWidth: col.width, padding: '6px 10px', textAlign: col.align || 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}> {/* MARKER_VATWATCHLISTOPS_COMPLETED_STANDARD_COLUMNS_V1 */}
                                {row[col.key]}
                              </td>
                            ))}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              );
            })()}

            {/* MARKER_VATWATCHLISTOPS_PREVIEW_PAGINATION_BAR_V1 */}
            <div style={{ display: previewTab === 'pending' ? 'flex' : 'none', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderTop: '0.5px solid #e8e8e8', flexShrink: 0, fontSize: '12px', color: '#666' }}> {/* MARKER_VATWATCHLISTOPS_PENDING_COMPLETED_TABS_V1 */}
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

        <input ref={fileInputRef} type="file" multiple onChange={(e) => handleFiles(e.target.files)} style={{ display: 'none' }} /> {/* MARKER_VATWATCHLISTOPS_MULTIFILE_CHECK_V1 */}

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
function VatWatchlistAllActiveModal({ onClose }) { // MARKER_VATWATCHLISTOPS_ROUND_BASED_STATUS_V1 -- ย้าย Donut + Confirm Round มาไว้ในนี้ (ตาม Mockup) แทนที่ Placeholder 65% ในหน้า Lobby
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const { userName, currentUser } = useAuth(); // MARKER_VATWATCHLISTOPS_ROUND_BASED_STATUS_V1
  const { isOwner, isAdmin } = useUserRole(); // MARKER_VATWATCHLISTOPS_ROUND_BASED_STATUS_V1
  const [roundState, setRoundState] = React.useState(null); // MARKER_VATWATCHLISTOPS_ROUND_BASED_STATUS_V1
  const fetchRoundState = React.useCallback(() => {
    apiFetch('/vat_watchlist_round_state').then((res) => {
      setRoundState(Array.isArray(res) && res.length > 0 ? res[0] : null);
    }).catch(() => setRoundState(null));
  }, []);
  React.useEffect(() => { fetchRoundState(); }, [fetchRoundState]);
  React.useEffect(() => {
    const unsubscribe = subscribeWs(['vat_watchlist_round_state_updated'], () => { fetchRoundState(); });
    return unsubscribe;
  }, [fetchRoundState]);
  const updatedCountForDonut = React.useMemo(() => rows.filter((c) => isVatWatchlistUpdatedThisRound(c, roundState)).length, [rows, roundState]); // MARKER_VATWATCHLISTOPS_ROUND_BASED_STATUS_V1
  const totalActiveForDonut = rows.length;
  const donutPct = totalActiveForDonut > 0 ? Math.round((updatedCountForDonut / totalActiveForDonut) * 100) : 0;
  const handleConfirmRoundComplete = async () => { // MARKER_VATWATCHLISTOPS_ROUND_BASED_STATUS_V1
    if (!roundState) return;
    const confirmed = await confirmDialog.confirm(
      `ยืนยันว่าข้อมูล Active BU ครบทุกรายการสำหรับรอบนี้แล้ว (${updatedCountForDonut}/${totalActiveForDonut} BU)?`,
      { title: 'Confirm รอบนี้', variant: 'success' }
    );
    if (!confirmed) return;
    await apiFetch(`/vat_watchlist_round_state/${roundState.id}`, { method: 'PUT', body: JSON.stringify({
      is_confirmed: true, confirmed_by: userName || currentUser?.email || '', confirmed_at: new Date().toISOString(),
    }) });
    broadcastWs('vat_watchlist_round_state_updated', {});
  };
  const [search, setSearch] = React.useState(''); // MARKER_VATWATCHLISTOPS_VIEWALL_SEARCH_FILTER_V1
  const [baseFilter, setBaseFilter] = React.useState('');
  // MARKER_VATWATCHLISTOPS_AGING_SUMMARY_V1
  const [agingSummary, setAgingSummary] = React.useState([]); // [{bu, aging_label, count}] จาก Backend Aggregation
  const [agingFilter, setAgingFilter] = React.useState(() => new Set()); // MARKER_VATWATCHLISTOPS_AGING_MULTISELECT_V1 -- เปลี่ยนจาก String เดี่ยว เป็น Set (เลือกได้หลาย Aging)
  const [agingDropdownOpen, setAgingDropdownOpen] = React.useState(false); // MARKER_VATWATCHLISTOPS_AGING_MULTISELECT_V1
  const agingDropdownRef = React.useRef(null); // MARKER_VATWATCHLISTOPS_AGING_MULTISELECT_V1
  React.useEffect(() => { // MARKER_VATWATCHLISTOPS_AGING_MULTISELECT_V1 -- ปิด Dropdown เมื่อคลิกนอกกล่อง
    if (!agingDropdownOpen) return;
    const handleClickOutside = (e) => {
      if (agingDropdownRef.current && !agingDropdownRef.current.contains(e.target)) setAgingDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [agingDropdownOpen]);

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
      // MARKER_VATWATCHLISTOPS_AGING_FILTER_V1 — เหลือเฉพาะ BU ที่มี Invoice ติด Aging ที่เลือกอยู่จริง (อย่างน้อย 1 ตัวจากที่เลือกไว้)
      if (agingFilter.size > 0 && !(countsByBuAging[c.bu] && Array.from(agingFilter).some((a) => countsByBuAging[c.bu][a] > 0))) return false;
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', padding: '14px 20px', borderBottom: '0.5px solid #e8e8e8', background: '#f7f9fb' }}> {/* MARKER_VATWATCHLISTOPS_ROUND_BASED_STATUS_V1 -- Donut + Confirm Round ตาม Mockup */}
          <div style={{ position: 'relative', width: '64px', height: '64px', flexShrink: 0 }}>
            <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: `conic-gradient(#27500A 0% ${donutPct}%, #e8e8e8 ${donutPct}% 100%)` }} />
            <div style={{ position: 'absolute', inset: '8px', borderRadius: '50%', background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#1a3a5c' }}>{donutPct}%</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '24px' }}>
            <div>
              <div style={{ fontSize: '12px', color: '#555', display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#27500A' }} />Uploaded แล้ว</div>
              <div style={{ fontSize: '18px', fontWeight: '500', marginTop: '2px' }}>{updatedCountForDonut} BU</div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#555', display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#e8e8e8' }} />ยังไม่ Upload</div>
              <div style={{ fontSize: '18px', fontWeight: '500', marginTop: '2px' }}>{totalActiveForDonut - updatedCountForDonut} BU</div>
            </div>
          </div>
          {(isOwner || isAdmin) && (
            <button type="button" onClick={handleConfirmRoundComplete} style={{ marginLeft: 'auto', padding: '9px 16px', fontSize: '12px', border: 'none', borderRadius: '8px', background: '#1a3a5c', color: 'white', cursor: 'pointer', whiteSpace: 'nowrap' }}>Confirm ว่า Data ครบแล้ว</button>
          )}
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
          <div style={{ position: 'relative' }} ref={agingDropdownRef}>
            <button
              type="button"
              onClick={() => setAgingDropdownOpen((v) => !v)}
              style={{ padding: '7px 10px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '8px', minWidth: '140px', background: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}
            >
              <span>{agingFilter.size === 0 ? 'Aging: ทั้งหมด' : `Aging (${agingFilter.size})`}</span>
              <span style={{ fontSize: '10px', color: '#999' }}>▾</span>
            </button>
            {agingDropdownOpen && (
              <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '4px', background: 'white', border: '0.5px solid #ccc', borderRadius: '8px', minWidth: '170px', maxHeight: '240px', overflowY: 'auto', zIndex: 20, boxShadow: '0 6px 16px rgba(0,0,0,0.18)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', borderBottom: '0.5px solid #eee' }}>
                  <button type="button" onClick={() => setAgingFilter(new Set())} style={{ fontSize: '11px', border: 'none', background: 'transparent', color: '#1a3a5c', cursor: 'pointer' }}>ล้างทั้งหมด</button>
                  <button type="button" onClick={() => setAgingDropdownOpen(false)} style={{ fontSize: '11px', border: 'none', background: 'transparent', color: '#999', cursor: 'pointer' }}>ปิด</button>
                </div>
                {agingOptionsAll.map((a) => (
                  <label key={a} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', fontSize: '12px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={agingFilter.has(a)}
                      onChange={() => setAgingFilter((prev) => {
                        const next = new Set(prev);
                        if (next.has(a)) next.delete(a); else next.add(a);
                        return next;
                      })}
                    />
                    <span>{a}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
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
                      {(agingFilter.size > 0
                        ? Array.from(agingFilter).reduce((sum, a) => sum + ((countsByBuAging[c.bu] && countsByBuAging[c.bu][a]) || 0), 0)
                        : (countsByBu[c.bu] || 0)).toLocaleString()}
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
        ⬆️ Import Overall file
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
  const vatPct = parseFloat(c['VAT %']);
  if (!isNaN(vatPct) && vatPct === 0) return 'unclaim';
  // MARKER_VATWATCHLISTOPS_BU_AUTO_INACTIVE_2MONTHS_V1 -- ไม่มี Update Incomplete เกิน 2 เดือน (หรือไม่เคยมีเลย) -> Inactive อัตโนมัติ (คำนวณสด ไม่เขียน DB)
  // MARKER_VATWATCHLIST_ACTIVE_TOUCH_SEPARATE_FIELD_V1 -- เช็ค Auto-Inactive จากค่า "ล่าสุด" ระหว่าง Incomplete จริง กับ Active Touch เอง
  const lastIncompleteVal = c.vat_watchlist_last_incomplete_update ? new Date(c.vat_watchlist_last_incomplete_update) : null;
  const lastActiveTouchVal = c.vat_watchlist_active_touched_at ? new Date(c.vat_watchlist_active_touched_at) : null;
  const lastUpdateVal = (lastIncompleteVal && lastActiveTouchVal)
    ? (lastIncompleteVal.getTime() >= lastActiveTouchVal.getTime() ? lastIncompleteVal : lastActiveTouchVal)
    : (lastIncompleteVal || lastActiveTouchVal);
  const twoMonthsAgoVal = new Date();
  twoMonthsAgoVal.setMonth(twoMonthsAgoVal.getMonth() - 2);
  if (!lastUpdateVal || isNaN(lastUpdateVal.getTime()) || lastUpdateVal < twoMonthsAgoVal) return 'inactive';
  return 'active';
}

function isVatWatchlistUpdatedThisRound(company, roundState) { // MARKER_VATWATCHLISTOPS_ROUND_BASED_STATUS_V1 -- เทียบ vat_watchlist_last_incomplete_update กับ round_started_at แทนการเทียบ Period เดิม
  return !!(roundState && roundState.round_started_at && company.vat_watchlist_last_incomplete_update &&
    new Date(company.vat_watchlist_last_incomplete_update).getTime() >= new Date(roundState.round_started_at).getTime());
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
  { key: 'lastUpdate', label: 'สถานะรอบนี้', width: 150, sortable: true }, // MARKER_VATWATCHLISTOPS_MONITOR_STATUS_BADGE_V1 -- เดิม 'Last update at'
  { key: 'action', label: 'Action', width: 80, align: 'center' }, // MARKER_VATWATCHLISTOPS_ACTION_COL_V1
];

// MARKER_VATWATCHLISTOPS_CONFIG_MODAL_V1
// MARKER_VATWATCHLISTOPS_CONFIG_MODAL_EXPAND_V1
// ── Config Modal ขยาย — ดึง Company Info + VAT Setting เต็มๆ จากหน้า Business Unit ──
// MARKER_VATWATCHLISTOPS_CONFIG_MODAL_RESTYLE_V1
// ── Config Modal — Style ตาม Mockup (Segmented Control, Section คั่นเส้น) ──
// MARKER_VATWATCHLISTOPS_CONFIG_MODAL_BOXSTYLE_V1
// ── Config Modal — Box Grid Style ตรงจากหน้า Business Unit เป๊ะ ────────────
// MARKER_VATWATCHLISTOPS_EMBED_BU_GROUP_RANGE_V1 -- Copy จาก BusinessUnit.js มาฝังในหน้า VAT ตรงๆ (db.from() -> apiFetch())
function VatWatchlistBuGroupRangeSection({ currentBu }) {
  const [ranges, setRanges] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [editingId, setEditingId] = React.useState(null);
  const [formRangeInput, setFormRangeInput] = React.useState('');
  const [formPrefixLength, setFormPrefixLength] = React.useState('4');
  const [saving, setSaving] = React.useState(false);

  const loadRanges = React.useCallback(async () => {
    try {
      const data = await apiFetch('/vat_watchlist_bu_group_range');
      setRanges(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('VatWatchlistBuGroupRangeSection load error:', err);
      setRanges([]);
    }
    setLoading(false);
  }, []);

  React.useEffect(() => { loadRanges(); }, [loadRanges]);

  const buRanges = React.useMemo(
    () => ranges.filter((r) => r.group_name === currentBu),
    [ranges, currentBu]
  );

  const resetForm = () => {
    setEditingId(null);
    setFormRangeInput('');
    setFormPrefixLength('4');
  };

  const startEdit = (r) => {
    setEditingId(r.id);
    setFormRangeInput(`${r.range_start || ''}-${r.range_end || ''}`);
    setFormPrefixLength(r.prefix_length == null ? 'full' : String(r.prefix_length));
  };

  const handleDelete = async (id) => { // MARKER_VATWATCHLISTOPS_GROUPRANGE_CONFIRMDIALOG_V1 -- confirmDialog แทน window.confirm/alert
    const confirmed = await confirmDialog.confirm('ลบ Range นี้?', { title: 'ลบ BU Group Range', variant: 'danger' });
    if (!confirmed) return;
    try {
      await apiFetch(`/vat_watchlist_bu_group_range/${id}`, { method: 'DELETE' });
      await loadRanges();
    } catch (err) {
      confirmDialog.alert('ลบไม่สำเร็จ: ' + err.message, { variant: 'danger' });
    }
  };

  const handleSave = async () => {
    const groupName = (currentBu || '').trim(); // MARKER_VATWATCHLISTOPS_GROUPRANGE_CONFIRMDIALOG_V1
    if (!groupName) { confirmDialog.alert('ต้องกรอก BU Code ก่อนถึงจะกำหนด Range ได้', { variant: 'danger', title: 'กรอกข้อมูลไม่ครบ' }); return; }
    if (!formRangeInput.trim()) { confirmDialog.alert('กรุณากรอก Range', { variant: 'danger', title: 'กรอกข้อมูลไม่ครบ' }); return; }
    const prefixLength = formPrefixLength === 'full' ? null : Number(formPrefixLength);

    setSaving(true);
    try {
      if (editingId) {
        const [rangeStart, rangeEnd] = formRangeInput.split('-').map((s) => s.trim());
        await apiFetch(`/vat_watchlist_bu_group_range/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify({ group_name: groupName, range_start: rangeStart, range_end: rangeEnd || rangeStart, prefix_length: prefixLength }),
        });
      } else {
        const pairs = formRangeInput.split(',').map((s) => s.trim()).filter(Boolean);
        const rowsToInsert = pairs.map((pair) => {
          const [rangeStart, rangeEnd] = pair.split('-').map((s) => s.trim());
          return { group_name: groupName, range_start: rangeStart, range_end: rangeEnd || rangeStart, prefix_length: prefixLength };
        });
        for (const rowToInsert of rowsToInsert) {
          await apiFetch('/vat_watchlist_bu_group_range', { method: 'POST', body: JSON.stringify(rowToInsert) });
        }
      }
      resetForm();
      await loadRanges();
    } catch (err) { // MARKER_VATWATCHLISTOPS_GROUPRANGE_CONFIRMDIALOG_V1
      confirmDialog.alert('บันทึกไม่สำเร็จ: ' + err.message, { variant: 'danger' });
    }
    setSaving(false);
  };

  const cellStyle = { padding: '8px 10px', fontSize: '12px', borderRight: '0.5px solid #e8e8e8' };
  const headStyle = { ...cellStyle, fontWeight: '600', color: '#666', background: '#f5f5f3', fontSize: '11px' };
  const inputStyle = { width: '100%', padding: '7px 8px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '6px', boxSizing: 'border-box' };

  return (
    <div style={{ marginTop: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '10px' }}>
        <div style={{ fontSize: '12px', fontWeight: '600', color: '#666' }}>BU GROUP RANGE</div>
        <div style={{ fontSize: '10px', color: '#999' }}>— Config ระดับระบบ ไม่บังคับกำหนดทุก BU (ถ้าไม่มี Range = ทำงานตามปกติ)</div>
      </div>

      {!loading && buRanges.length > 0 && (
        <div style={{ border: '0.5px solid #e8e8e8', borderRadius: '8px', overflow: 'hidden', marginBottom: '10px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 100px' }}>
            <div style={{ ...headStyle, borderBottom: '0.5px solid #e8e8e8' }}>Group Name</div>
            <div style={{ ...headStyle, borderBottom: '0.5px solid #e8e8e8' }}>Range</div>
            <div style={{ ...headStyle, borderBottom: '0.5px solid #e8e8e8' }}>อ่านกี่ตำแหน่ง</div>
            <div style={{ ...headStyle, borderBottom: '0.5px solid #e8e8e8', borderRight: 'none', textAlign: 'center' }}>จัดการ</div>
          </div>
          {buRanges.map((r) => (
            <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 100px', borderTop: '0.5px solid #f0f0f0' }}>
              <div style={{ ...cellStyle, fontWeight: '500' }}>{r.group_name}</div>
              <div style={{ ...cellStyle, color: '#555' }}>{r.range_start}-{r.range_end}</div>
              <div style={{ ...cellStyle, color: '#555' }}>{r.prefix_length == null ? 'Full' : `${r.prefix_length} ตำแหน่ง`}</div>
              <div style={{ padding: '6px 10px', display: 'flex', gap: '6px', justifyContent: 'center' }}>
                <button type="button" onClick={() => startEdit(r)} style={{ padding: '3px 8px', fontSize: '11px', border: '0.5px solid #ccc', background: 'white', borderRadius: '5px', cursor: 'pointer' }}>แก้ไข</button>
                <button type="button" onClick={() => handleDelete(r.id)} style={{ padding: '3px 8px', fontSize: '11px', border: '0.5px solid #c0392b', color: '#c0392b', background: 'white', borderRadius: '5px', cursor: 'pointer' }}>ลบ</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ border: '1px dashed #ccc', borderRadius: '8px', padding: '12px', display: 'grid', gridTemplateColumns: '2fr 1fr 100px', gap: '8px', alignItems: 'end' }}>
        <div>
          <label style={{ display: 'block', fontSize: '10px', color: '#999', marginBottom: '4px' }}>Range {!editingId && '(คั่นด้วย , ได้หลายช่วง)'}</label>
          <input style={inputStyle} placeholder="เช่น 0401-0401,4360-4363" value={formRangeInput} onChange={(e) => setFormRangeInput(e.target.value)} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '10px', color: '#999', marginBottom: '4px' }}>อ่านกี่ตำแหน่ง</label>
          <select style={inputStyle} value={formPrefixLength} onChange={(e) => setFormPrefixLength(e.target.value)}>
            <option value="3">3 ตำแหน่ง</option>
            <option value="4">4 ตำแหน่ง</option>
            <option value="full">Full (เทียบเต็ม)</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button type="button" onClick={handleSave} disabled={saving} style={{ flex: 1, padding: '8px 0', fontSize: '12px', fontWeight: '500', background: saving ? '#ccc' : '#1a3a5c', color: 'white', border: 'none', borderRadius: '6px', cursor: saving ? 'not-allowed' : 'pointer' }}>
            {editingId ? 'บันทึก' : '+ เพิ่ม'}
          </button>
          {editingId && (
            <button type="button" onClick={resetForm} style={{ padding: '8px 10px', fontSize: '12px', border: '0.5px solid #ccc', background: 'white', borderRadius: '6px', cursor: 'pointer' }}>ยกเลิก</button>
          )}
        </div>
      </div>
    </div>
  );
}

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
  const [modalTabFP, setModalTabFP] = React.useState('info'); // MARKER_VATWATCHLISTOPS_CONFIG_MODAL_TABS_V1
  const [prepareByOpen, setPrepareByOpen] = React.useState(false); // MARKER_VATWATCHLISTOPS_PREPAREBY_COMBO_V1
  const [taxTypeOpen, setTaxTypeOpen] = React.useState(false); // MARKER_VATWATCHLISTOPS_TAXTYPE_COMBO_V1
  // MARKER_VATWATCHLISTOPS_DROPDOWN_PORTAL_FIX_V1 -- Position + Ref สำหรับ Portal (กัน Scroll Container ตัดขอบ)
  const [prepareByPos, setPrepareByPos] = React.useState({ top: 0, left: 0, width: 0 });
  const [taxTypePos, setTaxTypePos] = React.useState({ top: 0, left: 0, width: 0 });
  const prepareByRef = React.useRef(null);
  const taxTypeRef = React.useRef(null);
  const openPrepareBy = () => {
    if (prepareByRef.current) {
      const rect = prepareByRef.current.getBoundingClientRect();
      setPrepareByPos({ top: rect.bottom + 2, left: rect.left, width: rect.width });
    }
    setPrepareByOpen(true);
  };
  const openTaxType = () => {
    if (taxTypeRef.current) {
      const rect = taxTypeRef.current.getBoundingClientRect();
      setTaxTypePos({ top: rect.bottom + 2, left: rect.left, width: rect.width });
    }
    setTaxTypeOpen(true);
  };

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const bodyToSaveFP = { ...form };
      // MARKER_VATWATCHLIST_ACTIVE_TOUCH_SEPARATE_FIELD_V1 -- ตั้ง Active เอง -> Touch Column แยกต่างหาก
      if ((form.vat_watchlist_status || '').trim().toLowerCase() === 'active') {
        bodyToSaveFP.vat_watchlist_active_touched_at = new Date().toISOString();
      }
      await apiFetch(`/company_list/${company.id}`, {
        method: 'PUT',
        body: JSON.stringify(bodyToSaveFP),
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

        <div style={{ display: 'flex', gap: '4px', padding: '10px 20px 0', borderBottom: '0.5px solid #e8e8e8' }}> {/* MARKER_VATWATCHLISTOPS_CONFIG_MODAL_TABS_V1 -- Tab Bar: Info / Group Range */}
          {[['info', 'Info'], ['group_range', 'Group Range']].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setModalTabFP(key)}
              style={{ padding: '8px 16px', fontSize: '13px', border: 'none', borderRadius: '8px 8px 0 0', borderBottom: modalTabFP === key ? '2px solid #1a3a5c' : '2px solid transparent', background: 'transparent', cursor: 'pointer', color: modalTabFP === key ? '#1a3a5c' : '#888', fontWeight: modalTabFP === key ? '600' : '400' }}
            >{label}</button>
          ))}
        </div>

        <div style={{ padding: '14px 20px', maxHeight: '78vh', overflowY: 'auto' }}>

        {modalTabFP === 'info' && (<>
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
            <div ref={prepareByRef} style={{ ...inputCell(false), position: 'relative' }}> {/* MARKER_VATWATCHLISTOPS_DROPDOWN_PORTAL_FIX_V1 */}
              <input
                style={cellInputStyle}
                value={form['PREPARE BY']}
                onChange={(e) => setField('PREPARE BY', e.target.value)}
                onFocus={openPrepareBy}
                onBlur={() => setTimeout(() => setPrepareByOpen(false), 150)}
                placeholder="พิมพ์หรือเลือกชื่อ"
              />
              {prepareByOpen && prepareByOptions && prepareByOptions.length > 0 && ReactDOM.createPortal(
                <div style={{ position: 'fixed', top: prepareByPos.top, left: prepareByPos.left, width: prepareByPos.width, background: 'white', border: '0.5px solid #ccc', borderRadius: '8px', maxHeight: '160px', overflowY: 'auto', zIndex: 99999, boxShadow: '0 4px 12px rgba(0,0,0,0.12)' }}>
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
                </div>,
                document.body
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
            <div ref={taxTypeRef} style={{ ...inputCell(false), position: 'relative' }}> {/* MARKER_VATWATCHLISTOPS_DROPDOWN_PORTAL_FIX_V1 */}
              <input
                style={cellInputStyle}
                value={form.allowed_tax_type}
                onChange={(e) => setField('allowed_tax_type', e.target.value)}
                onFocus={openTaxType}
                onBlur={() => setTimeout(() => setTaxTypeOpen(false), 150)}
                placeholder="N,T"
              />
              {taxTypeOpen && taxTypeOptions && taxTypeOptions.length > 0 && ReactDOM.createPortal(
                <div style={{ position: 'fixed', top: taxTypePos.top, left: taxTypePos.left, width: taxTypePos.width, background: 'white', border: '0.5px solid #ccc', borderRadius: '8px', maxHeight: '160px', overflowY: 'auto', zIndex: 99999, boxShadow: '0 4px 12px rgba(0,0,0,0.12)' }}>
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
                </div>,
                document.body
              )}
            </div>
            <div style={inputCell(false)}><input style={cellInputStyle} value={form.vat_grn_pattern} onChange={(e) => setField('vat_grn_pattern', e.target.value)} /></div>
            <div style={inputCell(false)}><input style={cellInputStyle} value={form.vat_grn} onChange={(e) => setField('vat_grn', e.target.value)} /></div>
            <div style={inputCell(true)}><input style={cellInputStyle} value={form.vat_digit} onChange={(e) => setField('vat_digit', e.target.value)} /></div>
          </div>
        </>)}

        {modalTabFP === 'group_range' && (
          <VatWatchlistBuGroupRangeSection currentBu={company.bu} /> // MARKER_VATWATCHLISTOPS_CONFIG_MODAL_TABS_V1 -- ย้ายมา Tab แยก
        )}

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
  const [currentPeriodMonth, setCurrentPeriodMonth] = React.useState(null); // MARKER_VATWATCHLISTOPS_MONITOR_STATUS_BADGE_V1
  React.useEffect(() => {
    let cancelled = false;
    apiFetch('/vat/period/status').then((res) => {
      if (!cancelled && res) setCurrentPeriodMonth(res.vat_period_current_month || null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []); // MARKER_VATWATCHLISTOPS_MONITOR_STATUS_BADGE_V1
  const [roundState, setRoundState] = React.useState(null); // MARKER_VATWATCHLISTOPS_ROUND_BASED_STATUS_V1
  const fetchRoundStateForTable = React.useCallback(() => {
    apiFetch('/vat_watchlist_round_state').then((res) => {
      setRoundState(Array.isArray(res) && res.length > 0 ? res[0] : null);
    }).catch(() => setRoundState(null));
  }, []);
  React.useEffect(() => { fetchRoundStateForTable(); }, [fetchRoundStateForTable]);
  React.useEffect(() => {
    const unsubscribe = subscribeWs(['vat_watchlist_round_state_updated'], () => { fetchRoundStateForTable(); });
    return unsubscribe;
  }, [fetchRoundStateForTable]);

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
          vat_watchlist_active_touched_at: null, // MARKER_VATWATCHLIST_ACTIVE_TOUCH_SEPARATE_FIELD_V1
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
                  {(() => { // MARKER_VATWATCHLISTOPS_MONITOR_STATUS_BADGE_V1 MARKER_VATWATCHLISTOPS_ROUND_BASED_STATUS_V1 -- เปลี่ยนจากเทียบ Period เป็นเทียบกับ round_started_at
                    const isUpdatedThisPeriod = isVatWatchlistUpdatedThisRound(c, roundState);
                    return (
                      <td style={{ padding: '7px 8px' }}>
                        <div style={{ display: 'inline-flex', flexDirection: 'column', gap: '2px' }}>
                          <span style={{ background: isUpdatedThisPeriod ? '#EAF3DE' : '#FAEEDA', color: isUpdatedThisPeriod ? '#27500A' : '#854F0B', fontSize: '11px', padding: '2px 8px', borderRadius: '10px', width: 'fit-content' }}>
                            {isUpdatedThisPeriod ? '✅ อัปเดตแล้ว' : '⏳ ยังไม่ทำ'}
                          </span>
                          <span style={{ fontSize: '10.5px', color: '#999', paddingLeft: '2px' }}>
                            {lastIncompleteRaw ? (isUpdatedThisPeriod ? formatVatWatchlistDate(lastIncompleteRaw) : `รอบก่อน ${formatVatWatchlistDate(lastIncompleteRaw)}`) : 'ไม่เคยอัปเดต'}
                          </span>
                        </div>
                      </td>
                    );
                  })()}
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
const VAT_INCOMPLETE_NUMBER_KEYS = new Set(['exp_amount', 'exp_vat', 'avg_amount', 'avg_vat']); // MARKER_VATWATCHLISTOPS_EXPORT_NUMBER_FORMAT_V1 -- Column ตัวเลขที่ต้องเป็น Number Type จริงตอน Export

// MARKER_VATWATCHLISTOPS_EXPIRE_CHECK_PAYMENT_TEMPLATE_V1 -- Template สำเร็จรูป "Config - Expire by Check Payment"
const EXPIRE_CHECK_PAYMENT_COLS = [
  { key: 'branch', label: 'Branch', is_custom: false },
  { key: 'tax_type', label: 'ประเภทภาษี', is_custom: false },
  { key: 'invoice_ref', label: 'ใบแจ้งหนี้', is_custom: false },
  { key: 'supplier_code', label: 'Supplier Code', is_custom: false },
  { key: 'vendor_name', label: 'ชื่อผู้ค้า', is_custom: false },
  { key: 'payment_date', label: 'ชำระเงิน', is_custom: false },
  { key: 'check_date', label: 'เช็ค', is_custom: false },
  { key: 'check_no', label: 'เลขที่เช็ค', is_custom: false },
  { key: 'receive_doc_date', label: 'Receive Doc.', is_custom: false },
  { key: 'receive_doc_no', label: 'เลขที่ GRT', is_custom: false },
  { key: 'remark', label: 'Remark', is_custom: false },
  { key: 'note', label: 'Note', is_custom: false },
];
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

// MARKER_VATWATCHLISTOPS_NOTES_IMAGE_V1
// ── apiFetch (src/api.js) Force res.json() เสมอ ใช้กับ Response แบบ Binary (/view-image) ไม่ได้
// ── ต้อง fetch() ตรงๆ + แนบ Authorization เอง (Token/Base URL Pattern เดียวกับ api.js) ──
const VAT_NOTES_API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:4000';
async function fetchVatNoteImageBlobUrl(fileId) {
  const token = sessionStorage.getItem('fastapn_token');
  const res = await fetch(`${VAT_NOTES_API_BASE}/file-storage/${fileId}/view-image`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('โหลดรูปไม่สำเร็จ');
  const blob = await res.blob();
  return URL.createObjectURL(blob);
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

// MARKER_VATWATCHLISTOPS_ADD_SUPPLIER_SMCOMBOBOX_V1 -- Copy มาจาก APController.js ทั้งดุ้น (Combo พิมพ์กรองได้)
// MARKER_VATWATCHLISTOPS_SMCOMBOBOX_FULL_KEYBOARD_V1 -- Combobox เต็มรูปแบบ: Focus โชว่ทั้งหมด, Arrow Up/Down, Enter, Tab/Blur ปิด
function SmComboBox({ value, onChange, options = [], center = false }) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState(value || '');
  const [hasTyped, setHasTyped] = React.useState(false);
  const [highlightedIndex, setHighlightedIndex] = React.useState(-1);
  const wrapRef = React.useRef(null);
  const itemRefs = React.useRef([]);
  React.useEffect(() => { setQuery(value || ''); }, [value]);
  React.useEffect(() => {
    const onDocClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);
  const filtered = hasTyped
    ? (options || []).filter((o) => String(o).toLowerCase().includes(String(query || '').toLowerCase()))
    : (options || []);
  React.useEffect(() => { setHighlightedIndex(-1); }, [open, filtered.length]);
  React.useEffect(() => {
    if (highlightedIndex >= 0 && itemRefs.current[highlightedIndex]) {
      itemRefs.current[highlightedIndex].scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex]);
  const selectOption = (o) => { onChange(o); setQuery(o); setOpen(false); setHasTyped(false); };
  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setHighlightedIndex((i) => (filtered.length === 0 ? -1 : (i + 1) % filtered.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setHighlightedIndex((i) => (filtered.length === 0 ? -1 : (i - 1 + filtered.length) % filtered.length));
    } else if (e.key === 'Enter') {
      if (open && highlightedIndex >= 0 && highlightedIndex < filtered.length) {
        e.preventDefault();
        selectOption(filtered[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };
  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
      <input
        value={query}
        onFocus={() => { setOpen(true); setHasTyped(false); }}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
        onChange={(e) => { setQuery(e.target.value); onChange(e.target.value); setOpen(true); setHasTyped(true); }}
        style={{ height: '24px', padding: '0 8px', fontSize: '12px', border: 'none', outline: 'none', background: 'transparent', color: '#1a3a5c', width: '100%', boxSizing: 'border-box', textAlign: center ? 'center' : 'left' }}
      />
      {open && filtered.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '0.5px solid #ccc', borderRadius: '6px', maxHeight: '160px', overflowY: 'auto', zIndex: 50, boxShadow: '0 4px 10px rgba(0,0,0,0.1)' }}>
          {filtered.map((o, i) => (
            <div
              key={i}
              ref={(el) => { itemRefs.current[i] = el; }}
              onMouseDown={() => selectOption(o)}
              onMouseEnter={() => setHighlightedIndex(i)}
              style={{ padding: '6px 10px', fontSize: '12px', cursor: 'pointer', background: i === highlightedIndex ? '#eaf0f6' : 'white' }}
            >{o}</div>
          ))}
        </div>
      )}
    </div>
  );
}
function IncompleteBuOperationTest({ bu, onBack }) {
  const { userName, currentUser } = useAuth();
  const username = userName || currentUser?.email || 'unknown';
  const { smCodes, branches, vendorCategories } = useVatSupportingData(); // MARKER_VATWATCHLISTOPS_ADD_SUPPLIER_SMCOMBOBOX_V1 -- ผูก Hook ที่เตรียมไว้แล้วแต่ยังไม่เคยใช้

  // MARKER_VATWATCHLISTOPS_DETAIL_SERVERSIDE_V1
  const [detailRows, setDetailRows] = React.useState([]);
  const [showDetailMode, setShowDetailMode] = React.useState('all'); // MARKER_VATWATCHLISTOPS_SHOW_DETAIL_FILTER_V1 -- 'all' | 'show' | 'hide'
  const [detailTotalCount, setDetailTotalCount] = React.useState(0);
  const [detailReloadKey, setDetailReloadKey] = React.useState(0); // MARKER_VATWATCHLISTOPS_RESTORE_BROADCAST_SYNC_V1 -- Bump ค่านี้เพื่อสั่ง Refetch detailRows/AgingBucketCounts ใหม่ (เช่น ตอนได้รับ Broadcast Restore จาก Session อื่น)
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
  const [showDraftMonitor, setShowDraftMonitor] = React.useState(false); // MARKER_VATWATCHLISTOPS_DRAFT_MONITOR_V1
  const [showFullPagePopvat, setShowFullPagePopvat] = React.useState(false); // MARKER_VATWATCHLISTOPS_FULLPAGE_POPVAT_V1
  // MARKER_VATWATCHLISTOPS_ADD_SUPPLIER_FULL_FORM_V1 -- Form เต็มรูปแบบ Port จาก APController.js "New SM-Code"
  const ADD_SUPPLIER_EMPTY_FORM = {
    'SM-Code': '', 'Ofin Code': '', 'Supplier Code': '', '_type': '', '_sub_type': '',
    'Company Name': '', 'Tax ID': '', 'Branch': '', 'Short Name': '',
    'CPC_Dr': '', 'Account_Dr': '', 'Sub Acc_Dr': '', 'CPC_Cr': '', 'Account_Cr': '', 'Sub Acc_Cr': '', // MARKER_VATWATCHLISTOPS_RENAME_ACCOUNT_DR2_TO_ACCOUNT_CR_V1
    'Expense Type': '', 'Special Rule1': '', 'Special Rule2': '', 'Simple Rule3': '', 'Special Rule4': '', 'Special Rule5': '',
    'First Part': '', 'Mid Part': '', 'Last Part': '', 'Digit': '', 'Remark': '', 'BlankCell': '',
    '_ofinSimpleName': '', 'Short Branch': '', 'BU': '', '_buCompanySimple': '', '_taxIdBu': '',
    '_comPct': '', '_specPct': '', '_buBranch': '', '_branchCode': '', '_groupP': '', '_branchStatus': '',
  };
  const [showAddSupplierModal, setShowAddSupplierModal] = React.useState(false);
  const [addSupplierForm, setAddSupplierForm] = React.useState(ADD_SUPPLIER_EMPTY_FORM);
  const [addSupplierSaving, setAddSupplierSaving] = React.useState(false);
  const [addSupplierShowErrors, setAddSupplierShowErrors] = React.useState(false);
  const setAddSupplierField = (key, val) => setAddSupplierForm((prev) => ({ ...prev, [key]: val }));
  const getAddSupplierOptions = (field) => [...new Set((smCodes || []).map((i) => String(i[field] ?? '').trim()).filter(Boolean))].sort();
  const handleAddSupplierSupplierCodeChange = (val) => {
    const found = (vendorCategories || []).find((i) => String(i['Code'] || '').trim() === val.trim());
    if (found) {
      setAddSupplierForm((prev) => ({
        ...prev,
        'Supplier Code': val,
        'Company Name': found['Supplier Name'] || prev['Company Name'],
        'Tax ID': found['TAX ID'] || prev['Tax ID'],
        'Branch': found['No.'] || prev['Branch'],
        '_type': found['TYPE'] || '',
        '_sub_type': found['SUB TYPE'] || '',
      }));
    } else {
      setAddSupplierForm((prev) => ({ ...prev, 'Supplier Code': val }));
    }
  };
  const handleAddSupplierOfinCodeChange = (val) => setAddSupplierForm((prev) => ({ ...prev, 'Ofin Code': val }));
  const lookupAddSupplierOfinCode = (val) => {
    const raw = String(val || '').trim();
    const normalized = /^\d+$/.test(raw) ? raw.padStart(6, '0') : raw;
    const found = (branches || []).find((b) => String(b['Branch Code'] || '').trim() === normalized);
    setAddSupplierForm((prev) => ({
      ...prev,
      'Ofin Code': normalized,
      '_ofinSimpleName': found ? (found['Simple Brand Code'] || '') : '',
      'Short Branch': found ? (found['BU-Branch'] || '') : '',
      'BU': found ? (found['bu'] || '') : '',
      '_buCompanySimple': found ? (found['Simple Company'] || '') : '',
      '_taxIdBu': found ? (found['BU-TaxID'] || '') : '',
      '_comPct': found ? (found['%'] || '') : '',
      '_specPct': found ? (found['DB(%)'] || '') : '',
      '_buBranch': found ? (found['BU-Branch'] || '') : '',
      '_branchCode': found ? (found['Branch Code'] || '') : '',
      '_groupP': found ? (found['Group-P'] || '') : '',
      '_branchStatus': found ? (found['status'] || '') : '',
    }));
  };
  const handleAddSupplierOfinCodeBlur = (val) => { if (val?.trim()) lookupAddSupplierOfinCode(val); };
  const handleAddSupplierATMatchChange = (val) => {
    const found = (smCodes || []).find((i) => String(i['Short Name'] || '').trim() === val.trim());
    const isInput = val.trim().toUpperCase() === 'INPUT' || val.trim().toUpperCase() === 'IST36';
    const isT36 = val.trim().toUpperCase() === 'T36';
    const comPct = String(addSupplierForm['_comPct'] || '').trim();
    const isNotFull = comPct !== '' && comPct !== '100';
    const subDr = found ? (found['Sub Acc_Dr'] || '') : '';
    const isNot999 = subDr !== '' && subDr !== '999999';
    setAddSupplierForm((prev) => ({
      ...prev,
      'Short Name': val,
      'Expense Type': isNotFull
        ? (getAddSupplierOptions('Expense Type').find((o) => String(o).startsWith('63050000')) || '')
        : (isInput || isT36)
          ? (getAddSupplierOptions('Expense Type').find((o) => String(o).startsWith('63047000')) || '')
          : isNot999
            ? (getAddSupplierOptions('Expense Type').find((o) => String(o).startsWith('61200201')) || '')
            : prev['Expense Type'],
      'CPC_Dr': found ? (found['CPC_Dr'] || '') : prev['CPC_Dr'],
      'Account_Dr': found ? (found['Account_Dr'] || '') : prev['Account_Dr'],
      'Sub Acc_Dr': found ? (found['Sub Acc_Dr'] || '') : prev['Sub Acc_Dr'],
      'CPC_Cr': found ? (found['CPC_Cr'] || '') : prev['CPC_Cr'],
      'Account_Cr': found ? (found['Account_Cr'] || '') : prev['Account_Cr'], // MARKER_VATWATCHLISTOPS_RENAME_ACCOUNT_DR2_TO_ACCOUNT_CR_V1
      'Sub Acc_Cr': found ? (found['Sub Acc_Cr'] || '') : prev['Sub Acc_Cr'],
    }));
  };
  const saveAddSupplier = async () => {
    const f = addSupplierForm;
    const missing = [];
    if (!f['SM-Code']?.trim())      missing.push('Simple Code');
    if (!f['Ofin Code']?.trim())    missing.push('OFIN CODE');
    if (!f['Company Name']?.trim()) missing.push('Vendor Name');
    if (!f['Tax ID']?.trim())       missing.push('Tax ID');
    if (!f['Branch']?.trim())       missing.push('Branch No.');
    if (!f['Short Name']?.trim())   missing.push('AT-Match');
    if (!f['_type']?.trim())        missing.push('Type'); // MARKER_VATWATCHLISTOPS_ADDSUPPLIER_TYPE_FIX_V2 -- แก้จาก Expense Type/Special Rule1 (ผิด) เป็น _type/_sub_type (Dropdown Type/Sub Type จริงบนฟอร์ม) ตรงกับที่แก้ไว้ใน VendorMaster.js
    if (!f['_sub_type']?.trim())    missing.push('Sub Type'); // MARKER_VATWATCHLISTOPS_ADDSUPPLIER_TYPE_FIX_V2
    if (!f['CPC_Dr']?.trim())       missing.push('CPC Dr');
    if (!f['Account_Dr']?.trim())   missing.push('Account Dr');
    if (!f['Sub Acc_Dr']?.trim())   missing.push('Sub Acc Dr');
    if (!f['CPC_Cr']?.trim())       missing.push('CPC Cr');
    if (!f['Account_Cr']?.trim())  missing.push('Account Cr'); // MARKER_VATWATCHLISTOPS_RENAME_ACCOUNT_DR2_TO_ACCOUNT_CR_V1
    if (!f['Sub Acc_Cr']?.trim())   missing.push('Sub Acc Cr');
    if (missing.length) { setAddSupplierShowErrors(true); confirmDialog.alert('กรุณากรอกข้อมูลให้ครบถ้วนตาม Required Field: ' + missing.join(', '), { title: 'ข้อมูลไม่ครบ', variant: 'danger' }); return; }
    const dup = (smCodes || []).find((i) => String(i['SM-Code'] || '').trim().toLowerCase() === f['SM-Code'].trim().toLowerCase());
    if (dup) { confirmDialog.alert(`❌ Simple Code "${f['SM-Code']}" มีอยู่แล้วใน SM-Code List`, { title: 'ซ้ำกับข้อมูลเดิม', variant: 'danger' }); return; }
    setAddSupplierSaving(true);
    try {
      const nowIso = new Date().toISOString();
      const EXCLUDE_FIELDS = ['BlankCell'];
      const cleanedF = Object.fromEntries(Object.entries(f).filter(([k]) => !k.startsWith('_') && !EXCLUDE_FIELDS.includes(k)));
      const payload = { ...cleanedF, username, last_update: nowIso, source_mode: 'AP' }; // MARKER_VATWATCHLISTOPS_ADDSUPPLIER_SOURCE_MODE_AP_V1 -- ตาม APController.js Real Vendor Add New ที่ Fix เป็น 'AP' เหมือนกัน
      await apiFetch('/sm_code_list', { method: 'POST', body: JSON.stringify(payload) });
      // MARKER_VATWATCHLISTOPS_ADD_SUPPLIER_CATEGORY_BROADCAST_V1 -- Auto-create vendor_category ถ้ายังไม่มี (เหมือน VendorMaster.js)
      const supplierCode = (f['Supplier Code'] || '').trim();
      if (supplierCode) {
        try {
          const existingCat = await apiFetch(`/vendor_category?eq_Code=${encodeURIComponent(supplierCode)}`);
          if (!Array.isArray(existingCat) || existingCat.length === 0) {
            const catPayload = {
              'Code': supplierCode,
              'Supplier Name': f['Company Name'] || '',
              'TAX ID': f['Tax ID'] || '',
              'No.': f['Branch'] || '',
              'TYPE': f['_type'] || '', // MARKER_VATWATCHLISTOPS_ADDSUPPLIER_TYPE_FIX_V2 -- แก้ตาม VendorMaster.js: TYPE มาจาก Dropdown Type (_type) ไม่ใช่ Expense Type
              'SUB TYPE': f['_sub_type'] || '', // MARKER_VATWATCHLISTOPS_ADDSUPPLIER_TYPE_FIX_V2 -- SUB TYPE มาจาก Dropdown Sub Type (_sub_type) ไม่ใช่ Special Rule1
              'BU': f['BU'] || '', // MARKER_VATWATCHLISTOPS_ADDSUPPLIER_TYPE_FIX_V1 -- เพิ่ม BU ตาม Reference
              'username': username,
              'last_update': nowIso,
            };
            await apiFetch('/vendor_category', { method: 'POST', body: JSON.stringify(catPayload) });
          }
        } catch (err) {
          console.warn('Auto-create vendor_category failed:', err.message);
        }
      }
      broadcastWs('sm_code_list_updated', { smCode: f['SM-Code'] });
      setShowAddSupplierModal(false);
      setAddSupplierForm(ADD_SUPPLIER_EMPTY_FORM);
      setAddSupplierShowErrors(false);
      confirmDialog.alert(`เพิ่ม SM-Code "${f['SM-Code']}" สำเร็จ`, { title: 'บันทึกสำเร็จ' });
    } catch (err) {
      console.error('saveAddSupplier error:', err);
      confirmDialog.alert('บันทึกไม่สำเร็จ: ' + (err?.message || ''), { title: 'ผิดพลาด', variant: 'danger' });
    }
    setAddSupplierSaving(false);
  };
  const [fullPagePopvatDataFetched, setFullPagePopvatDataFetched] = React.useState(false); // MARKER_VATWATCHLISTOPS_FULLPAGE_POPVAT_GET_DATA_V1 -- ไม่ Auto โหลด ต้องกด Get Data ก่อน
  const [selectedFullPageInvoices, setSelectedFullPageInvoices] = React.useState(() => new Set());
  const [fullPageCancelSaving, setFullPageCancelSaving] = React.useState(false); // MARKER_VATWATCHLISTOPS_FULLPAGE_CANCEL_BUTTON_ACTION_V1 -- กันกดปุ่ม Cancel ซ้ำระหว่างกำลังบันทึก
  // MARKER_VATWATCHLISTOPS_FULLPAGE_ADD_TAX_INVOICE_FIELDS_V1
  // ── State ของ Field ในส่วน "ใบกำกับภาษีที่ Add" (เดิมเป็น Scaffold ว่าง) ──
  // ── Tax ID Default มาจาก bu['TAX ID'] ของ BU ปัจจุบัน / Branch No. ──────
  // ── ปล่อยว่างไว้ก่อนตามที่ตกลง (ยังไม่มี Logic Default) ─────────────────
  const [addTaxInvoiceReceiveDate, setAddTaxInvoiceReceiveDate] = React.useState('');
  const [addTaxInvoiceGrtNumber, setAddTaxInvoiceGrtNumber] = React.useState('');
  // MARKER_VATWATCHLISTOPS_ADDTAXINVOICE_GRT_AUTOGEN_V1
  // ── Format เดียวกับ Quick Action: Prefix | Digit Badge | Running Number ──
  const [addTaxInvoiceGrtPrefix, setAddTaxInvoiceGrtPrefix] = React.useState('');
  const [addTaxInvoiceGrtDigitCount, setAddTaxInvoiceGrtDigitCount] = React.useState(4);
  const [addTaxInvoiceGrtControl, setAddTaxInvoiceGrtControl] = React.useState('Auto');
  const [addTaxInvoiceDate, setAddTaxInvoiceDate] = React.useState('');
  const [addTaxInvoiceNumber, setAddTaxInvoiceNumber] = React.useState('');
  const [addTaxInvoiceTaxId, setAddTaxInvoiceTaxId] = React.useState(() => bu?.['TAX ID'] || '');
  const [addTaxInvoiceBranchNo, setAddTaxInvoiceBranchNo] = React.useState(''); // ตอนนี้คือช่อง "No." (รวมกับ Tax ID แบ่งครึ่ง)
  // MARKER_VATWATCHLISTOPS_ADDTAXINVOICE_BRANCH_LIST_LOOKUP_V1
  // ── Brand Code (=Branch Code) + ข้อมูล Branch List สำหรับ Lookup ────────
  const [addTaxInvoiceBrandCode, setAddTaxInvoiceBrandCode] = React.useState('');
  const [addTaxInvoiceBranchListData, setAddTaxInvoiceBranchListData] = React.useState([]);
  const [addTaxInvoiceSmCodeListData, setAddTaxInvoiceSmCodeListData] = React.useState([]); // MARKER_VATWATCHLISTOPS_SUPPLIER_DATA_LOOKUP_V1 -- ข้อมูล sm_code_list สำหรับ Match Supplier
  const [addTaxInvoiceSupplierCode, setAddTaxInvoiceSupplierCode] = React.useState(''); // MARKER_VATWATCHLISTOPS_SUPPLIER_DATA_LOOKUP_V1
  const addTaxInvoiceDateTextRef = React.useRef(null); // MARKER_VATWATCHLISTOPS_HYBRID_TAXINVOICEDATE_V1 -- Ref ของ Text Input (Hybrid Date) เผื่อต้อง Sync ค่าจากภายนอก (Calendar/Reset)
  const addTaxInvoiceLastUsedGrtRunningRef = React.useRef(null); // MARKER_VATWATCHLISTOPS_ADDTAX_GRN_RUNNING_FIX_V1 -- เก็บเลข Running ล่าสุดที่ใช้ไปตอน Add Tax (เขียนกลับ DB ตอน Add Data สำเร็จ)
  const addTaxInvoiceNumberRef = React.useRef(null); // MARKER_VATWATCHLISTOPS_HYBRID_TAXINVOICEDATE_AUTOFOCUS_V1 -- Ref Field ถัดไป (Tax Invoice Number) เผื่อ Auto Focus หลังเลือก Calendar
  const [addTaxInvoiceSupplierCpcDr, setAddTaxInvoiceSupplierCpcDr] = React.useState(''); // MARKER_VATWATCHLISTOPS_SUPPLIER_DR_CR_EDITABLE_BOXES_V1 -- แก้ไขได้ เผื่อเปลี่ยน Account กลางคัน
  const [addTaxInvoiceSupplierAccountDr, setAddTaxInvoiceSupplierAccountDr] = React.useState('');
  const [addTaxInvoiceSupplierSubDr, setAddTaxInvoiceSupplierSubDr] = React.useState('');
  const [addTaxInvoiceSupplierCpcCr, setAddTaxInvoiceSupplierCpcCr] = React.useState('');
  const [addTaxInvoiceSupplierAccountCr, setAddTaxInvoiceSupplierAccountCr] = React.useState('');
  const [addTaxInvoiceSupplierSubCr, setAddTaxInvoiceSupplierSubCr] = React.useState('');
  const [addTaxInvoiceDistinctSuppliers, setAddTaxInvoiceDistinctSuppliers] = React.useState([]); // MARKER_VATWATCHLISTOPS_SUPPLIER_DATA_LOOKUP_V1
  const [addTaxInvoiceSupplierPickerOpen, setAddTaxInvoiceSupplierPickerOpen] = React.useState(false); // MARKER_VATWATCHLISTOPS_SUPPLIER_DATA_LOOKUP_V1
  const [addTaxInvoiceDistinctBranches, setAddTaxInvoiceDistinctBranches] = React.useState([]); // MARKER_VATWATCHLISTOPS_BRANDCODE_MULTIBRANCH_MATCHING_V1 -- Branch ทั้งหมดที่เจอตอน Search (ถ้ามากกว่า 1 ให้เลือกจาก Popup ได้)
  const [addTaxInvoiceBranchPickerOpen, setAddTaxInvoiceBranchPickerOpen] = React.useState(false); // MARKER_VATWATCHLISTOPS_BRANDCODE_MULTIBRANCH_MATCHING_V1
  const [addTaxInvoiceBrandCodeExtra, setAddTaxInvoiceBrandCodeExtra] = React.useState(''); // MARKER_VATWATCHLISTOPS_ADDTAXINVOICE_REORDER_ROUND2_V1 -- สำรองไว้ทำ Trigger อื่นทีหลัง ตอนนี้ปล่อยว่าง
  // MARKER_VATWATCHLISTOPS_ADDTAXINVOICE_AMOUNT_VAT_V1
  const [addTaxInvoiceAmount, setAddTaxInvoiceAmount] = React.useState('');
  const [addTaxInvoiceVat, setAddTaxInvoiceVat] = React.useState('');
  const [addTaxInvoiceList, setAddTaxInvoiceList] = React.useState([]); // MARKER_VATWATCHLISTOPS_ADDTAX_LIST_V1
  const [selectedTaxInvoiceRows, setSelectedTaxInvoiceRows] = React.useState(() => new Set()); // MARKER_VATWATCHLISTOPS_ADDTAX_LIST_SCROLL_SELECT_V1
  const addTaxButtonRef = React.useRef(null); // MARKER_VATWATCHLISTOPS_DELETE_BUTTON_WIDTH_MATCH_ADDTAX_V1 -- อ้างอิงปุ่ม Add Tax จริง เพื่อวัดความกว้างให้ปุ่ม Delete
  const addDataButtonRef = React.useRef(null); // MARKER_VATWATCHLISTOPS_FULLPAGE_CANCEL_VERTICAL_ALIGN_FIX_V1 -- อ้างอิงปุ่ม Add Data จริง เพื่อวัดตำแหน่ง Y ให้ปุ่ม Cancel วางกึ่งกลางตรงกัน
  const [addTaxButtonWidth, setAddTaxButtonWidth] = React.useState(null); // MARKER_VATWATCHLISTOPS_DELETE_BUTTON_WIDTH_MATCH_ADDTAX_V1
  const taxInvoiceHeaderRef = React.useRef(null); // MARKER_VATWATCHLISTOPS_ADDTAX_LAYOUT_SYNC_V1 -- Container ของแถวหัว Tax Invoice List (ที่มีปุ่ม Delete) ใช้อ้างอิงตำแหน่ง
  const [deleteButtonLeft, setDeleteButtonLeft] = React.useState(null); // MARKER_VATWATCHLISTOPS_ADDTAX_LAYOUT_SYNC_V1 -- ตำแหน่งซ้ายของปุ่ม Delete วัดให้ตรงกับปุ่ม Add Tax
  const brandCodeContainerRef = React.useRef(null); // MARKER_VATWATCHLISTOPS_ADDTAX_LAYOUT_SYNC_V1 -- Container Field Brand Code ใช้วัดความกว้างให้ปุ่ม Add Data
  const [brandCodeWidth, setBrandCodeWidth] = React.useState(null); // MARKER_VATWATCHLISTOPS_ADDTAX_LAYOUT_SYNC_V1
  const receiveDateContainerRef = React.useRef(null); // MARKER_VATWATCHLISTOPS_SELECT_STYLE_CANCEL_POSITION_FIX_V1 -- Field Receive Date ใช้วัดตำแหน่ง/ความกว้างให้ปุ่ม Cancel
  const footerRowWrapperRef = React.useRef(null); // MARKER_VATWATCHLISTOPS_SELECT_STYLE_CANCEL_POSITION_FIX_V1 -- Wrapper แถวสรุป (Add Data) ใช้อ้างอิงตำแหน่ง
  const [cancelButtonLeft, setCancelButtonLeft] = React.useState(null); // MARKER_VATWATCHLISTOPS_SELECT_STYLE_CANCEL_POSITION_FIX_V1
  const [cancelButtonWidth, setCancelButtonWidth] = React.useState(null); // MARKER_VATWATCHLISTOPS_SELECT_STYLE_CANCEL_POSITION_FIX_V1
  const [cancelButtonTop, setCancelButtonTop] = React.useState(null); // MARKER_VATWATCHLISTOPS_FULLPAGE_CANCEL_VERTICAL_ALIGN_FIX_V1 -- ตำแหน่ง Y กึ่งกลางของปุ่ม Add Data จริง (เทียบกับ footerRowWrapperRef)
  React.useEffect(() => { // MARKER_VATWATCHLISTOPS_DELETE_BUTTON_WIDTH_MATCH_ADDTAX_V1 MARKER_VATWATCHLISTOPS_ADDTAX_LAYOUT_SYNC_V1 MARKER_VATWATCHLISTOPS_ADDTAX_LAYOUT_SYNC_FIX_TIMING_V1 -- วัดความกว้าง/ตำแหน่งปุ่ม Add Tax + Brand Code แบบ Dynamic ตาม Responsive (รอ Full Page เปิดจริงก่อนถึงวัด)
    if (!showFullPagePopvat) return; // MARKER_VATWATCHLISTOPS_ADDTAX_LAYOUT_SYNC_FIX_TIMING_V1 -- ยังไม่เปิด Full Page = Ref ทุกตัวยังเป็น null อยู่ ข้ามไปก่อน
    const computeAll = () => {
      const addTaxEl = addTaxButtonRef.current;
      const headerEl = taxInvoiceHeaderRef.current;
      const brandCodeEl = brandCodeContainerRef.current;
      if (addTaxEl) setAddTaxButtonWidth(addTaxEl.offsetWidth);
      if (addTaxEl && headerEl) {
        const addTaxRect = addTaxEl.getBoundingClientRect();
        const headerRect = headerEl.getBoundingClientRect();
        setDeleteButtonLeft(addTaxRect.left - headerRect.left);
      }
      if (brandCodeEl) setBrandCodeWidth(brandCodeEl.offsetWidth);
      const receiveDateEl = receiveDateContainerRef.current; // MARKER_VATWATCHLISTOPS_SELECT_STYLE_CANCEL_POSITION_FIX_V1
      const footerEl = footerRowWrapperRef.current;
      if (receiveDateEl) setCancelButtonWidth(receiveDateEl.offsetWidth);
      if (receiveDateEl && footerEl) {
        const receiveDateRect = receiveDateEl.getBoundingClientRect();
        const footerRect = footerEl.getBoundingClientRect();
        setCancelButtonLeft(receiveDateRect.left - footerRect.left);
      }
      const addDataEl = addDataButtonRef.current; // MARKER_VATWATCHLISTOPS_FULLPAGE_CANCEL_VERTICAL_ALIGN_FIX_V1 -- วัดตำแหน่ง Y กึ่งกลางจริงของปุ่ม Add Data
      if (addDataEl && footerEl) {
        const addDataRect = addDataEl.getBoundingClientRect();
        const footerRect2 = footerEl.getBoundingClientRect();
        setCancelButtonTop((addDataRect.top - footerRect2.top) + (addDataRect.height / 2));
      }
    };
    computeAll();
    const rafId = requestAnimationFrame(computeAll); // MARKER_VATWATCHLISTOPS_ADDTAX_LAYOUT_SYNC_FIX_TIMING_V1 -- วัดซ้ำอีกครั้งหลัง Browser Paint เสร็จ กัน Layout ยังไม่นิ่งตอน Modal เพิ่งเปิด
    if (typeof ResizeObserver === 'undefined') return () => cancelAnimationFrame(rafId);
    const ro = new ResizeObserver(computeAll);
    if (addTaxButtonRef.current) ro.observe(addTaxButtonRef.current);
    if (taxInvoiceHeaderRef.current) ro.observe(taxInvoiceHeaderRef.current);
    if (brandCodeContainerRef.current) ro.observe(brandCodeContainerRef.current);
    if (receiveDateContainerRef.current) ro.observe(receiveDateContainerRef.current); // MARKER_VATWATCHLISTOPS_SELECT_STYLE_CANCEL_POSITION_FIX_V1
    if (addDataButtonRef.current) ro.observe(addDataButtonRef.current); // MARKER_VATWATCHLISTOPS_FULLPAGE_CANCEL_VERTICAL_ALIGN_FIX_V1
    if (footerRowWrapperRef.current) ro.observe(footerRowWrapperRef.current);
    window.addEventListener('resize', computeAll);
    return () => { cancelAnimationFrame(rafId); ro.disconnect(); window.removeEventListener('resize', computeAll); };
  }, [showFullPagePopvat]);
  const toggleSelectTaxInvoiceRow = (id) => setSelectedTaxInvoiceRows((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleSelectAllTaxInvoiceRows = () => setSelectedTaxInvoiceRows((prev) =>
    prev.size === addTaxInvoiceList.length ? new Set() : new Set(addTaxInvoiceList.map((r) => r.id))
  );
  const handleAddTaxToList = async () => { // MARKER_VATWATCHLISTOPS_ADDTAX_BUGFIX_V1 MARKER_VATWATCHLISTOPS_ADDTAX_VALIDATION_CONFIRMDIALOG_V1 -- แก้ Branch ใช้ State ผิด + Amount/Vat มี Comma ทำให้ NaN + Validate Tax Invoice Date ด้วย + ใช้ confirmDialog แทน Native alert
    if (!addTaxInvoiceNumber?.trim()) { await confirmDialog.alert('กรุณากรอก Tax Invoice Number ก่อน', { title: 'ข้อมูลไม่ครบ', variant: 'danger' }); return; }
    let effectiveAddTaxInvoiceDate = addTaxInvoiceDate; // MARKER_VATWATCHLISTOPS_ADDTAX_DATE_SYNC_FIX_V1 -- เผื่อ State ยังไม่ Sync จาก Text Field (พิมพ์ Date แล้วกด Add Tax ทันทีโดยยังไม่ทัน Blur ออกจากช่อง)
    if (!String(effectiveAddTaxInvoiceDate || '').trim() && addTaxInvoiceDateTextRef.current) {
      const parsedFromFieldFP = parseFlexibleDate(addTaxInvoiceDateTextRef.current.value);
      if (parsedFromFieldFP) { effectiveAddTaxInvoiceDate = parsedFromFieldFP; setAddTaxInvoiceDate(parsedFromFieldFP); }
    }
    if (!String(effectiveAddTaxInvoiceDate || '').trim()) { await confirmDialog.alert('กรุณากรอก Tax Invoice Date ก่อน', { title: 'ข้อมูลไม่ครบ', variant: 'danger' }); return; } // MARKER_VATWATCHLISTOPS_ADDTAX_VALIDATION_CONFIRMDIALOG_V1 -- Validate เพิ่ม (เดิมไม่มี)
    const grn = addTaxInvoiceGrtControl === 'Auto'
      ? `${addTaxInvoiceGrtPrefix}${addTaxInvoiceGrtNumber}`
      : `${addTaxInvoiceGrtPrefix}${String(addTaxInvoiceGrtNumber || '').padStart(addTaxInvoiceGrtDigitCount, '0')}`;
    // MARKER_VATWATCHLISTOPS_ADDTAX_REVERSE_VAT_AMOUNT_V1 -- ไม่ได้กรอก Amount แต่กรอก Vat มา -> คำนวณย้อน Amount = Vat x 100/7
    let finalAmount = String(addTaxInvoiceAmount || '').replace(/,/g, '');
    let vatRaw = String(addTaxInvoiceVat || '').replace(/,/g, '');
    if (!finalAmount.trim() && vatRaw.trim()) {
      const vatNum = parseFloat(vatRaw);
      if (!isNaN(vatNum)) finalAmount = (vatNum * 100 / 7).toFixed(2);
    }
    if (!finalAmount.trim() && !vatRaw.trim()) { // MARKER_VATWATCHLISTOPS_ADDTAX_AMOUNT_VAT_FALLBACK_LISTSUM_V1 -- ว่างทั้งคู่ -> ดึงจากยอดรวมของ List (Logic เดียวกับที่แสดงผลใต้ตาราง Invoice List)
      const qFallback = detailSearch.trim().toLowerCase();
      const qTermsFallback = qFallback.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
      const listRowsFallback = qTermsFallback.length === 0 ? [] : detailRows.filter((r) =>
        qTermsFallback.some((term) =>
          String(r.invoice_ref || '').toLowerCase().includes(term) ||
          String(r.receive_doc_no || '').toLowerCase().includes(term) ||
          String(r.vendor_name || '').toLowerCase().includes(term) ||
          String(r.check_no || '').toLowerCase().includes(term)
        )
      );
      const selectedListRowsFallback = listRowsFallback.filter((r) => selectedFullPageInvoices.has(getNoteKey(r)));
      const listRowsForSumFallback = selectedListRowsFallback.length > 0 ? selectedListRowsFallback : listRowsFallback;
      const listSumAmountFallback = listRowsForSumFallback.reduce((sum, r) => sum + (Number(r.exp_amount) || 0), 0);
      const listSumVatFallback = listRowsForSumFallback.reduce((sum, r) => sum + (Number(r.exp_vat) || 0), 0);
      // MARKER_VATWATCHLISTOPS_ADDTAX_FALLBACK_SUBTRACT_ADDED_V1 -- หักผลรวมของ Tax Invoice List ที่ Add ไปแล้วออกก่อน (Logic เดียวกับ Card "ผลรวมของ Tax Invoice List" ที่แสดงผลอยู่แล้ว) เหลือเท่าไหร่ค่อยเอามาใส่ ไม่ใช่ยอดเต็มของ List
      const addedAmountSoFar = addTaxInvoiceList.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
      const addedVatSoFar = addTaxInvoiceList.reduce((sum, r) => sum + (Number(r.vat) || 0), 0);
      finalAmount = (listSumAmountFallback - addedAmountSoFar).toFixed(2);
      vatRaw = (listSumVatFallback - addedVatSoFar).toFixed(2);
    }
    setAddTaxInvoiceList((prev) => [...prev, {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      branch: addTaxInvoiceBrandCode,
      taxInvoiceNo: addTaxInvoiceNumber,
      taxInvoiceDate: effectiveAddTaxInvoiceDate, // MARKER_VATWATCHLISTOPS_ADDTAX_DATE_SYNC_FIX_V1 -- ใช้ค่าที่กู้คืนมาแล้ว (เผื่อ State เดิมยังไม่ Sync)
      grn,
      receiveDate: addTaxInvoiceReceiveDate,
      amount: finalAmount,
      vat: vatRaw,
    }]);
    if (addTaxInvoiceGrtControl === 'Auto') { // MARKER_VATWATCHLISTOPS_ADDTAX_GRN_RUNNING_FIX_V1 -- Increment ทันที กันเลข GRN ซ้ำกันเมื่อ Add Tax หลายใบ
      const usedRunningFP = parseInt(addTaxInvoiceGrtNumber, 10) || 0;
      addTaxInvoiceLastUsedGrtRunningRef.current = usedRunningFP;
      setAddTaxInvoiceGrtNumber(String(usedRunningFP + 1).padStart(addTaxInvoiceGrtDigitCount, '0'));
    }
    setAddTaxInvoiceDate(''); // MARKER_VATWATCHLISTOPS_ADDTAX_RESET_AFTER_ADD_V1 -- Reset หลัง Add Tax สำเร็จ ให้กรอกใบถัดไปได้ทันที
    if (addTaxInvoiceDateTextRef.current) addTaxInvoiceDateTextRef.current.value = ''; // MARKER_VATWATCHLISTOPS_ADDTAX_DATE_FIELD_RESET_VISUAL_V1 -- Reset ตัวช่อง Text บนจอด้วย (Uncontrolled Input ไม่ Reset ตาม State อัตโนมัติ เหมือนที่ปุ่ม Cancel ทำไว้แล้ว)
    setAddTaxInvoiceNumber(''); // MARKER_VATWATCHLISTOPS_ADDTAX_RESET_AFTER_ADD_V1
    setAddTaxInvoiceAmount(''); // MARKER_VATWATCHLISTOPS_ADDTAX_RESET_AMOUNT_VAT_V1 -- ลืม Reset ช่อง Amount/Vat หลัง Add Tax (Controlled Input เรียก setState('') พอ)
    setAddTaxInvoiceVat(''); // MARKER_VATWATCHLISTOPS_ADDTAX_RESET_AMOUNT_VAT_V1
  };
  const handleRemoveTaxFromList = (id) => setAddTaxInvoiceList((prev) => prev.filter((r) => r.id !== id));
  const handleBulkDeleteTaxInvoice = async () => { // MARKER_VATWATCHLISTOPS_ADDTAX_BULK_DELETE_V1 MARKER_VATWATCHLISTOPS_DELETE_TAX_CONFIRM_ALL_V1 -- ไม่ติ๊กเลย = ลบทั้งหมด, ติ๊กไว้ = ลบเฉพาะที่เลือก, มี Popup ยืนยันก่อนเสมอ
    const deleteAll = selectedTaxInvoiceRows.size === 0;
    const targetIds = deleteAll ? new Set(addTaxInvoiceList.map((r) => r.id)) : selectedTaxInvoiceRows;
    if (targetIds.size === 0) return; // ไม่มีอะไรให้ลบเลย (Tax Invoice List ว่างอยู่แล้ว)
    const confirmed = await confirmDialog.confirm(
      deleteAll
        ? `ต้องการลบข้อมูล Tax Invoice ทั้งหมด (${targetIds.size} รายการ) ใช่หรือไม่?`
        : `ต้องการลบข้อมูล Tax Invoice ที่เลือกไว้ (${targetIds.size} รายการ) ใช่หรือไม่?`,
      { title: 'ยืนยันการลบ', variant: 'danger' }
    );
    if (!confirmed) return;
    setAddTaxInvoiceList((prev) => prev.filter((r) => !targetIds.has(r.id)));
    setSelectedTaxInvoiceRows(new Set());
  };
  const toggleSelectFullPageInvoice = (row) => {
    const key = getNoteKey(row);
    setSelectedFullPageInvoices((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const toggleSelectAllFullPageInvoices = (rows) => {
    setSelectedFullPageInvoices((prev) => {
      const next = new Set(prev);
      const allSelected = rows.length > 0 && rows.every((r) => next.has(getNoteKey(r)));
      if (allSelected) rows.forEach((r) => next.delete(getNoteKey(r)));
      else rows.forEach((r) => next.add(getNoteKey(r)));
      return next;
    });
  };
  const [draftMonitorTab, setDraftMonitorTab] = React.useState('popvat'); // MARKER_VATWATCHLISTOPS_DRAFT_MONITOR_V1
  const [simpleTypeFilter, setSimpleTypeFilter] = React.useState('all'); // MARKER_VATWATCHLIST_DRAFTMONITOR_SIMPLE_SUBTABS_V1
  const [draftPopvatRows, setDraftPopvatRows] = React.useState([]); // MARKER_VATWATCHLISTOPS_DRAFT_MONITOR_POPVAT_TABLE_V1
  const [draftPopvatLoading, setDraftPopvatLoading] = React.useState(false); // MARKER_VATWATCHLISTOPS_DRAFT_MONITOR_POPVAT_TABLE_V1
  const [selectedDraftRows, setSelectedDraftRows] = React.useState(() => new Set()); // MARKER_VATWATCHLISTOPS_DRAFT_MONITOR_POPVAT_TABLE_V1
  const SIMPLE_DRAFT_COLUMNS = [ // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_SIMPLE_RESTORE_CASCADE_V1 -- Column ตาม Schema vat_simpleinputdraft
    { key: 'liability_cost_center_special', label: 'Liability Cost Center (Special)' },
    { key: 'liability_account_special', label: 'Liability Account (Special)' },
    { key: 'liability_sub_account_special', label: 'Liability Sub Account (Special)' },
    { key: 'supplier_code', label: 'Supplier Code' },
    { key: 'supplier_name', label: 'Supplier Name' },
    { key: 'receive_date', label: 'Receive Date' },
    { key: 'tax_invoice_number', label: 'Tax Invoice Number' },
    { key: 'tax_invoice_date', label: 'Tax Invoice Date' },
    { key: 'vendor_tax_invoice_number', label: 'Vendor Tax Invoice Number' },
    { key: 'tax_id', label: 'เลขประจำตัวผู้เสียภาษี' },
    { key: 'branch_no', label: 'สาขาที่' },
    { key: 'line_number', label: 'Line Number' },
    { key: 'expense_type', label: 'Expense Type' },
    { key: 'description', label: 'รายการ' },
    { key: 'amount_ex_vat', label: 'Amount Ex VAT' },
    { key: 'vat_amount', label: 'VAT Amount' },
    { key: 'branch_code', label: 'Branch Code' },
    { key: 'cpc_special', label: 'CPC (Special)' },
    { key: 'sub_account_special', label: 'Sub Account (Special)' },
    { key: 'cpc_tax_special', label: 'CPC Tax (Special)' },
    { key: 'vat_average_percent', label: 'VAT Average%' },
  ];
  const POPVAT_DRAFT_COLUMNS = [ // MARKER_VATWATCHLISTOPS_DRAFT_MONITOR_POPVAT_TABLE_V1 -- Column ตามไฟล์ Popvat จริง (A-I)
    { key: 'branch', label: 'Branch' },
    { key: 'grt_number', label: 'GRT Number' },
    { key: 'original_invoice_number', label: 'Original Invoice Number' },
    { key: 'receipt_date', label: 'Receipt Date' },
    { key: 'tax_invoice_number', label: 'Tax Invoice Number' },
    { key: 'tax_invoice_date', label: 'Tax Invoice Date' },
    { key: 'vendor_tax_invoice_number', label: 'Vendor Tax Invoice Number' },
    { key: 'supplier_tax_id', label: 'Supplier Tax ID' },
    { key: 'supplier_branch_number', label: 'Supplier Branch Number' },
  ];
  React.useEffect(() => { // MARKER_VATWATCHLISTOPS_DRAFT_MONITOR_POPVAT_TABLE_V1 -- Fetch ตอนเปิด Tab Upload Popvat หรือ Full Page - Popvat
    const needPopvat = (showDraftMonitor && draftMonitorTab === 'popvat') || showFullPagePopvat; // MARKER_VATWATCHLISTOPS_FULLPAGE_POPVAT_V1
    if (!needPopvat || !bu?.bu) return;
    let active = true;
    setDraftPopvatLoading(true);
    apiFetch(`/vat_upload_popvatdraft?eq_bu=${encodeURIComponent(bu.bu)}&eq_status=draft`)
      .then((res) => { if (active) setDraftPopvatRows(Array.isArray(res) ? res : []); })
      .catch(() => { if (active) setDraftPopvatRows([]); })
      .finally(() => { if (active) setDraftPopvatLoading(false); });
    return () => { active = false; };
  }, [showDraftMonitor, draftMonitorTab, showFullPagePopvat, bu?.bu]);
  const [draftSimpleRows, setDraftSimpleRows] = React.useState([]); // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_SIMPLE_RESTORE_CASCADE_V1
  const [draftSimpleLoading, setDraftSimpleLoading] = React.useState(false); // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_SIMPLE_RESTORE_CASCADE_V1
  const [selectedDraftSimpleRows, setSelectedDraftSimpleRows] = React.useState(() => new Set()); // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_SIMPLE_RESTORE_CASCADE_V1
  React.useEffect(() => { // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_SIMPLE_RESTORE_CASCADE_V1 -- Fetch ข้อมูลจริงตอนเปิด Tab Upload Simple
    const needSimple = showDraftMonitor && draftMonitorTab === 'simple';
    if (!needSimple || !bu?.bu) return;
    let active = true;
    setDraftSimpleLoading(true);
    // MARKER_VATWATCHLIST_OPERATIONZONE_STATUS_FILTER_V1
    apiFetch(`/vat_simpleinputdraft?eq_bu=${encodeURIComponent(bu.bu)}&eq_status=draft`)
      .then((res) => { if (active) setDraftSimpleRows(Array.isArray(res) ? res : []); })
      .catch(() => { if (active) setDraftSimpleRows([]); })
      .finally(() => { if (active) setDraftSimpleLoading(false); });
    return () => { active = false; };
  }, [showDraftMonitor, draftMonitorTab, bu?.bu]);
  const ADI_DRAFT_COLUMNS = [ // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_ADI_DISPLAY_V1 -- Column ตาม Schema vat_adi_transferdraft (Key ตรงกับชื่อ Column จริงใน DB)
    { key: 'category', label: 'Category' },
    { key: 'source', label: 'Source' },
    { key: 'acc_date', label: 'Acc Date' },
    { key: 'bus', label: 'Bus' },
    { key: 'grp', label: 'Grp' },
    { key: 'com', label: 'Com' },
    { key: 'branch', label: 'Branch' },
    { key: 'cpc', label: 'CPC' },
    { key: 'acc', label: 'Acc' },
    { key: 'sub_acc', label: 'Sub_Acc' },
    { key: 'debit', label: 'Debit' },
    { key: 'credit', label: 'Credit' },
    { key: 'adi_period', label: 'Period' }, // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_ADI_ADD_PERIOD_V1 MARKER_VATWATCHLISTOPS_ADI_PERIOD_COLUMN_V1 -- โชว์จาก adi_period (Format AUG-26) แทน period (09-2026)
    { key: 'batch_name', label: 'Batch Name' },
    { key: 'batch_description', label: 'Batch Description' },
    { key: 'journal_name', label: 'Journal Name' },
    { key: 'journal_description', label: 'Journal Description' },
    { key: 'line_description', label: 'Line Description' },
    { key: 'line_dff', label: 'Line DFF' },
  ];
  const [draftAdiRows, setDraftAdiRows] = React.useState([]); // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_ADI_DISPLAY_V1
  const [draftAdiLoading, setDraftAdiLoading] = React.useState(false); // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_ADI_DISPLAY_V1
  const [selectedDraftAdiRows, setSelectedDraftAdiRows] = React.useState(() => new Set()); // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_ADI_SELECT_RESTORE_V1
  React.useEffect(() => { // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_ADI_DISPLAY_V1 -- Fetch ข้อมูลจริงตอนเปิด Tab Upload ADI (Read-only ไม่มี Checkbox เพราะ Restore/Delete ทำผ่าน Popvat/Simple ที่ Cascade ตาม draft_id อยู่แล้ว)
    const needAdi = showDraftMonitor && draftMonitorTab === 'adi';
    if (!needAdi || !bu?.bu) return;
    let active = true;
    setDraftAdiLoading(true);
    // MARKER_VATWATCHLIST_OPERATIONZONE_STATUS_FILTER_V1
    apiFetch(`/vat_adi_transferdraft?eq_bu=${encodeURIComponent(bu.bu)}&eq_status=draft`)
      .then((res) => { if (active) setDraftAdiRows(Array.isArray(res) ? res : []); })
      .catch(() => { if (active) setDraftAdiRows([]); })
      .finally(() => { if (active) setDraftAdiLoading(false); });
    return () => { active = false; };
  }, [showDraftMonitor, draftMonitorTab, bu?.bu]);
  const toggleSelectDraftSimpleRow = (id) => { // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_SIMPLE_RESTORE_CASCADE_V1
    const groupRow = draftSimpleRows.find((r) => r.id === id); // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_GROUP_SELECT_BY_DRAFTID_V1 -- ติ๊ก 1 แถว Auto-tick แถวอื่นที่ draft_id เดียวกันในตารางนี้ด้วย
    const groupIds = groupRow?.draft_id
      ? draftSimpleRows.filter((r) => r.draft_id === groupRow.draft_id).map((r) => r.id)
      : [id];
    setSelectedDraftSimpleRows((prev) => {
      const next = new Set(prev);
      const willSelect = !next.has(id);
      groupIds.forEach((gid) => { if (willSelect) next.add(gid); else next.delete(gid); });
      return next;
    });
  };
  const toggleSelectAllDraftSimple = () => { // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_SIMPLE_RESTORE_CASCADE_V1
    setSelectedDraftSimpleRows((prev) => {
      const allSelected = draftSimpleRows.length > 0 && draftSimpleRows.every((r) => prev.has(r.id));
      return allSelected ? new Set() : new Set(draftSimpleRows.map((r) => r.id));
    });
  };
  const toggleSelectDraftRow = (id) => { // MARKER_VATWATCHLISTOPS_DRAFT_MONITOR_POPVAT_TABLE_V1
    const groupRow = draftPopvatRows.find((r) => r.id === id); // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_GROUP_SELECT_BY_DRAFTID_V1 -- ติ๊ก 1 แถว Auto-tick แถวอื่นที่ draft_id เดียวกันในตารางนี้ด้วย
    const groupIds = groupRow?.draft_id
      ? draftPopvatRows.filter((r) => r.draft_id === groupRow.draft_id).map((r) => r.id)
      : [id];
    setSelectedDraftRows((prev) => {
      const next = new Set(prev);
      const willSelect = !next.has(id);
      groupIds.forEach((gid) => { if (willSelect) next.add(gid); else next.delete(gid); });
      return next;
    });
  };
  const toggleSelectAllDraftPopvat = () => { // MARKER_VATWATCHLISTOPS_DRAFT_MONITOR_POPVAT_TABLE_V1
    setSelectedDraftRows((prev) => {
      const allSelected = draftPopvatRows.length > 0 && draftPopvatRows.every((r) => prev.has(r.id));
      return allSelected ? new Set() : new Set(draftPopvatRows.map((r) => r.id));
    });
  };
  const toggleSelectDraftAdiRow = (id) => { // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_ADI_SELECT_RESTORE_V1
    const groupRow = draftAdiRows.find((r) => r.id === id); // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_GROUP_SELECT_BY_DRAFTID_V1 -- ติ๊ก 1 แถว Auto-tick คู่ Debit/Credit (draft_id เดียวกัน) ในตารางนี้ด้วย
    const groupIds = groupRow?.draft_id
      ? draftAdiRows.filter((r) => r.draft_id === groupRow.draft_id).map((r) => r.id)
      : [id];
    setSelectedDraftAdiRows((prev) => {
      const next = new Set(prev);
      const willSelect = !next.has(id);
      groupIds.forEach((gid) => { if (willSelect) next.add(gid); else next.delete(gid); });
      return next;
    });
  };
  const toggleSelectAllDraftAdi = () => { // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_ADI_SELECT_RESTORE_V1
    setSelectedDraftAdiRows((prev) => {
      const allSelected = draftAdiRows.length > 0 && draftAdiRows.every((r) => prev.has(r.id));
      return allSelected ? new Set() : new Set(draftAdiRows.map((r) => r.id));
    });
  };
  const handleRestoreByDraftIds = async (draftIds) => { // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_SIMPLE_RESTORE_CASCADE_V1 -- Restore แบบ Cascade ครบ 3 ตาราง ไม่ว่ากดจาก Tab ไหน
    const uniqueDraftIds = [...new Set((draftIds || []).filter(Boolean))];
    if (uniqueDraftIds.length === 0) return;
    // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_RESTORE_IMPACT_CONFIRM_V1 -- Preflight: นับจำนวนแถวที่จะกระทบจริงทั้ง 3 ตาราง ก่อนถาม Confirm (Cascade ข้าม Tab)
    let impactPopvatCount = 0;
    let impactSimpleCount = 0;
    let impactAdiCount = 0;
    try {
      for (const impactDid of uniqueDraftIds) {
        const [impactPopvatRows, impactSimpleRows, impactAdiRows] = await Promise.all([
          apiFetch(`/vat_upload_popvatdraft?eq_draft_id=${encodeURIComponent(impactDid)}`).catch(() => []),
          apiFetch(`/vat_simpleinputdraft?eq_draft_id=${encodeURIComponent(impactDid)}`).catch(() => []),
          apiFetch(`/vat_adi_transferdraft?eq_draft_id=${encodeURIComponent(impactDid)}`).catch(() => []),
        ]);
        impactPopvatCount += Array.isArray(impactPopvatRows) ? impactPopvatRows.length : 0;
        impactSimpleCount += Array.isArray(impactSimpleRows) ? impactSimpleRows.length : 0;
        impactAdiCount += Array.isArray(impactAdiRows) ? impactAdiRows.length : 0;
      }
    } catch (err) {
      console.error('handleRestoreByDraftIds impact count error:', err);
    }
    const confirmedRestore = await confirmDialog.confirm(
      `Restore นี้จะกระทบข้อมูล Draft แบบ Cascade ทั้ง 3 ตาราง (ไม่ว่าจะกดจาก Tab ไหน):\n\n` +
      `Upload Popvat: ${impactPopvatCount} แถว\n` +
      `Upload Simple: ${impactSimpleCount} แถว\n` +
      `Upload ADI: ${impactAdiCount} แถว\n\n` +
      `ยืนยัน Restore?`,
      { title: `Restore ${uniqueDraftIds.length} รายการ`, variant: 'danger' }
    );
    if (!confirmedRestore) return;
    let debugStep = '';
    try {
      for (const did of uniqueDraftIds) {
        debugStep = `GET vat_upload_popvatdraft (draft_id=${did})`;
        const popvatRowsForDraft = await apiFetch(`/vat_upload_popvatdraft?eq_draft_id=${encodeURIComponent(did)}`);
        const popvatRowsArr = Array.isArray(popvatRowsForDraft) ? popvatRowsForDraft : [];
        for (const pr of popvatRowsArr) {
          debugStep = `GET vat_watchlist_report (invoice_ref=${pr.original_invoice_number})`;
          const reportRows = await apiFetch(`/vat_watchlist_report?eq_bu=${encodeURIComponent(pr.bu)}&eq_branch=${encodeURIComponent(pr.branch)}&eq_invoice_ref=${encodeURIComponent(pr.original_invoice_number)}`);
          const matched = (Array.isArray(reportRows) ? reportRows : []).filter((r) => r.status === 'draft');
          for (const r of matched) {
            debugStep = `PUT vat_watchlist_report/${r.id}`;
            await apiFetch(`/vat_watchlist_report/${r.id}`, { method: 'PUT', body: JSON.stringify({ status: 'pending' }) });
          }
        }
        debugStep = `DELETE vat_upload_popvatdraft (draft_id=${did})`;
        await apiFetch(`/vat_upload_popvatdraft?eq_draft_id=${encodeURIComponent(did)}&hard=true`, { method: 'DELETE' });
        debugStep = `DELETE vat_simpleinputdraft (draft_id=${did})`;
        await apiFetch(`/vat_simpleinputdraft?eq_draft_id=${encodeURIComponent(did)}&hard=true`, { method: 'DELETE' }).catch(() => {});
        debugStep = `DELETE vat_adi_transferdraft (draft_id=${did})`;
        await apiFetch(`/vat_adi_transferdraft?eq_draft_id=${encodeURIComponent(did)}&hard=true`, { method: 'DELETE' }).catch(() => {});
      }
      setDraftPopvatRows((prev) => prev.filter((r) => !uniqueDraftIds.includes(r.draft_id)));
      setDraftSimpleRows((prev) => prev.filter((r) => !uniqueDraftIds.includes(r.draft_id)));
      setDraftAdiRows((prev) => prev.filter((r) => !uniqueDraftIds.includes(r.draft_id))); // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_ADI_SELECT_RESTORE_V1
      setSelectedDraftRows(new Set());
      setSelectedDraftSimpleRows(new Set());
      setSelectedDraftAdiRows(new Set()); // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_ADI_SELECT_RESTORE_V1
      setDetailReloadKey((k) => k + 1);
      broadcastWs('vat_watchlist_draft_restored', { bu: bu?.bu });
    } catch (err) {
      console.error('handleRestoreByDraftIds error:', debugStep, err);
      alert(`Restore ไม่สำเร็จ\n\nStep: ${debugStep}\n\nError: ${err?.message || JSON.stringify(err)}`);
    }
  };
  const handleRestoreSelectedDrafts = async () => { // MARKER_VATWATCHLISTOPS_DRAFT_MONITOR_POPVAT_TABLE_V1 -- Bulk Restore ทุกแถวที่ Checkbox เลือกไว้ (Cascade ครบ 3 ตาราง)
    const targets = draftPopvatRows.filter((r) => selectedDraftRows.has(r.id));
    if (targets.length === 0) return;
    await handleRestoreByDraftIds(targets.map((r) => r.draft_id));
  };
  const handleRestoreSelectedSimpleDrafts = async () => { // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_SIMPLE_RESTORE_CASCADE_V1
    const targets = draftSimpleRows.filter((r) => selectedDraftSimpleRows.has(r.id));
    if (targets.length === 0) return;
    await handleRestoreByDraftIds(targets.map((r) => r.draft_id));
  };
  const handleRestoreSelectedAdiDrafts = async () => { // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_ADI_SELECT_RESTORE_V1
    const targets = draftAdiRows.filter((r) => selectedDraftAdiRows.has(r.id));
    if (targets.length === 0) return;
    await handleRestoreByDraftIds(targets.map((r) => r.draft_id));
  };
  const [detailPageSize, setDetailPageSize] = React.useState(200);
  const [detailPage, setDetailPage] = React.useState(1);
  React.useEffect(() => { setDetailPage(1); }, [detailPageSize]);
  const [detailSearch, setDetailSearch] = React.useState(''); // MARKER_VATWATCHLISTOPS_SEARCH_BIDIRECTIONAL_SYNC_V1 -- รวม State Search ของ Incomplete Detail + Full Page Popvat เป็นตัวเดียวกันแล้ว Sync 2 ทางอัตโนมัติ
  // MARKER_VATWATCHLISTOPS_SEARCH_BLACKLIST_WORDS_V1 -- รายการคำแปลกปลอมที่จะถูกลบออกจากช่อง Search อัตโนมัติ (เพิ่มคำใหม่ได้ตรงนี้เลย ไม่ต้องแก้ Logic อื่น เทียบแบบตัวเล็ก-ใหญ่ไม่สนใจ)
  const SEARCH_IGNORED_WORDS = ['ยื่น', 'excel'];
  const [fullPagePopvatRows, setFullPagePopvatRows] = React.useState([]); // MARKER_VATWATCHLISTOPS_FULLPAGE_SEARCH_BACKEND_V1 MARKER_VATWATCHLISTOPS_FIX_FULLPAGEPOPVATROWS_TDZ_V1 -- ย้ายมาประกาศก่อน Effect ที่ใช้งาน กัน Temporal Dead Zone Error
  const [selectedNoteRows, setSelectedNoteRows] = React.useState(() => new Map()); // MARKER_VATWATCHLISTOPS_FIX_SELECTEDNOTEROWS_TDZ_V1 -- ย้ายมาประกาศก่อน Effect FULLPAGE_SEARCH_BACKEND ที่ใช้งาน กัน Temporal Dead Zone Error (Pattern เดียวกับ fullPagePopvatRows ด้านบน)
  // MARKER_VATWATCHLISTOPS_ADDTAXINVOICE_BRANCH_LIST_LOOKUP_V1
  // ── Logic Lookup Brand Code (=Branch Code) ──────────────────────────────
  // ── ถ้า No. ว่าง -> ดูจาก Invoice List ที่ Search เจอตอนนี้ (Branch ไม่ซ้ำ ──
  // ── กันแค่ 1 ค่าเท่านั้นถึง Auto ใส่ให้) / ถ้า No. มีค่า -> Lookup จาก ────
  // ── /branch_list ด้วย BU Tax ID + BU Branch ─────────────────────────────
  React.useEffect(() => {
    const noVal = String(addTaxInvoiceBranchNo || '').trim();
    if (!noVal) {
      const q = detailSearch.trim().toLowerCase();
      const qTerms = q.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
      const rows = qTerms.length === 0 ? [] : fullPagePopvatRows.filter((r) => // MARKER_VATWATCHLISTOPS_FIX_AUTODETECT_SOURCE_FULLPAGE_V1 -- ใช้ข้อมูลของ Full Page List จริง แทน Incomplete Detail (detailRows)
        qTerms.some((term) =>
          String(r.invoice_ref || '').toLowerCase().includes(term) ||
          String(r.receive_doc_no || '').toLowerCase().includes(term) ||
          String(r.vendor_name || '').toLowerCase().includes(term) ||
          String(r.check_no || '').toLowerCase().includes(term)
        )
      );
      const distinctBranches = [...new Set(rows.map((r) => String(r.branch || '').trim()).filter(Boolean))];
      setAddTaxInvoiceBrandCode(distinctBranches.length > 0 ? distinctBranches[0] : ''); // MARKER_VATWATCHLISTOPS_BRANDCODE_MULTIBRANCH_MATCHING_V1 -- Auto Fill Branch แรกที่เจอเสมอ (เดิม Auto แค่ตอนเจอ 1 Branch เท่านั้น)
      setAddTaxInvoiceDistinctBranches(distinctBranches); // MARKER_VATWATCHLISTOPS_BRANDCODE_MULTIBRANCH_MATCHING_V1 -- เก็บไว้ใช้กับ Popup เลือก Branch
      const distinctSuppliers = [...new Set(rows.map((r) => String(r.supplier_code || '').trim()).filter(Boolean))]; // MARKER_VATWATCHLISTOPS_SUPPLIER_DATA_LOOKUP_V1 -- ใช้ rows ตัวเดียวกับ Branch ไม่ต้อง Filter ซ้ำ
      setAddTaxInvoiceSupplierCode(distinctSuppliers.length > 0 ? distinctSuppliers[0] : ''); // MARKER_VATWATCHLISTOPS_SUPPLIER_DATA_LOOKUP_V1 -- Auto Fill Supplier แรกที่เจอเสมอ
      setAddTaxInvoiceDistinctSuppliers(distinctSuppliers); // MARKER_VATWATCHLISTOPS_SUPPLIER_DATA_LOOKUP_V1
      return;
    }
    setAddTaxInvoiceDistinctBranches([]); // MARKER_VATWATCHLISTOPS_BRANDCODE_MULTIBRANCH_MATCHING_V1 -- มี No. แล้ว ไม่ใช่กรณีหลาย Branch จาก Search อีกต่อไป
    setAddTaxInvoiceDistinctSuppliers([]); // MARKER_VATWATCHLISTOPS_SUPPLIER_DATA_LOOKUP_V1
    const taxIdVal = String(addTaxInvoiceTaxId || '').trim();
    const match = addTaxInvoiceBranchListData.find((b) => {
      const statusVal = String(b.status || '').trim().toLowerCase();
      if (statusVal === 'closed' || statusVal === 'relocate') return false;
      return String(b['BU-TaxID'] || '').trim() === taxIdVal && String(b['BU-Branch'] || '').trim() === noVal;
    });
    setAddTaxInvoiceBrandCode(match ? (match['Branch Code'] || '') : '');
  }, [addTaxInvoiceBranchNo, addTaxInvoiceTaxId, addTaxInvoiceBranchListData, detailSearch, fullPagePopvatRows]); // MARKER_VATWATCHLISTOPS_FIX_AUTODETECT_DEPS_ARRAY_V1 -- แก้ Dependency ให้ตรงกับตัวแปรที่ใช้จริงในเนื้อ Effect (เดิมยังเป็น detailRows ค้างอยู่)
  const stripBlacklistedSearchWords = (text) => { // MARKER_VATWATCHLISTOPS_SEARCH_BLACKLIST_WORDS_V1 -- ตัดคำใน SEARCH_IGNORED_WORDS ออกจากข้อความ แล้วเก็บ Comma/เว้นวรรค คั่นคำอื่นไว้ตามเดิม
    return text
      .split(/([,\s]+)/) // แยกเก็บตัวคั่นไว้ด้วย เพื่อ Join กลับได้ครบ
      .filter((token) => !SEARCH_IGNORED_WORDS.includes(token.trim().toLowerCase()))
      .join('')
      .replace(/[,\s]{2,}/g, ','); // MARKER_VATWATCHLISTOPS_BLACKLIST_KEEP_TRAILING_COMMA_V1 -- ยุบตัวคั่นซ้ำซ้อนกลางข้อความเท่านั้น (ไม่ตัดหัว-ท้าย กันพิมพ์ Comma ต่อท้ายไม่ได้)
  };
  const [detailSearchDebounced, setDetailSearchDebounced] = React.useState('');
  const [fullPagePopvatSearchLoading, setFullPagePopvatSearchLoading] = React.useState(false);
  React.useEffect(() => { // MARKER_VATWATCHLISTOPS_FULLPAGE_SEARCH_BACKEND_V1 -- Search Full Page - Popvat จาก Backend อัตโนมัติตาม detailSearchDebounced
    if (!showFullPagePopvat) return;
    const q = detailSearchDebounced.trim();
    if (!q && selectedNoteRows.size === 0) { setFullPagePopvatRows([]); return; } // MARKER_VATWATCHLISTOPS_FULLPAGE_SHOW_SELECTED_ONLY_V1 -- ไม่มี Search และไม่มี Select เลย ไม่ต้องโหลดอะไร
    setFullPagePopvatSearchLoading(true);
    const params = new URLSearchParams();
    if (bu?.bu) params.set('eq_bu', bu.bu);
    params.set('eq_status', 'pending');
    if (q) { // MARKER_VATWATCHLISTOPS_FULLPAGE_SHOW_SELECTED_ONLY_V1 -- ถ้ามี Select อยู่แล้วแต่ไม่ได้พิมพ์ Search ไว้ ให้ดึงมาก่อนกว้างๆ แล้วค่อยกรองเฉพาะที่ Select ทีหลัง
      params.set('search', q);
      params.set('search_cols', 'invoice_ref,receive_doc_no,vendor_name,check_no,branch');
    }
    params.set('limit', '500');
    apiFetch(`/vat_watchlist_report?${params.toString()}`)
      .then((res) => {
        const rows = Array.isArray(res) ? res : [];
        const filteredRows = selectedNoteRows.size > 0 ? rows.filter((r) => selectedNoteRows.has(getNoteKey(r))) : rows; // MARKER_VATWATCHLISTOPS_FULLPAGE_SHOW_SELECTED_ONLY_V1 -- มี Select ไว้ก่อนเปิด Full Page -> โชว์เฉพาะรายการที่ Select เท่านั้น
        setFullPagePopvatRows(filteredRows);
      })
      .catch((err) => { console.error('fullPagePopvatRows fetch error:', err); setFullPagePopvatRows([]); })
      .finally(() => setFullPagePopvatSearchLoading(false));
  }, [showFullPagePopvat, detailSearchDebounced, bu?.bu, selectedNoteRows, detailReloadKey]); // MARKER_VATWATCHLISTOPS_FULLPAGE_REFRESH_AFTER_RESTORE_V1 -- เพิ่ม detailReloadKey ให้ Fetch ใหม่หลัง Restore (เดิมไม่ Refresh List ของ Full Page หลัง Restore)
  // MARKER_VATWATCHLISTOPS_DETAIL_TYPE_AGING_TOOLBAR_V1
  // MARKER_VATWATCHLISTOPS_TYPE_SUBTYPE_TREE_V1 — Type ▸ Subtype Tree Checkbox (แทน Dropdown 2 ตัวเดิม)
  const [typeTree, setTypeTree] = React.useState([]); // [{ type, count, subtypes: [{ subtype, count }] }]
  const [selectedSubtypeKeys, setSelectedSubtypeKeys] = React.useState(() => new Set()); // Set('type|||subtype')
  const [typeDropdownOpen, setTypeDropdownOpen] = React.useState(false);
  const typeDropdownRef = React.useRef(null); // MARKER_VATWATCHLISTOPS_TYPE_DROPDOWN_CLICK_OUTSIDE_V1
  const typeDropdownRefFullPage = React.useRef(null); // MARKER_VATWATCHLISTOPS_FULLPAGE_POPVAT_SHARED_FILTER_V1 -- Ref แยกสำหรับ Type Dropdown ตัวที่อยู่ใน Full Page
  const [focusedTypeIndex, setFocusedTypeIndex] = React.useState(-1); // MARKER_VATWATCHLISTOPS_TYPE_DROPDOWN_KEYBOARD_V1
  const [expandedTypes, setExpandedTypes] = React.useState({});
  const [selectedAgingBuckets, setSelectedAgingBuckets] = React.useState(() => new Set());
  const [agingBucketCounts, setAgingBucketCounts] = React.useState({}); // MARKER_VATWATCHLISTOPS_AGING_BUTTON_COUNTS_V1

  const toggleExpandType = (t) => setExpandedTypes((prev) => ({ ...prev, [t]: !prev[t] }));

  const subtypeKeysOfType = (typeNode) =>
    typeNode.subtypes.length > 0
      ? typeNode.subtypes.map((s) => `${typeNode.type}|||${s.subtype}`)
      : [`${typeNode.type}|||`];

  const typeCheckState = (typeNode) => {
    const keys = subtypeKeysOfType(typeNode);
    const n = keys.filter((k) => selectedSubtypeKeys.has(k)).length;
    if (n === 0) return 'none';
    if (n === keys.length) return 'all';
    return 'partial';
  };

  const toggleType = (typeNode) => {
    setShowDetailMode('all'); // MARKER_VATWATCHLISTOPS_FILTER_RESET_SHOWDETAIL_ALL_V1 -- กด Filter ต้องเห็นผลลัพธ์ตามที่ Filter จริงๆ เลยดึงกลับมา All เสมอ ไม่ให้ Show/Hide บัง
    const keys = subtypeKeysOfType(typeNode);
    setSelectedSubtypeKeys((prev) => {
      const next = new Set(prev);
      const allSelected = keys.every((k) => next.has(k));
      if (allSelected) keys.forEach((k) => next.delete(k));
      else keys.forEach((k) => next.add(k));
      return next;
    });
  };

  const toggleSubtype = (type, subtype) => {
    setShowDetailMode('all'); // MARKER_VATWATCHLISTOPS_FILTER_RESET_SHOWDETAIL_ALL_V1
    const key = `${type}|||${subtype}`;
    setSelectedSubtypeKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const clearTypeSubtypeFilter = () => setSelectedSubtypeKeys(new Set());


  // MARKER_VATWATCHLISTOPS_TYPE_DROPDOWN_KEYBOARD_V1 — Flat List ของแถวที่ Navigate ได้ตอนนี้
  const typeDropdownFlatRows = React.useMemo(() => {
    const rows = [];
    typeTree.forEach((typeNode) => {
      rows.push({ kind: 'type', typeNode });
      if (typeNode.subtypes.length > 1 && expandedTypes[typeNode.type]) {
        typeNode.subtypes.forEach((s) => rows.push({ kind: 'subtype', typeNode, subtype: s }));
      }
    });
    return rows;
  }, [typeTree, expandedTypes]);

  React.useEffect(() => {
    if (!typeDropdownOpen) return;
    const handleArrowKeys = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedTypeIndex((i) => Math.min(i + 1, typeDropdownFlatRows.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedTypeIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const row = typeDropdownFlatRows[focusedTypeIndex];
        if (!row) return;
        if (row.kind === 'type') toggleType(row.typeNode);
        else toggleSubtype(row.typeNode.type, row.subtype.subtype);
      }
    };
    window.addEventListener('keydown', handleArrowKeys);
    return () => window.removeEventListener('keydown', handleArrowKeys);
  }, [typeDropdownOpen, typeDropdownFlatRows, focusedTypeIndex]);
  const AGING_BUCKETS = [
    { key: 'expired', label: 'Expired', bg: '#F1EFE8', color: '#444441' },
    { key: '6-5', label: '6-5', bg: '#FAEEDA', color: '#854F0B' },
    { key: '4-3', label: '4-3', bg: '#FEF9E4', color: '#8A6D06' },
    { key: '2-1', label: '2-1', bg: '#EAF3DE', color: '#27500A' },
    { key: '0', label: '0', bg: '#E6F1FB', color: '#0C447C' },
    { key: 'uncount', label: 'Uncount', bg: '#F0F0F0', color: '#777777' }, // MARKER_VATWATCHLISTOPS_AGING_UNCOUNT_BUTTON_V1
  ];
  const toggleAgingBucket = (key) => {
    setShowDetailMode('all'); // MARKER_VATWATCHLISTOPS_FILTER_RESET_SHOWDETAIL_ALL_V1
    setSelectedAgingBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
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
  // MARKER_VATWATCHLISTOPS_NOTES_IMAGE_V1
  const [noteDraftImageIds, setNoteDraftImageIds] = React.useState([]); // Array ของ fileId (file_storage) ที่แนบใน Note นี้
  const [noteImageUploading, setNoteImageUploading] = React.useState(false);
  const [noteImagePreviewUrls, setNoteImagePreviewUrls] = React.useState({}); // { [fileId]: blobUrl }
  const [noteImageRefId, setNoteImageRefId] = React.useState(''); // refId คงที่ต่อ Session เปิด Modal (single = Key ของ Invoice, group = สุ่มใหม่)
  const noteImageInputRef = React.useRef(null);
  const getNoteKey = (row) => `${row.invoice_ref || ''}|${row.supplier_code || ''}`;
  // MARKER_VATWATCHLISTOPS_SHOW_DETAIL_FILTER_V1
  const displayDetailRows = React.useMemo(() => {
    if (showDetailMode === 'all') return detailRows;
    return detailRows.filter((r) => {
      const isUncountAging = r.aging_label === 'IV-Aging Uncount';
      const noteEntry = noteMap[getNoteKey(r)];
      const isIssue = !!(noteEntry && noteEntry.remark === 'Issue');
      const isHiddenCategory = isUncountAging || isIssue;
      return showDetailMode === 'hide' ? isHiddenCategory : !isHiddenCategory;
    });
  }, [detailRows, showDetailMode, noteMap]); // MARKER_VATWATCHLISTOPS_SHOW_DETAIL_FILTER_V1
  React.useEffect(() => { // MARKER_VATWATCHLISTOPS_SUPPLIER_DRCR_REQUIRE_DETAIL_V1 -- Account Dr./Cr. คำนวณจาก Classify tax_type เสมอ (เหมือน ADI เปะ) แต่ต้องมี Supplier Detail จริงก่อนถึงจะขึ้น (ไม่ใช้ค่า Account_Dr/Account_Cr ที่ Config ไว้ แต่ยังใช้เช็คว่ามี Record Supplier นี้อยู่จริงไหม) -- ย้ายมาไว้หลัง fullPagePopvatRows/getNoteKey กัน Temporal Dead Zone
    const matchedSupplierForAcctFP = addTaxInvoiceSmCodeListData.find((s) => String(s['Supplier Code'] || '').trim() === String(addTaxInvoiceSupplierCode || '').trim());
    if (!matchedSupplierForAcctFP) { // MARKER_VATWATCHLISTOPS_SUPPLIER_DRCR_REQUIRE_DETAIL_V1 -- ไม่มี Supplier Detail เลย -> ปล่อยว่าง ไม่ต้องคำนวณ
      setAddTaxInvoiceSupplierCpcDr(''); setAddTaxInvoiceSupplierAccountDr(''); setAddTaxInvoiceSupplierSubDr('');
      setAddTaxInvoiceSupplierCpcCr(''); setAddTaxInvoiceSupplierAccountCr(''); setAddTaxInvoiceSupplierSubCr('');
      return;
    }
    const relevantRowsForAcctFP = selectedFullPageInvoices.size > 0
      ? fullPagePopvatRows.filter((r) => selectedFullPageInvoices.has(getNoteKey(r)))
      : fullPagePopvatRows;
    const isAssetForAcctFP = relevantRowsForAcctFP.some((r) => { const c = classifyVatWatchlistTaxType(r.tax_type); return c && (c.cls === 'T' || c.cls === 'F'); });
    const isMForAcctFP = !isAssetForAcctFP && relevantRowsForAcctFP.some((r) => { const c = classifyVatWatchlistTaxType(r.tax_type); return c && c.cls === 'M'; });
    const accDrFP = isAssetForAcctFP ? '11610755' : (isMForAcctFP ? '11610751' : '11610752');
    const accCrFP = isAssetForAcctFP ? '11630055' : (isMForAcctFP ? '11630051' : '11630052');
    setAddTaxInvoiceSupplierCpcDr('99999');
    setAddTaxInvoiceSupplierAccountDr(accDrFP);
    setAddTaxInvoiceSupplierSubDr('999999');
    setAddTaxInvoiceSupplierCpcCr('99999');
    setAddTaxInvoiceSupplierAccountCr(accCrFP);
    setAddTaxInvoiceSupplierSubCr('999999');
  }, [addTaxInvoiceSupplierCode, addTaxInvoiceSmCodeListData, fullPagePopvatRows, selectedFullPageInvoices]);

  // MARKER_VATWATCHLISTOPS_NOTES_IMAGE_V1
  // ── โหลด Preview Blob URL แบบ Lazy เฉพาะ fileId ที่ยังไม่เคยโหลด ──
  React.useEffect(() => {
    let active = true;
    (async () => {
      const missing = noteDraftImageIds.filter((id) => !noteImagePreviewUrls[id]);
      if (missing.length === 0) return;
      const entries = await Promise.all(missing.map(async (id) => {
        try { return [id, await fetchVatNoteImageBlobUrl(id)]; } catch (err) { console.error('load note image error:', err); return [id, null]; }
      }));
      if (!active) return;
      setNoteImagePreviewUrls((prev) => {
        const next = { ...prev };
        entries.forEach(([id, url]) => { if (url) next[id] = url; });
        return next;
      });
    })();
    return () => { active = false; };
  }, [noteDraftImageIds]);
  const [noteDraftRemark, setNoteDraftRemark] = React.useState(''); // MARKER_VATWATCHLISTOPS_NOTES_REMARK_V1
  const [noteDraftCheckNo, setNoteDraftCheckNo] = React.useState(''); // MARKER_VATWATCHLISTOPS_NOTES_REMARK_DROPDOWN_V1
  const [checkTotalInfo, setCheckTotalInfo] = React.useState(null); // MARKER_VATWATCHLISTOPS_NOTES_CHECK_TOTAL_V1 -- {count, amount, vat} | null
  const NOTE_REMARK_OPTIONS = ['Check Return', 'Check On Hand', 'Issue']; // MARKER_VATWATCHLISTOPS_NOTES_REMARK_DROPDOWN_V1
  const [noteTrackMode, setNoteTrackMode] = React.useState('single'); // MARKER_VATWATCHLISTOPS_NOTES_TRACK_BY_CHECK_V1 -- 'single' | 'all_check'
  const [noteModalGroupTargets, setNoteModalGroupTargets] = React.useState(null); // MARKER_VATWATCHLISTOPS_GROUP_NOTE_SELECT_V1 -- array ของแถวที่เลือกไว้ ตอนเปิด Modal แบบ Group
  const [rowContextMenu, setRowContextMenu] = React.useState(null); // MARKER_VATWATCHLISTOPS_ROW_CONTEXT_MENU_V1 -- { x, y, row } | null
  const detailTbodyRef = React.useRef(null); // MARKER_VATWATCHLISTOPS_DRAG_RANGE_SELECT_V1 -- ใช้หา <tr> ที่อยู่ในช่วง Drag-select ข้อความ
  const dragCheckboxModeRef = React.useRef(null); // MARKER_VATWATCHLISTOPS_CHECKBOX_DRAG_SELECT_V1 -- 'add' | 'remove' | null ระหว่างลากติ๊ก Checkbox
  const lastClickedRowKeyRef = React.useRef(null); // MARKER_VATWATCHLISTOPS_CHECKBOX_SHIFT_RANGE_SELECT_V1 -- Anchor สำหรับ Shift+Click เลือกเป็นช่วง
  const [showQuickAction, setShowQuickAction] = React.useState(false); // MARKER_VATWATCHLISTOPS_QUICK_ACTION_V1
  const [quickActionRows, setQuickActionRows] = React.useState([]);
  const [quickActionVendor, setQuickActionVendor] = React.useState(null); // { vendor_name, supplier_code, tax_id, branch_no }
  const [quickActionReceiveDate, setQuickActionReceiveDate] = React.useState('');
  const [quickActionGrtPrefix, setQuickActionGrtPrefix] = React.useState(''); // MARKER_VATWATCHLISTOPS_QUICK_ACTION_GRT_AUTOGEN_V1
  const [quickActionGrtDigitCount, setQuickActionGrtDigitCount] = React.useState(4);
  const [quickActionGrtRunning, setQuickActionGrtRunning] = React.useState('');
  const [quickActionVatGrnOverride, setQuickActionVatGrnOverride] = React.useState(null); // MARKER_VATWATCHLISTOPS_VAT_GRN_REALTIME_V2 -- เก็บค่า vat_grn ล่าสุดไว้เอง กัน bu Prop ค้างเลขเก่า + Sync ข้าม Session
  const [quickActionGrtControl, setQuickActionGrtControl] = React.useState('Auto');
  const [quickActionPeriodMonth, setQuickActionPeriodMonth] = React.useState(null); // MARKER_VATWATCHLISTOPS_QUICK_ACTION_BOOK_PERIOD_V2 -- Effective Period 'YYYY-MM' เก็บไว้ใช้ตอน Save
  const formatQuickActionPeriodMMYYYY = (ym) => { // 'YYYY-MM' -> 'MM-YYYY'
    if (!ym) return null;
    const [y, m] = ym.split('-');
    return `${m}-${y}`;
  };
  const [quickActionTaxInvoiceDate, setQuickActionTaxInvoiceDate] = React.useState('');
  const [quickActionTaxInvoiceNumber, setQuickActionTaxInvoiceNumber] = React.useState('');
  const [quickActionSaving, setQuickActionSaving] = React.useState(false);
  const [quickActionCancelReason, setQuickActionCancelReason] = React.useState('Cancel'); // MARKER_VATWATCHLISTOPS_QUICK_ACTION_CANCEL_REASON_V1 -- Cancel / Simple_NNN / Simple_YNY
  const openNoteModal = (row) => {
    const key = getNoteKey(row);
    const entry = noteMap[key];
    setNoteDraftText((entry && entry.note) || '');
    setNoteDraftAccept(!!(entry && entry.status === 'accept_with_condition'));
    setNoteDraftRemark((entry && entry.remark) || '');
    setNoteDraftCheckNo((entry && entry.check_no) || '');
    setNoteTrackMode('single'); // MARKER_VATWATCHLISTOPS_NOTES_TRACK_BY_CHECK_V1
    setCheckTotalInfo(null); // MARKER_VATWATCHLISTOPS_NOTES_CHECK_TOTAL_V1
    setNoteDraftImageIds((entry && Array.isArray(entry.image_ids)) ? entry.image_ids : []); // MARKER_VATWATCHLISTOPS_NOTES_IMAGE_V1
    setNoteImageRefId(key);
    setNoteModalRow(row);
  };

  // MARKER_VATWATCHLISTOPS_GROUP_NOTE_SELECT_V1
  // ── Checkbox เลือกแถว (จำข้าม Page ได้ เพราะเก็บเป็น Map แยกจาก Row ที่แสดงผล) ──
  const toggleSelectNoteRow = (row) => { // MARKER_VATWATCHLISTOPS_GROUP_NOTE_TABLE_SUMMARY_V1 -- เก็บ Field เพิ่มไว้โชว์สรุปในตาราง Group Note
    const key = getNoteKey(row);
    setSelectedNoteRows((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else next.set(key, { invoice_ref: row.invoice_ref, supplier_code: row.supplier_code, branch: row.branch, vendor_name: row.vendor_name, check_no: row.check_no, exp_amount: row.exp_amount, exp_vat: row.exp_vat, receive_doc_no: row.receive_doc_no, payment_date: row.payment_date }); // MARKER_VATWATCHLISTOPS_QUICK_ACTION_FIX_TARGETS_V1
      return next;
    });
  };
  const toggleSelectAllOnPage = () => {
    setSelectedNoteRows((prev) => {
      const next = new Map(prev);
      const allSelected = detailRows.length > 0 && detailRows.every((r) => next.has(getNoteKey(r)));
      if (allSelected) {
        detailRows.forEach((r) => next.delete(getNoteKey(r)));
      } else {
        detailRows.forEach((r) => next.set(getNoteKey(r), { invoice_ref: r.invoice_ref, supplier_code: r.supplier_code, branch: r.branch, vendor_name: r.vendor_name, check_no: r.check_no, exp_amount: r.exp_amount, exp_vat: r.exp_vat, receive_doc_no: r.receive_doc_no, payment_date: r.payment_date })); // MARKER_VATWATCHLISTOPS_QUICK_ACTION_FIX_TARGETS_V1
      }
      return next;
    });
  };
  const clearSelectedNoteRows = () => setSelectedNoteRows(new Map());
  // MARKER_VATWATCHLISTOPS_EXPORT_TEMPLATES_V1 -- Modal "Config - Columns Incomplete" เลือก Template ก่อน Export
  const [showExportConfigModal, setShowExportConfigModal] = React.useState(false);
  const [exportTemplates, setExportTemplates] = React.useState([]);
  const [selectedExportTemplateId, setSelectedExportTemplateId] = React.useState('__builtin__');
  const openExportConfigModal = () => {
    setSelectedExportTemplateId('__builtin__');
    setShowExportConfigModal(true);
    apiFetch('/vat_incomplete_export_templates').then((res) => setExportTemplates(Array.isArray(res) ? res : [])).catch(() => setExportTemplates([]));
  };
  const handleExportExcelFromConfig = async () => { // MARKER_VATWATCHLISTOPS_EXPORT_EXCELJS_STYLING_V1 -- เปลี่ยนเป็น exceljs รองรับสีหัว/Autofit/Freeze
    let targets = selectedNoteRows.size > 0 ? detailRows.filter((r) => selectedNoteRows.has(getNoteKey(r))) : detailRows; // MARKER_VATWATCHLISTOPS_EXPORT_FALLBACK_ALL_FILTERED_V1 -- ไม่ติ๊กเลย -> Export ทั้งหมดที่ Filter/Search ได้แทน
    if (selectedExportTemplateId === '__expire_check_payment__') { // MARKER_VATWATCHLISTOPS_EXPIRE_CHECK_PAYMENT_TEMPLATE_V1 -- Filter เฉพาะ Aging=Expired + เลขที่เช็คมี -CHECK
      targets = targets.filter((r) => r.aging_label === 'Expired' && String(r.check_no || '').includes('-CHECK'));
    }
    if (targets.length === 0) { alert('ไม่มีข้อมูลให้ Export (ลองปรับ Filter หรือ Search ใหม่)'); return; } // MARKER_VATWATCHLISTOPS_EXPORT_FALLBACK_ALL_FILTERED_V1
    let cols;
    if (selectedExportTemplateId === '__builtin__') {
      cols = activeCols.map((c) => ({ key: c.key, label: c.label, is_custom: false }));
    } else if (selectedExportTemplateId === '__expire_check_payment__') { // MARKER_VATWATCHLISTOPS_EXPIRE_CHECK_PAYMENT_TEMPLATE_V1
      cols = EXPIRE_CHECK_PAYMENT_COLS;
    } else {
      const tpl = exportTemplates.find((t) => String(t.id) === String(selectedExportTemplateId));
      cols = (tpl && Array.isArray(tpl.columns)) ? tpl.columns : [];
    }
    if (cols.length === 0) { alert('Template นี้ไม่มี Column เลย'); return; }
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Incomplete');
    worksheet.columns = cols.map((c) => ({ header: c.label, key: c.key, width: 12 }));
    targets.forEach((row) => {
      const rowData = {};
      cols.forEach((c) => {
        if (c.is_custom) { rowData[c.key] = c.default_value || ''; return; }
        const val = row[c.key];
        if (VAT_INCOMPLETE_DATE_KEYS.has(c.key)) { // MARKER_VATWATCHLISTOPS_EXPORT_REAL_DATE_FORMAT_V1 -- เขียน Date Object จริง แทน String Format แล้ว
          const d = val ? new Date(val) : null;
          rowData[c.key] = (d && !isNaN(d.getTime())) ? d : '';
        } else if (VAT_INCOMPLETE_NUMBER_KEYS.has(c.key)) { // MARKER_VATWATCHLISTOPS_EXPORT_NUMBER_FORMAT_V1 -- เขียน Number Type จริง แทน String ดิบจาก API
          const n = val == null || val === '' ? null : Number(val);
          rowData[c.key] = (n != null && !isNaN(n)) ? n : '';
        } else {
          rowData[c.key] = val == null ? '' : val;
        }
      });
      worksheet.addRow(rowData);
    });
    cols.forEach((c) => { // MARKER_VATWATCHLISTOPS_EXPORT_REAL_DATE_FORMAT_V1 -- ตั้ง numFmt ให้ Column วันที่ แสดงผลแบบ dd-mmm-yy เหมือนหน้าจอ แต่เป็น Date Type จริง
      if (VAT_INCOMPLETE_DATE_KEYS.has(c.key)) worksheet.getColumn(c.key).numFmt = 'dd-mmm-yy';
      if (VAT_INCOMPLETE_NUMBER_KEYS.has(c.key)) worksheet.getColumn(c.key).numFmt = '#,##0.00'; // MARKER_VATWATCHLISTOPS_EXPORT_NUMBER_FORMAT_V1 -- Comma คั่นหลักพัน + ทศนิยม 2 ตำแหน่ง
    });
    if (selectedExportTemplateId === '__expire_check_payment__' && cols.some((c) => c.key === 'remark')) { // MARKER_VATWATCHLISTOPS_EXPIRE_CHECK_PAYMENT_TEMPLATE_V1 -- Dropdown ให้ Column Remark
      const remarkColLetter = worksheet.getColumn('remark').letter;
      for (let i = 2; i <= targets.length + 1; i++) {
        worksheet.getCell(`${remarkColLetter}${i}`).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [`"${NOTE_REMARK_OPTIONS.join(',')}"`],
        };
      }
    }
    // MARKER_VATWATCHLISTOPS_EXPORT_EXCELJS_STYLING_V1 -- 1) สีหัว Columns
    worksheet.getRow(1).eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A5C' } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
      cell.alignment = { vertical: 'middle' };
    });
    // MARKER_VATWATCHLISTOPS_EXPORT_EXCELJS_STYLING_V1 -- 2) Autofit Width ตามความยาวข้อความจริง
    worksheet.columns.forEach((col) => {
      let maxLen = col.header ? col.header.toString().length : 10;
      col.eachCell({ includeEmpty: true }, (cell) => { // MARKER_VATWATCHLISTOPS_EXPORT_AUTOFIT_DATE_NUMBER_FIX_V1 -- คำนวณจากค่าที่แสดงผลจริง ไม่ใช่ .toString() ดิบของ Date/Number
        let displayStr = '';
        if (cell.value instanceof Date) {
          displayStr = formatVatIncompleteDate(cell.value);
        } else if (typeof cell.value === 'number') {
          displayStr = cell.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        } else if (cell.value) {
          displayStr = cell.value.toString();
        }
        const len = displayStr.length;
        if (len > maxLen) maxLen = len;
      });
      col.width = Math.min(maxLen + 2, 50);
    });
    // MARKER_VATWATCHLISTOPS_EXPORT_EXCELJS_STYLING_V1 -- 3) Freeze Row 2 (Freeze แถวหัวไว้ด้านบน)
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const yyyymmdd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const hhmmss = `${String(now.getHours()).padStart(2, '0')}.${String(now.getMinutes()).padStart(2, '0')}.${String(now.getSeconds()).padStart(2, '0')}`;
    const filename = `${bu?.bu || 'BU'}_IncompleteCustomlist_${yyyymmdd}_${hhmmss}.xlsx`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowExportConfigModal(false);
  };
  // MARKER_VATWATCHLISTOPS_EXPORT_TEMPLATES_V1 -- Modal "Config New - Template" สร้าง Template ใหม่
  const [showConfigNewTemplateModal, setShowConfigNewTemplateModal] = React.useState(false);
  const [newTemplateName, setNewTemplateName] = React.useState('');
  const [newTemplateExistingCols, setNewTemplateExistingCols] = React.useState(() => new Set());
  const [newTemplateCustomCols, setNewTemplateCustomCols] = React.useState([]);
  const openConfigNewTemplateModal = () => {
    setNewTemplateName('');
    setNewTemplateExistingCols(new Set(visibleColumns));
    setNewTemplateCustomCols([]);
    setShowConfigNewTemplateModal(true);
  };
  const toggleNewTemplateExistingCol = (key) => {
    setNewTemplateExistingCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const addNewTemplateCustomCol = () => setNewTemplateCustomCols((prev) => [...prev, { name: '', defaultValue: '' }]);
  const updateNewTemplateCustomCol = (idx, field, value) => setNewTemplateCustomCols((prev) => prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c)));
  const removeNewTemplateCustomCol = (idx) => setNewTemplateCustomCols((prev) => prev.filter((_, i) => i !== idx));
  const handleSaveNewTemplate = async () => {
    if (!newTemplateName.trim()) { alert('กรุณาใส่ชื่อ Template'); return; }
    const existingColsPayload = VAT_INCOMPLETE_ALL_FIELDS.filter((f) => newTemplateExistingCols.has(f.key)).map((f) => ({ key: f.key, label: f.label, is_custom: false }));
    const customColsPayload = newTemplateCustomCols.filter((c) => c.name.trim()).map((c, i) => ({ key: `custom_${Date.now()}_${i}`, label: c.name.trim(), is_custom: true, default_value: c.defaultValue || '' }));
    const allCols = [...existingColsPayload, ...customColsPayload];
    if (allCols.length === 0) { alert('กรุณาเลือกอย่างน้อย 1 Column'); return; }
    try {
      const saved = await apiFetch('/vat_incomplete_export_templates', { method: 'POST', body: JSON.stringify({ name: newTemplateName.trim(), columns: allCols, created_by: username }) });
      setExportTemplates((prev) => [...prev, saved]);
      if (saved && saved.id != null) setSelectedExportTemplateId(String(saved.id));
      setShowConfigNewTemplateModal(false);
    } catch (err) {
      console.error('handleSaveNewTemplate error:', err);
      alert('บันทึก Template ไม่สำเร็จ กรุณาลองใหม่');
    }
  };
  // MARKER_VATWATCHLISTOPS_EXPORT_EXCEL_V1 -- Export แถวที่เลือกไว้เป็น Excel (เฉพาะ Column ที่โชว์อยู่ตอนนี้)
  const handleExportExcelSelected = () => {
    const targets = detailRows.filter((r) => selectedNoteRows.has(getNoteKey(r)));
    if (targets.length === 0) return;
    const headers = activeCols.map((c) => c.label);
    const rows = targets.map((row) => activeCols.map((c) => {
      const val = row[c.key];
      if (VAT_INCOMPLETE_DATE_KEYS.has(c.key)) return formatVatIncompleteDate(val);
      return val == null ? '' : val;
    }));
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Incomplete');
    const now = new Date();
    const yyyymmdd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const hhmmss = `${String(now.getHours()).padStart(2, '0')}.${String(now.getMinutes()).padStart(2, '0')}.${String(now.getSeconds()).padStart(2, '0')}`;
    const filename = `${bu?.bu || 'BU'}_IncompleteCustomlist_${yyyymmdd}_${hhmmss}.xlsx`;
    XLSX.writeFile(wb, filename);
  };
  // MARKER_VATWATCHLISTOPS_ROW_CONTEXT_MENU_V1
  // -- เมนูคลิกขวา แทนปุ่ม Group Note/ล้างการเลือก/note เดิม (ลดปุ่มบนตาราง) --
  const openRowContextMenu = (e, row) => setRowContextMenu({ x: e.clientX, y: e.clientY, row });
  const closeRowContextMenu = () => setRowContextMenu(null);
  React.useEffect(() => {
    if (!rowContextMenu) return;
    const handleClose = () => setRowContextMenu(null);
    const handleKey = (e) => { if (e.key === 'Escape') setRowContextMenu(null); };
    window.addEventListener('click', handleClose);
    window.addEventListener('scroll', handleClose, true);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('click', handleClose);
      window.removeEventListener('scroll', handleClose, true);
      window.removeEventListener('keydown', handleKey);
    };
  }, [rowContextMenu]);
  // MARKER_VATWATCHLISTOPS_CHECKBOX_DRAG_SELECT_V1
  // -- ปล่อยเมาส์ที่ไหนก็ได้ -> หยุดโหมดลากติ๊ก Checkbox ทันที --
  React.useEffect(() => {
    const handleUp = () => { dragCheckboxModeRef.current = null; };
    window.addEventListener('mouseup', handleUp);
    return () => window.removeEventListener('mouseup', handleUp);
  }, []);
  // MARKER_VATWATCHLISTOPS_DRAG_RANGE_SELECT_V1
  // -- Drag(ลาก)เลือกข้อความคร่อมหลายแถว -> แปลงเป็นเลือกแถว(Checkbox)ทั้งช่วงแทน --
  // MARKER_VATWATCHLISTOPS_TEXT_SELECTION_AUTO_CHECK_V1 -- ดึง Logic ออกมาเป็นฟังก์ชันแยก ใช้ได้ทั้งตอนปล่อยเมาส์ (Auto) และตอนคลิกขวา (เดิม)
  const applyTextSelectionToCheckboxes = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.toString().trim().length === 0 || !detailTbodyRef.current) return false;
    const range = sel.getRangeAt(0);
    const trEls = detailTbodyRef.current.querySelectorAll('tr[data-row-key]');
    const keysInRange = [];
    trEls.forEach((trEl) => { if (range.intersectsNode(trEl)) keysInRange.push(trEl.getAttribute('data-row-key')); });
    if (keysInRange.length <= 1) return false;
    const nextMap = new Map();
    keysInRange.forEach((key) => {
      const r = detailRows.find((dr) => getNoteKey(dr) === key);
      if (r) nextMap.set(key, { invoice_ref: r.invoice_ref, supplier_code: r.supplier_code, branch: r.branch, vendor_name: r.vendor_name, check_no: r.check_no, exp_amount: r.exp_amount, exp_vat: r.exp_vat, receive_doc_no: r.receive_doc_no, payment_date: r.payment_date }); // MARKER_VATWATCHLISTOPS_QUICK_ACTION_FIX_TARGETS_V1
    });
    setSelectedNoteRows(nextMap);
    return true;
  };
  // MARKER_VATWATCHLISTOPS_TEXT_SELECTION_AUTO_CHECK_V1 -- ปล่อยเมาส์ที่ไหนก็ได้ในตาราง -> เช็คว่ามีลากคลุมข้อความข้ามแถวไหม ถ้าใช่ Auto ติ๊กทันที
  const handleDetailTbodyMouseUp = () => { applyTextSelectionToCheckboxes(); };
  const handleRowContextMenu = (e, row) => {
    if (e.target.closest('input, button, a')) return;
    e.preventDefault();
    const applied = applyTextSelectionToCheckboxes(); // MARKER_VATWATCHLISTOPS_TEXT_SELECTION_AUTO_CHECK_V1 -- เผื่อกรณี Select ค้างไว้แล้วเพิ่งมาคลิกขวา (ปกติ Auto ไปแล้วตอนปล่อยเมาส์)
    if (applied) window.getSelection()?.removeAllRanges();
    openRowContextMenu(e, row);
  };
  // MARKER_VATWATCHLISTOPS_QUICK_ACTION_V1
  // -- เปิด Modal Quick Action: ใช้ selectedNoteRows ถ้ามีเลือกไว้ (Group) ไม่งั้นใช้แค่แถวที่คลิกขวา --
  // MARKER_VATWATCHLISTOPS_QUICK_ACTION_GRT_SYNC_V1
  const QUICK_ACTION_MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const formatQuickActionReceiveDateText = (isoDateStr) => { // 'YYYY-MM-DD' -> 'DD-MMM-YY'
    if (!isoDateStr) return null;
    const parts = String(isoDateStr).split('-');
    if (parts.length !== 3) return isoDateStr;
    const [y, m, d] = parts;
    const monthAbbr = QUICK_ACTION_MONTH_ABBR[parseInt(m, 10) - 1] || m;
    return `${d}-${monthAbbr}-${y.slice(-2)}`;
  };
  const generateQuickActionDraftId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  function getDefaultQuickActionReceiveDate(currentPeriodMonth) {
    const now = new Date();
    const todayYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (!currentPeriodMonth || todayYm === currentPeriodMonth) {
      return todayYm + '-' + String(now.getDate()).padStart(2, '0');
    }
    const [y, m] = currentPeriodMonth.split('-').map(Number);
    const lastDay = new Date(y, m, 0);
    return `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;
  }
  // MARKER_VATWATCHLISTOPS_ADDTAXINVOICE_GRT_AUTOGEN_V1
  // ── คำนวณ GRT Prefix/Digit/Running เริ่มต้นสำหรับ "ใบกำกับภาษีที่ Add" ──
  // ── Logic เดียวกับ openQuickAction (Prefix = Pattern.replace('Y',ปี) ──
  // ── .replace('MM',เดือน), Digit จาก bu.vat_digit, Running = vat_grn+1) ──
  // ── ยังไม่เขียนกลับ DB ใดๆ แค่คำนวณโชว์ค่าเริ่มต้นเหมือน Quick Action ────
  React.useEffect(() => {
    if (!bu?.bu) return;
    (async () => {
      try {
        const [periodStatus, branchListRes, smCodeListRes] = await Promise.all([
          apiFetch('/vat/period/status').catch(() => null),
          apiFetch('/branch_list').catch(() => []),
          apiFetch('/sm_code_list').catch(() => []), // MARKER_VATWATCHLISTOPS_SUPPLIER_DATA_LOOKUP_V1
        ]);
        setAddTaxInvoiceBranchListData(Array.isArray(branchListRes) ? branchListRes : []); // MARKER_VATWATCHLISTOPS_ADDTAXINVOICE_BRANCH_LIST_LOOKUP_V1
        setAddTaxInvoiceSmCodeListData(Array.isArray(smCodeListRes) ? smCodeListRes : []); // MARKER_VATWATCHLISTOPS_SUPPLIER_DATA_LOOKUP_V1
        const currentPeriodMonth = periodStatus ? periodStatus.vat_period_current_month : null;
        // MARKER_VATWATCHLISTOPS_ADDTAXINVOICE_RECEIVE_DATE_DEFAULT_V1
        // ── Default Receive Date เหมือน Quick Action (getDefaultQuickActionReceiveDate) ──
        setAddTaxInvoiceReceiveDate(getDefaultQuickActionReceiveDate(currentPeriodMonth));
        const grtControl = bu?.['VAT GRT Control'] || 'Auto';
        const pattern = bu?.vat_grn_pattern || '';
        const digitRaw = String(bu?.vat_digit || '4DG').toUpperCase().replace(/[^0-9]/g, '');
        const digitCount = (parseInt(digitRaw, 10) >= 1 && parseInt(digitRaw, 10) <= 10) ? parseInt(digitRaw, 10) : 4;
        const effMonth = getEffectivePeriodMonth(bu, currentPeriodMonth);
        const refDate = effMonth ? new Date(effMonth + '-01') : new Date();
        const yLast = String(refDate.getFullYear()).slice(-1);
        const mm = String(refDate.getMonth() + 1).padStart(2, '0');
        const prefix = pattern.replace('Y', yLast).replace('MM', mm);
        const nextRunning = (parseInt(bu?.vat_grn, 10) || 0) + 1;
        setAddTaxInvoiceGrtControl(grtControl);
        setAddTaxInvoiceGrtPrefix(prefix);
        setAddTaxInvoiceGrtDigitCount(digitCount);
        setAddTaxInvoiceGrtNumber(grtControl === 'Manual' ? '' : String(nextRunning).padStart(digitCount, '0'));
      } catch (err) {
        console.error('addTaxInvoice GRT autogen error:', err);
      }
    })();
  }, [bu?.bu]);
  React.useEffect(() => { // MARKER_VATWATCHLISTOPS_ADDTAX_GRN_SYNC_BROADCAST_V1 -- รับ Broadcast ตอน Quick Action หรือ Session อื่น Update เลข GRN Running -> Sync เลขที่ Full Page ใช้ต่อทันที
    const unsubscribe = subscribeWs(['vat_grn_updated'], (payload) => {
      if (!payload || payload.bu !== bu?.bu) return;
      const nextFromBroadcastFP = (parseInt(payload.vat_grn, 10) || 0) + 1;
      setAddTaxInvoiceGrtNumber(String(nextFromBroadcastFP).padStart(addTaxInvoiceGrtDigitCount, '0'));
      addTaxInvoiceLastUsedGrtRunningRef.current = null; // MARKER_VATWATCHLISTOPS_ADDTAX_GRN_SYNC_BROADCAST_V1 -- DB Sync ล่าสุดแล้ว เคลียร์ค่าที่ยังไม่ได้เขียนกลับทิ้ง (ถ้ามี)
    });
    return unsubscribe;
  }, [bu?.bu, addTaxInvoiceGrtDigitCount]);
  const openQuickAction = async (row) => {
    // MARKER_VATWATCHLISTOPS_QUICK_ACTION_FIX_TARGETS_V1 -- ใช้ Snapshot ใน selectedNoteRows ตรงๆ กันหลุดแถวที่ไม่อยู่ใน detailRows ปัจจุบัน (เช่น Search เปลี่ยนไปแล้ว)
    const targets = (selectedNoteRows.size > 0 && selectedNoteRows.has(getNoteKey(row)))
      ? Array.from(selectedNoteRows.values())
      : [row];
    const supplierCodes = new Set(targets.map((r) => r.supplier_code));
    if (supplierCodes.size > 1) {
      alert('เลือกได้เฉพาะแถวที่เป็น Supplier เดียวกันเท่านั้น (Tax Invoice ใช้ค่าเดียวกันทั้ง Batch)');
      return;
    }
    setQuickActionRows(targets);
    setQuickActionGrtPrefix('');
    setQuickActionGrtRunning('');
    setQuickActionGrtControl(bu?.['VAT GRT Control'] || 'Auto');
    setQuickActionTaxInvoiceDate('');
    setQuickActionTaxInvoiceNumber('');
    setQuickActionVendor({ vendor_name: targets[0]?.vendor_name || '', supplier_code: targets[0]?.supplier_code || '', tax_id: '', branch_no: '' });
    setQuickActionReceiveDate('');
    setShowQuickAction(true);
    try {
      const [vendorCategories, periodStatus] = await Promise.all([
        apiFetch('/vendor_category').catch(() => []),
        apiFetch('/vat/period/status').catch(() => null),
      ]);
      const supplierCode = (targets[0]?.supplier_code || '').trim();
      const matched = (Array.isArray(vendorCategories) ? vendorCategories : []).find((v) => String(v['Code'] || '').trim() === supplierCode);
      setQuickActionVendor({
        vendor_name: targets[0]?.vendor_name || '',
        supplier_code: targets[0]?.supplier_code || '',
        tax_id: (matched && matched['TAX ID']) || '',
        branch_no: (matched && matched['No.']) || '',
      });
      const currentPeriodMonth = periodStatus ? periodStatus.vat_period_current_month : null;
      setQuickActionReceiveDate(getDefaultQuickActionReceiveDate(currentPeriodMonth));
      // MARKER_VATWATCHLISTOPS_QUICK_ACTION_GRT_AUTOGEN_V1 -- Prefix = Pattern.replace('Y',ปี).replace('MM',เดือน)
      const grtControl = bu?.['VAT GRT Control'] || 'Auto';
      const pattern = bu?.vat_grn_pattern || '';
      const digitRaw = String(bu?.vat_digit || '4DG').toUpperCase().replace(/[^0-9]/g, '');
      const digitCount = (parseInt(digitRaw, 10) >= 1 && parseInt(digitRaw, 10) <= 10) ? parseInt(digitRaw, 10) : 4;
      const effMonth = getEffectivePeriodMonth(bu, currentPeriodMonth);
      setQuickActionPeriodMonth(effMonth); // MARKER_VATWATCHLISTOPS_QUICK_ACTION_BOOK_PERIOD_V2
      const refDate = effMonth ? new Date(effMonth + '-01') : new Date();
      const yLast = String(refDate.getFullYear()).slice(-1);
      const mm = String(refDate.getMonth() + 1).padStart(2, '0');
      const prefix = pattern.replace('Y', yLast).replace('MM', mm);
      const currentVatGrn = quickActionVatGrnOverride != null ? quickActionVatGrnOverride : (parseInt(bu?.vat_grn, 10) || 0); // MARKER_VATWATCHLISTOPS_VAT_GRN_REALTIME_V2
      const nextRunning = currentVatGrn + 1;
      setQuickActionGrtControl(grtControl);
      setQuickActionGrtPrefix(prefix);
      setQuickActionGrtDigitCount(digitCount);
      setQuickActionGrtRunning(grtControl === 'Manual' ? '' : String(nextRunning).padStart(digitCount, '0'));
    } catch (err) {
      console.error('openQuickAction vendor/period fetch error:', err);
    }
  };
  const closeQuickAction = () => setShowQuickAction(false);
  const handleAddQuickActionData = async () => {
    if (quickActionRows.length === 0) return;
    // MARKER_VATWATCHLISTOPS_QUICK_ACTION_GRT_SYNC_V1 -- Tax Invoice Number Sync จาก GRT แล้ว ไม่ต้องบังคับกรอกแยก เหลือแค่ Tax Invoice Date
    if (!quickActionTaxInvoiceDate) { // MARKER_VATWATCHLISTOPS_QUICK_ACTION_REQUIRED_FIELD_ALERT_V1 -- แจ้งเตือนแทนที่จะเงียบๆ ไม่ทำอะไรเลย
      await confirmDialog.alert('ไม่สามารถ Popvat ได้ เนื่องจากไม่มีข้อมูลตาม Required Field (กรุณากรอก Tax Invoice Date)', { title: 'ข้อมูลไม่ครบ', variant: 'danger' }); // MARKER_VATWATCHLISTOPS_QUICK_ACTION_ALERT_CONFIRMDIALOG_V1 -- ใช้ Popup ของโปรเจกต์แทน Native alert()
      return;
    }
    setQuickActionSaving(true);
    try {
      const draftId = generateQuickActionDraftId(); // MARKER_VATWATCHLISTOPS_QUICK_ACTION_GRT_SYNC_V1 -- Draft ID เดียวกันทุกแถวใน Save รอบนี้
      const grtCombined = quickActionGrtRunning ? `${quickActionGrtPrefix}${String(quickActionGrtRunning).padStart(quickActionGrtDigitCount, '0')}` : null;
      for (const row of quickActionRows) {
        await apiFetch('/vat_upload_popvatdraft', {
          method: 'POST',
          body: JSON.stringify({
            bu: bu?.bu,
            book: bu?.BOOK || null, // MARKER_VATWATCHLISTOPS_QUICK_ACTION_BOOK_PERIOD_V2
            period: formatQuickActionPeriodMMYYYY(quickActionPeriodMonth), // MARKER_VATWATCHLISTOPS_QUICK_ACTION_BOOK_PERIOD_V2
            draft_id: draftId,
            branch: row.branch || null,
            grt_number: row.receive_doc_no || null, // MARKER_VATWATCHLISTOPS_QUICKACTION_FIX_GRT_TAXINVOICE_FIELDS_V1 -- ดึงจากเลขที่ GRT เดิมของแต่ละ Invoice (เหมือน Cancel Flow) ไม่ใช่ grtCombined ที่ Auto-gen ใหม่
            original_invoice_number: row.invoice_ref || null,
            receipt_date: formatQuickActionReceiveDateText(quickActionReceiveDate),
            tax_invoice_number: grtCombined, // MARKER_VATWATCHLISTOPS_QUICKACTION_TAXINVOICE_REVERT_GRTCOMBINED_V1 -- ยืนยันแล้วว่าต้องเป็น grtCombined (prefix+running) เหมือนเดิม ไม่ใช่ช่องพิมพ์เอง
            tax_invoice_date: formatQuickActionReceiveDateText(quickActionTaxInvoiceDate), // MARKER_VATWATCHLISTOPS_QUICK_ACTION_TAX_INVOICE_DATE_FORMAT_V1 -- Format DD-MMM-YY เหมือน Receipt Date
            vendor_tax_invoice_number: quickActionTaxInvoiceNumber, // MARKER_VATWATCHLISTOPS_VENDOR_TAXINVOICE_USE_TYPED_V1 -- เปลี่ยนจาก grtCombined เป็นค่าที่พิมพ์จริงในช่อง Tax Invoice Number
            supplier_tax_id: null, // MARKER_VATWATCHLISTOPS_QUICK_ACTION_REMOVE_SUPPLIER_FIELDS_V1 -- เข้าระบบปลายทางไม่ได้ ไม่ต้องใส่แล้ว
            supplier_branch_number: null, // MARKER_VATWATCHLISTOPS_QUICK_ACTION_REMOVE_SUPPLIER_FIELDS_V1
            supplier_name: row.vendor_name || null, // MARKER_VATWATCHLISTOPS_POPVATDRAFT_NEWFIELDS_V1
            check_no: row.check_no || null,
            product_value: row.exp_amount || null,
            vat_amount: row.exp_vat || null,
            status: 'draft',
            action: 'Popvat', // MARKER_VATWATCHLISTOPS_QUICK_ACTION_CANCEL_REASON_V1
            menu_source: 'ap_vat', // MARKER_VATWATCHLISTOPS_MENU_SOURCE_AP_VAT_V1 -- Quick Action Popvat Normal
          }),
        });
        const reportRows = await apiFetch(`/vat_watchlist_report?eq_bu=${encodeURIComponent(bu?.bu)}&eq_invoice_ref=${encodeURIComponent(row.invoice_ref)}`);
        const matchedReport = (Array.isArray(reportRows) ? reportRows : []).filter((r) => r.status === 'pending');
        for (const r of matchedReport) {
          await apiFetch(`/vat_watchlist_report/${r.id}`, { method: 'PUT', body: JSON.stringify({ status: 'draft' }) });
        }
      }
      const doneKeys = new Set(quickActionRows.map((r) => getNoteKey(r)));
      setDetailRows((prev) => prev.filter((r) => !doneKeys.has(getNoteKey(r))));
      setSelectedNoteRows((prev) => {
        const next = new Map(prev);
        doneKeys.forEach((k) => next.delete(k));
        return next;
      });
      // MARKER_VATWATCHLISTOPS_QUICK_ACTION_GRT_AUTOGEN_V1 -- กันเลขซ้ำรอบหน้า: Update Running ล่าสุดกลับเข้า company_list
      const usedRunning = parseInt(quickActionGrtRunning, 10);
      if (usedRunning > 0 && bu?.id) {
        await apiFetch(`/company_list/${bu.id}`, { method: 'PUT', body: JSON.stringify({ vat_grn: usedRunning }) }).catch((err) => console.error('Update vat_grn error:', err));
        setQuickActionVatGrnOverride(usedRunning); // MARKER_VATWATCHLISTOPS_VAT_GRN_REALTIME_V2 -- Session ตัวเอง Sync ทันที
        broadcastWs('vat_grn_updated', { bu: bu?.bu, vat_grn: usedRunning }); // MARKER_VATWATCHLISTOPS_VAT_GRN_REALTIME_V2 -- แจ้ง Session อื่นให้ Sync ด้วย
      }
      setDetailSearch(''); // MARKER_VATWATCHLISTOPS_QUICK_ACTION_CLEAR_SEARCH_V1
      setDetailSearchDebounced('');
      broadcastWs('vat_watchlist_draft_updated', { bu: bu?.bu, invoice_refs: quickActionRows.map((r) => r.invoice_ref) });
      setShowQuickAction(false);
    } catch (err) {
      console.error('handleAddQuickActionData error:', err);
      alert('บันทึก Quick Action ไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setQuickActionSaving(false);
    }
  };
  // MARKER_VATWATCHLISTOPS_QUICK_ACTION_CANCEL_FALLBACK_V1
  // -- "Popvat - Cancel" = Save แบบใช้ค่า Default/Fallback แทนการบังคับกรอก --
  const handleCancelQuickActionData = async () => {
    if (quickActionRows.length === 0) { setShowQuickAction(false); return; }
    setQuickActionSaving(true);
    try {
      const now = new Date();
      const sentinelReceiveDate = `1989-${String(now.getMonth() + 1).padStart(2, '0')}-01`; // Sentinel วันที่ 01-เดือนปัจจุบันจริง-1989
      const draftId = generateQuickActionDraftId(); // MARKER_VATWATCHLISTOPS_QUICK_ACTION_GRT_SYNC_V1
      for (const row of quickActionRows) {
        const fallbackTaxInvoiceDate = quickActionTaxInvoiceDate || row.payment_date || null;
        const cancelGrtFromIncomplete = row.receive_doc_no || null; // MARKER_VATWATCHLISTOPS_QUICK_ACTION_CANCEL_GRT_INCOMPLETE_V1 -- เฉพาะ Cancel: ดึงจากเลขที่ GRT เดิมของแต่ละ Invoice
        await apiFetch('/vat_upload_popvatdraft', {
          method: 'POST',
          body: JSON.stringify({
            bu: bu?.bu,
            book: bu?.BOOK || null, // MARKER_VATWATCHLISTOPS_QUICK_ACTION_BOOK_PERIOD_V2
            period: formatQuickActionPeriodMMYYYY(quickActionPeriodMonth), // MARKER_VATWATCHLISTOPS_QUICK_ACTION_BOOK_PERIOD_V2
            draft_id: draftId,
            branch: row.branch || null,
            grt_number: cancelGrtFromIncomplete,
            original_invoice_number: row.invoice_ref || null,
            receipt_date: formatQuickActionReceiveDateText(sentinelReceiveDate),
            tax_invoice_number: cancelGrtFromIncomplete,
            tax_invoice_date: formatQuickActionReceiveDateText(fallbackTaxInvoiceDate), // MARKER_VATWATCHLISTOPS_QUICK_ACTION_TAX_INVOICE_DATE_FORMAT_V1 -- Format DD-MMM-YY เหมือน Receipt Date
            vendor_tax_invoice_number: cancelGrtFromIncomplete,
            supplier_tax_id: null, // MARKER_VATWATCHLISTOPS_QUICK_ACTION_REMOVE_SUPPLIER_FIELDS_V1 -- เข้าระบบปลายทางไม่ได้ ไม่ต้องใส่แล้ว
            supplier_branch_number: null, // MARKER_VATWATCHLISTOPS_QUICK_ACTION_REMOVE_SUPPLIER_FIELDS_V1
            supplier_name: row.vendor_name || null, // MARKER_VATWATCHLISTOPS_POPVATDRAFT_NEWFIELDS_V1
            check_no: row.check_no || null,
            product_value: row.exp_amount || null,
            vat_amount: row.exp_vat || null,
            status: 'draft',
            action: quickActionCancelReason || 'Cancel', // MARKER_VATWATCHLISTOPS_QUICK_ACTION_CANCEL_REASON_V1
            menu_source: 'ap_vat', // MARKER_VATWATCHLISTOPS_MENU_SOURCE_AP_VAT_V1 -- Quick Action Popvat Cancel
          }),
        });
        const reportRows = await apiFetch(`/vat_watchlist_report?eq_bu=${encodeURIComponent(bu?.bu)}&eq_invoice_ref=${encodeURIComponent(row.invoice_ref)}`);
        const matchedReport = (Array.isArray(reportRows) ? reportRows : []).filter((r) => r.status === 'pending');
        for (const r of matchedReport) {
          await apiFetch(`/vat_watchlist_report/${r.id}`, { method: 'PUT', body: JSON.stringify({ status: 'draft' }) });
        }
      }
      const doneKeys = new Set(quickActionRows.map((r) => getNoteKey(r)));
      setDetailRows((prev) => prev.filter((r) => !doneKeys.has(getNoteKey(r))));
      setSelectedNoteRows((prev) => {
        const next = new Map(prev);
        doneKeys.forEach((k) => next.delete(k));
        return next;
      });
      // MARKER_VATWATCHLISTOPS_QUICK_ACTION_CANCEL_GRT_INCOMPLETE_V1 -- Cancel ไม่ได้ใช้เลข Running จาก Auto-gen แล้ว จึงไม่ Update company_list.vat_grn
      setDetailSearch(''); // MARKER_VATWATCHLISTOPS_QUICK_ACTION_CLEAR_SEARCH_V1
      setDetailSearchDebounced('');
      broadcastWs('vat_watchlist_draft_updated', { bu: bu?.bu, invoice_refs: quickActionRows.map((r) => r.invoice_ref) });
      setQuickActionCancelReason('Cancel'); // MARKER_VATWATCHLISTOPS_QUICK_ACTION_CANCEL_REASON_V1 -- Reset กลับ Default หลัง Save สำเร็จ
      setShowQuickAction(false);
    } catch (err) {
      console.error('handleCancelQuickActionData error:', err);
      alert('บันทึก Quick Action ไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setQuickActionSaving(false);
    }
  };
  React.useEffect(() => { // MARKER_VATWATCHLISTOPS_QUICK_ACTION_V1 -- รับ Broadcast จาก Session อื่น ตัดแถวออกให้ Sync กัน
    const unsubscribe = subscribeWs(['vat_watchlist_draft_updated'], (payload) => {
      if (!payload || payload.bu !== bu?.bu) return;
      const refs = new Set(payload.invoice_refs || []);
      setDetailRows((prev) => prev.filter((r) => !refs.has(r.invoice_ref)));
    });
    return unsubscribe;
  }, [bu?.bu]);
  React.useEffect(() => { // MARKER_VATWATCHLISTOPS_VAT_GRN_REALTIME_V2 -- รับ Broadcast เลข Running จาก Session อื่น Sync กัน Real-time
    const unsubscribe = subscribeWs(['vat_grn_updated'], (payload) => {
      if (!payload || payload.bu !== bu?.bu) return;
      setQuickActionVatGrnOverride(payload.vat_grn);
    });
    return unsubscribe;
  }, [bu?.bu]);
  React.useEffect(() => { // MARKER_VATWATCHLISTOPS_RESTORE_BROADCAST_SYNC_V1 -- รับ Broadcast ตอน Restore จาก Session อื่น -> สั่ง Refetch ตาราง Incomplete ใหม่ทันที
    const unsubscribe = subscribeWs(['vat_watchlist_draft_restored'], (payload) => {
      if (!payload || payload.bu !== bu?.bu) return;
      setDetailReloadKey((k) => k + 1);
    });
    return unsubscribe;
  }, [bu?.bu]);
  React.useEffect(() => { // MARKER_VATWATCHLISTOPS_SMCODE_BROADCAST_LISTENER_V1 -- รับ Broadcast ตอนบันทึก Supplier ใหม่ (Add Supplier) จาก Session ตัวเองหรือ Session อื่น -> Refetch sm_code_list ทันที ไม่ต้อง Reload หน้า
    const unsubscribe = subscribeWs(['sm_code_list_updated'], () => {
      apiFetch('/sm_code_list').then((res) => setAddTaxInvoiceSmCodeListData(Array.isArray(res) ? res : [])).catch(() => {});
    });
    return unsubscribe;
  }, []);
  // MARKER_VATWATCHLISTOPS_ESC_CLEAR_SELECT_V1 -- กด Esc ตอนมี Row เลือกอยู่ -> ล้างการเลือกอัตโนมัติ
  React.useEffect(() => {
    const handleEscClearSelect = (e) => {
      if (e.key === 'Escape' && selectedNoteRows.size > 0) clearSelectedNoteRows();
    };
    window.addEventListener('keydown', handleEscClearSelect);
    return () => window.removeEventListener('keydown', handleEscClearSelect);
  }, [selectedNoteRows]);
  const openGroupNoteModal = () => {
    const targets = Array.from(selectedNoteRows.values());
    if (targets.length === 0) return;
    setNoteDraftText('');
    setNoteDraftAccept(false);
    setNoteDraftRemark('');
    setNoteDraftCheckNo('');
    setNoteTrackMode('single');
    setNoteDraftImageIds([]); // MARKER_VATWATCHLISTOPS_NOTES_IMAGE_V1
    setNoteImageRefId(`group-${bu.bu}-${Date.now()}`);
    setNoteModalGroupTargets(targets);
    setNoteModalRow({ invoice_ref: null, supplier_code: null });
  };

  // MARKER_VATWATCHLISTOPS_NOTES_IMAGE_V1
  // ── Upload รูป/PDF เข้า file_storage (module: vat-watchlist-notes) ── ครั้งเดียวต่อไฟล์ ──
  // MARKER_VATWATCHLISTOPS_NOTES_PASTE_IMAGE_V1 -- แยก Logic Upload ออกมาใช้ร่วมกัน ทั้งปุ่มเลือกไฟล์และ Paste ในช่อง Note
  const uploadNoteImageFiles = async (files) => {
    if (!files || files.length === 0) return;
    setNoteImageUploading(true);
    try {
      for (const file of files) {
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const result = await apiFetch('/file-storage/upload-image', {
          method: 'POST',
          body: JSON.stringify({ module: 'vat-watchlist-notes', refId: noteImageRefId, fileBase64: base64, fileType: file.type }),
        });
        if (result && result.fileId) {
          setNoteDraftImageIds((prev) => [...prev, result.fileId]);
        }
      }
    } catch (err) {
      console.error('upload note image error:', err);
      confirmDialog.alert('แนบรูปไม่สำเร็จ: ' + (err?.message || ''), { title: 'ผิดพลาด', variant: 'danger' });
    }
    setNoteImageUploading(false);
  };
  const handleNoteImageSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    await uploadNoteImageFiles(files);
  };
  const handleNoteTextareaPaste = async (e) => {
    const items = Array.from(e.clipboardData && e.clipboardData.items ? e.clipboardData.items : []);
    const imageFiles = items.filter((it) => it.type && it.type.startsWith('image/')).map((it) => it.getAsFile()).filter(Boolean);
    if (imageFiles.length === 0) return;
    e.preventDefault();
    await uploadNoteImageFiles(imageFiles);
  };
  const handleNoteImageRemove = async (fileId) => {
    try {
      await apiFetch(`/file-storage/${fileId}`, { method: 'DELETE' });
    } catch (err) {
      console.error('delete note image error:', err);
    }
    setNoteDraftImageIds((prev) => prev.filter((id) => id !== fileId));
    setNoteImagePreviewUrls((prev) => {
      const next = { ...prev };
      if (next[fileId]) { URL.revokeObjectURL(next[fileId]); delete next[fileId]; }
      return next;
    });
  };

  const saveNote = async () => {
    if (!noteModalRow) return;
    // MARKER_VATWATCHLISTOPS_GROUP_NOTE_SELECT_V1 -- Group Mode ใช้รายการที่เลือกไว้ตรงๆ ไม่ต้อง Auto-match check_no
    let targets;
    if (noteModalGroupTargets && noteModalGroupTargets.length > 0) {
      targets = noteModalGroupTargets;
    } else {
    // MARKER_VATWATCHLISTOPS_NOTES_TRACK_BY_CHECK_V1
    // ── ถ้าเลือก 'บันทึกทุก Invoice ที่ใช้เช็คเลขนี้' -- หา Invoice อื่นที่ check_no ตรงกันก่อน ──
    targets = [{ invoice_ref: noteModalRow.invoice_ref, supplier_code: noteModalRow.supplier_code }];
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
    } // MARKER_VATWATCHLISTOPS_GROUP_NOTE_SELECT_V1 -- ปิด else ของ Group Mode Branch
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
          image_ids: noteDraftImageIds, // MARKER_VATWATCHLISTOPS_NOTES_IMAGE_V1 -- เก็บเป็น Array ไว้สำหรับ Local Cache (noteMap) -- MARKER_VATWATCHLISTOPS_NOTES_LOCAL_CACHE_IMAGE_IDS_FIX_V1
        };
        const apiPayload = { ...payload, image_ids: JSON.stringify(noteDraftImageIds) }; // MARKER_VATWATCHLISTOPS_NOTES_LOCAL_CACHE_IMAGE_IDS_FIX_V1 -- MARKER_VATWATCHLISTOPS_NOTES_IMAGE_IDS_JSONB_FIX_V1 -- Stringify เฉพาะตอนส่งจริงไป Backend (jsonb) แยกจาก payload ที่ใช้กับ Cache
        await apiFetch('/vat_watchlist_notes/upsert?onConflict=bu,invoice_ref,supplier_code', { method: 'POST', body: JSON.stringify(apiPayload) });
        nextEntries[`${t.invoice_ref || ''}|${t.supplier_code || ''}`] = payload; // payload (image_ids เป็น Array) ใช้กับ Local Cache เท่านั้น
      }
      setNoteMap((prev) => ({ ...prev, ...nextEntries }));
      if (noteModalGroupTargets) setSelectedNoteRows(new Map()); // MARKER_VATWATCHLISTOPS_GROUP_NOTE_SELECT_V1 -- เคลียร์การเลือกหลัง Group Save สำเร็จ
      setNoteModalGroupTargets(null);
      setNoteDraftImageIds([]); // MARKER_VATWATCHLISTOPS_NOTES_IMAGE_V1
      setNoteImagePreviewUrls({});
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

  // MARKER_VATWATCHLISTOPS_TYPE_SUBTYPE_TREE_V1 — โหลด Type ▸ Subtype Tree พร้อม Count ตอน Mount
  React.useEffect(() => {
    if (!bu?.bu) return;
    (async () => {
      try {
        const params = new URLSearchParams();
        params.set('eq_bu', bu.bu);
        params.set('distinct_group', 'bus_type,sub_type');
        const res = await apiFetch(`/vat_watchlist_report?${params.toString()}`);
        const rows = Array.isArray(res?.rows) ? res.rows : [];
        const map = {};
        for (const r of rows) {
          const t = r.bus_type;
          const st = r.sub_type;
          const cnt = r.count || 0;
          if (!t) continue;
          if (!map[t]) map[t] = { type: t, count: 0, subtypes: [] };
          map[t].count += cnt;
          if (st) map[t].subtypes.push({ subtype: st, count: cnt });
        }
        const tree = Object.values(map).sort((a, b) => a.type.localeCompare(b.type));
        tree.forEach((t) => t.subtypes.sort((a, b) => a.subtype.localeCompare(b.subtype)));
        setTypeTree(tree);
      } catch (err) {
        console.error('load typeTree error:', err);
      }
    })();
  }, [bu?.bu]);

  const columnFiltersKey = React.useMemo(
    () => JSON.stringify(Object.keys(columnFilters).sort().map((k) => [k, Array.from(columnFilters[k]).sort()])),
    [columnFilters]
  );

  React.useEffect(() => { setDetailPage(1); }, [detailSearchDebounced, columnFiltersKey, selectedSubtypeKeys, selectedAgingBuckets]); // MARKER_VATWATCHLISTOPS_TYPE_SUBTYPE_TREE_V1

  const buildDetailParams = React.useCallback(() => {
    const params = new URLSearchParams();
    if (bu?.bu) params.set('eq_bu', bu.bu);
    params.set('eq_status', 'pending'); // MARKER_VATWATCHLISTOPS_DETAIL_FILTER_PENDING_ONLY_V1 -- ตัด draft/done ออกจาก Ops เสมอ (Query+Count+Aging Bucket ใช้ Function นี้ร่วมกัน กรองตรงกันหมด)
    if (detailSearchDebounced.trim()) {
      params.set('search', detailSearchDebounced.trim());
      params.set('search_cols', 'invoice_ref,supplier_code,vendor_name,check_no,receive_doc_no,doc_no,branch'); // MARKER_VATWATCHLISTOPS_SEARCH_COLS_TRIM_PERFORMANCE_V1 -- ลดจาก 18 เหลือ 7 Column แก้ Search ช้า (ตัด Category/Free-text ที่ไม่ค่อยมีใคร Search)
      params.set('search_mode', 'and_terms'); // MARKER_VATWATCHLISTOPS_SEARCH_MODE_AND_TERMS_V1 -- แต่ละคำ (คั่น Comma) ต้อง Match บางคอลัมน์ ทุกคำต้องผ่านหมด
    }
    Object.keys(columnFilters).forEach((key) => {
      const set = columnFilters[key];
      if (!set || set.size === 0) return;
      const values = Array.from(set).filter((v) => v !== '(ว่าง)');
      if (values.length > 0) params.set(`in_${key}`, values.join(','));
    });
    // MARKER_VATWATCHLISTOPS_TYPE_SUBTYPE_TREE_V1
    if (selectedSubtypeKeys.size > 0) {
      const typesSet = new Set();
      const subtypesSet = new Set();
      selectedSubtypeKeys.forEach((k) => {
        const [t, st] = k.split('|||');
        typesSet.add(t);
        if (st) subtypesSet.add(st);
      });
      if (typesSet.size > 0) params.set('in_bus_type', Array.from(typesSet).join(','));
      if (subtypesSet.size > 0) params.set('in_sub_type', Array.from(subtypesSet).join(','));
    }
    if (selectedAgingBuckets.size > 0) params.set('aging_buckets', Array.from(selectedAgingBuckets).join(','));
    return params;
  }, [bu?.bu, detailSearchDebounced, columnFiltersKey, selectedSubtypeKeys, selectedAgingBuckets]);
  // MARKER_VATWATCHLISTOPS_AGING_BUTTON_COUNTS_V1 — โหลด Count ต่อ Aging Bucket
  React.useEffect(() => {
    if (!bu?.bu) return;
    let active = true;
    (async () => {
      try {
        const params = buildDetailParams();
        params.delete('aging_buckets');
        params.delete('limit');
        params.delete('offset');
        params.delete('order');
        params.set('aging_bucket_counts', 'true');
        const res = await apiFetch(`/vat_watchlist_report?${params.toString()}`);
        if (!active) return;
        setAgingBucketCounts(res && res.counts ? res.counts : {});
      } catch (err) {
        console.error('load agingBucketCounts error:', err);
      }
    })();
    return () => { active = false; };
  }, [bu?.bu, buildDetailParams, detailReloadKey]); // MARKER_VATWATCHLISTOPS_RESTORE_BROADCAST_SYNC_V1 -- เพิ่ม detailReloadKey ให้ Fetch ใหม่ตอนได้รับ Broadcast Restore

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

        const [rows, countRes] = await Promise.all([
          bu?.bu ? apiFetch(`/vat_watchlist_report?${dataParams.toString()}`) : Promise.resolve([]),
          bu?.bu ? apiFetch(`/vat_watchlist_report?${countParams.toString()}`) : Promise.resolve({ total: 0 }),
        ]); // MARKER_VATWATCHLISTOPS_NOTES_SEPARATE_EFFECT_V1 -- แยก Note ออกจาก Effect นี้แล้ว ลดเหลือ 2 Call ตอน Filter เปลี่ยน
        if (!active) return;
        setDetailRows(Array.isArray(rows) ? rows : []);
        setDetailTotalCount(countRes && typeof countRes.total === 'number' ? countRes.total : 0);
      } catch (err) {
        console.error('IncompleteBuOperationTest load error:', err);
      }
      if (active) setLoadingDetail(false);
    })();
    return () => { active = false; };
  }, [bu?.bu, username, detailPage, detailPageSize, buildDetailParams, detailReloadKey]); // MARKER_VATWATCHLISTOPS_RESTORE_BROADCAST_SYNC_V1 -- เพิ่ม detailReloadKey ให้ Fetch ใหม่ตอนได้รับ Broadcast Restore

  // MARKER_VATWATCHLISTOPS_NOTES_SEPARATE_EFFECT_V1
  // ── โหลด Note แยกต่างหาก ผูกกับ bu เท่านั้น ไม่ Fetch ซ้ำทุกครั้งที่ Filter เปลี่ยน ──
  React.useEffect(() => {
    if (!bu?.bu) { setNoteMap({}); return; }
    let active = true;
    (async () => {
      try {
        const notes = await apiFetch(`/vat_watchlist_notes?eq_bu=${encodeURIComponent(bu.bu)}`);
        if (!active) return;
        const noteList = Array.isArray(notes) ? notes : [];
        const nextNoteMap = {};
        noteList.forEach((n) => { nextNoteMap[`${n.invoice_ref || ''}|${n.supplier_code || ''}`] = n; });
        setNoteMap(nextNoteMap);
      } catch (err) {
        console.error('load notes error:', err);
      }
    })();
    return () => { active = false; };
  }, [bu?.bu]);

  // MARKER_VATWATCHLISTOPS_POPVAT_DRAFT_STATUS_SYNC_V1
  // ── Sync สถานะ Report <-> Popvat Draft (Bidirectional) ทุกครั้งที่เปิด/เปลี่ยน BU ──
  React.useEffect(() => {
    if (!bu?.bu) return;
    let active = true;
    (async () => {
      try {
        const result = await apiFetch('/vat_watchlist_report/sync_draft_status', {
          method: 'POST',
          body: JSON.stringify({ bu: bu.bu }),
        });
        if (!active) return;
        if (result && (result.to_draft > 0 || result.to_pending > 0 || result.to_accept > 0)) { // MARKER_VATWATCHLISTOPS_SYNC_CHECK_TO_ACCEPT_V1
          setDetailReloadKey((k) => k + 1); // มีการเปลี่ยนสถานะจริง -> Refetch ตารางให้ทันสมัย
        }
      } catch (err) {
        console.error('sync draft status error:', err);
      }
    })();
    return () => { active = false; };
  }, [bu?.bu]); // MARKER_VATWATCHLISTOPS_POPVAT_DRAFT_STATUS_SYNC_V1

  // MARKER_VATWATCHLISTOPS_COLUMN_CONFIG_SEPARATE_EFFECT_V1
  // ── โหลด Config Columns แยกต่างหาก ครั้งเดียวตอนเปิด BU/เปลี่ยน User ──
  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const configs = await apiFetch('/vat_incomplete_column_config');
        if (!active) return;
        const configList = Array.isArray(configs) ? configs : [];
        setAllConfigs(configList);
        const myConfig = configList.find((c) => c.username === username);
        if (myConfig && Array.isArray(myConfig.visible_columns) && myConfig.visible_columns.length > 0) {
          setVisibleColumns(myConfig.visible_columns);
        }
      } catch (err) {
        console.error('load column config error:', err);
      }
    })();
    return () => { active = false; };
  }, [bu?.bu, username]);

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

  // MARKER_VATWATCHLISTOPS_TYPE_DROPDOWN_CLICK_OUTSIDE_V1
  // ── คลิกนอก Type Filter Dropdown -> พับ Dropdown อัตโนมัติ ──
  React.useEffect(() => {
    if (!typeDropdownOpen) return;
    const handleClickOutside = (e) => {
      const insideOriginal = typeDropdownRef.current && typeDropdownRef.current.contains(e.target);
      const insideFullPage = typeDropdownRefFullPage.current && typeDropdownRefFullPage.current.contains(e.target); // MARKER_VATWATCHLISTOPS_FULLPAGE_POPVAT_SHARED_FILTER_V1
      if (!insideOriginal && !insideFullPage) {
        setTypeDropdownOpen(false);
        setFocusedTypeIndex(-1);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [typeDropdownOpen]);

  // MARKER_VATWATCHLISTOPS_DETAIL_ESC_KEY_V1
  // ── Esc 2 ชั้น: ชั้น 1 ปิด Filter Dropdown ที่เปิดอยู่ก่อน / ชั้น 2 (ไม่มี Dropdown เปิด) = กด Back ──
  React.useEffect(() => {
    const handleEscKey = (e) => {
      if (e.key !== 'Escape') return;
      // MARKER_VATWATCHLISTOPS_ESC_DRAFT_MONITOR_PRIORITY_V1 -- Esc ปิด Draft Monitor ก่อนสุด (เผื่อเปิดซ้อนบน Full Page - Popvat)
      if (showDraftMonitor) {
        setShowDraftMonitor(false);
        return;
      }
      // MARKER_VATWATCHLISTOPS_FULLPAGE_POPVAT_INVOICE_LIST_V1 -- Esc ปิด Full Page ก่อนเป็นอันดับแรก
      if (showFullPagePopvat) {
        setShowFullPagePopvat(false);
        setFullPagePopvatDataFetched(false); // MARKER_VATWATCHLISTOPS_FULLPAGE_POPVAT_GET_DATA_V1
        return;
      }
      // MARKER_VATWATCHLISTOPS_TYPE_DROPDOWN_KEYBOARD_V1 — เพิ่มลำดับปิด Type Dropdown ก่อน
      if (typeDropdownOpen) {
        setTypeDropdownOpen(false);
        setFocusedTypeIndex(-1);
      } else if (openFilterKey) {
        setOpenFilterKey(null);
      } else if (selectedNoteRows.size > 0) { // MARKER_VATWATCHLISTOPS_ESC_SELECTED_PRIORITY_V1 -- มี Checkbox เลือกอยู่ -> แค่ล้าง (Handler อีกตัวจัดการแล้ว) ไม่ไล่ไป onBack
        // ไม่ต้องทำอะไรเพิ่มตรงนี้ -- MARKER_VATWATCHLISTOPS_ESC_CLEAR_SELECT_V1 จัดการล้าง selectedNoteRows ให้แล้ว
      } else if (onBack) {
        onBack();
      }
    };
    document.addEventListener('keydown', handleEscKey);
    return () => document.removeEventListener('keydown', handleEscKey);
  }, [openFilterKey, typeDropdownOpen, onBack, showFullPagePopvat, selectedNoteRows, showDraftMonitor]); // MARKER_VATWATCHLISTOPS_FULLPAGE_POPVAT_INVOICE_LIST_V1 -- MARKER_VATWATCHLISTOPS_ESC_SELECTED_PRIORITY_V1 -- MARKER_VATWATCHLISTOPS_ESC_DRAFT_MONITOR_PRIORITY_V1 เพิ่ม showDraftMonitor ใน Dependency

  const detailTotalPages = Math.max(1, Math.ceil(detailTotalCount / detailPageSize));
  const detailPageStart = detailTotalCount === 0 ? 0 : (detailPage - 1) * detailPageSize;
  const detailPageEnd = detailPageStart + detailRows.length;

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', height: '100%', boxSizing: 'border-box' }}>
      <style>{`.vwl-incomplete-row:hover { background-color: #dcebfa !important; } .vwl-fullpage-invoice-scroll::-webkit-scrollbar { display: none; width: 0; height: 0; } .vwl-fullpage-invoice-scroll { scrollbar-width: none; -ms-overflow-style: none; } .vwl-fullpage-taxinvoice-scroll::-webkit-scrollbar { display: none; width: 0; height: 0; } .vwl-fullpage-taxinvoice-scroll { scrollbar-width: none; -ms-overflow-style: none; }`}</style> {/* MARKER_VATWATCHLISTOPS_ROW_HOVER_HIGHLIGHT_V1 */} {/* MARKER_VATWATCHLISTOPS_FULLPAGE_POPVAT_WIDTH60_THIN_SCROLL_V1 */} {/* MARKER_VATWATCHLISTOPS_ADDTAX_LIST_SCROLL_SELECT_V1 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
        <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 12px', fontSize: '13px', border: '0.5px solid #ccc', borderRadius: '8px', background: 'white', cursor: 'pointer' }}>← Back</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}> {/* MARKER_VATWATCHLISTOPS_TOPROW_SWAP_ORDER_V1 -- สลับ Full Page (ซ้าย) / Draft Monitor (ขวา) */}
          <button onClick={openExportConfigModal} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '7px 12px', fontSize: '13px', border: '0.5px solid #ffcc80', borderRadius: '8px', background: '#fff3e0', color: '#e65100', cursor: 'pointer', width: '168px' }}>Export</button> {/* MARKER_VATWATCHLISTOPS_EXPORT_CONFIG_COLUMNS_V1 */} {/* MARKER_VATWATCHLISTOPS_EXPORT_BUTTON_LEFT_STYLE_V1 -- ย้ายมาซ้ายสุด + ขนาดเท่า Full Page + สีส้มอ่อน */}
          <button onClick={() => { setShowFullPagePopvat(true); }} /* MARKER_VATWATCHLISTOPS_FULLPAGE_SEARCH_SYNC_V1 -- Copy ค่า Search จาก Incomplete Detail มาใส่ให้ตอนเปิด */ style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '7px 12px', fontSize: '13px', border: '0.5px solid #90caf9', borderRadius: '8px', background: '#e3f2fd', color: '#1565c0', cursor: 'pointer', width: '168px' }}>Full Page - Popvat</button> {/* MARKER_VATWATCHLISTOPS_FULLPAGE_POPVAT_V1 */}
          <button onClick={() => setShowDraftMonitor(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '7px 12px', fontSize: '13px', border: '0.5px solid #a5d6a7', borderRadius: '8px', background: '#e8f5e9', color: '#2e7d32', cursor: 'pointer', width: '148px', marginRight: '20px' }}>Draft Monitor</button> {/* MARKER_VATWATCHLISTOPS_DRAFT_MONITOR_ALIGN_EDGE_V1 -- ชดเชย Padding ขวาของการ์ด Config Columns (20px) ให้ขอบตรงกันเป๊ะ */} {/* MARKER_VATWATCHLISTOPS_DRAFT_MONITOR_REVERT_FIX_V1 -- ย้ายกลับมาแถวเดิม (Stage I รอบแรกย้ายผิดจุด) */}
        </div>
      </div>

      <div style={{ background: 'white', borderRadius: '12px', border: '0.5px solid #e8e8e8', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '28px', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '12px', color: '#999' }}>Company info</div>
        <div style={{ fontSize: '13px' }}><span style={{ color: '#888' }}>Company </span><span style={{ fontWeight: '500' }}>{bu?.['ENGLISH COMPANY NAME'] || '—'}</span></div>
        <div style={{ fontSize: '13px' }}><span style={{ color: '#888' }}>Tax ID </span><span>{bu?.['TAX ID'] || '—'}</span></div>
        <div style={{ fontSize: '13px' }}><span style={{ color: '#888' }}>BU </span><span style={{ fontWeight: '500' }}>{bu?.bu || '—'}</span></div>
        <div style={{ fontSize: '13px' }}><span style={{ color: '#888' }}>VAT % </span><span>{bu?.['VAT %'] || '—'}</span></div>
        <div style={{ display: 'flex', marginLeft: 'auto', border: '0.5px solid #ccc', borderRadius: '8px', overflow: 'hidden', width: '148px' }}> {/* MARKER_VATWATCHLISTOPS_SHOW_DETAIL_WIDTH_148PX_V1 -- ความกว้างรวมเท่ากับปุ่ม Config Columns เป๊ะ */}
          {[
            { key: 'all', label: 'All' },
            { key: 'show', label: 'Show' },
            { key: 'hide', label: 'Hide' },
          ].map((opt, i) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setShowDetailMode(opt.key)}
              style={{
                flex: 1,
                padding: '6px 2px',
                fontSize: '11px',
                textAlign: 'center',
                fontWeight: showDetailMode === opt.key ? '600' : '400',
                border: 'none',
                borderLeft: i > 0 ? '0.5px solid #ccc' : 'none',
                background: showDetailMode === opt.key ? '#1a3a5c' : 'white',
                color: showDetailMode === opt.key ? 'white' : '#333',
                cursor: 'pointer',
              }}
            >{opt.label}</button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, background: 'white', borderRadius: '12px', border: '0.5px solid #e8e8e8', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '0.5px solid #e8e8e8', gap: '6px' }}> {/* MARKER_VATWATCHLISTOPS_RESTORE_DETAIL_SEARCH_V1 */}
          <div style={{ position: 'relative', flex: '0 1 280px' }}> {/* MARKER_VATWATCHLISTOPS_DETAIL_SEARCH_CLEAR_V1 */}
            <input
              type="text"
              value={detailSearch}
              onChange={(e) => setDetailSearch(stripBlacklistedSearchWords(e.target.value))} // MARKER_VATWATCHLISTOPS_SEARCH_BLACKLIST_WORDS_V1
              placeholder="Search"
              style={{ width: '100%', padding: '6px 26px 6px 10px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '8px', outline: 'none', boxSizing: 'border-box' }}
            />
            {detailSearch && (
              <button
                type="button"
                onClick={() => setDetailSearch('')}
                style={{ position: 'absolute', right: '4px', top: '50%', transform: 'translateY(-50%)', width: '20px', height: '20px', padding: 0, border: 'none', borderRadius: '50%', background: '#e8e8e8', color: '#666', fontSize: '12px', lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >✕</button>
            )}
          </div>
          {/* MARKER_VATWATCHLISTOPS_TYPE_SUBTYPE_TREE_V1 — Type ▸ Subtype Tree Checkbox */}
          <div ref={typeDropdownRef} style={{ position: 'relative', flexShrink: 0, width: '160px' }}>
            <button
              type="button"
              onClick={() => { setTypeDropdownOpen((v) => !v); setFocusedTypeIndex(-1); }}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 14px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '8px', background: 'white', cursor: 'pointer', width: '100%', boxSizing: 'border-box', justifyContent: 'space-between' }}
            >
              <span>Type</span>
              {selectedSubtypeKeys.size > 0 && (
                <span style={{ background: '#1a3a5c', color: 'white', fontSize: '10px', padding: '1px 6px', borderRadius: '10px' }}>{selectedSubtypeKeys.size}</span>
              )}
              <span style={{ fontSize: '10px', color: '#999' }}>▾</span>
            </button>
            {typeDropdownOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ position: 'absolute', top: '100%', left: 0, marginTop: '4px', background: 'white', border: '0.5px solid #ccc', borderRadius: '8px', width: '100%', boxSizing: 'border-box', maxHeight: '300px', display: 'flex', flexDirection: 'column', zIndex: 20, boxShadow: '0 6px 16px rgba(0,0,0,0.18)' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', borderBottom: '0.5px solid #eee', flexShrink: 0 }}>
                  <button type="button" onClick={clearTypeSubtypeFilter} style={{ fontSize: '11px', border: 'none', background: 'transparent', color: '#1a3a5c', cursor: 'pointer' }}>ล้าง Filter</button>
                  <button type="button" onClick={() => setTypeDropdownOpen(false)} style={{ fontSize: '11px', border: 'none', background: 'transparent', color: '#999', cursor: 'pointer' }}>ปิด</button>
                </div>
                <div style={{ overflowY: 'auto', flex: 1 }}>
                  {typeTree.map((typeNode) => {
                    const state = typeCheckState(typeNode);
                    const hasMultiple = typeNode.subtypes.length > 1;
                    const isExpanded = !!expandedTypes[typeNode.type];
                    const typeFlatIdx = typeDropdownFlatRows.findIndex((r) => r.kind === 'type' && r.typeNode === typeNode);
                    const typeIsFocused = typeFlatIdx === focusedTypeIndex;
                    return (
                      <div
                        key={typeNode.type}
                        onMouseEnter={() => hasMultiple && setExpandedTypes((prev) => ({ ...prev, [typeNode.type]: true }))}
                        onMouseLeave={() => hasMultiple && setExpandedTypes((prev) => ({ ...prev, [typeNode.type]: false }))}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 8px', fontSize: '12px', fontWeight: '600', background: typeIsFocused ? '#e8f0fa' : '#f9f9f9' }}>
                          {hasMultiple ? (
                            <button type="button" onClick={() => toggleExpandType(typeNode.type)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, fontSize: '10px' }}>{isExpanded ? '▾' : '▸'}</button>
                          ) : (
                            <span style={{ width: '10px', display: 'inline-block' }} />
                          )}
                          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', flex: 1 }}>
                            <input
                              type="checkbox"
                              checked={state === 'all'}
                              ref={(el) => { if (el) el.indeterminate = state === 'partial'; }}
                              onChange={() => toggleType(typeNode)}
                            />
                            <span>{typeNode.type} ({typeNode.count})</span>
                          </label>
                        </div>
                        {hasMultiple && isExpanded && typeNode.subtypes.map((s) => {
                          const key = `${typeNode.type}|||${s.subtype}`;
                          const subFlatIdx = typeDropdownFlatRows.findIndex((r) => r.kind === 'subtype' && r.typeNode === typeNode && r.subtype === s);
                          const subIsFocused = subFlatIdx === focusedTypeIndex;
                          return (
                            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 8px 5px 26px', fontSize: '12px', cursor: 'pointer', background: subIsFocused ? '#e8f0fa' : 'transparent' }}>
                              <input type="checkbox" checked={selectedSubtypeKeys.has(key)} onChange={() => toggleSubtype(typeNode.type, s.subtype)} />
                              <span>{s.subtype} ({s.count})</span>
                            </label>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', border: '0.5px solid #ccc', borderRadius: '8px', overflow: 'hidden', flexShrink: 0 }}>
            {AGING_BUCKETS.map((b) => {
              const active = selectedAgingBuckets.has(b.key);
              const cnt = agingBucketCounts[b.key];
              const isEmpty = cnt === 0;
              return (
                <button
                  key={b.key}
                  type="button"
                  disabled={isEmpty}
                  onClick={() => toggleAgingBucket(b.key)}
                  style={{ padding: '6px 10px', fontSize: '11px', fontWeight: active ? '700' : '400', border: 'none', cursor: isEmpty ? 'not-allowed' : 'pointer', background: active ? b.bg : 'white', color: isEmpty ? '#ccc' : (active ? b.color : '#999') }}
                >
                  {b.label} ({cnt != null ? cnt : '...'})
                </button>
              );
            })}
          </div>
          <div style={{ flex: 1 }} />
          {selectedNoteRows.size > 0 && ( // MARKER_VATWATCHLISTOPS_GROUP_NOTE_SELECT_V1
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              <span style={{ fontSize: '12px', color: '#666' }}>เลือกแล้ว {selectedNoteRows.size} รายการ (คลิกขวาที่แถวเพื่อเปิดเมนู)</span> {/* MARKER_VATWATCHLISTOPS_ROW_CONTEXT_MENU_V1 -- ย้ายปุ่ม Group Note/ล้างการเลือก ไปเมนูคลิกขวา */}
            </div>
          )}
          <button onClick={() => setShowConfigModal(true)} style={{ padding: '6px 12px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '8px', background: 'white', cursor: 'pointer', flexShrink: 0, width: '148px', textAlign: 'center' }}>⚙ Config Columns</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: '12px', whiteSpace: 'nowrap' }}> {/* MARKER_VATWATCHLISTOPS_INCOMPLETE_STICKY_HEADER_FIX_V1 */}
              <thead> {/* MARKER_VATWATCHLISTOPS_INCOMPLETE_HEADER_ALWAYS_VISIBLE_V1 */}
                <tr>
                  <th style={{ position: 'sticky', top: 0, zIndex: 1, padding: '8px 6px', background: '#1a3a5c', color: 'white', fontWeight: '500', textAlign: 'center', width: '34px' }}> {/* MARKER_VATWATCHLISTOPS_GROUP_NOTE_SELECT_V1 */}
                    <input type="checkbox" checked={detailRows.length > 0 && detailRows.every((r) => selectedNoteRows.has(getNoteKey(r)))} ref={(el) => { if (el) el.indeterminate = !detailRows.every((r) => selectedNoteRows.has(getNoteKey(r))) && detailRows.some((r) => selectedNoteRows.has(getNoteKey(r))); }} onChange={toggleSelectAllOnPage} />
                  </th>
                  {activeCols.map((c) => {
                    const isFiltered = !!(columnFilters[c.key] && columnFilters[c.key].size > 0);
                    const isOpen = openFilterKey === c.key;
                    const distinctEntry = columnDistinctCache[c.key];
                    const isDistinctLoading = !!columnDistinctLoading[c.key];
                    return (
                      <th
                        key={c.key}
                        onClick={() => openFilterDropdown(c.key, isOpen)}
                        style={{ position: 'sticky', top: 0, zIndex: 1, padding: 0, background: '#1a3a5c', color: 'white', fontWeight: '500', textAlign: 'left', cursor: 'pointer' }}
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
              <tbody ref={detailTbodyRef} onMouseUp={handleDetailTbodyMouseUp}> {/* MARKER_VATWATCHLISTOPS_TEXT_SELECTION_AUTO_CHECK_V1 */}
                {loadingDetail ? (
                  <tr><td colSpan={activeCols.length + 1} style={{ padding: '40px', textAlign: 'center', color: '#999', fontSize: '13px' }}>กำลังโหลด...</td></tr>
                ) : detailTotalCount === 0 ? (
                  <tr><td colSpan={activeCols.length + 1} style={{ padding: '40px', textAlign: 'center', color: '#999', fontSize: '13px' }}>
                    {detailSearchDebounced.trim() || Object.keys(columnFilters).length > 0 ? 'ไม่พบรายการที่ตรงกับคำค้นหา' : 'ไม่มีข้อมูล Incomplete สำหรับ BU นี้'}
                  </td></tr>
                ) : displayDetailRows.map((row, i) => { // MARKER_VATWATCHLISTOPS_SHOW_DETAIL_FILTER_V1
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
                    <tr
                      key={row.id || i}
                      data-row-key={getNoteKey(row)}
                      className="vwl-incomplete-row"
                      title={noteHighlight ? noteTitle : undefined}
                      style={{ background: rowBg, borderTop: '0.5px solid #e8e8e8', cursor: 'pointer' }}
                      onMouseDown={(e) => { if (e.detail > 1 && !e.target.closest('input, button, a')) e.preventDefault(); }} // MARKER_VATWATCHLISTOPS_ROW_DBLCLICK_NO_TEXTSELECT_V1 -- กัน Browser เลือกคำ + Windows Toolbar เด้งตอน Double-click
                      onDoubleClick={(e) => { if (e.target.closest('input, button, a')) return; toggleSelectNoteRow(row); }} // MARKER_VATWATCHLISTOPS_ROW_DBLCLICK_SELECT_V1
                      onContextMenu={(e) => handleRowContextMenu(e, row)} // MARKER_VATWATCHLISTOPS_DRAG_RANGE_SELECT_V1 -- Drag-select หลายแถวแล้วคลิกขวา = เลือกทั้งช่วง
                      onMouseEnter={(e) => { // MARKER_VATWATCHLISTOPS_CHECKBOX_DRAG_SELECT_V1 -- ลากผ่านแถวขณะกดเมาส์ซ้ายค้าง = ติ๊ก/ถอด Checkbox ตามโหมดที่เริ่มไว้
                        if (e.buttons !== 1 || !dragCheckboxModeRef.current) return;
                        const key = getNoteKey(row);
                        setSelectedNoteRows((prev) => {
                          const already = prev.has(key);
                          if (dragCheckboxModeRef.current === 'add' && already) return prev;
                          if (dragCheckboxModeRef.current === 'remove' && !already) return prev;
                          const next = new Map(prev);
                          if (dragCheckboxModeRef.current === 'add') next.set(key, { invoice_ref: row.invoice_ref, supplier_code: row.supplier_code, branch: row.branch, vendor_name: row.vendor_name, check_no: row.check_no, exp_amount: row.exp_amount, exp_vat: row.exp_vat, receive_doc_no: row.receive_doc_no, payment_date: row.payment_date }); // MARKER_VATWATCHLISTOPS_QUICK_ACTION_FIX_TARGETS_V1
                          else next.delete(key);
                          return next;
                        });
                      }}
                    >
                      <td style={{ padding: '4px', textAlign: 'center' }}> {/* MARKER_VATWATCHLISTOPS_GROUP_NOTE_SELECT_V1 */}
                        <input
                          type="checkbox"
                          checked={selectedNoteRows.has(getNoteKey(row))}
                          onChange={() => {}} // MARKER_VATWATCHLISTOPS_CHECKBOX_MANUAL_CONTROL_V2 -- Toggle จริงทำใน onMouseDown ทั้งหมด กัน React Warning เรื่อง Controlled Input ไม่มี onChange
                          onMouseDown={(e) => { // MARKER_VATWATCHLISTOPS_CHECKBOX_MANUAL_CONTROL_V2 -- คุมเองทั้งหมด (คลิกเดี่ยว/Shift+Click/เริ่ม Drag) ไม่พึ่ง Native Click อีกต่อไป กันปัญหา Browser ไม่ยิง Click ตอนลาก
                            e.preventDefault(); // กัน Native Toggle + Focus + Text Selection ทั้งหมด
                            const key = getNoteKey(row);
                            if (e.shiftKey && lastClickedRowKeyRef.current && lastClickedRowKeyRef.current !== key) {
                              const keys = detailRows.map(getNoteKey);
                              const fromIdx = keys.indexOf(lastClickedRowKeyRef.current);
                              const toIdx = keys.indexOf(key);
                              if (fromIdx !== -1 && toIdx !== -1) {
                                const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
                                const rangeRows = detailRows.slice(start, end + 1);
                                setSelectedNoteRows((prev) => {
                                  const next = new Map(prev);
                                  rangeRows.forEach((r) => next.set(getNoteKey(r), { invoice_ref: r.invoice_ref, supplier_code: r.supplier_code, branch: r.branch, vendor_name: r.vendor_name, check_no: r.check_no, exp_amount: r.exp_amount, exp_vat: r.exp_vat, receive_doc_no: r.receive_doc_no, payment_date: r.payment_date })); // MARKER_VATWATCHLISTOPS_QUICK_ACTION_FIX_TARGETS_V1
                                  return next;
                                });
                              }
                              return;
                            }
                            const willAdd = !selectedNoteRows.has(key);
                            dragCheckboxModeRef.current = willAdd ? 'add' : 'remove'; // MARKER_VATWATCHLISTOPS_CHECKBOX_DRAG_SELECT_V1 -- ตั้งโหมดสำหรับแถวถัดไปที่ลากผ่าน
                            lastClickedRowKeyRef.current = key; // จำไว้เป็น Anchor สำหรับ Shift+Click ครั้งถัดไป
                            setSelectedNoteRows((prev) => {
                              const next = new Map(prev);
                              if (willAdd) next.set(key, { invoice_ref: row.invoice_ref, supplier_code: row.supplier_code, branch: row.branch, vendor_name: row.vendor_name, check_no: row.check_no, exp_amount: row.exp_amount, exp_vat: row.exp_vat, receive_doc_no: row.receive_doc_no, payment_date: row.payment_date }); // MARKER_VATWATCHLISTOPS_QUICK_ACTION_FIX_TARGETS_V1
                              else next.delete(key);
                              return next;
                            });
                          }}
                        />
                      </td>
                      {/* MARKER_VATWATCHLISTOPS_NOTES_REMAP_LEGACY_COLS_V1 */}
                      {activeCols.map((c) => {
                        // MARKER_VATWATCHLISTOPS_NOTES_REMAP_LEGACY_COLS_V1 -- Column "remark"/"note" เดิม (ว่างตลอด) ดึงจาก noteEntry แทน row
                        // MARKER_VATWATCHLISTOPS_INCOMPLETE_NUMBER_DATE_FORMAT_V1 -- ตัวเลข Comma+ชิดขวา, วันที่กึ่งกลาง
                        let cellValue;
                        let cellAlign;
                        if (c.key === 'remark') cellValue = (noteEntry && noteEntry.remark) || '';
                        else if (c.key === 'note') cellValue = (noteEntry && noteEntry.note) || '';
                        else if (VAT_INCOMPLETE_DATE_KEYS.has(c.key)) { cellValue = formatVatIncompleteDate(row[c.key]); cellAlign = 'center'; }
                        else if (VAT_INCOMPLETE_NUMBER_KEYS.has(c.key)) {
                          const numVal = row[c.key];
                          cellValue = (numVal === null || numVal === undefined || numVal === '') ? '' : Number(numVal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                          cellAlign = 'right';
                        }
                        else cellValue = row[c.key] ?? '';
                        return <td key={c.key} style={{ padding: '7px 10px', textAlign: cellAlign }}>{cellValue}</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
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

      {/* MARKER_VATWATCHLISTOPS_ROW_CONTEXT_MENU_V1 -- เมนูคลิกขวา แทนปุ่ม Group Note/ล้างการเลือก/note เดิม */}
      {rowContextMenu && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ position: 'fixed', top: rowContextMenu.y, left: rowContextMenu.x, background: 'white', border: '0.5px solid #ccc', borderRadius: '8px', boxShadow: '0 6px 16px rgba(0,0,0,0.18)', zIndex: 1000, minWidth: '210px', overflow: 'hidden', fontSize: '13px' }}
        >
          <div
            onClick={() => { openQuickAction(rowContextMenu.row); closeRowContextMenu(); }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f5f5'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            style={{ padding: '9px 14px', cursor: 'pointer' }}
          >⚡ Quick Action</div> {/* MARKER_VATWATCHLISTOPS_QUICK_ACTION_V1 MARKER_VATWATCHLISTOPS_CONTEXT_MENU_REORDER_V1 -- ย้ายขึ้นอันดับ 1 เสมอ */}
          <div
            onClick={() => {
              const targets = (selectedNoteRows.size > 0 && selectedNoteRows.has(getNoteKey(rowContextMenu.row)))
                ? Array.from(selectedNoteRows.values())
                : [rowContextMenu.row];
              const uniqueCheckNos = [...new Set(targets.map((r) => String(r.check_no || '').trim()).filter(Boolean))];
              setDetailSearch(uniqueCheckNos.join(','));
              closeRowContextMenu();
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f5f5'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            style={{ padding: '9px 14px', cursor: 'pointer', borderTop: '0.5px solid #eee' }}
          >🔎 Find by Check No.</div> {/* MARKER_VATWATCHLISTOPS_CONTEXT_MENU_FIND_BY_PAYMENT_V1 -- ดึงค่า เลขที่เช็ค (check_no) จากแถวที่เลือก (ค่าเดียวหรือหลายค่าไม่ซ้ำกัน) ไปใส่ช่อง Search */}
          {selectedNoteRows.size <= 1 && ( // MARKER_VATWATCHLISTOPS_CONTEXT_MENU_HIDE_SINGLE_NOTE_V1 -- เลือกมากกว่า 1 แถว ไม่ต้องขึ้นเมนูนี้ ให้ใช้ Group Note แทน
          <div
            onClick={() => { openNoteModal(rowContextMenu.row); closeRowContextMenu(); }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f5f5'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            style={{ padding: '9px 14px', cursor: 'pointer', borderTop: '0.5px solid #eee' }}
          >📝 เพิ่ม/แก้ไข Note (แถวนี้)</div>
          )}
          {selectedNoteRows.size > 1 && (
            <div
              onClick={() => { openGroupNoteModal(); closeRowContextMenu(); }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f5f5'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              style={{ padding: '9px 14px', cursor: 'pointer', borderTop: '0.5px solid #eee' }}
            >📋 Group Note ({selectedNoteRows.size} รายการ)</div>
          )}
          {selectedNoteRows.size > 0 && ( // MARKER_VATWATCHLISTOPS_EXPORT_EXCEL_V1
            <div
              onClick={() => { handleExportExcelSelected(); closeRowContextMenu(); }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f5f5'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              style={{ padding: '9px 14px', cursor: 'pointer', borderTop: '0.5px solid #eee' }}
            >📊 Export Excel ({selectedNoteRows.size} รายการ)</div>
          )}
          {selectedNoteRows.size > 0 && (
            <div
              onClick={() => { clearSelectedNoteRows(); closeRowContextMenu(); }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f5f5'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              style={{ padding: '9px 14px', cursor: 'pointer', borderTop: '0.5px solid #eee', color: '#a33' }}
            >✕ ล้างการเลือก</div>
          )}
        </div>
      )}

      {/* MARKER_VATWATCHLISTOPS_EXPORT_CONFIG_COLUMNS_V1 -- Modal Config - Columns Incomplete */}
      {showExportConfigModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
          <div style={{ background: 'white', borderRadius: '12px', width: '460px', maxWidth: '95vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '0.5px solid #e8e8e8', flexShrink: 0 }}>
              <div style={{ fontSize: '15px', fontWeight: '500' }}>Config - Columns Incomplete</div>
              <button onClick={() => setShowExportConfigModal(false)} style={{ width: '28px', height: '28px', padding: 0, border: 'none', borderRadius: '50%', background: '#f0f0f0', cursor: 'pointer', fontSize: '14px', color: '#666' }}>×</button>
            </div>
            <div style={{ padding: '16px 20px 8px' }}> {/* MARKER_VATWATCHLISTOPS_EXPORT_TEMPLATES_V1 */}
              <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Template</label>
              <select value={selectedExportTemplateId} onChange={(e) => setSelectedExportTemplateId(e.target.value)} style={{ width: '100%' }}>
                <option value="__builtin__">Config - Incomplete VAT</option>
                <option value="__expire_check_payment__">Config - Expire by Check Payment</option> {/* MARKER_VATWATCHLISTOPS_EXPIRE_CHECK_PAYMENT_TEMPLATE_V1 */}
                {exportTemplates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div style={{ padding: '8px 20px 16px' }}>
              <button type="button" onClick={openConfigNewTemplateModal} style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', border: 'none', background: 'transparent', color: '#1a3a5c', cursor: 'pointer', padding: 0 }}>+ Config New - Template</button>
            </div>
            <div style={{ padding: '14px 20px', borderTop: '0.5px solid #e8e8e8', display: 'flex', justifyContent: 'flex-end', gap: '8px', flexShrink: 0 }}>
              <button type="button" onClick={() => setShowExportConfigModal(false)} style={{ padding: '7px 14px', fontSize: '13px', border: '0.5px solid #ccc', borderRadius: '8px', background: 'white', cursor: 'pointer' }}>ยกเลิก</button>
              <button type="button" onClick={handleExportExcelFromConfig} style={{ padding: '7px 14px', fontSize: '13px', border: 'none', borderRadius: '8px', background: '#1a3a5c', color: 'white', cursor: 'pointer' }}>Export Excel</button>
            </div>
          </div>
        </div>
      )}

      {/* MARKER_VATWATCHLISTOPS_EXPORT_TEMPLATES_V1 -- Modal Config New - Template */}
      {showConfigNewTemplateModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200 }}>
          <div style={{ background: 'white', borderRadius: '12px', width: '560px', maxWidth: '95vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '0.5px solid #e8e8e8', flexShrink: 0 }}>
              <div style={{ fontSize: '15px', fontWeight: '500' }}>Config New - Template</div>
              <button onClick={() => setShowConfigNewTemplateModal(false)} style={{ width: '28px', height: '28px', padding: 0, border: 'none', borderRadius: '50%', background: '#f0f0f0', cursor: 'pointer', fontSize: '14px', color: '#666' }}>×</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              <div style={{ padding: '16px 20px 8px' }}>
                <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '6px' }}>ชื่อ Template</label>
                <input value={newTemplateName} onChange={(e) => setNewTemplateName(e.target.value)} placeholder="เช่น Outbound Matching" style={{ width: '100%', boxSizing: 'border-box' }} />
              </div>
              <div style={{ padding: '14px 20px 0' }}>
                <div style={{ fontSize: '11px', color: '#888', marginBottom: '8px' }}>1. Columns ที่มีอยู่แล้ว (ดึงข้อมูลจริงของแต่ละแถวเสมอ)</div>
                <div style={{ border: '0.5px solid #ccc', borderRadius: '8px', maxHeight: '160px', overflowY: 'auto', padding: '8px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
                  {VAT_INCOMPLETE_ALL_FIELDS.map((f) => (
                    <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '2px 0', cursor: 'pointer' }}>
                      <input type="checkbox" checked={newTemplateExistingCols.has(f.key)} onChange={() => toggleNewTemplateExistingCol(f.key)} />
                      {f.label}
                    </label>
                  ))}
                </div>
              </div>
              <div style={{ padding: '16px 20px 16px' }}>
                <div style={{ fontSize: '11px', color: '#888', marginBottom: '8px' }}>2. Columns ใหม่ (กำหนดเอง — ใส่ Default Data ทุกแถวเหมือนกัน)</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
                  {newTemplateCustomCols.map((c, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <input value={c.name} onChange={(e) => updateNewTemplateCustomCol(idx, 'name', e.target.value)} placeholder="ชื่อ Column" style={{ flex: 1, boxSizing: 'border-box' }} />
                      <input value={c.defaultValue} onChange={(e) => updateNewTemplateCustomCol(idx, 'defaultValue', e.target.value)} placeholder="Default Data" style={{ flex: 1.4, boxSizing: 'border-box' }} />
                      <button type="button" onClick={() => removeNewTemplateCustomCol(idx)} style={{ width: '32px', height: '32px', padding: 0, border: '0.5px solid #ccc', borderRadius: '6px', background: 'white', cursor: 'pointer', flexShrink: 0 }}>✕</button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={addNewTemplateCustomCol} style={{ fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '6px', background: 'white', padding: '6px 12px', cursor: 'pointer' }}>+ เพิ่ม Column ใหม่</button>
              </div>
            </div>
            <div style={{ padding: '14px 20px', borderTop: '0.5px solid #e8e8e8', display: 'flex', justifyContent: 'flex-end', gap: '8px', flexShrink: 0 }}>
              <button type="button" onClick={() => setShowConfigNewTemplateModal(false)} style={{ padding: '7px 14px', fontSize: '13px', border: '0.5px solid #ccc', borderRadius: '8px', background: 'white', cursor: 'pointer' }}>ยกเลิก</button>
              <button type="button" onClick={handleSaveNewTemplate} style={{ padding: '7px 14px', fontSize: '13px', border: 'none', borderRadius: '8px', background: '#1a3a5c', color: 'white', cursor: 'pointer' }}>บันทึก Template</button>
            </div>
          </div>
        </div>
      )}

      {/* MARKER_VATWATCHLISTOPS_DRAFT_MONITOR_V1 -- Popup Draft Monitor (3 Tab, ยังไม่มีเนื้อหา รอออกแบบต่อ) */}
      {showDraftMonitor && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1300 }}> {/* MARKER_VATWATCHLISTOPS_DRAFT_MONITOR_ZINDEX_FIX_V1 -- ยกสูงกว่า Full Page - Popvat กันโดนบัง */}
          <div style={{ background: 'white', borderRadius: '12px', width: '1400px', maxWidth: '95vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '0.5px solid #e8e8e8' }}>
              <div style={{ fontSize: '15px', fontWeight: '500' }}>Draft Monitor</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}> {/* MARKER_VATWATCHLISTOPS_DRAFT_MONITOR_POPVAT_TABLE_V1 -- ปุ่ม Restore ย้ายมาอยู่ Header แทน Column ต่อแถว */}
                {draftMonitorTab === 'popvat' && selectedDraftRows.size > 0 && (
                  <button type="button" onClick={handleRestoreSelectedDrafts} style={{ padding: '7px 14px', fontSize: '13px', border: 'none', borderRadius: '8px', background: '#1a3a5c', color: 'white', cursor: 'pointer' }}>Restore ({selectedDraftRows.size})</button>
                )}
                {draftMonitorTab === 'simple' && selectedDraftSimpleRows.size > 0 && ( // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_SIMPLE_RESTORE_CASCADE_V1
                  <button type="button" onClick={handleRestoreSelectedSimpleDrafts} style={{ padding: '7px 14px', fontSize: '13px', border: 'none', borderRadius: '8px', background: '#1a3a5c', color: 'white', cursor: 'pointer' }}>Restore ({selectedDraftSimpleRows.size})</button>
                )}
                {draftMonitorTab === 'adi' && selectedDraftAdiRows.size > 0 && ( // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_ADI_SELECT_RESTORE_V1
                  <button type="button" onClick={handleRestoreSelectedAdiDrafts} style={{ padding: '7px 14px', fontSize: '13px', border: 'none', borderRadius: '8px', background: '#1a3a5c', color: 'white', cursor: 'pointer' }}>Restore ({selectedDraftAdiRows.size})</button>
                )}
                <button onClick={() => setShowDraftMonitor(false)} style={{ width: '28px', height: '28px', padding: 0, border: 'none', borderRadius: '50%', background: '#f0f0f0', cursor: 'pointer', fontSize: '14px', color: '#666' }}>×</button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '4px', padding: '10px 20px 0', borderBottom: '0.5px solid #e8e8e8' }}>
              {[{ key: 'popvat', label: 'Upload Popvat' }, { key: 'simple', label: 'Upload Simple' }, { key: 'adi', label: 'Upload ADI' }].map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setDraftMonitorTab(t.key)}
                  style={{ padding: '9px 16px', fontSize: '13px', border: 'none', borderBottom: draftMonitorTab === t.key ? '2px solid #1a3a5c' : '2px solid transparent', background: 'transparent', cursor: 'pointer', color: draftMonitorTab === t.key ? '#1a3a5c' : '#888', fontWeight: draftMonitorTab === t.key ? '500' : '400' }}
                >{t.label}</button>
              ))}
              {draftMonitorTab === 'simple' && (
                <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto', paddingBottom: '6px' }}>
                  {[
                    { key: 'all', label: 'ทั้งหมด', bg: '#f0f0f0', fg: '#555', activeBg: '#1a3a5c', activeFg: 'white' },
                    { key: 'Invoice', label: 'Invoice', bg: '#e8f5e9', fg: '#1e7e34', activeBg: '#2e7d32', activeFg: 'white' },
                    { key: 'Credit', label: 'Credit', bg: '#fdecea', fg: '#c0392b', activeBg: '#c0392b', activeFg: 'white' },
                  ].map((st) => (
                    <button
                      key={st.key}
                      type="button"
                      onClick={() => setSimpleTypeFilter(st.key)}
                      style={{ padding: '6px 14px', fontSize: '12px', border: 'none', borderRadius: '14px', cursor: 'pointer', fontWeight: 500, background: simpleTypeFilter === st.key ? st.activeBg : st.bg, color: simpleTypeFilter === st.key ? st.activeFg : st.fg }}
                    >{st.label}</button>
                  ))}
                </div>
              )}
            </div>
            {draftMonitorTab === 'popvat' ? ( // MARKER_VATWATCHLISTOPS_DRAFT_MONITOR_POPVAT_TABLE_V1
              <div style={{ flex: 1, minHeight: '360px', overflow: 'auto', padding: '0 20px 20px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', whiteSpace: 'nowrap' }}>
                  <thead>
                    <tr>
                      <th style={{ position: 'sticky', top: 0, zIndex: 1, padding: '8px 6px', background: '#1a3a5c', color: 'white', fontWeight: '500', textAlign: 'center', width: '34px' }}>
                        <input type="checkbox" checked={draftPopvatRows.length > 0 && draftPopvatRows.every((r) => selectedDraftRows.has(r.id))} onChange={toggleSelectAllDraftPopvat} />
                      </th>
                      {POPVAT_DRAFT_COLUMNS.map((c) => (
                        <th key={c.key} style={{ position: 'sticky', top: 0, zIndex: 1, padding: '8px 10px', background: '#1a3a5c', color: 'white', fontWeight: '500', textAlign: 'left' }}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {draftPopvatLoading ? (
                      <tr><td colSpan={POPVAT_DRAFT_COLUMNS.length + 1} style={{ padding: '40px', textAlign: 'center', color: '#999', fontSize: '13px' }}>กำลังโหลด...</td></tr>
                    ) : draftPopvatRows.length === 0 ? (
                      <tr><td colSpan={POPVAT_DRAFT_COLUMNS.length + 1} style={{ padding: '40px', textAlign: 'center', color: '#999', fontSize: '13px' }}>ยังไม่มีข้อมูล Draft</td></tr>
                    ) : draftPopvatRows.map((row) => (
                      <tr key={row.id} style={{ borderTop: '0.5px solid #e8e8e8' }}>
                        <td style={{ padding: '4px', textAlign: 'center' }}>
                          <input type="checkbox" checked={selectedDraftRows.has(row.id)} onChange={() => toggleSelectDraftRow(row.id)} />
                        </td>
                        {POPVAT_DRAFT_COLUMNS.map((c) => ( // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_POPVAT_BLANK_NULL_V1 -- ปล่อยว่างแทน — เมื่อไม่มีข้อมูล
                          <td key={c.key} style={{ padding: '7px 10px' }}>{row[c.key] || ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : draftMonitorTab === 'simple' ? ( // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_SIMPLE_ADI_HEADERS_V1 -- หัว Columns ตาม Schema vat_simpleinputdraft (26 Column)
              <div style={{ flex: 1, minHeight: '360px', overflow: 'auto', padding: '0 20px 20px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', whiteSpace: 'nowrap' }}>
                  <thead>
                    <tr>
                      <th style={{ position: 'sticky', top: 0, zIndex: 1, padding: '8px 6px', background: '#1a3a5c', color: 'white', fontWeight: '500', textAlign: 'center', width: '34px' }}> {/* MARKER_VATWATCHLISTOPS_DRAFTMONITOR_SIMPLE_RESTORE_CASCADE_V1 */}
                        <input type="checkbox" checked={draftSimpleRows.length > 0 && draftSimpleRows.every((r) => selectedDraftSimpleRows.has(r.id))} onChange={toggleSelectAllDraftSimple} />
                      </th>
                      {SIMPLE_DRAFT_COLUMNS.map((c) => (
                        <th key={c.key} style={{ position: 'sticky', top: 0, zIndex: 1, padding: '8px 10px', background: '#1a3a5c', color: 'white', fontWeight: '500', textAlign: 'left' }}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => { const filteredSimpleRowsFP = simpleTypeFilter === 'all' ? draftSimpleRows : draftSimpleRows.filter((r) => r.invoice_ref === simpleTypeFilter);
                    return draftSimpleLoading ? (
                      <tr><td colSpan={SIMPLE_DRAFT_COLUMNS.length + 1} style={{ padding: '40px', textAlign: 'center', color: '#999', fontSize: '13px' }}>กำลังโหลด...</td></tr>
                    ) : filteredSimpleRowsFP.length === 0 ? (
                      <tr><td colSpan={SIMPLE_DRAFT_COLUMNS.length + 1} style={{ padding: '40px', textAlign: 'center', color: '#999', fontSize: '13px' }}>ยังไม่มีข้อมูล Draft</td></tr>
                    ) : filteredSimpleRowsFP.map((row) => { // MARKER_VATWATCHLIST_DRAFTMONITOR_SIMPLE_HIGHLIGHT_V1
                      const rowBgFP = row.invoice_ref === 'Invoice' ? '#e8f5e9' : row.invoice_ref === 'Credit' ? '#fdecea' : 'white';
                      return (
                      <tr key={row.id} style={{ borderTop: '0.5px solid #e8e8e8', background: rowBgFP }}>
                        <td style={{ padding: '4px', textAlign: 'center' }}>
                          <input type="checkbox" checked={selectedDraftSimpleRows.has(row.id)} onChange={() => toggleSelectDraftSimpleRow(row.id)} />
                        </td>
                        {SIMPLE_DRAFT_COLUMNS.map((c) => {
                          const isNumericColFP = c.key === 'amount_ex_vat' || c.key === 'vat_amount';
                          const isDateColFP = c.key === 'receive_date' || c.key === 'tax_invoice_date';
                          const numValFP = isNumericColFP ? Math.abs(Number(row[c.key])) : null;
                          const displayValFP = isNumericColFP
                            ? (row[c.key] != null && !Number.isNaN(numValFP) ? numValFP.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '')
                            : isDateColFP
                              ? (formatQuickActionReceiveDateText(row[c.key]) || '')
                              : (row[c.key] ?? '');
                          return (
                            <td key={c.key} style={{ padding: '7px 10px', textAlign: isNumericColFP ? 'right' : 'left' }}>{displayValFP}</td>
                          );
                        })}
                      </tr>
                      );
                    }); })()}
                  </tbody>
                </table>
              </div>
            ) : draftMonitorTab === 'adi' ? ( // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_SIMPLE_ADI_HEADERS_V1 -- หัว Columns ตาม Schema vat_adi_transferdraft (19 Column)
              <div style={{ flex: 1, minHeight: '360px', overflow: 'auto', padding: '0 20px 20px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', whiteSpace: 'nowrap' }}>
                  <thead>
                    <tr>
                      <th style={{ position: 'sticky', top: 0, zIndex: 1, padding: '8px 6px', background: '#1a3a5c', color: 'white', fontWeight: '500', textAlign: 'center', width: '34px' }}> {/* MARKER_VATWATCHLISTOPS_DRAFTMONITOR_ADI_SELECT_RESTORE_V1 */}
                        <input type="checkbox" checked={draftAdiRows.length > 0 && draftAdiRows.every((r) => selectedDraftAdiRows.has(r.id))} onChange={toggleSelectAllDraftAdi} />
                      </th>
                      {[
                        'Category', 'Source', 'Acc Date', 'Bus', 'Grp', 'Com', 'Branch', 'CPC', 'Acc', 'Sub_Acc',
                        'Debit', 'Credit', 'Period', 'Batch Name', 'Batch Description', 'Journal Name', 'Journal Description', // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_ADI_ADD_PERIOD_V1 -- เพิ่ม Period กลับเข้ามา (หายไปจาก List เดิม)
                        'Line Description', 'Line DFF', // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_ADI_REMOVE_BRANCHIND_V1 -- เอา Branch Indicator ออก
                      ].map((label) => (
                        <th key={label} style={{ position: 'sticky', top: 0, zIndex: 1, padding: '8px 10px', background: '#1a3a5c', color: 'white', fontWeight: '500', textAlign: 'left' }}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {draftAdiLoading ? ( // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_ADI_DISPLAY_V1
                      <tr><td colSpan={20} style={{ padding: '40px', textAlign: 'center', color: '#999', fontSize: '13px' }}>กำลังโหลด...</td></tr>
                    ) : draftAdiRows.length === 0 ? (
                      <tr><td colSpan={20} style={{ padding: '40px', textAlign: 'center', color: '#999', fontSize: '13px' }}>ยังไม่มีข้อมูล Draft</td></tr>
                    ) : (() => { // MARKER_VATWATCHLISTOPS_ADI_HIGHLIGHT_BY_DRAFTID_V1 -- Highlight กลุ่มตาม draft_id เดียวกัน (Transaction เดียวกัน) แทนการนับคู่แถว
                      let groupIdxAdiFP = -1;
                      let lastDraftIdAdiFP = null;
                      return draftAdiRows.map((row) => {
                        if (row.draft_id !== lastDraftIdAdiFP) { groupIdxAdiFP += 1; lastDraftIdAdiFP = row.draft_id; }
                        const bgAdiFP = groupIdxAdiFP % 2 === 0 ? 'white' : '#e3f2fd';
                        return (
                          <tr key={row.id} style={{ borderTop: '0.5px solid #e8e8e8', background: bgAdiFP }}>
                            <td style={{ padding: '4px', textAlign: 'center' }}> {/* MARKER_VATWATCHLISTOPS_DRAFTMONITOR_ADI_SELECT_RESTORE_V1 */}
                              <input type="checkbox" checked={selectedDraftAdiRows.has(row.id)} onChange={() => toggleSelectDraftAdiRow(row.id)} />
                            </td>
                            {ADI_DRAFT_COLUMNS.map((c) => ( // MARKER_VATWATCHLISTOPS_DRAFTMONITOR_ADI_BLANK_NULL_V1 -- ปล่อยว่างแทน — เมื่อไม่มีข้อมูล
                              <td key={c.key} style={{ padding: '7px 10px' }}>{row[c.key] ?? ''}</td>
                            ))}
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* MARKER_VATWATCHLISTOPS_FULLPAGE_POPVAT_V1 -- Popup Full Page - Popvat กว้าง x สูง เท่า Display พอดี */}
      {showFullPagePopvat && (
        <div style={{ position: 'fixed', inset: 0, background: 'white', display: 'flex', flexDirection: 'column', zIndex: 1000, width: '100vw', height: '100vh' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '0.5px solid #e8e8e8', flexShrink: 0 }}> {/* MARKER_VATWATCHLISTOPS_FULLPAGE_POPVAT_GET_DATA_V1 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}> {/* MARKER_VATWATCHLISTOPS_FULLPAGE_POPVAT_SHARED_FILTER_V1 -- ห่อ Search + Type Dropdown + Aging Bucket (Sync กับตารางหลัก) */}
            <div style={{ position: 'relative', flexShrink: 0, width: '280px' }}> {/* MARKER_VATWATCHLISTOPS_FULLPAGE_SEARCH_CLEAR_MATCH_INCOMPLETE_V1 -- วงกลม X ซ้อนในช่อง Search เหมือน MARKER_VATWATCHLISTOPS_DETAIL_SEARCH_CLEAR_V1 (Incomplete Detail) เป๊ะ */}
              <input
                type="text"
                value={detailSearch}
                onChange={(e) => setDetailSearch(stripBlacklistedSearchWords(e.target.value))} // MARKER_VATWATCHLISTOPS_FULLPAGE_SEARCH_SYNC_V1 -- ใช้ Blacklist ร่วมกับ Incomplete Detail
                placeholder="Search Invoice..."
                style={{ width: '100%', padding: '8px 26px 8px 12px', fontSize: '13px', border: '0.5px solid #ccc', borderRadius: '8px', outline: 'none', boxSizing: 'border-box' }}
              />
              {detailSearch && (
                <button
                  type="button"
                  onClick={() => setDetailSearch('')}
                  style={{ position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)', width: '20px', height: '20px', padding: 0, border: 'none', borderRadius: '50%', background: '#e8e8e8', color: '#666', fontSize: '12px', lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >✕</button>
              )}
            </div>
            <div ref={typeDropdownRefFullPage} style={{ position: 'relative', flexShrink: 0, width: '160px' }}>
              <button
                type="button"
                onClick={() => { setTypeDropdownOpen((v) => !v); setFocusedTypeIndex(-1); }}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 14px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '8px', background: 'white', cursor: 'pointer', width: '100%', boxSizing: 'border-box', justifyContent: 'space-between' }}
              >
                <span>Type</span>
                {selectedSubtypeKeys.size > 0 && (
                  <span style={{ background: '#1a3a5c', color: 'white', fontSize: '10px', padding: '1px 6px', borderRadius: '10px' }}>{selectedSubtypeKeys.size}</span>
                )}
                <span style={{ fontSize: '10px', color: '#999' }}>▾</span>
              </button>
              {typeDropdownOpen && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{ position: 'absolute', top: '100%', left: 0, marginTop: '4px', background: 'white', border: '0.5px solid #ccc', borderRadius: '8px', width: '100%', boxSizing: 'border-box', maxHeight: '300px', display: 'flex', flexDirection: 'column', zIndex: 1100, boxShadow: '0 6px 16px rgba(0,0,0,0.18)' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', borderBottom: '0.5px solid #eee', flexShrink: 0 }}>
                    <button type="button" onClick={clearTypeSubtypeFilter} style={{ fontSize: '11px', border: 'none', background: 'transparent', color: '#1a3a5c', cursor: 'pointer' }}>ล้าง Filter</button>
                    <button type="button" onClick={() => setTypeDropdownOpen(false)} style={{ fontSize: '11px', border: 'none', background: 'transparent', color: '#999', cursor: 'pointer' }}>ปิด</button>
                  </div>
                  <div style={{ overflowY: 'auto', flex: 1 }}>
                    {typeTree.map((typeNode) => {
                      const state = typeCheckState(typeNode);
                      const hasMultiple = typeNode.subtypes.length > 1;
                      const isExpanded = !!expandedTypes[typeNode.type];
                      return (
                        <div
                          key={typeNode.type}
                          onMouseEnter={() => hasMultiple && setExpandedTypes((prev) => ({ ...prev, [typeNode.type]: true }))}
                          onMouseLeave={() => hasMultiple && setExpandedTypes((prev) => ({ ...prev, [typeNode.type]: false }))}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 8px', fontSize: '12px', fontWeight: '600', background: '#f9f9f9' }}>
                            {hasMultiple ? (
                              <button type="button" onClick={() => toggleExpandType(typeNode.type)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, fontSize: '10px' }}>{isExpanded ? '▾' : '▸'}</button>
                            ) : (
                              <span style={{ width: '10px', display: 'inline-block' }} />
                            )}
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', flex: 1 }}>
                              <input
                                type="checkbox"
                                checked={state === 'all'}
                                ref={(el) => { if (el) el.indeterminate = state === 'partial'; }}
                                onChange={() => toggleType(typeNode)}
                              />
                              <span>{typeNode.type} ({typeNode.count})</span>
                            </label>
                          </div>
                          {hasMultiple && isExpanded && typeNode.subtypes.map((s) => {
                            const key = `${typeNode.type}|||${s.subtype}`;
                            return (
                              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 8px 5px 26px', fontSize: '12px', cursor: 'pointer' }}>
                                <input type="checkbox" checked={selectedSubtypeKeys.has(key)} onChange={() => toggleSubtype(typeNode.type, s.subtype)} />
                                <span>{s.subtype} ({s.count})</span>
                              </label>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', border: '0.5px solid #ccc', borderRadius: '8px', overflow: 'hidden', flexShrink: 0 }}>
              {AGING_BUCKETS.map((b) => {
                const active = selectedAgingBuckets.has(b.key);
                const cnt = agingBucketCounts[b.key];
                const isEmpty = cnt === 0;
                return (
                  <button
                    key={b.key}
                    type="button"
                    disabled={isEmpty}
                    onClick={() => toggleAgingBucket(b.key)}
                    style={{ padding: '6px 10px', fontSize: '11px', fontWeight: active ? '700' : '400', border: 'none', cursor: isEmpty ? 'not-allowed' : 'pointer', background: active ? b.bg : 'white', color: isEmpty ? '#ccc' : (active ? b.color : '#999') }}
                  >
                    {b.label} ({cnt != null ? cnt : '...'})
                  </button>
                );
              })}
            </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                onClick={() => { // MARKER_VATWATCHLISTOPS_ADD_SUPPLIER_AUTOFILL_V1 MARKER_VATWATCHLISTOPS_ADDSUPPLIER_AUTOFILL_LOOKUP_V1 -- ดึง Supplier Code จาก addTaxInvoiceSupplierCode (Auto-detect) แทน Checkbox เดิม + Lookup vendorCategories -> Auto-fill Tax ID/Branch
                  // MARKER_VATWATCHLISTOPS_ADDSUPPLIER_FALLBACK_FULLPAGEROW_V1 -- ถ้า addTaxInvoiceSupplierCode ยังว่างอยู่ (ยังไม่ได้กรอก/เลือกใน Add Tax ด้านล่าง) ลอง Fallback ไปดึงจาก supplier_code ที่ติดมากับแถว Invoice ที่กำลังโชว์อยู่แล้ว (fullPagePopvatRows) แทนที่จะปล่อย Form ว่างเปล่าไปเลย
                  const code = String(addTaxInvoiceSupplierCode || '').trim() || String(fullPagePopvatRows[0]?.supplier_code || '').trim();
                  if (code) {
                    const matchedRow = fullPagePopvatRows.find((r) => String(r.supplier_code || '').trim() === code);
                    const matchedVendor = (vendorCategories || []).find((v) => String(v['Code'] || '').trim() === code); // MARKER_VATWATCHLISTOPS_ADDSUPPLIER_AUTOFILL_LOOKUP_V1 -- Lookup Vendor Category
                    setAddSupplierForm({
                      ...ADD_SUPPLIER_EMPTY_FORM,
                      'Supplier Code': code,
                      'Company Name': matchedRow ? (matchedRow.vendor_name || '') : '',
                      'Tax ID': matchedVendor ? (matchedVendor['TAX ID'] || '') : '', // MARKER_VATWATCHLISTOPS_ADDSUPPLIER_AUTOFILL_LOOKUP_V1 -- Auto-fill จาก Vendor Category ที่เจอ
                      'Branch': matchedVendor ? (matchedVendor['No.'] || '') : '',
                    });
                  } else {
                    setAddSupplierForm(ADD_SUPPLIER_EMPTY_FORM);
                  }
                  setShowAddSupplierModal(true);
                }}
                style={{ padding: '7px 12px', fontSize: '13px', border: '0.5px solid #a5d6a7', borderRadius: '8px', background: '#e8f5e9', color: '#2e7d32', cursor: 'pointer' }}
              >+ Add Supplier</button> {/* MARKER_VATWATCHLISTOPS_ADD_SUPPLIER_FORM_V1 */}
              <button onClick={() => setShowDraftMonitor(true)} style={{ padding: '7px 12px', fontSize: '13px', border: '0.5px solid #a5d6a7', borderRadius: '8px', background: '#e8f5e9', color: '#2e7d32', cursor: 'pointer' }}>Draft Monitor</button> {/* MARKER_VATWATCHLISTOPS_FULLPAGE_DRAFT_MONITOR_BUTTON_V1 -- ใช้ Modal/State เดียวกับปุ่มด้านนอก */}
              <div style={{ fontSize: '15px', fontWeight: '500' }}>Full Page - Popvat</div>
              <button onClick={() => { setShowFullPagePopvat(false); setFullPagePopvatDataFetched(false); }} style={{ width: '28px', height: '28px', padding: 0, border: 'none', borderRadius: '50%', background: '#f0f0f0', cursor: 'pointer', fontSize: '14px', color: '#666' }}>×</button>
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}> {/* MARKER_VATWATCHLISTOPS_FULLPAGE_POPVAT_BOX_55_50_V1 -- ห่อ Container เต็มพื้นที่ ให้ List เป็นกล่อง 55%x50% มุมซ้ายบน */} {/* MARKER_VATWATCHLISTOPS_FULLPAGE_BU_INFO_PANEL_V1 -- เพิ่ม position:relative ให้ Panel ขวา Absolute ได้ */}
            <div style={{ position: 'absolute', right: 0, top: 0, width: '38%', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '8px' }}> {/* MARKER_VATWATCHLISTOPS_FULLPAGE_RIGHT_PANEL_SPLIT_V1 -- Wrapper แบ่ง 3 กล่อง BU Info / Supplier / Action Calculate */}
              <div style={{ height: '39%', boxSizing: 'border-box', border: '0.5px solid #e0e0e0', borderRadius: '10px', boxShadow: '0 1px 3px rgba(16,24,40,0.08), 0 1px 2px rgba(16,24,40,0.04)', padding: '16px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}> {/* MARKER_VATWATCHLISTOPS_FULLPAGE_BU_INFO_PANEL_V1 MARKER_VATWATCHLISTOPS_FULLPAGE_POLISH_RIGHT_V1 MARKER_VATWATCHLISTOPS_BU_INFO_FULL_REDESIGN_V1 -- Flex Column */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', flexShrink: 0 }}> {/* MARKER_VATWATCHLISTOPS_FULLPAGE_POLISH_RIGHT_V1 MARKER_VATWATCHLISTOPS_BU_INFO_FULL_REDESIGN_V1 -- แท่งสีนำหัวข้อ */}
                  <span style={{ width: '3px', height: '14px', background: '#1a3a5c', borderRadius: '2px', display: 'inline-block' }} />
                  <div style={{ fontSize: '13px', fontWeight: '500', color: '#1a3a5c' }}>ข้อมูลของ BU</div>
                </div>
                {/* MARKER_VATWATCHLISTOPS_BU_INFO_REMOVE_OLD_FIELDS_V1 -- เดิมมี Company/Tax ID/BU/VAT %/Book อยู่ตรงนี้ เอาออกตามที่ขอ เหลือแค่ Company (Report Display) + Status ด้านล่าง */}
                {(() => { // MARKER_VATWATCHLISTOPS_BU_INFO_REPORT_STATUS_V1 -- แถวใหม่: Company (Report Display) + Status จาก Branch List (Column จริง ยืนยันจาก pgAdmin แล้ว)
                  const matchedBranchForStatus = addTaxInvoiceBranchListData.find((b) => String(b['Branch Code'] || '').trim() === String(addTaxInvoiceBrandCode || '').trim()); // MARKER_VATWATCHLISTOPS_BU_INFO_REPORT_STATUS_V1 -- ใช้ Brand Code ที่ระบบตรวจจับได้ Match กับ Branch List
                  const companyReportDisplay = matchedBranchForStatus ? (matchedBranchForStatus['Company for Show in Report Display'] || '') : ''; // MARKER_VATWATCHLISTOPS_BU_INFO_REPORT_STATUS_V1 -- Column จริงจาก branch_list ยืนยันแล้วจาก pgAdmin
                  const branchStatus = matchedBranchForStatus ? (matchedBranchForStatus.status || '') : '';
                  const buTaxId = matchedBranchForStatus ? (matchedBranchForStatus['BU-TaxID'] || '') : ''; // MARKER_VATWATCHLISTOPS_BU_INFO_ROW2_V1
                  const buBranch = matchedBranchForStatus ? (matchedBranchForStatus['BU-Branch'] || '') : '';
                  const buPct = matchedBranchForStatus ? (matchedBranchForStatus['%'] || '') : '';
                  const simpleCompany = matchedBranchForStatus ? (matchedBranchForStatus['Simple Company'] || '') : ''; // MARKER_VATWATCHLISTOPS_BU_INFO_ROW2_SIMPLECOMPANY_V1 -- Column จริงจาก branch_list ยืนยันจาก pgAdmin แล้ว
                  const branchAddress = matchedBranchForStatus ? (matchedBranchForStatus['Branch Address'] || '') : ''; // MARKER_VATWATCHLISTOPS_BU_INFO_ROW3_V1 -- Column จริงจาก branch_list ยืนยันจาก pgAdmin แล้ว
                  return (
                    <React.Fragment>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '16px', flexShrink: 0 }}> {/* MARKER_VATWATCHLISTOPS_BU_INFO_FULL_REDESIGN_V1 -- Company + Status Badge */}
                      <div>
                        <div style={{ fontSize: '11px', color: '#999', marginBottom: '2px' }}>Company (Report Display)</div>
                        <div style={{ fontSize: '14px', fontWeight: '500', color: '#1a3a5c' }}>{companyReportDisplay || '—'}</div>
                      </div>
                      <div style={{ background: branchStatus.toLowerCase() === 'closed' ? '#fce8e8' : '#eaf3e8', borderRadius: '20px', padding: '4px 12px', display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: branchStatus.toLowerCase() === 'closed' ? '#e5484d' : '#2e7d32', display: 'inline-block' }} />
                        <span style={{ fontSize: '12px', fontWeight: '500', color: branchStatus.toLowerCase() === 'closed' ? '#e5484d' : '#2e7d32' }}>{branchStatus || '—'}</span>
                      </div>
                    </div>
                    <div style={{ height: '1px', background: '#eef0f2', marginBottom: '16px', flexShrink: 0 }} /> {/* MARKER_VATWATCHLISTOPS_BU_INFO_FULL_REDESIGN_V1 -- เส้นแบ่ง */}
                    <div style={{ display: 'flex', gap: '20px', marginBottom: '16px', flexShrink: 0 }}> {/* MARKER_VATWATCHLISTOPS_BU_INFO_ROW2_V1 -- บรรทัดที่ 2: BU-Tax ID / BU-Branch / % / Simple Company */}
                      <div>
                        <div style={{ fontSize: '11px', color: '#999', marginBottom: '2px' }}>BU-Tax ID</div>
                        <div style={{ fontSize: '13px', fontWeight: '500', color: '#1a3a5c' }}>{buTaxId || '—'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '11px', color: '#999', marginBottom: '2px' }}>BU-Branch</div>
                        <div style={{ fontSize: '13px', fontWeight: '500', color: '#1a3a5c' }}>{buBranch || '—'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '11px', color: '#999', marginBottom: '2px' }}>%</div>
                        <div style={{ fontSize: '13px', fontWeight: '500', color: '#1a3a5c' }}>{buPct || '—'}</div>
                      </div>
                      <div> {/* MARKER_VATWATCHLISTOPS_BU_INFO_ROW2_SIMPLECOMPANY_V1 -- Simple Company เพิ่มเข้าแถวที่ 2 */}
                        <div style={{ fontSize: '11px', color: '#999', marginBottom: '2px' }}>Simple Company</div>
                        <div style={{ fontSize: '13px', fontWeight: '500', color: '#1a3a5c' }}>{simpleCompany || '—'}</div>
                      </div>
                    </div>
                    <div style={{ background: '#f8f9fb', borderRadius: '8px', padding: '14px 16px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 0 }}> {/* MARKER_VATWATCHLISTOPS_BU_INFO_ROW3_V1 MARKER_VATWATCHLISTOPS_BU_INFO_FULL_REDESIGN_V1 -- Branch Address ยืดเต็มพื้นที่ที่เหลือ */}
                      <div style={{ display: 'flex', gap: '10px' }}>
                        <div style={{ fontSize: '15px', marginTop: '1px', color: '#7b8794' }}>📍</div>
                        <div>
                          <div style={{ fontSize: '11px', color: '#999', marginBottom: '4px' }}>Branch Address</div>
                          <div style={{ fontSize: '13.5px', fontWeight: '500', color: '#1a3a5c', lineHeight: '1.65' }}>{branchAddress || '—'}</div>
                        </div>
                      </div>
                    </div>
                    </React.Fragment>
                  );
                })()}
              </div>
              <div style={{ height: '39%', boxSizing: 'border-box', border: '0.5px solid #e0e0e0', borderRadius: '10px', boxShadow: '0 1px 3px rgba(16,24,40,0.08), 0 1px 2px rgba(16,24,40,0.04)', padding: '16px 20px', overflowY: 'auto' }}> {/* MARKER_VATWATCHLISTOPS_FULLPAGE_RIGHT_PANEL_SPLIT_V1 MARKER_VATWATCHLISTOPS_SUPPLIER_DATA_LOOKUP_V1 -- ดึงข้อมูล Supplier จริงแล้ว */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                  <span style={{ width: '3px', height: '14px', background: '#a5c9e8', borderRadius: '2px', display: 'inline-block' }} />
                  <div style={{ fontSize: '13px', fontWeight: '500', color: '#1a3a5c' }}>Supplier</div>
                </div>
                {(() => {
                  const matchedSupplier = addTaxInvoiceSmCodeListData.find((s) => String(s['Supplier Code'] || '').trim() === String(addTaxInvoiceSupplierCode || '').trim()); // MARKER_VATWATCHLISTOPS_SUPPLIER_DATA_LOOKUP_V1
                  if (!addTaxInvoiceSupplierCode) {
                    return <div style={{ color: '#9aa0a6', fontSize: '12px', textAlign: 'center', padding: '20px 0' }}>ยังไม่มีข้อมูล<br />ลอง Search ในตาราง List ด้านบนก่อน</div>;
                  }
                  return (
                    <React.Fragment>
                      <div style={{ marginBottom: '12px' }}>
                        <div style={{ fontSize: '11px', color: '#999', marginBottom: '2px' }}>Company Name</div>
                        <div style={{ fontSize: '14px', fontWeight: '500', color: '#1a3a5c' }}>{matchedSupplier ? (matchedSupplier['Company Name'] || '—') : '—'}</div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: '10px', marginBottom: '12px' }}> {/* MARKER_VATWATCHLISTOPS_SUPPLIER_STACKED_TITLE_VALUE_V1 MARKER_VATWATCHLISTOPS_SUPPLIER_FIELDS_EDGE_TO_EDGE_V1 -- กระจายเต็มความกว้างจนสุดขอบ */}
                        {[
                          { label: 'Tax ID', value: matchedSupplier ? matchedSupplier['Tax ID'] : null },
                          { label: 'Branch', value: matchedSupplier ? matchedSupplier['Branch'] : null },
                          { label: 'Rule 1', value: matchedSupplier ? matchedSupplier['Special Rule1'] : null },
                          { label: 'Rule 2', value: matchedSupplier ? matchedSupplier['Special Rule2'] : null },
                          { label: 'Rule 3', value: matchedSupplier ? matchedSupplier['Simple Rule3'] : null },
                          { label: 'Rule 4', value: matchedSupplier ? matchedSupplier['Special Rule4'] : null },
                          { label: 'Rule 5', value: matchedSupplier ? matchedSupplier['Special Rule5'] : null },
                        ].map((f) => (
                          <div key={f.label}>
                            <div style={{ fontSize: '11px', color: '#999', marginBottom: '2px' }}>{f.label}</div>
                            <div style={{ fontSize: '13px', fontWeight: '500', color: '#1a3a5c' }}>{f.value || '—'}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ background: '#eef6fc', borderRadius: '8px', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}> {/* MARKER_VATWATCHLISTOPS_SUPPLIER_PARTS_DIGIT_BOX_V1 -- First Part/Mid Part/Last Part/Digit แทน Supplier Code */}
                        <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: '8px', marginRight: '12px' }}> {/* MARKER_VATWATCHLISTOPS_SUPPLIER_ADD_EXPENSETYPE_SPREAD_V1 -- เพิ่ม Expense Type + กระจายเต็มพื้นที่ */}
                          <div>
                            <div style={{ fontSize: '10.5px', color: '#9aa0a6', marginBottom: '2px' }}>First Part</div>
                            <div style={{ fontSize: '12.5px', fontWeight: '500', color: '#1a3a5c' }}>{matchedSupplier ? (matchedSupplier['First Part'] || '—') : '—'}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '10.5px', color: '#9aa0a6', marginBottom: '2px' }}>Mid Part</div>
                            <div style={{ fontSize: '12.5px', fontWeight: '500', color: '#1a3a5c' }}>{matchedSupplier ? (matchedSupplier['Mid Part'] || '—') : '—'}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '10.5px', color: '#9aa0a6', marginBottom: '2px' }}>Last Part</div>
                            <div style={{ fontSize: '12.5px', fontWeight: '500', color: '#1a3a5c' }}>{matchedSupplier ? (matchedSupplier['Last Part'] || '—') : '—'}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '10.5px', color: '#9aa0a6', marginBottom: '2px' }}>Digit</div>
                            <div style={{ fontSize: '12.5px', fontWeight: '500', color: '#1a3a5c' }}>{matchedSupplier ? (matchedSupplier['Digit'] || '—') : '—'}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '10.5px', color: '#9aa0a6', marginBottom: '2px' }}>Expense Type</div>
                            <div style={{ fontSize: '12.5px', fontWeight: '500', color: '#1a3a5c' }}>{matchedSupplier ? (matchedSupplier['Expense Type'] || '—') : '—'}</div>
                          </div>
                        </div>
                        {addTaxInvoiceDistinctSuppliers.length > 1 && (
                          <button type="button" onClick={() => setAddTaxInvoiceSupplierPickerOpen(true)} style={{ height: '26px', padding: '0 12px', borderRadius: '6px', border: 'none', background: '#1a3a5c', color: 'white', fontSize: '11px', fontWeight: '500', cursor: 'pointer', flexShrink: 0 }}>Change ({addTaxInvoiceDistinctSuppliers.length})</button>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}> {/* MARKER_VATWATCHLISTOPS_SUPPLIER_DR_CR_SIDEBYSIDE_LAYOUT_V1 -- Dr/Cr เรียงข้างกัน Title กึ่งกลาง */}
                        {[
                          { label: 'Dr', color: '#1565c0', bg: '#e3f2fd', cpc: [addTaxInvoiceSupplierCpcDr, setAddTaxInvoiceSupplierCpcDr], acc: [addTaxInvoiceSupplierAccountDr, setAddTaxInvoiceSupplierAccountDr], sub: [addTaxInvoiceSupplierSubDr, setAddTaxInvoiceSupplierSubDr] }, // MARKER_VATWATCHLISTOPS_SUPPLIER_DR_CR_TITLE_BG_V1 -- Dr พื้นฟ้าอ่อน
                          { label: 'Cr', color: '#e8820c', bg: '#fdf1e6', cpc: [addTaxInvoiceSupplierCpcCr, setAddTaxInvoiceSupplierCpcCr], acc: [addTaxInvoiceSupplierAccountCr, setAddTaxInvoiceSupplierAccountCr], sub: [addTaxInvoiceSupplierSubCr, setAddTaxInvoiceSupplierSubCr] }, // MARKER_VATWATCHLISTOPS_SUPPLIER_DR_CR_TITLE_BG_V1 -- Cr พื้นส้มอ่อน
                        ].map((g) => (
                          <div key={g.label} style={{ flex: 1, border: '0.5px solid #d8dbe0', borderRadius: '8px', overflow: 'hidden' }}> {/* MARKER_VATWATCHLISTOPS_SUPPLIER_DR_CR_TITLE_BG_V1 -- overflow:hidden กันแถบสีล้นมุมโค้ง */}
                            <div style={{ fontSize: '11px', fontWeight: '600', color: g.color, background: g.bg, padding: '6px 12px', textAlign: 'center' }}>Account {g.label}.</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 12px' }}>
                              <input value={g.cpc[0]} onChange={(e) => g.cpc[1](e.target.value)} style={{ border: 'none', outline: 'none', fontSize: '12px', fontWeight: '500', color: '#1a3a5c', padding: 0, background: 'transparent', width: '34%', textAlign: 'center' }} />
                              <span style={{ color: '#d8dbe0' }}>-</span>
                              <input value={g.acc[0]} onChange={(e) => g.acc[1](e.target.value)} style={{ border: 'none', outline: 'none', fontSize: '12px', fontWeight: '500', color: '#1a3a5c', padding: 0, background: 'transparent', flex: 1, textAlign: 'center' }} />
                              <span style={{ color: '#d8dbe0' }}>-</span>
                              <input value={g.sub[0]} onChange={(e) => g.sub[1](e.target.value)} style={{ border: 'none', outline: 'none', fontSize: '12px', fontWeight: '500', color: '#1a3a5c', padding: 0, background: 'transparent', width: '34%', textAlign: 'center' }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </React.Fragment>
                  );
                })()}
              </div>
              {addTaxInvoiceSupplierPickerOpen && ( // MARKER_VATWATCHLISTOPS_SUPPLIER_DATA_LOOKUP_V1 -- Popup เลือก Supplier ตอนเจอมากกว่า 1 ตัว
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200 }} onClick={() => setAddTaxInvoiceSupplierPickerOpen(false)}>
                  <div style={{ background: 'white', borderRadius: '12px', width: '560px', maxWidth: '92vw', maxHeight: '70vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '0.5px solid #eef0f2' }}>
                      <div style={{ fontSize: '14px', fontWeight: '500', color: '#1a3a5c' }}>เลือก Supplier ({addTaxInvoiceDistinctSuppliers.length})</div>
                      <button type="button" onClick={() => setAddTaxInvoiceSupplierPickerOpen(false)} style={{ width: '26px', height: '26px', padding: 0, border: 'none', borderRadius: '50%', background: '#f0f0f0', cursor: 'pointer', fontSize: '14px', color: '#666' }}>×</button>
                    </div>
                    <div style={{ overflowY: 'auto', padding: '8px' }}>
                      {addTaxInvoiceDistinctSuppliers.map((code) => {
                        const s = addTaxInvoiceSmCodeListData.find((x) => String(x['Supplier Code'] || '').trim() === code);
                        return (
                          <button key={code} type="button" onClick={() => { setAddTaxInvoiceSupplierCode(code); setAddTaxInvoiceSupplierPickerOpen(false); }} style={{ width: '100%', textAlign: 'left', display: 'block', background: code === addTaxInvoiceSupplierCode ? '#f4f5f7' : 'white', border: '0.5px solid #eef0f2', borderRadius: '8px', padding: '10px 14px', marginBottom: '6px', cursor: 'pointer' }}>
                            <div style={{ fontSize: '13px', fontWeight: '700', color: '#1a3a5c', marginBottom: '4px' }}>{s ? (s['Company Name'] || '—') : '—'}{code === addTaxInvoiceSupplierCode ? ' (เลือกอยู่)' : ''}</div> {/* MARKER_VATWATCHLISTOPS_SUPPLIER_PICKER_COMPANY_FIRST_V1 -- Company Name ขึ้นบรรทัดแรกแทน */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: '8px' }}> {/* MARKER_VATWATCHLISTOPS_SUPPLIER_STACKED_TITLE_VALUE_V1 MARKER_VATWATCHLISTOPS_SUPPLIER_FIELDS_EDGE_TO_EDGE_V1 -- กระจายเต็มความกว้างจนสุดขอบ */}
                              {[
                                { label: 'Supplier Code', value: code },
                                { label: 'Tax ID', value: s ? s['Tax ID'] : null },
                                { label: 'Branch', value: s ? s['Branch'] : null },
                                { label: 'Rule 1', value: s ? s['Special Rule1'] : null },
                                { label: 'Rule 2', value: s ? s['Special Rule2'] : null },
                                { label: 'Rule 3', value: s ? s['Simple Rule3'] : null },
                                { label: 'Rule 4', value: s ? s['Special Rule4'] : null },
                                { label: 'Rule 5', value: s ? s['Special Rule5'] : null },
                              ].map((f) => (
                                <div key={f.label}>
                                  <div style={{ fontSize: '10px', color: '#999', marginBottom: '2px' }}>{f.label}</div>
                                  <div style={{ fontSize: '12px', fontWeight: '500', color: '#1a3a5c' }}>{f.value || '—'}</div>
                                </div>
                              ))}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
              <div style={{ height: '22%', boxSizing: 'border-box', border: '0.5px solid #e0e0e0', borderRadius: '10px', boxShadow: '0 1px 3px rgba(16,24,40,0.08), 0 1px 2px rgba(16,24,40,0.04)', padding: '10px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}> {/* MARKER_VATWATCHLISTOPS_FULLPAGE_RIGHT_PANEL_SPLIT_V1 MARKER_VATWATCHLISTOPS_FULLPAGE_POLISH_RIGHT_V1 MARKER_VATWATCHLISTOPS_SUPPLIER_ACTION_PASTEL_COLORS_V1 MARKER_VATWATCHLISTOPS_ACTION_CALCULATE_REMOVE_TITLE_COMPACT_V1 -- เอา Title ออก ลด Padding */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}> {/* MARKER_VATWATCHLISTOPS_ACTION_CALCULATE_STATUS_V1 -- แสดงสถานะการคำนวณจริงแทน Empty State */}
                  {(() => {
                    const qAction = detailSearch.trim().toLowerCase();
                    const qTermsAction = qAction.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
                    const rowsAction = qTermsAction.length === 0 ? [] : fullPagePopvatRows.filter((r) =>
                      qTermsAction.some((term) =>
                        String(r.invoice_ref || '').toLowerCase().includes(term) ||
                        String(r.receive_doc_no || '').toLowerCase().includes(term) ||
                        String(r.vendor_name || '').toLowerCase().includes(term) ||
                        String(r.check_no || '').toLowerCase().includes(term)
                      )
                    );
                    const selectedRowsAction = rowsAction.filter((r) => selectedFullPageInvoices.has(getNoteKey(r)));
                    const rowsForSumAction = selectedRowsAction.length > 0 ? selectedRowsAction : rowsAction;
                    const listSumAmountAction = rowsForSumAction.reduce((sum, r) => sum + (Number(r.exp_amount) || 0), 0);
                    const listSumVatAction = rowsForSumAction.reduce((sum, r) => sum + (Number(r.exp_vat) || 0), 0);
                    const taxInvoiceSumAmountAction = addTaxInvoiceList.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
                    const taxInvoiceSumVatAction = addTaxInvoiceList.reduce((sum, r) => sum + (Number(r.vat) || 0), 0);
                    const diffAmountAction = listSumAmountAction - taxInvoiceSumAmountAction;
                    const diffVatAction = listSumVatAction - taxInvoiceSumVatAction;
                    const distinctBranchesAction = [...new Set(rowsForSumAction.map((r) => String(r.branch || '').trim()).filter(Boolean))];
                    const taxInvoiceBranchAction = String(addTaxInvoiceList[0]?.branch || '').trim(); // MARKER_VATWATCHLISTOPS_ACTION_CALCULATE_DETAIL_CHECKLIST_V1
                    const checkTaxInvoiceCount = addTaxInvoiceList.length === 1;
                    const checkBranchMatch = distinctBranchesAction.length === 1 && taxInvoiceBranchAction !== '' && taxInvoiceBranchAction === distinctBranchesAction[0];
                    const checkDiffOk = Math.abs(diffAmountAction) < 1 && Math.abs(diffVatAction) < 1;
                    const hasAnyData = addTaxInvoiceList.length > 0; // MARKER_VATWATCHLISTOPS_ACTION_CALCULATE_3POINTS_FINAL_V1 MARKER_VATWATCHLISTOPS_POPVAT_STANDBY_WHEN_NO_TAXINVOICE_V1 -- Tax Invoice List ว่าง = Standby เสมอ ไม่สนใจว่า Invoice List จะมีข้อมูลหรือไม่
                    const isAssetBatchEarlyAction = rowsForSumAction.some((r) => { const c = classifyVatWatchlistTaxType(r.tax_type); return c && (c.cls === 'T' || c.cls === 'F'); }); // MARKER_VATWATCHLISTOPS_ASSET_FORCE_NNN_ADI_V1 -- ใช้ก่อน popvatStatus/ibRuleMet เพื่อบังคับ Asset เข้าโหมด NNN/ADI เสมอ
                    const popvatStatus = !hasAnyData ? 'Standby' : (!checkDiffOk ? 'Standby' : (checkTaxInvoiceCount && rowsForSumAction.length > 0 && checkBranchMatch && !isAssetBatchEarlyAction ? 'Transfer' : 'Cancel')); // MARKER_VATWATCHLISTOPS_POPVAT_STATUS_STANDBY_WHEN_DIFF_V1 -- Diff ยังไม่อยู่ใน Tolerance +-1 -> Standby ก่อน / Asset ห้ามเข้า Transfer -- MARKER_VATWATCHLISTOPS_ASSET_FORCE_NNN_ADI_V1
                    // MARKER_VATWATCHLISTOPS_SIMPLEINPUT_FIRST_RULE_V1 -- กฎข้อแรก: Tax Invoice List ทุกใบ Branch เดียวกัน + ตรงกับ Invoice List + ยอดตรงกัน
                    const distinctTaxInvoiceBranchesAction = [...new Set(addTaxInvoiceList.map((t) => String(t.branch || '').trim()).filter(Boolean))];
                    const simpleInputBranchOk = addTaxInvoiceList.length > 1 && distinctTaxInvoiceBranchesAction.length === 1 && distinctBranchesAction.length === 1 && distinctTaxInvoiceBranchesAction[0] === distinctBranchesAction[0]; // MARKER_VATWATCHLISTOPS_SIMPLEINPUT_REQUIRE_MULTI_TAXINVOICE_V1 -- แก้จาก > 0 เป็น > 1 (Simple Input Transfer ได้เฉพาะเมื่อ Tax Invoice มากกว่า 1 ใบ)
                    const simpleInputAmountOk = Math.abs(diffAmountAction) < 1 && Math.abs(diffVatAction) < 1;
                    const simpleInputRuleMet = simpleInputBranchOk && simpleInputAmountOk && !isAssetBatchEarlyAction; // MARKER_VATWATCHLISTOPS_SIMPLEINPUT_SUBBADGE_ASSET_NNN_FIX_V1 -- Asset บังคับ NNN เสมอ Sub-Badge (Create Journal/Interbranch/Book VAT Only) ต้องโชว์ No/No/No ไม่ใช่ Yes/No/Yes
                    // MARKER_VATWATCHLISTOPS_ADI_IB_RULE_V1 -- กฎข้อสาม (IB): Invoice ใบใดใบหนึ่ง Branch ไม่ตรงกับ Tax Invoice ใบแรก + ยอดตรงกัน
                    const referenceTaxBranchAction = String(addTaxInvoiceList[0]?.branch || '').trim();
                    const ibMismatchAction = hasAnyData && rowsForSumAction.length > 0 && referenceTaxBranchAction !== '' && rowsForSumAction.some((r) => String(r.branch || '').trim() !== referenceTaxBranchAction);
                    const ibRuleMet = (ibMismatchAction || isAssetBatchEarlyAction) && checkDiffOk; // MARKER_VATWATCHLISTOPS_ADI_IB_RULE_V1 -- Asset บังคับ Trigger ADI เสมอ -- MARKER_VATWATCHLISTOPS_ASSET_FORCE_NNN_ADI_V1
                    const createJournalStatus = simpleInputRuleMet ? 'Transfer' : (ibRuleMet ? 'Cancel' : 'Standby');
                    const interbranchStatus = simpleInputRuleMet ? 'Cancel' : (ibRuleMet ? 'Cancel' : 'Standby'); // MARKER_VATWATCHLISTOPS_SIMPLEINPUT_FIRST_RULE_V1 -- Cancel = โชว์ "No" (ไม่ใช่แปลว่าล้มเหลว แค่ Map ตามระบบ Yes/No/Null เดิม)
                    const bookVatOnlyStatus = simpleInputRuleMet ? 'Transfer' : (ibRuleMet ? 'Cancel' : 'Standby');
                    const subStatuses = [createJournalStatus, interbranchStatus, bookVatOnlyStatus];
                    const simpleInputStatus = simpleInputRuleMet ? 'Transfer' : (ibRuleMet ? 'Transfer' : (subStatuses.every((s) => s === 'Standby') ? 'Standby' : 'Cancel')); // MARKER_VATWATCHLISTOPS_SIMPLEINPUT_FIRST_RULE_V1 -- ผ่านกฎข้อแรก = Transfer เสมอ แม้ Interbranch จะเป็น Cancel(No) ก็ตาม
                    const isAssetBatchAction = rowsForSumAction.some((r) => { const c = classifyVatWatchlistTaxType(r.tax_type); return c && (c.cls === 'T' || c.cls === 'F'); }); // MARKER_VATWATCHLISTOPS_ADI_ASSET_IB_LABEL_V1 -- มี Invoice ใน Batch ที่ Classify ได้ Asset (T/F) หรือไม่
                    const isAverageBatchAction = rowsForSumAction.some((r) => { const c = classifyVatWatchlistTaxType(r.tax_type); return c && c.cls === 'A'; }); // MARKER_VATWATCHLISTOPS_ADI_AVERAGE_IB_LABEL_V1 -- มี Invoice ใน Batch ที่ Classify ได้ Average (Prefix A) หรือไม่
                    const buRateSuffixAction = parseFloat(bu?.['VAT %']) === 100 ? '(N)' : '(A)'; // MARKER_VATWATCHLISTOPS_ADI_BURATE_SUFFIX_V1 -- BU Rate=100 -> (N) / อื่นๆ -> (A)
                    const adiJournalStatus = ibRuleMet ? (isAssetBatchAction ? `Asset-IB ${buRateSuffixAction}` : (isAverageBatchAction ? 'Average-IB' : 'Normal-IB')) : 'Standby'; // MARKER_VATWATCHLISTOPS_ADI_LABEL_FINAL_V1 -- (N)/(A) ต่อท้ายเฉพาะ Asset-IB เท่านั้น / Average-IB และ Normal-IB ไม่มี Suffix
                    const statusColors = { Standby: { bg: '#f1f2f4', dot: '#9aa0a6', text: '#5f5e5a' }, Transfer: { bg: '#eaf3e8', dot: '#2e7d32', text: '#2e7d32' }, Cancel: { bg: '#fce8e8', dot: '#e5484d', text: '#e5484d' }, IB: { bg: '#eaf3e8', dot: '#2e7d32', text: '#2e7d32' }, Asset: { bg: '#e6f1fb', dot: '#185fa5', text: '#0c447c' }, Average: { bg: '#eeedfe', dot: '#534ab7', text: '#3c3489' }, 'Asset-IB': { bg: '#eaf3e8', dot: '#2e7d32', text: '#2e7d32' }, 'Average-IB': { bg: '#eaf3e8', dot: '#2e7d32', text: '#2e7d32' }, 'Asset-IB (N)': { bg: '#eaf3e8', dot: '#2e7d32', text: '#2e7d32' }, 'Asset-IB (A)': { bg: '#eaf3e8', dot: '#2e7d32', text: '#2e7d32' }, 'Normal-IB': { bg: '#eaf3e8', dot: '#2e7d32', text: '#2e7d32' } }; // MARKER_VATWATCHLISTOPS_ADI_LABEL_FINAL_V1 -- Label สุดท้าย: Normal-IB / Average-IB / Asset-IB (N) / Asset-IB (A) (สีเขียวเหมือนกันหมด)
                    const statusToYesNo = { Standby: null, Transfer: 'Yes', Cancel: 'No' }; // MARKER_VATWATCHLISTOPS_ACTION_CALCULATE_3POINTS_FINAL_V1 -- Transfer=Yes, Cancel=No, Standby=Null
                    const MainBadge = ({ status }) => (
                      <div style={{ background: statusColors[status].bg, borderRadius: '20px', padding: '4px 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', minWidth: '112px', boxSizing: 'border-box' }}> {/* MARKER_VATWATCHLISTOPS_ACTION_PREVIEW_FIT_HEIGHT_V1 -- ลด Padding ให้พอดีกับกล่องสูง 22% เดิม (ยังกว้างเท่ากันทุก Badge เหมือนเดิม) */}
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: statusColors[status].dot, display: 'inline-block', flexShrink: 0 }} />
                        <span style={{ fontSize: '12px', fontWeight: '500', color: statusColors[status].text, whiteSpace: 'nowrap' }}>{status}</span>
                      </div>
                    );
                    const SubBadge = ({ label, status }) => (
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '11px', color: '#888681', marginBottom: '3px' }}>{label}</div>
                        <span style={{ display: 'inline-block', background: statusColors[status].bg, borderRadius: '20px', padding: '2px 10px', fontSize: '10px', fontWeight: '500', color: statusColors[status].text }}>{statusToYesNo[status] ?? 'Null'}</span>
                      </div>
                    );
                    return (
                      <React.Fragment>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '0.5px solid #eef0f2' }}> {/* MARKER_VATWATCHLISTOPS_ACTION_PREVIEW_FIT_HEIGHT_V1 -- Padding ลดลงให้พอดีสูง 22% */}
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9aa0a6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
                          <div style={{ flex: 1, fontSize: '12px', fontWeight: '500', color: '#1a3a5c' }}>Popvat</div>
                          <MainBadge status={popvatStatus} />
                        </div>
                        <div style={{ padding: '6px 0', borderBottom: '0.5px solid #eef0f2' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9aa0a6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M17 3l4 4-4 4" /><path d="M3 7h18" /><path d="M7 21l-4-4 4-4" /><path d="M21 17H3" /></svg>
                            <div style={{ flex: 1, fontSize: '12px', fontWeight: '500', color: '#1a3a5c' }}>Simple Input</div>
                            <MainBadge status={simpleInputStatus} />
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', paddingLeft: '22px' }}>
                            <SubBadge label="Create Journal" status={createJournalStatus} />
                            <SubBadge label="Interbranch" status={interbranchStatus} />
                            <SubBadge label="Book VAT Only" status={bookVatOnlyStatus} />
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0 2px' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9aa0a6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M3 21h18" /><path d="M5 21V9l7-6 7 6v12" /><path d="M9 21v-6h6v6" /></svg>
                          <div style={{ flex: 1, fontSize: '12px', fontWeight: '500', color: '#1a3a5c' }}>ADI Journal</div>
                          <MainBadge status={adiJournalStatus} />
                        </div>
                      </React.Fragment>
                    );
                  })()}
                </div>
              </div>
            </div>
          <div style={{ width: '60%', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '14px' }}> {/* MARKER_VATWATCHLISTOPS_FULLPAGE_TRUE_CARDS_V1 -- Card แยกจริงแต่ละกล่อง (Flex-grow ตามสัดส่วนเดิม 35:4:35:4:17:5) */}
          <div style={{ width: '100%', flex: '39 1 0%', minHeight: 0, boxSizing: 'border-box', border: '0.5px solid #e0e0e0', borderRadius: '10px', boxShadow: '0 1px 3px rgba(16,24,40,0.08), 0 1px 2px rgba(16,24,40,0.04)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}> {/* MARKER_VATWATCHLISTOPS_FULLPAGE_MERGE_CARDS_V1 -- Card 1: List + ยอดรวม flex:39 */}
          <div className="vwl-fullpage-invoice-scroll" style={{ width: '100%', flex: '35 1 0%', minHeight: 0, boxSizing: 'border-box', overflow: 'auto', padding: '0 0 20px' }}> {/* MARKER_VATWATCHLISTOPS_FULLPAGE_POPVAT_RESERVE_HEIGHT_V1 MARKER_VATWATCHLISTOPS_FULLPAGE_MERGE_CARDS_V1 -- Invoice List (ใน Card1) */}
            {(() => {
              const rows = fullPagePopvatRows; // MARKER_VATWATCHLISTOPS_FULLPAGE_SEARCH_BACKEND_V1 -- ใช้ผลลัพธ์จาก Backend ตรงๆ (แยก State ไม่ทับ detailRows แล้ว)
              const q = detailSearch.trim(); // MARKER_VATWATCHLISTOPS_FIX_Q_NOT_DEFINED_V1 -- แก้ Bug q is not defined (ตอน Refactor เป็น Backend Search ลืมประกาศตัวแปรนี้ทิ้งไว้)
              return (
                <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0, fontSize: '12px', whiteSpace: 'nowrap' }}> {/* MARKER_VATWATCHLISTOPS_FULLPAGE_POPVAT_COLLECT_DATA_V1 -- tableLayout fixed ให้ Column Width ตรงกับแถวสรุปด้านล่าง */}
                  <thead>
                    <tr>
                      <th style={{ position: 'sticky', top: 0, zIndex: 1, padding: '5px 8px', background: '#1a3a5c', color: 'white', fontWeight: '500', textAlign: 'center', width: '4%' }}> {/* MARKER_VATWATCHLISTOPS_ADDTAX_CHECKBOX_ALIGN_V1 -- Padding ตรงกับ Tax Invoice List ด้านล่าง */}
                        <input type="checkbox" checked={rows.length > 0 && rows.every((r) => selectedFullPageInvoices.has(getNoteKey(r)))} onChange={() => toggleSelectAllFullPageInvoices(rows)} />
                      </th>
                      <th style={{ position: 'sticky', top: 0, zIndex: 1, padding: '8px 10px', background: '#1a3a5c', color: 'white', fontWeight: '500', textAlign: 'left', width: '9%' }}>Branch</th>
                      <th style={{ position: 'sticky', top: 0, zIndex: 1, padding: '8px 10px', background: '#1a3a5c', color: 'white', fontWeight: '500', textAlign: 'left', width: '16%' }}>ใบแจ้งหนี้</th>
                      <th style={{ position: 'sticky', top: 0, zIndex: 1, padding: '8px 10px', background: '#1a3a5c', color: 'white', fontWeight: '500', textAlign: 'left', width: '24%' }}>ชื่อผู้ค้า</th>
                      <th style={{ position: 'sticky', top: 0, zIndex: 1, padding: '8px 10px', background: '#1a3a5c', color: 'white', fontWeight: '500', textAlign: 'left', width: '13%' }}>เลขที่เช็ค</th>
                      <th style={{ position: 'sticky', top: 0, zIndex: 1, padding: '8px 10px', background: '#1a3a5c', color: 'white', fontWeight: '500', textAlign: 'left', width: '14%' }}>เลขที่ GRT</th>
                      <th style={{ position: 'sticky', top: 0, zIndex: 1, padding: '8px 10px', background: '#1a3a5c', color: 'white', fontWeight: '500', textAlign: 'right', width: '12%' }}>มูลค่าสินค้า</th>
                      <th style={{ position: 'sticky', top: 0, zIndex: 1, padding: '8px 10px', background: '#1a3a5c', color: 'white', fontWeight: '500', textAlign: 'right', width: '8%' }}>เงินภาษี</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: '#999', fontSize: '13px' }}>{q ? 'ไม่พบ Invoice' : 'พิมพ์คำค้นหา (ใบแจ้งหนี้ / Payment Doc / ชื่อผู้ค้า) เพื่อแสดงข้อมูล'}</td></tr>
                    ) : rows.map((row, i) => (
                      <tr key={`${getNoteKey(row)}|${i}`} title={buildAssetAverageTooltip(row, bu)} style={{ borderTop: '0.5px solid #e8e8e8' }}> {/* MARKER_VATWATCHLISTOPS_INVOICELIST_AVG_PREVIEW_TOOLTIP_V1 */}
                        <td style={{ padding: '5px 8px', textAlign: 'center' }}> {/* MARKER_VATWATCHLISTOPS_ADDTAX_CHECKBOX_ALIGN_V1 */}
                          <input type="checkbox" checked={selectedFullPageInvoices.has(getNoteKey(row))} onChange={() => toggleSelectFullPageInvoice(row)} />
                        </td>
                        <td style={{ padding: '7px 10px' }}>{row.branch || '—'}</td>
                        <td style={{ padding: '7px 10px' }}>{row.invoice_ref || '—'}</td>
                        <td style={{ padding: '7px 10px' }}>{row.vendor_name || '—'}</td>
                        <td style={{ padding: '7px 10px' }}>{row.check_no || '—'}</td>
                        <td style={{ padding: '7px 10px' }}>{row.receive_doc_no || '—'}</td>
                        <td style={{ padding: '7px 10px', textAlign: 'right' }}>{row.exp_amount != null && row.exp_amount !== '' ? Number(row.exp_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                        <td style={{ padding: '7px 10px', textAlign: 'right' }}>{row.exp_vat != null && row.exp_vat !== '' ? Number(row.exp_vat).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}
          </div>
          <div style={{ width: '100%', flex: '4 1 0%', minHeight: 0, boxSizing: 'border-box', borderTop: '0.5px solid #eef0f2', overflow: 'hidden', background: '#f6f8fa' }}> {/* MARKER_VATWATCHLISTOPS_FULLPAGE_LAYOUT_V2_ALIGN_FIX_V1 MARKER_VATWATCHLISTOPS_FULLPAGE_MERGE_CARDS_V1 -- ยอดรวมของ List (ใน Card1, มี Divider คั่น) */}
            {(() => {
              const qList = detailSearch.trim().toLowerCase();
              const qTermsList = qList.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
              const listRows = qTermsList.length === 0 ? [] : detailRows.filter((r) =>
                qTermsList.some((term) =>
                  String(r.invoice_ref || '').toLowerCase().includes(term) ||
                  String(r.receive_doc_no || '').toLowerCase().includes(term) ||
                  String(r.vendor_name || '').toLowerCase().includes(term) ||
                  String(r.check_no || '').toLowerCase().includes(term)
                )
              );
              const selectedListRows = listRows.filter((r) => selectedFullPageInvoices.has(getNoteKey(r))); // MARKER_VATWATCHLISTOPS_ADDTAX_LISTTOTAL_SELECTED_V1
              const listRowsForSum = selectedListRows.length > 0 ? selectedListRows : listRows; // มีติ๊ก -> เฉพาะที่ติ๊ก / ไม่ติ๊กเลย -> ทั้งหมด
              const listSumAmount = listRowsForSum.reduce((sum, r) => sum + (Number(r.exp_amount) || 0), 0);
              const listSumVat = listRowsForSum.reduce((sum, r) => sum + (Number(r.exp_vat) || 0), 0);
              return (
                <table style={{ width: '100%', height: '100%', tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0, fontSize: '12px', whiteSpace: 'nowrap' }}>
                  <tbody>
                    <tr>
                      <td colSpan={6} style={{ width: '80%', padding: '4px 10px', textAlign: 'right', color: '#999' }}>ยอดรวมของ List:</td>
                      <td style={{ width: '12%', padding: '4px 10px', textAlign: 'right', fontWeight: '500' }}>{listSumAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td style={{ width: '8%', padding: '4px 10px', textAlign: 'right', fontWeight: '500' }}>{listSumVat.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                  </tbody>
                </table>
              );
            })()}
          </div>
          </div> {/* MARKER_VATWATCHLISTOPS_FULLPAGE_MERGE_CARDS_V1 -- ปิด Card 1 */}
          <div style={{ width: '100%', flex: '39 1 0%', minHeight: 0, boxSizing: 'border-box', border: '0.5px solid #e0e0e0', borderRadius: '10px', boxShadow: '0 1px 3px rgba(16,24,40,0.08), 0 1px 2px rgba(16,24,40,0.04)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}> {/* MARKER_VATWATCHLISTOPS_FULLPAGE_MERGE_CARDS_V1 -- Card 2: Tax Invoice List + ผลรวม flex:39 */}
          <div className="vwl-fullpage-taxinvoice-scroll" style={{ width: '100%', flex: '35 1 0%', minHeight: 0, boxSizing: 'border-box', overflow: 'auto', padding: '10px 0' }}> {/* MARKER_VATWATCHLISTOPS_FULLPAGE_TAX_INVOICE_SCAFFOLD_V1 MARKER_VATWATCHLISTOPS_FULLPAGE_MERGE_CARDS_V1 -- Tax Invoice List (ใน Card2) */}
            <div ref={taxInvoiceHeaderRef} style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', padding: '0 20px', position: 'relative', minHeight: '30px' }}> {/* MARKER_VATWATCHLISTOPS_ADDTAX_BULK_DELETE_V1 MARKER_VATWATCHLISTOPS_ADDTAX_LAYOUT_SYNC_V1 -- เอา space-between ออก ใช้ Absolute วางปุ่ม Delete แทน */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}> {/* MARKER_VATWATCHLISTOPS_FULLPAGE_POLISH_LEFT_V1 -- แท่งสีนำหัวข้อ */}
                <span style={{ width: '3px', height: '14px', background: '#2e7d32', borderRadius: '2px', display: 'inline-block' }} />
                <div style={{ fontSize: '13px', fontWeight: '500', color: '#1a3a5c' }}>Tax Invoice List</div>
              </div>
              <button type="button" onClick={handleBulkDeleteTaxInvoice} style={{ position: 'absolute', left: deleteButtonLeft != null ? `${deleteButtonLeft}px` : 'auto', right: deleteButtonLeft != null ? 'auto' : 0, top: '50%', transform: 'translateY(-50%)', width: addTaxButtonWidth ? `${addTaxButtonWidth}px` : 'auto', height: '30px', boxSizing: 'border-box', padding: '0 14px', fontSize: '12px', border: 'none', borderRadius: '8px', background: '#E5484D', color: 'white', cursor: 'pointer', boxShadow: '0 1px 3px rgba(16,24,40,0.12)' }}> {/* MARKER_VATWATCHLISTOPS_DELETE_BUTTON_MATCH_ADDTAX_V1 MARKER_VATWATCHLISTOPS_DELETE_BUTTON_SOLID_RED_V1 MARKER_VATWATCHLISTOPS_DELETE_TAX_CONFIRM_ALL_V1 MARKER_VATWATCHLISTOPS_DELETE_BUTTON_WIDTH_MATCH_ADDTAX_V1 MARKER_VATWATCHLISTOPS_ADDTAX_LAYOUT_SYNC_V1 -- ตำแหน่ง+ความกว้างอิงจากปุ่ม Add Tax จริงแบบ Dynamic */}
                Delete{selectedTaxInvoiceRows.size > 0 ? ` (${selectedTaxInvoiceRows.size})` : ''}
              </button>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', tableLayout: 'fixed' }}> {/* MARKER_VATWATCHLISTOPS_ADDTAX_LIST_WIDTH_GREEN_V1 -- Width % สไตล์เดียวกับ Invoice List ด้านบน */}
              <thead>
                <tr style={{ background: '#2e7d32', color: 'white' }}> {/* MARKER_VATWATCHLISTOPS_ADDTAX_LIST_WIDTH_EXACT_ALIGN_V1 -- % เป๊ะเดียวกับ Invoice List บน */}
                  <th style={{ padding: '5px 8px', width: '4%', textAlign: 'center' }}><input type="checkbox" checked={addTaxInvoiceList.length > 0 && selectedTaxInvoiceRows.size === addTaxInvoiceList.length} onChange={toggleSelectAllTaxInvoiceRows} /></th> {/* MARKER_VATWATCHLISTOPS_ADDTAX_LIST_SCROLL_SELECT_V1 MARKER_VATWATCHLISTOPS_ADDTAX_CHECKBOX_TEXTALIGN_FIX_V1 */}
                  <th style={{ padding: '5px 8px', textAlign: 'left', fontWeight: '500', width: '9%' }}>Branch</th>
                  <th style={{ padding: '5px 8px', textAlign: 'left', fontWeight: '500', width: '16%' }}>Tax Invoice No.</th>
                  <th style={{ padding: '5px 8px', textAlign: 'left', fontWeight: '500', width: '24%' }}>Tax Invoice Date</th>
                  <th style={{ padding: '5px 8px', textAlign: 'left', fontWeight: '500', width: '13%' }}>GRN</th>
                  <th style={{ padding: '5px 8px', textAlign: 'left', fontWeight: '500', width: '14%' }}>Receive Date</th>
                  <th style={{ padding: '5px 8px', textAlign: 'right', fontWeight: '500', width: '12%' }}>Amount</th>
                  <th style={{ padding: '5px 8px', textAlign: 'right', fontWeight: '500', width: '8%' }}>Vat</th>
                </tr>
              </thead>
              <tbody>
                {addTaxInvoiceList.length === 0 ? (
                  <tr><td colSpan={8} style={{ padding: '10px 8px', color: '#999' }}>ยังไม่มีข้อมูล</td></tr>
                ) : (
                  addTaxInvoiceList.map((row) => (
                    <tr key={row.id} style={{ borderBottom: '0.5px solid #eee' }}>
                      <td style={{ padding: '5px 8px', textAlign: 'center' }}><input type="checkbox" checked={selectedTaxInvoiceRows.has(row.id)} onChange={() => toggleSelectTaxInvoiceRow(row.id)} /></td> {/* MARKER_VATWATCHLISTOPS_ADDTAX_LIST_SCROLL_SELECT_V1 MARKER_VATWATCHLISTOPS_ADDTAX_CHECKBOX_TEXTALIGN_FIX_V1 */}
                      <td style={{ padding: '5px 8px' }}>{row.branch}</td>
                      <td style={{ padding: '5px 8px' }}>{row.taxInvoiceNo}</td>
                      <td style={{ padding: '5px 8px' }}>{formatQuickActionReceiveDateText(row.taxInvoiceDate)}</td> {/* MARKER_VATWATCHLISTOPS_ADDTAX_LIST_DATE_FORMAT_FIX_V1 */}
                      <td style={{ padding: '5px 8px', fontFamily: 'monospace' }}>{row.grn}</td>
                      <td style={{ padding: '5px 8px' }}>{formatQuickActionReceiveDateText(row.receiveDate)}</td> {/* MARKER_VATWATCHLISTOPS_ADDTAX_LIST_DATE_FORMAT_FIX_V1 */}
                      <td style={{ padding: '5px 8px', textAlign: 'right' }}>{Number(row.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right' }}>{Number(row.vat || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td> {/* MARKER_VATWATCHLISTOPS_ADDTAX_BULK_DELETE_V1 -- เอาปุ่มลบออก ใช้ Select+Delete บนหัวแทน */}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div style={{ width: '100%', flex: '4 1 0%', minHeight: 0, boxSizing: 'border-box', borderTop: '0.5px solid #eef0f2', overflow: 'hidden', background: '#f6f8fa' }}> {/* MARKER_VATWATCHLISTOPS_ADDTAX_TOTALSROW_REALDATA_V1 MARKER_VATWATCHLISTOPS_FULLPAGE_MERGE_CARDS_V1 -- ผลรวมของ Tax Invoice List (ใน Card2, มี Divider คั่น) */}
            <table style={{ width: '100%', height: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: '12px', whiteSpace: 'nowrap' }}>
              <tbody>
                <tr>
                  <td colSpan={6} style={{ width: '80%', padding: '5px 8px', textAlign: 'right', color: '#999' }}>ผลรวมของ Tax Invoice List:</td>
                  <td style={{ width: '12%', padding: '5px 8px', textAlign: 'right', fontWeight: '500' }}>{addTaxInvoiceList.reduce((sum, r) => sum + (Number(r.amount) || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td style={{ width: '8%', padding: '5px 8px', textAlign: 'right', fontWeight: '500' }}>{addTaxInvoiceList.reduce((sum, r) => sum + (Number(r.vat) || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
              </tbody>
            </table>
          </div>
          </div> {/* MARKER_VATWATCHLISTOPS_FULLPAGE_MERGE_CARDS_V1 -- ปิด Card 2 */}
          <div style={{ width: '100%', flex: '22 1 0%', minHeight: 0, boxSizing: 'border-box', border: '0.5px solid #e0e0e0', borderRadius: '10px', boxShadow: '0 1px 3px rgba(16,24,40,0.08), 0 1px 2px rgba(16,24,40,0.04)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}> {/* MARKER_VATWATCHLISTOPS_FULLPAGE_MERGE_CARDS_V1 -- Card 3: ใบกำกับภาษีที่ Add + แถวสรุป flex:22 */}
          <div style={{ width: '100%', flex: '17 1 0%', minHeight: 0, boxSizing: 'border-box', overflow: 'auto', padding: '10px 20px' }}> {/* MARKER_VATWATCHLISTOPS_FULLPAGE_TAX_INVOICE_SCAFFOLD_V1 MARKER_VATWATCHLISTOPS_FULLPAGE_MERGE_CARDS_V1 -- ใบกำกับภาษีที่ Add (ใน Card3) */}
            {/* MARKER_VATWATCHLISTOPS_FULLPAGE_ADD_TAX_INVOICE_FIELDS_V1 -- 4 Field เดิมจาก Quick Action + Tax ID (Default BU) + Branch No. (ว่างไว้ก่อน) */}
            {/* MARKER_VATWATCHLISTOPS_FULLPAGE_ADD_TAX_INVOICE_REMOVE_TITLE_V1 -- เอาหัวข้อ "ใบกำกับภาษีที่ Add" ออกตามที่ขอ */}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 23%) minmax(130px, 17%) minmax(140px, 22%) minmax(90px, 14%) minmax(80px, 13%) minmax(70px, 11%)', gap: '10px', marginBottom: '10px', alignItems: 'end' }}> {/* MARKER_VATWATCHLISTOPS_ADDTAXINVOICE_AMOUNT_VAT_V1 MARKER_VATWATCHLISTOPS_ADDTAX_BUTTON_MOVE_V1 MARKER_VATWATCHLISTOPS_COLUMNS_FINAL_V1 -- % + minWidth ยืดหดตาม Container ไม่ล้น */}
              <div> {/* Tax ID / No. 65:35 */}
                <div style={{ display: 'flex', marginBottom: '4px' }}>
                  <label style={{ fontSize: '11px', color: '#888', flex: 65 }}>Tax ID</label>
                  <label style={{ fontSize: '11px', color: '#888', flex: 35 }}>No.</label>
                </div>
                <div style={{ display: 'flex', alignItems: 'stretch', height: '30px', border: '0.5px solid #d8dbe0', borderRadius: '8px', overflow: 'hidden' }}> {/* MARKER_VATWATCHLISTOPS_ADDTAX_FORM_POLISH_V1 */}
                  <input value={addTaxInvoiceTaxId} onChange={(e) => setAddTaxInvoiceTaxId(e.target.value)} onBlur={(e) => { const v = e.target.value.trim(); if (/^[0-9]+$/.test(v) && v.length < 13) setAddTaxInvoiceTaxId(v.padStart(13, '0')); }} style={{ flex: 65, minWidth: 0, boxSizing: 'border-box', padding: '0 8px', fontSize: '12px', border: 'none', outline: 'none', borderRight: '0.5px solid #d8dbe0', background: 'transparent' }} /> {/* MARKER_VATWATCHLISTOPS_ADDTAXINVOICE_AUTOPAD_ZERO_V1 -- Auto Pad 0 ครบ 13 หลัก ตอน Blur */}
                  <input value={addTaxInvoiceBranchNo} onChange={(e) => setAddTaxInvoiceBranchNo(e.target.value)} onBlur={(e) => { const v = e.target.value.trim(); if (/^[0-9]+$/.test(v) && v.length < 5) setAddTaxInvoiceBranchNo(v.padStart(5, '0')); }} style={{ flex: 35, minWidth: 0, boxSizing: 'border-box', padding: '0 8px', fontSize: '12px', border: 'none', outline: 'none', textAlign: 'center', background: 'transparent' }} /> {/* MARKER_VATWATCHLISTOPS_ADDTAXINVOICE_AUTOPAD_ZERO_V1 -- Auto Pad 0 ครบ 5 หลัก ตอน Blur (ให้ตรง Format BU Branch) */}
                </div>
              </div>
              <div> {/* MARKER_VATWATCHLISTOPS_HYBRID_TAXINVOICEDATE_V1 -- Hybrid: พิมพ์ได้ + เลือก Calendar ได้ */}
                <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '4px' }}>Tax Invoice Date</label>
                <div style={{ position: 'relative' }}>
                  <input
                    ref={addTaxInvoiceDateTextRef}
                    type="text"
                    defaultValue={formatDateDisplayMDY(addTaxInvoiceDate)}
                    placeholder="MM/DD/YYYY"
                    onBlur={(e) => {
                      const parsed = parseFlexibleDate(e.target.value);
                      if (parsed) { e.target.value = formatDateDisplayMDY(parsed); setAddTaxInvoiceDate(parsed); }
                      else if (!e.target.value.trim()) { setAddTaxInvoiceDate(''); }
                      else { e.target.value = formatDateDisplayMDY(addTaxInvoiceDate); }
                    }}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '6px 22px 6px 8px', fontSize: '12px', border: '0.5px solid #d8dbe0', borderRadius: '8px', background: '#FFFBEA' }}
                  />
                  <span style={{ position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', fontSize: '13px', color: '#888' }}>📅</span> {/* MARKER_VATWATCHLISTOPS_HYBRID_TAXINVOICEDATE_ICON_V1 -- Icon แสดงผลอย่างเดียว คลิกทะลุไปโดน Date Input ด้านล่าง */}
                  <input
                    type="date"
                    tabIndex={-1}
                    value={addTaxInvoiceDate || ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (addTaxInvoiceDateTextRef.current) addTaxInvoiceDateTextRef.current.value = formatDateDisplayMDY(v);
                      setAddTaxInvoiceDate(v);
                      if (v && addTaxInvoiceNumberRef.current) addTaxInvoiceNumberRef.current.focus(); // MARKER_VATWATCHLISTOPS_HYBRID_TAXINVOICEDATE_AUTOFOCUS_V1 -- เลือกวันจาก Calendar แล้ว กระโดดไป Tax Invoice Number ทันที
                    }}
                    style={{ position: 'absolute', right: 0, top: 0, width: '20px', height: '100%', opacity: 0, cursor: 'pointer', border: 'none', padding: 0 }}
                  />
                </div>
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '4px' }}>Tax Invoice Number</label>
                <input ref={addTaxInvoiceNumberRef} value={addTaxInvoiceNumber} onChange={(e) => setAddTaxInvoiceNumber(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: '12px', border: '0.5px solid #d8dbe0', borderRadius: '8px', background: '#FFFBEA' }} /> {/* MARKER_VATWATCHLISTOPS_ADDTAX_FIELD_COLORS_V1 MARKER_VATWATCHLISTOPS_ADDTAX_FORM_POLISH_V1 MARKER_VATWATCHLISTOPS_HYBRID_TAXINVOICEDATE_AUTOFOCUS_V1 -- เพิ่ม Ref สำหรับ Auto Focus */}
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '4px' }}>Amount</label>
                <input
                  value={addTaxInvoiceAmount}
                  onChange={(e) => setAddTaxInvoiceAmount(e.target.value)}
                  onBlur={(e) => { // MARKER_VATWATCHLISTOPS_ADDTAX_FIELD_COLORS_V1 -- Blur: คำนวณ Vat 7% + Format Comma ทั้งคู่
                    const raw = String(e.target.value || '').replace(/,/g, '').trim();
                    const num = parseFloat(raw);
                    if (!isNaN(num)) {
                      setAddTaxInvoiceAmount(num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
                      const vatNum = num * 7 / 100;
                      setAddTaxInvoiceVat(vatNum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
                    }
                  }}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: '12px', border: '0.5px solid #d8dbe0', borderRadius: '8px', background: '#E6F1FB', textAlign: 'right' }} // MARKER_VATWATCHLISTOPS_ADDTAX_AMOUNT_VAT_FALLBACK_LISTSUM_V1 -- เปลี่ยนจากเหลืองเป็นฟ้าเหมือน Vat เพราะ Auto-fill ได้เหมือนกันแล้ว
                />
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '4px' }}>Vat</label>
                <input value={addTaxInvoiceVat} onChange={(e) => setAddTaxInvoiceVat(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: '12px', border: '0.5px solid #d8dbe0', borderRadius: '8px', background: '#E6F1FB', textAlign: 'right' }} /> {/* MARKER_VATWATCHLISTOPS_ADDTAX_FIELD_COLORS_V1 MARKER_VATWATCHLISTOPS_ADDTAX_FORM_POLISH_V1 -- พื้นฟ้า */}
              </div>
              <div>
                <button ref={addTaxButtonRef} type="button" onClick={handleAddTaxToList} style={{ width: '100%', boxSizing: 'border-box', height: '30px', padding: '0 10px', fontSize: '12px', border: 'none', borderRadius: '8px', background: '#2e7d32', color: 'white', cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 1px 3px rgba(16,24,40,0.12)' }}>Add Tax</button> {/* MARKER_VATWATCHLISTOPS_ADDTAX_LIST_V1 MARKER_VATWATCHLISTOPS_ADDTAX_FORM_POLISH_V1 MARKER_VATWATCHLISTOPS_DELETE_BUTTON_WIDTH_MATCH_ADDTAX_V1 -- ผูก Logic แล้ว + Shadow + Ref วัดความกว้าง */}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 23%) minmax(130px, 17%) minmax(140px, 22%) minmax(90px, 14%) minmax(80px, 13%) minmax(70px, 11%)', gap: '10px' }}> {/* MARKER_VATWATCHLISTOPS_ADDTAXINVOICE_REORDER_ROUND2_V1 MARKER_VATWATCHLISTOPS_COLUMNS_FINAL_V1 -- ใช้สัดส่วนคอลัมน์เดียวกับ Row บน ให้แนวตรงกัน (Brand Code=Tax ID/No, Receive Date=Tax Invoice Date, GRT Number=Tax Invoice Number) */}
              <div> {/* Brand Code 65:35 -- 65=Brand Code จริง, 35=สำรอง Trigger อื่นทีหลัง (ว่างไว้ก่อน) */}
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}> {/* MARKER_VATWATCHLISTOPS_BRANDCODE_SELECT_BUTTON_CANCEL_MOVE_V1 -- เอาลิงก์แบบมีเงื่อนไขออก ปุ่ม Select ด้านล่างทำหน้าที่แทน */}
                  <label style={{ fontSize: '11px', color: '#888', flex: 65 }}>Brand Code</label>
                  <label style={{ fontSize: '11px', color: '#888', flex: 35 }}>&nbsp;</label>
                </div>
                <div ref={brandCodeContainerRef} style={{ display: 'flex', alignItems: 'stretch', height: '30px', border: '0.5px solid #d8dbe0', borderRadius: '8px', overflow: 'hidden' }}> {/* MARKER_VATWATCHLISTOPS_ADDTAX_FORM_POLISH_V1 MARKER_VATWATCHLISTOPS_ADDTAX_LAYOUT_SYNC_V1 -- ผูก Ref วัดความกว้าง */}
                  <input value={addTaxInvoiceBrandCode} onChange={(e) => setAddTaxInvoiceBrandCode(e.target.value)} style={{ flex: 65, minWidth: 0, boxSizing: 'border-box', padding: '0 8px', fontSize: '12px', fontWeight: '700', textAlign: 'center', border: 'none', outline: 'none', borderRight: '0.5px solid #d8dbe0', background: '#f4f5f7' }} /> {/* MARKER_VATWATCHLISTOPS_ADDTAX_FIELD_COLORS_V1 MARKER_VATWATCHLISTOPS_ADDTAX_FORM_POLISH_V1 -- พื้นเทาอ่อนลง ตัวหนา กึ่งกลาง */}
                  <button type="button" onClick={() => setAddTaxInvoiceBranchPickerOpen(true)} style={{ flex: 35, minWidth: 0, boxSizing: 'border-box', padding: '0 4px', margin: '2px', fontSize: '11px', border: 'none', borderRadius: '6px', outline: 'none', textAlign: 'center', background: '#1a3a5c', color: 'white', cursor: 'pointer', fontWeight: '500' }}> {/* MARKER_VATWATCHLISTOPS_CHANGE_BUTTON_NAVY_STYLE_V1 -- สี Navy + ข้อความ Change */}
                    Change{addTaxInvoiceDistinctBranches.length > 1 ? ` (${addTaxInvoiceDistinctBranches.length})` : ''}
                  </button>
                </div>
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '4px' }}>Receive Date</label>
                <input ref={receiveDateContainerRef} type="date" value={addTaxInvoiceReceiveDate} onChange={(e) => setAddTaxInvoiceReceiveDate(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: '12px', border: '0.5px solid #d8dbe0', borderRadius: '8px', background: '#f4f5f7' }} /> {/* MARKER_VATWATCHLISTOPS_ADDTAXINVOICE_RECEIVEDATE_BG_V1 MARKER_VATWATCHLISTOPS_ADDTAX_FORM_POLISH_V1 MARKER_VATWATCHLISTOPS_SELECT_STYLE_CANCEL_POSITION_FIX_V1 -- ผูก Ref วัดตำแหน่ง */}
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '4px' }}>GRT Number</label>
                <div style={{ display: 'flex', alignItems: 'stretch', height: '30px', border: '0.5px solid #d8dbe0', borderRadius: '8px', overflow: 'hidden' }}> {/* MARKER_VATWATCHLISTOPS_ADDTAXINVOICE_GRT_AUTOGEN_V1 MARKER_VATWATCHLISTOPS_ADDTAX_FORM_POLISH_V1 -- Prefix | Digit | Running (Format เดียวกับ Quick Action) */}
                  <span style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', fontSize: '12px', fontWeight: '600', letterSpacing: '0.05em', color: '#1a3a5c', background: '#f0f3f8', borderRight: '0.5px solid #ccc' }}>{addTaxInvoiceGrtPrefix || '—'}</span>
                  <span style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', fontSize: '10px', fontWeight: '600', color: '#8a6d00', background: '#fdf3d0', borderRight: '0.5px solid #ccc' }}>{addTaxInvoiceGrtDigitCount}DG</span>
                  {addTaxInvoiceGrtControl === 'Auto' ? (
                    <span style={{ flex: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', fontSize: '12px', letterSpacing: '0.15em', color: '#888', background: '#f5f5f5' }}>{addTaxInvoiceGrtNumber}</span>
                  ) : (
                    <input value={addTaxInvoiceGrtNumber} onChange={(e) => setAddTaxInvoiceGrtNumber(e.target.value.replace(/[^0-9]/g, ''))} maxLength={addTaxInvoiceGrtDigitCount} placeholder={'0'.repeat(addTaxInvoiceGrtDigitCount)} style={{ flex: 1.5, border: 'none', outline: 'none', textAlign: 'center', fontFamily: 'monospace', fontSize: '12px', letterSpacing: '0.15em', background: 'white' }} />
                  )}
                </div>
              </div>
              <div style={{ gridColumn: 'span 3' }}> {/* MARKER_VATWATCHLISTOPS_ADDTAX_SIMPLE_NAME_FIELD_V1 MARKER_VATWATCHLISTOPS_SIMPLE_NAME_WIDEN_SPAN_V1 -- ขยายกิน 3 Column เท่า Amount+Vat+Add Tax */}
                <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '4px' }}>Simple Name</label>
                {(() => {
                  const matchedBranchForSimpleName = addTaxInvoiceBranchListData.find((b) => String(b['Branch Code'] || '').trim() === String(addTaxInvoiceBrandCode || '').trim());
                  return (
                    <div style={{ width: '100%', boxSizing: 'border-box', height: '30px', display: 'flex', alignItems: 'center', padding: '0 8px', fontSize: '12px', fontWeight: '500', color: '#1a3a5c', border: '0.5px solid #d8dbe0', borderRadius: '8px', background: '#f4f5f7', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                      {matchedBranchForSimpleName ? (matchedBranchForSimpleName['Simple Brand Code'] || '—') : '—'} {/* MARKER_VATWATCHLISTOPS_ADDTAX_SIMPLE_NAME_FIX_FIELD_V1 -- แก้เป็น Simple Brand Code ตัวที่ถูกต้อง */}
                    </div>
                  );
                })()}
              </div>
            </div> {/* MARKER_VATWATCHLISTOPS_BRANDCODE_SELECT_BUTTON_CANCEL_MOVE_V1 -- ย้ายปุ่ม Cancel ไปแถวสรุปข้าง Add Data แล้ว */}
            {addTaxInvoiceBranchPickerOpen && ( // MARKER_VATWATCHLISTOPS_BRANDCODE_MULTIBRANCH_MATCHING_V1 -- Popup เลือก Branch ตอนเจอมากกว่า 1 Branch
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200 }} onClick={() => setAddTaxInvoiceBranchPickerOpen(false)}>
                <div style={{ background: 'white', borderRadius: '12px', width: '560px', maxWidth: '92vw', maxHeight: '70vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '0.5px solid #eef0f2' }}>
                    <div style={{ fontSize: '14px', fontWeight: '500', color: '#1a3a5c' }}>เลือก Branch ({addTaxInvoiceDistinctBranches.length})</div> {/* MARKER_VATWATCHLISTOPS_BRANDCODE_SELECT_BUTTON_CANCEL_MOVE_V1 */}
                    <button type="button" onClick={() => setAddTaxInvoiceBranchPickerOpen(false)} style={{ width: '26px', height: '26px', padding: 0, border: 'none', borderRadius: '50%', background: '#f0f0f0', cursor: 'pointer', fontSize: '14px', color: '#666' }}>×</button>
                  </div>
                  <div style={{ overflowY: 'auto', padding: '8px' }}>
                    {addTaxInvoiceDistinctBranches.length === 0 && ( // MARKER_VATWATCHLISTOPS_BRANDCODE_SELECT_BUTTON_CANCEL_MOVE_V1 -- Empty State กรณียังไม่มี Branch จาก Search เลย
                      <div style={{ padding: '30px 10px', textAlign: 'center', color: '#999', fontSize: '12px' }}>ยังไม่มี Branch ให้เลือก (ลอง Search ในตาราง List ด้านบนก่อน)</div>
                    )}
                    {addTaxInvoiceDistinctBranches.map((code) => {
                      const b = addTaxInvoiceBranchListData.find((x) => String(x['Branch Code'] || '').trim() === code);
                      return (
                        <button key={code} type="button" onClick={() => { setAddTaxInvoiceBrandCode(code); setAddTaxInvoiceBranchPickerOpen(false); }} style={{ width: '100%', textAlign: 'left', display: 'block', position: 'relative', background: code === addTaxInvoiceBrandCode ? '#f4f5f7' : 'white', border: '0.5px solid #eef0f2', borderRadius: '8px', padding: '10px 14px', marginBottom: '6px', cursor: 'pointer' }}> {/* MARKER_VATWATCHLISTOPS_BRANCH_PICKER_STATUS_BADGE_CORNER_V1 -- Selected State เทาแทนเขียว */}
                          {(() => {
                            const branchStatusPicker = b ? String(b.status || '').trim() : '';
                            const isClosedPicker = branchStatusPicker.toLowerCase() === 'closed';
                            return (
                              <div style={{ position: 'absolute', top: '10px', right: '14px', background: isClosedPicker ? '#fce8e8' : '#eaf3e8', borderRadius: '20px', padding: '3px 10px', display: 'flex', alignItems: 'center', gap: '5px' }}> {/* MARKER_VATWATCHLISTOPS_BRANCH_PICKER_STATUS_BADGE_CORNER_V1 -- Status Badge มุมขวาบน */}
                                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: isClosedPicker ? '#e5484d' : '#2e7d32', display: 'inline-block' }} />
                                <span style={{ fontSize: '11px', fontWeight: '500', color: isClosedPicker ? '#e5484d' : '#2e7d32' }}>{branchStatusPicker || '—'}</span>
                              </div>
                            );
                          })()}
                          <div style={{ fontSize: '13px', fontWeight: '700', color: '#1a3a5c', marginBottom: '4px', paddingRight: '70px' }}>{code}{code === addTaxInvoiceBrandCode ? ' (เลือกอยู่)' : ''}</div>
                          <div style={{ fontSize: '12px', color: '#555', marginBottom: '2px' }}>{b ? (b['Company for Show in Report Display'] || '—') : '—'}</div>
                          <div style={{ display: 'flex', gap: '16px', fontSize: '11px', color: '#888' }}>
                            <span>Tax ID: {b ? (b['BU-TaxID'] || '—') : '—'}</span>
                            <span>BU-Branch: {b ? (b['BU-Branch'] || '—') : '—'}</span>
                          </div>
                          <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>{b ? (b['Branch Address'] || '—') : '—'}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
          <div ref={footerRowWrapperRef} style={{ width: '100%', flex: '0 0 auto', minHeight: 0, boxSizing: 'border-box', borderTop: '0.5px solid #eef0f2', overflow: 'hidden', position: 'relative' }}> {/* MARKER_VATWATCHLISTOPS_FULLPAGE_POPVAT_COLLECT_DATA_V1 MARKER_VATWATCHLISTOPS_FULLPAGE_MERGE_CARDS_V1 MARKER_VATWATCHLISTOPS_SELECT_STYLE_CANCEL_POSITION_FIX_V1 MARKER_VATWATCHLISTOPS_FULLPAGE_FOOTER_FLEX_FIX_V1 -- สูงเท่าเนื้อหาจริง ไม่แบ่งสัดส่วน 5/75 เหมือนเดิม (กันที่ว่างเปล่าใต้ปุ่ม) */}
            {(() => {
              const q2 = detailSearch.trim().toLowerCase();
              const qTerms2 = q2.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean); // MARKER_VATWATCHLISTOPS_FULLPAGE_SEARCH_SYNC_V1
              const rows2 = qTerms2.length === 0 ? [] : fullPagePopvatRows.filter((r) => // MARKER_VATWATCHLISTOPS_FIX_FOOTER_SUMMARY_SOURCE_V1 -- ใช้ข้อมูลของ Full Page List จริง แทน Incomplete Detail (detailRows)
                qTerms2.some((term) =>
                  String(r.invoice_ref || '').toLowerCase().includes(term) ||
                  String(r.receive_doc_no || '').toLowerCase().includes(term) ||
                  String(r.vendor_name || '').toLowerCase().includes(term) ||
                  String(r.check_no || '').toLowerCase().includes(term)
                )
              );
              const selectedRows2 = rows2.filter((r) => selectedFullPageInvoices.has(getNoteKey(r))); // MARKER_VATWATCHLISTOPS_ADDTAX_SYNC_SELECTED_V1 -- ใช้คำนวณผลรวมด้วย (Sync กับยอดรวมของ List ด้านบน)
              const rowsForSumFinal = selectedRows2.length > 0 ? selectedRows2 : rows2; // มีติ๊ก -> เฉพาะที่ติ๊ก / ไม่ติ๊กเลย -> ทั้งหมด
              const listSumAmountFinal = rowsForSumFinal.reduce((sum, r) => sum + (Number(r.exp_amount) || 0), 0); // MARKER_VATWATCHLISTOPS_FULLPAGE_LAYOUT_V2 -- ยอดรวมของ List (ยอดล่างสุดของหน้า -- Sync กับการติ๊กแล้ว)
              const listSumVatFinal = rowsForSumFinal.reduce((sum, r) => sum + (Number(r.exp_vat) || 0), 0);
              const taxInvoiceSumAmountFinal = addTaxInvoiceList.reduce((sum, r) => sum + (Number(r.amount) || 0), 0); // MARKER_VATWATCHLISTOPS_ADDTAX_LIST_V1 -- คำนวณจริงจาก List แล้ว
              const taxInvoiceSumVatFinal = addTaxInvoiceList.reduce((sum, r) => sum + (Number(r.vat) || 0), 0);
              const sumAmount = listSumAmountFinal - taxInvoiceSumAmountFinal; // MARKER_VATWATCHLISTOPS_FULLPAGE_LAYOUT_V2 -- ยอดรวม List ลบ ผลรวม Tax Invoice List
              const sumVat = listSumVatFinal - taxInvoiceSumVatFinal;
              return (
                <table style={{ width: '100%', height: '100%', tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0, fontSize: '12px', whiteSpace: 'nowrap' }}>
                  <tbody>
                    <tr>
                      <td style={{ width: '19%', padding: '4px 10px 4px 20px' }}> {/* MARKER_VATWATCHLISTOPS_GETDATA_ALIGN_BRANDCODE_V1 -- ตัด Checkbox-Spacer (4%) ออก ใช้ padding-left 20px แทน ให้ตรงกับ Padding ของฟอร์ม "ใบกำกับภาษีที่ Add" */}
                        <button ref={addDataButtonRef} onClick={async () => { // MARKER_VATWATCHLISTOPS_ADDDATA_VALIDATE_ZERO_DIFF_V1 -- ต้องส่วนต่าง = 0 ก่อนถึง Add Data ได้ -- MARKER_VATWATCHLISTOPS_FULLPAGE_CANCEL_VERTICAL_ALIGN_FIX_V1 -- ผูก Ref วัดตำแหน่งให้ปุ่ม Cancel
                          if (addTaxInvoiceList.length === 0) { // MARKER_VATWATCHLISTOPS_ADDDATA_ALLOW_MULTI_TAXINVOICE_V1 -- ผ่อนจาก "ต้องเป๊ะ 1" เป็น "อย่างน้อย 1" (Popvat Cancel+Simple Input รองรับหลายใบ)
                            await confirmDialog.alert(
                              'ต้องมี Tax Invoice อย่างน้อย 1 รายการก่อน Add Data',
                              { title: 'ยังไม่มี Tax Invoice', variant: 'danger' }
                            );
                            return;
                          }
                          if (rowsForSumFinal.length === 0) {
                            await confirmDialog.alert('ต้องมีอย่างน้อย 1 รายการใน Invoice List', { title: 'ไม่มีรายการ', variant: 'danger' });
                            return;
                          }
                          const referenceTaxBranchFP = String(addTaxInvoiceList[0]?.branch || '').trim(); // MARKER_VATWATCHLISTOPS_ADI_IB_TRIGGER_V1 -- ใช้ Branch ของ Tax Invoice ใบแรกเป็นตัวอ้างอิงเสมอ (Tax Invoice ทุกใบใน Batch ถือว่า Branch เดียวกัน)
                          const ibTriggeredFP = referenceTaxBranchFP !== '' && rowsForSumFinal.some((r) => String(r.branch || '').trim() !== referenceTaxBranchFP); // MARKER_VATWATCHLISTOPS_ADI_IB_TRIGGER_V1 -- Invoice ใบไหนก็ตาม Branch ไม่ตรงกับ Tax Invoice -> Trigger ทั้ง Batch
                          const distinctTaxInvoiceBranchesFP = [...new Set(addTaxInvoiceList.map((t) => String(t.branch || '').trim()).filter(Boolean))]; // MARKER_VATWATCHLISTOPS_ADI_MULTIBRANCH_TAXINVOICE_V1
                          const taxInvoiceMultiBranchFP = distinctTaxInvoiceBranchesFP.length > 1; // MARKER_VATWATCHLISTOPS_ADI_MULTIBRANCH_TAXINVOICE_V1 -- Tax Invoice หลาย Branch ไม่ใช่ Branch เดียวเหมือนที่ referenceTaxBranchFP สมมติไว้เดิม
                          if (Math.abs(sumAmount) >= 1 || Math.abs(sumVat) >= 1) { // MARKER_VATWATCHLISTOPS_ADDDATA_TOLERANCE_1BAHT_V1 -- ยอม +-1 บาท แทน 0.01
                            await confirmDialog.alert(
                              `ยอดรวมของ Tax Invoice List ยังไม่เท่ากับยอดของ List (ส่วนต่างมูลค่าสินค้า ${sumAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / ส่วนต่างเงินภาษี ${sumVat.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) กรุณาปรับ Tax Invoice List ให้ยอดตรงกันก่อน`,
                              { title: 'ยอดไม่ตรงกัน', variant: 'danger' }
                            );
                            return;
                          }
                          const taxTypeGroupsFP = new Set(rowsForSumFinal.map((r) => { // MARKER_VATWATCHLISTOPS_ADDDATA_TAXTYPE_CONSISTENCY_V1 -- ทุกแถวต้อง Asset(T/F)/Expense กลุ่มเดียวกัน
                            const c = classifyVatWatchlistTaxType(r.tax_type);
                            return (c && (c.prefix === 'T' || c.prefix === 'F')) ? 'asset' : 'expense';
                          }));
                          if (taxTypeGroupsFP.size > 1) {
                            await confirmDialog.alert(
                              'Invoice List มีทั้งประเภท Asset (Prefix T/F) และ Expense ปนกัน กรุณาแยก Add Data เป็นคนละครั้ง',
                              { title: 'ประเภทภาษีไม่ตรงกัน', variant: 'danger' }
                            );
                            return;
                          }
                          const isAssetGroupFP = taxTypeGroupsFP.has('asset'); // MARKER_VATWATCHLISTOPS_ADDDATA_TAXTYPE_CONSISTENCY_V1
                          const ibOrAssetTriggeredFP = ibTriggeredFP || isAssetGroupFP; // MARKER_VATWATCHLISTOPS_ASSET_FORCE_NNN_ADI_V1 -- Asset (T/F) บังคับเข้าโหมด NNN/ADI เสมอ แม้ Branch จะตรงกันก็ตาม
                          setFullPagePopvatDataFetched(true);
                          try { // MARKER_VATWATCHLISTOPS_ADDDATA_REAL_SAVE_LOGIC_V1 -- บันทึกจริง (Pattern เดียวกับ Quick Action ที่แก้ถูกแล้ว)
                            if (!ibOrAssetTriggeredFP && addTaxInvoiceList.length === 1) { // MARKER_VATWATCHLISTOPS_ADI_IB_TRIGGER_V1 -- เคส 1: Tax Invoice เดียว + Branch ตรงกัน = Popvat Transfer (Logic เดิม ไม่แก้) / IB Trigger หรือ Asset ให้ตกไปเคส 2 เสมอ -- MARKER_VATWATCHLISTOPS_ASSET_FORCE_NNN_ADI_V1
                            const taxInvoice = addTaxInvoiceList[0];
                            const draftId = generateQuickActionDraftId();
                            const periodStatusSingleFP = await apiFetch('/vat/period/status').catch(() => null); // MARKER_VATWATCHLISTOPS_POPVATDRAFT_PERIOD_MISSING_FIX_V1 -- เคส 1 ไม่เคยดึง Period มาก่อนเลย ทำให้ Column period เป็น NULL เสมอ (ต่างจากเคส 2 ที่มี Logic นี้อยู่แล้ว)
                            const periodTextSingleFP = formatQuickActionPeriodMMYYYY(periodStatusSingleFP ? periodStatusSingleFP.vat_period_current_month : null); // MARKER_VATWATCHLISTOPS_POPVATDRAFT_PERIOD_MISSING_FIX_V1
                            for (const row of rowsForSumFinal) {
                              await apiFetch('/vat_upload_popvatdraft', {
                                method: 'POST',
                                body: JSON.stringify({
                                  bu: bu?.bu,
                                  period: periodTextSingleFP, // MARKER_VATWATCHLISTOPS_POPVATDRAFT_PERIOD_MISSING_FIX_V1 -- เพิ่ม Field ที่ขาดไป
                                  book: bu?.BOOK || null,
                                  draft_id: draftId,
                                  branch: row.branch || null,
                                  grt_number: row.receive_doc_no, // MARKER_VATWATCHLISTOPS_ADDDATA_FIX_GRT_PER_INVOICE_V1 -- ดึงจากเลขที่ GRT เดิมของแต่ละ Invoice (เหมือน Quick Action ที่แก้ถูกแล้ว) ไม่ใช่ taxInvoice.grn ที่ Auto-gen ใหม่
                                  original_invoice_number: row.invoice_ref || null,
                                  receipt_date: formatQuickActionReceiveDateText(taxInvoice.receiveDate),
                                  tax_invoice_number: taxInvoice.grn, // MARKER_VATWATCHLISTOPS_ADDDATA_FIX_TAXINVOICENUM_USE_GRN_V1 -- ดึงจาก GRN Auto-gen ของ Tax Invoice (เหมือน Quick Action) ไม่ใช่ Tax Invoice No. ที่พิมพ์เอง
                                  tax_invoice_date: formatQuickActionReceiveDateText(taxInvoice.taxInvoiceDate),
                                  vendor_tax_invoice_number: taxInvoice.taxInvoiceNo, // MARKER_VATWATCHLISTOPS_VENDOR_TAXINVOICE_USE_TYPED_V1 -- เปลี่ยนจาก taxInvoice.grn เป็นค่าที่พิมพ์จริงในช่อง Tax Invoice Number
                                  supplier_tax_id: null,
                                  supplier_branch_number: null,
                                  supplier_name: row.vendor_name || null, // MARKER_VATWATCHLISTOPS_POPVATDRAFT_NEWFIELDS_V1
                                  check_no: row.check_no || null,
                                  product_value: row.exp_amount || null,
                                  vat_amount: row.exp_vat || null,
                                  status: 'draft',
                                  action: 'Popvat', // MARKER_VATWATCHLISTOPS_FULLPAGE_POPVAT_ACTION_TRACKING_V1
                                  menu_source: 'ap_vat', // MARKER_VATWATCHLISTOPS_ADDDATA_ADD_MENU_SOURCE_V1 MARKER_VATWATCHLISTOPS_MENU_SOURCE_AP_VAT_V1 -- แก้ค่าเป็น ap_vat ตามที่ยืนยัน
                                }),
                              });
                              const reportRows = await apiFetch(`/vat_watchlist_report?eq_bu=${encodeURIComponent(bu?.bu)}&eq_invoice_ref=${encodeURIComponent(row.invoice_ref)}`);
                              const matchedReport = (Array.isArray(reportRows) ? reportRows : []).filter((r) => r.status === 'pending');
                              for (const r of matchedReport) {
                                await apiFetch(`/vat_watchlist_report/${r.id}`, { method: 'PUT', body: JSON.stringify({ status: 'draft' }) });
                              }
                            }
                            } else { // MARKER_VATWATCHLISTOPS_ADDDATA_ALLOW_MULTI_TAXINVOICE_V1 -- เคส 2: Tax Invoice หลายใบ = Popvat Cancel (ต่อ Invoice) + Simple Input Transfer (ต่อ Tax Invoice)
                            const matchedSupplierFP = addTaxInvoiceSmCodeListData.find((s) => String(s['Supplier Code'] || '').trim() === String(addTaxInvoiceSupplierCode || '').trim()); // MARKER_VATWATCHLISTOPS_SIMPLEINPUT_REQUIRE_SUPPLIER_V1 -- ย้ายขึ้นมาเช็คก่อนเสมอ ไม่ว่าจะ NNN หรือ YNY เพราะ Simple Input ต้องมี Supplier Detail
                            if (!matchedSupplierFP) {
                              await confirmDialog.alert('เนื่องจากไม่มีข้อมูล Supplier ไม่สามารถดำเนินการต่อได้', { title: 'ไม่มีข้อมูล Supplier', variant: 'danger' });
                              return;
                            }
                            const periodStatusFP = await apiFetch('/vat/period/status').catch(() => null);
                            const currentPeriodMonthFP = periodStatusFP ? periodStatusFP.vat_period_current_month : null;
                            const periodTextFP = formatQuickActionPeriodMMYYYY(currentPeriodMonthFP);
                            const nowFP = new Date();
                            const sentinelReceiveDateFP = `1989-${String(nowFP.getMonth() + 1).padStart(2, '0')}-01`;
                            let simpleReceiveDateFP;
                            if (isAssetGroupFP) {
                              const ymAssetFP = currentPeriodMonthFP ? currentPeriodMonthFP.split('-') : [String(nowFP.getFullYear()), String(nowFP.getMonth() + 1).padStart(2, '0')];
                              simpleReceiveDateFP = `${ymAssetFP[0]}-${ymAssetFP[1]}-15`;
                            } else {
                              const ymExpFP = currentPeriodMonthFP ? currentPeriodMonthFP.split('-').map(Number) : [nowFP.getFullYear(), nowFP.getMonth() + 1];
                              const lastDayFP = new Date(ymExpFP[0], ymExpFP[1], 0).getDate();
                              simpleReceiveDateFP = `${ymExpFP[0]}-${String(ymExpFP[1]).padStart(2, '0')}-${String(lastDayFP).padStart(2, '0')}`;
                            }
                            const draftIdMultiFP = generateQuickActionDraftId();
                            // MARKER_VATWATCHLISTOPS_ADI_IB_INSERT_V1 -- ค่าคงที่ร่วมสำหรับ ADI Entry (เฉพาะตอน ibTriggeredFP)
                            const companyCodePartsFP = String(bu?.['COMPANY CODE'] || '').split('-').map((s) => s.trim()).filter(Boolean);
                            const busSegFP = companyCodePartsFP[0] || '';
                            const grpSegFP = companyCodePartsFP[1] || '';
                            const comSegFP = companyCodePartsFP[2] || '';
                            const adiCategoryFP = `${bu?.SEGMENT3 || ''}-IB-ALL`;
                            const [adiPeriodYearFP, adiPeriodMonthFP] = (currentPeriodMonthFP || '').split('-').map(Number); // MARKER_VATWATCHLISTOPS_ADI_PERIOD_FORMAT_FIX_V1
                            const ADI_MONTH_ABBR_FP = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']; // MARKER_VATWATCHLISTOPS_ADI_PERIOD_COLUMN_V1 -- กลับมาใช้สำหรับ adi_period (Column แยกใหม่)
                            const adiPeriodFP = (adiPeriodMonthFP && adiPeriodYearFP) ? `${ADI_MONTH_ABBR_FP[adiPeriodMonthFP - 1]}-${String(adiPeriodYearFP).slice(-2)}` : ''; // MARKER_VATWATCHLISTOPS_ADI_PERIOD_COLUMN_V1 -- Format AUG-26 เก็บใน Column adi_period แยกจาก period (09-2026)
                            const adiMmyyFP = (adiPeriodMonthFP && adiPeriodYearFP) ? `${String(adiPeriodMonthFP).padStart(2, '0')}${String(adiPeriodYearFP).slice(-2)}` : '';
                            const adiBatchNameFP = `APN-INPUT-${adiMmyyFP}-${comSegFP}-IB-001`;
                            const ADI_ACC_BY_CLS_FP = { N: ['11610752', '11630052'], A: ['11610752', '11630052'], T: ['11610755', '11630055'], F: ['11610755', '11630055'], M: ['11610751', '11630051'] };
                            const sharedClsFP = (classifyVatWatchlistTaxType(rowsForSumFinal[0]?.tax_type) || {}).cls || 'N'; // MARKER_VATWATCHLISTOPS_ADI_MULTIBRANCH_TAXINVOICE_V1 -- ใช้ Classification ตัวแทนจาก Invoice แถวแรก (ทุกแถว Asset/Expense กลุ่มเดียวกันอยู่แล้วจาก Validate)
                            const sharedJournalNameFP = `APN-SH15-${referenceTaxBranchFP}-IB-001`; // MARKER_VATWATCHLISTOPS_ADI_MULTIBRANCH_TAXINVOICE_V1 -- journal_name เดียวกันทั้งก้อน อิงจาก Branch ของ Tax Invoice ใบแรก
                            // MARKER_VATWATCHLISTOPS_ADI_DR_BEFORE_CR_ORDER_V1 -- ย้าย Dr. Loop มา Insert ก่อน Loop Cr./Popvat Cancel เพื่อให้ Draft Monitor เรียง Dr. ขึ้นก่อน Cr. เสมอ
                            if (taxInvoiceMultiBranchFP) { // MARKER_VATWATCHLISTOPS_ADI_MULTIBRANCH_TAXINVOICE_V1 -- Dr. ต่อ Tax Invoice แต่ละใบ (ทำหลัง Loop Cr. ต่อ Invoice จบแล้ว)
                              const [debitAccMultiFP] = ADI_ACC_BY_CLS_FP[sharedClsFP] || ADI_ACC_BY_CLS_FP.N;
                              const mmMultiDrFP = adiPeriodMonthFP ? String(adiPeriodMonthFP).padStart(2, '0') : '';
                              for (const t of addTaxInvoiceList) {
                                const lineDescDrMultiFP = `${mmMultiDrFP}-${adiPeriodYearFP || ''} ยื่นภาษีซื้อ ${isAssetGroupFP ? 'Asset' : 'Expense'} ผ่าน Excel|${bu?.bu || ''}-${matchedSupplierFP?.['Company Name'] || ''}|${t.taxInvoiceNo || ''}|${bu?.bu || ''}`;
                                await apiFetch('/vat_adi_transferdraft', { method: 'POST', body: JSON.stringify({
                                  bu: bu?.bu, book: bu?.BOOK || null, period: periodTextFP, adi_period: adiPeriodFP, draft_id: draftIdMultiFP, batch_id: null,
                                  category: adiCategoryFP, source: 'Excel-APN', acc_date: simpleReceiveDateFP,
                                  bus: busSegFP, grp: grpSegFP, com: comSegFP, cpc: '99999', sub_acc: '999999',
                                  batch_name: adiBatchNameFP, batch_description: null, journal_name: sharedJournalNameFP, journal_description: null,
                                  line_description: lineDescDrMultiFP, line_dff: null, branch_indicator: null, username, menu_source: 'ap_vat',
                                  branch: String(t.branch || '').trim(), acc: debitAccMultiFP, debit: Math.abs(Number(t.vat) || 0), credit: null,
                                }) });
                              }
                            }
                            for (const row of rowsForSumFinal) { // Popvat Cancel -- 1 Record ต่อ 1 Invoice (Pattern เดียวกับ Quick Action Popvat Cancel)
                              const cancelGrtFP = row.receive_doc_no || null;
                              await apiFetch('/vat_upload_popvatdraft', {
                                method: 'POST',
                                body: JSON.stringify({
                                  bu: bu?.bu,
                                  book: bu?.BOOK || null,
                                  period: periodTextFP,
                                  draft_id: draftIdMultiFP,
                                  branch: row.branch || null,
                                  grt_number: cancelGrtFP,
                                  original_invoice_number: row.invoice_ref || null,
                                  receipt_date: formatQuickActionReceiveDateText(sentinelReceiveDateFP),
                                  tax_invoice_number: cancelGrtFP,
                                  tax_invoice_date: formatQuickActionReceiveDateText(row.payment_date || null),
                                  vendor_tax_invoice_number: cancelGrtFP,
                                  supplier_tax_id: null,
                                  supplier_branch_number: null,
                                  supplier_name: row.vendor_name || null, // MARKER_VATWATCHLISTOPS_POPVATDRAFT_NEWFIELDS_V1
                                  check_no: row.check_no || null,
                                  product_value: row.exp_amount || null,
                                  vat_amount: row.exp_vat || null,
                                  status: 'draft',
                                  action: ibOrAssetTriggeredFP ? 'Simple_NNN' : 'Simple_YNY', // MARKER_VATWATCHLISTOPS_FULLPAGE_POPVAT_ACTION_TRACKING_V1 -- MARKER_VATWATCHLISTOPS_POPVAT_ACTION_ASSET_NNN_FIX_V1 -- Asset (T/F) ต้องเป็น Simple_NNN เสมอ แม้ Branch จะตรงกันก็ตาม (สอดคล้องกับ type_sim ฝั่ง Simple Input)
                                  menu_source: 'ap_vat',
                                }),
                              });
                              const reportRowsFP = await apiFetch(`/vat_watchlist_report?eq_bu=${encodeURIComponent(bu?.bu)}&eq_invoice_ref=${encodeURIComponent(row.invoice_ref)}`);
                              const matchedReportFP = (Array.isArray(reportRowsFP) ? reportRowsFP : []).filter((r) => r.status === 'pending');
                              for (const r of matchedReportFP) {
                                await apiFetch(`/vat_watchlist_report/${r.id}`, { method: 'PUT', body: JSON.stringify({ status: 'draft' }) });
                              }
                              if (taxInvoiceMultiBranchFP) { // MARKER_VATWATCHLISTOPS_ADI_MULTIBRANCH_TAXINVOICE_V1 -- Case ใหม่: Tax Invoice หลาย Branch -> Cr. ต่อ Invoice (Dr. แยกไปทำหลัง Loop นี้)
                                const [, creditAccMultiFP] = ADI_ACC_BY_CLS_FP[sharedClsFP] || ADI_ACC_BY_CLS_FP.N;
                                const mmMultiCrFP = adiPeriodMonthFP ? String(adiPeriodMonthFP).padStart(2, '0') : '';
                                const lineDescCrMultiFP = `${mmMultiCrFP}-${adiPeriodYearFP || ''} ยื่นภาษีซื้อ ${isAssetGroupFP ? 'Asset' : 'Expense'} ผ่าน Excel|${bu?.bu || ''}-${row.vendor_name || ''}|${row.invoice_ref || ''}|${bu?.bu || ''}`;
                                await apiFetch('/vat_adi_transferdraft', { method: 'POST', body: JSON.stringify({
                                  bu: bu?.bu, book: bu?.BOOK || null, period: periodTextFP, adi_period: adiPeriodFP, draft_id: draftIdMultiFP, batch_id: null,
                                  category: adiCategoryFP, source: 'Excel-APN', acc_date: simpleReceiveDateFP,
                                  bus: busSegFP, grp: grpSegFP, com: comSegFP, cpc: '99999', sub_acc: '999999',
                                  batch_name: adiBatchNameFP, batch_description: null, journal_name: sharedJournalNameFP, journal_description: null,
                                  line_description: lineDescCrMultiFP, line_dff: null, branch_indicator: null, username, menu_source: 'ap_vat',
                                  branch: String(row.branch || '').trim(), acc: creditAccMultiFP, debit: null, credit: Math.abs(Number(row.exp_vat) || 0), // MARKER_VATWATCHLISTOPS_ADI_CREDIT_USE_VAT_V1 -- ยืนยันแล้วว่าต้องเป็น Vat ไม่ใช่ Amount (Dr./Cr. ต้องเป็น Vat เหมือนกันทั้งคู่)
                                }) });
                              } else if (ibOrAssetTriggeredFP) { // MARKER_VATWATCHLISTOPS_ADI_IB_INSERT_V1 -- ทุก Invoice ออก ADI 2 บรรทัด (Debit/Credit) เมื่อ IB Trigger หรือ Asset (ยกเว้น Average-IB ออก 3 บรรทัด -- ดู MARKER_VATWATCHLISTOPS_ADI_AVERAGE_IB_SPLIT3_V1) -- MARKER_VATWATCHLISTOPS_ASSET_FORCE_NNN_ADI_V1
                                const clsInfoAdiFP = classifyVatWatchlistTaxType(row.tax_type);
                                const clsKeyAdiFP = (clsInfoAdiFP && clsInfoAdiFP.cls) || 'N';
                                const [debitAccAdiFP, creditAccAdiFP] = ADI_ACC_BY_CLS_FP[clsKeyAdiFP] || ADI_ACC_BY_CLS_FP.N;
                                const invoiceBranchAdiFP = String(row.branch || '').trim();
                                const buRateForAdiFP = parseFloat(bu?.['VAT %']);
                                const mmAdiFP = adiPeriodMonthFP ? String(adiPeriodMonthFP).padStart(2, '0') : '';
                                const isAverageIbAdiFP = clsKeyAdiFP === 'A'; // MARKER_VATWATCHLISTOPS_ADI_AVERAGE_IB_SPLIT3_V1 -- Average-IB (Prefix A): แยก ADI เป็น 3 บรรทัด เฉพาะยอดภาษี (ไม่ยุ่งกับยอดเงินต้น) ตามที่ Confirm
                                if (isAverageIbAdiFP) {
                                  const vatRawAvgAdiFP = Number(row.exp_vat) || 0;
                                  const isNegAvgAdiFP = vatRawAvgAdiFP < 0;
                                  const vatAbsAvgAdiFP = Math.abs(vatRawAvgAdiFP);
                                  const recoverableAvgAdiFP = truncateMoney2(vatAbsAvgAdiFP * (buRateForAdiFP || 0) / 100); // MARKER_VATWATCHLISTOPS_ADI_AVERAGE_IB_SPLIT3_V1 MARKER_VATWATCHLISTOPS_ADI_ROUNDING_PRECISION_FIX_V1 -- ตัดเศษทิ้ง (Truncate) แบบกัน Floating Point Error
                                  const nonRecoverableAvgAdiFP = roundMoney2(vatAbsAvgAdiFP - recoverableAvgAdiFP); // MARKER_VATWATCHLISTOPS_ADI_ROUNDING_PRECISION_FIX_V1
                                  const taxSideBranchAdiFP = isNegAvgAdiFP ? invoiceBranchAdiFP : referenceTaxBranchFP; // ฝั่งบรรทัด 11610752 + 63050000
                                  const invoiceSideBranchAdiFP = isNegAvgAdiFP ? referenceTaxBranchFP : invoiceBranchAdiFP; // ฝั่งบรรทัด 11630052
                                  const journalNameAvgAdiFP = `APN-SH15-${taxSideBranchAdiFP}-IB-001`;
                                  const lineDescAvgAdiFP = `${mmAdiFP}-${adiPeriodYearFP || ''} ยื่นภาษีซื้อ Expense ผ่าน Excel|${bu?.bu || ''}-${row.vendor_name || ''}|${row.invoice_ref || ''}|${bu?.bu || ''}`;
                                  const adiBaseFieldsAvgFP = {
                                    bu: bu?.bu, book: bu?.BOOK || null, period: periodTextFP, adi_period: adiPeriodFP, draft_id: draftIdMultiFP, batch_id: null,
                                    category: adiCategoryFP, source: 'Excel-APN', acc_date: simpleReceiveDateFP,
                                    bus: busSegFP, grp: grpSegFP, com: comSegFP,
                                    batch_name: adiBatchNameFP, batch_description: null, journal_name: journalNameAvgAdiFP, journal_description: null,
                                    line_description: lineDescAvgAdiFP, line_dff: null, branch_indicator: null, username, menu_source: 'ap_vat',
                                  };
                                  // บรรทัด 1: 11610752 (ส่วนเครดิตได้) -- ปกติ Debit / ถ้ายอดติดลบ Credit
                                  await apiFetch('/vat_adi_transferdraft', { method: 'POST', body: JSON.stringify({
                                    ...adiBaseFieldsAvgFP, branch: taxSideBranchAdiFP, acc: '11610752', cpc: '99999', sub_acc: '999999',
                                    debit: isNegAvgAdiFP ? null : recoverableAvgAdiFP, credit: isNegAvgAdiFP ? recoverableAvgAdiFP : null,
                                  }) });
                                  // บรรทัด 2: 63050000 (ส่วนเครดิตไม่ได้, CPC 45700) -- ปกติ Debit / ถ้ายอดติดลบ Credit
                                  await apiFetch('/vat_adi_transferdraft', { method: 'POST', body: JSON.stringify({
                                    ...adiBaseFieldsAvgFP, branch: taxSideBranchAdiFP, acc: '63050000', cpc: '45700', sub_acc: '999999',
                                    debit: isNegAvgAdiFP ? null : nonRecoverableAvgAdiFP, credit: isNegAvgAdiFP ? nonRecoverableAvgAdiFP : null,
                                  }) });
                                  // บรรทัด 3: 11630052 (ฝั่ง Invoice เต็มยอดภาษี) -- ปกติ Credit / ถ้ายอดติดลบ Debit
                                  await apiFetch('/vat_adi_transferdraft', { method: 'POST', body: JSON.stringify({
                                    ...adiBaseFieldsAvgFP, branch: invoiceSideBranchAdiFP, acc: '11630052', cpc: '99999', sub_acc: '999999',
                                    debit: isNegAvgAdiFP ? vatAbsAvgAdiFP : null, credit: isNegAvgAdiFP ? null : vatAbsAvgAdiFP,
                                  }) });
                                } else {
                                  const isAssetAverageAdiFP = (clsKeyAdiFP === 'T' || clsKeyAdiFP === 'F') && buRateForAdiFP !== 100; // MARKER_VATWATCHLISTOPS_ADI_ASSET_AVERAGE_AMOUNT_V1 -- Asset-IB (A): Asset(T/F) + BU Rate != 100%
                                  const amtRawAdiFP = isAssetAverageAdiFP
                                    ? roundMoney2((Number(row.exp_vat) || 0) * (buRateForAdiFP || 0) / 100) // MARKER_VATWATCHLISTOPS_ADI_ASSET_AVERAGE_AMOUNT_V1 MARKER_VATWATCHLISTOPS_ADI_ROUNDING_PRECISION_FIX_V1 -- ROUND(Vat * Average% / 100, 2) แบบกัน Floating Point Error
                                    : (Number(row.exp_vat) || 0); // MARKER_VATWATCHLISTOPS_ADI_USE_VAT_NOT_AMOUNT_V1 -- ยอด ADI ต้องเป็น VAT เสมอ (Normal-IB + Asset-IB(N)) ไม่ใช่มูลค่าสินค้า
                                  const isNegAdiFP = amtRawAdiFP < 0;
                                  const amtAdiFP = Math.abs(amtRawAdiFP);
                                  const debitBranchAdiFP = isNegAdiFP ? invoiceBranchAdiFP : referenceTaxBranchFP;
                                  const debitAccFinalAdiFP = isNegAdiFP ? creditAccAdiFP : debitAccAdiFP;
                                  const creditBranchAdiFP = isNegAdiFP ? referenceTaxBranchFP : invoiceBranchAdiFP;
                                  const creditAccFinalAdiFP = isNegAdiFP ? debitAccAdiFP : creditAccAdiFP;
                                  const journalNameAdiFP = `APN-SH15-${debitBranchAdiFP}-IB-001`;
                                  const expenseAssetLabelAdiFP = (clsKeyAdiFP === 'T' || clsKeyAdiFP === 'F') ? 'Asset' : 'Expense';
                                  const lineDescAdiFP = `${mmAdiFP}-${adiPeriodYearFP || ''} ยื่นภาษีซื้อ ${expenseAssetLabelAdiFP} ผ่าน Excel|${bu?.bu || ''}-${row.vendor_name || ''}|${row.invoice_ref || ''}|${bu?.bu || ''}`;
                                  const adiBaseFieldsFP = {
                                    bu: bu?.bu, book: bu?.BOOK || null, period: periodTextFP, adi_period: adiPeriodFP, draft_id: draftIdMultiFP, batch_id: null, // MARKER_VATWATCHLISTOPS_ADI_PERIOD_FORMAT_FIX_V1 MARKER_VATWATCHLISTOPS_ADI_PERIOD_COLUMN_V1 -- period=09-2026 (เหมือน Popvat/Simple) / adi_period=AUG-26 (Column แยกใหม่)
                                    category: adiCategoryFP, source: 'Excel-APN', acc_date: simpleReceiveDateFP,
                                    bus: busSegFP, grp: grpSegFP, com: comSegFP, cpc: '99999', sub_acc: '999999',
                                    batch_name: adiBatchNameFP, batch_description: null, journal_name: journalNameAdiFP, journal_description: null,
                                    line_description: lineDescAdiFP, line_dff: null, branch_indicator: null, username, menu_source: 'ap_vat',
                                  };
                                  await apiFetch('/vat_adi_transferdraft', { method: 'POST', body: JSON.stringify({ ...adiBaseFieldsFP, branch: debitBranchAdiFP, acc: debitAccFinalAdiFP, debit: amtAdiFP, credit: null }) });
                                  await apiFetch('/vat_adi_transferdraft', { method: 'POST', body: JSON.stringify({ ...adiBaseFieldsFP, branch: creditBranchAdiFP, acc: creditAccFinalAdiFP, debit: null, credit: amtAdiFP }) });
                                }
                              }
                            }
                            for (const t of addTaxInvoiceList) { // Simple Input Transfer -- 1 Record ต่อ 1 Tax Invoice
                              const matchedBranchFP = addTaxInvoiceBranchListData.find((b) => String(b['Branch Code'] || '').trim() === String(t.branch || '').trim());
                              const pctFP = matchedBranchFP ? String(matchedBranchFP['%'] || '').trim() : '';
                              const isExpenseAverageSpecialFP = !isAssetGroupFP && pctFP !== '' && pctFP !== '100'; // MARKER_VATWATCHLISTOPS_SIMPLEINPUT_EXPENSE_AVERAGE_SPECIAL_V1 -- Expense (ไม่ใช่ Asset T/F) + Average % (Branch % ไม่ใช่ 100) -> Override CPC (Special)/Sub Account (Special)/Expense Type
                              const checkNoFP = rowsForSumFinal[0]?.check_no || '';
                              const supplierNameFP = matchedSupplierFP ? (matchedSupplierFP['Company Name'] || '') : '';
                              const descPeriodFP = periodTextFP ? periodTextFP.split('-').reverse().join('/') : '';
                              await apiFetch('/vat_simpleinputdraft', {
                                method: 'POST',
                                body: JSON.stringify({
                                  bu: bu?.bu,
                                  book: bu?.BOOK || null,
                                  period: periodTextFP,
                                  draft_id: draftIdMultiFP,
                                  menu_source: 'ap_vat',
                                  liability_cost_center_special: ibOrAssetTriggeredFP ? null : (addTaxInvoiceSupplierCpcCr || null), // MARKER_VATWATCHLISTOPS_SIMPLEINPUT_NNN_NULL_CR_V1 -- ตอน NNN (IB Trigger หรือ Asset) ไม่ต้องใส่ Account ฝั่ง Cr. เลย -- MARKER_VATWATCHLISTOPS_ASSET_FORCE_NNN_ADI_V1
                                  liability_account_special: ibOrAssetTriggeredFP ? null : (addTaxInvoiceSupplierAccountCr || null), // MARKER_VATWATCHLISTOPS_SIMPLEINPUT_NNN_NULL_CR_V1 -- MARKER_VATWATCHLISTOPS_ASSET_FORCE_NNN_ADI_V1
                                  liability_sub_account_special: ibOrAssetTriggeredFP ? null : (addTaxInvoiceSupplierSubCr || null), // MARKER_VATWATCHLISTOPS_SIMPLEINPUT_NNN_NULL_CR_V1 -- MARKER_VATWATCHLISTOPS_ASSET_FORCE_NNN_ADI_V1
                                  cpc_special: isExpenseAverageSpecialFP ? '45700' : null, // MARKER_VATWATCHLISTOPS_SIMPLEINPUT_EXPENSE_AVERAGE_SPECIAL_V1 MARKER_VATWATCHLISTOPS_CPC_SPECIAL_NULL_FIX_V1 -- เดิม Fallback ไปใช้ CPC Dr ของ Vendor Master ทำให้โชว่ค่าแม้ไม่เข้าเงื่อนไข Special
                                  sub_account_special: isExpenseAverageSpecialFP ? '999999' : null, // MARKER_VATWATCHLISTOPS_SIMPLEINPUT_EXPENSE_AVERAGE_SPECIAL_V1 -- Confirm แล้ว: Expense+Average -> 999999 (เดิม Pending)
                                  cpc_tax_special: null, // MARKER_VATWATCHLISTOPS_SIMPLEINPUT_DR_PENDING_V1 -- รอ Confirm เงื่อนไขเพิ่มเติม (ผูกกับ % VAT + Asset/Expense)
                                  supplier_code: null, // MARKER_VATWATCHLISTOPS_SIMPLEINPUT_SUPPLIER_CODE_ALWAYS_NULL_V1 -- Confirm แล้วว่าไม่ต้อง Match Supplier Code เลย ให้เป็น null เสมอ (ย้อนกลับจาก MARKER_VATWATCHLISTOPS_SIMPLEINPUT_SUPPLIER_CODE_FIX_V1)
                                  supplier_name: supplierNameFP || null,
                                  tax_id: matchedSupplierFP ? (matchedSupplierFP['Tax ID'] || null) : null,
                                  receive_date: formatQuickActionReceiveDateText(simpleReceiveDateFP),
                                  tax_invoice_number: t.grn, // MARKER_VATWATCHLISTOPS_SIMPLEINPUT_TAXINVOICENUMBER_USE_GRN_V1 -- ใช้ GRN ไม่ใช่ Tax Invoice No. ที่พิมพ์เอง (ยืนยันแล้ว)
                                  tax_invoice_date: formatQuickActionReceiveDateText(t.taxInvoiceDate),
                                  vendor_tax_invoice_number: t.taxInvoiceNo,
                                  branch_no: matchedSupplierFP ? (matchedSupplierFP['Branch'] || null) : null,
                                  branch_code: matchedBranchFP ? (matchedBranchFP['Simple Brand Code'] || null) : null,
                                  line_number: null,
                                  expense_type: isExpenseAverageSpecialFP // MARKER_VATWATCHLISTOPS_SIMPLEINPUT_EXPENSE_AVERAGE_SPECIAL_V1 -- Expense+Average -> ดึง Option ขึ้นต้น 63050000 จากระบบ (Pattern เดียวกับ Add Supplier Form) ไม่ Hardcode ข้อความเต็ม
                                    ? (getAddSupplierOptions('Expense Type').find((o) => String(o).startsWith('63050000')) || (matchedSupplierFP ? (matchedSupplierFP['Expense Type'] || null) : null))
                                    : (matchedSupplierFP ? (matchedSupplierFP['Expense Type'] || null) : null),
                                  description: `${descPeriodFP} ยื่นรายงาน Excel|${supplierNameFP}|${t.taxInvoiceNo} Payment Doc Ref. ${checkNoFP}`,
                                  amount_ex_vat: t.amount,
                                  vat_amount: t.vat,
                                  vat_average_percent: (pctFP && pctFP !== '100') ? pctFP : null,
                                  grt_run: null,
                                  check_error: null,
                                  code: null,
                                  type_sim: ibOrAssetTriggeredFP ? 'NNN' : 'YNY', // MARKER_VATWATCHLISTOPS_ADI_IB_TRIGGER_V1 -- MARKER_VATWATCHLISTOPS_ASSET_FORCE_NNN_ADI_V1
                                  invoice_ref: Number(t.amount) < 0 ? 'Credit' : 'Invoice',
                                }),
                              });
                            }
                            }
                            if (addTaxInvoiceGrtControl === 'Auto' && addTaxInvoiceLastUsedGrtRunningRef.current != null) { // MARKER_VATWATCHLISTOPS_ADDTAX_GRN_RUNNING_FIX_V1 -- เขียนกลับ DB + Broadcast (Pattern เดียวกับ Quick Action)
                              await apiFetch(`/company_list/${bu.id}`, { method: 'PUT', body: JSON.stringify({ vat_grn: addTaxInvoiceLastUsedGrtRunningRef.current }) }).catch((err) => console.error('Update vat_grn error (Full Page):', err));
                              broadcastWs('vat_grn_updated', { bu: bu?.bu, vat_grn: addTaxInvoiceLastUsedGrtRunningRef.current });
                            }
                            const doneKeysFullPage = new Set(rowsForSumFinal.map((r) => getNoteKey(r)));
                            setFullPagePopvatRows((prev) => prev.filter((r) => !doneKeysFullPage.has(getNoteKey(r))));
                            setAddTaxInvoiceList([]);
                            setSelectedFullPageInvoices(new Set());
                            setDetailSearch('');
                            setDetailSearchDebounced('');
                            broadcastWs('vat_watchlist_draft_updated', { bu: bu?.bu, invoice_refs: rowsForSumFinal.map((r) => r.invoice_ref) });
                            await confirmDialog.alert(`บันทึกสำเร็จ (${rowsForSumFinal.length} รายการ)`, { title: 'สำเร็จ', variant: 'success' });
                          } catch (err) {
                            console.error('Add Data (Full Page) save error:', err);
                            await confirmDialog.alert('บันทึกไม่สำเร็จ กรุณาลองใหม่', { title: 'เกิดข้อผิดพลาด', variant: 'danger' });
                          }
                        }} style={{ width: brandCodeWidth ? `${brandCodeWidth}px` : '180px', boxSizing: 'border-box', height: '30px', padding: '6px 10px', fontSize: '12px', border: 'none', borderRadius: '8px', background: '#1a3a5c', color: 'white', cursor: 'pointer', whiteSpace: 'nowrap' }}>Add Data</button> {/* MARKER_VATWATCHLISTOPS_FULLPAGE_ADDDATA_BUTTON_HEIGHT_V1 -- height เท่ากับปุ่ม Cancel (30px) */} {/* MARKER_VATWATCHLISTOPS_GETDATA_ALIGN_BRANDCODE_V1 MARKER_VATWATCHLISTOPS_ADDTAX_LAYOUT_SYNC_V1 -- ความกว้างอิงจาก Brand Code จริงแบบ Dynamic */}
                      </td>
                      <td style={{ width: '13%', padding: '4px 10px' }} /> {/* MARKER_VATWATCHLISTOPS_SELECT_STYLE_CANCEL_POSITION_FIX_V1 -- Cancel ย้ายออกไปเป็น Absolute นอกตารางแล้ว กันปัญหาทับ Add Data */}
                      <td style={{ width: '21%', padding: '4px 10px', color: '#999', fontSize: '11px' }}>{selectedRows2.length > 0 ? `เลือก ${selectedRows2.length} รายการ` : ''}</td> {/* MARKER_VATWATCHLISTOPS_GETDATA_WIDTH_15_V1 -- ลด 26% -> 21% ให้ Get Data ขยายได้ */}
                      <td style={{ width: '13%', padding: '4px 10px' }} />
                      <td style={{ width: '14%', padding: '4px 10px' }} /> {/* MARKER_VATWATCHLISTOPS_FULLPAGE_BUTTONS_LEFT_V1 -- เดิมมี Collect Data อยู่ตรงนี้ ย้ายออกไปแล้ว เหลือว่าง */}
                      <td style={{ width: '12%', padding: '4px 10px', textAlign: 'right', fontWeight: '500' }}>{Number.isFinite(sumAmount) ? sumAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}</td> {/* MARKER_VATWATCHLISTOPS_FIX_ZERO_AMOUNT_DISPLAY_V1 -- แก้ 0 ไม่โดนซ่อนอีกต่อไป (0 เป็น Falsy ใน JS) */}
                      <td style={{ width: '8%', padding: '4px 10px', textAlign: 'right', fontWeight: '500' }}>{Number.isFinite(sumVat) ? sumVat.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}</td>
                    </tr>
                  </tbody>
                </table>
              );
            })()}
            <button type="button" disabled={fullPageCancelSaving} onClick={async () => { // MARKER_VATWATCHLISTOPS_FULLPAGE_CANCEL_BUTTON_ACTION_V1 -- Cancel เข้า DB จริงแล้ว เหมือน Quick Action Cancel (เดิมแค่ Reset ฟอร์ม)
              const resetTaxInvoiceFormFP = () => {
                setAddTaxInvoiceNumber(''); setAddTaxInvoiceDate(''); setAddTaxInvoiceAmount(''); setAddTaxInvoiceVat('');
                if (addTaxInvoiceDateTextRef.current) addTaxInvoiceDateTextRef.current.value = '';
              };
              // MARKER_VATWATCHLISTOPS_FULLPAGE_CANCEL_SCOPE_FIX_V1 -- คำนวณ rowsForSumFinal ใหม่ในจุดนี้ (Scope เดิมปิดไปแล้วก่อนถึงปุ่มนี้) สูตรเดียวกันเป๊ะกับต้นฉบับ
              const q2CancelFP = detailSearch.trim().toLowerCase();
              const qTerms2CancelFP = q2CancelFP.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
              const rows2CancelFP = qTerms2CancelFP.length === 0 ? [] : fullPagePopvatRows.filter((r) =>
                qTerms2CancelFP.some((term) =>
                  String(r.invoice_ref || '').toLowerCase().includes(term) ||
                  String(r.receive_doc_no || '').toLowerCase().includes(term) ||
                  String(r.vendor_name || '').toLowerCase().includes(term) ||
                  String(r.check_no || '').toLowerCase().includes(term)
                )
              );
              const selectedRows2CancelFP = rows2CancelFP.filter((r) => selectedFullPageInvoices.has(getNoteKey(r)));
              const rowsForSumFinalCancelFP = selectedRows2CancelFP.length > 0 ? selectedRows2CancelFP : rows2CancelFP; // มีติ๊ก -> เฉพาะที่ติ๊ก / ไม่ติ๊กเลย -> ทั้งหมด
              if (rowsForSumFinalCancelFP.length === 0) { resetTaxInvoiceFormFP(); return; }
              setFullPageCancelSaving(true);
              try {
                const periodStatusCancelFP = await apiFetch('/vat/period/status').catch(() => null);
                const currentPeriodMonthCancelFP = periodStatusCancelFP ? periodStatusCancelFP.vat_period_current_month : null;
                const periodTextCancelFP = formatQuickActionPeriodMMYYYY(currentPeriodMonthCancelFP);
                const nowCancelFP = new Date();
                const sentinelReceiveDateCancelFP = `1989-${String(nowCancelFP.getMonth() + 1).padStart(2, '0')}-01`;
                const draftIdCancelFP = generateQuickActionDraftId();
                for (const row of rowsForSumFinalCancelFP) { // Cancel -- 1 Record ต่อ 1 Invoice (Pattern เดียวกับ Quick Action Popvat Cancel)
                  const cancelGrtCancelFP = row.receive_doc_no || null;
                  await apiFetch('/vat_upload_popvatdraft', {
                    method: 'POST',
                    body: JSON.stringify({
                      bu: bu?.bu,
                      book: bu?.BOOK || null,
                      period: periodTextCancelFP,
                      draft_id: draftIdCancelFP,
                      branch: row.branch || null,
                      grt_number: cancelGrtCancelFP,
                      original_invoice_number: row.invoice_ref || null,
                      receipt_date: formatQuickActionReceiveDateText(sentinelReceiveDateCancelFP),
                      tax_invoice_number: cancelGrtCancelFP,
                      tax_invoice_date: formatQuickActionReceiveDateText(row.payment_date || null),
                      vendor_tax_invoice_number: cancelGrtCancelFP,
                      supplier_tax_id: null,
                      supplier_branch_number: null,
                      supplier_name: row.vendor_name || null,
                      check_no: row.check_no || null,
                      product_value: row.exp_amount || null,
                      vat_amount: row.exp_vat || null,
                      status: 'draft',
                      action: 'Cancel', // MARKER_VATWATCHLISTOPS_FULLPAGE_CANCEL_BUTTON_ACTION_V1
                      menu_source: 'ap_vat',
                    }),
                  });
                  const reportRowsCancelFP = await apiFetch(`/vat_watchlist_report?eq_bu=${encodeURIComponent(bu?.bu)}&eq_invoice_ref=${encodeURIComponent(row.invoice_ref)}`);
                  const matchedReportCancelFP = (Array.isArray(reportRowsCancelFP) ? reportRowsCancelFP : []).filter((r) => r.status === 'pending');
                  for (const r of matchedReportCancelFP) {
                    await apiFetch(`/vat_watchlist_report/${r.id}`, { method: 'PUT', body: JSON.stringify({ status: 'draft' }) });
                  }
                }
                const doneKeysCancelFP = new Set(rowsForSumFinalCancelFP.map((r) => getNoteKey(r)));
                setFullPagePopvatRows((prev) => prev.filter((r) => !doneKeysCancelFP.has(getNoteKey(r))));
                setSelectedFullPageInvoices((prev) => {
                  const next = new Set(prev);
                  doneKeysCancelFP.forEach((k) => next.delete(k));
                  return next;
                });
                resetTaxInvoiceFormFP();
                setDetailSearch('');
                setDetailSearchDebounced('');
                broadcastWs('vat_watchlist_draft_updated', { bu: bu?.bu, invoice_refs: rowsForSumFinalCancelFP.map((r) => r.invoice_ref) });
                await confirmDialog.alert(`Cancel สำเร็จ (${doneKeysCancelFP.size} รายการ)`, { title: 'สำเร็จ', variant: 'success' });
              } catch (err) {
                console.error('Full Page Invoice Cancel error:', err);
                await confirmDialog.alert('Cancel ไม่สำเร็จ กรุณาลองใหม่', { title: 'เกิดข้อผิดพลาด', variant: 'danger' });
              } finally {
                setFullPageCancelSaving(false);
              }
            }} style={{ position: 'absolute', left: cancelButtonLeft != null ? `${cancelButtonLeft}px` : 'auto', top: cancelButtonTop != null ? `${cancelButtonTop}px` : '50%', transform: 'translateY(-50%)', width: cancelButtonWidth ? `${cancelButtonWidth}px` : 'auto', boxSizing: 'border-box', height: '30px', padding: '0 10px', fontSize: '12px', border: 'none', borderRadius: '8px', background: '#e8820c', color: 'white', cursor: fullPageCancelSaving ? 'default' : 'pointer', opacity: fullPageCancelSaving ? 0.6 : 1, whiteSpace: 'nowrap', boxShadow: '0 1px 3px rgba(16,24,40,0.12)' }}> {/* MARKER_VATWATCHLISTOPS_SELECT_STYLE_CANCEL_POSITION_FIX_V1 MARKER_VATWATCHLISTOPS_HYBRID_TAXINVOICEDATE_V1 -- Reset Text Ref ด้วย (Uncontrolled Input) */}
              Cancel
            </button>
          </div>
          </div> {/* MARKER_VATWATCHLISTOPS_FULLPAGE_MERGE_CARDS_V1 -- ปิด Card 3 */}
          </div> {/* MARKER_VATWATCHLISTOPS_FULLPAGE_POLISH_LEFT_V1 -- ปิด Wrapper กลุ่มกล่องฝั่งซ้าย */}
          </div>
        </div>
      )}

      {/* MARKER_VATWATCHLISTOPS_QUICK_ACTION_V1 -- Modal Quick Action (3 Zone) */}
      {showQuickAction && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
          <div style={{ background: 'white', borderRadius: '12px', width: '760px', maxWidth: '95vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '0.5px solid #e8e8e8', flexShrink: 0 }}>
              <div style={{ fontSize: '15px', fontWeight: '500' }}>Quick Action</div>
              <button onClick={closeQuickAction} style={{ width: '28px', height: '28px', padding: 0, border: 'none', borderRadius: '50%', background: '#f0f0f0', cursor: 'pointer', fontSize: '14px', color: '#666' }}>×</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              <div style={{ padding: '14px 20px 0' }}>
                <div style={{ fontSize: '11px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '8px' }}>Vendor Detail</div>
                <div style={{ background: '#f7f7f7', borderRadius: '8px', padding: '10px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', fontSize: '13px' }}>
                  <div><span style={{ color: '#888' }}>ชื่อผู้ค้า: </span>{quickActionVendor?.vendor_name || '—'}</div>
                  <div><span style={{ color: '#888' }}>Supplier Code: </span>{quickActionVendor?.supplier_code || '—'}</div>
                  <div><span style={{ color: '#888' }}>Tax ID: </span>{quickActionVendor?.tax_id || '—'}</div>
                  <div><span style={{ color: '#888' }}>Branch No.: </span>{quickActionVendor?.branch_no || '—'}</div>
                </div>
              </div>
              <div style={{ padding: '14px 20px 0' }}>
                <div style={{ fontSize: '11px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '8px' }}>Invoice List ({quickActionRows.length})</div>
                <div style={{ border: '0.5px solid #e8e8e8', borderRadius: '8px', height: '190px', display: 'flex', flexDirection: 'column' }}> {/* MARKER_VATWATCHLISTOPS_QUICK_ACTION_V1 -- height ตายตัว = พื้นที่ 5 แถวเสมอ, Flex ดันแถวสรุปยอดไปสุดล่างจริง */}
                  <div style={{ flex: 1, overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', tableLayout: 'fixed' }}>
                    <colgroup> {/* MARKER_VATWATCHLISTOPS_QUICK_ACTION_V1 -- สัดส่วนเดียวกับตาราง Body กันคอลัมน์เพี้ยน */}
                      <col style={{ width: '15%' }} />
                      <col style={{ width: '20%' }} />
                      <col style={{ width: '25%' }} />
                      <col style={{ width: '20%' }} />
                      <col style={{ width: '20%' }} />
                    </colgroup>
                      <thead>
                        <tr>
                          <th style={{ position: 'sticky', top: 0, textAlign: 'left', padding: '6px 10px', background: '#f0f0f0', fontWeight: '500' }}>Branch</th>
                          <th style={{ position: 'sticky', top: 0, textAlign: 'left', padding: '6px 10px', background: '#f0f0f0', fontWeight: '500' }}>เลขที่ GRT</th>
                          <th style={{ position: 'sticky', top: 0, textAlign: 'left', padding: '6px 10px', background: '#f0f0f0', fontWeight: '500' }}>ใบแจ้งหนี้</th>
                          <th style={{ position: 'sticky', top: 0, textAlign: 'right', padding: '6px 10px', background: '#f0f0f0', fontWeight: '500' }}>มูลค่าสินค้า</th>
                          <th style={{ position: 'sticky', top: 0, textAlign: 'right', padding: '6px 10px', background: '#f0f0f0', fontWeight: '500' }}>มูลค่าภาษี</th>
                        </tr>
                      </thead>
                      <tbody>
                        {quickActionRows.map((r, i) => (
                          <tr key={i} style={{ borderTop: '0.5px solid #eee' }}>
                            <td style={{ padding: '6px 10px' }}>{r.branch || '—'}</td>
                            <td style={{ padding: '6px 10px' }}>{r.receive_doc_no || '—'}</td>
                            <td style={{ padding: '6px 10px' }}>{r.invoice_ref || '—'}</td>
                            <td style={{ padding: '6px 10px', textAlign: 'right' }}>{r.exp_amount != null && r.exp_amount !== '' ? Number(r.exp_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                            <td style={{ padding: '6px 10px', textAlign: 'right' }}>{r.exp_vat != null && r.exp_vat !== '' ? Number(r.exp_vat).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', tableLayout: 'fixed', flexShrink: 0 }}> {/* MARKER_VATWATCHLISTOPS_QUICK_ACTION_V1 -- ตาราง Footer แยกต่างหาก ติดล่างสุดจริงด้วย Flex */}
                    <colgroup> {/* MARKER_VATWATCHLISTOPS_QUICK_ACTION_V1 -- สัดส่วนเดียวกับตาราง Body กันคอลัมน์เพี้ยน */}
                      <col style={{ width: '15%' }} />
                      <col style={{ width: '20%' }} />
                      <col style={{ width: '25%' }} />
                      <col style={{ width: '20%' }} />
                      <col style={{ width: '20%' }} />
                    </colgroup>
                    <tbody>
                      <tr style={{ borderTop: '1px solid #ccc', background: '#fafafa', fontWeight: '500' }}>
                        <td colSpan={3} style={{ padding: '6px 10px', textAlign: 'right', color: '#555' }}>รวม</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right' }}>{quickActionRows.reduce((s, r) => s + (Number(r.exp_amount) || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right' }}>{quickActionRows.reduce((s, r) => s + (Number(r.exp_vat) || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {quickActionRows.length > 5 && (<div style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>แสดง 5 แถวแรก เลื่อนดูที่เหลือได้</div>)}
              </div>
              <div style={{ padding: '14px 20px 16px' }}>
                <div style={{ fontSize: '11px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '8px' }}>Tax Invoice</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '4px' }}>Receive Date</label>
                    <input type="date" value={quickActionReceiveDate} onChange={(e) => setQuickActionReceiveDate(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '6px' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '4px' }}>GRT Number</label>
                    <div style={{ display: 'flex', alignItems: 'stretch', height: '30px', border: '0.5px solid #ccc', borderRadius: '6px', overflow: 'hidden' }}> {/* MARKER_VATWATCHLISTOPS_QUICK_ACTION_GRT_AUTOGEN_V1 -- Prefix | Digit | Running */}
                      <span style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', fontSize: '12px', fontWeight: '600', letterSpacing: '0.05em', color: '#1a3a5c', background: '#f0f3f8', borderRight: '0.5px solid #ccc' }}>{quickActionGrtPrefix || '—'}</span>
                      <span style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', fontSize: '10px', fontWeight: '600', color: '#8a6d00', background: '#fdf3d0', borderRight: '0.5px solid #ccc' }}>{quickActionGrtDigitCount}DG</span>
                      {quickActionGrtControl === 'Auto' ? (
                        <span style={{ flex: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', fontSize: '12px', letterSpacing: '0.15em', color: '#888', background: '#f5f5f5' }}>{quickActionGrtRunning}</span>
                      ) : (
                        <input value={quickActionGrtRunning} onChange={(e) => setQuickActionGrtRunning(e.target.value.replace(/[^0-9]/g, ''))} maxLength={quickActionGrtDigitCount} placeholder={'0'.repeat(quickActionGrtDigitCount)} style={{ flex: 1.5, border: 'none', outline: 'none', textAlign: 'center', fontFamily: 'monospace', fontSize: '12px', letterSpacing: '0.15em', background: 'white' }} />
                      )}
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '4px' }}>Tax Invoice Date</label>
                    <input type="date" value={quickActionTaxInvoiceDate} onChange={(e) => setQuickActionTaxInvoiceDate(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: '12px', border: '0.5px solid #ccc', background: quickActionTaxInvoiceDate ? 'white' : '#FFF9E6', borderRadius: '6px' }} /> {/* MARKER_VATWATCHLISTOPS_QUICK_ACTION_V1 -- Default เหลืองตั้งแต่เปิด Modal (ว่าง=เหลือง, มีข้อมูล=ขาว) — Border สีเทาปกติเหมือน Field อื่นเสมอ */}
                  </div>
                  <div> {/* MARKER_VATWATCHLISTOPS_QUICK_ACTION_TAX_INVOICE_NUMBER_EDITABLE_V1 -- กลับเป็น Field พิมพ์เองได้ ไม่ Sync จาก GRT แล้ว */}
                    <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '4px' }}>Tax Invoice Number</label>
                    <input value={quickActionTaxInvoiceNumber} onChange={(e) => setQuickActionTaxInvoiceNumber(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: '12px', border: '0.5px solid #ccc', background: '#FFF9E6', borderRadius: '6px' }} />
                  </div>
                </div>
              </div>
            </div>
            <div style={{ padding: '14px 20px', borderTop: '0.5px solid #e8e8e8', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '8px', flexShrink: 0 }}> {/* MARKER_VATWATCHLISTOPS_QUICK_ACTION_FOOTER_REORDER_V1 -- ชิดซ้าย, เรียง Normal ก่อน Cancel */}
              <button type="button" onClick={handleAddQuickActionData} disabled={quickActionSaving} style={{ padding: '7px 14px', fontSize: '13px', border: 'none', borderRadius: '8px', background: '#1a3a5c', color: 'white', cursor: quickActionSaving ? 'default' : 'pointer', opacity: quickActionSaving ? 0.6 : 1 }}>{quickActionSaving ? 'กำลังบันทึก...' : 'Popvat - Normal'}</button>
              <div style={{ width: '0.5px', height: '24px', background: '#e8e8e8' }} /> {/* MARKER_VATWATCHLISTOPS_QUICK_ACTION_CANCEL_REASON_V1 */}
              <select value={quickActionCancelReason} onChange={(e) => setQuickActionCancelReason(e.target.value)} disabled={quickActionSaving} style={{ padding: '6px 10px', fontSize: '12.5px', border: '0.5px solid #ccc', borderRadius: '8px', background: 'white' }}> {/* MARKER_VATWATCHLISTOPS_QUICK_ACTION_CANCEL_REASON_V1 -- เหตุผลที่ Cancel: Cancel เฉยๆ หรือจะไปทำ Simple ต่อ */}
                <option value="Cancel">เหตุผล: Cancel</option>
                <option value="Simple_NNN">เหตุผล: Simple_NNN</option>
                <option value="Simple_YNY">เหตุผล: Simple_YNY</option>
              </select>
              <button type="button" onClick={handleCancelQuickActionData} disabled={quickActionSaving} style={{ padding: '7px 14px', fontSize: '13px', border: 'none', borderRadius: '8px', background: '#EF9F27', color: 'white', cursor: quickActionSaving ? 'default' : 'pointer', opacity: quickActionSaving ? 0.6 : 1 }}>Popvat - Cancel</button> {/* MARKER_VATWATCHLISTOPS_QUICK_ACTION_CANCEL_FALLBACK_V1 */}
            </div>
          </div>
        </div>
      )}

      {/* MARKER_VATWATCHLISTOPS_NOTES_FEATURE_V1 -- Note Modal */}
      {noteModalRow && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div onPaste={handleNoteTextareaPaste} style={{ background: 'white', borderRadius: '12px', border: '0.5px solid #e8e8e8', padding: '1.25rem', width: noteModalGroupTargets ? '760px' : '360px', maxWidth: '90vw' }}> {/* MARKER_VATWATCHLISTOPS_GROUP_NOTE_WIDEN_AND_PASTE_ANYWHERE_V1 -- ขยาย Modal + Paste รูปได้ทั้ง Modal ไม่ต้อง Focus ที่ Textarea */}
            {noteModalGroupTargets ? (
              <>
                <div style={{ fontWeight: '500', fontSize: '15px', marginBottom: '4px' }}>Group Note — เลือก {noteModalGroupTargets.length} รายการ</div>
                <div style={{ background: '#f7f7f7', borderRadius: '8px', marginBottom: '12px', maxHeight: '160px', overflowY: 'auto' }}> {/* MARKER_VATWATCHLISTOPS_GROUP_NOTE_TABLE_SUMMARY_V1 */}
                  <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: '11px', whiteSpace: 'nowrap' }}> {/* MARKER_VATWATCHLISTOPS_GROUP_NOTE_TABLE_STICKY_HEADER_FIX_V1 */}
                    <thead>
                      <tr>
                        <th style={{ position: 'sticky', top: 0, zIndex: 1, padding: '5px 8px', textAlign: 'left', fontWeight: '500', color: '#666', background: '#eee' }}>Branch Code</th>
                        <th style={{ position: 'sticky', top: 0, zIndex: 1, padding: '5px 8px', textAlign: 'left', fontWeight: '500', color: '#666', background: '#eee' }}>ใบแจ้งหนี้</th>
                        <th style={{ position: 'sticky', top: 0, zIndex: 1, padding: '5px 8px', textAlign: 'left', fontWeight: '500', color: '#666', background: '#eee' }}>ชื่อผู้ค้า</th>
                        <th style={{ position: 'sticky', top: 0, zIndex: 1, padding: '5px 8px', textAlign: 'left', fontWeight: '500', color: '#666', background: '#eee' }}>Payment Doc</th>
                        <th style={{ position: 'sticky', top: 0, zIndex: 1, padding: '5px 8px', textAlign: 'right', fontWeight: '500', color: '#666', background: '#eee' }}>มูลค่าสินค้า</th>
                        <th style={{ position: 'sticky', top: 0, zIndex: 1, padding: '5px 8px', textAlign: 'right', fontWeight: '500', color: '#666', background: '#eee' }}>เงินภาษี</th>
                      </tr>
                    </thead>
                    <tbody>
                      {noteModalGroupTargets.map((t, i) => (
                        <tr key={`${t.invoice_ref}|${t.supplier_code}|${i}`} style={{ borderTop: '0.5px solid #e0e0e0' }}>
                          <td style={{ padding: '5px 8px' }}>{t.branch || '—'}</td>
                          <td style={{ padding: '5px 8px' }}>{t.invoice_ref || '—'}</td>
                          <td style={{ padding: '5px 8px', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '260px' }}>{t.vendor_name || '—'}</td>
                          <td style={{ padding: '5px 8px' }}>{t.check_no || '—'}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right' }}>{t.exp_amount != null && t.exp_amount !== '' ? Number(t.exp_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right' }}>{t.exp_vat != null && t.exp_vat !== '' ? Number(t.exp_vat).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <>
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
              </>
            )}
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
                    onClick={async () => { // MARKER_VATWATCHLISTOPS_NOTES_CHECK_TOTAL_V1
                      const cn = (noteModalRow && noteModalRow.check_no) || '';
                      setNoteDraftCheckNo(cn);
                      setCheckTotalInfo(null);
                      if (!cn.trim()) return;
                      try {
                        const found = await apiFetch(`/vat_watchlist_report?eq_bu=${encodeURIComponent(bu.bu)}&eq_check_no=${encodeURIComponent(cn.trim())}`);
                        const matches = Array.isArray(found) ? found : [];
                        const amount = matches.reduce((s, m) => s + (Number(m.exp_amount) || 0), 0);
                        const vat = matches.reduce((s, m) => s + (Number(m.exp_vat) || 0), 0);
                        setCheckTotalInfo({ count: matches.length, amount, vat });
                      } catch (err) {
                        console.error('fetch check total error:', err);
                      }
                    }}
                    title="ดึงเลขที่เช็คของ Invoice นี้ + รวมยอดทั้งเช็ค"
                    style={{ flexShrink: 0, width: '34px', border: '0.5px solid #ccc', borderRadius: '8px', background: 'white', cursor: 'pointer', fontSize: '13px' }}
                  >📥</button>
                </div>
              </div>
            </div>
            {checkTotalInfo && ( // MARKER_VATWATCHLISTOPS_NOTES_CHECK_TOTAL_V1
              <div style={{ fontSize: '12px', color: '#3E6B1F', background: '#EAF3DE', borderRadius: '8px', padding: '8px 10px', marginBottom: '10px' }}>
                รวมเช็คนี้ทั้งหมด ({checkTotalInfo.count} ใบ): มูลค่าสินค้า {checkTotalInfo.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · เงินภาษี {checkTotalInfo.vat.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            )}
            {!noteModalGroupTargets && noteDraftCheckNo.trim() && ( // MARKER_VATWATCHLISTOPS_NOTES_TRACK_BY_CHECK_V1
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
            <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px' }}>Note (รายละเอียดว่า Return ด้วย Doc อะไร) — Paste รูปในช่องนี้ได้เลย</label>
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
            {/* MARKER_VATWATCHLISTOPS_NOTES_IMAGE_V1 */}
            <div style={{ marginTop: '10px' }}>
              <input type="file" accept="image/*,application/pdf" multiple ref={noteImageInputRef} onChange={handleNoteImageSelect} style={{ display: 'none' }} />
              <button type="button" onClick={() => noteImageInputRef.current && noteImageInputRef.current.click()} disabled={noteImageUploading} style={{ padding: '6px 12px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '8px', background: 'white', cursor: noteImageUploading ? 'not-allowed' : 'pointer' }}>{noteImageUploading ? 'กำลังอัปโหลด...' : '📎 แนบรูป'}</button>
              {noteDraftImageIds.length > 0 && ( // MARKER_VATWATCHLISTOPS_NOTES_IMAGE_THUMBNAIL_SIZE_V1 -- ขยาย Thumbnail จาก 64px เป็นใหญ่ขึ้น เต็มความกว้าง Modal เกือบ
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
                  {noteDraftImageIds.map((fileId) => (
                    <div key={fileId} style={{ position: 'relative', width: '100%', maxWidth: '300px', minHeight: '160px', border: '0.5px solid #ccc', borderRadius: '8px', overflow: 'hidden', background: '#f7f7f7' }}>
                      {noteImagePreviewUrls[fileId] ? (
                        <img src={noteImagePreviewUrls[fileId]} alt="แนบ" style={{ width: '100%', height: 'auto', display: 'block' }} />
                      ) : (
                        <div style={{ width: '100%', height: '160px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: '#aaa' }}>โหลด...</div>
                      )}
                      <button type="button" onClick={() => handleNoteImageRemove(fileId)} title="ลบรูปนี้" style={{ position: 'absolute', top: '6px', right: '6px', width: '26px', height: '26px', border: 'none', borderRadius: '50%', background: 'rgba(0,0,0,0.65)', color: 'white', fontSize: '15px', lineHeight: 1, cursor: 'pointer', padding: 0 }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginTop: '12px' }}> {/* MARKER_VATWATCHLISTOPS_NOTES_DELETE_BUTTON_V1 */}
              {(!noteModalGroupTargets && noteMap[getNoteKey(noteModalRow)]) ? (
                <button type="button" onClick={deleteNote} disabled={noteSaving} style={{ padding: '6px 14px', fontSize: '13px', border: '0.5px solid #E5484D', borderRadius: '8px', background: 'white', color: '#E5484D', cursor: 'pointer' }}>ลบ Note</button>
              ) : <div />}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" onClick={() => { setNoteModalRow(null); setNoteModalGroupTargets(null); }} disabled={noteSaving} style={{ padding: '6px 14px', fontSize: '13px', border: '0.5px solid #ccc', borderRadius: '8px', background: 'white', cursor: 'pointer' }}>ยกเลิก</button>
                <button type="button" onClick={saveNote} disabled={noteSaving} style={{ padding: '6px 14px', fontSize: '13px', border: 'none', borderRadius: '8px', background: '#1a3a5c', color: 'white', cursor: 'pointer' }}>{noteSaving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* MARKER_VATWATCHLISTOPS_ADD_SUPPLIER_MODAL_V1 -- Modal + Add Supplier (New SM-Code อย่างง่าย) */}
      {showAddSupplierModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}> {/* MARKER_VATWATCHLISTOPS_ADD_SUPPLIER_ZINDEX_FIX_V1 -- 1100 > 1000 ของ Full Page Popvat */}
          <div style={{ background: 'white', borderRadius: '12px', border: '0.5px solid #e8e8e8', padding: '1.25rem', width: '920px', maxWidth: '95vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}> {/* MARKER_VATWATCHLISTOPS_ADD_SUPPLIER_FULL_FORM_V1 -- ขยาย Modal รองรับ Layout เต็ม */}
            <div style={{ fontWeight: '500', fontSize: '15px', marginBottom: '12px', flexShrink: 0 }}>+ Add Supplier (New SM-Code)</div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
            {addSupplierShowErrors && (
              <div style={{ padding: '8px 12px', background: '#FCEBEB', color: '#791F1F', fontSize: '12px', borderRadius: '6px', marginBottom: '10px' }}>⚠️ กรุณากรอกข้อมูลให้ครบถ้วนตาม Required Field</div>
            )}
            {(
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 180px 170px 180px', border: '0.5px solid #e8eaf0', borderRadius: '6px', overflow: 'visible', marginBottom: '6px' }}>
                {[
                  { label: 'Simple Code', key: 'SM-Code', bg: '#FFF9C4' },
                  { label: 'OFIN CODE', key: 'Ofin Code', bg: '#FFF9C4', center: true, onChangeFn: handleAddSupplierOfinCodeChange, onBlurFn: handleAddSupplierOfinCodeBlur },
                  { label: 'Supplier Code', key: 'Supplier Code', onChangeFn: handleAddSupplierSupplierCodeChange, center: true },
                  { label: 'Type', key: '_type', combo: true, opts: [...new Set((vendorCategories || []).map((i) => i['TYPE']).filter(Boolean))], center: true },
                  { label: 'Sub Type', key: '_sub_type', combo: true, opts: [...new Set((vendorCategories || []).filter((i) => !addSupplierForm['_type'] || i['TYPE'] === addSupplierForm['_type']).map((i) => i['SUB TYPE']).filter(Boolean))], center: true },
                ].map((c, i, arr) => (
                  <div key={`h${i}`} style={{ padding: '3px 8px', fontSize: '11px', color: '#888', background: '#f8f9fa', fontWeight: '600', textAlign: 'center', borderRight: i < arr.length - 1 ? '0.5px solid #e8eaf0' : 'none', borderBottom: '0.5px solid #e8eaf0', whiteSpace: 'nowrap' }}>{c.label}</div>
                ))}
                {[
                  { key: 'SM-Code', bg: '#FFF9C4' },
                  { key: 'Ofin Code', bg: '#FFF9C4', center: true, onChangeFn: handleAddSupplierOfinCodeChange, onBlurFn: handleAddSupplierOfinCodeBlur },
                  { key: 'Supplier Code', onChangeFn: handleAddSupplierSupplierCodeChange, center: true },
                  { key: '_type', combo: true, opts: [...new Set((vendorCategories || []).map((i) => i['TYPE']).filter(Boolean))], center: true },
                  { key: '_sub_type', combo: true, opts: [...new Set((vendorCategories || []).filter((i) => !addSupplierForm['_type'] || i['TYPE'] === addSupplierForm['_type']).map((i) => i['SUB TYPE']).filter(Boolean))], center: true },
                ].map((c, i, arr) => (
                  <div key={`c${i}`} style={{ padding: '3px 6px', display: 'flex', alignItems: 'center', justifyContent: c.center ? 'center' : 'flex-start', borderRight: i < arr.length - 1 ? '0.5px solid #e8eaf0' : 'none', overflow: 'visible', background: c.bg || 'transparent' }}>
                    {c.combo
                      ? <SmComboBox value={addSupplierForm[c.key] || ''} onChange={(val) => setAddSupplierForm((f) => ({ ...f, [c.key]: val }))} options={c.opts || []} center={c.center} />
                      : <input value={addSupplierForm[c.key] || ''} onChange={(e) => c.onChangeFn ? c.onChangeFn(e.target.value) : setAddSupplierForm((f) => ({ ...f, [c.key]: e.target.value }))} onBlur={(e) => c.onBlurFn && c.onBlurFn(e.target.value)} style={{ height: '24px', padding: '0 8px', fontSize: '12px', border: 'none', outline: 'none', background: 'transparent', color: '#1a3a5c', width: '100%', boxSizing: 'border-box', textAlign: c.center ? 'center' : 'left' }} />
                    }
                  </div>
                ))}
              </div>
            )}
            {(addSupplierForm['SM-Code']?.trim() || addSupplierForm['Supplier Code']?.trim()) && (
              <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                {addSupplierForm['SM-Code']?.trim() && (
                  (smCodes || []).find((i) => String(i['SM-Code'] || '').trim().toLowerCase() === addSupplierForm['SM-Code'].trim().toLowerCase())
                    ? <span style={{ fontSize: '11px', background: '#EAF3DE', color: '#27500A', padding: '2px 10px', borderRadius: '20px', fontWeight: '500' }}>✅ Simple Code found!!!</span>
                    : <span style={{ fontSize: '11px', background: '#FCEBEB', color: '#791F1F', padding: '2px 10px', borderRadius: '20px', fontWeight: '500' }}>❌ Simple Code Notfound!!!</span>
                )}
                {addSupplierForm['Supplier Code']?.trim() && (() => {
                  const found = (vendorCategories || []).find((i) => String(i['Code'] || '').trim() === addSupplierForm['Supplier Code'].trim());
                  return found
                    ? <span style={{ fontSize: '11px', background: '#EAF3DE', color: '#27500A', padding: '2px 10px', borderRadius: '20px', fontWeight: '500' }}>✅ Suppliercode found!!! — {found['TYPE']} / {found['SUB TYPE']}</span>
                    : <span style={{ fontSize: '11px', background: '#FCEBEB', color: '#791F1F', padding: '2px 10px', borderRadius: '20px', fontWeight: '500' }}>❌ Suppliercode Notfound!!!</span>;
                })()}
                {addSupplierForm['Tax ID']?.trim() && addSupplierForm['Branch']?.trim() && (() => { // MARKER_VATWATCHLISTOPS_ADDSUPPLIER_AUTOFILL_LOOKUP_V1 -- Lookup SM-Code ด้วย Tax ID + Branch
                  const existingSm = (smCodes || []).find((i) => String(i['Tax ID'] || '').trim() === addSupplierForm['Tax ID'].trim() && String(i['Branch'] || '').trim() === addSupplierForm['Branch'].trim());
                  return existingSm
                    ? <span style={{ fontSize: '11px', background: '#EAF3DE', color: '#27500A', padding: '2px 10px', borderRadius: '20px', fontWeight: '500' }}>✅ พบข้อมูลใน SM-Code List แล้ว — {existingSm['SM-Code']}</span>
                    : <span style={{ fontSize: '11px', background: '#FCEBEB', color: '#791F1F', padding: '2px 10px', borderRadius: '20px', fontWeight: '500' }}>❌ ยังไม่มีข้อมูลใน SM-Code List</span>;
                })()}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px 180px 110px', border: '0.5px solid #e8eaf0', borderRadius: '6px', overflow: 'visible', marginBottom: '6px' }}>
              {[{ label: 'Vendor Name' }, { label: 'Tax ID' }, { label: 'Branch No.' }, { label: 'AT-Match' }].map((c, i, arr) => (
                <div key={`h${i}`} style={{ padding: '3px 8px', fontSize: '11px', color: '#888', background: '#f8f9fa', fontWeight: '600', textAlign: 'center', borderRight: i < arr.length - 1 ? '0.5px solid #e8eaf0' : 'none', borderBottom: '0.5px solid #e8eaf0', whiteSpace: 'nowrap' }}>{c.label}</div>
              ))}
              {[
                { key: 'Company Name', bg: '#FFF9C4' },
                { key: 'Tax ID', bg: '#FFF9C4' },
                { key: 'Branch', bg: '#FFF9C4' },
                { key: 'Short Name', combo: true, bg: '#FFF9C4', opts: [...new Set((smCodes || []).map((i) => i['Short Name']).filter(Boolean))], onChangeFn: handleAddSupplierATMatchChange },
              ].map((c, i, arr) => (
                <div key={`c${i}`} style={{ padding: '3px 6px', display: 'flex', alignItems: 'center', borderRight: i < arr.length - 1 ? '0.5px solid #e8eaf0' : 'none', overflow: 'visible', background: c.bg || 'transparent' }}>
                  {c.combo
                    ? <SmComboBox value={addSupplierForm[c.key] || ''} onChange={(val) => c.onChangeFn(val)} options={c.opts || []} />
                    : <input value={addSupplierForm[c.key] || ''} onChange={(e) => setAddSupplierForm((f) => ({ ...f, [c.key]: e.target.value }))} style={{ height: '24px', padding: '0 8px', fontSize: '12px', border: 'none', outline: 'none', background: 'transparent', color: '#1a3a5c', width: '100%', boxSizing: 'border-box' }} />
                  }
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', border: '0.5px solid #e8eaf0', borderRadius: '6px', overflow: 'visible', marginBottom: '6px' }}>
              <div style={{ borderRight: '0.5px solid #e8eaf0' }}>
                <div style={{ padding: '6px 10px', fontSize: '11px', color: 'white', background: '#1a3a5c', fontWeight: '600', textAlign: 'center', borderBottom: '0.5px solid #e8eaf0' }}>Debit Account</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
                  {[['CPC_Dr', 'CPC Dr'], ['Account_Dr', 'Account Dr'], ['Sub Acc_Dr', 'Sub Acc Dr']].map(([key, lbl], fi) => (
                    <div key={key}>
                      <div style={{ padding: '4px 8px', fontSize: '10px', color: '#888', background: '#f8f9fa', borderBottom: '0.5px solid #e8eaf0', borderRight: fi < 2 ? '0.5px solid #e8eaf0' : 'none', textAlign: 'center', fontWeight: '500' }}>{lbl}</div>
                      <div style={{ padding: '3px 6px', borderRight: fi < 2 ? '0.5px solid #e8eaf0' : 'none' }}>
                        <input value={addSupplierForm[key] || ''} onChange={(e) => setAddSupplierForm((f) => ({ ...f, [key]: e.target.value }))} style={{ height: '28px', padding: '0 8px', fontSize: '12px', border: 'none', outline: 'none', background: 'transparent', color: '#1a3a5c', width: '100%', boxSizing: 'border-box', textAlign: 'center' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ padding: '6px 10px', fontSize: '11px', color: 'white', background: '#1a3a5c', fontWeight: '600', textAlign: 'center', borderBottom: '0.5px solid #e8eaf0' }}>Credit Account</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
                  {[['CPC_Cr', 'CPC Cr'], ['Account_Cr', 'Account Cr'], ['Sub Acc_Cr', 'Sub Acc Cr']].map(([key, lbl], fi) => ( // MARKER_VATWATCHLISTOPS_RENAME_ACCOUNT_DR2_TO_ACCOUNT_CR_V1
                    <div key={key}>
                      <div style={{ padding: '4px 8px', fontSize: '10px', color: '#888', background: '#f8f9fa', borderBottom: '0.5px solid #e8eaf0', borderRight: fi < 2 ? '0.5px solid #e8eaf0' : 'none', textAlign: 'center', fontWeight: '500' }}>{lbl}</div>
                      <div style={{ padding: '3px 6px', borderRight: fi < 2 ? '0.5px solid #e8eaf0' : 'none' }}>
                        <input value={addSupplierForm[key] || ''} onChange={(e) => setAddSupplierForm((f) => ({ ...f, [key]: e.target.value }))} style={{ height: '28px', padding: '0 8px', fontSize: '12px', border: 'none', outline: 'none', background: 'transparent', color: '#1a3a5c', width: '100%', boxSizing: 'border-box', textAlign: 'center' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {[
              ['Expense Type', 'Expense Type', 'Special Rule1', 'Special Rule1'],
              ['First Part', 'First Part', 'Special Rule2', 'Special Rule2'],
              ['Mid Part', 'Mid Part', 'Simple Rule3', 'Simple Rule3'],
              ['Last Part', 'Last Part', 'Special Rule4', 'Special Rule4'],
              ['Digit', 'Digit', 'Special Rule5', 'Special Rule5'],
            ].map(([lbl1, key1, lbl2, key2]) => (
              <div key={key1} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 110px 1fr', border: '0.5px solid #e8eaf0', borderRadius: '6px', overflow: 'visible', marginBottom: '6px' }}>
                <div style={{ padding: '5px 10px', fontSize: '11px', color: '#888', background: '#f8f9fa', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', borderRight: '0.5px solid #e8eaf0', fontWeight: '500' }}>{lbl1}</div>
                <div style={{ padding: '3px 6px', display: 'flex', alignItems: 'center', borderRight: '0.5px solid #e8eaf0', overflow: 'visible' }}>
                  {['Expense Type', 'Digit', 'Simple Rule3'].includes(key1)
                    ? <SmComboBox value={addSupplierForm[key1] || ''} onChange={(val) => setAddSupplierForm((f) => ({ ...f, [key1]: val }))} options={getAddSupplierOptions(key1)} />
                    : <input value={addSupplierForm[key1] || ''} onChange={(e) => setAddSupplierForm((f) => ({ ...f, [key1]: e.target.value }))} style={{ height: '28px', padding: '0 8px', fontSize: '12px', border: 'none', outline: 'none', background: 'transparent', color: '#1a3a5c', width: '100%', boxSizing: 'border-box' }} />
                  }
                </div>
                <div style={{ padding: '5px 10px', fontSize: '11px', color: '#888', background: '#f8f9fa', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', borderRight: '0.5px solid #e8eaf0', fontWeight: '500' }}>{lbl2}</div>
                <div style={{ padding: '3px 6px', display: 'flex', alignItems: 'center', overflow: 'visible' }}>
                  {['Special Rule1', 'Special Rule2', 'Simple Rule3', 'Special Rule4', 'Special Rule5'].includes(key2)
                    ? <SmComboBox value={addSupplierForm[key2] || ''} onChange={(val) => setAddSupplierForm((f) => ({ ...f, [key2]: val }))} options={getAddSupplierOptions(key2)} />
                    : <input value={addSupplierForm[key2] || ''} onChange={(e) => setAddSupplierForm((f) => ({ ...f, [key2]: e.target.value }))} style={{ height: '28px', padding: '0 8px', fontSize: '12px', border: 'none', outline: 'none', background: 'transparent', color: '#1a3a5c', width: '100%', boxSizing: 'border-box' }} />
                  }
                </div>
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 110px 1fr', border: '0.5px solid #e8eaf0', borderRadius: '6px', overflow: 'visible', marginBottom: '6px' }}>
              <div style={{ padding: '5px 10px', fontSize: '11px', color: '#888', background: '#f8f9fa', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', borderRight: '0.5px solid #e8eaf0', fontWeight: '500' }}>Remark</div>
              <div style={{ padding: '3px 6px', display: 'flex', alignItems: 'center', borderRight: '0.5px solid #e8eaf0', overflow: 'visible' }}>
                <input value={addSupplierForm['Remark'] || ''} onChange={(e) => setAddSupplierForm((f) => ({ ...f, 'Remark': e.target.value }))} style={{ height: '28px', padding: '0 8px', fontSize: '12px', border: 'none', outline: 'none', background: 'transparent', color: '#1a3a5c', width: '100%', boxSizing: 'border-box' }} />
              </div>
              <div style={{ padding: '5px 10px', fontSize: '11px', color: '#888', background: '#f8f9fa', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', borderRight: '0.5px solid #e8eaf0', fontWeight: '500' }}>BlankCell</div>
              <div style={{ padding: '3px 6px' }} />
            </div>
            {(() => {
              const smRowBlue = (cols) => (
                <div style={{ display: 'grid', gridTemplateColumns: cols.map((c) => c.w || '1fr').join(' '), border: '0.5px solid #e8eaf0', borderRadius: '4px', overflow: 'hidden', marginBottom: '6px' }}>
                  {cols.map((c, i) => (
                    <div key={`h${i}`} style={{ padding: '3px 8px', fontSize: '11px', color: '#888', background: '#f8f9fa', fontWeight: '600', textAlign: 'center', borderRight: i < cols.length - 1 ? '0.5px solid #e8eaf0' : 'none', borderBottom: '0.5px solid #e8eaf0', whiteSpace: 'nowrap' }}>{c.label}</div>
                  ))}
                  {cols.map((c, i) => {
                    const isLast = i === cols.length - 1;
                    if (c.check) {
                      const ofinCode = (addSupplierForm['Ofin Code'] || '').trim();
                      const foundBranch = ofinCode ? (branches || []).find((b) => String(b['Branch Code'] || '').trim() === ofinCode) : null;
                      return <div key={`c${i}`} style={{ borderRight: isLast ? 'none' : '0.5px solid #e8eaf0', background: ofinCode ? (foundBranch ? '#27AE60' : '#E74C3C') : '#E6F1FB', minHeight: '28px' }} />;
                    }
                    return (
                      <div key={`c${i}`} style={{ padding: '2px 6px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: isLast ? 'none' : '0.5px solid #e8eaf0', background: '#E6F1FB' }}>
                        <input value={addSupplierForm[c.key] || ''} readOnly style={{ height: '24px', padding: '0 8px', fontSize: '12px', border: 'none', outline: 'none', background: 'transparent', color: '#0C447C', fontWeight: '500', width: '100%', boxSizing: 'border-box', textAlign: 'center' }} />
                      </div>
                    );
                  })}
                </div>
              );
              return (
                <>
                  {smRowBlue([
                    { label: 'BU Company Simple', key: '_buCompanySimple', w: '1fr' },
                    { label: 'Tax ID BU', key: '_taxIdBu', w: '180px' },
                    { label: 'BU Branch', key: 'Short Branch', w: '180px' },
                    { label: 'Com%', key: '_comPct', w: '90px' },
                    { label: 'Spec%', key: '_specPct', w: '80px' },
                  ])}
                  {smRowBlue([
                    { label: 'BU', key: 'BU', w: '100px' },
                    { label: 'Group-P', key: '_groupP', w: '100px' },
                    { label: 'OFIN SIMPLE NAME', key: '_ofinSimpleName', w: '1fr' },
                    { label: 'Branch Code', key: '_branchCode', w: '200px' },
                    { label: 'Status', key: '_branchStatus', w: '180px' },
                    { label: 'Check Data', check: true, w: '150px' },
                  ])}
                </>
              );
            })()}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px', flexShrink: 0 }}>
              <button type="button" onClick={() => { setShowAddSupplierModal(false); setAddSupplierForm(ADD_SUPPLIER_EMPTY_FORM); setAddSupplierShowErrors(false); }} disabled={addSupplierSaving} style={{ padding: '6px 14px', fontSize: '13px', border: '0.5px solid #ccc', borderRadius: '8px', background: 'white', cursor: 'pointer' }}>Cancel</button>
              <button type="button" onClick={saveAddSupplier} disabled={addSupplierSaving} style={{ padding: '6px 14px', fontSize: '13px', border: 'none', borderRadius: '8px', background: '#1a3a5c', color: 'white', cursor: 'pointer' }}>{addSupplierSaving ? 'กำลังบันทึก...' : 'Save'}</button>
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

  const fetchSmCodes = React.useCallback(() => { // MARKER_VATWATCHLISTOPS_ADD_SUPPLIER_CATEGORY_BROADCAST_V1
    apiFetch('/sm_code_list').then((sm) => setSmCodes(Array.isArray(sm) ? sm : [])).catch((err) => console.error('refetch smCodes error:', err));
  }, []);
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
  // ── รับ Broadcast Real-time เวลามีคนเพิ่ม SM-Code ใหม่จาก "Add Supplier" ──
  React.useEffect(() => {
    const unsubscribe = subscribeWs(['sm_code_list_updated'], () => {
      fetchSmCodes();
    });
    return unsubscribe;
  }, [fetchSmCodes]);

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

// MARKER_VATWATCHLISTOPS_UPLOAD_FILE_LOBBY_V1
// ── หน้า "Upload file" -- 4 Tab ตาม VAT_UPLOAD_FILE_TABS ────────────────
// ── Tab "Popvat Report" มี 3 Zone เปล่าเส้นประรอ Confirm Content (Pattern ──
// ── เดียวกับตอนเริ่ม VAT Watchlist Ops.) -- Tab อื่นยังไม่ได้ออกแบบ ───────
// MARKER_VATWATCHLISTOPS_UPLOAD_FILE_MONITOR_ZONE_V5
// ── Zone ซ้ายบน — แทนที่ Placeholder เดิม ── Monitor การ์ด + CSS % Bar ─────
// ── Popvat/Simple/ADI พร้อม Drill-down ดูราย BU (คลิกการ์ด/แท่ง) ──────────
// ── Sync กับ uploadFileSelectedBu (BU Grid ขวา) และ uploadFileBaseFilter ──
// ── ลำดับ Scope: เลือก BU > เลือก Base > ภาพรวมทั้งระบบ (Active BU ทั้งหมด) ──
// ── ใช้ CSS % Bar ธรรมดา (ไม่ใช้ SVG) กัน Auto-scale บวมผิดปกติใน Flexbox ──
const VAT_UPLOAD_FILE_MONITOR_CATS = [
  { key: 'popvat', label: 'Popvat', color: '#3b82f6', icon: '📄' },
  { key: 'simple', label: 'Simple', color: '#10b981', icon: '🗂️' },
  { key: 'adi', label: 'ADI', color: '#f97316', icon: '🔁' },
];

// MARKER_VATWATCHLISTOPS_UPLOAD_FILE_MONITOR_NICEMAX_V1 -- ปัดค่าสูงสุดขึ้นเป็นเลขกลม
// กันปัญหา Bar เต็มหลอด (100%) เวลาข้อมูลจริงมีค่าน้อย เช่น 7 จะได้ไม่ดูเหมือนเต็มเป๊ะ
function vatUploadFileMonitorNiceMax(v) {
  v = Math.max(1, v);
  let step;
  if (v <= 50) step = 10;
  else if (v <= 100) step = 20;
  else if (v <= 250) step = 50;
  else if (v <= 500) step = 50;
  else if (v <= 1000) step = 100;
  else if (v <= 2500) step = 250;
  else step = 500;
  return Math.ceil(v / step) * step;
}

function VatUploadFileMonitorZone({ activeBus, companyRows, buCategoryCounts, selectedBu, baseFilter }) {
  const [drillCategory, setDrillCategory] = React.useState(null);
  React.useEffect(() => { setDrillCategory(null); }, [selectedBu, baseFilter]); // MARKER_VATWATCHLISTOPS_UPLOAD_FILE_MONITOR_DRILL_RESET_V1 -- รีเซ็ต Drill-down เมื่อเปลี่ยน BU/Base

  const scopeBus = React.useMemo(() => {
    if (selectedBu) return [selectedBu];
    if (baseFilter) {
      return activeBus.filter((bu) => {
        const company = companyRows.find((c) => c.bu === bu);
        return company && company.base === baseFilter;
      });
    }
    return activeBus;
  }, [activeBus, companyRows, selectedBu, baseFilter]);

  const cardTotals = React.useMemo(() => {
    const t = { popvat: 0, simple: 0, adi: 0 };
    scopeBus.forEach((bu) => {
      const c = buCategoryCounts[bu];
      if (!c) return;
      t.popvat += c.popvat || 0;
      t.simple += c.simple || 0;
      t.adi += c.adi || 0;
    });
    return t;
  }, [scopeBus, buCategoryCounts]);

  const view = React.useMemo(() => {
    if (selectedBu) {
      const c = buCategoryCounts[selectedBu] || { popvat: 0, simple: 0, adi: 0 };
      return {
        caption: 'BU: ' + selectedBu,
        rows: VAT_UPLOAD_FILE_MONITOR_CATS.map((cat) => ({ key: cat.key, label: cat.label, value: c[cat.key] || 0, color: cat.color, icon: cat.icon })),
        clickable: false,
        showBack: false,
      };
    }
    if (drillCategory) {
      const cat = VAT_UPLOAD_FILE_MONITOR_CATS.find((c) => c.key === drillCategory);
      const rows = scopeBus
        .map((bu) => ({ key: bu, label: bu, value: (buCategoryCounts[bu] && buCategoryCounts[bu][drillCategory]) || 0, color: cat.color }))
        .filter((r) => r.value > 0)
        .sort((a, b) => b.value - a.value);
      return {
        caption: cat.label + ' แยกราย BU' + (baseFilter ? ' (' + baseFilter + ')' : ''),
        rows,
        clickable: false,
        showBack: true,
      };
    }
    const scopeLabel = baseFilter ? ('Base: ' + baseFilter + ' (' + scopeBus.length + ' BU)') : 'ภาพรวมทั้งระบบ';
    return {
      caption: scopeLabel + ' · คลิกเพื่อดูตาม BU',
      rows: VAT_UPLOAD_FILE_MONITOR_CATS.map((cat) => ({ key: cat.key, label: cat.label, value: cardTotals[cat.key] || 0, color: cat.color, icon: cat.icon })),
      clickable: true,
      showBack: false,
    };
  }, [selectedBu, drillCategory, scopeBus, buCategoryCounts, baseFilter, cardTotals]);

  const maxVal = vatUploadFileMonitorNiceMax(Math.max(1, ...view.rows.map((r) => r.value))); // MARKER_VATWATCHLISTOPS_UPLOAD_FILE_MONITOR_NICEMAX_V1

  return (
    <div style={{ ...vatWatchlistZoneStyle, flex: '50 1 0%', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start', padding: '16px', gap: '10px', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#888', flexShrink: 0, minWidth: 0 }}>
        {view.showBack && (
          <button
            type="button"
            onClick={() => setDrillCategory(null)}
            style={{ flexShrink: 0, color: '#1a3a5c', textDecoration: 'underline', background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer' }}
          >← กลับภาพรวม</button>
        )}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{view.caption}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '2px' }}>
        {view.rows.length === 0 ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: '#bbb' }}>ไม่มีข้อมูล</div>
        ) : (
          view.rows.map((r) => {
            const pct = Math.max(2, Math.round((r.value / maxVal) * 100));
            return (
              <div
                key={r.key}
                onClick={view.clickable ? () => setDrillCategory(r.key) : undefined}
                style={{
                  flexShrink: 0,
                  cursor: view.clickable ? 'pointer' : 'default',
                  background: r.color + '0F',
                  borderLeft: '3px solid ' + r.color,
                  borderRadius: '10px',
                  padding: '12px 14px',
                  boxSizing: 'border-box',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                    {r.icon && (
                      <div style={{ width: '30px', height: '30px', borderRadius: '8px', background: r.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', flexShrink: 0 }}>{r.icon}</div>
                    )}
                    <span style={{ fontSize: '13px', color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
                  </div>
                  <span style={{ fontSize: '24px', fontWeight: '700', color: '#1a1a1a', flexShrink: 0, marginLeft: '8px' }}>{r.value.toLocaleString()}</span>
                </div>
                <div style={{ height: '8px', background: 'rgba(0,0,0,0.06)', borderRadius: '4px', overflow: 'hidden', marginTop: '10px' }}>
                  <div style={{ height: '100%', width: pct + '%', background: r.color, borderRadius: '4px' }} />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function VatUploadFileLobby() { // MARKER_VATWATCHLISTOPS_UPLOAD_FILE_BU_PICKER_V1
  const [showUploadFileDetail, setShowUploadFileDetail] = React.useState(false); // MARKER_VATWATCHLISTOPS_UPLOAD_FILE_DETAIL_PAGE_V1
  const [activeBus, setActiveBus] = React.useState([]);
  const [companyRows, setCompanyRows] = React.useState([]); // MARKER_VATWATCHLISTOPS_UPLOAD_FILE_SEARCH_BASE_OPZONE_V1 -- เก็บ Row เต็ม (ใช้ base/company name Filter)
  const [uploadFileSelectedBu, setUploadFileSelectedBu] = React.useState(null);
  const [showGenerateFileModal, setShowGenerateFileModal] = React.useState(false); // MARKER_VATWATCHLISTOPS_GENERATE_FILE_MODAL_V1
  const [historyRefreshKey, setHistoryRefreshKey] = React.useState(0); // MARKER_VATWATCHLISTOPS_EXPORT_HISTORY_TABLE_V1
  const fetchActiveBus = React.useCallback(() => { // MARKER_VATWATCHLISTOPS_WS_SYNC_GAPS_V1 -- แยกเป็น Function เรียกซ้ำได้ (Mount + WS Event)
    apiFetch('/company_list')
      .then((rows) => {
        const active = (Array.isArray(rows) ? rows : []).filter((c) => getVatWatchlistEffectiveStatus(c) === 'active'); // MARKER_VATWATCHLISTOPS_UPLOAD_FILE_BU_PICKER_FIX_V1
        setCompanyRows(active);
        setActiveBus(active.map((c) => c.bu).filter(Boolean));
      })
      .catch((err) => console.error('fetch active BU list error:', err));
  }, []);
  React.useEffect(() => { fetchActiveBus(); }, [fetchActiveBus]);
  React.useEffect(() => { // MARKER_VATWATCHLISTOPS_WS_SYNC_GAPS_V1 -- Sync ข้าม Session เมื่อมีคนแก้ company_list (Active/Inactive BU)
    const unsubscribe = subscribeWs(['company_list_updated'], () => fetchActiveBus());
    return unsubscribe;
  }, [fetchActiveBus]);
  const baseOptionsAll = React.useMemo(() => { // MARKER_VATWATCHLISTOPS_UPLOAD_FILE_SEARCH_BASE_OPZONE_V1
    const set = new Set(companyRows.map((c) => c.base).filter(Boolean));
    return Array.from(set).sort();
  }, [companyRows]);
  const [uploadFileBaseFilter, setUploadFileBaseFilter] = React.useState('');
  const [buDraftCounts, setBuDraftCounts] = React.useState({}); // MARKER_VATWATCHLISTOPS_UPLOAD_FILE_BU_COUNTS_V1 -- { [bu]: count } รวม 3 ตาราง
  const [currentPeriodDisplay, setCurrentPeriodDisplay] = React.useState(''); // MARKER_VATWATCHLISTOPS_LOBBY_CURRENT_PERIOD_DISPLAY_V1 -- โชว์ Period ปัจจุบันมุมขวาบน
  const [buCategoryCounts, setBuCategoryCounts] = React.useState({}); // MARKER_VATWATCHLISTOPS_UPLOAD_FILE_MONITOR_CATEGORY_COUNTS_V1 -- { [bu]: { popvat, simple, adi } } แยกรายประเภทสำหรับกราฟ Monitor Zone
  const [uploadFileBuFilter, setUploadFileBuFilter] = React.useState(''); // MARKER_VATWATCHLISTOPS_UPLOAD_FILE_BU_FILTER_10X6_V1
  const fetchDraftCounts = React.useCallback(() => { // MARKER_VATEXPORT_DRAFT_COUNTS_ENDPOINT_V1 -- เปลี่ยนจากดึงทั้งตารางมานับเอง เป็นเรียก Endpoint สรุปยอดสำเร็จรูป (เร็วกว่ามาก)
    apiFetch('/vat-export/draft-counts')
      .then((data) => {
        if (!data?.ok) return;
        setBuDraftCounts(data.counts || {});
        setBuCategoryCounts(data.categoryCounts || {});
      })
      .catch((err) => console.error('fetch draft counts error:', err));
  }, []);
  React.useEffect(() => { fetchDraftCounts(); }, [fetchDraftCounts, historyRefreshKey]); // MARKER_VATWATCHLISTOPS_MONITOR_COUNT_EXCLUDE_EXPORTED_V1 -- Refresh Count ใหม่ทุกครั้งที่ Generate สำเร็จ (ของตัวเอง)
  React.useEffect(() => { // MARKER_VATWATCHLISTOPS_WS_SYNC_GAPS_V1 -- Sync ข้าม Session เมื่อมีคนอื่น Generate/Restore
    const unsubscribe = subscribeWs(['vat_export_updated'], () => fetchDraftCounts());
    return unsubscribe;
  }, [fetchDraftCounts]);

  React.useEffect(() => { // MARKER_VATWATCHLISTOPS_LOBBY_CURRENT_PERIOD_DISPLAY_V1 -- ดึง Period ปัจจุบันมาโชว์มุมขวาบน
    apiFetch('/vat/period/status').then((ps) => {
      const raw = ps?.vat_period_current_month; // Format 'YYYY-MM' จาก Backend
      if (!raw) return;
      const [yyyy, mm] = String(raw).split('-');
      const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      const idx = parseInt(mm, 10) - 1;
      if (idx >= 0 && idx <= 11) setCurrentPeriodDisplay(`${monthNames[idx]}-${String(yyyy).slice(-2)}`);
    }).catch(() => {});
  }, []);
  if (showUploadFileDetail && uploadFileSelectedBu) { // MARKER_VATWATCHLISTOPS_UPLOAD_FILE_DETAIL_PAGE_V1 -- Navigate เข้าหน้า Detail
    return <VatUploadFileDetail bu={uploadFileSelectedBu} categoryCounts={buCategoryCounts[uploadFileSelectedBu]} onBack={() => setShowUploadFileDetail(false)} />;
  }
  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px', height: '100%', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '10px', borderBottom: '0.5px solid #e8e8e8' }}> {/* MARKER_VATWATCHLISTOPS_LOBBY_CURRENT_PERIOD_DISPLAY_V1 -- เพิ่ม Period Badge มุมขวา */}
          <div style={{ fontSize: '15px', fontWeight: '500' }}>VAT Resource from Operation</div> {/* MARKER_VATWATCHLISTOPS_UPLOAD_FILE_LOBBY_TITLE_V1 -- แทนที่ Tab Bar เดิม เป็นแค่หัวข้อนิ่งๆ */}
          {currentPeriodDisplay && (
            <div style={{ fontSize: '12px', fontWeight: '500', color: '#1a3a5c', background: '#eaf0f6', padding: '5px 14px', borderRadius: '8px' }} title="Period ปัจจุบันของระบบ">Period: {currentPeriodDisplay}</div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}> {/* MARKER_VATWATCHLISTOPS_UPLOAD_FILE_LAYOUT_V3 -- คืน Zone ซ้าย/ขวาแยกกัน */}
          <div style={{ display: 'flex', gap: '12px', height: '330px' }}> {/* MARKER_VATWATCHLISTOPS_UPLOAD_FILE_LAYOUT_V5 -- คำนวณใหม่จาก maxHeight คงที่ของ Grid */}
            <VatUploadFileMonitorZone
              activeBus={activeBus}
              companyRows={companyRows}
              buCategoryCounts={buCategoryCounts}
              selectedBu={uploadFileSelectedBu}
              baseFilter={uploadFileBaseFilter}
            /> {/* MARKER_VATWATCHLISTOPS_UPLOAD_FILE_MONITOR_ZONE_V5 */}
            <div style={{ ...vatWatchlistZoneStyle, flex: '50 1 0%', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start', padding: '16px', gap: '10px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '8px', flexShrink: 0 }}> {/* MARKER_VATWATCHLISTOPS_UPLOAD_FILE_GAP_ALIGN_V1 -- Gap 8px เท่ากับ BU Grid */}
                <input
                  type="text"
                  value={uploadFileBuFilter}
                  onChange={(e) => setUploadFileBuFilter(e.target.value)}
                  placeholder="Search (BU / ชื่อบริษัท)"
                  style={{ gridColumn: 'span 3', width: '100%', boxSizing: 'border-box', padding: '7px 10px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '8px', outline: 'none' }} // MARKER_VATWATCHLISTOPS_UPLOAD_FILE_WIDTH_FIX_V1
                />
                <select
                  value={uploadFileBaseFilter}
                  onChange={(e) => setUploadFileBaseFilter(e.target.value)}
                  style={{ gridColumn: 'span 3', width: '100%', boxSizing: 'border-box', padding: '7px 10px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '8px' }} // MARKER_VATWATCHLISTOPS_UPLOAD_FILE_BASEFILTER_WIDTH_V2 -- เดิม span 1 เหลือว่าง 2 คอลัมน์ ปรับเป็น span 3 เต็มแถวพอดีกับ Search
                >
                  <option value="">Base: ทั้งหมด</option>
                  {baseOptionsAll.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <style>{`.vat-opzone-bu-scroll::-webkit-scrollbar { display: none; }`}</style> {/* MARKER_VATWATCHLISTOPS_UPLOAD_FILE_HIDE_SCROLLBAR_V1 -- ซ่อน Scrollbar ฝั่ง Webkit (Chrome/Edge/Safari) กัน Width เพี้ยนจาก Row อื่นที่ไม่มี Scrollbar */}
              <div className="vat-opzone-bu-scroll" style={{ height: '208px', flexShrink: 0, display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', alignItems: 'start', alignContent: 'flex-start', gap: '8px', overflowY: 'auto', width: '100%', scrollbarWidth: 'none', msOverflowStyle: 'none' }}> {/* MARKER_VATWATCHLISTOPS_UPLOAD_FILE_FIXED_HEIGHT_V1 -- height คงที่ ไม่หดตามผลลัพธ์ Filter -- MARKER_VATWATCHLISTOPS_UPLOAD_FILE_HIDE_SCROLLBAR_V1 -- ซ่อน Scrollbar Firefox/IE/Edge (ยังเลื่อนได้ปกติ) */}
                {activeBus.length === 0 ? (
                  <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#999', fontSize: '13px', padding: '20px 0' }}>กำลังโหลดรายชื่อ BU...</div>
                ) : (
                  activeBus
                    .filter((bu) => { // MARKER_VATWATCHLISTOPS_UPLOAD_FILE_SEARCH_BASE_OPZONE_V1 -- Filter รวม Search + Base
                      const company = companyRows.find((c) => c.bu === bu);
                      if (uploadFileBaseFilter && (!company || company.base !== uploadFileBaseFilter)) return false;
                      const q = uploadFileBuFilter.trim().toLowerCase();
                      if (!q) return true;
                      return bu.toLowerCase().includes(q) || (company && (company['ENGLISH COMPANY NAME'] || '').toLowerCase().includes(q));
                    })
                    .slice() // MARKER_VATWATCHLISTOPS_UPLOAD_FILE_BU_SORT_STRETCH_V1 -- เรียง BU ที่มีข้อมูลขึ้นก่อน (มากไปน้อย)
                    .sort((a, b) => (buDraftCounts[b] || 0) - (buDraftCounts[a] || 0))
                    .map((bu) => {
                    const count = buDraftCounts[bu] || 0;
                    const isSelected = uploadFileSelectedBu === bu;
                    return (
                      <button
                        key={bu}
                        type="button"
                        disabled={count === 0} // MARKER_VATWATCHLISTOPS_OPZONE_BU_DISABLE_ZERO_COUNT_V1 -- BU ที่ไม่มี Draft เลย กดเข้าไม่ได้
                        onClick={() => setUploadFileSelectedBu(bu)}
                        onDoubleClick={() => setUploadFileSelectedBu(null)} // MARKER_VATWATCHLISTOPS_UPLOAD_FILE_BU_DESELECT_DBLCLICK_V1 -- Double-click เพื่อยกเลิกเลือก กลับไปโหมด All/Base
                        style={{
                          width: '100%', boxSizing: 'border-box', padding: '6px 14px', fontSize: '12px', borderRadius: '8px', cursor: count === 0 ? 'not-allowed' : 'pointer',
                          border: isSelected ? '0.5px solid #1a3a5c' : '0.5px solid #ccc',
                          background: isSelected ? '#1a3a5c' : (count > 0 ? '#EAF3DE' : 'white'),
                          color: isSelected ? 'white' : (count === 0 ? '#bbb' : '#333'),
                          fontWeight: isSelected ? '500' : '400',
                          opacity: count === 0 ? 0.6 : 1,
                        }}
                      >{bu} ({count})</button>
                    );
                  })
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '8px', flexShrink: 0 }}> {/* MARKER_VATWATCHLISTOPS_UPLOAD_FILE_GAP_ALIGN_V1 -- Gap 8px เท่ากับ BU Grid */}
                <button
                  type="button"
                  onClick={() => {
                    if (!uploadFileSelectedBu) { confirmDialog.alert('กรุณาเลือก BU ก่อน', { title: 'ยังไม่ได้เลือก BU' }); return; }
                    setShowUploadFileDetail(true);
                  }}
                  style={{ gridColumn: 'span 3', width: '100%', boxSizing: 'border-box', padding: '8px 16px', fontSize: '13px', border: 'none', borderRadius: '8px', background: '#fb923c', color: 'white', cursor: 'pointer', fontWeight: '500' }} // MARKER_VATWATCHLISTOPS_OPZONE_BUTTON_ORANGE_FILL_V1 -- พื้นหลังเต็มเหมือนปุ่ม Generate file แต่ใช้ส้มอ่อนกว่าเดิม (#fb923c แทน #f97316)
                >Operation Zone</button>
                <button
                  type="button"
                  onClick={() => {
                    if (!uploadFileSelectedBu) { confirmDialog.alert('กรุณาเลือก BU ก่อน', { title: 'ยังไม่ได้เลือก BU' }); return; }
                    setShowGenerateFileModal(true);
                  }}
                  style={{ gridColumn: 'span 3', width: '100%', boxSizing: 'border-box', padding: '8px 16px', fontSize: '13px', border: '0.5px solid #1a3a5c', borderRadius: '8px', background: uploadFileSelectedBu ? '#1a3a5c' : '#e5e7eb', color: uploadFileSelectedBu ? 'white' : '#999', cursor: uploadFileSelectedBu ? 'pointer' : 'not-allowed', fontWeight: '500' }} // MARKER_VATWATCHLISTOPS_GENERATE_FILE_MODAL_V1 -- ปุ่ม Generate File ด้านนอก (ต้องเลือก BU ก่อน)
                >Generate file</button>
              </div>
            </div>
          </div>
          <VatExportHistoryTable refreshKey={historyRefreshKey} onDataChanged={() => setHistoryRefreshKey((k) => k + 1)} /> {/* MARKER_VATWATCHLISTOPS_UPLOAD_FILE_LAYOUT_V3 MARKER_VATWATCHLISTOPS_EXPORT_HISTORY_TABLE_V1 MARKER_VATWATCHLISTOPS_EXPORT_HISTORY_ALL_BU_V1 MARKER_VATWATCHLISTOPS_EXPORT_HISTORY_RESTORE_BROADCAST_V1 -- แทนที่ Placeholder เดิมด้วยตาราง Export History จริง (โชว์ทุก BU เสมอ) */}
          {showGenerateFileModal && (
            <VatGenerateFileModal bu={uploadFileSelectedBu} categoryCounts={buCategoryCounts[uploadFileSelectedBu]} onClose={(refreshed) => { setShowGenerateFileModal(false); if (refreshed) setHistoryRefreshKey((k) => k + 1); }} /> // MARKER_VATWATCHLISTOPS_GENERATE_FILE_MODAL_V1 MARKER_VATWATCHLISTOPS_EXPORT_HISTORY_TABLE_V1
          )}
        </div>
    </div>
  );
}

// MARKER_VATWATCHLISTOPS_UPLOAD_FILE_DETAIL_PAGE_V1
// MARKER_VATWATCHLISTOPS_POPVAT_REPORT_SKELETON_V1
// ── Tab "Popvat Report" -- Skeleton ตาราง Column ตามภาพ Excel ที่ส่งมา ─────
// ── ยังไม่เชื่อม API จริง รอ Endpoint/Schema ของ vat_upload_popvatdraft ────
const VAT_POPVAT_REPORT_COLUMNS = [
  { key: 'branch', label: 'Branch' },
  { key: 'grt_number', label: 'GRT Number' },
  { key: 'original_invoice_number', label: 'Original Invoice Number' },
  { key: 'receipt_date', label: 'Receipt Date' },
  { key: 'tax_invoice_number', label: 'Tax Invoice Number' },
  { key: 'tax_invoice_date', label: 'Tax Invoice Date' },
  { key: 'vendor_tax_invoice_number', label: 'Vendor Tax Invoice Number' },
  { key: 'supplier_tax_id', label: 'Supplier Tax ID' },
  { key: 'supplier_branch_number', label: 'Supplier Branch Number' },
];

// MARKER_VATWATCHLISTOPS_POPVAT_REPORT_REALDATA_V1
function VatPopvatReportPanel({ bu }) {
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(false);

  const fetchPopvatRows = React.useCallback(() => {
    if (!bu) return;
    setLoading(true);
    return apiFetch(`/vat_upload_popvatdraft?eq_bu=${encodeURIComponent(bu)}&eq_status=draft`)
      .then((res) => setRows(Array.isArray(res) ? res : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [bu]);
  React.useEffect(() => { fetchPopvatRows(); }, [fetchPopvatRows]);
  // MARKER_VATWATCHLIST_REALTIME_SUBSCRIBE_V1
  React.useEffect(() => {
    const unsubscribe = subscribeWs(['vat_export_updated'], (payload) => {
      if (payload?.buList && !payload.buList.includes(bu)) return;
      fetchPopvatRows();
    });
    return unsubscribe;
  }, [bu, fetchPopvatRows]);

  // MARKER_VATWATCHLISTOPS_POPVAT_REPORT_SEARCH_V1
  const [searchQuery, setSearchQuery] = React.useState('');
  const filteredRows = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => VAT_POPVAT_REPORT_COLUMNS.some((c) => String(r[c.key] ?? '').toLowerCase().includes(q)));
  }, [rows, searchQuery]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, gap: '8px' }}> {/* MARKER_VATWATCHLISTOPS_POPVAT_REPORT_TOOLBAR_SPACE_V1 */}
      <div style={{ minHeight: '44px', flexShrink: 0, display: 'flex', alignItems: 'center' }}> {/* MARKER_VATWATCHLISTOPS_POPVAT_REPORT_SEARCH_V1 -- Search Engine ตัวแรกใน Toolbar */}
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="ค้นหา..."
          style={{ padding: '6px 12px', fontSize: '12.5px', border: '0.5px solid #ccc', borderRadius: '8px', width: '280px' }}
        />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, border: '0.5px solid #e8e8e8', borderRadius: '10px', overflow: 'auto' }}> {/* MARKER_VATWATCHLISTOPS_EXCEL_GRID_EXTEND_WIRE_V1 -- ใช้ ExcelStyleGrid แทน Table เดิม */}
        {loading ? (
          <div style={{ padding: '32px', textAlign: 'center', color: '#999' }}>กำลังโหลด...</div>
        ) : (
          <ExcelStyleGrid
            columns={VAT_POPVAT_REPORT_COLUMNS}
            rows={filteredRows}
            emptyText="ไม่มีข้อมูล"
            onCommitCell={(row, key, value) => {
              apiFetch(`/vat_upload_popvatdraft/${row.id}`, { method: 'PUT', body: JSON.stringify({ [key]: value }) })
                .then(() => setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, [key]: value } : r))))
                .catch((err) => { console.error('Update Popvat field error:', err); alert('บันทึกไม่สำเร็จ กรุณาลองใหม่'); });
            }}
          />
        )}
      </div>
    </div>
  );
}

// MARKER_VATWATCHLISTOPS_GENERATE_FILE_MODAL_V1 -- Popup Generate file (Popvat/Simple/ADI Export)
const VAT_GENERATE_FILE_REPORT_TYPES = [
  { key: 'popvat', label: 'Popvat report', color: '#3b82f6', icon: '\ud83d\udcc4' },
  { key: 'simple', label: 'Simple report', color: '#10b981', icon: '\ud83d\uddc2\ufe0f' },
  { key: 'adi', label: 'ADI report', color: '#f97316', icon: '\ud83d\udd01' },
];

function VatGenerateFileModal({ bu, onClose, categoryCounts }) {
  // MARKER_VATWATCHLISTOPS_GENERATE_FILE_MODAL_HASDATA_V1 -- ใช้ categoryCounts เดียวกับ Monitor Card เช็คว่า Report ไหนมีข้อมูลจริงบ้าง
  const counts = categoryCounts || {};
  const hasData = {
    popvat: (counts.popvat || 0) > 0,
    simple: (counts.simple || 0) > 0,
    adi: (counts.adi || 0) > 0,
  };
  const availableKeys = ['popvat', 'simple', 'adi'].filter((k) => hasData[k]);

  const [selectedReports, setSelectedReports] = React.useState(new Set(availableKeys));
  const [scope, setScope] = React.useState('bu');
  const [book, setBook] = React.useState('');
  const [simpleMode, setSimpleMode] = React.useState('all');
  const [menuSource, setMenuSource] = React.useState('');
  const [menuSources, setMenuSources] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  // MARKER_VATWATCHLISTOPS_GENERATE_MODAL_SHEET_SELECT_V1 -- Fetch Simple Draft Rows มา Group เป็น Sheet List ให้เลือก (เฉพาะตอนมี Simple ติ๊กไว้)
  const [simpleRowsForModal, setSimpleRowsForModal] = React.useState([]);
  const [selectedSimpleGroups, setSelectedSimpleGroups] = React.useState(new Set());

  React.useEffect(() => {
    apiFetch('/vat-export/menu-sources')
      .then((data) => { if (data.ok) setMenuSources(data.menuSources || []); })
      .catch(() => {}); // MARKER_VATWATCHLISTOPS_GENERATE_FILE_MODAL_APIFETCH_FIX_V1 -- แก้ใช้ apiFetch (เดิมใช้ fetch() ตรงๆ ทำให้ URL ผิด + ไม่มี Auth)
  }, []);

  const hasSimple = selectedReports.has('simple');
  React.useEffect(() => { if (hasSimple && scope === 'book') setScope('bu'); }, [hasSimple, scope]); // MARKER -- Simple ทำ Book ไม่ได้ บังคับกลับเป็น BU

  React.useEffect(() => { // MARKER_VATWATCHLISTOPS_GENERATE_MODAL_SHEET_SELECT_V1
    if (!hasSimple || !bu) { setSimpleRowsForModal([]); return; }
    apiFetch(`/vat_simpleinputdraft?eq_bu=${encodeURIComponent(bu)}&eq_status=draft`)
      .then((res) => setSimpleRowsForModal(Array.isArray(res) ? res : []))
      .catch(() => setSimpleRowsForModal([]));
  }, [hasSimple, bu]);

  const simpleGroupsForModal = React.useMemo(() => {
    const map = new Map();
    simpleRowsForModal.forEach((r) => {
      const key = `${r.invoice_ref || 'Invoice'}_${r.type_sim || 'NNN'}`;
      map.set(key, (map.get(key) || 0) + 1);
    });
    return [...map.entries()].map(([key, count]) => ({ key, count }));
  }, [simpleRowsForModal]);

  React.useEffect(() => { // ติ๊กครบทุก Sheet ทุกครั้งที่รายการเปลี่ยน (Default เดิมคือเอาหมด)
    setSelectedSimpleGroups(new Set(simpleGroupsForModal.map((g) => g.key)));
  }, [simpleGroupsForModal]);

  const toggleSimpleGroup = (key) => setSelectedSimpleGroups((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const allSimpleGroupsChecked = simpleGroupsForModal.length > 0 && simpleGroupsForModal.every((g) => selectedSimpleGroups.has(g.key));
  const toggleAllSimpleGroups = () => setSelectedSimpleGroups(allSimpleGroupsChecked ? new Set() : new Set(simpleGroupsForModal.map((g) => g.key)));

  const toggleReport = (key) => {
    if (!hasData[key]) return; // MARKER_VATWATCHLISTOPS_GENERATE_FILE_MODAL_HASDATA_V1 -- Report ที่ไม่มีข้อมูลกดไม่ได้
    setSelectedReports((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const allChecked = availableKeys.length > 0 && availableKeys.every((k) => selectedReports.has(k));
  const toggleAll = () => setSelectedReports(allChecked ? new Set() : new Set(availableKeys)); // MARKER_VATWATCHLISTOPS_GENERATE_FILE_MODAL_HASDATA_V1 -- All เลือกเฉพาะตัวที่มีข้อมูลจริง

  const handleGenerate = async () => {
    if (selectedReports.size === 0) { confirmDialog.alert('เลือกอย่างน้อย 1 Report', { title: 'ยังไม่ได้เลือก Report' }); return; }
    if (scope === 'book' && !book.trim()) { confirmDialog.alert('กรุณาระบุ Book', { title: 'ยังไม่ได้ระบุ Book' }); return; }
    if (hasSimple && simpleMode === 'by_sheet' && selectedSimpleGroups.size === 0) { confirmDialog.alert('เลือกอย่างน้อย 1 Sheet', { title: 'ยังไม่ได้เลือก Sheet' }); return; } // MARKER_VATWATCHLISTOPS_GENERATE_MODAL_SHEET_SELECT_V1
    setBusy(true);
    try {
      const data = await apiFetch('/vat-export/generate', { // MARKER_VATWATCHLISTOPS_GENERATE_FILE_MODAL_APIFETCH_FIX_V1 -- แก้ใช้ apiFetch (เดิมใช้ fetch() ตรงๆ ทำให้ URL ผิด + ไม่มี Auth)
        method: 'POST',
        body: JSON.stringify({
          bu,
          scope,
          book: scope === 'book' ? book.trim() : undefined,
          reports: Array.from(selectedReports),
          simpleGroupKeys: (hasSimple && simpleMode === 'by_sheet') ? Array.from(selectedSimpleGroups) : undefined, // MARKER_VATWATCHLISTOPS_GENERATE_MODAL_SHEET_SELECT_V1
          simpleMode,
          menuSource: menuSource || undefined,
        }),
      });
      await confirmDialog.alert(`สร้างไฟล์สำเร็จ ${data.files.length} ไฟล์`, { title: 'สำเร็จ' });
      onClose(true);
    } catch (err) {
      confirmDialog.alert('เกิดข้อผิดพลาด: ' + err.message, { title: 'เกิดข้อผิดพลาด', variant: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => onClose(false)}>
      <div style={{ background: 'white', borderRadius: '14px', padding: '24px', width: '360px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div>
            <div style={{ fontWeight: '500', fontSize: '16px', marginBottom: '2px' }}>Generate file</div>
            <div style={{ fontSize: '13px', color: '#888' }}>{bu}</div>
          </div>
          <div style={{ display: 'inline-flex', padding: '2px', background: '#f3f4f6', borderRadius: '8px', opacity: hasSimple ? 0.4 : 1 }} title={hasSimple ? 'ปิดใช้งานเพราะมี Simple report ติ๊กไว้ด้วย' : ''}>
            <button type="button" disabled={hasSimple} onClick={() => setScope('bu')} style={{ padding: '4px 12px', fontSize: '12px', fontWeight: '500', border: 'none', background: scope === 'bu' ? 'white' : 'transparent', borderRadius: '6px', color: scope === 'bu' ? '#1a3a5c' : '#888', cursor: hasSimple ? 'not-allowed' : 'pointer', boxShadow: scope === 'bu' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>BU</button>
            <button type="button" disabled={hasSimple} onClick={() => setScope('book')} style={{ padding: '4px 12px', fontSize: '12px', fontWeight: '500', border: 'none', background: scope === 'book' ? 'white' : 'transparent', borderRadius: '6px', color: scope === 'book' ? '#1a3a5c' : '#888', cursor: hasSimple ? 'not-allowed' : 'pointer', boxShadow: scope === 'book' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>Book</button>
          </div>
        </div>

        {scope === 'book' && (
          <input type="text" value={book} onChange={(e) => setBook(e.target.value)} placeholder="ระบุ Book เช่น CRG" style={{ width: '100%', padding: '8px 10px', fontSize: '13px', border: '0.5px solid #ccc', borderRadius: '8px', marginBottom: '14px', boxSizing: 'border-box' }} />
        )}

        <div style={{ fontSize: '11px', fontWeight: '500', letterSpacing: '0.02em', color: '#999', marginBottom: '10px', textTransform: 'uppercase' }}>รายงาน</div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', padding: '9px 10px', borderRadius: '10px', marginBottom: '8px', border: '0.5px dashed #ccc', cursor: 'pointer' }}>
          <input type="checkbox" checked={allChecked} onChange={toggleAll} style={{ margin: 0 }} />
          <span style={{ fontWeight: '500' }}>All report</span>
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '16px' }}>
          {VAT_GENERATE_FILE_REPORT_TYPES.map((rt) => (
            <React.Fragment key={rt.key}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', padding: '9px 10px', borderRadius: '10px', background: selectedReports.has(rt.key) ? rt.color + '1A' : 'transparent', cursor: hasData[rt.key] ? 'pointer' : 'not-allowed', opacity: hasData[rt.key] ? 1 : 0.45 }} title={hasData[rt.key] ? '' : 'ไม่มีข้อมูลรอ Export'}> {/* MARKER_VATWATCHLISTOPS_GENERATE_FILE_MODAL_HASDATA_V1 -- จางลงถ้าไม่มีข้อมูล */}
                <input type="checkbox" checked={selectedReports.has(rt.key)} onChange={() => toggleReport(rt.key)} disabled={!hasData[rt.key]} style={{ margin: 0 }} />
                <div style={{ width: '26px', height: '26px', borderRadius: '7px', background: selectedReports.has(rt.key) ? rt.color : '#e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '14px' }}>{rt.icon}</div>
                <span>{rt.label}</span>
                <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#999' }}>{hasData[rt.key] ? `${counts[rt.key]} รายการ` : 'ไม่มีข้อมูล'}</span>
              </label>
              {rt.key === 'simple' && selectedReports.has('simple') && (
                <div style={{ marginLeft: '40px', display: 'flex', gap: '6px' }}>
                  <button type="button" onClick={() => setSimpleMode('all')} style={{ padding: '4px 12px', fontSize: '12px', border: simpleMode === 'all' ? '1px solid #1a3a5c' : '0.5px solid #ccc', borderRadius: '6px', background: simpleMode === 'all' ? '#eaf0f6' : 'white', color: simpleMode === 'all' ? '#1a3a5c' : '#666', cursor: 'pointer' }}>All</button>
                  <button type="button" onClick={() => setSimpleMode('by_sheet')} style={{ padding: '4px 12px', fontSize: '12px', border: simpleMode === 'by_sheet' ? '1px solid #1a3a5c' : '0.5px solid #ccc', borderRadius: '6px', background: simpleMode === 'by_sheet' ? '#eaf0f6' : 'white', color: simpleMode === 'by_sheet' ? '#1a3a5c' : '#666', cursor: 'pointer' }}>By sheet</button>
                </div>
              )}
              {/* MARKER_VATWATCHLISTOPS_GENERATE_MODAL_SHEET_SELECT_V1 -- Checkbox List เลือก Sheet โผล่เฉพาะตอนเลือก By sheet */}
              {rt.key === 'simple' && selectedReports.has('simple') && simpleMode === 'by_sheet' && simpleGroupsForModal.length > 0 && (
                <div style={{ marginLeft: '40px', marginTop: '8px', background: '#f6f8fa', borderRadius: '8px', padding: '8px 10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontSize: '11px', color: '#999' }}>เลือก Sheet ที่จะ Generate</span>
                    <button type="button" onClick={toggleAllSimpleGroups} style={{ fontSize: '11px', color: '#1a3a5c', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>{allSimpleGroupsChecked ? 'ไม่เลือกเลย' : 'เลือกทั้งหมด'}</button>
                  </div>
                  {simpleGroupsForModal.map((g) => (
                    <label key={g.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 2px', fontSize: '13px', cursor: 'pointer' }}>
                      <input type="checkbox" checked={selectedSimpleGroups.has(g.key)} onChange={() => toggleSimpleGroup(g.key)} style={{ margin: 0 }} />
                      <span style={{ flex: 1 }}>{g.key}</span>
                      <span style={{ fontSize: '11px', color: '#999' }}>{g.count} รายการ</span>
                    </label>
                  ))}
                </div>
              )}
            </React.Fragment>
          ))}
        </div>

        <div style={{ height: '0.5px', background: '#e5e7eb', marginBottom: '16px' }}></div>

        <div style={{ fontSize: '11px', fontWeight: '500', letterSpacing: '0.02em', color: '#999', marginBottom: '8px', textTransform: 'uppercase' }}>Menu source</div>
        <select value={menuSource} onChange={(e) => setMenuSource(e.target.value)} style={{ width: '100%', padding: '8px 10px', fontSize: '13px', border: '0.5px solid #ccc', borderRadius: '8px', marginBottom: '20px', boxSizing: 'border-box' }}>
          <option value="">ทั้งหมด</option>
          {menuSources.map((ms) => <option key={ms} value={ms}>{ms}</option>)}
        </select>

        <button type="button" onClick={handleGenerate} disabled={busy} style={{ width: '100%', padding: '10px', fontSize: '13px', fontWeight: '500', background: busy ? '#999' : '#1a3a5c', color: 'white', border: 'none', borderRadius: '10px', cursor: busy ? 'default' : 'pointer' }}>
          {busy ? 'กำลัง Generate...' : `Generate file (${selectedReports.size} รายงาน)`}
        </button>
      </div>
    </div>
  );
}

// MARKER_VATWATCHLISTOPS_EXPORT_HISTORY_TABLE_V1 -- ตาราง Export History (Zone ล่าง)
function formatVatExportDateTime(val) { // MARKER -- ต่างจาก formatVatIncompleteDate ตรงที่มีเวลา (HH:MM) ด้วย เพราะประวัติ Export/Download ต้องรู้เวลาละเอียด
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm} ${hh}:${min}`;
}

async function downloadVatExportFile(fileId, fileName) { // MARKER_VATWATCHLISTOPS_EXPORT_HISTORY_DOWNLOAD_V1 -- apiFetch Parse JSON เสมอ ใช้กับไฟล์ Binary ไม่ได้ ต้อง fetch() ตรงๆ + แนบ Token เอง (Pattern เดียวกับ fetchVatNoteImageBlobUrl)
  const token = sessionStorage.getItem('fastapn_token');
  const res = await fetch(`${VAT_NOTES_API_BASE}/vat-export/file/${fileId}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('โหลดไฟล์ไม่สำเร็จ');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function VatExportHistoryIcon({ file, colorMap, defaultIcon, onDownloaded }) {
  const [downloading, setDownloading] = React.useState(false);
  const downloaded = !!file.downloadedAt;
  const meta = colorMap[file.module] || { color: '#6b7280', icon: defaultIcon };
  const handleClick = async () => {
    setDownloading(true);
    try {
      await downloadVatExportFile(file.id, file.fileName);
      onDownloaded();
    } catch (err) {
      confirmDialog.alert('เกิดข้อผิดพลาด: ' + err.message, { title: 'โหลดไฟล์ไม่สำเร็จ', variant: 'danger' });
    } finally {
      setDownloading(false);
    }
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={downloading}
      title={`${file.fileName}${downloaded ? ' — โหลดแล้ว ' + formatVatExportDateTime(file.downloadedAt) : ' — ยังไม่โหลด'}`}
      style={{ width: '30px', height: '30px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', border: `0.5px solid ${downloaded ? '#10b981' : meta.color}`, borderRadius: '7px', background: 'white', color: downloaded ? '#10b981' : meta.color, cursor: downloading ? 'default' : 'pointer', fontSize: '14px' }}
    >
      {meta.icon}
      {downloaded && (
        <span style={{ position: 'absolute', bottom: '-3px', right: '-3px', fontSize: '9px', background: '#10b981', color: 'white', borderRadius: '50%', width: '13px', height: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</span>
      )}
    </button>
  );
}

const VAT_EXPORT_HISTORY_COLOR_MAP = {
  'vat-popvat': { color: '#3b82f6', icon: '📄' },
  'vat-simple': { color: '#10b981', icon: '🗂️' },
  'vat-adi': { color: '#f97316', icon: '🔁' },
  'vat-simple-adi': { color: '#10b981', icon: '🗂️' },
};

function VatExportHistoryRow({ batch, onRefresh, onDataChanged }) {
  const { isOwner, isAdmin } = useUserRole(); // MARKER_VATWATCHLISTOPS_EXPORT_HISTORY_RESTORE_V1 -- ปุ่ม Restore เฉพาะ Owner/Admin
  const popvatFiles = batch.files.filter((f) => f.module === 'vat-popvat');
  const otherFiles = batch.files.filter((f) => f.module !== 'vat-popvat');
  const popvatDownloadedAt = popvatFiles.find((f) => f.downloadedAt)?.downloadedAt || null;
  const otherDownloadedAt = otherFiles.every((f) => f.downloadedAt) && otherFiles.length > 0
    ? otherFiles.map((f) => f.downloadedAt).sort().slice(-1)[0]
    : null;

  const handleDownloadAll = async () => {
    try {
      for (const f of batch.files) { await downloadVatExportFile(f.id, f.fileName); }
      onRefresh();
    } catch (err) {
      confirmDialog.alert('เกิดข้อผิดพลาด: ' + err.message, { title: 'โหลดไฟล์ไม่สำเร็จ', variant: 'danger' });
    }
  };

  const handleRestore = async () => { // MARKER_VATWATCHLISTOPS_EXPORT_HISTORY_RESTORE_V1
    const confirmed = await confirmDialog.confirm(
      `ลบไฟล์และประวัติของ Batch "${batch.batchId}" แล้วดึงข้อมูลกลับไปเป็น Draft (รอ Export ใหม่)?`,
      { title: 'Restore Batch', variant: 'danger' }
    );
    if (!confirmed) return;
    try {
      await apiFetch(`/vat-export/batch/${encodeURIComponent(batch.batchId)}`, { method: 'DELETE' });
      onDataChanged ? onDataChanged() : onRefresh(); // MARKER_VATWATCHLISTOPS_EXPORT_HISTORY_RESTORE_BROADCAST_V1 -- Restore กระทบ Count ที่ Monitor Card ด้วย ต้อง Refresh ขึ้นไปถึงชั้นบนสุด ไม่ใช่แค่ตาราง History เอง
    } catch (err) {
      confirmDialog.alert('Restore ไม่สำเร็จ: ' + err.message, { title: 'เกิดข้อผิดพลาด', variant: 'danger' });
    }
  };

  return (
    <tr>
      <td style={{ padding: '10px 12px', borderBottom: '0.5px solid #eee', color: '#666', fontSize: '12px' }}>{batch.batchId}</td>
      <td style={{ padding: '10px 12px', borderBottom: '0.5px solid #eee', fontSize: '12px' }}>{batch.bu}</td>
      <td style={{ padding: '10px 12px', borderBottom: '0.5px solid #eee' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {popvatFiles.length > 0 ? (
            popvatFiles.map((f) => <VatExportHistoryIcon key={f.id} file={f} colorMap={VAT_EXPORT_HISTORY_COLOR_MAP} defaultIcon="📄" onDownloaded={onRefresh} />)
          ) : (
            <div title="ไม่มีไฟล์ Popvat" style={{ width: '30px', height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ccc', opacity: 0.4, fontSize: '14px' }}>🚫</div>
          )}
          <div style={{ width: '0.5px', height: '20px', background: '#ddd', margin: '0 4px' }}></div>
          {otherFiles.length > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '2px', padding: '3px', border: '0.5px solid #ddd', borderRadius: '8px' }}>
              {otherFiles.map((f) => <VatExportHistoryIcon key={f.id} file={f} colorMap={VAT_EXPORT_HISTORY_COLOR_MAP} defaultIcon="🗂️" onDownloaded={onRefresh} />)}
            </div>
          ) : (
            <div title="ไม่มีไฟล์ Simple/ADI" style={{ width: '30px', height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ccc', opacity: 0.4, fontSize: '14px' }}>🚫</div>
          )}
          <div style={{ width: '0.5px', height: '20px', background: '#ddd', margin: '0 4px' }}></div>
          <button
            type="button"
            onClick={handleDownloadAll}
            disabled={batch.files.length < 2}
            title={batch.files.length < 2 ? 'มีไฟล์เดียว โหลดตรงพอ' : `Download all (${batch.files.length} ไฟล์)`}
            style={{ width: '30px', height: '30px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '0.5px solid #ccc', borderRadius: '7px', background: 'white', cursor: batch.files.length < 2 ? 'not-allowed' : 'pointer', opacity: batch.files.length < 2 ? 0.3 : 1, fontSize: '14px' }}
          >⬇️</button>
        </div>
      </td>
      <td style={{ padding: '10px 12px', borderBottom: '0.5px solid #eee', color: '#666', fontSize: '12px', whiteSpace: 'nowrap' }}>{formatVatExportDateTime(batch.exportedAt)}</td>
      <td style={{ padding: '10px 12px', borderBottom: '0.5px solid #eee', color: popvatDownloadedAt ? '#666' : '#ccc', fontSize: '12px', whiteSpace: 'nowrap' }}>{popvatDownloadedAt ? formatVatExportDateTime(popvatDownloadedAt) : '—'}</td>
      <td style={{ padding: '10px 12px', borderBottom: '0.5px solid #eee', color: otherDownloadedAt ? '#666' : '#ccc', fontSize: '12px', whiteSpace: 'nowrap' }}>{otherDownloadedAt ? formatVatExportDateTime(otherDownloadedAt) : '—'}</td>
      <td style={{ padding: '10px 12px', borderBottom: '0.5px solid #eee', textAlign: 'right', whiteSpace: 'nowrap' }}>
        {(isOwner || isAdmin) && (
          <button type="button" onClick={handleRestore} title="ลบไฟล์ + ดึงข้อมูลกลับเป็น Draft" style={{ padding: '6px 14px', fontSize: '12px', border: '0.5px solid #dc2626', borderRadius: '8px', background: 'white', color: '#dc2626', cursor: 'pointer', marginRight: '6px' }}>Restore</button> // MARKER_VATWATCHLISTOPS_EXPORT_HISTORY_RESTORE_V1
        )}
        <button type="button" style={{ padding: '6px 14px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '8px', background: 'white', cursor: 'pointer' }}>Finish</button> {/* MARKER_VATWATCHLISTOPS_EXPORT_HISTORY_FINISH_BTN_V1 -- ยังไม่ผูก Logic ตามที่ Confirm ไว้ */}
      </td>
    </tr>
  );
}

function VatExportHistoryTable({ refreshKey, onDataChanged }) { // MARKER_VATWATCHLISTOPS_EXPORT_HISTORY_ALL_BU_V1 -- ตัด bu ออก โชว์ทุก BU เสมอ (เป็นพื้นที่เก็บงานกลาง ทุกคนต้องเห็นเหมือนกันหมด)
  const [batches, setBatches] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(() => {
    setLoading(true);
    apiFetch('/vat-export/history')
      .then((data) => { if (data.ok) setBatches(data.batches || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => { load(); }, [load, refreshKey]);
  React.useEffect(() => { // MARKER_VATWATCHLISTOPS_WS_SYNC_GAPS_V1 -- Sync ข้าม Session ตามที่ Comment ด้านบนตั้งใจไว้ ("ทุกคนต้องเห็นเหมือนกันหมด") แต่เดิมไม่เคย Subscribe WS จริง
    const unsubscribe = subscribeWs(['vat_export_updated'], () => load());
    return unsubscribe;
  }, [load]);

  let bodyContent;
  if (loading) {
    bodyContent = <tr><td colSpan={7} style={{ padding: '30px', textAlign: 'center', color: '#999' }}>กำลังโหลด...</td></tr>;
  } else if (batches.length === 0) {
    bodyContent = <tr><td colSpan={7} style={{ padding: '30px', textAlign: 'center', color: '#999' }}>ยังไม่มีประวัติ Export</td></tr>;
  } else {
    bodyContent = batches.map((b) => <VatExportHistoryRow key={b.batchId} batch={b} onRefresh={load} onDataChanged={onDataChanged} />); // MARKER_VATWATCHLISTOPS_EXPORT_HISTORY_RESTORE_BROADCAST_V1
  }

  return (
    <div style={{ flex: '35 1 0%', border: '0.5px solid #e5e7eb', borderRadius: '10px', overflow: 'auto', display: 'flex', flexDirection: 'column', background: 'white' }}> {/* MARKER_VATWATCHLISTOPS_EXPORT_HISTORY_WHITE_BG_V1 */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
        <thead>
          <tr style={{ background: '#f9fafb' }}>
            <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: '500', color: '#666' }}>Batch ID</th>
            <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: '500', color: '#666' }}>BU</th>
            <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: '500', color: '#666' }}>ไฟล์</th>
            <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: '500', color: '#666' }}>Export</th>
            <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: '500', color: '#666' }}>Download Popvat</th>
            <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: '500', color: '#666' }}>Download Simple/ADI</th>
            <th style={{ padding: '10px 12px' }}></th>
          </tr>
        </thead>
        <tbody>
          {bodyContent}
        </tbody>
      </table>
    </div>
  );
}

// ── หน้า Detail ของ Upload file -- "VAT Resource from Operation" ────────
// ── 3 Tab (ไม่มี DataLoad แล้ว) เฉพาะของ BU ที่เลือกไว้จากหน้า Lobby ──────
function VatUploadFileDetail({ bu, onBack, categoryCounts }) {
  const [detailTab, setDetailTab] = React.useState(VAT_UPLOAD_FILE_TABS[0].id);
  const [showGenerateFileModalInner, setShowGenerateFileModalInner] = React.useState(false); // MARKER_VATWATCHLISTOPS_GENERATE_FILE_MODAL_V1
  return (
    <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: '8px', height: '100%', boxSizing: 'border-box' }}> {/* MARKER_VATWATCHLISTOPS_UPLOADFILE_HEADER_COMPACT_V2 -- ลด Padding หน้า 24px->16px (แนวตั้ง) + Gap 12px->8px */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', borderBottom: '0.5px solid #e8e8e8', paddingBottom: '4px' }}> {/* MARKER_VATWATCHLISTOPS_UPLOADFILE_HEADER_COMPACT_V2 -- รวม Back+Title+BU (ชิดซ้าย) กับ Tab หลัก (ชิดขวา) เป็นแถวเดียว */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button type="button" onClick={onBack} style={{ padding: '4px 10px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '8px', background: 'white', cursor: 'pointer' }}>← Back</button>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: '14px', fontWeight: '500' }}>VAT Resource from Operation</span>
            <span style={{ fontSize: '11px', color: '#666' }}>{bu}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ display: 'flex', gap: '2px' }}>
            {VAT_UPLOAD_FILE_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setDetailTab(t.id)}
                style={{ padding: '8px 16px', fontSize: '12.5px', border: 'none', borderRadius: '8px 8px 0 0', borderBottom: detailTab === t.id ? '3px solid #1a3a5c' : '3px solid transparent', background: detailTab === t.id ? '#eaf0f6' : 'transparent', cursor: 'pointer', color: detailTab === t.id ? '#1a3a5c' : '#888', fontWeight: detailTab === t.id ? '500' : '400' }} // MARKER_VATWATCHLISTOPS_ZONEBN_LABEL_REMOVE_TAB_COLORB_V1
              >{t.label}</button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowGenerateFileModalInner(true)}
            style={{ padding: '8px 16px', fontSize: '12.5px', border: '0.5px solid #1a3a5c', borderRadius: '8px', background: '#1a3a5c', color: 'white', cursor: 'pointer', fontWeight: '500' }} // MARKER_VATWATCHLISTOPS_GENERATE_FILE_MODAL_V1 -- ปุ่ม Generate File ด้านใน (รู้ BU อยู่แล้ว กดได้เสมอ)
          >Generate file</button>
        </div>
      </div>
      {showGenerateFileModalInner && (
        <VatGenerateFileModal bu={bu} categoryCounts={categoryCounts} onClose={() => setShowGenerateFileModalInner(false)} /> // MARKER_VATWATCHLISTOPS_GENERATE_FILE_MODAL_V1
      )}
      {/* MARKER_VATWATCHLISTOPS_UPLOADFILE_TAB_KEEPALIVE_V1 -- Mount ทั้ง 2 Panel ค้างไว้ ซ่อนด้วย CSS แทน Unmount กันโหลดซ้ำตอนสลับ Tab */}
      <div style={{ flex: 1, display: detailTab === VAT_UPLOAD_FILE_TABS[0].id ? 'flex' : 'none', flexDirection: 'column', minHeight: 0 }}>
        <VatPopvatReportPanel bu={bu} />
      </div>
      <div style={{ flex: 1, display: detailTab === 'simple-input-report' ? 'flex' : 'none', flexDirection: 'column', minHeight: 0 }}>
        <VatSimpleInputReportPanel bu={bu} />
      </div>
      <div style={{ flex: 1, display: detailTab === 'adi-upload' ? 'flex' : 'none', flexDirection: 'column', minHeight: 0 }}> {/* MARKER_VATWATCHLISTOPS_ADI_UPLOAD_REPORT_PANEL_V1 */}
        <VatAdiUploadReportPanel bu={bu} />
      </div>
      {detailTab !== 'simple-input-report' && detailTab !== 'adi-upload' && detailTab !== VAT_UPLOAD_FILE_TABS[0].id && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: '13px' }}>
          ยังไม่มีเนื้อหา
        </div>
      )}
    </div>
  );
}

// MARKER_VATWATCHLISTOPS_SIMPLE_INPUT_REPORT_SKELETON_V1
// ── Column ตาม Format "Simple" จริง (Book1.xlsx / TIV-Simple Sheet) ──────
// MARKER_VATWATCHLISTOPS_SIMPLE_INPUT_REPORT_REALDATA_V1
// ── Column ตาม Schema vat_simpleinputdraft จริง (Key ตรงกับ SIMPLE_DRAFT_COLUMNS ใน Draft Monitor) ──
const VAT_SIMPLE_INPUT_COLUMNS = [
  { key: 'liability_cost_center_special', label: 'Liability Cost Center (Special)' },
  { key: 'liability_account_special', label: 'Liability Account (Special)' },
  { key: 'liability_sub_account_special', label: 'Liability Sub Account (Special)' },
  { key: 'supplier_code', label: 'Supplier Code' },
  { key: 'supplier_name', label: 'Supplier Name' },
  { key: 'receive_date', label: 'Receive Date' },
  { key: 'tax_invoice_number', label: 'Tax Invoice Number' },
  { key: 'tax_invoice_date', label: 'Tax Invoice Date' },
  { key: 'vendor_tax_invoice_number', label: 'Vendor Tax Invoice Number' },
  { key: 'tax_id', label: 'เลขประจำตัวผู้เสียภาษี' },
  { key: 'branch_no', label: 'สาขาที่' },
  { key: 'line_number', label: 'Line Number' },
  { key: 'expense_type', label: 'Expense Type' },
  { key: 'description', label: 'รายการ' },
  { key: 'amount_ex_vat', label: 'Amount Ex VAT' },
  { key: 'vat_amount', label: 'VAT Amount' },
  { key: 'branch_code', label: 'Branch Code' },
  { key: 'cpc_special', label: 'CPC (Special)' },
  { key: 'sub_account_special', label: 'Sub Account (Special)' },
  { key: 'cpc_tax_special', label: 'CPC Tax (Special)' },
  { key: 'vat_average_percent', label: 'VAT Average%' },
];

// MARKER_VATWATCHLISTOPS_EXCEL_STYLE_GRID_V1 -- Component กลาง Reusable รองรับ Selection/Copy-Paste/Keyboard Edit แบบ Excel
// ใช้ต่อกับตารางอื่นได้ (Popvat Report / ADI Upload) โดยส่ง columns/rows/onCommitCell เข้ามา
function substituteVatWatchlistCellRefs(expr, allRows) { // MARKER_VATWATCHLISTOPS_EXCEL_GRID_FORMULA_PHASE2_V1 -- แทนที่ D<แถว>/C<แถว> ด้วยค่าจริงจาก Debit/Credit ของแถวนั้นก่อนคำนวณ
  return expr.replace(/([DC])(\d+)/g, (match, colLetter, rowNumStr) => {
    const rowIdx = parseInt(rowNumStr, 10) - 1;
    const refRow = allRows[rowIdx];
    if (!refRow) throw new Error(`ไม่พบแถวที่ ${rowNumStr}`);
    const refCol = colLetter === 'D' ? 'debit' : 'credit';
    const val = refRow[refCol];
    if (val === null || val === undefined || val === '') return '0'; // MARKER_VATWATCHLISTOPS_EXCEL_GRID_FORMULA_PHASE2_V1 -- Cell ว่างถือเป็น 0 เหมือน Excel
    const num = Number(val);
    if (isNaN(num)) throw new Error(`${match} ไม่ใช่ตัวเลข`);
    return String(num);
  });
}

function evaluateVatWatchlistSimpleFormula(expr) { // MARKER_VATWATCHLISTOPS_EXCEL_GRID_FORMULA_V1 -- Safe Arithmetic Evaluator (+, -, *, /, วงเล็บ) ไม่ใช้ eval()/Function() เพื่อความปลอดภัย -- Phase 1 คำนวณเฉพาะเลขใน Cell เดียวกัน ยังไม่รองรับอ้างอิง Cell อื่น
  const src = expr.replace(/\s+/g, '');
  let pos = 0;
  const peek = () => src[pos];
  const parseNumber = () => {
    const start = pos;
    while (pos < src.length && /[0-9.]/.test(src[pos])) pos++;
    const numStr = src.slice(start, pos);
    if (numStr === '' || isNaN(Number(numStr))) throw new Error('รูปแบบตัวเลขไม่ถูกต้อง');
    return Number(numStr);
  };
  const parseFactor = () => {
    if (peek() === '(') {
      pos++;
      const val = parseExpr();
      if (peek() !== ')') throw new Error('วงเล็บไม่ครบ');
      pos++;
      return val;
    }
    if (peek() === '-') { pos++; return -parseFactor(); }
    if (peek() === '+') { pos++; return parseFactor(); }
    return parseNumber();
  };
  const parseTerm = () => {
    let val = parseFactor();
    while (peek() === '*' || peek() === '/') {
      const op = src[pos]; pos++;
      const rhs = parseFactor();
      if (op === '*') val *= rhs;
      else { if (rhs === 0) throw new Error('หารด้วยศูนย์ไม่ได้'); val /= rhs; }
    }
    return val;
  };
  const parseExpr = () => {
    let val = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = src[pos]; pos++;
      const rhs = parseTerm();
      val = op === '+' ? val + rhs : val - rhs;
    }
    return val;
  };
  if (src === '') throw new Error('สูตรว่างเปล่า');
  const result = parseExpr();
  if (pos !== src.length) throw new Error('มีอักขระที่ไม่รู้จักในสูตร');
  if (!isFinite(result)) throw new Error('ผลลัพธ์ไม่ถูกต้อง');
  return result;
}

function ExcelStyleGrid({ columns, rows, onCommitCell, emptyText, getRowId, formatCell, columnWidths, rightAlignKeys, cellContextMenuKey, cellContextMenuOptions, cellContextMenuLabel, cellContextMenus }) { // MARKER_VATWATCHLISTOPS_EXCEL_GRID_EXTEND_WIRE_V1 -- MARKER_VATWATCHLIST_MULTI_CONTEXTMENU_V1
  const isRightAlign = (key) => (rightAlignKeys ? rightAlignKeys.has(key) : false);
  const displayValueOf = (row, col) => (formatCell ? formatCell(row, col) : (row[col.key] ?? ''));
  const widthOf = (key) => (columnWidths && columnWidths[key]) || undefined;
  const [selection, setSelection] = React.useState(null); // {r1,c1,r2,c2}
  const [editingCell, setEditingCell] = React.useState(null); // {r,c}
  // MARKER_VATWATCHLIST_EXPENSETYPE_CONTEXTMENU_V1
  const [cellCtxMenu, setCellCtxMenu] = React.useState(null);
  const [cellCtxPopupOpen, setCellCtxPopupOpen] = React.useState(false);
  const [cellCtxPopupSearch, setCellCtxPopupSearch] = React.useState('');
  const [editValue, setEditValue] = React.useState('');
  const isSelectingRef = React.useRef(false);
  const rowIdOf = getRowId || ((row) => row.id);
  const [historyStack, setHistoryStack] = React.useState([]); // MARKER_VATWATCHLISTOPS_EXCEL_GRID_UNDOREDO_V1 -- Undo/Redo (Ctrl+Z / Ctrl+Y)
  const [redoStack, setRedoStack] = React.useState([]); // MARKER_VATWATCHLISTOPS_EXCEL_GRID_UNDOREDO_V1

  const normRange = (sel) => (sel ? {
    r1: Math.min(sel.r1, sel.r2), r2: Math.max(sel.r1, sel.r2),
    c1: Math.min(sel.c1, sel.c2), c2: Math.max(sel.c1, sel.c2),
  } : null);

  const inSelection = (r, c) => {
    if (!selection) return false;
    const n = normRange(selection);
    return r >= n.r1 && r <= n.r2 && c >= n.c1 && c <= n.c2;
  };

  const commitEdit = (r, c, value) => {
    const row = rows[r];
    const col = columns[c];
    if (!row || !col) return;
    const oldVal = String(row[col.key] ?? '');
    let cleanedValue = value; // MARKER_VATWATCHLISTOPS_EXCEL_GRID_NUMERIC_PASTE_FIX_V1 -- ตัด Comma ออกก่อน Commit เฉพาะ Column ตัวเลข (rightAlignKeys) กัน Paste จาก Excel ที่มี Comma คั่นหลักพันมาแล้ว Error "invalid input syntax for type numeric"
    if (isRightAlign(col.key) && typeof cleanedValue === 'string') {
      const trimmedVal = cleanedValue.trim();
      if (trimmedVal.startsWith('=')) { // MARKER_VATWATCHLISTOPS_EXCEL_GRID_FORMULA_V1 -- พิมพ์สูตรขึ้นต้นด้วย = แล้วคำนวณอัตโนมัติ (Phase 1: เลขในสูตรเดียวกัน ยังไม่รองรับอ้างอิง Cell อื่น)
        try {
          const substitutedFormula = substituteVatWatchlistCellRefs(trimmedVal.slice(1), rows); // MARKER_VATWATCHLISTOPS_EXCEL_GRID_FORMULA_PHASE2_V1 -- แทนที่ D<แถว>/C<แถว> ก่อนคำนวณ
          const formulaResult = evaluateVatWatchlistSimpleFormula(substitutedFormula);
          cleanedValue = String(formulaResult);
        } catch (formulaErr) {
          alert('สูตรไม่ถูกต้อง: ' + formulaErr.message);
          return;
        }
      } else {
        const stripped = trimmedVal.replace(/,/g, '');
        if (stripped !== '' && !isNaN(Number(stripped))) cleanedValue = stripped;
      }
    }
    if (cleanedValue === oldVal) return;
    setHistoryStack((prev) => [...prev, { rowId: rowIdOf(row), key: col.key, oldVal, newVal: cleanedValue }].slice(-50)); // MARKER_VATWATCHLISTOPS_EXCEL_GRID_UNDOREDO_V1 -- จำ 50 รายการล่าสุด
    setRedoStack([]); // MARKER_VATWATCHLISTOPS_EXCEL_GRID_UNDOREDO_V1 -- แก้ใหม่แล้ว Redo เดิมใช้ไม่ได้อีกต่อไป
    onCommitCell(row, col.key, cleanedValue === '' ? null : cleanedValue); // MARKER_VATWATCHLISTOPS_EXCEL_GRID_EMPTY_TO_NULL_V1 -- ส่ง null แทน "" กัน Error Numeric Column แปลงค่าว่างไม่ได้
  };

  const handleUndo = () => { // MARKER_VATWATCHLISTOPS_EXCEL_GRID_UNDOREDO_V1
    setHistoryStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      const row = rows.find((rr) => rowIdOf(rr) === last.rowId);
      if (row) {
        onCommitCell(row, last.key, last.oldVal === '' ? null : last.oldVal);
        setRedoStack((rprev) => [...rprev, last]);
      }
      return prev.slice(0, -1);
    });
  };
  const handleRedo = () => { // MARKER_VATWATCHLISTOPS_EXCEL_GRID_UNDOREDO_V1
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      const row = rows.find((rr) => rowIdOf(rr) === last.rowId);
      if (row) {
        onCommitCell(row, last.key, last.newVal === '' ? null : last.newVal);
        setHistoryStack((hprev) => [...hprev, last]);
      }
      return prev.slice(0, -1);
    });
  };

  const startEdit = (r, c, initialValue) => {
    setEditingCell({ r, c });
    setEditValue(initialValue);
  };

  const stopEdit = (commit) => {
    if (editingCell && commit) commitEdit(editingCell.r, editingCell.c, editValue);
    setEditingCell(null);
  };

  const moveSelection = (dr, dc, extend) => {
    setSelection((prev) => {
      const base = prev || { r1: 0, c1: 0, r2: 0, c2: 0 };
      const nr = Math.max(0, Math.min(rows.length - 1, base.r2 + dr));
      const nc = Math.max(0, Math.min(columns.length - 1, base.c2 + dc));
      if (extend) return { ...base, r2: nr, c2: nc };
      return { r1: nr, c1: nc, r2: nr, c2: nc };
    });
  };

  const handleKeyDown = (e) => {
    if (editingCell) {
      if (e.key === 'Enter') { e.preventDefault(); stopEdit(true); moveSelection(1, 0, false); }
      else if (e.key === 'Tab') { e.preventDefault(); stopEdit(true); moveSelection(0, 1, false); }
      else if (e.key === 'Escape') { e.preventDefault(); stopEdit(false); }
      return;
    }
    if (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); handleUndo(); return; } // MARKER_VATWATCHLISTOPS_EXCEL_GRID_UNDOREDO_V1
    if ((e.key.toLowerCase() === 'y' && (e.ctrlKey || e.metaKey)) || (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey)) { e.preventDefault(); handleRedo(); return; } // MARKER_VATWATCHLISTOPS_EXCEL_GRID_UNDOREDO_V1
    if (!selection) return;
    if (e.key.toLowerCase() === 'a' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setSelection({ r1: 0, c1: 0, r2: rows.length - 1, c2: columns.length - 1 }); } // MARKER_VATWATCHLISTOPS_EXCEL_GRID_NAV_V1 -- Ctrl+A เลือกทั้งหมด
    else if (e.key === 'F2') { e.preventDefault(); const row = rows[selection.r2]; const col = columns[selection.c2]; if (row && col) startEdit(selection.r2, selection.c2, String(row[col.key] ?? '')); } // MARKER_VATWATCHLISTOPS_EXCEL_GRID_NAV_V1 -- F2 เข้า Edit Mode
    else if (e.key === 'Home') { e.preventDefault(); setSelection((prev) => { const base = prev || { r1: 0, c1: 0, r2: 0, c2: 0 }; if (e.ctrlKey) return { r1: 0, c1: 0, r2: 0, c2: 0 }; return { r1: base.r2, c1: 0, r2: base.r2, c2: 0 }; }); } // MARKER_VATWATCHLISTOPS_EXCEL_GRID_NAV_V1
    else if (e.key === 'End') { e.preventDefault(); setSelection((prev) => { const base = prev || { r1: 0, c1: 0, r2: 0, c2: 0 }; const lastC = columns.length - 1; if (e.ctrlKey) return { r1: rows.length - 1, c1: lastC, r2: rows.length - 1, c2: lastC }; return { r1: base.r2, c1: lastC, r2: base.r2, c2: lastC }; }); } // MARKER_VATWATCHLISTOPS_EXCEL_GRID_NAV_V1
    else if (e.key === 'PageUp') { e.preventDefault(); moveSelection(-10, 0, e.shiftKey); } // MARKER_VATWATCHLISTOPS_EXCEL_GRID_NAV_V1
    else if (e.key === 'PageDown') { e.preventDefault(); moveSelection(10, 0, e.shiftKey); } // MARKER_VATWATCHLISTOPS_EXCEL_GRID_NAV_V1
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1, 0, e.shiftKey); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1, 0, e.shiftKey); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); moveSelection(0, -1, e.shiftKey); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); moveSelection(0, 1, e.shiftKey); }
    else if (e.key === 'Enter') { e.preventDefault(); const row = rows[selection.r2]; const col = columns[selection.c2]; if (row && col) startEdit(selection.r2, selection.c2, String(row[col.key] ?? '')); }
    else if (e.key === 'Tab') { e.preventDefault(); moveSelection(0, 1, false); }
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      const n = normRange(selection);
      for (let r = n.r1; r <= n.r2; r++) { for (let c = n.c1; c <= n.c2; c++) commitEdit(r, c, ''); }
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault(); // MARKER_VATWATCHLISTOPS_EXCEL_GRID_KEYSTROKE_DOUBLE_FIX_V1 -- เดิมไม่มี preventDefault ทำให้ตัวอักษรที่พิมพ์เข้าซ้ำ 2 ตัว (Browser Default Behavior ทำงานซ้อนกับ State ที่ตั้งไว้)
      startEdit(selection.r2, selection.c2, e.key);
    }
  };

  const handleCopy = (e) => {
    if (!selection) return;
    e.preventDefault();
    const n = normRange(selection);
    const lines = [];
    for (let r = n.r1; r <= n.r2; r++) {
      const cells = [];
      for (let c = n.c1; c <= n.c2; c++) cells.push(String(rows[r]?.[columns[c].key] ?? ''));
      lines.push(cells.join('\t'));
    }
    e.clipboardData.setData('text/plain', lines.join('\n'));
  };

  const handlePaste = (e) => {
    if (!selection) return;
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    const gridLines = text.replace(/\r/g, '').split('\n');
    if (gridLines.length > 0 && gridLines[gridLines.length - 1] === '') gridLines.pop();
    const gridCells = gridLines.map((line) => line.split('\t'));
    const startR = Math.min(selection.r1, selection.r2);
    const startC = Math.min(selection.c1, selection.c2);
    gridCells.forEach((lineCells, ri) => {
      lineCells.forEach((val, ci) => {
        const r = startR + ri, c = startC + ci;
        if (r < rows.length && c < columns.length) commitEdit(r, c, val);
      });
    });
    setSelection({ r1: startR, c1: startC, r2: Math.min(rows.length - 1, startR + gridCells.length - 1), c2: Math.min(columns.length - 1, startC + ((gridCells[0] && gridCells[0].length) || 1) - 1) });
  };

  return ( // MARKER_VATWATCHLIST_EXPENSETYPE_FRAGMENT_FIX_V1
    <>
    <table
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onCopy={handleCopy}
      onPaste={handlePaste}
      onMouseUp={() => { isSelectingRef.current = false; }}
      style={{ borderCollapse: 'collapse', fontSize: '12px', outline: 'none', width: '100%' }} // MARKER_VATWATCHLISTOPS_EXCEL_GRID_TABLE_FULLWIDTH_V1 -- เดิมไม่มี width เลย ตารางเลยหดตามเนื้อหาไม่ยืดเต็ม Container ถ้า Column แคบรวมกันไม่ถึงขอบ
    >
      <thead>
        <tr style={{ background: '#1a3a5c' }}>
          {columns.map((col, c) => ( // MARKER_VATWATCHLISTOPS_EXCEL_GRID_EXTEND_WIRE_V1 MARKER_VATWATCHLISTOPS_EXCEL_GRID_NAV_V1 -- คลิก Header เลือกทั้ง Column
            <th key={col.key} onClick={() => setSelection({ r1: 0, c1: c, r2: rows.length - 1, c2: c })} style={{ padding: '8px 10px', color: 'white', fontWeight: '500', textAlign: isRightAlign(col.key) ? 'right' : 'left', position: 'sticky', top: 0, width: widthOf(col.key), whiteSpace: 'nowrap', cursor: 'pointer' }}>{col.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={columns.length} style={{ padding: '20px', textAlign: 'center', color: '#999' }}>{emptyText || 'ยังไม่มีข้อมูล'}</td></tr>
        ) : rows.map((row, r) => (
          <tr key={rowIdOf(row) || r} style={{ background: r % 2 === 0 ? 'white' : '#f7f9fb' }}>
            {columns.map((col, c) => {
              const selected = inSelection(r, c);
              const isEditing = editingCell && editingCell.r === r && editingCell.c === c;
              return (
                <td
                  key={col.key}
                  onMouseDown={(e) => { // MARKER_VATWATCHLISTOPS_EXCEL_GRID_FORMULA_PHASE2_V1 -- คลิก Cell อื่นระหว่างพิมพ์สูตร (ขึ้นต้นด้วย =) จะแทรก Reference D<แถว>/C<แถว> แทนการเปลี่ยน Selection ปกติ
                    const inFormulaRefMode = editingCell && editValue.trim().startsWith('=') && !(editingCell.r === r && editingCell.c === c);
                    if (inFormulaRefMode) {
                      e.preventDefault(); // กัน Input เดิมเสีย Focus ตอนคลิก Cell อื่น
                      if (col.key === 'debit' || col.key === 'credit') {
                        const refCode = (col.key === 'credit' ? 'C' : 'D') + (r + 1);
                        setEditValue((prev) => prev + refCode);
                      }
                      return;
                    }
                    isSelectingRef.current = true; setSelection({ r1: r, c1: c, r2: r, c2: c });
                  }}
                  onMouseEnter={() => { if (isSelectingRef.current) setSelection((prev) => (prev ? { ...prev, r2: r, c2: c } : { r1: r, c1: c, r2: r, c2: c })); }}
                  onDoubleClick={() => startEdit(r, c, String(row[col.key] ?? ''))}
                  onContextMenu={(e) => { // MARKER_VATWATCHLIST_MULTI_CONTEXTMENU_V1
                    const menuCfg = (cellContextMenus && cellContextMenus[col.key]) || ((cellContextMenuKey && col.key === cellContextMenuKey) ? { label: cellContextMenuLabel, options: cellContextMenuOptions } : null);
                    if (!menuCfg) return;
                    e.preventDefault();
                    setSelection({ r1: r, c1: c, r2: r, c2: c });
                    setCellCtxMenu({ x: e.clientX, y: e.clientY, r, c, key: col.key, label: menuCfg.label, options: menuCfg.options, tableColumns: menuCfg.tableColumns, tableRows: menuCfg.tableRows, valueKey: menuCfg.valueKey }); // MARKER_VATWATCHLIST_BRANCHCODE_TABLE_UPGRADE_V1
                  }}
                  style={{ // MARKER_VATWATCHLISTOPS_EXCEL_GRID_EXTEND_WIRE_V1
                    padding: '4px 6px',
                    borderTop: '0.5px solid #e8e8e8',
                    background: isEditing ? 'white' : selected ? '#d7e6f7' : 'transparent',
                    boxShadow: selected && !isEditing ? 'inset 0 0 0 1.5px #1a73e8' : 'none',
                    cursor: 'cell',
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                    width: widthOf(col.key),
                    textAlign: !isEditing && isRightAlign(col.key) ? 'right' : 'left',
                  }}
                >
                  {isEditing ? (
                    <input
                      autoFocus
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => stopEdit(true)}
                      style={{ width: '100%', boxSizing: 'border-box', border: 'none', outline: 'none', background: 'white', fontSize: '12px', fontFamily: 'inherit' }}
                    />
                  ) : displayValueOf(row, col)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
    {cellCtxMenu && (
      <div onMouseDown={(e) => e.stopPropagation()} style={{ position: 'fixed', top: cellCtxMenu.y, left: cellCtxMenu.x, background: 'white', border: '0.5px solid #ccc', borderRadius: '8px', boxShadow: '0 6px 16px rgba(0,0,0,0.18)', zIndex: 2000, minWidth: '190px', overflow: 'hidden', fontSize: '13px' }}>
        <div
          onClick={() => { setCellCtxPopupOpen(true); setCellCtxPopupSearch(''); }}
          style={{ padding: '9px 14px', cursor: 'pointer', color: '#1a3a5c' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#f0f4fa'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'white'; }}
        >
          {cellCtxMenu.label || 'Find'}
        </div>
      </div>
    )}
    {cellCtxMenu && !cellCtxPopupOpen && (
      <div style={{ position: 'fixed', inset: 0, zIndex: 1999 }} onMouseDown={() => setCellCtxMenu(null)} />
    )}
    {cellCtxPopupOpen && cellCtxMenu && (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 2001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onMouseDown={(e) => { if (e.target === e.currentTarget) { setCellCtxPopupOpen(false); setCellCtxMenu(null); } }}>
        <div style={{ background: 'white', borderRadius: '10px', width: cellCtxMenu.tableColumns ? '760px' : '420px', maxHeight: '70vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' }}>
          <div style={{ padding: '12px 16px', borderBottom: '0.5px solid #e8e8e8', fontSize: '13px', fontWeight: 500, color: '#1a3a5c' }}>{cellCtxMenu.label || 'เลือกค่า'}</div>
          <div style={{ padding: '10px 16px' }}>
            <input autoFocus value={cellCtxPopupSearch} onChange={(e) => setCellCtxPopupSearch(e.target.value)}
              placeholder="ค้นหา..." style={{ width: '100%', height: '32px', boxSizing: 'border-box', border: '0.5px solid #ccc', borderRadius: '6px', padding: '0 10px', fontSize: '12px', outline: 'none' }} />
          </div>
          <div style={{ overflowY: 'auto', flex: 1, padding: '0 8px 8px' }}>
            {cellCtxMenu.tableColumns ? ( // MARKER_VATWATCHLIST_BRANCHCODE_TABLE_UPGRADE_V1
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr>
                    {cellCtxMenu.tableColumns.map((tc) => (
                      <th key={tc.key} style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #ddd', position: 'sticky', top: 0, background: '#1a3a5c', color: 'white', fontWeight: 500 }}>{tc.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(cellCtxMenu.tableRows || []).filter((trow) => cellCtxMenu.tableColumns.some((tc) => String(trow[tc.key] ?? '').toLowerCase().includes(cellCtxPopupSearch.toLowerCase()))).map((trow, tidx) => (
                    <tr key={tidx}
                      onClick={() => {
                        const targetRow = rows[cellCtxMenu.r];
                        if (targetRow) onCommitCell(targetRow, cellCtxMenu.key, trow[cellCtxMenu.valueKey]);
                        setCellCtxPopupOpen(false);
                        setCellCtxMenu(null);
                      }}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#f0f4fa'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      {cellCtxMenu.tableColumns.map((tc) => { // MARKER_VATWATCHLIST_BRANCHCODE_TABLE_COLORS_V1
                        if (tc.key === 'status') {
                          const statusVal = String(trow[tc.key] ?? '').trim();
                          const statusLower = statusVal.toLowerCase();
                          const statusColors = statusLower.includes('active') ? { bg: '#e6f4ea', fg: '#1e7e34' }
                            : statusLower.includes('closed') ? { bg: '#fde8e8', fg: '#c0392b' }
                            : statusLower.includes('temporar') ? { bg: '#fff8e1', fg: '#a67c00' }
                            : { bg: 'transparent', fg: '#333' };
                          return (
                            <td key={tc.key} style={{ padding: '6px 8px', borderBottom: '0.5px solid #f0f0f0' }}>
                              <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: '10px', fontSize: '11px', fontWeight: 500, background: statusColors.bg, color: statusColors.fg }}>{statusVal || '—'}</span>
                            </td>
                          );
                        }
                        return <td key={tc.key} style={{ padding: '6px 8px', borderBottom: '0.5px solid #f0f0f0', color: '#333' }}>{trow[tc.key] ?? ''}</td>;
                      })}
                    </tr>
                  ))}
                  {(cellCtxMenu.tableRows || []).length === 0 && (
                    <tr><td colSpan={cellCtxMenu.tableColumns.length} style={{ padding: '20px', textAlign: 'center', color: '#999' }}>ไม่มีข้อมูล</td></tr>
                  )}
                </tbody>
              </table>
            ) : (
              <>
                {(cellCtxMenu.options || []).filter((opt) => String(opt).toLowerCase().includes(cellCtxPopupSearch.toLowerCase())).map((opt) => (
                  <div key={opt}
                    onClick={() => {
                      const targetRow = rows[cellCtxMenu.r];
                      if (targetRow) onCommitCell(targetRow, cellCtxMenu.key, opt);
                      setCellCtxPopupOpen(false);
                      setCellCtxMenu(null);
                    }}
                    style={{ padding: '8px 10px', fontSize: '12px', cursor: 'pointer', borderRadius: '5px', color: '#333' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#f0f4fa'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    {opt}
                  </div>
                ))}
                {(cellCtxMenu.options || []).length === 0 && (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#999', fontSize: '12px' }}>ไม่มีข้อมูล</div>
                )}
              </>
            )}
          </div>
          <div style={{ padding: '10px 16px', borderTop: '0.5px solid #e8e8e8', textAlign: 'right' }}>
            <button onClick={() => { setCellCtxPopupOpen(false); setCellCtxMenu(null); }} style={{ padding: '6px 14px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '6px', background: 'white', cursor: 'pointer' }}>ปิด</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

function VatSimpleInputReportPanel({ bu }) {
  // MARKER_VATWATCHLISTOPS_SIMPLE_INPUT_REPORT_METADATA_V1
  const { branches } = useVatSupportingData();
  const [companyBook, setCompanyBook] = React.useState('');
  const [periodMonth, setPeriodMonth] = React.useState(null); // 'YYYY-MM'
  React.useEffect(() => {
    if (!bu) return;
    apiFetch('/company_list').then((list) => {
      const found = Array.isArray(list) ? list.find((c) => c.bu === bu) : null;
      setCompanyBook(found?.BOOK || '');
    }).catch(() => setCompanyBook(''));
    apiFetch('/vat/period/status').then((ps) => {
      setPeriodMonth(ps?.vat_period_current_month || null);
    }).catch(() => setPeriodMonth(null));
  }, [bu]);
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [activeGroupKey, setActiveGroupKey] = React.useState(null);
  const [selectedRowId, setSelectedRowId] = React.useState(null); // MARKER_VATWATCHLISTOPS_SIMPLEINPUT_REPORT_EDITABLE_ZONE_V1 -- แถวที่กำลังเลือกอยู่ (Zone บนผูกกับแถวนี้)
  // MARKER_VATWATCHLIST_EXPENSETYPE_CONTEXTMENU_V1
  const [smCodeListForExpenseType, setSmCodeListForExpenseType] = React.useState([]);
  React.useEffect(() => {
    apiFetch('/sm_code_list').then((res) => setSmCodeListForExpenseType(Array.isArray(res) ? res : [])).catch(() => setSmCodeListForExpenseType([]));
  }, []);
  const expenseTypeOptions = React.useMemo(() =>
    [...new Set(smCodeListForExpenseType.map((i) => String(i['Expense Type'] ?? '').trim()).filter(Boolean))].sort(),
  [smCodeListForExpenseType]);
  // MARKER_VATWATCHLIST_BRANCHCODE_TABLE_UPGRADE_V1
  const branchTableRows = React.useMemo(() => {
    const seen = new Set();
    return (branches || [])
      .filter((b) => b.bu === bu)
      .filter((b) => !String(b['Simple Brand Code'] ?? '').toLowerCase().includes('notfound'))
      .filter((b) => {
        const key = String(b['Branch Code'] ?? '').trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b2) => String(a['Branch Code'] ?? '').localeCompare(String(b2['Branch Code'] ?? ''), undefined, { numeric: true }));
  }, [branches, bu]);

  const fetchSimpleInputRows = React.useCallback(() => { // MARKER_VATWATCHLISTOPS_SIMPLEINPUT_REPORT_EDITABLE_ZONE_V1 -- แยกเป็น Function เรียกซ้ำได้ (ใช้ตอน Broadcast ด้วย)
    if (!bu) return;
    setLoading(true);
    // MARKER_VATWATCHLIST_UPLOADFILEDETAIL_STATUS_FILTER_V1
    return apiFetch(`/vat_simpleinputdraft?eq_bu=${encodeURIComponent(bu)}&eq_status=draft`)
      .then((res) => setRows(Array.isArray(res) ? res : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [bu]);

  // MARKER_VATWATCHLISTOPS_SIMPLE_INPUT_REPORT_BUFIX_V1 -- bu เป็น String ตรงๆ ไม่ใช่ Object
  React.useEffect(() => {
    fetchSimpleInputRows();
  }, [fetchSimpleInputRows]);

  React.useEffect(() => { // MARKER_VATWATCHLISTOPS_SIMPLEINPUT_REPORT_EDITABLE_ZONE_V1 -- รับ Broadcast Sync ตอน Session อื่นแก้ไข
    const unsubscribe = subscribeWs(['vat_simpleinputdraft_updated'], (payload) => {
      if (!payload || payload.bu !== bu) return;
      fetchSimpleInputRows();
    });
    return unsubscribe;
  }, [bu, fetchSimpleInputRows]);
  // MARKER_VATWATCHLIST_REALTIME_SUBSCRIBE_V1
  React.useEffect(() => {
    const unsubscribeExport = subscribeWs(['vat_export_updated'], (payload) => {
      if (payload?.buList && !payload.buList.includes(bu)) return;
      fetchSimpleInputRows();
    });
    return unsubscribeExport;
  }, [bu, fetchSimpleInputRows]);

  // ── สร้างกลุ่มตาม (invoice_ref + type_sim) ไม่ซ้ำกัน ──────────────
  const groups = React.useMemo(() => {
    const map = new Map();
    rows.forEach((r) => {
      const invRef = r.invoice_ref || '(ไม่ระบุ)';
      const typeSim = r.type_sim || '(ไม่ระบุ)';
      const key = `${invRef}_${typeSim}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    });
    return [...map.entries()].map(([key, groupRows]) => ({ key, rows: groupRows }));
  }, [rows]);

  React.useEffect(() => {
    if (groups.length > 0 && !groups.some((g) => g.key === activeGroupKey)) {
      setActiveGroupKey(groups[0].key);
    }
    if (groups.length === 0) setActiveGroupKey(null);
  }, [groups, activeGroupKey]);

  const activeGroup = groups.find((g) => g.key === activeGroupKey);
  const displayRows = activeGroup ? activeGroup.rows : [];

  React.useEffect(() => { // MARKER_VATWATCHLISTOPS_SIMPLEINPUT_REPORT_EDITABLE_ZONE_V1 -- Reset แถวที่เลือกกลับเป็นแถวแรกทุกครั้งที่สลับ Tab
    setSelectedRowId(displayRows[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroupKey]);

  const activeRow = displayRows.find((r) => r.id === selectedRowId) || displayRows[0] || {}; // MARKER_VATWATCHLISTOPS_SIMPLEINPUT_REPORT_EDITABLE_ZONE_V1 -- แถวที่ Zone บนผูกอยู่จริง

  const handleUpdateSimpleInputField = async (fieldUpdates) => { // MARKER_VATWATCHLISTOPS_SIMPLEINPUT_REPORT_EDITABLE_ZONE_V1 -- Save แก้ไขกลับ DB + Broadcast
    if (!activeRow?.id) return;
    try {
      await apiFetch(`/vat_simpleinputdraft/${activeRow.id}`, { method: 'PUT', body: JSON.stringify(fieldUpdates) });
      setRows((prev) => prev.map((r) => (r.id === activeRow.id ? { ...r, ...fieldUpdates } : r)));
      broadcastWs('vat_simpleinputdraft_updated', { bu });
    } catch (err) {
      console.error('handleUpdateSimpleInputField error:', err);
      alert('บันทึกไม่สำเร็จ กรุณาลองใหม่');
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', minHeight: 0 }}>
      {/* MARKER_VATWATCHLISTOPS_SIMPLE_INPUT_REPORT_TABSOUTSIDE_V1 */}
      {/* ── Tab (invoice_ref + type_sim) — อยู่เหนือ Zone บนทั้งหมด (Style เดียวกับ Tab หลัก) ── */}
      {groups.length > 0 && (
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', borderBottom: '0.5px solid #e8e8e8' }}>
          {groups.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => setActiveGroupKey(g.key)}
              style={{ padding: '8px 16px', fontSize: '12.5px', border: 'none', borderRadius: '8px 8px 0 0', borderBottom: activeGroupKey === g.key ? '3px solid #1a3a5c' : '3px solid transparent', background: activeGroupKey === g.key ? '#eaf0f6' : 'transparent', cursor: 'pointer', color: activeGroupKey === g.key ? '#1a3a5c' : '#888', fontWeight: activeGroupKey === g.key ? '500' : '400' }} // MARKER_VATWATCHLISTOPS_ZONEBN_LABEL_REMOVE_TAB_COLORB_V1
            >{g.key} ({g.rows.length})</button>
          ))}
        </div>
      )}
      {/* ── Zone บน (35%) — Metadata ตาม Format Simple Excel จริง ── */}
      <div style={{ ...vatWatchlistZoneStyle, flex: '0 0 auto', overflow: 'auto', alignItems: 'flex-start', justifyContent: 'flex-start' }}> {/* MARKER_VATWATCHLISTOPS_SIMPLEINPUT_ZONEBN_LEFTALIGN_V1 MARKER_VATWATCHLISTOPS_SIMPLEINPUT_ZONEBN_AUTOHEIGHT_V1 -- เปลี่ยนจากสัดส่วน 35% คงที่ เป็น Auto-Height ตามเนื้อหาจริง กันไม่ให้ต้อง Scroll */}
        {loading ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#999', fontSize: '13px' }}>กำลังโหลด...</div>
        ) : groups.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#999', fontSize: '13px' }}>ยังไม่มีข้อมูล</div>
        ) : (() => { // MARKER_VATWATCHLISTOPS_SIMPLEINPUT_REPORT_EDITABLE_TABLE_CELLS_V1 -- กลับเป็น Read-only ทั้งหมด (ย้ายจุดแก้ไขไปตารางล่างแทน)
          const firstRow = activeGroup?.rows?.[0] || {};
          const t = firstRow.type_sim || '';
          const ynLabel = (ch) => (ch === 'Y' ? 'Yes' : 'No');
          const companyRow = branches.find((b) => b.bu === bu);
          const simpleCompany = companyRow?.['Simple Company'] || '';
          const now = new Date();
          const yy = String(now.getFullYear()).slice(-2);
          const mm = String(now.getMonth() + 1).padStart(2, '0');
          const dd = String(now.getDate()).padStart(2, '0');
          const fileName = `${companyBook}INPUTVAT_${yy}${mm}${dd}`;
          const MONTH_ABBR = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
          let periodDisplay = '';
          if (periodMonth) {
            const [py, pm] = periodMonth.split('-');
            periodDisplay = `${MONTH_ABBR[parseInt(pm, 10) - 1]}-${String(py).slice(-2)}`;
          }
          const metaRows = [
            ['Excel File AP Invoice Upload', fileName],
            ['Company', simpleCompany],
            ['Department', 'APN'],
            ['Function', 'APN'],
            ['Invoice Type', firstRow.invoice_ref || ''],
            ['Create Journal', ynLabel(t[0])],
            ['Interbranch', ynLabel(t[1])],
            ['Book VAT Only', ynLabel(t[2])],
            ['Liability Branch', ''],
            ['Liability Cost Center', ''],
            ['Liability Account', ''],
            ['Liability Sub Account', ''],
            ['Period', periodDisplay],
          ];
          return (
            <table style={{ fontSize: '12.5px', borderCollapse: 'collapse' }}>
              <tbody>
                {metaRows.map(([label, value]) => (
                  <tr key={label}>
                    <td style={{ padding: '4px 14px 4px 16px', fontWeight: '600', color: 'white', background: '#1a3a5c', minWidth: '220px' }}>{label}</td>
                    <td style={{ padding: '4px 14px' }}>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
        })()}
      </div>
      {/* ── Zone ล่าง (65%) — Draft Table กรองตาม Tab บนที่เลือก ── */}
      <div style={{ flex: '1 1 0%', border: '0.5px solid #e8e8e8', borderRadius: '10px', overflow: 'auto', display: 'flex', flexDirection: 'column' }}> {/* MARKER_VATWATCHLISTOPS_SIMPLEINPUT_ZONEBN_AUTOHEIGHT_V1 -- เดิม 65% คงที่ เปลี่ยนเป็นรับพื้นที่ที่เหลือทั้งหมดแทน Zone บนที่ Auto-Height แล้ว */}
        <div style={{ overflow: 'auto', flex: 1 }}> {/* MARKER_VATWATCHLISTOPS_EXCEL_STYLE_GRID_V1 -- ใช้ ExcelStyleGrid แทน Table เดิม */}
          <ExcelStyleGrid
            columns={VAT_SIMPLE_INPUT_COLUMNS}
            rows={displayRows}
            emptyText="ยังไม่มีข้อมูล Draft"
            rightAlignKeys={new Set(['amount_ex_vat', 'vat_amount'])} // MARKER_VATWATCHLISTOPS_SIMPLEINPUT_GRID_NUMERIC_FORMAT_V1
            cellContextMenus={{ // MARKER_VATWATCHLIST_BRANCHCODE_TABLE_UPGRADE_V1
              expense_type: { label: 'Find - Expense Type', options: expenseTypeOptions },
              branch_code: {
                label: 'Find - Branch Code',
                valueKey: 'Simple Brand Code',
                tableColumns: [
                  { key: 'Branch Code', label: 'Branch Code' },
                  { key: 'Company for Show in Report Display', label: 'Company for Show in Report Display' },
                  { key: 'Simple Brand Code', label: 'Simple Brand Code' },
                  { key: 'status', label: 'Status' },
                ],
                tableRows: branchTableRows,
              },
            }}
            formatCell={(row, col) => { // MARKER_VATWATCHLIST_SIMPLEINPUT_DATE_FORMAT_V1
              if (col.key === 'amount_ex_vat' || col.key === 'vat_amount') {
                const n = Number(row[col.key]);
                return row[col.key] != null && !Number.isNaN(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
              }
              if (col.key === 'receive_date' || col.key === 'tax_invoice_date') {
                const raw = row[col.key];
                if (!raw) return '';
                const parts = String(raw).slice(0, 10).split('-');
                if (parts.length !== 3) return raw;
                const [y, m, d] = parts;
                const monthAbbr = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][parseInt(m, 10) - 1] || m;
                return `${d}-${monthAbbr}-${y.slice(-2)}`;
              }
              return row[col.key] ?? '';
            }}
            onCommitCell={(row, key, value) => {
              apiFetch(`/vat_simpleinputdraft/${row.id}`, { method: 'PUT', body: JSON.stringify({ [key]: value }) })
                .then(() => {
                  setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, [key]: value } : r)));
                  broadcastWs('vat_simpleinputdraft_updated', { bu });
                })
                .catch((err) => { console.error('Update field error:', err); alert('บันทึกไม่สำเร็จ กรุณาลองใหม่'); });
            }}
          />
        </div>
      </div>
    </div>
  );
}

// MARKER_VATWATCHLISTOPS_ADI_UPLOAD_REPORT_PANEL_V1
// ── Column ตาม Schema vat_adi_transferdraft จริง (Key ตรงกับ ADI_DRAFT_COLUMNS ใน Draft Monitor) ──
const VAT_ADI_UPLOAD_COLUMNS = [
  { key: 'category', label: 'Category' },
  { key: 'source', label: 'Source' },
  { key: 'acc_date', label: 'Acc Date' },
  { key: 'bus', label: 'Bus' },
  { key: 'grp', label: 'Grp' },
  { key: 'com', label: 'Com' },
  { key: 'branch', label: 'Branch' },
  { key: 'cpc', label: 'CPC' },
  { key: 'acc', label: 'Acc' },
  { key: 'sub_acc', label: 'Sub_Acc' },
  { key: 'debit', label: 'Debit' },
  { key: 'credit', label: 'Credit' },
  { key: 'adi_period', label: 'Period' },
  { key: 'batch_name', label: 'Batch Name' },
  { key: 'batch_description', label: 'Batch Description' },
  { key: 'journal_name', label: 'Journal Name' },
  { key: 'journal_description', label: 'Journal Description' },
  { key: 'line_description', label: 'Line Description' },
  { key: 'line_dff', label: 'Line DFF' },
];

const VAT_ADI_UPLOAD_TABLE_COLUMNS = VAT_ADI_UPLOAD_COLUMNS.filter((c) => // MARKER_VATWATCHLISTOPS_ADI_UPLOAD_HIDE_LINEDFF_WIDTH_V1 -- ซ่อน Column ที่ซ้ำกับ Metadata Zone ด้านบนแล้ว + Line DFF (ไม่ค่อยได้ใช้)
  !['category', 'source', 'adi_period', 'batch_name', 'batch_description', 'journal_name', 'journal_description', 'line_dff'].includes(c.key)
);
// MARKER_VATWATCHLISTOPS_ADI_UPLOAD_COLUMN_WIDTH_NUMERIC_V1 -- ความกว้าง px คงที่พอดีเนื้อหาจริงต่อ Column แคบๆ Line Description กว้างสุด ไม่ Wrap (Scroll แนวนอนแทน)
const VAT_ADI_UPLOAD_COLUMN_WIDTHS = {
  acc_date: '80px',
  bus: '40px',
  grp: '40px',
  com: '50px',
  branch: '70px',
  cpc: '60px',
  acc: '80px',
  sub_acc: '70px',
  debit: '90px',
  credit: '90px',
  // MARKER_VATWATCHLISTOPS_ADI_UPLOAD_DESCRIPTION_FLEX_WIDTH_V1 -- line_description ไม่กำหนดความกว้างตายตัว ให้กินพื้นที่ที่เหลือทั้งหมดแทน (ตกไปใช้ 'auto' จาก || Fallback)
};

function VatAdiUploadReportPanel({ bu }) { // MARKER_VATWATCHLISTOPS_ADI_UPLOAD_BATCH_TAB_JOURNAL_DROPDOWN_V1 -- Tab=Batch Name + Dropdown Filter Journal (All/เฉพาะ) + Metadata Zone
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [activeBatchKey, setActiveBatchKey] = React.useState(null);
  const [journalFilter, setJournalFilter] = React.useState('__all__');
  const [searchQuery, setSearchQuery] = React.useState('');

  const fetchAdiRows = React.useCallback(() => {
    if (!bu) return;
    setLoading(true);
    return apiFetch(`/vat_adi_transferdraft?eq_bu=${encodeURIComponent(bu)}&eq_status=draft`)
      .then((res) => setRows(Array.isArray(res) ? res : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [bu]);
  React.useEffect(() => { fetchAdiRows(); }, [fetchAdiRows]);
  // MARKER_VATWATCHLIST_REALTIME_SUBSCRIBE_V1
  React.useEffect(() => {
    const unsubscribe = subscribeWs(['vat_export_updated'], (payload) => {
      if (payload?.buList && !payload.buList.includes(bu)) return;
      fetchAdiRows();
    });
    return unsubscribe;
  }, [bu, fetchAdiRows]);

  // ── Tab ตาม Batch Name ไม่ซ้ำกัน ──
  const batches = React.useMemo(() => {
    const map = new Map();
    rows.forEach((r) => {
      const key = r.batch_name || '(ไม่ระบุ)';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    });
    return [...map.entries()].map(([key, batchRows]) => ({ key, rows: batchRows }));
  }, [rows]);

  React.useEffect(() => {
    if (batches.length > 0 && !batches.some((b) => b.key === activeBatchKey)) {
      setActiveBatchKey(batches[0].key);
    }
    if (batches.length === 0) setActiveBatchKey(null);
  }, [batches, activeBatchKey]);

  React.useEffect(() => { setJournalFilter('__all__'); }, [activeBatchKey]); // Reset Filter Journal ทุกครั้งที่สลับ Batch

  const activeBatchGroup = batches.find((b) => b.key === activeBatchKey);
  const batchRows = activeBatchGroup ? activeBatchGroup.rows : [];

  const journalOptions = React.useMemo(() => {
    const set = new Set(batchRows.map((r) => r.journal_name || '(ไม่ระบุ)'));
    return [...set];
  }, [batchRows]);

  const journalRows = journalFilter === '__all__'
    ? batchRows
    : batchRows.filter((r) => (r.journal_name || '(ไม่ระบุ)') === journalFilter);

  const firstRow = journalRows[0] || {}; // MARKER_VATWATCHLISTOPS_ADI_UPLOAD_BATCH_TAB_JOURNAL_DROPDOWN_V1 -- All = แถวแรกของ Batch, เลือกเฉพาะ Journal = แถวแรกของ Journal นั้น

  const filteredRows = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return journalRows;
    return journalRows.filter((r) => VAT_ADI_UPLOAD_TABLE_COLUMNS.some((c) => String(r[c.key] ?? '').toLowerCase().includes(q)));
  }, [journalRows, searchQuery]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', minHeight: 0 }}>
      {batches.length > 0 && (
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', borderBottom: '0.5px solid #e8e8e8' }}>
          {batches.map((b) => (
            <button
              key={b.key}
              type="button"
              onClick={() => setActiveBatchKey(b.key)}
              style={{ padding: '8px 16px', fontSize: '12.5px', border: 'none', borderRadius: '8px 8px 0 0', borderBottom: activeBatchKey === b.key ? '3px solid #1a3a5c' : '3px solid transparent', background: activeBatchKey === b.key ? '#eaf0f6' : 'transparent', cursor: 'pointer', color: activeBatchKey === b.key ? '#1a3a5c' : '#888', fontWeight: activeBatchKey === b.key ? '500' : '400' }}
            >{b.key} ({b.rows.length})</button>
          ))}
        </div>
      )}
      <div style={{ ...vatWatchlistZoneStyle, flex: '0 0 auto', overflow: 'auto', alignItems: 'flex-start', justifyContent: 'flex-start' }}> {/* MARKER_VATWATCHLISTOPS_ADI_UPLOAD_JOURNAL_DROPDOWN_INLINE_V1 -- Dropdown ย้ายเข้าไปในแถว Journal name แล้ว ลบกล่องแยกด้านบนออก */}
        {loading ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#999', fontSize: '13px' }}>กำลังโหลด...</div>
        ) : (() => { // MARKER_VATWATCHLISTOPS_ADI_UPLOAD_KEEP_METALAYOUT_EMPTY_V1 -- โชว์กรอบ Metadata ค้างไว้เสมอ (ค่าว่าง) แทนข้อความ "ยังไม่มีข้อมูล" -- firstRow/journalOptions Default ปลอดภัยอยู่แล้ว
          const metaRows = [ // MARKER_VATWATCHLISTOPS_ADI_UPLOAD_JOURNAL_DROPDOWN_INLINE_V1 -- Journal name ใช้ Dropdown จริง ไม่ใช่ Text ธรรมดา
            ['Category', firstRow.category || '', false],
            ['Source', firstRow.source || '', false],
            ['Batch name', firstRow.batch_name || '', false],
            ['Journal name', null, true],
            ['Period', firstRow.adi_period || '', false],
          ];
          return (
            <table style={{ fontSize: '12.5px', borderCollapse: 'collapse' }}>
              <tbody>
                {metaRows.map(([label, value, isJournalDropdown]) => (
                  <tr key={label}>
                    <td style={{ padding: '4px 14px 4px 16px', fontWeight: '600', color: 'white', background: '#1a3a5c', minWidth: '220px' }}>{label}</td>
                    <td style={{ padding: '4px 14px' }}>
                      {isJournalDropdown ? (
                        <select
                          value={journalFilter}
                          onChange={(e) => setJournalFilter(e.target.value)}
                          style={{ padding: 0, fontSize: '12.5px', fontFamily: 'inherit', color: 'inherit', border: 'none', background: 'transparent', cursor: 'pointer', appearance: 'auto' }}
                        >
                          <option value="__all__">(All)</option>
                          {journalOptions.map((j) => (
                            <option key={j} value={j}>{j}</option>
                          ))}
                        </select>
                      ) : value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
        })()}
      </div>
      <div style={{ minHeight: '44px', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="ค้นหา..."
          style={{ padding: '6px 12px', fontSize: '12.5px', border: '0.5px solid #ccc', borderRadius: '8px', width: '280px' }}
        />
      </div>
      <div style={{ flex: '1 1 0%', width: '100%', border: '0.5px solid #e8e8e8', borderRadius: '10px', overflow: 'auto', display: 'flex', flexDirection: 'column' }}> {/* MARKER_VATWATCHLISTOPS_ADI_UPLOAD_FULLWIDTH_WRAPPER_V1 -- บังคับ width 100% กันไม่ยืดเต็ม Container */}
        <div style={{ overflow: 'auto', flex: 1, width: '100%' }}> {/* MARKER_VATWATCHLISTOPS_EXCEL_GRID_EXTEND_WIRE_V1 -- ใช้ ExcelStyleGrid แทน Table เดิม (คง Format/Width/Alignment เดิมไว้ครบ) */}
          <ExcelStyleGrid
            columns={VAT_ADI_UPLOAD_TABLE_COLUMNS}
            rows={filteredRows}
            emptyText="ยังไม่มีข้อมูล"
            columnWidths={VAT_ADI_UPLOAD_COLUMN_WIDTHS}
            rightAlignKeys={new Set(['debit', 'credit'])}
            formatCell={(row, col) => {
              if (col.key === 'acc_date') return formatDateDDMMMYY(row[col.key]) || '';
              if (col.key === 'debit' || col.key === 'credit') {
                const n = Number(row[col.key]);
                return row[col.key] != null && !Number.isNaN(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
              }
              return row[col.key] ?? '';
            }}
            onCommitCell={(row, key, value) => {
              apiFetch(`/vat_adi_transferdraft/${row.id}`, { method: 'PUT', body: JSON.stringify({ [key]: value }) })
                .then(() => setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, [key]: value } : r))))
                .catch((err) => { console.error('Update ADI field error:', err); alert('บันทึกไม่สำเร็จ กรุณาลองใหม่'); });
            }}
          />
        </div>
      </div>
    </div>
  );
}

function VatInputRecPage() { // MARKER_VATCONTROLLER_MOUNT_DASHBOARD_V1
  return <VatReconcileDashboard />; // Dashboard เขียน Title "Input Vat Rec." ไว้ในตัวเองแล้ว
}

export default function VatController({ activeSubTab = 'vat-watchlist-ops', onSubTabChange }) {
  if (activeSubTab === 'vat-watchlist-ops') {
    return <VatWatchlistOpsLobby />;
  }
  if (activeSubTab === 'vat-upload-file') { // MARKER_VATWATCHLISTOPS_UPLOAD_FILE_LOBBY_V1
    return <VatUploadFileLobby />;
  }
  if (activeSubTab === 'vat-input-rec') { // MARKER_VATCONTROLLER_MOUNT_INPUT_VAT_REC_V1
    return <VatInputRecPage />;
  }
  const title = VAT_MENU_LABEL_MAP[activeSubTab] || 'VAT Controller';
  return <PlaceholderPage title={title} />;
}