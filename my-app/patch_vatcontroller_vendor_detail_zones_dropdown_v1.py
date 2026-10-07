# -*- coding: utf-8 -*-
"""patch_vatcontroller_vendor_detail_zones_dropdown_v1  (FRONTEND)
Modal "รายละเอียดผู้ค้า / เพิ่มข้อมูลผู้ค้า" (Vendor Category) ใน VatController.js
 1) ประเภท (TYPE) / ประเภทย่อย (SUB TYPE) เป็น Dropdown (SmComboBox พิมพ์กรองได้) ใช้ Logic เดียวกับ SM-Code / VendorMaster:
      - Type  = ค่า TYPE ที่ไม่ซ้ำจาก vendor_category
      - Sub Type = ค่า SUB TYPE ที่ไม่ซ้ำ "เฉพาะ Record ที่ TYPE ตรงกับ Type ที่เลือก" (ยังไม่เลือก Type / ไม่มี Record ตรง = แสดงทั้งหมด)
      - เลือก Type ใหม่แล้ว Sub Type เดิมไม่อยู่ใน Type นั้น = ล้าง Sub Type
 2) จัดฟอร์ม (ทั้งโหมด Add/Edit และโหมดดู) เป็น 2 Zone: ข้อมูลผู้ค้า (Information) / ติดต่อ (Contact = อีเมล + ชื่อผู้รับ)
รันที่โฟลเดอร์ my-app แล้ว npm run build
"""
import os, re, shutil, sys
TARGET = os.path.join("src", "pages", "VatController.js")
MARKER = "VATWATCHLISTOPS_VENDOR_DETAIL_ZONES_DROPDOWN_V1"

# ---------- 1) helper consts (ต่อท้าย const entColor ใน IIFE ของ Modal) ----------
ANCHOR_HELPER = "        const entColor = entityType ? '#ffffff' : 'rgba(255,255,255,0.75)';\n"
HELPER = ANCHOR_HELPER + r"""        // MARKER_VATWATCHLISTOPS_VENDOR_DETAIL_ZONES_DROPDOWN_V1 -- Dropdown Type/Sub Type (Logic เดียวกับ SM-Code Add Supplier / VendorMaster) + หัว Zone
        const vdForm = vendorDetailModal.form || {};
        const vdVc = (vendorCategories || []).map((i) => ({ t: String(i['TYPE'] || '').trim(), s: String(i['SUB TYPE'] || '').trim() }));
        const vdSort = (a) => [...new Set(a.filter(Boolean))].sort((x, y) => x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' }));
        const vdTypeOpts = vdSort(vdVc.map((i) => i.t));
        const vdSubByType = String(vdForm['TYPE'] || '').trim() ? vdSort(vdVc.filter((i) => i.t === String(vdForm['TYPE']).trim()).map((i) => i.s)) : [];
        const vdSubOpts = vdSubByType.length ? vdSubByType : vdSort(vdVc.map((i) => i.s));
        const vdOnTypeChange = (val) => setVendorDetailModal((prev) => {
          if (!prev || !prev.form) return prev;
          const v = String(val || '').trim();
          const known = vdVc.some((i) => i.t === v);
          const subs = vdVc.filter((i) => i.t === v).map((i) => i.s);
          const keepSub = !known || subs.includes(String(prev.form['SUB TYPE'] || '').trim());
          return { ...prev, form: { ...prev.form, 'TYPE': val, 'SUB TYPE': keepSub ? prev.form['SUB TYPE'] : '' } };
        });
        const vdCmbBox = { border: '0.5px solid #ccc', borderRadius: '6px', padding: '3px 0', background: 'white' };
        const vdLbl = { color: '#8a8f98' };
        const vdInp = { width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: '12px', border: '0.5px solid #ccc', borderRadius: '6px' };
        const vdZoneHd = (th, en) => (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', background: '#f1f5fb', borderRadius: '6px', padding: '5px 10px', marginBottom: '10px' }}>
            <span style={{ fontSize: '12px', fontWeight: '600', color: '#1a3a5c' }}>{th}</span>
            <span style={{ fontSize: '10px', color: '#8a8f98', letterSpacing: '0.04em' }}>{en}</span>
          </div>
        );
"""

