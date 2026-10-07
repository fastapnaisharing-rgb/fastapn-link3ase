# -*- coding: utf-8 -*-
"""patch_vatmailexport_vendor_greeting_v1  (BACKEND)
เมล To Supplier: {ชื่อผู้รับ} = vendor_category."GREETING_NAME" ของ Supplier+BU นั้น (ไม่มีของ BU นี้ใช้ของ BU อื่นของ Supplier เดียวกัน)
ถ้าว่าง/ยังไม่มีคอลัมน์ = ใช้ชื่อผู้รับของ Config เหมือนเดิม (ไม่ Error)
ต้องรัน add_greeting_name_to_vendor_category.sql ก่อน แล้ว Restart-Service fastapn-backend
รันบน Server ที่โฟลเดอร์ backend (มี src\\routes\\vatMailExport.js)
"""
import os, shutil, sys

TARGET = os.path.join("src", "routes", "vatMailExport.js")
MARKER = "VATMAILEXPORT_VENDOR_GREETING_V1"

A1 = "    const splitMails = (t) =>"
N1 = '''    // MARKER_VATMAILEXPORT_VENDOR_GREETING_V1 -- Greeting Name ต่อผู้ค้า+BU จาก vendor_category."GREETING_NAME" ใช้เป็น {ชื่อผู้รับ} (ว่าง = ใช้ของ Config)
    const greetByCodeBu = {}; const greetByCode = {};
    try {
      const { rows: gv } = await pool.query(`SELECT "Code", "BU", "GREETING_NAME" FROM vendor_category WHERE "Code" = ANY($1) AND COALESCE(TRIM("GREETING_NAME"), '') <> ''`, [codes]);
      gv.forEach((v) => { const g = String(v.GREETING_NAME || "").trim(); const k = `${String(v.Code).trim()}|${String(v.BU || "").trim()}`; if (!greetByCodeBu[k]) greetByCodeBu[k] = g; if (!greetByCode[v.Code]) greetByCode[v.Code] = g; });
    } catch (e) { console.error("vendor_category GREETING_NAME:", e.message); } // ยังไม่ได้เพิ่มคอลัมน์ = ข้าม ใช้ชื่อผู้รับของ Config
    const resolveGreeting = (code, sub) => {
      for (const b of new Set(sub.map((r) => String(r.bu || "").trim()))) { const g = greetByCodeBu[`${String(code).trim()}|${b}`]; if (g) return g; }
      return greetByCode[code] || "";
    };
'''
A2 = '      const { vars, lines, buList } = makeVars(sub, { SUPPLIER: name, "Supplier Name": name });'
N2 = '      const greetName = resolveGreeting(code, sub); // MARKER_VATMAILEXPORT_VENDOR_GREETING_V1\n      const { vars, lines, buList } = makeVars(sub, { SUPPLIER: name, "Supplier Name": name, ...(greetName ? { "ชื่อผู้รับ": greetName } : {}) });'

EDITS = [(A1, N1 + A1), (A2, N2)]

def main():
    with open(TARGET, "r", encoding="utf-8", newline="") as f:
        src = f.read()
    bom = src.startswith("﻿")
    if MARKER in src:
        print("SKIP: patch นี้ถูกใช้แล้ว (%s)" % MARKER); return
    crlf = "\r\n" in src
    s = src.replace("\r\n", "\n")
    for a, _ in EDITS:
        if s.count(a) != 1:
            print("ERROR: anchor พบ %d ครั้ง (ต้องเป็น 1) - ไม่เขียนไฟล์\n%s" % (s.count(a), a[:80])); sys.exit(1)
    for a, b in EDITS:
        s = s.replace(a, b)
    for a, b in ("{}", "()", "[]"):
        da = sum(x.count(a) - x.count(b) for x, _ in EDITS); dn = sum(y.count(a) - y.count(b) for _, y in EDITS)
        if da != dn:
            print("ERROR: bracket %s%s ไม่สมดุล - ไม่เขียนไฟล์" % (a, b)); sys.exit(1)
    if crlf: s = s.replace("\n", "\r\n")
    shutil.copyfile(TARGET, TARGET + ".bak")
    with open(TARGET, "w", encoding="utf-8-sig" if bom else "utf-8", newline="") as f:
        f.write(s)
    print("OK: patched ->", TARGET)

main()
