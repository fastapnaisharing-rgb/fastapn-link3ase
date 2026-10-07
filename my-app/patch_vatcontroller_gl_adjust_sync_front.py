# -*- coding: utf-8 -*-
# patch_vatcontroller_gl_adjust_sync_front.py
# GL-TransferVat: แถวแรกของ Config Adjust (Tab ③) = ช่อง Dr/Cr ด้านหน้า (Sync เสมอ) / Config เพิ่มแถวเองได้
import sys, io, re, shutil
P = r'src\pages\VatController.js' if len(sys.argv) < 2 else sys.argv[1]
MARK = 'MARKER_VATCONTROLLER_GL_ADJUST_SYNC_FRONT_V1'
s = io.open(P, encoding='utf-8').read()
if MARK in s:
    print('already patched'); sys.exit(0)
def rep1(old, new, label):
    global s
    assert s.count(old) == 1, '%s count=%d' % (label, s.count(old))
    s = s.replace(old, new)

# 1) Build จากช่องด้านหน้า
pat = re.compile(r"    const \[vatDrAcc, vatCrAcc\] = qaGlDefaultAcc\(\);[^\n]*\n    const taxRows = \[[^\n]*\n    if \(avg && nonRecov > 0\) taxRows\.push\([^\n]*\n    const invRows = \[[^\n]*\n")
assert len(pat.findall(s)) == 1, 'build anchor'
new_build = ("    // " + MARK + " -- แถวแรก = ช่อง Dr/Cr ด้านหน้า (Ofin/CPC/Account/Sub Acc) แล้ว Sync ตามเสมอ\n"
"    const taxRows = [qaGlAdjMk('main', qaGlBranchDr, qaGlCpcDr, qaGlAccDr, qaGlSubDr)];\n"
"    if (avg && nonRecov > 0) taxRows.push(qaGlAdjMk('avg', qaGlBranchDr, '45700', '63050000', qaGlSubDr, nonRecov));\n"
"    const invRows = [qaGlAdjMk('main', qaGlBranchCr, qaGlCpcCr, qaGlAccCr, qaGlSubCr)];\n")
s = pat.sub(lambda m: new_build, s)

# 2) Sync helper + effect
helper = r"""  const qaGlAdjSyncMain = (d) => { // MARKER_VATCONTROLLER_GL_ADJUST_SYNC_FRONT_V1 -- แถวแรก (main) ของ Config ตามช่อง Dr/Cr ด้านหน้าเสมอ
    if (!d) return d;
    const drF = { ofin: qaGlBranchDr, cpc: qaGlCpcDr, acc: qaGlAccDr, sub: qaGlSubDr };
    const crF = { ofin: qaGlBranchCr, cpc: qaGlCpcCr, acc: qaGlAccCr, sub: qaGlSubCr };
    const f = { dr: d.neg ? crF : drF, cr: d.neg ? drF : crF };
    let changed = false;
    const mapSide = (key) => d[key].map((x) => {
      if (x.k === 'main' && (x.ofin !== f[key].ofin || x.cpc !== f[key].cpc || x.acc !== f[key].acc || x.sub !== f[key].sub)) { changed = true; return { ...x, ...f[key] }; }
      if (x.k === 'avg' && x.sub !== f[key].sub) { changed = true; return { ...x, sub: f[key].sub }; }
      return x;
    });
    const dr = mapSide('dr'); const cr = mapSide('cr');
    return changed ? { ...d, dr, cr } : d;
  };
  React.useEffect(() => { setQaGlAdj((a) => (a ? qaGlAdjSyncMain(a) : a)); setQaGlAdjDraft((a) => (a ? qaGlAdjSyncMain(a) : a)); }, [qaGlBranchDr, qaGlCpcDr, qaGlAccDr, qaGlSubDr, qaGlBranchCr, qaGlCpcCr, qaGlAccCr, qaGlSubCr]); // eslint-disable-line react-hooks/exhaustive-deps
"""
rep1("  const qaGlAdjFlat = (d) => {", helper + "  const qaGlAdjFlat = (d) => {", 'helper')

# 3) แถวแรกใน Tab ③ อ่านอย่างเดียว
ro = "{ ...inA(false), background: '#f1f1f1', border: '1px solid #ddd' }"
rep1("{isAvg ? <input value={mainOfin || ''} readOnly style=", "{(isAvg || isMain) ? <input value={isMain ? x.ofin : (mainOfin || '')} readOnly title={isMain ? 'แถวแรกตามช่องด้านหน้า' : ''} style=", 'ro-ofin')
for f in ('cpc', 'acc', 'sub'):
    rep1("<input value={x.%s} onChange={(e) => qaGlAdjUpd(key, x.id, { %s: e.target.value })} style={inA(isAvg)} />" % (f, f),
         "<input value={x.%s} readOnly={isMain} onChange={(e) => qaGlAdjUpd(key, x.id, { %s: e.target.value })} style={isMain ? %s : inA(isAvg)} />" % (f, f, ro), 'ro-' + f)

shutil.copyfile(P, P + '.bak')
io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('patched')
