# -*- coding: utf-8 -*-
# Connect/โยน Backup: แถวที่มี Include อยู่ใน DB แล้ว ไม่ส่งไปตั้ง Include ซ้ำ (เช็ค DB ก่อน)
import os, shutil
MARKER = "MARKER_GL_DOA_CARRY_SKIP_EXISTING_INCLUDE_V1"
P = os.path.join("src", "pages", "DetailOfAccount.js")
s = open(P, encoding="utf-8").read()
if MARKER in s: print("ข้าม: ลงแล้ว"); raise SystemExit
old = "      try { await saveDoaClear(bu, period, rows.map(o => ({ key: detKey(o), row: o })), null, 'Include'); setIncKeys(prev => { const nx = new Set(prev); rows.forEach(o => nx.add(detKey(o))); return nx; }); } catch (e8)"
assert s.count(old) == 1
new = "      try { const rowsN = rows.filter(o => !incKeys.has(detKey(o))); /* " + MARKER + " */ if (rowsN.length) { await saveDoaClear(bu, period, rowsN.map(o => ({ key: detKey(o), row: o })), null, 'Include'); setIncKeys(prev => { const nx = new Set(prev); rowsN.forEach(o => nx.add(detKey(o))); return nx; }); } } catch (e8)"
s = s.replace(old, new)
if not os.path.exists(P + ".bak_skipinc"): shutil.copy2(P, P + ".bak_skipinc")
open(P, "w", encoding="utf-8", newline="").write(s); print("OK")
