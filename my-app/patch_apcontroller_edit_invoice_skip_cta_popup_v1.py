# -*- coding: utf-8 -*-
"""
patch_apcontroller_edit_invoice_skip_cta_popup_v1.py
Edit Invoice (APController.js > handleSaveCore): ไม่เปิด Popup "ตรวจสอบ Due Date ก่อน Submit" ซ้ำอีก
เพราะ Edit Invoice แก้ Due Date / GRT / Description ได้ในฟอร์มอยู่แล้ว -> กด Save = บันทึกตามฟอร์มทันที
(Popup ยังใช้ตอน Submit ครั้งแรก ใน doActualSubmit เหมือนเดิม)
"""
import sys, shutil, os

TARGET = r"src\pages\APController.js"
MARKER = "MARKER_EDIT_INVOICE_SKIP_CTA_POPUP_V1"

OLD1 = "const ctaFoundB = cleanedLines.map(getCtaValueB).find(Boolean);"
NEW1 = "// " + MARKER + " -- Edit Invoice แก้ Due Date/Index ในฟอร์มได้แล้ว ไม่ต้องเปิด Popup CTA ซ้ำ (ยังใช้ ctaOverride เดิมถ้ามีเรียกมา)"
OLD2 = "if (ctaFoundB) { setCtaPopup({ ctaValue: ctaFoundB }); return; }"
NEW2 = ""

def main():
    base = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(base, TARGET)
    with open(path, "rb") as f:
        raw = f.read()
    txt = raw.decode("utf-8")
    if MARKER in txt:
        print("already patched"); return
    for old in (OLD1, OLD2):
        c = txt.count(old)
        if c != 1:
            print(f"ABORT: pattern found {c} times (need 1): {old}"); sys.exit(1)
    shutil.copy2(path, path + ".bak_editinv_cta_v1")
    txt = txt.replace(OLD1, NEW1).replace(OLD2, NEW2)
    with open(path, "wb") as f:
        f.write(txt.encode("utf-8"))
    print("OK patched ->", path)

if __name__ == "__main__":
    main()
