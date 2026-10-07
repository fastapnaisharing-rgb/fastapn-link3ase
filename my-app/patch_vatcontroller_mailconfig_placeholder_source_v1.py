# -*- coding: utf-8 -*-
"""patch_vatcontroller_mailconfig_placeholder_source_v1  (FRONTEND)
Mail Config:
 - To / ชื่อผู้รับ (เฉพาะ To Supplier): เลือกแหล่งข้อมูลได้ "ดึงจาก Vendor Category" (ค่าเริ่มต้น) หรือ "กำหนดเอง"
   (rules.to_source / rules.name_source = VENDOR | MANUAL) -- ถ้าดึงจาก Vendor Category ไม่บังคับกรอก To / ชื่อผู้รับ
 - แถบ Placeholder คลิกแทรกลงช่อง Subject / เนื้อหา (ตำแหน่งเคอร์เซอร์) รวม {INVOICE_LIST}
ต้องใช้คู่กับ patch_vatmailexport_mailconfig_source_invoice_v1.py (Backend)
รันที่โฟลเดอร์ my-app แล้ว npm run build
"""
import os, shutil, sys
TARGET = os.path.join("src", "pages", "VatController.js")
MARKER = "VATWATCHLISTOPS_MAILCFG_PLACEHOLDER_SOURCE_V1"

E = []
# 1) consts
E.append(("  const byVendorSupplier = form.send_type === 'SUPPLIER' && form.scope_mode === 'BY_VENDOR';",
r"""  const isSup = form.send_type === 'SUPPLIER'; const toManual = !isSup || form.rules.to_source === 'MANUAL'; const nameManual = !isSup || form.rules.name_source === 'MANUAL'; // MARKER_VATWATCHLISTOPS_MAILCFG_PLACEHOLDER_SOURCE_V1
  const MAIL_PH = [['{BU}', 'ชื่อ BU'], ['{DATE}', 'วันที่ส่ง'], ['{ชื่อผู้รับ}', 'ชื่อผู้รับ (Greeting Name)'], ['{SUPPLIER}', 'ชื่อ Supplier (To Supplier)'], ['{เดือนเริ่ม}', 'เดือนเริ่มต้น'], ['{เดือนสุดท้าย}', 'เดือนสุดท้าย'], ['{TOTAL}', 'ยอด VAT รวม'], ['{AGING_LIST}', 'รายการ Aging'], ['{BU_LIST}', 'ตาราง BU'], ['{INVOICE_LIST}', 'ตารางใบแจ้งหนี้ (สูงสุด 30 รายการ)']].filter((p) => isSup || p[0] !== '{SUPPLIER}');
  const insertPh = (tok) => { const el = document.activeElement; const key = ({ 'mailcfg-subject': 'subject_template', 'mailcfg-body': 'body_template' })[el && el.id]; if (!key) { setMsg('คลิกในช่อง Subject หรือเนื้อหาก่อน แล้วค่อยกด Placeholder'); return; } const v = String(form[key] || ''); const s = el.selectionStart == null ? v.length : el.selectionStart; const e2 = el.selectionEnd == null ? v.length : el.selectionEnd; setMsg(''); setForm({ ...form, [key]: v.slice(0, s) + tok + v.slice(e2) }); setTimeout(() => { try { el.focus(); el.setSelectionRange(s + tok.length, s + tok.length); } catch (_) {} }, 0); };
  const byVendorSupplier = form.send_type === 'SUPPLIER' && form.scope_mode === 'BY_VENDOR';""", 1))
# 2) validation
E.append(("const missingMail = [!String(form.mail_to || '').trim() && 'To', !String(form.mail_cc || '').trim() && 'CC', !String(form.rules.recipient_name || '').trim() && 'ชื่อผู้รับ'].filter(Boolean);",
"const missingMail = [toManual && !String(form.mail_to || '').trim() && 'To', !String(form.mail_cc || '').trim() && 'CC', nameManual && !String(form.rules.recipient_name || '').trim() && 'ชื่อผู้รับ'].filter(Boolean); // MARKER_VATWATCHLISTOPS_MAILCFG_PLACEHOLDER_SOURCE_V1 -- To Supplier ดึงจาก Vendor Category = ไม่บังคับ To/ชื่อผู้รับ", 1))
# 3) To field
E.append(("""<div><div style={lbl}>To (คั่นด้วย ;) <span style={{ color: '#e65100' }}>*</span></div><input style={reqInp(form.mail_to)} value={form.mail_to} onChange={(e) => setForm({ ...form, mail_to: e.target.value })} /></div>""",
r"""<div>
                      <div style={lbl}>To (คั่นด้วย ;) {toManual && <span style={{ color: '#e65100' }}>*</span>}</div>
                      {isSup && (
                        <select style={{ ...inp, marginBottom: '4px', background: '#f5f9ff' }} value={form.rules.to_source || 'VENDOR'} onChange={(e) => setForm({ ...form, rules: { ...form.rules, to_source: e.target.value } })}>
                          <option value="VENDOR">ดึงจาก Vendor Category (EMAIL) ของผู้ค้าแต่ละราย</option>
                          <option value="MANUAL">กำหนดเอง (ใช้ To นี้กับทุกราย)</option>
                        </select>
                      )}
                      <input style={toManual ? reqInp(form.mail_to) : { ...inp, background: '#f5f5f5', color: '#aaa' }} disabled={!toManual} value={toManual ? form.mail_to : ''} placeholder={toManual ? '' : 'ระบบดึงอีเมลจาก Vendor Category ให้อัตโนมัติ'} onChange={(e) => setForm({ ...form, mail_to: e.target.value })} />
                    </div>""", 1))
