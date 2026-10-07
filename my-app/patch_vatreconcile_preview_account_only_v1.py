# -*- coding: utf-8 -*-
"""patch_vatreconcile_preview_account_only_v1
Preview Input Reconcile: หัวบรรทัด Account แสดงเฉพาะเลข Account (ตัด " · ชื่อ Account" ออก)
รันที่โฟลเดอร์ my-app:  python patch_vatreconcile_preview_account_only_v1.py
"""
import os, shutil, sys

TARGET = os.path.join("src", "pages", "VatReconcileDashboard.js")
MARKER = "PREVIEW_ACCOUNT_ONLY_V1"

OLD = "Account {data.account}{data.accountName ? ` · ${data.accountName}` : ''}</span>"
NEW = "Account {data.account}{/* PREVIEW_ACCOUNT_ONLY_V1 */}</span>"

def main():
    with open(TARGET, "r", encoding="utf-8", newline="") as f:
        src = f.read()
    bom = src.startswith("﻿")
    if MARKER in src:
        print("SKIP: patch นี้ถูกใช้แล้ว (%s)" % MARKER); return
    if src.count(OLD) != 1:
        print("ERROR: anchor พบ %d ครั้ง (ต้องเป็น 1) - ไม่เขียนไฟล์" % src.count(OLD)); sys.exit(1)
    out = src.replace(OLD, NEW)
    if sum(out.count(c) for c in "{") != sum(out.count(c) for c in "}"):
        print("ERROR: bracket {} ไม่สมดุล - ไม่เขียนไฟล์"); sys.exit(1)
    shutil.copyfile(TARGET, TARGET + ".bak")   # 1 .bak ต่อไฟล์ เขียนทับทุกครั้ง
    with open(TARGET, "w", encoding="utf-8-sig" if bom else "utf-8", newline="") as f:
        f.write(out)
    print("OK: patched ->", TARGET)

main()
