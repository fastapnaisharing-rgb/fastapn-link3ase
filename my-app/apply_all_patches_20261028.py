# -*- coding: utf-8 -*-
r"""
apply_all_patches_20261028.py -- รัน Patch ทั้งหมดของวันที่ 2026-10-27/28 ตามลำดับ (รันซ้ำได้ ข้ามตัวที่ patch แล้ว)
วิธีใช้ (ที่โฟลเดอร์ my-app):  python apply_all_patches_20261028.py
"""
import subprocess, sys, os
base = os.path.dirname(os.path.abspath(__file__))
PATCHES = [
 "patch_apcontroller_edit_invoice_skip_cta_popup_v1.py",
 "patch_vatcontroller_taxlist_autosave_v1.py",
 "patch_vatcontroller_reject_menu_v1.py",
 "patch_vatcontroller_dupguard_ignore_self_bucket_v1.py",
 "patch_vatcontroller_ar_ref_strip_bu_prefix_v1.py",
 "patch_vatcontroller_inbox_skip_drafted_at_match_v1.py",
 "patch_vatcontroller_inbox_cross_bu_ref_match_v1.py",
 "patch_vatcontroller_inbox_deposit_first_sheet_v1.py",
 "patch_vatcontroller_export_open_allupload_folder_v1.py",
]
bad = []
for p in PATCHES:
    path = os.path.join(base, p)
    if not os.path.exists(path):
        print(f"[MISSING] {p}"); bad.append(p); continue
    r = subprocess.run([sys.executable, path], cwd=base, capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = (r.stdout.strip().splitlines() or [""])[-1]
    ok = r.returncode == 0 and "ABORT" not in r.stdout
    print(("[OK]    " if ok else "[FAIL]  ") + p + " -> " + out)
    if not ok: bad.append(p); print(r.stderr.strip()[:300])
print("\nสรุป: ผ่านทั้งหมด" if not bad else f"\nสรุป: มี {len(bad)} ตัวไม่ผ่าน -> {bad}")
