# -*- coding: utf-8 -*-
r"""
patch_vatcontroller_reload_coalesce_v1.py
detailReloadKey: ถ้ามีการสั่งรีเฟรชหลายครั้งในช่วงสั้น ๆ (Sync / Cross Check / Broadcast / Pop / Note ...) ให้รวมเหลือ 1 รอบ
(เดิมทุกครั้ง = โหลดตารางหลัก + Aging + Type + Accept + Bucket ใหม่ทั้งชุด) -- ไม่เปลี่ยนว่า "รีเฟรชอะไร" แค่ไม่รีเฟรชซ้ำรัว ๆ
รันที่ my-app:  python patch_vatcontroller_reload_coalesce_v1.py   (รันซ้ำได้)
"""
import os, shutil, sys
TARGET = os.path.join("src", "pages", "VatController.js")
M = "MARKER_RELOAD_COALESCE_V1"
OLD = "  const [detailReloadKey, setDetailReloadKey] = React.useState(0); // MARKER_VATWATCHLISTOPS_RESTORE_BROADCAST_SYNC_V1"
NEW = ("  const [detailReloadKey, setDetailReloadKeyRaw] = React.useState(0); // " + M + " -- ตัวเลขจริง | เรียกผ่าน setDetailReloadKey ด้านล่าง (รวมหลายครั้งใน 350ms เหลือ 1 รอบ)\n"
       "  const detailReloadTimerRef = React.useRef(null);\n"
       "  const setDetailReloadKey = React.useCallback((v) => { if (typeof v !== 'function') { setDetailReloadKeyRaw(v); return; } if (detailReloadTimerRef.current) return; detailReloadTimerRef.current = setTimeout(() => { detailReloadTimerRef.current = null; setDetailReloadKeyRaw(v); }, 350); }, []);\n"
       "  React.useEffect(() => () => { if (detailReloadTimerRef.current) { clearTimeout(detailReloadTimerRef.current); detailReloadTimerRef.current = null; } }, []);\n"
       "  // MARKER_VATWATCHLISTOPS_RESTORE_BROADCAST_SYNC_V1")
def main():
    base = os.path.dirname(os.path.abspath(__file__)); path = os.path.join(base, TARGET)
    txt = open(path, "rb").read().decode("utf-8")
    if M in txt: print("SKIP already patched"); return
    if txt.count(OLD) != 1: print("ABORT anchor count", txt.count(OLD)); sys.exit(1)
    bak = path + ".bak"
    if not os.path.exists(bak): shutil.copy2(path, bak)
    open(path, "wb").write(txt.replace(OLD, NEW).encode("utf-8"))
    print("OK patched ->", path)
main()
