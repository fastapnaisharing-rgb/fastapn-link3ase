# -*- coding: utf-8 -*-
"""
patch_vatcontroller_ar_ref_strip_bu_prefix_v1.py
AR_Collection Matching (Tier 2: TRX_NUMBER vs Invoice Ref. ของ Incomplete):
Invoice Ref. ใน Incomplete บางแถวมีรหัส BU นำหน้า (เช่น CMKS0101IN26011845 ของ BU CMK) ต้องไม่เอา Prefix มาเกี่ยวข้องตอน Match
เดิม Index (getArMatchIndex) เก็บ Ref ดิบอย่างเดียว -> TRX_NUMBER = S0101IN26011845 จับไม่ติด
แก้: เพิ่ม Key ที่ตัด Prefix BU แล้ว (stripBuPrefix ที่ใช้ฝั่ง Inbox/PDF/Bucket อยู่แล้ว) เข้า refMap/refGroups ควบคู่กับ Key เดิม
"""
import sys, shutil, os
TARGET = os.path.join("src", "pages", "VatController.js")
MARKER = "MARKER_AR_REF_STRIP_BU_PREFIX_V1"
OLD = "    if (rf) { const ra = refGroups.get(rf); if (ra) ra.push(row); else refGroups.set(rf, [row]); }"
NEW = OLD + " { const rfS = norm(stripBuPrefix(rf, row.bu)); if (rfS && rfS !== rf) { if (!refMap.has(rfS)) refMap.set(rfS, row); const rb = refGroups.get(rfS); if (rb) rb.push(row); else refGroups.set(rfS, [row]); } } // " + MARKER + " -- Key ที่ตัดรหัส BU นำหน้าออก (Key เดิมยังอยู่)"
def main():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), TARGET)
    txt = open(path, "rb").read().decode("utf-8")
    if MARKER in txt: print("already patched"); return
    c = txt.count(OLD)
    if c != 1: print(f"ABORT: anchor found {c} times (need 1)"); sys.exit(1)
    shutil.copy2(path, path + ".bak_ar_ref_strip_v1")
    open(path, "wb").write(txt.replace(OLD, NEW).encode("utf-8"))
    print("OK patched ->", path)
if __name__ == "__main__":
    main()
