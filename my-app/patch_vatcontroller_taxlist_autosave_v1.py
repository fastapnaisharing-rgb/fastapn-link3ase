# -*- coding: utf-8 -*-
"""
patch_vatcontroller_taxlist_autosave_v1.py
Full Page > Tax Invoice List: แก้ Detail แถวใบกำกับภาษี (Double-click) แล้ว "ไม่ต้องกด Update"
  - ออกจากแถว (คลิกที่อื่น / Tab ออกนอกแถว) = บันทึกเข้า List อัตโนมัติ
  - Enter = บันทึกทันที | Esc = ยกเลิกการแก้
  - เอาแถวปุ่ม Cancel/Update ออก
  - แก้ Bug เดิม: onClick={commitEditTaxRow} ส่ง Event เข้าไปเป็น overrideDraft ทำให้ค่าที่แก้หาย -> เช็คชนิด draft ก่อนใช้
(แก้เฉพาะ State ใน Memory ของ addTaxInvoiceList ไม่แตะ DB)
"""
import re, sys, shutil, os

TARGET = os.path.join("src", "pages", "VatController.js")
MARKER = "MARKER_VATWATCHLISTOPS_ADDTAX_LIST_AUTOSAVE_NO_UPDATE_V1"

OLD_TR = "<tr style={{ borderBottom: isEditingRow ? 'none' : '0.5px solid #eee' }}>"
NEW_TR = ("<tr style={{ borderBottom: '0.5px solid #eee' }}"
          " onBlur={(e) => { if (isEditingRow && !e.currentTarget.contains(e.relatedTarget)) commitEditTaxRow(); }}"
          " onKeyDown={(e) => { if (!isEditingRow) return; if (e.key === 'Enter') { e.preventDefault(); commitEditTaxRow(); } else if (e.key === 'Escape') { e.preventDefault(); cancelEditTaxRow(); } }}>"
          " {/* " + MARKER + " -- ออกจากแถว/Enter = บันทึกเข้า List, Esc = ยกเลิก (ไม่ต้องกด Update) */}")

OLD_DRAFT = "const draft = overrideDraft || editingTaxRowDraft;"
NEW_DRAFT = ("const draft = (overrideDraft && typeof overrideDraft === 'object' && 'taxInvoiceNo' in overrideDraft) ? overrideDraft : editingTaxRowDraft; // " + MARKER + " -- กัน Event ถูกส่งมาเป็น overrideDraft\n"
             "    if (!draft) return;")

RE_BTNROW = re.compile(
    r"\{isEditingRow && \(\s*<tr style=\{\{ borderBottom: '0\.5px solid #eee' \}\}>\s*"
    r"<td colSpan=\{8\}[^>]*>\s*"
    r"<button onClick=\{cancelEditTaxRow\}[^>]*>Cancel</button>\s*"
    r"<button onClick=\{commitEditTaxRow\}[^>]*>Update</button>\s*"
    r"</td>\s*</tr>\s*\)\}", re.S)

def main():
    base = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(base, TARGET)
    txt = open(path, "rb").read().decode("utf-8")
    if MARKER in txt:
        print("already patched"); return
    for name, old in (("OLD_TR", OLD_TR), ("OLD_DRAFT", OLD_DRAFT)):
        c = txt.count(old)
        if c != 1:
            print(f"ABORT: {name} found {c} times (need 1)"); sys.exit(1)
    m = RE_BTNROW.findall(txt)
    if len(m) != 1:
        print(f"ABORT: Cancel/Update row found {len(m)} times (need 1)"); sys.exit(1)
    shutil.copy2(path, path + ".bak_taxlist_autosave_v1")
    txt = txt.replace(OLD_TR, NEW_TR).replace(OLD_DRAFT, NEW_DRAFT)
    txt = RE_BTNROW.sub("{/* " + MARKER + " -- เอาปุ่ม Cancel/Update ออก */}", txt)
    open(path, "wb").write(txt.encode("utf-8"))
    print("OK patched ->", path)

if __name__ == "__main__":
    main()