# ---------- 2) ฟอร์มแก้ไข/เพิ่ม ----------
EDIT_START = re.compile(r"<div style=\{\{ display: 'grid', gridTemplateColumns: '84px 1fr', rowGap: '10px', columnGap: '12px', fontSize: '13px', alignItems: 'center' \}\}>\s*<div style=\{\{ color: '#8a8f98' \}\}>ชื่อผู้ค้า</div>")
EDIT_END = re.compile(r"เว้นว่าง = ใช้ชื่อผู้รับของ Config</div>\s*</div>\s*</div>(?=\s*</>)")
EDIT_NEW = r"""<div>
                    {vdZoneHd('ข้อมูลผู้ค้า', 'INFORMATION')}
                    <div style={{ display: 'grid', gridTemplateColumns: '84px 1fr', rowGap: '10px', columnGap: '12px', fontSize: '13px', alignItems: 'center' }}>
                      <div style={vdLbl}>ชื่อผู้ค้า</div>
                      <input value={vendorDetailModal.form['Supplier Name']} onChange={(e) => setVendorDetailFormField('Supplier Name', e.target.value)} style={vdInp} />
                      <div style={vdLbl}>เลขผู้เสียภาษี</div>
                      <input value={vendorDetailModal.form['TAX ID']} onChange={(e) => setVendorDetailFormField('TAX ID', e.target.value)} style={vdInp} />
                      <div style={vdLbl}>สาขาเลขที่</div>
                      <input value={vendorDetailModal.form['No.']} onChange={(e) => setVendorDetailFormField('No.', e.target.value)} style={vdInp} />
                      <div style={vdLbl}>BU</div>
                      <div>
                        <input value={vendorDetailModal.form['BU']} onChange={(e) => setVendorDetailFormField('BU', e.target.value)} style={vdInp} /> {/* MARKER_VATWATCHLISTOPS_VENDOR_DETAIL_ALLBU_REMARK_V1 */}
                        <div style={{ fontSize: '10px', color: '#aaa', marginTop: '3px' }}>พิมพ์ "All BU" เพื่อ Apply หมายเหตุนี้ไปยังผู้ค้ารายนี้ทุก BU</div>
                      </div>
                      <div style={vdLbl}>ประเภท</div>
                      <div style={vdCmbBox}><SmComboBox value={vendorDetailModal.form['TYPE'] || ''} onChange={vdOnTypeChange} options={vdTypeOpts} /></div>
                      <div style={vdLbl}>ประเภทย่อย</div>
                      <div style={vdCmbBox}><SmComboBox value={vendorDetailModal.form['SUB TYPE'] || ''} onChange={(val) => setVendorDetailFormField('SUB TYPE', val)} options={vdSubOpts} /></div>
                      <div style={vdLbl}>หมายเหตุ</div>
                      <input value={vendorDetailModal.form['REMARK']} onChange={(e) => setVendorDetailFormField('REMARK', e.target.value)} style={vdInp} />
                    </div>
                  </div>
                  <div style={{ marginTop: '18px' }}>
                    {vdZoneHd('ติดต่อ', 'CONTACT')}
                    <div style={{ display: 'grid', gridTemplateColumns: '84px 1fr', rowGap: '10px', columnGap: '12px', fontSize: '13px', alignItems: 'center' }}>
                      <div style={vdLbl}>อีเมล</div>
                      <div>
                        <input value={vendorDetailModal.form['EMAIL']} onChange={(e) => setVendorDetailFormField('EMAIL', e.target.value)} placeholder="a@x.com; b@x.com" style={vdInp} /> {/* MARKER_VATWATCHLISTOPS_VENDOR_DETAIL_EMAIL_V1 */}
                        <div style={{ fontSize: '10px', color: '#aaa', marginTop: '3px' }}>ใช้เป็นช่อง To ของเมล By Vendor (ผู้ค้า + BU นี้) -- ใส่ได้หลายอีเมล คั่นด้วย ;</div>
                      </div>
                      <div style={vdLbl}>ชื่อผู้รับ</div>{/* MARKER_VATWATCHLISTOPS_VENDOR_GREETING_NAME_V1 */}
                      <div>
                        <input value={vendorDetailModal.form['GREETING_NAME'] || ''} onChange={(e) => setVendorDetailFormField('GREETING_NAME', e.target.value)} placeholder="เช่น คุณนท, พี่ตู่" style={vdInp} />
                        <div style={{ fontSize: '10px', color: '#aaa', marginTop: '3px' }}>ใช้แทน {'{ชื่อผู้รับ}'} ในคำขึ้นต้นเมล By Vendor (Greeting Name) -- เว้นว่าง = ใช้ชื่อผู้รับของ Config</div>
                      </div>
                    </div>
                  </div>"""

