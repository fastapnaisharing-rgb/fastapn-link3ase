# -*- coding: utf-8 -*-
r"""
patch_vatcontroller_perf_defer_secondary_v3.py
แก้ช่องโหว่ของ v2: ตอนสลับ BU รอบ Render แรก secondaryReady ยังเป็น true ของ BU เก่า -> ข้อมูลรองยิงทันที (แล้วยิงซ้ำอีกรอบ)
ทำให้ secondaryReady = "พร้อมเฉพาะ BU นั้น" (เก็บรหัส BU ที่พร้อมแล้ว) -> BU ใหม่ = ยังไม่พร้อมทันทีตั้งแต่ Render แรก
รันที่ my-app:  python patch_vatcontroller_perf_defer_secondary_v3.py   (รันซ้ำได้)
"""
import os, shutil, sys
TARGET = os.path.join("src", "pages", "VatController.js")
M = "MARKER_PERF_DEFER_SECONDARY_V3"
OLD = "  const [secondaryReady, setSecondaryReady] = React.useState(false); // MARKER_PERF_SWITCHBU_DEFER_V1"
NEW = ("  const [secondaryReadyFor, setSecondaryReadyFor] = React.useState(null); // " + M + " -- เก็บรหัส BU ที่ตารางหลักโหลดเสร็จแล้ว\n"
       "  const secondaryReady = !!bu?.bu && secondaryReadyFor === bu.bu;\n"
       "  const setSecondaryReady = (v) => setSecondaryReadyFor(v ? (bu?.bu || null) : null);\n"
       "  // MARKER_PERF_SWITCHBU_DEFER_V1")
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
