# -*- coding: utf-8 -*-
"""
patch_vatcontroller_inbox_skip_drafted_at_match_v1.py
Inbox Excel / PDF Tax Invoice Matching: แถว Incomplete (Invoice Ref.) ที่ถูก Pop เข้า Draft ไปแล้ว (รวม Draft ที่ Finish แล้ว = pv-backup)
ต้องไม่ถูก Match ซ้ำเป็น "พร้อม Pop VAT" อีก
เดิม: ฝั่ง AR_Collection ตัดแถวพวกนี้ไปแท็บ "Draft แล้ว" ตั้งแต่ตอน Match (arFetchDraftedKeys) แต่ Inbox/PDF ไม่ทำ
      -> พอกด Confirm ถึงโดนข้าม (ซ้ำ) แถวเลยค้างใน "พร้อม Pop VAT" ตลอด
แก้: ตอนเปิดหน้า Confirm ของ Inbox/PDF (onOpenConfirm) เช็ค Draft ที่มีอยู่แล้ว แล้วเปลี่ยนสถานะแถวเป็น already_drafted (แท็บ "Draft แล้ว" กดเลือก/Pop ไม่ได้)
เฉพาะแถว status = ready_for_popvat (แถว Exact Group / ต้องตรวจสอบ ไม่แตะ เพื่อไม่กระทบ Flow Backup/Bucket)
"""
import sys, shutil, os
TARGET = os.path.join("src", "pages", "VatController.js")
MARKER = "MARKER_INBOX_SKIP_DRAFTED_AT_MATCH_V1"

OLD_FN = "function buildPdfTaxInvArResult(pdfRows, matches, uploadedBy) {"
NEW_FN = (
"async function vatMarkDraftedInboxRows(rows) { // " + MARKER + " -- แถวที่ Incomplete ถูก Pop เข้า Draft ไปแล้ว (รวม pv-backup) -> already_drafted\n"
"  const cand = (rows || []).filter((r) => r && r.status === 'ready_for_popvat');\n"
"  if (cand.length === 0) return rows;\n"
"  const keys = await arFetchDraftedKeys(cand);\n"
"  const isDr = (r) => arIsDraftedRow(keys, r) || !!(r.incompleteRow && String(r.incompleteRow.status || '').trim() && !isArPendingRow(r.incompleteRow));\n"
"  return rows.map((r) => (r && r.status === 'ready_for_popvat' && isDr(r) ? { ...r, status: 'already_drafted' } : r));\n"
"}\n" + OLD_FN)

OLD_CALL = "onOpenConfirm={(pr, ms) => setPdfTaxInvConfirm(buildPdfTaxInvArResult(pr, ms, userName || currentUser?.email || 'unknown'))}"
NEW_CALL = ("onOpenConfirm={async (pr, ms) => { const __res = buildPdfTaxInvArResult(pr, ms, userName || currentUser?.email || 'unknown'); try { __res.rows = await vatMarkDraftedInboxRows(__res.rows); } catch (e) { /* ไม่ได้ก็แสดงตามเดิม (Confirm ยังกันซ้ำให้) */ } setPdfTaxInvConfirm(__res); }} /* " + MARKER + " */")

def main():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), TARGET)
    txt = open(path, "rb").read().decode("utf-8")
    if MARKER in txt: print("already patched"); return
    for n, o in (("OLD_FN", OLD_FN), ("OLD_CALL", OLD_CALL)):
        c = txt.count(o)
        if c != 1: print(f"ABORT: {n} found {c} times (need 1)"); sys.exit(1)
    nl = "\r\n" if "\r\n" in txt else "\n"
    shutil.copy2(path, path + ".bak_inbox_skip_drafted_v1")
    txt = txt.replace(OLD_FN, NEW_FN.replace("\n", nl)).replace(OLD_CALL, NEW_CALL)
    open(path, "wb").write(txt.encode("utf-8"))
    print("OK patched ->", path)
if __name__ == "__main__":
    main()
