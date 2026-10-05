# -*- coding: utf-8 -*-
# MARKER_VATCONTROLLER_DATE_AMBIGUITY_PASTE_POPUP_V1 -- วางวันที่ที่กำกวม (DD/MM vs MM/DD) -> Popup ให้เลือก แล้วปรับ Format ตามที่เลือก
import sys, shutil, re
M = 'MARKER_VATCONTROLLER_DATE_AMBIGUITY_PASTE_POPUP_V1'
path = sys.argv[1]
raw = open(path, 'rb').read()
bom = raw.startswith(b'\xef\xbb\xbf')
s = raw.decode('utf-8-sig')
if M in s:
    print('already patched'); sys.exit(0)
shutil.copyfile(path, path + '.bak_dateambig')

HELPER = r'''
// MARKER_VATCONTROLLER_DATE_AMBIGUITY_PASTE_POPUP_V1 -- วันที่ที่ "วาง" (Paste) แล้วกำกวมระหว่าง DD/MM กับ MM/DD -> ถามผู้ใช้ก่อน (พิมพ์เองใช้กติกาเดิม ไม่ถาม)
let lastPastedDateEl = null;
if (typeof document !== 'undefined' && !window.__vcDatePasteHooked) {
  window.__vcDatePasteHooked = true;
  document.addEventListener('paste', (ev) => { lastPastedDateEl = ev.target; }, true);
}
const getDateAmbiguity = (str) => { // คืน { DMY: iso, MDY: iso } เมื่อกำกวมจริง (ตัวเลขสองตัวแรก <= 12 และไม่เท่ากัน และอ่านได้ทั้งสองแบบ) ไม่งั้น null
  if (!str) return null;
  const s = String(str).trim().replace(/[๐-๙]/g, (c) => String(c.charCodeAt(0) - 0x0E50));
  let a, b, yRaw;
  let m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (m) { a = +m[1]; b = +m[2]; yRaw = m[3]; }
  else if ((m = s.match(/^(\d{2})(\d{2})(\d{4})$/))) { a = +m[1]; b = +m[2]; yRaw = m[3]; }
  else if ((m = s.match(/^(\d{2})(\d{2})(\d{2})$/))) { a = +m[1]; b = +m[2]; yRaw = m[3]; }
  else return null;
  if (a > 12 || b > 12 || a === b) return null;
  const y = yRaw.length === 2 ? expandYear2Digit(yRaw) : +yRaw;
  const DMY = isoIfValidFlexDate(y, b, a); const MDY = isoIfValidFlexDate(y, a, b);
  return (DMY && MDY && DMY !== MDY) ? { DMY, MDY } : null;
};
const askDateOrderPopup = (amb, rawText) => new Promise((resolve) => { // Popup เล็ก (DOM ล้วน ไม่ผูก React) -- คืน 'DMY' | 'MDY' | null (ปิด/Esc = ยกเลิก)
  const fmt = (iso) => { const [yy, mm, dd] = iso.split('-'); const TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']; return `${+dd} ${TH[+mm - 1]} ${yy}`; };
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(26,58,92,0.4);display:flex;align-items:center;justify-content:center;z-index:100000;font-family:inherit';
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:14px;padding:22px;width:380px;max-width:90vw;box-shadow:0 16px 40px rgba(26,58,92,0.28);border:1px solid #c5d8f0';
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  box.innerHTML = `<div style="font-size:15px;font-weight:700;color:#1a3a5c;margin-bottom:6px">วันที่นี้อ่านได้ 2 แบบ</div><div style="font-size:13px;color:#555;margin-bottom:14px">ค่าที่วาง: <b>${esc(rawText)}</b> -- ลำดับ วัน/เดือน เป็นแบบไหน?</div>`;
  const done = (v) => { document.removeEventListener('keydown', onKey, true); ov.remove(); resolve(v); };
  const onKey = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); done(null); } };
  const mk = (label, iso, key) => { const btn = document.createElement('button'); btn.type = 'button'; btn.style.cssText = 'display:block;width:100%;text-align:left;padding:10px 14px;margin-bottom:8px;border:1px solid #c5d8f0;border-radius:10px;background:#eef4fb;color:#1a3a5c;font-size:13.5px;cursor:pointer'; btn.innerHTML = `<b>${label}</b> &nbsp;→&nbsp; ${fmt(iso)}`; btn.onclick = () => done(key); return btn; };
  box.appendChild(mk('DD/MM', amb.DMY, 'DMY')); box.appendChild(mk('MM/DD', amb.MDY, 'MDY'));
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'ยกเลิก (ไม่ใช้ค่าที่วาง)'; cancel.style.cssText = 'display:block;width:100%;padding:8px;border:none;background:none;color:#888;font-size:12px;cursor:pointer'; cancel.onclick = () => done(null); box.appendChild(cancel);
  ov.appendChild(box); document.body.appendChild(ov); document.addEventListener('keydown', onKey, true);
  setTimeout(() => box.querySelector('button')?.focus(), 30);
});
const resolveFlexibleDateInput = async (el) => { // แทน parseFlexibleDate(e.target.value) ใน onBlur: ถ้า "เพิ่งวาง" และกำกวม -> ถาม / ไม่งั้นใช้ Parser เดิม
  const text = el.value;
  const wasPasted = lastPastedDateEl === el; lastPastedDateEl = null;
  if (wasPasted) { const amb = getDateAmbiguity(text); if (amb) { const pick = await askDateOrderPopup(amb, text); return pick ? amb[pick] : null; } }
  return parseFlexibleDate(text);
};
'''
anchor = "const formatDateDisplayMDY = (iso) => {"
assert s.count(anchor) == 1
s = s.replace(anchor, HELPER + anchor)

pat = re.compile(r"onBlur=\{\(e\) => \{(\s*)const parsed = parseFlexibleDate\(e\.target\.value\);")
n = len(pat.findall(s)); assert n == 7, n
s = pat.sub(lambda mo: "onBlur={async (e) => {" + mo.group(1) + "const parsed = await resolveFlexibleDateInput(e.target);", s)
open(path, 'wb').write((b'\xef\xbb\xbf' if bom else b'') + s.encode('utf-8'))
print('patched OK; onBlur sites =', n)
