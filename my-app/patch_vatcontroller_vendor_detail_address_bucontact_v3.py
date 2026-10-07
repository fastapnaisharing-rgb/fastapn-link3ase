# -*- coding: utf-8 -*-
"""patch_vatcontroller_vendor_detail_address_bucontact_v3  (FRONTEND)
Modal รายละเอียดผู้ค้า (Vendor Category) เพิ่มช่องใหม่ (คอลัมน์ใน vendor_category ที่ ALTER TABLE ไว้แล้ว):
 - ซ้าย / ข้อมูลผู้ค้า : ที่อยู่ (ADDRESS), เบอร์โทร (PHONE)  -> ใช้ร่วมกันทุก BU: บันทึกแล้วอัปเดตทุกแถวที่ TAX ID เดียวกันให้อัตโนมัติ
 - ขวา / BU Contact (เจ้าของงาน): ชื่อ (BU_CONTACT_NAME), อีเมล (BU_CONTACT_EMAIL), เบอร์โทร (BU_CONTACT_PHONE) -> แยกตาม BU (1 แถว = 1 ผู้ค้า + BU)
ต้องรันหลัง zones_dropdown_v1 และ two_columns_v2  |  รันที่โฟลเดอร์ my-app แล้ว npm run build
"""
import os, re, shutil, sys
TARGET = os.path.join("src", "pages", "VatController.js")
MARKER = "VATWATCHLISTOPS_VENDOR_DETAIL_ADDRESS_BUCONTACT_V3"
NEWKEYS = ("ADDRESS", "PHONE", "BU_CONTACT_NAME", "BU_CONTACT_EMAIL", "BU_CONTACT_PHONE")

INP = "style={vdInp}"
HINT = "style={{ fontSize: '10px', color: '#aaa', marginTop: '3px' }}"


def jsx_edit_info():
    return r"""onChange={(e) => setVendorDetailFormField('REMARK', e.target.value)} style={vdInp} />
                      <div style={vdLbl}>ที่อยู่</div>{/* MARKER_VATWATCHLISTOPS_VENDOR_DETAIL_ADDRESS_BUCONTACT_V3 */}
                      <div>
                        <textarea rows={3} value={vendorDetailModal.form['ADDRESS'] || ''} onChange={(e) => setVendorDetailFormField('ADDRESS', e.target.value)} style={{ ...vdInp, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.4 }} />
                        <div style={{ fontSize: '10px', color: '#aaa', marginTop: '3px' }}>ใช้ร่วมกันทุก BU ของผู้ค้านี้ (Tax ID เดียวกัน) -- บันทึกแล้วระบบอัปเดตให้ทุก BU อัตโนมัติ</div>
                      </div>
                      <div style={vdLbl}>เบอร์โทร</div>
                      <input value={vendorDetailModal.form['PHONE'] || ''} onChange={(e) => setVendorDetailFormField('PHONE', e.target.value)} style={vdInp} />"""


def jsx_edit_bu():
    return r"""
                    <div style={{ marginTop: '18px' }}>
                      {vdZoneHd('BU Contact (เจ้าของงาน)', 'BU OWNER')}
                      <div style={{ display: 'grid', gridTemplateColumns: '84px 1fr', rowGap: '10px', columnGap: '12px', fontSize: '13px', alignItems: 'center' }}>
                        <div style={vdLbl}>ชื่อ</div>
                        <input value={vendorDetailModal.form['BU_CONTACT_NAME'] || ''} onChange={(e) => setVendorDetailFormField('BU_CONTACT_NAME', e.target.value)} style={vdInp} />
                        <div style={vdLbl}>อีเมล</div>
                        <input value={vendorDetailModal.form['BU_CONTACT_EMAIL'] || ''} onChange={(e) => setVendorDetailFormField('BU_CONTACT_EMAIL', e.target.value)} placeholder="a@x.com" style={vdInp} />
                        <div style={vdLbl}>เบอร์โทร</div>
                        <div>
                          <input value={vendorDetailModal.form['BU_CONTACT_PHONE'] || ''} onChange={(e) => setVendorDetailFormField('BU_CONTACT_PHONE', e.target.value)} style={vdInp} />
                          <div style={{ fontSize: '10px', color: '#aaa', marginTop: '3px' }}>ผู้ดูแลงานฝั่ง BU -- แยกตาม BU (ผู้ค้ารายเดียวกันต่าง BU ใส่คนละคนได้)</div>
                        </div>
                      </div>
                    </div>"""


