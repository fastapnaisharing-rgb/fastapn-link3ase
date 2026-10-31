# -*- coding: utf-8 -*-
r"""
patch_vatcontroller_perf_defer_secondary_v2.py
เปิด/สลับ BU ในหน้า Incomplete: โหลดตารางหลักก่อน แล้วค่อยโหลดข้อมูลรอง (Bucket Tax, Cross Check Full Page,
Notes, Related Person, sync_draft_status) หลังตารางหลักเสร็จ (secondaryReady) -- และรีเซ็ต secondaryReady ทุกครั้งที่สลับ BU
รันที่ my-app:  python patch_vatcontroller_perf_defer_secondary_v2.py   (รันซ้ำได้)
"""
import os, shutil, sys
TARGET = os.path.join("src", "pages", "VatController.js")
M = "MARKER_PERF_DEFER_SECONDARY_V2"
EDITS = []  # (old, new)
EDITS.append((
"    const t = setTimeout(() => setSecondaryReady(true), 4000);\n    return () => clearTimeout(t);\n  }, []);",
"    setSecondaryReady(false); /* " + M + " -- สลับ BU = เริ่มใหม่: ข้อมูลรองรอตารางหลักของ BU ใหม่ก่อน */\n    const t = setTimeout(() => setSecondaryReady(true), 4000);\n    return () => clearTimeout(t);\n  }, [bu?.bu]);"))
EDITS.append((
"React.useEffect(() => { refreshBucketTax(); }, [refreshBucketTax, detailReloadKey]);",
"React.useEffect(() => { if (!secondaryReady) return; refreshBucketTax(); }, [refreshBucketTax, detailReloadKey, secondaryReady]); // " + M))
EDITS.append((
"React.useEffect(() => { const b = bu?.bu; if (!b) return undefined; let off = false; vatFpCrossCheck(b)",
"React.useEffect(() => { const b = bu?.bu; if (!b || !secondaryReady) return undefined; let off = false; vatFpCrossCheck(b)"))
EDITS.append((
"/* ข้าม */ } } }); return () => { off = true; }; }, [bu?.bu]);",
"/* ข้าม */ } } }); return () => { off = true; }; }, [bu?.bu, secondaryReady]);"))
# effects ที่ปลายเป็น }, [bu?.bu]); -> ต้องแก้ทั้งหัวและท้าย (ทำเป็นช่วง)
RANGES = [
 ("    if (!bu?.bu) { setNoteMap({}); return; }\n    let active = true;", "    if (!bu?.bu) { setNoteMap({}); return; }\n    if (!secondaryReady) return undefined; // " + M + "\n    let active = true;"),
 ("    if (!bu?.bu) { setRelatedPersonList([]); return; }\n    let active = true;", "    if (!bu?.bu) { setRelatedPersonList([]); return; }\n    if (!secondaryReady) return undefined; // " + M + "\n    let active = true;"),
 ("    if (!bu?.bu) return;\n    let active = true;\n    (async () => {\n      try {\n        const result = await apiFetch('/vat_watchlist_report/sync_draft_status'", "    if (!bu?.bu || !secondaryReady) return; // " + M + "\n    let active = true;\n    (async () => {\n      try {\n        const result = await apiFetch('/vat_watchlist_report/sync_draft_status'"),
]
TAIL = "\n  }, [bu?.bu]);"
def main():
    base = os.path.dirname(os.path.abspath(__file__)); path = os.path.join(base, TARGET)
    txt = open(path, "rb").read().decode("utf-8")
    if M in txt: print("SKIP already patched"); return
    if "\r\n" in txt: print("ABORT CRLF file - ใช้ LF"); sys.exit(1)
    for o, _ in EDITS + RANGES:
        c = txt.count(o)
        if c != 1: print(f"ABORT anchor count={c}: {o[:60]!r}"); sys.exit(1)
    for o, n in EDITS: txt = txt.replace(o, n)
    for o, n in RANGES:
        i = txt.index(o); j = txt.index(TAIL, i)
        if j - i > 2500: print("ABORT tail too far"); sys.exit(1)
        txt = txt[:i] + n + txt[i + len(o):j] + "\n  }, [bu?.bu, secondaryReady]);" + txt[j + len(TAIL):]
    bak = path + ".bak"
    if not os.path.exists(bak): shutil.copy2(path, bak)
    open(path, "wb").write(txt.encode("utf-8"))
    print("OK patched ->", path)
main()
