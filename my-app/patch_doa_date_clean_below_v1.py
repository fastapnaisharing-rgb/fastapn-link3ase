# -*- coding: utf-8 -*-
"""Patch: DetailOfAccount.js -- Clean format วันที่ Transaction Date + จัดแถววันที่เก่าเข้า Below ให้ถูกต้อง
สาเหตุ: detDate() อ่านได้เฉพาะ 'dd-Mon-yy(yy)' และ Date  => '28/09/22', '28/11/22' (dd/mm/yy), Excel serial, yyyy-mm-dd อ่านไม่ออก
        => txnYM() ได้ 0 => แถวถูกจัดเป็นงวดปัจจุบันแทนที่จะเป็น Below
แก้: detDate() รองรับ dd/mm/yy(yy), dd.mm.yyyy, dd-mm-yyyy, yyyy-mm-dd, ปี พ.ศ. (>2400) และ Excel serial -> แปลงเป็นวันที่จริง
     (แสดงเป็น 28-Sep-22 และนับงวดถูกต้อง => Below)
Run จากโฟลเดอร์ my-app:  python patch_doa_date_clean_below_v1.py"""
import shutil, sys
P = r'src/pages/DetailOfAccount.js'
s = open(P, encoding='utf-8').read()
if 'MARKER_GL_DOA_DATE_CLEAN_V1' in s:
    print('already patched'); sys.exit(0)
shutil.copy(P, P + '.bak_date_clean_v1')
old = "function detDate(v) { if (v instanceof Date) return v; const x = String(v == null ? '' : v).trim().match(/^(\\d{1,2})-([A-Za-z]{3})-(\\d{2,4})$/); if (!x || DMON[x[2].toUpperCase()] == null) return null; const y = Number(x[3]) < 100 ? 2000 + Number(x[3]) : Number(x[3]); return new Date(Date.UTC(y, DMON[x[2].toUpperCase()], Number(x[1]))); }"
assert s.count(old) == 1, s.count(old)
new = r"""function detDate(v) { /* MARKER_GL_DOA_DATE_CLEAN_V1 -- Clean format วันที่: dd-Mon-yy(yy) | dd/mm/yy(yy) | dd.mm.yyyy | dd-mm-yyyy | yyyy-mm-dd | Excel serial | ปี พ.ศ. */
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === 'number') { if (isFinite(v) && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000); return null; }
  const t = String(v == null ? '' : v).trim(); if (!t) return null;
  if (/^\d{5}$/.test(t)) return detDate(Number(t)); /* Excel serial ที่เป็นข้อความ */
  const mk = (y, mo, d) => { if (y < 100) y += 2000; if (y > 2400) y -= 543; if (!(mo >= 0 && mo <= 11 && d >= 1 && d <= 31)) return null; const dt = new Date(Date.UTC(y, mo, d)); return dt.getUTCMonth() === mo ? dt : null; };
  let x = t.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s,]*(\d{2,4})$/); if (x && DMON[x[2].toUpperCase()] != null) return mk(Number(x[3]), DMON[x[2].toUpperCase()], Number(x[1]));
  x = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})(?:[\sT].*)?$/); if (x) return mk(Number(x[3]), Number(x[2]) - 1, Number(x[1]));
  x = t.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})(?:[\sT].*)?$/); if (x) return mk(Number(x[1]), Number(x[2]) - 1, Number(x[3]));
  return null; }"""
s = s.replace(old, new)
open(P, 'w', encoding='utf-8', newline='').write(s)
print('OK')
