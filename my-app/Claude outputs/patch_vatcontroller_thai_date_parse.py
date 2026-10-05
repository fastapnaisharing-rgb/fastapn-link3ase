# -*- coding: utf-8 -*-
# MARKER_VATCONTROLLER_PARSEFLEXDATE_THAI_BE_V1 -- parseFlexibleDate รองรับ วันที่ไทย (เดือนไทยเต็ม/ย่อ, พ.ศ., เลขไทย)
import sys, shutil
M = 'MARKER_VATCONTROLLER_PARSEFLEXDATE_THAI_BE_V1'
path = sys.argv[1]
raw = open(path, 'rb').read()
bom = raw.startswith(b'\xef\xbb\xbf')
s = raw.decode('utf-8-sig')
if M in s:
    print('already patched'); sys.exit(0)
shutil.copyfile(path, path + '.bak_thaidate')
def rep(old, new):
    global s
    n = s.count(old); assert n == 1, f'anchor count={n}: {old[:60]}'
    s = s.replace(old, new)

# 1) ปี พ.ศ. 4 หลัก (2400-2700) -> ค.ศ. ทุก Branch ของ Parser
rep("const isoIfValidFlexDate = (y, mo, d) => {\n  if (mo < 1",
    f"const isoIfValidFlexDate = (y, mo, d) => {{\n  if (y >= 2400 && y <= 2700) y -= 543; // {M} -- ปี พ.ศ. -> ค.ศ.\n  if (mo < 1")

# 2) Thai text parser + เรียกใช้ใน parseFlexibleDate
rep("const parseFlexibleDate = (str) => {\n  if (!str) return null;\n  const s = String(str).trim();\n",
f"""// {M}
const THAI_MONTHS_FP = [['มกราคม','มค'],['กุมภาพันธ์','กพ'],['มีนาคม','มีค'],['เมษายน','เมย'],['พฤษภาคม','พค'],['มิถุนายน','มิย'],['กรกฎาคม','กค'],['สิงหาคม','สค'],['กันยายน','กย'],['ตุลาคม','ตค'],['พฤศจิกายน','พย'],['ธันวาคม','ธค']];
const parseThaiTextDate = (str) => {{
  const isCE = /ค\\.?\\s*ศ\\.?/.test(str);
  const t = str.replace(/[พค]\\.?\\s*ศ\\.?/g, ' ').trim();
  const m = t.match(/^(\\d{{1,2}})\\s*([ก-๛.\\s]+?)\\s*(\\d{{2,4}})$/);
  if (!m) return null;
  const key = m[2].replace(/[.\\s]/g, '');
  const idx = THAI_MONTHS_FP.findIndex(([full, abbr]) => key === abbr || key === full || (key.length >= 3 && full.startsWith(key)));
  if (idx < 0) return null;
  let y;
  if (m[3].length === 4) y = +m[3];
  else if (m[3].length === 2) y = isCE ? expandYear2Digit(m[3]) : 1957 + (+m[3]); // ปี 2 หลักในรูปแบบไทย = พ.ศ. (69 -> 2569 -> 2026)
  else return null;
  return isoIfValidFlexDate(y, idx + 1, +m[1]);
}};
const parseFlexibleDate = (str) => {{
  if (!str) return null;
  let s = String(str).trim();
  s = s.replace(/[๐-๙]/g, (c) => String(c.charCodeAt(0) - 0x0E50)); // เลขไทย -> เลขอารบิก
  if (/[ก-๛]/.test(s)) {{ const thDate = parseThaiTextDate(s); if (thDate) return thDate; }}
""")
open(path, 'wb').write((b'\xef\xbb\xbf' if bom else b'') + s.encode('utf-8'))
print('patched OK', 'BOM' if bom else 'noBOM')
