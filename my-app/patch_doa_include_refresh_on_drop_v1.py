# -*- coding: utf-8 -*-
"""Patch: DetailOfAccount.js -- โยนข้อมูลเข้าใหม่ / ข้อมูลใน DB เปลี่ยน => โหลดสถานะ Clear/Include จาก DB ใหม่ทุกครั้ง (dbTick / bkTick)
Run จากโฟลเดอร์ my-app:  python patch_doa_include_refresh_on_drop_v1.py"""
import shutil, sys
P = r'src/pages/DetailOfAccount.js'
s = open(P, encoding='utf-8').read()
if 'MARKER_GL_DOA_INCLUDE_REFRESH_V1' in s:
    print('already patched'); sys.exit(0)
shutil.copy(P, P + '.bak_include_refresh_v1')
old = "  React.useEffect(() => { if (!admView) return;"
assert s.count(old) == 1, s.count(old)
new = ("  React.useEffect(() => { let off = false; if (!bu) return undefined; listDoaClear(bu).then(it => { if (!off) applyClr(it); }).catch(() => {}); return () => { off = true; }; }, [bu, dbTick, bkTick]); // eslint-disable-line react-hooks/exhaustive-deps\n"
       "  /* MARKER_GL_DOA_INCLUDE_REFRESH_V1 -- โยนข้อมูลเข้าใหม่ / DB เปลี่ยน => อ่านสถานะ Include/Clear จาก DB ใหม่ (ลบใน DB = หายเอง) */\n") + old
s = s.replace(old, new)
open(P, 'w', encoding='utf-8', newline='').write(s)
print('OK')
