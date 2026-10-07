# -*- coding: utf-8 -*-
# MARKER_TIMELINE_SCOPE_PERSIST_V1
# สลับ Active/Inactive ที่หน้า Timeline แล้วต้องคงอยู่หลังเปิดใหม่: เก็บเป็น override (scopeSet) ใน timeline_progress.state
# ถ้าไม่เคยกดสลับ -> ยังใช้สถานะจาก company_list ตามเดิม
import sys, io
path = sys.argv[1]
src = io.open(path, encoding="utf-8").read()
M = "MARKER_TIMELINE_SCOPE_PERSIST_V1"
if M in src:
    print("already patched"); sys.exit(0)
def rep(old, new, label):
    global src
    assert src.count(old) == 1, "anchor count != 1: %s (%d)" % (label, src.count(old))
    src = src.replace(old, new)
rep("rhist: b.rhist, rnotes: b.rnotes });", "rhist: b.rhist, rnotes: b.rnotes, scopeSet: b.scopeSet });", "pickProg")
rep("  if (typeof st.buClosed === \"boolean\") out.buClosed = st.buClosed;\n  return out;",
    "  if (typeof st.buClosed === \"boolean\") out.buClosed = st.buClosed;\n  if (st.scopeSet && typeof st.scopeSet.inScope === \"boolean\") { out.scopeSet = st.scopeSet; out.inScope = st.scopeSet.inScope; out.why = st.scopeSet.inScope ? \"\" : (st.scopeSet.why || \"Inactive\"); } /* " + M + " */\n  return out;", "mergeProg")
rep("delete snap.defaults; delete snap.rhist; delete snap.rnotes;", "delete snap.defaults; delete snap.rhist; delete snap.rnotes; delete snap.scopeSet;", "defaults snap")
rep("mutate(i, (x) => { x.inScope = !was; x.why = was ? \"Inactive\" : \"\"; });",
    "mutate(i, (x) => { x.inScope = !was; x.why = was ? \"Inactive\" : \"\"; x.scopeSet = { inScope: !was, why: was ? \"Inactive\" : \"\", by: who, at: new Date().toISOString() }; }); /* " + M + " */", "toggle")
io.open(path, "w", encoding="utf-8", newline="").write(src)
print("patched OK")
