// ══════════════════════════════════════════════════════════════════════════
// menuConfig.js — Single source of truth สำหรับโครงสร้างเมนูทั้งระบบ
// ══════════════════════════════════════════════════════════════════════════
// ไฟล์นี้ export โครงสร้างเมนูกลางที่ทั้ง App.js (Sidebar/Flyout) และ
// UserManagement.js (หน้า Selective Maintenance) import ไปใช้ร่วมกัน
//
// เพิ่มเมนูย่อยใหม่ครั้งต่อไป: แก้แค่ตรงนี้ที่เดียว (เพิ่ม 1 object ใน
// groups[].items ของเมนูที่เกี่ยวข้อง) — Flyout ใน Sidebar และหน้า
// Selective Maintenance จะเห็นเมนูใหม่พร้อมกันอัตโนมัติ ไม่ต้องไปแก้ 2 ที่
// ══════════════════════════════════════════════════════════════════════════

// ── เมนูหลักระดับบนสุด (ใช้ทำ Sidebar top-level nav + permission filter) ──
export const ALL_FUNCTION_MENUS = [
  { id: 'ap-gr',          icon: '🧾', label: 'AP Controller',   permKey: 'Manual' },
  { id: 'vat-controller', icon: '💹', label: 'VAT Controller',  permKey: 'VAT'    },
  { id: 'i-expense',      icon: '💸', label: 'I-Expense',       permKey: 'IE'     },
  { id: 'gl-functional',  icon: '📊', label: 'GL Functional',   permKey: 'GL'     },
  { id: 'i-pro-interface',icon: '🔗', label: 'I-Pro Interface', permKey: 'I-Pro'  },
];

// ── AP Controller: เมนูย่อยแบ่งเป็นกลุ่ม (ใช้สร้าง Flyout) ────────────────
export const AP_CONTROLLER_MENU = {
  id: 'ap-controller', icon: '🧾', label: 'AP Controller', color: '#E6F1FB',
  groups: [
    { label: 'Invoice Entry', icon: '📥', items: [
      { id: 'ap-gr',   icon: '📋', label: 'AP Manual' },
      { id: 'ap-ocr',  icon: '🔍', label: 'Invoice OCR' },
      { id: 'ap-form', icon: '📝', label: 'Purchase Order' },
    ]},
    { label: 'จัดการ', icon: '🗂️', items: [
      { id: 'ap-drafts', icon: '📄', label: 'Invoice History' },
      { id: 'ap-batchctrl', icon: '📊', label: 'Batch Control' }, // MARKER_MENUCONFIG_ADD_BATCHCTRL
    ]},
  ],
};

// ── VAT Controller: เมนูย่อยแบ่งเป็นกลุ่ม (ใช้สร้าง Flyout) ───────────────
// MARKER_VAT_MENU_RESTRUCTURE_V2 — 4 กลุ่ม: OPERATION / RECONCILE / RESULTS / BACKUP
export const VAT_CONTROLLER_MENU = {
  id: 'vat-controller', icon: '💹', label: 'VAT Controller', color: '#EAF3DE',
  groups: [
    { label: 'Operation', icon: '⚙️', items: [
      { id: 'vat-watchlist-ops',      icon: '📋', label: 'VAT Watchlist Ops.' },
      { id: 'vat-reconcile-ap01-05',  icon: '🔄', label: 'VAT Reconcile AP01-AP05' },
      { id: 'vat-simple-input-ops',   icon: '📝', label: 'VAT Simple Input Ops.' },
    ]},
    { label: 'Reconcile', icon: '🔗', items: [
      { id: 'vat-input-rec',           icon: '📥', label: 'Input Vat Rec.' },
      { id: 'vat-suspense-rec',        icon: '⏳', label: 'Suspense Vat Rec.' },
      { id: 'vat-direct-debit-recon',  icon: '🏦', label: 'VAT Direct Debit Recon.' },
      { id: 'vat-timeline',            icon: '📆', label: 'Timeline' },
    ]},
    { label: 'Results', icon: '📊', items: [
      { id: 'vat-dashboard',    icon: '📊', label: 'Dashboard' },
      { id: 'vat-freeze',       icon: '🧊', label: 'Freeze' }, // MARKER_MENU_VAT_FREEZE_V1
      { id: 'vat-upload-file',  icon: '📤', label: 'Upload file' },
      { id: 'vat-monthly-report', icon: '🗓️', label: 'Monthly Report' },
    ]},
    { label: 'Backup', icon: '🗄️', items: [
      { id: 'vat-backup-transaction',  icon: '💳', label: 'Transaction' },
      { id: 'vat-backup-tax-invoice',  icon: '🧾', label: 'Tax Invoice' },
    ]},
  ],
};

