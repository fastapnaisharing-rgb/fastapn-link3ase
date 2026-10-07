# -*- coding: utf-8 -*-
# MARKER VATWATCHLISTOPS_TYPE_ABF_V6 -- มุมมอง Type: ตัดคอลัมน์ Popvat Type, วันที่ใช้สิทธิ์มาแทนที่หน้าสุด, Status(Clear) -> Remark -> Note ท้ายตาราง
import sys, os, shutil
P = os.path.join('src', 'pages', 'VatController.js')
MARK = 'VATWATCHLISTOPS_TYPE_ABF_V6'
s = open(P, 'rb').read().decode('utf-8')
if MARK in s: print('SKIP: patch นี้ถูกใช้แล้ว (%s)' % MARK); sys.exit(0)
old = "const TYPE_VIEW_COL_KEYS = ['status', 'remark', 'note', 'branch', 'invoice_ref', 'supplier_code', 'vendor_name', 'payment_date', 'check_date', 'check_no', 'receive_doc_date', 'receive_doc_no', 'exp_amount', 'exp_vat', 'type_action'];"
new = "const TYPE_VIEW_COL_KEYS = ['type_receive_date', 'branch', 'invoice_ref', 'supplier_code', 'vendor_name', 'payment_date', 'check_date', 'check_no', 'receive_doc_date', 'receive_doc_no', 'exp_amount', 'exp_vat', 'type_action', 'remark', 'note']; // MARKER_VATWATCHLISTOPS_TYPE_ABF_V6"
if s.count(old) != 1: print('ERROR: anchor พบ %d ครั้ง (ต้อง 1) - ไม่เขียนไฟล์' % s.count(old)); sys.exit(1)
if not os.path.exists(P + '.bak'): shutil.copy(P, P + '.bak')
open(P, 'wb').write(s.replace(old, new).encode('utf-8'))
print('OK: patched ->', P)
