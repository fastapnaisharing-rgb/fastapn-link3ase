# -*- coding: utf-8 -*-
r"""
patch_vatcontroller_inbox_deposit_first_sheet_v1.py
Inbox Excel: Sheet ที่ชื่อมี "Deposit" ถ้าเป็น "Sheet แรก" (หรือไฟล์มี Sheet เดียว) เดิมถูกอ่านเป็น Inbox ปกติ
(ระบบติดธง __deposit เฉพาะ Sheet ที่ 2 เป็นต้นไป) -> ใช้กฎวันที่ <= 7 วัน แทนกฎเงินประกัน (Ref + VAT ไม่ดูวันที่)
แก้: Sheet แรกที่ชื่อมี Deposit ก็ติดธง __deposit เช่นกัน
"""
import sys, shutil, os
TARGET = os.path.join("src", "pages", "VatController.js")
MARKER = "MARKER_INBOX_DEPOSIT_FIRST_SHEET_V1"
OLD = "inboxRows: isInboxFile ? rows.concat(wb.SheetNames.filter((n, i) => i > 0 && /deposit/i.test(n))"
NEW = "inboxRows: isInboxFile ? (/deposit/i.test(String(wb.SheetNames[0] || '')) ? rows.map((x) => Object.assign({}, x, { __deposit: true })) /* " + MARKER + " -- Sheet แรกชื่อ Deposit = เงินประกัน */ : rows).concat(wb.SheetNames.filter((n, i) => i > 0 && /deposit/i.test(n))"

def main():
    base = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(base, TARGET)
    txt = open(path, "rb").read().decode("utf-8")
    if MARKER in txt:
        print("already patched"); return
    c = txt.count(OLD)
    if c != 1:
        print(f"ABORT: anchor found {c} times (need 1)"); sys.exit(1)
    shutil.copy2(path, path + ".bak_deposit_first_sheet_v1")
    open(path, "wb").write(txt.replace(OLD, NEW).encode("utf-8"))
    print("OK patched ->", path)

if __name__ == "__main__":
    main()
