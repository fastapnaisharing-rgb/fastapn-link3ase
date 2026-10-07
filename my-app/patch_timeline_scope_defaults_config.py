# -*- coding: utf-8 -*-
# MARKER_TIMELINE_SCOPE_DEFAULTS_CONFIG_V1
# Active/Inactive ของ BU ใน Timeline = ค่า Defaults ถาวรต่อ BU (ตาราง tax_close_bu_config, config_key='scope', enabled=Active)
# ไม่ถูก Purge / ไม่ผูกรอบ -- เปลี่ยนก็ต่อเมื่อมีคนกดสลับ; BU ที่ยังไม่เคยกด ใช้สถานะจาก company_list เป็นค่าตั้งต้น
# แทนที่ scopeSet รายรอบ (patch_timeline_scope_persist.py) ด้วยการเก็บถาวร
import sys, io
path = sys.argv[1]
src = io.open(path, encoding="utf-8").read()
M = "MARKER_TIMELINE_SCOPE_DEFAULTS_CONFIG_V1"
if M in src:
    print("already patched"); sys.exit(0)
def rep(old, new, label):
    global src
    assert src.count(old) == 1, "anchor count != 1: %s (%d)" % (label, src.count(old))
    src = src.replace(old, new)

# 1) เลิกใช้ scopeSet รายรอบ
rep(", scopeSet: b.scopeSet });", " });", "pickProg")
i = src.index('  if (st.scopeSet && typeof st.scopeSet.inScope === "boolean")')
j = src.index("\n", i)
src = src[:i] + src[j + 1:]
rep("delete snap.rnotes; delete snap.scopeSet;", "delete snap.rnotes;", "defaults snap")

# 2) โหลดค่า scope ถาวรมาทับค่าตั้งต้นจาก company_list
rep('      const r = await db.from("timeline_progress").select("*").eq("period_ym", PERIOD_YM);\n      if (off) return;',
    '      const [r, sc] = await Promise.all([db.from("timeline_progress").select("*").eq("period_ym", PERIOD_YM), db.from("tax_close_bu_config").select("*").eq("config_key", "scope")]); /* ' + M + ' */\n      if (off) return;\n      const scopeRows = sc && !sc.error && Array.isArray(sc.data) ? sc.data : [];', "load")
rep("        const m = row && row.state && typeof row.state === \"object\" ? mergeProg(b, row.state) : b;\n        savedRef.current[b.bu]",
    "        let m = row && row.state && typeof row.state === \"object\" ? mergeProg(b, row.state) : b;\n        const sr = scopeRows.find((x) => String(x.bu_code) === String(b.bu));\n        if (sr && typeof sr.enabled === \"boolean\") m = { ...m, inScope: sr.enabled, why: sr.enabled ? \"\" : \"Inactive\" };\n        savedRef.current[b.bu]", "merge scope")

# 3) กดสลับ -> บันทึกเป็น Defaults ถาวร
rep('mutate(i, (x) => { x.inScope = !was; x.why = was ? "Inactive" : ""; x.scopeSet = { inScope: !was, why: was ? "Inactive" : "", by: who, at: new Date().toISOString() }; }); /* MARKER_TIMELINE_SCOPE_PERSIST_V1 */',
    'mutate(i, (x) => { x.inScope = !was; x.why = was ? "Inactive" : ""; });\n    db.from("tax_close_bu_config").upsert({ bu_code: String(bus[i].bu), config_key: "scope", enabled: !was, updated_by: who, updated_at: new Date().toISOString() }, { onConflict: "bu_code,config_key" }).then((res) => { if (res && res.error) setSaveMsg("บันทึกสถานะ Active/Inactive ไม่สำเร็จ: " + (res.error.message || res.error)); });', "toggle")
io.open(path, "w", encoding="utf-8", newline="").write(src)
print("patched OK")
