# -*- coding: utf-8 -*-
# patch: เก็บ SM-Code ลงแถว Simple Input Draft (คอลัมน์ sm_code ซ่อน ไม่แสดงใน Draft Monitor / supplier_code ยัง null ตามกติกาเดิม)
#        และ Dropdown ที่ช่อง Code อ่านกลับมาใช้ (Draft เก่าที่ไม่มี sm_code -> หาจาก Tax ID + สาขาของแถวนั้น)
import sys
p = sys.argv[1]; o = sys.argv[2]
s = open(p, encoding='utf-8-sig').read()
def rep(a, b):
    global s
    assert s.count(a) == 1, (s.count(a), a[:70])
    s = s.replace(a, b)
# 1) บันทึก Draft จาก GL-TransferVat
rep("cpc_tax_special: null, supplier_code: null, supplier_name: supplierNameFP || null,",
    "cpc_tax_special: null, supplier_code: null, sm_code: String(qaGlSupplierCode || '').trim() || null, /* MARKER_QA_GL_DRAFT_SMCODE_V1 -- เก็บ SM-Code ไว้เรียกใช้ซ้ำ (ซ่อน ไม่แสดง) */ supplier_name: supplierNameFP || null,")
# 2) Dropdown: อ่าน sm_code / fallback Tax ID + Branch
rep("""          const code = String(r.supplier_code || '').trim(); const nm0 = String(r.supplier_name || '').trim(); const key = code || `name:${nm0}`; if (!code && !nm0) return;""",
"""          let code = String(r.sm_code || '').trim(); const nm0 = String(r.supplier_name || '').trim();
          if (!code) { // Draft เก่าที่ยังไม่มี sm_code -> หาจาก Tax ID + สาขา (ข้อมูลของแถว Draft เอง) ต้องเจอตัวเดียวเท่านั้น
            const tx = String(r.tax_id || '').trim(); const br = String(r.branch_no || '').trim();
            if (tx) { const hit = [...(addTaxInvoiceSmCodeListData || []), ...(smCodes || [])].filter((x) => String(x['Tax ID'] || '').trim() === tx && (!br || String(x['Branch'] || '').trim() === br)); const cs = [...new Set(hit.map((x) => String(x['SM-Code'] || '').trim()).filter(Boolean))]; if (cs.length === 1) code = cs[0]; }
          }
          const key = code || `name:${nm0}`; if (!code && !nm0) return;""")
open(o, 'w', encoding='utf-8-sig', newline='').write(s)
