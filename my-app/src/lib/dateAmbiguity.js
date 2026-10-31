// MARKER_DATE_AMBIGUITY_STANDARD_V1 -- กติกามาตรฐานวันที่กำกวม (DD/MM vs MM/DD) ใช้ร่วมทั้งระบบ
// กำกวม = ตัวเลขสองตัวแรกอ่านเป็นวัน/เดือนได้ทั้งคู่ (<= 12) และไม่เท่ากัน  -> ห้ามเดาเงียบๆ ต้องถามผู้ใช้
// ถ้าตัวใดตัวหนึ่ง > 12 หรือเท่ากัน = ไม่กำกวม อ่านได้เลย
// ไฟล์ Upload : ถาม "ครั้งเดียวต่อไฟล์" แล้วใช้ลำดับที่เลือกกับทุกแถว (setDateOrder) ; ผู้ใช้กดยกเลิก = ยกเลิกการนำเข้า
const SLASH_RE = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[\sT].*)?$/;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let ACTIVE_ORDER = 'MDY'; // มาตรฐานระบบ = MM/DD/YYYY
export const getDateOrder = () => ACTIVE_ORDER;
export const setDateOrder = (o) => { ACTIVE_ORDER = o === 'DMY' ? 'DMY' : 'MDY'; };

const norm = (s) => String(s == null ? '' : s).trim().replace(/[๐-๙]/g, (c) => String(c.charCodeAt(0) - 0x0E50));

// คืน { a, b, y } เมื่อเป็นรูป a/b/y (ตัวเลขล้วน) ไม่งั้น null
export const slashDateParts = (s) => {
  const m = SLASH_RE.exec(norm(s));
  return m ? { a: +m[1], b: +m[2], y: m[3] } : null;
};
export const isAmbiguousDateText = (s) => {
  const p = slashDateParts(s);
  return !!p && p.a >= 1 && p.b >= 1 && p.a <= 12 && p.b <= 12 && p.a !== p.b;
};

// แปลง a/b/y ตามลำดับที่ใช้อยู่ ; ถ้าลำดับนั้นเป็นไปไม่ได้ (เดือน > 12) ลองอีกแบบ ; คืน { d, mo, y(ค.ศ.) } | null
export const resolveDayMonth = (a, b, order = ACTIVE_ORDER) => {
  let d = order === 'MDY' ? b : a; let mo = order === 'MDY' ? a : b;
  if (mo > 12 && d <= 12) { const t = d; d = mo; mo = t; }
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  return { d, mo };
};
export const fixYear = (yRaw) => {
  let y = +yRaw; if (String(yRaw).length <= 2) y += y >= 50 ? 2500 : 2000;
  return y > 2400 ? y - 543 : y;
};

// สแกนค่า (ข้อความ) -> { ambiguous: [raw...], evDMY, evMDY }
export const scanDateTexts = (values) => {
  const seen = new Set(); const ambiguous = []; let evDMY = false; let evMDY = false;
  (values || []).forEach((v) => {
    if (v instanceof Date || typeof v === 'number') return; // ค่าวันที่จริง/เลข Serial ไม่กำกวม
    const p = slashDateParts(v); if (!p) return;
    if (p.a > 12 && p.b <= 12) evDMY = true; else if (p.b > 12 && p.a <= 12) evMDY = true;
    else if (isAmbiguousDateText(v)) { const k = norm(v); if (!seen.has(k)) { seen.add(k); ambiguous.push(k); } }
  });
  return { ambiguous, evDMY, evMDY };
};

const fmtOpt = (p, order) => { const r = resolveDayMonth(p.a, p.b, order); return r ? `${String(r.d).padStart(2, '0')}-${MON[r.mo - 1]}-${String(fixYear(p.y)).slice(-2)}` : '-'; };

