import sys,shutil
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
M='MARKER_GL_DOA_PREVIEW_INCLUDE_STAT_V1'
if M in s: print('already'); sys.exit()
shutil.copy(p,p+'.bak_preview_include_stat_v1')
def rep(a,b,n=1):
    global s
    assert s.count(a)==n,(a[:90],s.count(a)); s=s.replace(a,b)
# 1) จัดสถานะ: แถวที่ Transaction Date < งวด = Include (ไม่ใช่ Match)
rep("    return { list: [...det, ...only], stat: [...det.map(o => (keyB.has(detKey(o)) ? 'Match' : 'Unmatch')), ...only.map(() => 'มีเฉพาะใน Backup')], nDet: det.length, nOnly: only.length };",
"    const pmI = /^(\\d{4})\\.(\\d{2})$/.exec(period || ''); const pYMI = pmI ? Number(pmI[1]) * 100 + Number(pmI[2]) : 0; /* "+M+" -- แถวใน Detail ที่ Transaction Date ต่ำกว่างวดปัจจุบัน = Include (ข้อมูลเดิมที่ถูกรวมแล้ว) ไม่แสดงเป็น Match */\n    const isBelow = (o) => { const d = detDate(o.txn_date); const y = d ? d.getFullYear() * 100 + d.getMonth() + 1 : txnYM(o); return !!(pYMI && y > 0 && y < pYMI); };\n    return { list: [...det, ...only], stat: [...det.map(o => (keyB.has(detKey(o)) ? (isBelow(o) ? 'Include' : 'Match') : 'Unmatch')), ...only.map(() => 'มีเฉพาะใน Backup')], nDet: det.length, nOnly: only.length };")
# 2) นับ + หัวข้อ
rep("const nMa = stat.filter(x => x === 'Match').length;","const nMa = stat.filter(x => x === 'Match').length; const nInc = stat.filter(x => x === 'Include').length;")
rep("เทียบกับ Backup: Match {nMa} (ยังค้าง) · Unmatch","เทียบกับ Backup: Include {nInc} (ข้อมูลเดิมที่รวมแล้ว) · Match {nMa} (ยังค้าง) · Unmatch")
# 3) สีแถว Include
rep("(stat && stat[i] === 'Match' ? { background: '#D9F2E3' } : (stat && stat[i] === 'Unmatch' ? { background: '#FDE0E0' } : undefined))","(stat && stat[i] === 'Match' ? { background: '#D9F2E3' } : (stat && stat[i] === 'Include' ? { background: '#E6EEF8' } : (stat && stat[i] === 'Unmatch' ? { background: '#FDE0E0' } : undefined)))")
# 4) ตกลง: Include ก็ถูกตั้ง Include ใน DB เหมือน Match
rep("sp.stat[i] === 'Match' && !clrKeys.has(detKey(o)) && !incKeys.has(detKey(o))","(sp.stat[i] === 'Match' || sp.stat[i] === 'Include') && !clrKeys.has(detKey(o)) && !incKeys.has(detKey(o))")
open(p,'w',encoding='utf-8').write(s); print('ok')