# ---------- 3) โหมดดู ----------
VIEW_START = re.compile(r"<div style=\{\{ display: 'grid', gridTemplateColumns: '84px 1fr', rowGap: '10px', columnGap: '12px', fontSize: '13px' \}\}>\s*<div style=\{\{ color: '#8a8f98' \}\}>เลขผู้เสียภาษี</div><div style=\{\{ fontWeight: '500' \}\}>")
VIEW_END = re.compile(r"\{vd\['GREETING_NAME'\] \|\| '—'\}</div>\{/\* MARKER_VATWATCHLISTOPS_VENDOR_GREETING_NAME_V1 \*/\}\s*</div>")
VIEW_NEW = r"""<div>
                    {vdZoneHd('ข้อมูลผู้ค้า', 'INFORMATION')}
                    <div style={{ display: 'grid', gridTemplateColumns: '84px 1fr', rowGap: '10px', columnGap: '12px', fontSize: '13px', alignItems: 'center' }}>
                      <div style={vdLbl}>เลขผู้เสียภาษี</div><div style={{ fontWeight: '500' }}>{vd['TAX ID'] || '—'}</div>
                      <div style={vdLbl}>สาขาเลขที่</div><div>{vd['No.'] || '—'}</div>
                      <div style={vdLbl}>BU</div><div>{vd['BU'] || '—'}</div>
                      <div style={vdLbl}>ประเภท</div>
                      <div>{vd['TYPE'] ? <span style={{ background: '#e8f0fb', color: '#1a3a5c', padding: '3px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: '500' }}>{vd['TYPE']}</span> : <span style={{ color: '#ccc' }}>—</span>}</div>
                      <div style={vdLbl}>ประเภทย่อย</div>
                      <div>{vd['SUB TYPE'] ? <span style={{ background: '#f2f2f2', color: '#555', padding: '3px 9px', borderRadius: '20px', fontSize: '11px' }}>{vd['SUB TYPE']}</span> : <span style={{ color: '#ccc' }}>—</span>}</div>
                      <div style={vdLbl}>หมายเหตุ</div><div style={{ color: vd['REMARK'] ? '#333' : '#ccc' }}>{vd['REMARK'] || '—'}</div>
                    </div>
                  </div>
                  <div style={{ marginTop: '18px' }}>
                    {vdZoneHd('ติดต่อ', 'CONTACT')}
                    <div style={{ display: 'grid', gridTemplateColumns: '84px 1fr', rowGap: '10px', columnGap: '12px', fontSize: '13px', alignItems: 'center' }}>
                      <div style={vdLbl}>อีเมล</div><div style={{ color: vd['EMAIL'] ? '#333' : '#ccc', wordBreak: 'break-all', fontSize: '12px' }}>{vd['EMAIL'] || '—'}</div>{/* MARKER_VATWATCHLISTOPS_VENDOR_DETAIL_EMAIL_V1 */}
                      <div style={vdLbl}>ชื่อผู้รับ</div><div style={{ color: vd['GREETING_NAME'] ? '#333' : '#ccc', fontSize: '12px' }}>{vd['GREETING_NAME'] || '—'}</div>{/* MARKER_VATWATCHLISTOPS_VENDOR_GREETING_NAME_V1 */}
                    </div>
                  </div>"""


def bal(t):
    return [t.count(o) - t.count(c) for o, c in ("{}", "()", "[]")]


def main():
    with open(TARGET, "r", encoding="utf-8", newline="") as f:
        src = f.read()
    bom = src.startswith("﻿")
    if MARKER in src:
        print("SKIP: patch นี้ถูกใช้แล้ว (%s)" % MARKER); return
    crlf = "\r\n" in src
    s = src.replace("\r\n", "\n")

    if s.count(ANCHOR_HELPER) != 1:
        print("ERROR: anchor helper พบ %d ครั้ง (ต้อง 1) - ไม่เขียนไฟล์" % s.count(ANCHOR_HELPER)); sys.exit(1)

    spans = []
    for name, st, en in (("edit", EDIT_START, EDIT_END), ("view", VIEW_START, VIEW_END)):
        ms, me = list(st.finditer(s)), list(en.finditer(s))
        if len(ms) != 1 or len(me) != 1:
            print("ERROR: anchor %s start=%d end=%d (ต้อง 1/1) - ไม่เขียนไฟล์" % (name, len(ms), len(me))); sys.exit(1)
        a, b = ms[0].start(), me[0].end()
        if b <= a or b - a > 9000:
            print("ERROR: ช่วง %s ผิดปกติ (%d..%d) - ไม่เขียนไฟล์" % (name, a, b)); sys.exit(1)
        spans.append((a, b, name))

    # bracket balance: ของเดิมที่จะถูกแทน vs ของใหม่
    old_bal = [0, 0, 0]; new_bal = bal(EDIT_NEW)
    for a, b, name in spans:
        old = s[a:b]
        for i, v in enumerate(bal(old)): old_bal[i] += v
    new_total = [x + y for x, y in zip(bal(EDIT_NEW), bal(VIEW_NEW))]
    if old_bal != new_total:
        print("ERROR: bracket ไม่สมดุล old=%s new=%s - ไม่เขียนไฟล์" % (old_bal, new_total)); sys.exit(1)

    # แทนจากท้ายไฟล์ขึ้นมาเพื่อไม่ให้ index เลื่อน
    for a, b, name in sorted(spans, reverse=True):
        s = s[:a] + (EDIT_NEW if name == "edit" else VIEW_NEW) + s[b:]
    s = s.replace(ANCHOR_HELPER, HELPER, 1)

    if crlf:
        s = s.replace("\n", "\r\n")
    shutil.copyfile(TARGET, TARGET + ".bak")
    with open(TARGET, "w", encoding="utf-8-sig" if bom else "utf-8", newline="") as f:
        f.write(s)
    print("OK: patched ->", TARGET)


main()
