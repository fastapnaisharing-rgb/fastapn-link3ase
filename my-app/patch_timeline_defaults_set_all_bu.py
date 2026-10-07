# -*- coding: utf-8 -*-
# patch_timeline_defaults_set_all_bu.py
# Timeline Lobby: ปุ่ม "Defaults Set ทุก BU" -- ใช้กฎกลางเดียวกัน (Tax Type + Rate) ตั้งให้ทุก BU ที่ Active ในครั้งเดียว ไม่ต้อง Set ทีละ BU
import sys, io, shutil
P = r'src\pages\TimelinePage.js' if len(sys.argv) < 2 else sys.argv[1]
MARK = 'MARKER_TIMELINE_DEFAULTS_SET_ALL_BU_V1'
s = io.open(P, encoding='utf-8').read()
if MARK in s:
    print('already patched'); sys.exit(0)
def rep1(old, new, label):
    global s
    assert s.count(old) == 1, '%s count=%d' % (label, s.count(old))
    s = s.replace(old, new)

fn = r'''  // MARKER_TIMELINE_DEFAULTS_SET_ALL_BU_V1 -- Defaults Set ทุก BU (กฎกลาง Tax Type + Rate เดียวกับรายตัว) เฉพาะ BU ที่ Active
  const onDefaultsSetAll = async () => {
    const plan = bus.map((u, i) => ({ i, bu: u.bu, rule: u.inScope ? defaultsRule(u.taxType, u.vatRate) : null, active: !!u.inScope }));
    const act = plan.filter((p) => p.active);
    const withRule = act.filter((p) => p.rule);
    const noRule = act.filter((p) => !p.rule);
    const n100 = withRule.filter((p) => bus[p.i].vatRate === 100).length;
    const nLt = withRule.filter((p) => typeof bus[p.i].vatRate === "number" && bus[p.i].vatRate > 0 && bus[p.i].vatRate < 100).length;
    if (!withRule.length) { await confirmDialog.alert("ไม่มี BU ที่ Active และมี Tax Type / Rate ใน Company List ให้ตั้งตามกฎ", { title: "Defaults Set · ทุก BU" }); return false; }
    const msg = [
      `ตั้งค่า Default ตามกฎกลาง (Tax Type + Rate ของแต่ละ BU) ให้ ${withRule.length} BU ที่ Active`,
      "",
      `Rate 100%  →  Trial Balance · Expense 100% · Asset 100% เปิด (AVG ปิด)   ${n100} BU`,
      `Rate < 100%  →  Trial Balance · Expense AVG · Asset AVG เปิด   ${nLt} BU`,
      "Daily · Tax Code · Final Step  →  ตั้งตาม Tax Type ของแต่ละ BU",
      noRule.length ? `\nข้าม ${noRule.length} BU ที่ไม่มี Tax Type / Rate : ${noRule.slice(0, 8).map((p) => p.bu).join(", ")}${noRule.length > 8 ? " …" : ""}` : "",
      "",
      "ค่าที่กรอกไว้แล้ว (Request ID ฯลฯ) ไม่หาย · ทับเฉพาะ Enable/Disable",
    ].filter((l, n, a) => l !== "" || (n > 0 && a[n - 1] !== "")).join("\n");
    const ok = await confirmDialog.confirm(msg, { title: "Defaults Set · ทุก BU", confirmText: "ตั้งค่าทุก BU", cancelText: "ยกเลิก" });
    if (!ok) return false;
    setBus((prev) => {
      const next = clone(prev);
      withRule.forEach((p) => { const x = next[p.i]; if (!x) return; applyDefaultsRule(x, p.rule); const snap = clone(pickProg(x)); delete snap.defaults; delete snap.rhist; delete snap.rnotes; resetValues(snap); x.defaults = snap; });
      return next;
    });
    withRule.forEach((p) => log(p.i, `Defaults Set ทุก BU (Tax Type ${String(bus[p.i].taxType || "").trim() || "ไม่ระบุ"} · Rate ${typeof bus[p.i].vatRate === "number" ? bus[p.i].vatRate + "%" : "ไม่ระบุ"})`));
    return true;
  };
'''
rep1("  const onTickAll = (k, val, by) => {", fn + "  const onTickAll = (k, val, by) => {", 'fn')

btn = '''        <button type="button" onClick={onDefaultsSetAll} title="ตั้งค่า Default ตามกฎกลาง (Tax Type + Rate) ให้ทุก BU ที่ Active ในครั้งเดียว" style={{ ...btn, height: 30, padding: "0 12px", borderRadius: 8, boxSizing: "border-box", color: "#27500a", background: "#eaf3de", borderColor: "#c0dd97", fontWeight: 600, whiteSpace: "nowrap", fontSize: 12 }}>Defaults Set ทุก BU</button>
'''
rep1('        <button type="button" aria-label="Config BU" title="Config BU"', btn + '        <button type="button" aria-label="Config BU" title="Config BU"', 'btn')

shutil.copyfile(P, P + '.bak')
io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('patched')
