# -*- coding: utf-8 -*-
# MARKER VATWATCHLISTOPS_TYPE_ABF_V5 -- โหลดรายการ Type A/B/F ด้วย eq_status 3 ครั้ง (ไม่พึ่ง in_status) + กัน error เงียบ
import sys, os, shutil
P = os.path.join('src', 'pages', 'VatController.js')
MARK = 'VATWATCHLISTOPS_TYPE_ABF_V5'
raw = open(P, 'rb').read()
s = raw.decode('utf-8')
if MARK in s: print('SKIP: patch นี้ถูกใช้แล้ว (%s)' % MARK); sys.exit(0)
old = "const res = await apiFetch(`/vat_watchlist_report?eq_bu=${encodeURIComponent(bu.bu)}&in_status=type_a,type_b,type_f&limit=5000`);\n        if (active) setTypeRows(Array.isArray(res) ? res : []);\n      } catch (e) { if (active) setTypeRows([]); }"
if '\r\n' in s: old = old.replace('\n', '\r\n')
new = "const parts = await Promise.all(['type_a', 'type_b', 'type_f'].map((st) => apiFetch(`/vat_watchlist_report?eq_bu=${encodeURIComponent(bu.bu)}&eq_status=${st}&limit=5000`))); // MARKER_VATWATCHLISTOPS_TYPE_ABF_V5\n        const res = parts.reduce((a, p) => a.concat(Array.isArray(p) ? p : []), []);\n        if (active) setTypeRows(res);\n      } catch (e) { console.error('load type rows failed', e); if (active) setTypeRows([]); }"
if '\r\n' in s: new = new.replace('\n', '\r\n')
if s.count(old) != 1: print('ERROR: anchor พบ %d ครั้ง (ต้อง 1) - ไม่เขียนไฟล์' % s.count(old)); sys.exit(1)
if not os.path.exists(P + '.bak'): shutil.copy(P, P + '.bak')
open(P, 'wb').write(s.replace(old, new).encode('utf-8'))
print('OK: patched ->', P)
