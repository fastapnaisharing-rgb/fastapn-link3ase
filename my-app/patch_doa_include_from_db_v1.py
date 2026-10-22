# -*- coding: utf-8 -*-
# แถว Include ที่อยู่ใน DB (doa_detail_clear) ต้องเข้า Detail ตอนโหลดหน้า (ในหน้าเท่านั้น ไม่เขียน Detail ใน DB)
# -> Connect เช็คแล้วเจอว่ามีอยู่ใน Detail แล้ว ไม่แทรกซ้ำ ไม่เด้ง Popup
import os, shutil
MARKER = "MARKER_GL_DOA_INCLUDE_FROM_DB_V1"
P = os.path.join("src", "pages", "DetailOfAccount.js")
s = open(P, encoding="utf-8").read()
if MARKER in s: print("ข้าม: ลงแล้ว"); raise SystemExit
anchor = "  }, [bu, period, dbTick, rulesSig]); // eslint-disable-line react-hooks/exhaustive-deps\n"
assert s.count(anchor) == 1
new = anchor + r'''  const incMergeRef = React.useRef('');
  React.useEffect(() => { /* ''' + MARKER + r''' -- Include ใน DB = ข้อมูลที่อยู่ใน DB แล้ว: โหลดเข้า Detail ในหน้าตอนเปิด (ไม่เขียนทับ Detail ใน DB) */
    if (!bu || !period || !detMatrix || !detMatrix.length) { incMergeRef.current = ''; return undefined; }
    const key = `${bu}|${period}|${dbTick}`; if (incMergeRef.current === key) return undefined; incMergeRef.current = key; let off = false;
    (async () => {
      try {
        const items = (await listDoaClearDetail(bu, '')).filter(x => x.status === 'Include' && x.row && String(x.period) === String(period));
        if (off || !items.length) return;
        setDetMatrix(prev => { const rows = detailRows(prev || []); const have = new Map(); rows.forEach(o => { const k = detKey(o); have.set(k, (have.get(k) || 0) + 1); }); const add = []; items.forEach(x => { const k = detKey(x.row); if (clrKeys.has(k)) return; const v = have.get(k) || 0; if (v > 0) have.set(k, v - 1); else add.push(x.row); }); return add.length ? detailMatrixFromRows([...rows, ...add]) : prev; });
      } catch (e) { /* ไม่กระทบการโหลดหน้า */ }
    })();
    return () => { off = true; };
  }, [bu, period, dbTick, detMatrix]); // eslint-disable-line react-hooks/exhaustive-deps
'''
s = s.replace(anchor, new)
if not os.path.exists(P + ".bak_incdb"): shutil.copy2(P, P + ".bak_incdb")
open(P, "w", encoding="utf-8", newline="").write(s); print("OK")