def jsx_view_info():
    return r"""<div style={vdLbl}>หมายเหตุ</div><div style={{ color: vd['REMARK'] ? '#333' : '#ccc' }}>{vd['REMARK'] || '—'}</div>
                      <div style={vdLbl}>ที่อยู่</div><div style={{ color: vd['ADDRESS'] ? '#333' : '#ccc', fontSize: '12px', whiteSpace: 'pre-wrap' }}>{vd['ADDRESS'] || '—'}</div>{/* MARKER_VATWATCHLISTOPS_VENDOR_DETAIL_ADDRESS_BUCONTACT_V3 */}
                      <div style={vdLbl}>เบอร์โทร</div><div style={{ color: vd['PHONE'] ? '#333' : '#ccc', fontSize: '12px' }}>{vd['PHONE'] || '—'}</div>"""


def jsx_view_bu():
    return r"""
                    <div style={{ marginTop: '18px' }}>
                      {vdZoneHd('BU Contact (เจ้าของงาน)', 'BU OWNER')}
                      <div style={{ display: 'grid', gridTemplateColumns: '84px 1fr', rowGap: '10px', columnGap: '12px', fontSize: '13px', alignItems: 'center' }}>
                        <div style={vdLbl}>ชื่อ</div><div style={{ color: vd['BU_CONTACT_NAME'] ? '#333' : '#ccc', fontSize: '12px' }}>{vd['BU_CONTACT_NAME'] || '—'}</div>
                        <div style={vdLbl}>อีเมล</div><div style={{ color: vd['BU_CONTACT_EMAIL'] ? '#333' : '#ccc', wordBreak: 'break-all', fontSize: '12px' }}>{vd['BU_CONTACT_EMAIL'] || '—'}</div>
                        <div style={vdLbl}>เบอร์โทร</div><div style={{ color: vd['BU_CONTACT_PHONE'] ? '#333' : '#ccc', fontSize: '12px' }}>{vd['BU_CONTACT_PHONE'] || '—'}</div>
                      </div>
                    </div>"""


SYNC_FN = r"""  // MARKER_VATWATCHLISTOPS_VENDOR_DETAIL_ADDRESS_BUCONTACT_V3 -- ที่อยู่/เบอร์โทรใช้ร่วมกันทุก BU: Apply ไปทุกแถว vendor_category ที่ TAX ID เดียวกัน (ข้ามถ้าไม่มี Tax ID หรือค่าว่างทั้งคู่)
  const syncVendorAddrPhoneToSiblings = async (taxRaw, excludeId, addr, phone, nowIso) => {
    const digits = String(taxRaw || '').replace(/[^0-9]/g, '');
    if (!digits || (!String(addr || '').trim() && !String(phone || '').trim())) return 0;
    let n = 0;
    try {
      const all = await apiFetch('/vendor_category').catch(() => []);
      const sibs = (Array.isArray(all) ? all : []).filter((v) => v.id !== excludeId && String(v['TAX ID'] || '').replace(/[^0-9]/g, '') === digits && (String(v['ADDRESS'] || '') !== String(addr || '') || String(v['PHONE'] || '') !== String(phone || '')));
      for (const sb of sibs) {
        try { await apiFetch(`/vendor_category/${sb.id}`, { method: 'PUT', body: JSON.stringify({ ADDRESS: addr || '', PHONE: phone || '', username, last_update: nowIso }) }); n += 1; } catch (errSb) { console.warn('sync address/phone to sibling BU failed:', sb.id, errSb?.message); }
      }
    } catch (errAll) { console.warn('sync address/phone siblings error:', errAll?.message); }
    return n;
  };
"""


def one(s, a, name):
    if s.count(a) != 1:
        print("ERROR: anchor %s พบ %d ครั้ง (ต้อง 1) - ไม่เขียนไฟล์" % (name, s.count(a))); sys.exit(1)


