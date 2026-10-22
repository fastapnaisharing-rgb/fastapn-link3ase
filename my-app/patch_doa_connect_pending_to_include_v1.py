# -*- coding: utf-8 -*-
"""Patch: DetailOfAccount.js -- Connect (ดึง Backup/DB เดิมเข้ามา): แถวใน DB ของงวดปัจจุบันที่ตรงกับแถวใน Backup และสถานะยังเป็น Pending => เปลี่ยนเป็น Include
 - เดิม carryM1 ข้าม Account ที่งวดนี้มี Detail อยู่แล้ว => แถวค้างเป็น Pending
 - ชื่อไฟล์ที่แสดงเป็นชื่อจำลอง (BU_Account_MM.YYYY_Backup) ไม่ต้องใช้ไฟล์จริง
 - ไม่แตะแถวที่ Clear / Include อยู่แล้ว
Run จากโฟลเดอร์ my-app:  python patch_doa_connect_pending_to_include_v1.py"""
import shutil, sys
P = r'src/pages/DetailOfAccount.js'
s = open(P, encoding='utf-8').read()
if 'MARKER_GL_DOA_CONNECT_PENDING_TO_INCLUDE_V1' in s:
    print('already patched'); sys.exit(0)
shutil.copy(P, P + '.bak_pend_inc_v1')
old = """    if (!def || !bu || !period) return;
    try {
      const need = new Set(codes.map(String).filter(c => !detAcc.has(c))); if (!need.size) return;"""
assert s.count(old) == 1, s.count(old)
new = """    if (!def || !bu || !period) return;
    try {
      /* MARKER_GL_DOA_CONNECT_PENDING_TO_INCLUDE_V1 -- Connect: แถวใน DB งวดปัจจุบันที่ตรงกับ Backup และยังเป็น Pending => Include */
      try {
        const cs = new Set(codes.map(String)); const dB = await getDoaBackup(def.id); const mB = Array.isArray(dB && dB.data) ? dB.data : [];
        const curK = new Set(detailRows(detMatrix).map(detKey));
        const rsP = detailRows(mB).filter(o => { if (!cs.has(String(o.account_code))) return false; const k = detKey(o); return curK.has(k) && !clrKeys.has(k) && !incKeys.has(k); });
        if (rsP.length) { await saveDoaClear(bu, period, rsP.map(o => ({ key: detKey(o), row: o })), null, 'Include'); setIncKeys(prev => { const nx = new Set(prev); rsP.forEach(o => nx.add(detKey(o))); return nx; }); setDbTick(t => t + 1); setDbMsg(`✓ Connect: เปลี่ยน Pending เป็น Include ${rsP.length} แถว`); }
      } catch (e7) { /* ไม่กระทบการ Connect */ }
      const need = new Set(codes.map(String).filter(c => !detAcc.has(c))); if (!need.size) return;"""
s = s.replace(old, new)
open(P, 'w', encoding='utf-8', newline='').write(s)
print('OK')
