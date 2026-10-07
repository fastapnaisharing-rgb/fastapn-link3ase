# -*- coding: utf-8 -*-
# MARKER_TIMELINE_REMOVE_DUE_BADGE_V1 -- ตัดป้าย "ครบ N ต.ค." ในแถว Step 1 ของหน้า BU
import sys, io
path = sys.argv[1]
src = io.open(path, encoding="utf-8").read()
if "MARKER_TIMELINE_REMOVE_DUE_BADGE_V1" in src:
    print("already patched"); sys.exit(0)
OLD = '            {!od && (st === "N" || st === "Y") && (\n              <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 999, background: od ? "#FCEBEB" : "#F1F2F5", color: od ? "#791F1F" : "#616e7c", fontWeight: od ? 600 : 400 }}>\n                {od ? "เลยกำหนด · " : "ครบ "}{t.due} ต.ค.\n              </span>\n            )}\n'
NEW = '            {/* MARKER_TIMELINE_REMOVE_DUE_BADGE_V1 -- ตัดป้าย "ครบ N ต.ค." ออกจากแถว Step 1 */}\n'
assert src.count(OLD) == 1, "anchor"
src = src.replace(OLD, NEW)
io.open(path, "w", encoding="utf-8", newline="").write(src)
print("patched OK")
