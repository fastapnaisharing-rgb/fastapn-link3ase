# -*- coding: utf-8 -*-
"""patch_vatcontroller_mailconfig_placeholder_tooltip_v1  (FRONTEND)
Mail Config: Hover ที่ Placeholder แล้วบอก "ความหมาย + ที่มาของข้อมูล" ของแต่ละตัว
(แก้เฉพาะข้อความ tooltip ใน MAIL_PH ของ VatController.js ไม่แตะ logic อื่น)
ต้องรันหลัง patch_vatcontroller_mailconfig_placeholder_source_v1.py
รันที่โฟลเดอร์ my-app แล้ว npm run build
"""
import os, re, shutil, sys
TARGET = os.path.join("src", "pages", "VatController.js")
MARKER = "VATWATCHLISTOPS_MAILCFG_PH_TOOLTIP_V1"

NEW = (
"const MAIL_PH = [\n"
"    ['{BU}', 'ชื่อ BU ของ Config นี้\\nที่มา: BU/ขอบเขตที่เลือกในแท็บ เงื่อนไข'],\n"
"    ['{DATE}', 'วันที่ส่ง (วันที่กดสร้างเมล) รูปแบบ DD/MM/YYYY\\nที่มา: วันที่ของระบบ ณ ตอนสร้างเมล'],\n"
"    ['{ชื่อผู้รับ}', 'ชื่อที่ใช้เรียกผู้รับ (เรียน ...)\\nTo BU: ที่มาคือช่อง ชื่อผู้รับ ใน Config\\nTo Supplier: ที่มาคือ Greeting Name ใน Vendor Category (ผู้ค้า+BU) ถ้าว่างใช้ชื่อใน Config'],\n"
"    ['{SUPPLIER}', 'ชื่อ Supplier แต่ละราย (ใช้ {Supplier Name} ก็ได้)\\nที่มา: ชื่อผู้ค้าในรายการใบแจ้งหนี้ที่เข้าเงื่อนไข'],\n"
"    ['{เดือนเริ่ม}', 'เดือนเริ่มต้นของรายการ\\nTo BU: เดือนแรกของบรรทัด Aging\\nTo Supplier: วันที่ชำระ (payment_date) น้อยสุด รูปแบบ MM/YYYY'],\n"
"    ['{เดือนสุดท้าย}', 'เดือนสุดท้ายของรายการ\\nTo BU: เดือนสุดท้ายของบรรทัด Aging\\nTo Supplier: วันที่ชำระ (payment_date) มากสุด รูปแบบ MM/YYYY'],\n"
"    ['{TOTAL}', 'ยอด VAT รวม\\nที่มา: ผลรวม exp_vat ของรายการที่เข้าเงื่อนไขในเมลฉบับนั้น'],\n"
"    ['{AGING_LIST}', 'รายการ Aging รายเดือนพร้อมยอด (แดง/เขียวรายบรรทัด)\\nที่มา: ช่วง Aging ที่ตั้งในแท็บ เงื่อนไข คำนวณจากรายการ VAT Watchlist'],\n"
"    ['{BU_LIST}', 'ตาราง BU: ชื่อบริษัท, Tax ID, ช่วงเดือนที่ชำระ (Min-Max payment_date)\\nที่มา: ข้อมูลบริษัท/BU ที่ผูกกับรายการ'],\n"
"    ['{INVOICE_LIST}', 'ตารางใบแจ้งหนี้: BU, Invoice, Check No, วันที่ชำระ, VAT\\nสูงสุด 30 รายการ เรียง Aging มาก->น้อย (เกินจากนี้ดูในไฟล์แนบ)'],\n"
"  ].filter((p) => isSup || p[0] !== '{SUPPLIER}'); // MARKER_" + MARKER
)

def main():
    with open(TARGET, "r", encoding="utf-8", newline="") as f: src = f.read()
    bom = src.startswith("﻿")
    if MARKER in src: print("SKIP: patch นี้ถูกใช้แล้ว (%s)" % MARKER); return
    crlf = "\r\n" in src
    s = src.replace("\r\n", "\n")
    pat = re.compile(r"const MAIL_PH = \[\[.*?\]\]\.filter\(\(p\) => isSup \|\| p\[0\] !== '\{SUPPLIER\}'\);", re.S)
    n = len(pat.findall(s))
    if n != 1: print("ERROR: anchor MAIL_PH พบ %d ครั้ง (ต้อง 1) - ไม่เขียนไฟล์" % n); sys.exit(1)
    s = pat.sub(lambda m: NEW, s, count=1)
    if crlf: s = s.replace("\n", "\r\n")
    shutil.copyfile(TARGET, TARGET + ".bak")
    with open(TARGET, "w", encoding="utf-8-sig" if bom else "utf-8", newline="") as f: f.write(s)
    print("OK: patched ->", TARGET)
main()
