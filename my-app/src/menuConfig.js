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
      { id: 'ap-ocr',  icon: '🔍', label: 'Scan OCR' },
      { id: 'ap-form', icon: '📝', label: 'Purchase Order' },
    ]},
    { label: 'จัดการ', icon: '🗂️', items: [
      { id: 'ap-drafts', icon: '📄', label: 'Invoice History' },
    ]},
  ],
};

// ── VAT Controller: เมนูย่อยแบ่งเป็นกลุ่ม (ใช้สร้าง Flyout) ───────────────
export const VAT_CONTROLLER_MENU = {
  id: 'vat-controller', icon: '💹', label: 'VAT Controller', color: '#EAF3DE',
  groups: [
    { label: 'Operation', icon: '⚙️', items: [
      { id: 'vat-incomplete-report', icon: '📋', label: 'Incomplete Report' },
      { id: 'vat-amagno-reconcile',  icon: '🔄', label: 'Amagno Reconcile' },
    ]},
    { label: 'Results', icon: '📊', items: [
      { id: 'vat-popvat-report',       icon: '📊', label: 'Popvat Report' },
      { id: 'vat-simple-input-report', icon: '📄', label: 'Simple Input Report' },
    ]},
  ],
};

// ── เมนูที่ยังไม่มี submenu ย่อย (เป็น placeholder หน้าเดียว) ─────────────
export const SIMPLE_FUNCTION_MENUS = [
  { id: 'i-expense',       icon: '💸', label: 'I-Expense',       color: '#FAEEDA' },
  { id: 'gl-functional',   icon: '📊', label: 'GL Functional',   color: '#EEEDFE' },
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
  ...SIMPLE_FUNCTION_MENUS.map(m => ({
    id: m.id, icon: m.icon, label: m.label, color: m.color,
    items: [{ id: m.id, icon: m.icon, label: m.label }],
  })),
];