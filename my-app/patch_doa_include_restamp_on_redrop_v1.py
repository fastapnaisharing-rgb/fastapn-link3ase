# -*- coding: utf-8 -*-
"""Patch: DetailOfAccount.js -- โยนไฟล์เดิมซ้ำ (Backup เดิมมีแถว Below ครบอยู่แล้ว) => ตั้ง Status Include ใน DB ใหม่ให้แถวที่ยังไม่เป็น Include/Clear
เดิม: ถ้าแถว Below อยู่ใน Backup ครบ ระบบข้ามหมด (ลบ Include ใน DB แล้วโยนซ้ำ Include ก็ไม่กลับมา)
Run จากโฟลเดอร์ my-app:  python patch_doa_include_restamp_on_redrop_v1.py"""
import shutil, sys
P = r'src/pages/DetailOfAccount.js'
s = open(P, encoding='utf-8').read()
if 'MARKER_GL_DOA_INCLUDE_RESTAMP_V1' in s:
    print('already patched'); sys.exit(0)
shutil.copy(P, P + '.bak_include_restamp_v1')
old = "else out.push(`Detail ${dp} มีแถว Below ครบแล้ว`);"
assert s.count(old) == 1, s.count(old)
new = ("else { const rs = sp.parts.below.filter(o => { const k = detKey(o); return !clrKeys.has(k) && !incKeys.has(k); }); /* MARKER_GL_DOA_INCLUDE_RESTAMP_V1 -- โยนซ้ำ: Backup เดิมมีแถวครบแล้ว แต่ DB ยังไม่เป็น Include => ตั้ง Include ใหม่ */ "
       "if (rs.length) { try { await saveDoaClear(bu, dp, rs.map(o => ({ key: detKey(o), row: o })), null, 'Include'); setIncKeys(prev => { const nx = new Set(prev); rs.forEach(o => nx.add(detKey(o))); return nx; }); out.push(`ตั้ง Status Include ใหม่ ${rs.length} แถว (Backup เดิม)`); setDbTick(t => t + 1); } catch (e9) { /* ไม่กระทบ */ } } else out.push(`Detail ${dp} มีแถว Below ครบแล้ว`); }")
s = s.replace(old, new)
open(P, 'w', encoding='utf-8', newline='').write(s)
print('OK')
