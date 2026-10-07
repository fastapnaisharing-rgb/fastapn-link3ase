# -*- coding: utf-8 -*-
# MARKER VATWATCHLISTOPS_TYPE_ABF_V7 -- Popvat A/B/F: Aging เป็น Uncount (aging_months NULL, label 'IV-Aging Uncount') เก็บค่าเดิมใน type_prev_aging ; Clear คืนค่าเดิม
import sys, os, shutil
P = os.path.join('src', 'pages', 'VatController.js')
MARK = 'VATWATCHLISTOPS_TYPE_ABF_V7'
s = open(P, 'rb').read().decode('utf-8')
if MARK in s: print('SKIP: patch นี้ถูกใช้แล้ว (%s)' % MARK); sys.exit(0)
crlf = '\r\n' in s
def fx(t): return t.replace('\n', '\r\n') if crlf else t
a1 = "const MAIL_CFG_AGING = ["
helper = fx("// MARKER_VATWATCHLISTOPS_TYPE_ABF_V7 -- Clear แถว Type: คืน Aging เดิมที่เก็บไว้ตอน Popvat\nconst typeRestoreAging = (r) => { try { const p = JSON.parse((r && r.type_prev_aging) || ''); return { aging_label: (p.l === undefined ? null : p.l), aging_months: (p.m === undefined ? null : p.m), type_prev_aging: null }; } catch (e) { return { type_prev_aging: null }; } };\n")
a2 = "{ status: `type_${popCode.toLowerCase()}`, remark: popRemark || null,"
n2 = "{ status: `type_${popCode.toLowerCase()}`, aging_label: 'IV-Aging Uncount', aging_months: null, type_prev_aging: JSON.stringify({ l: (r.aging_label === undefined ? null : r.aging_label), m: (r.aging_months === undefined ? null : r.aging_months) }), remark: popRemark || null,"
a3 = "{ status: 'pending', type_receive_date: null, remark: null }"
n3 = "{ status: 'pending', type_receive_date: null, remark: null, ...typeRestoreAging(r) }"
if s.count(a1) != 1 or s.count(a2) != 1 or s.count(a3) != 3:
    print('ERROR: anchor ไม่ตรง a1=%d a2=%d a3=%d (ต้อง 1/1/3) - ไม่เขียนไฟล์' % (s.count(a1), s.count(a2), s.count(a3))); sys.exit(1)
s = s.replace(a1, helper + a1, 1).replace(a2, n2).replace(a3, n3)
if not os.path.exists(P + '.bak'): shutil.copy(P, P + '.bak')
open(P, 'wb').write(s.encode('utf-8'))
print('OK: patched ->', P)
