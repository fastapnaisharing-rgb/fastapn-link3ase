# -*- coding: utf-8 -*-
"""
patch_vat_vendordetail_ctrlc_v1.py (src/pages/VatController.js)
แก้: Modal "รายละเอียดผู้ค้า" (vendorDetailModal) ไฮไลต์ข้อความแล้วกด Ctrl+C ไม่ได้
     สาเหตุ: window keydown 2 ตัว (handleCellSelectCtrlCFP / handleCheckboxCopyKeyFP) preventDefault แล้วก๊อปข้อมูล Grid แทน
     -> เพิ่ม guard: ถ้า vendorDetailModal เปิดอยู่ หรือมีข้อความที่ไฮไลต์อยู่ (window.getSelection) ให้ปล่อย Browser ก๊อปเอง
     + เพิ่ม vendorDetailModal ใน dependency ของ useEffect ทั้งสองตัว
"""
import sys, os, shutil
DEFAULT = r"D:\Users\LeKarn\fastapn-link3ase\my-app\src\pages\VatController.js"
MARKER = "MARKER_VATWATCHLISTOPS_VENDOR_DETAIL_CTRLC_V1"
GUARD = "if (vendorDetailModal || (window.getSelection && String(window.getSelection()).length > 0)) return; // " + MARKER + " -- Modal รายละเอียดผู้ค้าเปิดอยู่ / มีข้อความไฮไลต์ -> ให้ Browser ก๊อปเอง ไม่แย่ง Ctrl+C ไปก๊อปข้อมูล Grid"
EDITS = [
 ("      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'c') return;\n      if (dtSelectedCells.size === 0) return;\n",
  "      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'c') return;\n      " + GUARD + "\n      if (dtSelectedCells.size === 0) return;\n"),
 ("  }, [dtSelectedCells, displayDetailRows, activeCols]);\n  const copySelectedNoteRowsToClipboard",
  "  }, [dtSelectedCells, displayDetailRows, activeCols, vendorDetailModal]);\n  const copySelectedNoteRowsToClipboard"),
 ("      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'c') return;\n      if (dtSelectedCells.size > 0) return;",
  "      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'c') return;\n      " + GUARD + "\n      if (dtSelectedCells.size > 0) return;"),
 ("  }, [selectedNoteRows, dtSelectedCells]);\n  // MARKER_VATWATCHLISTOPS_REMOVE_CHECKBOX_SUM_DISPLAY_V1",
  "  }, [selectedNoteRows, dtSelectedCells, vendorDetailModal]);\n  // MARKER_VATWATCHLISTOPS_REMOVE_CHECKBOX_SUM_DISPLAY_V1"),
]
def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    raw = open(path, "rb").read().decode("utf-8")
    crlf = "\r\n" in raw
    src = raw.replace("\r\n", "\n")
    if MARKER in src: print("[SKIP] มีแล้ว"); return
    for i, (old, _) in enumerate(EDITS, 1):
        c = src.count(old)
        if c != 1: print("[ABORT] anchor #%d พบ %d ครั้ง (ต้อง 1) -- ยังไม่เขียนไฟล์" % (i, c)); sys.exit(1)
    out = src
    for old, new in EDITS: out = out.replace(old, new, 1)
    bk = path + ".bak_vendordetail_ctrlc_v1"; n = 1
    while os.path.exists(bk): n += 1; bk = path + ".bak_vendordetail_ctrlc_v1_" + str(n)
    shutil.copy2(path, bk)
    if crlf: out = out.replace("\n", "\r\n")
    open(path, "wb").write(out.encode("utf-8"))
    print("[OK] แก้ %d จุด | backup: %s" % (len(EDITS), bk))
if __name__ == "__main__": main()