# 4) recipient name
E.append(("""<div style={{ marginBottom: '10px' }}><div style={lbl}>ชื่อผู้รับ (ใช้แทน {'{ชื่อผู้รับ}'} ในคำเรียก) <span style={{ color: '#e65100' }}>*</span></div><input style={reqInp(form.rules.recipient_name)} value={form.rules.recipient_name || ''} onChange={(e) => setForm({ ...form, rules: { ...form.rules, recipient_name: e.target.value } })} placeholder="เช่น พี่ตู่, นท" /></div>""",
r"""<div style={{ marginBottom: '10px' }}>
                    <div style={lbl}>ชื่อผู้รับ (ใช้แทน {'{ชื่อผู้รับ}'} ในคำเรียก) {nameManual && <span style={{ color: '#e65100' }}>*</span>}</div>
                    {isSup && (
                      <select style={{ ...inp, marginBottom: '4px', background: '#f5f9ff' }} value={form.rules.name_source || 'VENDOR'} onChange={(e) => setForm({ ...form, rules: { ...form.rules, name_source: e.target.value } })}>
                        <option value="VENDOR">ดึงจาก Vendor Category (Greeting Name) ของผู้ค้าแต่ละราย</option>
                        <option value="MANUAL">กำหนดเอง (ใช้ชื่อนี้กับทุกราย)</option>
                      </select>
                    )}
                    <input style={nameManual ? reqInp(form.rules.recipient_name) : { ...inp, background: '#f5f5f5' }} value={form.rules.recipient_name || ''} onChange={(e) => setForm({ ...form, rules: { ...form.rules, recipient_name: e.target.value } })} placeholder={nameManual ? 'เช่น พี่ตู่, นท' : 'ชื่อสำรอง ถ้าผู้ค้านั้นไม่มี Greeting Name (ไม่บังคับ)'} />
                  </div>""", 1))
# 5) ids on subject/body
E.append(("""<div style={lbl}>Subject</div><input style={inp} value={form.subject_template}""", """<div style={lbl}>Subject</div><input id="mailcfg-subject" style={inp} value={form.subject_template}""", 1))
E.append(("""<textarea style={{ ...inp, height: '130px', resize: 'none', fontFamily: 'inherit', lineHeight: 1.5 }} value={form.body_template}""", """<textarea id="mailcfg-body" style={{ ...inp, height: '130px', resize: 'none', fontFamily: 'inherit', lineHeight: 1.5 }} value={form.body_template}""", 1))
# 6) chips + hint
E.append(("""<div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                    <button type="button" onClick={saveDraft}""",
r"""<div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', color: '#666' }}>Placeholder (คลิกช่อง Subject/เนื้อหา แล้วกดเพื่อแทรก):</span>
                    {MAIL_PH.map(([tok, tip]) => (
                      <button key={tok} type="button" title={tip} onMouseDown={(e) => e.preventDefault()} onClick={() => insertPh(tok)} style={{ ...pill('#f1f5fb', '#c5d3e8', '#1a3a5c'), padding: '2px 8px', fontSize: '11px' }}>{tok}</button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                    <button type="button" onClick={saveDraft}""", 1))
E.append(("ตัวแปร: {'{BU} {DATE} {ชื่อผู้รับ} {เดือนเริ่ม} {เดือนสุดท้าย} {AGING_LIST}'} · แก้แล้ว", "ชี้เมาส์ที่ Placeholder เพื่อดูความหมาย · แก้แล้ว", 1))

def main():
    with open(TARGET, "r", encoding="utf-8", newline="") as f: src = f.read()
    bom = src.startswith("﻿")
    if MARKER in src: print("SKIP: patch นี้ถูกใช้แล้ว (%s)" % MARKER); return
    crlf = "\r\n" in src
    s = src.replace("\r\n", "\n")
    for a, _, n in E:
        if s.count(a) != n: print("ERROR: anchor พบ %d ครั้ง (ต้อง %d) - ไม่เขียนไฟล์\n%s" % (s.count(a), n, a[:90])); sys.exit(1)
    for a, b, n in E: s = s.replace(a, b)
    for o, c in ("{}", "()", "[]"):
        da = sum((x.count(o) - x.count(c)) * n for x, _, n in E); dn = sum((y.count(o) - y.count(c)) * n for _, y, n in E)
        if da != dn: print("ERROR: bracket %s%s ไม่สมดุล - ไม่เขียนไฟล์" % (o, c)); sys.exit(1)
    if crlf: s = s.replace("\n", "\r\n")
    shutil.copyfile(TARGET, TARGET + ".bak")
    with open(TARGET, "w", encoding="utf-8-sig" if bom else "utf-8", newline="") as f: f.write(s)
    print("OK: patched ->", TARGET)
main()