def main():
    with open(TARGET, "r", encoding="utf-8", newline="") as f:
        src = f.read()
    bom = src.startswith("﻿")
    if MARKER in src:
        print("SKIP: patch นี้ถูกใช้แล้ว (%s)" % MARKER); return
    for need in ("VATWATCHLISTOPS_VENDOR_DETAIL_ZONES_DROPDOWN_V1", "VATWATCHLISTOPS_VENDOR_DETAIL_TWO_COLUMNS_V2"):
        if need not in src:
            print("ERROR: ต้องรัน patch ก่อนหน้า (%s) ก่อน - ไม่เขียนไฟล์" % need); sys.exit(1)
    crlf = "\r\n" in src
    s = src.replace("\r\n", "\n")
    orig = s

    # 1) form init (Edit + Add)
    a1 = "          'GREETING_NAME': d['GREETING_NAME'] || '', // MARKER_VATWATCHLISTOPS_VENDOR_GREETING_NAME_V1\n"
    one(s, a1, "init-edit")
    s = s.replace(a1, a1 + "".join("          '%s': d['%s'] || '',\n" % (k, k) for k in NEWKEYS), 1)
    a2 = "'EMAIL': '', 'GREETING_NAME': '', // MARKER_VATWATCHLISTOPS_VENDOR_GREETING_NAME_V1\n"
    one(s, a2, "init-add")
    s = s.replace(a2, a2 + "        " + " ".join("'%s': ''," % k for k in NEWKEYS) + "\n", 1)

    # 2) sync fn + calls
    a3 = "  const saveVendorDetailEdit = async () => {\n"
    one(s, a3, "save-fn")
    s = s.replace(a3, SYNC_FN + a3, 1)
    a4 = "      setVendorDetailModal((prev) => ({ ...prev, loading: false, saving: false, editing: false, form: null, data: { ...prev.data, ...updated } }));\n"
    one(s, a4, "save-edit-end")
    s = s.replace(a4, "      if (String(f['ADDRESS'] || '') !== String(vendorDetailModal.data['ADDRESS'] || '') || String(f['PHONE'] || '') !== String(vendorDetailModal.data['PHONE'] || '')) await syncVendorAddrPhoneToSiblings(f['TAX ID'], vdId, f['ADDRESS'], f['PHONE'], nowIso); // MARKER_VATWATCHLISTOPS_VENDOR_DETAIL_ADDRESS_BUCONTACT_V3\n" + a4, 1)
    a5 = "        setVendorDetailModal((prev) => ({ ...prev, loading: false, saving: false, editing: false, adding: false, form: null, data: (created"
    one(s, a5, "save-add-end")
    s = s.replace(a5, "        await syncVendorAddrPhoneToSiblings(f['TAX ID'], created && created.id, f['ADDRESS'], f['PHONE'], nowIso); // MARKER_VATWATCHLISTOPS_VENDOR_DETAIL_ADDRESS_BUCONTACT_V3\n" + a5, 1)

    # 3) JSX edit
    a6 = "onChange={(e) => setVendorDetailFormField('REMARK', e.target.value)} style={vdInp} />"
    one(s, a6, "jsx-edit-remark")
    s = s.replace(a6, jsx_edit_info(), 1)
    m = list(re.finditer(r"เว้นว่าง = ใช้ชื่อผู้รับของ Config</div>\s*</div>\s*</div>", s))
    if len(m) != 1:
        print("ERROR: anchor jsx-edit-contact-end พบ %d (ต้อง 1) - ไม่เขียนไฟล์" % len(m)); sys.exit(1)
    s = s[:m[0].end()] + jsx_edit_bu() + s[m[0].end():]

    # 4) JSX view
    a7 = "<div style={vdLbl}>หมายเหตุ</div><div style={{ color: vd['REMARK'] ? '#333' : '#ccc' }}>{vd['REMARK'] || '—'}</div>"
    one(s, a7, "jsx-view-remark")
    s = s.replace(a7, jsx_view_info(), 1)
    m = list(re.finditer(r"\{vd\['GREETING_NAME'\] \|\| '—'\}</div>\{/\* MARKER_VATWATCHLISTOPS_VENDOR_GREETING_NAME_V1 \*/\}\s*</div>", s))
    if len(m) != 1:
        print("ERROR: anchor jsx-view-contact-end พบ %d (ต้อง 1) - ไม่เขียนไฟล์" % len(m)); sys.exit(1)
    s = s[:m[0].end()] + jsx_view_bu() + s[m[0].end():]

    for o, c in ("{}", "()", "[]"):
        pass  # bracket รวมทั้งไฟล์ถูกตรวจด้วย build (esbuild) ก่อนส่งมอบ

    if crlf:
        s = s.replace("\n", "\r\n")
    shutil.copyfile(TARGET, TARGET + ".bak")
    with open(TARGET, "w", encoding="utf-8-sig" if bom else "utf-8", newline="") as f:
        f.write(s)
    print("OK: patched ->", TARGET)


main()
