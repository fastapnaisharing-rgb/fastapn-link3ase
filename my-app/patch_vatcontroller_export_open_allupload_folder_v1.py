# -*- coding: utf-8 -*-
r"""
patch_vatcontroller_export_open_allupload_folder_v1.py
VAT Resource from Operation > Bucket/Backup (Export History): เพิ่มปุ่ม 📂 "เปิดโฟลเดอร์ปลายทาง" ข้างปุ่ม View/Restore
กดแล้วให้ระบบ (Handler) เปิดโฟลเดอร์ All_Upload = Z_AllSystemUpload\<เลข BU>\<YYYY.MM>\ ขึ้นมาให้เลย
เรียก fastapn-sp://open?bu=..&period=..&dest=upload  (ใช้ batch.spBu / batch.spPeriod ตัวเดียวกับตอนส่งไฟล์)
** ต้องให้ Handler รองรับคำสั่ง "open" (ยังไม่มีในรุ่นที่ใช้อยู่ถ้ายังไม่เคยทำ) **
"""
import sys, shutil, os

TARGET = os.path.join("src", "pages", "VatController.js")
MARKER = "MARKER_VATCONTROLLER_EXPORT_OPEN_ALLUPLOAD_FOLDER_V1"
A1 = "const vatSpNeedSend = (f) => !!f && !f.downloadedAt && !vatSpSentFileIds.has(f.id);"
A2 = "<td style={{ padding: '10px 12px', borderBottom: '0.5px solid #eee', textAlign: 'right', whiteSpace: 'nowrap' }}>"

FN = r"""
// MARKER_VATCONTROLLER_EXPORT_OPEN_ALLUPLOAD_FOLDER_V1 -- เปิดโฟลเดอร์ปลายทาง All_Upload (Z_AllSystemUpload\<เลข BU>\<YYYY.MM>) ผ่าน Handler (fastapn-sp://open) | ไม่ส่งไฟล์ ไม่แตะสถานะ downloadedAt
const vatSpFolderOk = (batch) => /^[0-9][0-9A-Za-z]{2,7}$/.test(String((batch && batch.spBu) || '').trim()) && /^\d{4}\.(0[1-9]|1[0-2])$/.test(String((batch && batch.spPeriod) || '').trim());
function launchVatExportSpOpen(batch) {
  if (!vatSpFolderOk(batch)) return false;
  const bu = String(batch.spBu).trim(); const period = String(batch.spPeriod).trim();
  let extra = '';
  try {
    const apiRoot = (process.env.REACT_APP_API_URL || 'http://10.101.87.126:4000/api').replace(/\/api$/, '');
    const token = sessionStorage.getItem('fastapn_token') || '';
    if (token) extra = `&api=${encodeURIComponent(apiRoot)}&token=${encodeURIComponent(token)}`;
  } catch (_) { /* ไม่มี token = เปิดโฟลเดอร์ได้ปกติ */ }
  const a = document.createElement('a');
  a.href = `fastapn-sp://open?bu=${encodeURIComponent(bu)}&period=${encodeURIComponent(period)}&dest=upload${extra}`;
  a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove();
  return true;
}
"""

BTN = (
    "<td style={{ padding: '10px 12px', borderBottom: '0.5px solid #eee', textAlign: 'right', whiteSpace: 'nowrap' }}>"
    " {/* " + MARKER + " */}"
    "<button type=\"button\" disabled={!vatSpFolderOk(batch)} onClick={() => { if (!launchVatExportSpOpen(batch)) confirmDialog.alert('ไม่พบเลข BU (SEGMENT3) / งวดของ Batch นี้ จึงเปิดโฟลเดอร์ All_Upload ไม่ได้', { title: 'เปิดโฟลเดอร์ไม่สำเร็จ', variant: 'danger' }); }}"
    " title={vatSpFolderOk(batch) ? `เปิดโฟลเดอร์ปลายทาง All_Upload: Z_AllSystemUpload\\\\${batch.spBu}\\\\${batch.spPeriod}` : 'ไม่มีเลข BU / งวด -> เปิดโฟลเดอร์ไม่ได้'}"
    " style={{ width: '32px', height: '32px', padding: 0, marginRight: '6px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle', border: '0.5px solid #1a3a5c', borderRadius: '8px', background: 'white', color: '#1a3a5c', cursor: vatSpFolderOk(batch) ? 'pointer' : 'not-allowed', opacity: vatSpFolderOk(batch) ? 1 : 0.35, fontSize: '15px' }}>📂</button>"
)

def main():
    base = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(base, TARGET)
    txt = open(path, "rb").read().decode("utf-8")
    if MARKER in txt:
        print("already patched"); return
    for name, old in (("A1", A1), ("A2", A2)):
        c = txt.count(old)
        if c != 1:
            print(f"ABORT: {name} found {c} times (need 1)"); sys.exit(1)
    nl = "\r\n" if "\r\n" in txt else "\n"
    shutil.copy2(path, path + ".bak_open_allupload_v1")
    txt = txt.replace(A1, A1 + FN.replace("\n", nl))
    txt = txt.replace(A2, BTN)
    open(path, "wb").write(txt.encode("utf-8"))
    print("OK patched ->", path)

if __name__ == "__main__":
    main()
