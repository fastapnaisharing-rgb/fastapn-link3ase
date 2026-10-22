# -*- coding: utf-8 -*-
"""
patch_reconcile_dash_exp_date_v1.py (src/pages/ReconcileZoneLayout.js)
Dashboard (ตาราง BU x Account): ช่องที่มีไฟล์ Confirm แล้ว -> แสดงวันหมดอายุ dd-mmm-yy ใต้จุด TB|AP ของ Account นั้น
  ที่มา: fileJobs (ไฟล์ที่ Confirm แล้ว confirmedAt + expire_at) จับคู่ BU + Account + Period จากชื่อไฟล์
  ไฟล์ที่ Confirm หลายไฟล์ใน Account เดียว -> ใช้วันที่หมดอายุเร็วที่สุด
"""
import sys, os, shutil
DEFAULT = r"D:\Users\LeKarn\fastapn-link3ase\my-app\src\pages\ReconcileZoneLayout.js"
MARKER = "MARKER_RECONCILEZONE_CONFIRMED_EXP_V1"
R = [
("const XL_ICON = (",
 """// MARKER_RECONCILEZONE_CONFIRMED_EXP_V1 -- วันหมดอายุ dd-mmm-yy
const fmtDmyExp = (iso) => {
  const d = new Date(iso); if (isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
};
const XL_ICON = ("""),
('  const flatAccounts = useMemo(() => accountGroups.flatMap(g => g.accounts.map(a => ({ ...a, groupKey: g.key }))), [accountGroups]);',
 """  // MARKER_RECONCILEZONE_CONFIRMED_EXP_V1 -- แผนที่ BU|Account -> วันหมดอายุ (เร็วสุด) ของไฟล์ที่ Confirm แล้วใน Period ที่เลือก
  const confirmedExpMap = useMemo(() => {
    const m = {};
    (fileJobs || []).forEach((job) => {
      if (!job || !job.confirmed_at || !job.expire_at) return;
      const pf = parseJobFile(job.fileName || job.file_name || '');
      if (!pf) return;
      if (period && String(period).toUpperCase() !== pf.per) return;
      const key = `${String(pf.bu).toUpperCase()}|${pf.acct}`;
      if (!m[key] || job.expire_at < m[key]) m[key] = job.expire_at;
    });
    return m;
  }, [fileJobs, period]);
  const flatAccounts = useMemo(() => accountGroups.flatMap(g => g.accounts.map(a => ({ ...a, groupKey: g.key }))), [accountGroups]);"""),
("const hasAp = cell?.count != null;",
 """const hasAp = cell?.count != null;
                            const expAt = confirmedExpMap[`${String(r.bu).toUpperCase()}|${a.code}`] || null; // MARKER_RECONCILEZONE_CONFIRMED_EXP_V1"""),
("style={{ padding: '8px 4px', textAlign: 'center', background: cellBg, borderLeft, verticalAlign: 'middle', cursor: 'pointer', userSelect: 'none' }}>",
 "style={{ padding: expAt ? '8px 4px 18px' : '8px 4px', textAlign: 'center', background: cellBg, borderLeft, verticalAlign: 'middle', cursor: 'pointer', userSelect: 'none' }}>"),
("style={{ padding: '8px 4px', textAlign: 'center', background: cellBg, verticalAlign: 'middle', cursor: 'pointer', userSelect: 'none' }}>",
 "style={{ padding: expAt ? '8px 4px 18px' : '8px 4px', textAlign: 'center', background: cellBg, verticalAlign: 'middle', cursor: 'pointer', userSelect: 'none' }}>"),
("'ไม่มี TB (No Data)')} />\n                                </td>",
 """'ไม่มี TB (No Data)')} />
                                  {expAt && (<div style={{ position: 'relative', height: 0, zIndex: 1 }}>{/* MARKER_RECONCILEZONE_CONFIRMED_EXP_V1 */}
                                    <span title={`Confirm แล้ว · หมดอายุ ${fmtDmyExp(expAt)}`} style={{ position: 'absolute', top: 1, left: 'calc(100% + 4px)', transform: 'translateX(-50%)', whiteSpace: 'nowrap', fontSize: 9.5, fontWeight: 700, lineHeight: '13px', padding: '0 7px', borderRadius: 8, background: '#E6F4EC', color: '#0F6E56', border: '1px solid #bfe3cf', pointerEvents: 'none' }}>{fmtDmyExp(expAt)}</span>
                                  </div>)}
                                </td>"""),
]
def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    raw = open(path, "rb").read().decode("utf-8")
    crlf = "\r\n" in raw
    src = raw.replace("\r\n", "\n")
    if MARKER in src: print("[SKIP] มีแล้ว"); return
    for o, n in R:
        c = src.count(o)
        if c != 1: print("[ABORT] anchor %d ครั้ง: %s" % (c, o[:70])); sys.exit(1)
    for o, n in R:
        src = src.replace(o, n, 1)
    bk = path + ".bak"
    shutil.copy2(path, bk)   # ใช้ .bak ตัวเดียวตาม Policy (ทับ .bak ได้)
    if crlf: src = src.replace("\n", "\r\n")
    open(path, "wb").write(src.encode("utf-8"))
    print("[OK] แก้ %d จุด | backup: %s" % (len(R), bk))
if __name__ == "__main__": main()
