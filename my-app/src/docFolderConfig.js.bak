// MARKER_DOCFOLDER_CONFIG_V1
// รายการกล่อง (โฟลเดอร์) ของ Document Center ที่เดียว -- เหมือน menuConfig.js
// เพิ่มกล่องใหม่ = เพิ่มบรรทัดเดียวที่นี่ แล้ว Document Center / Access Panel (User Management) / ป้ายชื่อคำขอสิทธิ์ สร้างกล่องให้เองอัตโนมัติ
//   permKey  = สิทธิ์เดียวที่ให้เข้ากล่องนี้
//   permKeys = (ถ้ามี) มีสิทธิ์ใดสิทธิ์หนึ่งในรายการก็เข้าได้ -- ใช้แทน permKey (เช่น GL Report = Manual | IE | I-Pro, ไม่ดูสิทธิ์ GL)
export const DOC_FOLDERS = [
  { key: 'ap',   label: 'AP Manual',       icon: '🧾', permKey: 'Manual', color: '#E6F1FB', textColor: '#0C447C', desc: 'ใบวางบิล, ใบเสร็จ, หนังสือยืนยัน', docTypes: ['APN01', 'AP09', 'AP07'] },
  { key: 'vat',  label: 'VAT Control',     icon: '🧮', permKey: 'VAT',    color: '#EAF3DE', textColor: '#27500A', desc: 'ใบกำกับภาษี, รายงาน PP30', docTypes: ['VAT'] },
  { key: 'ie',   label: 'I-Expense',       icon: '💸', permKey: 'IE',     color: '#FAEEDA', textColor: '#633806', desc: 'ใบเบิกค่าใช้จ่าย, ค่าเดินทาง, ค่าที่พัก', docTypes: ['IE'] },
  { key: 'gl',   label: 'GL Report',       icon: '📊', permKey: 'GL', permKeys: ['Manual', 'IE', 'I-Pro'], color: '#EEEDFE', textColor: '#3C3489', desc: 'รายงาน GL บัญชีแยกประเภท', docTypes: ['GL'],
    // MARKER_GL_SUBBOXES_V1 -- กล่องด้านในของ GL Report (เพิ่ม/เปลี่ยนชื่อ = แก้ที่นี่ที่เดียว) | empty:true = กล่องเปล่ารอไว้ ยังไม่มีไฟล์/ปุ่มใช้งาน
    subBoxes: [
      { key: 'gl-z-ap',  title: 'Z_Report Reconcile - Account Payable', icon: '📤', bg: '#E8F5E9', desc: 'รายงาน Reconcile Account Payable · เก็บที่ SharePoint', pill: '☁ SharePoint', pillBg: '#E3F2FD', pillColor: '#0C447C', empty: false },
      { key: 'gl-box-2', title: 'กล่องว่าง 2', icon: '🧩', bg: '#f5f5f5', desc: 'Coming soon', pill: 'เร็วๆ นี้', empty: true },
      { key: 'gl-box-3', title: 'กล่องว่าง 3', icon: '🧩', bg: '#f5f5f5', desc: 'Coming soon', pill: 'เร็วๆ นี้', empty: true },
      { key: 'gl-box-4', title: 'กล่องว่าง 4', icon: '🧩', bg: '#f5f5f5', desc: 'Coming soon', pill: 'เร็วๆ นี้', empty: true },
      { key: 'gl-box-5', title: 'กล่องว่าง 5', icon: '🧩', bg: '#f5f5f5', desc: 'Coming soon', pill: 'เร็วๆ นี้', empty: true },
    ] },
  { key: 'ipro', label: 'I-Pro Interface', icon: '🔗', permKey: 'I-Pro',  color: '#FAECE7', textColor: '#712B13', desc: 'เอกสาร interface ระบบ · spec, mapping', docTypes: ['IPRO'] },
];

const keysOf = (f) => (f && Array.isArray(f.permKeys) && f.permKeys.length ? f.permKeys : [f && f.permKey]);
export const folderPermOk = (perms, f) => keysOf(f).some((k) => !!(perms && perms[k]));
export const folderPermLabel = (perms, f) => keysOf(f).map((k) => `${k}=${perms && perms[k] ? 'Yes' : 'No'}`).join(' · ');
export const DOC_FOLDER_LABELS = Object.fromEntries(DOC_FOLDERS.map((f) => [f.key, f.label]));
// สิทธิ์ -> กล่องที่เปิดให้อัตโนมัติ (Auto-Sync ใน User Management) | กล่องแบบ permKeys ไม่ตั้ง Override ให้ เพราะเข้าได้ตามสิทธิ์อยู่แล้ว
export const PERM_TO_FOLDER = Object.fromEntries(DOC_FOLDERS.filter((f) => !f.permKeys).map((f) => [f.permKey, f.key]));
