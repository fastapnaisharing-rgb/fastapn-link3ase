# -*- coding: utf-8 -*-
"""
patch_gl_filejobs_fast_v1.py (src/pages/GLFunctionalController.js)
เร่งการโหลดรายการไฟล์ (My Job / All Job) ในหน้า Reconcile:
  เดิม: ดึงรายการ -> รอ /ap-reconcile/expire-info (Request ที่ 2, เรียงต่อกัน) -> ค่อยแสดงทั้งหมด (ช้าตามตัวที่ช้ากว่า)
  ใหม่: 1) แสดงรายการทันทีที่ได้ แล้วเติมวันหมดอายุทีหลัง (Progressive)
        2) แคชรายการแยกตาม scope: สลับ My <-> All แล้วเห็นของเดิมทันที + รีเฟรชเงียบ ไม่ขึ้น Loading
        3) ระหว่างรีเฟรช เก็บวันหมดอายุเดิมไว้ ไม่กะพริบเป็น "—"
"""
import sys, os, shutil
DEFAULT = r"D:\Users\LeKarn\fastapn-link3ase\my-app\src\pages\GLFunctionalController.js"
MARKER = "MARKER_FILEJOBS_FAST_V1"
START = "  const loadFileJobs = useCallback((scope, silent = false) => {"
END = "\n  }, []);\n"
NEW = """  const jobsCacheRef = useRef({}); // MARKER_FILEJOBS_FAST_V1 -- แคชรายการไฟล์แยกตาม scope (mine/all)
  const loadFileJobs = useCallback((scope, silent = false) => { // MARKER_APRECONCILE_REALTIME_V1 -- silent = รีเฟรชเงียบ (Event/Poll) ไม่ขึ้น Loading ไม่ล้างรายการเดิม
    let cancelled = false;
    const cached = jobsCacheRef.current[scope]; // MARKER_FILEJOBS_FAST_V1
    if (!silent) { if (cached) setFileJobs(cached); setFileJobsLoading(!cached); setFileJobsError(''); } // มีแคช = โชว์ทันที ไม่ขึ้น Loading
    fetchJson(`/file-storage/ap-reconcile-jobs?scope=${scope}`)
      .then(async (data) => { // MARKER_APRECONCILE_AP_EXPIRE_V1 -- เติมวันหมดอายุ (Confirm+30 วัน) + จำนวน Line ข้อมูล AP ที่จะถูกลบ ให้คอลัมน์ Item Expired Date
        let list = Array.isArray(data) ? data : [];
        // MARKER_FILEJOBS_FAST_V1 -- ยกวันหมดอายุเดิมจากแคชมาก่อน (ไม่กะพริบ) แล้วแสดงรายการทันที ไม่รอ expire-info
        const prevById = {}; (cached || []).forEach((j) => { if (j && j.expire_at) prevById[j.id] = j; });
        list = list.map((j) => (j && j.confirmed_at && prevById[j.id] ? { ...j, expire_at: prevById[j.id].expire_at, expire_lines: prevById[j.id].expire_lines, expire_purged: prevById[j.id].expire_purged } : j));
        if (cancelled) return;
        jobsCacheRef.current[scope] = list; setFileJobs(list); setFileJobsLoading(false);
        const ids = list.filter((j) => j && j.confirmed_at).map((j) => j.id);
        if (ids.length) {
          try {
            const info = await fetchJson(`/ap-reconcile/expire-info?ids=${ids.join(',')}`);
            if (cancelled) return;
            const merged = list.map((j) => (info && info[j.id] ? { ...j, expire_at: info[j.id].expire_at, expire_lines: info[j.id].lines, expire_purged: info[j.id].purged } : j));
            jobsCacheRef.current[scope] = merged; setFileJobs(merged);
          } catch (_) { /* ไม่มีข้อมูล Expire = แสดง — */ }
        }
      })
      .catch((err) => { if (!cancelled && !silent) { setFileJobsError(err.message); setFileJobs([]); } })
      .finally(() => { if (!cancelled) setFileJobsLoading(false); });
    return () => { cancelled = true; };
  }, []);
"""
def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    raw = open(path, "rb").read().decode("utf-8")
    crlf = "\r\n" in raw
    src = raw.replace("\r\n", "\n")
    if MARKER in src: print("[SKIP] มีแล้ว"); return
    if src.count(START) != 1: print("[ABORT] start anchor", src.count(START)); sys.exit(1)
    i = src.index(START); j = src.index(END, i) + len(END)
    old = src[i:j]
    if "expire-info" not in old or j - i > 2500: print("[ABORT] บล็อกเดิมไม่ตรงที่คาด"); sys.exit(1)
    out = src[:i] + NEW + src[j:]
    shutil.copy2(path, path + ".bak")   # .bak ตัวเดียวตาม Policy
    if crlf: out = out.replace("\n", "\r\n")
    open(path, "wb").write(out.encode("utf-8"))
    print("[OK] แทนที่ loadFileJobs (%d -> %d ตัวอักษร) | backup: %s.bak" % (len(old), len(NEW), path))
if __name__ == "__main__": main()
