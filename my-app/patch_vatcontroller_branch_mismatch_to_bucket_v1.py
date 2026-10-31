# -*- coding: utf-8 -*-
r"""
patch_vatcontroller_branch_mismatch_to_bucket_v1.py
กฎภาพรวม: ยอด VAT ตรง Payment Doc + Ref ชน แต่ "สาขาไม่ตรง" (บางแถวของ Payment Doc) -> ห้ามจบที่ "ไม่ Match" (ไม่พบ)
ให้เป็น "ต้องตรวจสอบ" + ส่งเข้า Full Page Bucket (พร้อมแถว Incomplete) ให้คนตัดสิน ไม่ Pop อัตโนมัติ
รันที่ my-app:  python patch_vatcontroller_branch_mismatch_to_bucket_v1.py   (รันซ้ำได้)
"""
import os, shutil, sys
TARGET = os.path.join("src", "pages", "VatController.js")
MARKER = "MARKER_BRANCH_MISMATCH_TO_BUCKET_V1"
OLD1 = "if (brBadHits.length > 0) { const b0 = brBadHits[0]; res.reasons.push(`${refNote}Payment Doc"
NEW1 = "const brBadRef = brBadHits.filter((c) => refLinked(c)); /* " + MARKER + " */ if (brBadRef.length > 0) { const b0 = brBadRef[0]; return finish('review', 2, b0.rs, [`${refNote}Payment Doc"
OLD2 = "-> ไม่ Match (CRG: สาขาลงท้าย 001 ผ่านได้)`); return res; }"
NEW2 = "-> ส่งเข้า Full Page Bucket ให้ตัดสินใจ ไม่ Pop อัตโนมัติ (CRG: สาขาลงท้าย 001 ผ่านได้)`]); }"
def main():
    base = os.path.dirname(os.path.abspath(__file__)); path = os.path.join(base, TARGET)
    txt = open(path, "rb").read().decode("utf-8")
    if MARKER in txt: print("SKIP already patched"); return
    for o in (OLD1, OLD2):
        c = txt.count(o)
        if c != 1: print(f"ABORT anchor count={c}: {o[:40]}"); sys.exit(1)
    out = txt.replace(OLD1, NEW1).replace(OLD2, NEW2)
    bak = path + ".bak"
    if not os.path.exists(bak): shutil.copy2(path, bak)
    open(path, "wb").write(out.encode("utf-8"))
    print("OK patched ->", path)
main()
