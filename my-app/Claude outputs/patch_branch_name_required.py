#!/usr/bin/env python3
# patch_branch_name_required.py -- สาขาที่อยู่ใน branch_list แต่ไม่มีชื่อ (ไม่มีทั้งชื่อจาก Input และ Branch Name for Report) -> Error ห้าม First Draft / Save / Export | MARKER_VATRECONCILE_BRANCH_NAME_REQUIRED_V1
# ใช้: python3 patch_branch_name_required.py <vatReconcile.js> <vatReconcileReportFiles.js> <VatReconcileDashboard.js>
import sys, re
p1, p2, p3 = sys.argv[1:4]
M = "MARKER_VATRECONCILE_BRANCH_NAME_REQUIRED_V1"

s = open(p1, encoding="utf-8").read()
if M in s: print("vatReconcile.js already patched")
else:
    a = "        branchMissing: !branchInfo.has(String(branch).trim()),"
    assert s.count(a) == 1, s.count(a)
    s = s.replace(a, "        nameMissing: inBranchList && !name, // " + M + " -- อยู่ใน branch_list แต่ไม่มีชื่อ (Input / Branch Name for Report) -> ห้าม Export\n" + a, 1)
    b = 'name: branchNames.get("410001") || "CFM-HO", branchMissing: !branchInfo.has("410001"),'
    assert s.count(b) == 1, s.count(b)
    s = s.replace(b, 'name: branchNames.get("410001") || "", nameMissing: branchInfo.has("410001") && !branchNames.get("410001"), branchMissing: !branchInfo.has("410001"),', 1)
    open(p1, "w", encoding="utf-8").write(s); print("vatReconcile.js patched")

r = open(p2, encoding="utf-8").read()
if M in r: print("vatReconcileReportFiles.js already patched")
else:
    m = re.search(r'^(\s*)if \(missingBranches\.length\) return res\.status\(422\)[^\n]*\n', r, re.M)
    assert m
    ind = m.group(1)
    add = (ind + 'const noNameBranches = rep.rows.filter((r) => r.nameMissing).map((r) => r.branch); // ' + M + '\n'
           + ind + 'if (noNameBranches.length) return res.status(422).json({ error: `ไม่อนุญาตให้ Export: สาขา ${noNameBranches.slice(0, 20).join(", ")}${noNameBranches.length > 20 ? " ..." : ""} ไม่มีชื่อสาขา — กรุณากรอก Branch Name for Report ในฟอร์ม Edit Branch` });\n')
    r = r[:m.end()] + add + r[m.end():]
    open(p2, "w", encoding="utf-8").write(r); print("vatReconcileReportFiles.js patched")

d = open(p3, encoding="utf-8").read()
if M in d: print("VatReconcileDashboard.js already patched")
else:
    a = "  const missingBranches = data ? data.rows.filter((r) => r.branchMissing).map((r) => r.branch) : []; // MARKER_VATRECONCILE_BRANCH_MISSING_FRONT_V10\n"
    assert d.count(a) == 1
    d = d.replace(a, a + "  const noNameBranches = data ? data.rows.filter((r) => r.nameMissing).map((r) => r.branch) : []; // " + M + " -- สาขาไม่มีชื่อ: ห้าม First Draft / Save\n", 1)
    # ปุ่ม First Draft / Save
    lines = d.split("\n"); cnt = 0
    for i, ln in enumerate(lines):
        if "doExport(" in ln and "data.rows.length === 0 || missingBranches.length > 0" in ln:
            lines[i] = ln.replace("data.rows.length === 0 || missingBranches.length > 0", "data.rows.length === 0 || missingBranches.length > 0 || noNameBranches.length > 0"); cnt += 1
    assert cnt == 2, cnt
    d = "\n".join(lines)
    # ข้อความข้างปุ่ม
    c = "          {missingBranches.length > 0 && !exportMsg && <span"
    assert d.count(c) == 1
    d = d.replace(c, "          {noNameBranches.length > 0 && missingBranches.length === 0 && !exportMsg && <span style={{ fontSize: 12.5, marginRight: 'auto', color: '#cf222e', fontWeight: 600 }}>ไม่อนุญาตให้ Save / First Draft: สาขา {noNameBranches.slice(0, 5).join(', ')}{noNameBranches.length > 5 ? ` และอีก ${noNameBranches.length - 5} สาขา` : ''} ไม่มีชื่อสาขา — กรอก Branch Name for Report ในฟอร์ม Edit Branch</span>}\n" + c, 1)
    # Chip
    e = "                      {notBalanceCount > 0 ? ("
    assert d.count(e) == 1
    d = d.replace(e, "                      {noNameBranches.length > 0 && (\n                        <span title={`ไม่มีชื่อสาขา: ${noNameBranches.join(', ')} — กรอก Branch Name for Report ในฟอร์ม Edit Branch`} style={{ ...chip('#cf222e', '#fff5f5', '#f5b5ae', false), cursor: 'default' }}>\n                          ❗ ไม่มีชื่อสาขา <span style={badge('#cf222e')}>{noNameBranches.length}</span> สาขา\n                        </span>\n                      )}\n" + e, 1)
    # แถว / issue / severe
    f = "style={r.branchMissing ? { background: '#ffd6d6' } : undefined}"
    assert d.count(f) == 1
    d = d.replace(f, "style={(r.branchMissing || r.nameMissing) ? { background: '#ffd6d6' } : undefined}", 1)
    g = "                                r.branchMissing && 'ไม่พบสาขานี้ในรายการสาขา (Branch) — ไม่อนุญาตให้ Export',\n"
    assert d.count(g) == 1
    d = d.replace(g, g + "                                r.nameMissing && 'ไม่มีชื่อสาขา — กรอก Branch Name for Report ในฟอร์ม Edit Branch (ไม่อนุญาตให้ Save / Export)',\n", 1)
    h = "const severe = !ok || hasOver || r.branchMissing;"
    assert d.count(h) == 1
    d = d.replace(h, "const severe = !ok || hasOver || r.branchMissing || r.nameMissing;", 1)
    open(p3, "w", encoding="utf-8").write(d); print("VatReconcileDashboard.js patched")
