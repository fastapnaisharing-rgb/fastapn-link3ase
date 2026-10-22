import sys,shutil,datetime
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
M='MARKER_GL_DOA_CONFIRM_BACKUP_UNION_V1'
if M in s: print('already'); sys.exit(0)
shutil.copy(p,p+'.bak_confirm_union_'+datetime.datetime.now().strftime('%H%M%S'))
def rep(a,b):
    global s
    assert s.count(a)==1,('NF/dup',s.count(a),a[:90]); s=s.replace(a,b)
rep("old = detailRows(Array.isArray(d0 && d0.data) ? d0.data : []).filter(o => !curAcc.has(String(o.account_code))); } } catch (e3) { old = []; }",
    "old = detailRows(Array.isArray(d0 && d0.data) ? d0.data : []); } } catch (e3) { old = []; } /* MARKER_GL_DOA_CONFIRM_BACKUP_UNION_V1 -- Backup สะสม: เก็บแถวเดิมทั้งหมด (ทุก Account) ไม่ลบ/ไม่ทับ */")
rep("const merged = old.concat(cur); const mat = detailMatrixFromRows(merged);",
    "const cntB = new Map(); old.filter(o => curAcc.has(String(o.account_code))).forEach(o => { const k = detKey(o); cntB.set(k, (cntB.get(k) || 0) + 1); }); const addB = cur.filter(o => { const k = detKey(o); const v = cntB.get(k) || 0; if (v > 0) { cntB.set(k, v - 1); return false; } return true; }); const merged = old.concat(addB); const mat = detailMatrixFromRows(merged); /* แถวที่มีอยู่แล้วไม่เพิ่มซ้ำ (เทียบ detKey แบบนับจำนวน) เพิ่มเฉพาะแถวใหม่ของ Account ที่ Confirm */")
open(p,'w',encoding='utf-8').write(s)
