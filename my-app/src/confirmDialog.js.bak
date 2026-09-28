// confirmDialog.js
// ── Drop-in replacement สำหรับ window.confirm() / alert() ของ Browser ──────
// ── ที่แก้ Style ตาม Theme ไม่ได้เลย (เป็น Native OS Dialog ไม่ใช่ HTML) ────
//
// ใช้แทนแบบนี้:
//   เดิม:  if (!window.confirm('ต้องการลบ...?')) return;
//   ใหม่:  if (!(await confirmDialog.confirm('ต้องการลบ...?'))) return;
//
//   เดิม:  alert('ลบไม่สำเร็จ: ' + e.message);
//   ใหม่:  confirmDialog.alert('ลบไม่สำเร็จ: ' + e.message, { variant: 'danger' });
//
// เป็น Pattern เดียวกับ wsManager.js (Singleton + Imperative API) — เรียกจาก
// ไฟล์ไหนก็ได้โดยไม่ต้องผ่าน React Context/Hook เพราะหลายจุดที่เรียก
// window.confirm() เดิมอยู่ใน Handler ธรรมดา ไม่ใช่ใน Component Render โดยตรง

let host = null; // ตั้งค่าโดย <ConfirmDialogHost /> ตอน Mount (วางไว้ที่ App.js ระดับบนสุด)

export function registerConfirmDialogHost(showFn) {
  host = showFn;
}

function show(config) {
  if (!host) {
    // ── Fallback กันพัง ถ้าเผลอเรียกก่อน <ConfirmDialogHost /> Mount เสร็จ ──
    console.warn('[confirmDialog] Host ยังไม่ Mount — Fallback ไปใช้ Native Dialog ชั่วคราว');
    if (config.mode === 'alert') { window.alert(config.message); return Promise.resolve(undefined); }
    return Promise.resolve(window.confirm(config.message));
  }
  return host(config);
}

export const confirmDialog = {
  /**
   * @param {string} message
   * @param {{ title?: string, confirmText?: string, cancelText?: string, variant?: 'default'|'danger' }} opts
   * @returns {Promise<boolean>} true = กด OK/ยืนยัน, false = กด Cancel/ปิดหน้าต่าง
   */
  confirm: (message, opts = {}) => show({ mode: 'confirm', message, ...opts }),

  /**
   * @param {string} message
   * @param {{ title?: string, confirmText?: string, variant?: 'default'|'danger'|'success' }} opts
   * @returns {Promise<void>} resolve เมื่อกด OK
   */
  alert: (message, opts = {}) => show({ mode: 'alert', message, ...opts }),
};
