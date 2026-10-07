# -*- coding: utf-8 -*-
"""patch_vatmailexport_mailconfig_source_invoice_v1  (BACKEND)
 - rules.to_source = MANUAL -> To Supplier ใช้ cfg.mail_to กับทุกราย (ค่าเริ่มต้น VENDOR = Vendor Category -> supplier_list)
 - rules.name_source = MANUAL -> {ชื่อผู้รับ} ใช้ชื่อของ Config เสมอ (ค่าเริ่มต้น VENDOR = Greeting Name ของผู้ค้า, ว่าง = ชื่อ Config)
 - {INVOICE_LIST} = ตารางใบแจ้งหนี้ (BU, Invoice, Check No, วันที่ชำระ, VAT) สูงสุด 30 รายการ เรียง Aging มาก->น้อย
ควรรัน patch_vatmailexport_vendor_greeting_v1.py ก่อน แล้ว Restart-Service fastapn-backend
รันบน Server ที่โฟลเดอร์ backend
"""
import os, shutil, sys
TARGET = os.path.join("src", "routes", "vatMailExport.js")
MARKER = "VATMAILEXPORT_INVOICE_LIST_V1"
E = []
E.append(('function buildBodyHtml(template, vars, lines, buListHtml) {', 'function buildBodyHtml(template, vars, lines, buListHtml, invoiceHtml) {', 1))
E.append(('  const html = String(template || "").split("{BU_LIST}").map(renderSeg).join(buListHtml || "");',
          '  const html = String(template || "").split("{INVOICE_LIST}").map((t) => t.split("{BU_LIST}").map(renderSeg).join(buListHtml || "")).join(invoiceHtml || ""); // MARKER_VATMAILEXPORT_INVOICE_LIST_V1', 1))
E.append(('    const vars = {\n      ...baseVars, ...extra,',
r'''    // MARKER_VATMAILEXPORT_INVOICE_LIST_V1 -- {INVOICE_LIST}: ตารางใบแจ้งหนี้ (สูงสุด 30 รายการ เรียง Aging มาก -> น้อย)
    const invSorted = [...subset].sort((a, b) => Number(b.aging_months) - Number(a.aging_months));
    const invShow = invSorted.slice(0, 30); const invMore = invSorted.length - invShow.length;
    const fmtD = (d) => { if (!d) return ""; const t = new Date(d); return isNaN(t) ? String(d) : t.toLocaleDateString("en-GB"); };
    const invText = invShow.map((r) => `${r.bu || ""} | ${r.invoice_ref || ""} | ${r.check_no || ""} | ${fmtD(r.payment_date)} | ${fmtMoney(num(r.exp_vat))}`).join("\n") + (invMore > 0 ? `\n... และอีก ${invMore} รายการ (ดูในไฟล์แนบ)` : "");
    const tdS = "border:1px solid #bbb;padding:3px 8px";
    const invoiceHtml = invShow.length
      ? `<table style="border-collapse:collapse;font-size:10pt"><tr>${["BU", "Invoice", "Check No", "วันที่ชำระ", "VAT"].map((h) => `<th style="${tdS};background:#f0f0f0">${h}</th>`).join("")}</tr>${invShow.map((r) => `<tr><td style="${tdS}">${escHtml(r.bu)}</td><td style="${tdS}">${escHtml(r.invoice_ref)}</td><td style="${tdS}">${escHtml(r.check_no)}</td><td style="${tdS}">${escHtml(fmtD(r.payment_date))}</td><td style="${tdS};text-align:right">${escHtml(fmtMoney(num(r.exp_vat)))}</td></tr>`).join("")}</table>${invMore > 0 ? `<div style="font-size:10pt;color:#666">... และอีก ${invMore} รายการ (ดูในไฟล์แนบ)</div>` : ""}`
      : "";
    const vars = {
      ...baseVars, ...extra,
      INVOICE_LIST: invText,''', 1))
E.append(('    return { lines, vars, buList };', '    return { lines, vars, buList, invoiceHtml };', 1))
E.append(('const { vars, lines, buList } = makeVars(', 'const { vars, lines, buList, invoiceHtml } = makeVars(', 2))
E.append(('buildBodyHtml(cfg.body_template, vars, lines, buListHtmlOf(buList)),', 'buildBodyHtml(cfg.body_template, vars, lines, buListHtmlOf(buList), invoiceHtml),', 2))
E.append(('      const to = resolveTo(code, sub);', '      const to = (rules.to_source === "MANUAL" && String(cfg.mail_to || "").trim()) ? splitMails(cfg.mail_to).join("; ") : resolveTo(code, sub); // MARKER_VATMAILEXPORT_INVOICE_LIST_V1 -- to_source', 1))
E.append(('const greetName = resolveGreeting(code, sub);', 'const greetName = rules.name_source === "MANUAL" ? "" : resolveGreeting(code, sub);', 1))

def main():
    with open(TARGET, "r", encoding="utf-8", newline="") as f: src = f.read()
    bom = src.startswith("﻿")
    if MARKER in src: print("SKIP: patch นี้ถูกใช้แล้ว (%s)" % MARKER); return
    crlf = "\r\n" in src
    s = src.replace("\r\n", "\n")
    for a, _, n in E:
        if s.count(a) != n: print("ERROR: anchor พบ %d ครั้ง (ต้อง %d) - ไม่เขียนไฟล์\n%s" % (s.count(a), n, a[:90])); sys.exit(1)
    for a, b, n in E: s = s.replace(a, b)
    if crlf: s = s.replace("\n", "\r\n")
    shutil.copyfile(TARGET, TARGET + ".bak")
    with open(TARGET, "w", encoding="utf-8-sig" if bom else "utf-8", newline="") as f: f.write(s)
    print("OK: patched ->", TARGET)
main()
