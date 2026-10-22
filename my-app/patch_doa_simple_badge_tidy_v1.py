# -*- coding: utf-8 -*-
# คอลัมน์ Simple: Badge วันหมดอายุอยู่บรรทัดเดียวกับจุด ไม่ขึ้นบรรทัดชื่อไฟล์ต้นทาง (ย้ายไปอยู่ใน Tooltip ซึ่งมีอยู่แล้ว)
import os, shutil
MARKER = "MARKER_GL_DOA_SIMPLE_BADGE_TIDY_V1"
P = os.path.join("src", "pages", "DetailOfAccount.js")
s = open(P, encoding="utf-8").read()
if MARKER in s: print("ข้าม: ลงแล้ว"); raise SystemExit
a = "{cfmAt[a.code] && cfmSrc[a.code] ? <div style={{ fontSize: 10, color: '#6B778C', marginTop: 2,"
i = s.index(a); assert s.count(a) == 1
j = s.index(": null}", i) + len(": null}")
s = s[:i] + "{/* " + MARKER + " */}" + s[j:]
t = "<td onContextMenu={e => openCtx(e, 'Simple', a)} style={{ padding: '7px 10px', textAlign: 'center' }}>"
assert s.count(t) == 1
s = s.replace(t, "<td onContextMenu={e => openCtx(e, 'Simple', a)} style={{ padding: '7px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>")
if not os.path.exists(P + ".bak_badge"): shutil.copy2(P, P + ".bak_badge")
open(P, "w", encoding="utf-8", newline="").write(s); print("OK")