// ── Tab ภายในหน้า "Upload file" (จัดการ state ในตัว Component เอง ────────
// ── ไม่ใช่ Flyout Menu — เก็บไว้ที่นี่เพื่อให้เห็นภาพรวมทั้งหมดในไฟล์เดียว) ─
export const VAT_UPLOAD_FILE_TABS = [ // MARKER_MENUCONFIG_REMOVE_DATALOAD_V1 -- เอา DataLoad ออก เหลือ 3 Tab
  { id: 'popvat-report',       label: 'Popvat Report' },
  { id: 'simple-input-report', label: 'Simple Input Report' },
  { id: 'adi-upload',          label: 'ADI Upload' },
];

// ── IE Controller: Clone โครงสร้างจาก AP_CONTROLLER_MENU -- ตัด "Invoice OCR",
// "Purchase Order", "Batch Control" ออกทั้งหมด (Confirm แล้วว่า IE ยังไม่ต้องมี)
export const IE_CONTROLLER_MENU = {
  id: 'ie-controller', icon: '💸', label: 'I-Expense', color: '#FAEEDA',
  groups: [
    { label: 'Invoice Entry', icon: '📥', items: [
      { id: 'ie-gr', icon: '📋', label: 'IE Manual' },
    ]},
    { label: 'จัดการ', icon: '🗂️', items: [
      { id: 'ie-drafts', icon: '📄', label: 'Invoice History' },
      // ไม่มี Batch Control ตามที่สั่งไว้ (ยังไม่ Clone มา)
    ]},
    { label: 'Reconcile', icon: '🔗', items: [ // MARKER_IE_MENU_RECONCILE_GROUP_V1
      { id: 'ie-generate-macro-logic', icon: '⚙️', label: 'Generate by Macro Logic' },
    ]},
  ],
};

// ── GL Functional: เมนูย่อยแบ่งเป็นกลุ่ม (ใช้สร้าง Flyout) ──────────────
// MARKER_GL_FUNCTIONAL_MENU_V1 — เริ่มจากกลุ่ม Reconcile, เมนูแรก = Account Payable Recon.
export const GL_FUNCTIONAL_MENU = {
  id: 'gl-functional', icon: '📊', label: 'GL Functional', color: '#EEEDFE',
  groups: [
    { label: 'Reconcile', icon: '🔗', items: [
      { id: 'gl-ap-recon', icon: '🧾', label: 'Account Payable Recon.', requiredPermissions: ['Manual', 'IE', 'I-Pro'] }, // MARKER_GL_ITEM_PERMISSIONS_V1
    ]},
  ],
};

// ── เมนูที่ยังไม่มี submenu ย่อย (เป็น placeholder หน้าเดียว) ─────────────
export const SIMPLE_FUNCTION_MENUS = [
  { id: 'i-pro-interface', icon: '🔗', label: 'I-Pro Interface', color: '#FAECE7' },
];

// ── รวมทุกเมนูเป็นโครงสร้างเดียว สำหรับหน้า Selective Maintenance ────────
// ── (สร้างจาก AP_CONTROLLER_MENU/VAT_CONTROLLER_MENU/SIMPLE_FUNCTION_MENUS ─
// ── โดยอัตโนมัติ — ไม่ต้องพิมพ์ซ้ำ ถ้าแก้ตัวต้นทางด้านบน ตัวนี้ตามเองเสมอ ──
export const MAINTENANCE_MENU_GROUPS = [
  {
    id: AP_CONTROLLER_MENU.id, icon: AP_CONTROLLER_MENU.icon, label: AP_CONTROLLER_MENU.label,
    color: AP_CONTROLLER_MENU.color,
    items: AP_CONTROLLER_MENU.groups.flatMap(g => g.items),
  },
  {
    id: VAT_CONTROLLER_MENU.id, icon: VAT_CONTROLLER_MENU.icon, label: VAT_CONTROLLER_MENU.label,
    color: VAT_CONTROLLER_MENU.color,
    items: VAT_CONTROLLER_MENU.groups.flatMap(g => g.items),
  },
  {
    id: IE_CONTROLLER_MENU.id, icon: IE_CONTROLLER_MENU.icon, label: IE_CONTROLLER_MENU.label,
    color: IE_CONTROLLER_MENU.color,
    items: IE_CONTROLLER_MENU.groups.flatMap(g => g.items),
  },
  {
    id: GL_FUNCTIONAL_MENU.id, icon: GL_FUNCTIONAL_MENU.icon, label: GL_FUNCTIONAL_MENU.label,
    color: GL_FUNCTIONAL_MENU.color,
    items: GL_FUNCTIONAL_MENU.groups.flatMap(g => g.items),
  },
  ...SIMPLE_FUNCTION_MENUS.map(m => ({
    id: m.id, icon: m.icon, label: m.label, color: m.color,
    items: [{ id: m.id, icon: m.icon, label: m.label }],
  })),
];