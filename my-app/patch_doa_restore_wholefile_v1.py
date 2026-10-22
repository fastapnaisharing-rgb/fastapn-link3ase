import sys,shutil
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
M='MARKER_GL_DOA_RESTORE_WHOLEFILE_V1'
if M in s: print('already'); sys.exit()
shutil.copy(p,p+'.bak_restore_wholefile_v1')
def rep(a,b,n=1):
    global s
    assert s.count(a)==n,(a[:80],s.count(a)); s=s.replace(a,b)
# 1) Restore: เลือกดึงทั้งไฟล์จาก Drive D (ใช้หน้าต่างรายการไฟล์ Drive D เดิม)
rep("    if (rstBusy || !bu) return; setRstBusy(String(code)); setDbMsg('');\n",
"    if (rstBusy || !bu) return;\n    /* "+M+" -- Restore ดึงทั้งไฟล์: OK = เปิดรายการไฟล์ใน Drive D (ของ BU + Account นี้) เลือกไฟล์ต้นฉบับ แล้วรวมเข้า Backup เดิมแบบสะสม | Cancel = เก็บเฉพาะ Data Include จาก DB */\n    if (await askDoa(`Restore Account ${code}\\n\\nOK = ดึงทั้งไฟล์ Backup ต้นฉบับจาก Drive D (เลือกไฟล์ในรายการ) แล้วรวมเข้า Backup เดิม\\nCancel = เก็บเฉพาะ Data Include จาก DB`)) { setDropAcc(String(code)); setDropPop(true); return; }\n    setRstBusy(String(code)); setDbMsg('');\n")
# 2) ยืนยันสร้าง Backup: เตือนเมื่อไม่เห็นไฟล์เดิม
rep("เท่าเดิม (ไม่รับ) ${mg.rep.filter(x => x.st === 'เท่าเดิม').length} Account`)) return;\n      await saveDoaBackup(bu, per, f.name, mg.matrix, 'Detail');",
"เท่าเดิม (ไม่รับ) ${mg.rep.filter(x => x.st === 'เท่าเดิม').length} Account${mg.merged ? '' : '\\n⚠ ไม่เห็นไฟล์ Backup เดิมของงวดนี้ — ถ้ามีไฟล์ที่ถูกซ่อน (หมดอายุ) จะถูกทับ'}`)) return;\n      await saveDoaBackup(bu, per, f.name, mg.matrix, 'Detail');")
open(p,'w',encoding='utf-8').write(s); print('ok')