// Popup (DOM ล้วน) -- คืน 'DMY' | 'MDY' | null (ยกเลิก)
export const askDateOrderPopup = ({ examples, total, context }) => new Promise((resolve) => {
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(26,58,92,0.4);display:flex;align-items:center;justify-content:center;z-index:100000;font-family:inherit';
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:14px;padding:22px;width:440px;max-width:92vw;box-shadow:0 16px 40px rgba(26,58,92,0.28);border:1px solid #f5d38a';
  const ex = (examples || []).slice(0, 3).map((raw) => { const p = slashDateParts(raw); return p ? `<div style="font-size:12.5px;color:#444;margin:2px 0"><b>${esc(raw)}</b> &rarr; เดือน/วัน: ${fmtOpt(p, 'MDY')} &nbsp;|&nbsp; วัน/เดือน: ${fmtOpt(p, 'DMY')}</div>` : ''; }).join('');
  box.innerHTML = `<div style="font-size:15px;font-weight:700;color:#7a4b00;margin-bottom:6px">&#9888; พบวันที่กำกวม ${total} ค่า${context ? ' (' + esc(context) + ')' : ''}</div><div style="font-size:13px;color:#555;margin-bottom:10px">อ่านได้ 2 แบบ เลือกลำดับที่ถูกต้อง (ใช้กับทุกแถวของไฟล์นี้) :</div>${ex}<div style="height:12px"></div>`;
  const done = (v) => { document.removeEventListener('keydown', onKey, true); ov.remove(); resolve(v); };
  const onKey = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); done(null); } };
  const mk = (label, key) => { const b = document.createElement('button'); b.type = 'button'; b.style.cssText = 'display:block;width:100%;text-align:left;padding:10px 14px;margin-bottom:8px;border:1px solid #c5d8f0;border-radius:10px;background:#eef4fb;color:#1a3a5c;font-size:13.5px;cursor:pointer;font-weight:600'; b.textContent = label; b.onclick = () => done(key); return b; };
  box.appendChild(mk('เดือน/วัน/ปี (MM/DD/YYYY) — มาตรฐาน', 'MDY')); box.appendChild(mk('วัน/เดือน/ปี (DD/MM/YYYY)', 'DMY'));
  const c = document.createElement('button'); c.type = 'button'; c.textContent = 'ยกเลิกการนำเข้า'; c.style.cssText = 'display:block;width:100%;padding:8px;border:none;background:none;color:#888;font-size:12px;cursor:pointer'; c.onclick = () => done(null);
  box.appendChild(c); ov.appendChild(box); document.body.appendChild(ov); document.addEventListener('keydown', onKey, true);
  setTimeout(() => box.querySelector('button')?.focus(), 30);
});

// ฟังก์ชันกลางสำหรับไฟล์ : สแกนค่าวันที่ -> ไม่กำกวมใช้หลักฐานจากแถวอื่น (วัน>12 = DMY / เดือน>12 = MDY) ; กำกวม = ถาม
// คืน 'DMY' | 'MDY' | null (null = ผู้ใช้ยกเลิก ให้หยุดนำเข้า) และตั้ง setDateOrder ให้ Parser ใช้
export const resolveFileDateOrder = async (values, { context = '', fallback = 'MDY' } = {}) => {
  const { ambiguous, evDMY, evMDY } = scanDateTexts(values);
  let order = evMDY && !evDMY ? 'MDY' : evDMY && !evMDY ? 'DMY' : fallback;
  if (ambiguous.length > 0 && !(evDMY !== evMDY)) { // มีหลักฐานชัดจากแถวอื่นในไฟล์เดียวกัน (วัน>12 ฝั่งเดียว) = ไม่ต้องถาม
    const pick = await askDateOrderPopup({ examples: ambiguous, total: ambiguous.length, context });
    if (!pick) return null;
    order = pick;
  } else if (ambiguous.length > 0 && evDMY !== evMDY) {
    order = evMDY ? 'MDY' : 'DMY';
  }
  setDateOrder(order);
  return order;
};
