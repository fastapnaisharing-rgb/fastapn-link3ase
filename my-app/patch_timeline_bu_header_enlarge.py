# -*- coding: utf-8 -*-
# MARKER_TIMELINE_BU_HEADER_ENLARGE_V1 -- หัวหน้า BU (BuPage): ขยายขนาดทุกชิ้นให้สมดุลกับหน้าจอ (แบบ A) ตำแหน่งเดิม
import sys, io
path = sys.argv[1]
src = io.open(path, encoding="utf-8").read()
M = "MARKER_TIMELINE_BU_HEADER_ENLARGE_V1"
if M in src:
    print("already patched"); sys.exit(0)
s = src.index('    <div>\n      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, flexWrap: "wrap", padding: `${16 - stickyTop}px 20px 16px`')
e = src.index('<ZoneHeader badge="1"', s)
blk = src[s:e]
def r(old, new, n):
    global blk
    assert blk.count(old) == n, "count %s: %d != %d" % (old, blk.count(old), n)
    blk = blk.replace(old, new)
r('width: 84, height: 84', 'width: 116, height: 116', 2)
r('width: 66, height: 66', 'width: 92, height: 92', 2)
r('<b style={{ fontSize: 18, fontWeight: 700, color: C.navy }}>', '<b style={{ fontSize: 24, fontWeight: 700, color: C.navy }}>', 1)
r('<b style={{ fontSize: 20, fontWeight: 700, color: C.navy }}>', '<b style={{ fontSize: 26, fontWeight: 700, color: C.navy }}>', 1)
r('fontSize: 28, fontWeight: 600, color: C.navy', 'fontSize: 36, fontWeight: 600, color: C.navy', 1)
r('flexDirection: "row", alignItems: "center", gap: 24 }}>', 'flexDirection: "row", alignItems: "center", gap: 32 }}>', 1)
r('flexDirection: "row", alignItems: "center", gap: 16 }}>\n          {/* Reset', 'flexDirection: "row", alignItems: "center", gap: 24 }}>\n          {/* Reset', 1)
r('gap: 8, width: 120 }}>', 'gap: 8, width: 170 }}>', 1)
r('height: 36', 'height: 40', blk.count('height: 36'))
r('height: 32, padding: "0 14px", borderRadius: 8 }} onClick={onBack}', 'height: 34, padding: "0 14px", borderRadius: 8, fontSize: 13 }} onClick={onBack}', 1)
r('<span style={{ fontSize: 13, color: ink }}>{u.name}</span>', '<span style={{ fontSize: 14, color: ink }}>{u.name}</span>', 1)
r('width: 28, height: 28, borderRadius: "50%"', 'width: 30, height: 30, borderRadius: "50%"', 1)
r('fontSize: 12, fontWeight: 600, color: ink }}>{prepBy}', 'fontSize: 13, fontWeight: 600, color: ink }}>{prepBy}', 1)
r('<span style={{ fontSize: 11, color: "#616e7c" }}>Rate ใช้สิทธิ์</span>', '<span style={{ fontSize: 12, color: "#616e7c" }}>Rate ใช้สิทธิ์</span>', 1)
blk = blk.replace('<div>\n      <div style={{ display: "flex", justifyContent', '<div>\n      {/* ' + M + ' */}\n      <div style={{ display: "flex", justifyContent', 1)
src = src[:s] + blk + src[e:]
io.open(path, "w", encoding="utf-8", newline="").write(src)
print("patched OK")
