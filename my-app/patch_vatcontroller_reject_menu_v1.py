# -*- coding: utf-8 -*-
"""
patch_vatcontroller_reject_menu_v1.py
Full Page > ปุ่ม Reject (ข้าง Delete ใน Tax Invoice List): กดแล้วมีเมนูให้เลือก 3 แบบ
  1) คืน Invoice List เป็น Pending  -> พฤติกรรมเดิม (handleRejectBucketTax: คืน Pending + ดึงแถวที่น่าจะ Match มาให้เลือกใหม่)
  2) ส่ง Tax Invoice กลับ Bucket    -> เอาใบกำกับภาษีที่ติ๊ก (ไม่ติ๊กเลย = ทุกใบที่มาจาก Bucket) ออกจาก List
                                       Backup กลับเป็น pending เก็บไว้ใน Bucket เหมือนเดิม + Incomplete ที่ Load มาคู่กันกลับเป็น pending
  3) ล้างทั้งหมด                    -> เหมือนข้อ 2 กับทุกใบ + ล้าง Invoice List ที่เลือกไว้ + ล้างใบที่กรอกเอง (ไม่ลบข้อมูลใน DB)
"""
import sys, shutil, os

TARGET = os.path.join("src", "pages", "VatController.js")
MARKER = "MARKER_FULLPAGE_REJECT_MENU_V1"

ANCHOR = "  const [editingTaxRowId, setEditingTaxRowId] = React.useState(null);"
OLD_BTN_CLICK = '<button type="button" onClick={handleRejectBucketTax}'
NEW_BTN_CLICK = '<button type="button" onClick={() => setRejectMenuOpen(true)}'
OLD_BTN_TAIL = 'title="Reject = ไม่ใช่ชุดนี้ ดึงแถวที่น่าจะ Match มาให้เลือกใหม่ (MARKER_FULLPAGE_REJECT_REMATCH_V1)">Reject</button>'

def block(nl):
    js = r"""  const [rejectMenuOpen, setRejectMenuOpen] = React.useState(false); // MARKER_FULLPAGE_REJECT_MENU_V1 -- เมนู Reject 3 แบบ
  const handleRejectToBucket = async (clearAll) => { // MARKER_FULLPAGE_REJECT_MENU_V1 -- clearAll=false: ส่ง Tax Invoice กลับ Bucket / true: ล้างทั้งหมด (ไม่ลบข้อมูลใน DB)
    setRejectMenuOpen(false);
    const picked = selectedTaxInvoiceRows.size === 0 ? addTaxInvoiceList : addTaxInvoiceList.filter((r) => selectedTaxInvoiceRows.has(r.id));
    const targets = clearAll ? addTaxInvoiceList : picked;
    const bucketRows = targets.filter((r) => r.bucketTaxId);
    const manualCount = targets.length - bucketRows.length;
    if (!clearAll && bucketRows.length === 0) { await confirmDialog.alert(targets.length === 0 ? 'ไม่มีใบกำกับภาษีใน Tax Invoice List' : 'ใบกำกับภาษีที่เลือกไม่ได้มาจาก Bucket (กรอกเอง) จึงไม่มีที่ให้ส่งกลับ -- ใช้ Delete หรือ ล้างทั้งหมด แทน', { title: 'Reject' }); return; }
    if (clearAll && targets.length === 0 && selectedNoteRows.size === 0 && selectedFullPageInvoices.size === 0) { await confirmDialog.alert('ไม่มีข้อมูลให้ล้าง', { title: 'Reject' }); return; }
    const msg = clearAll
      ? `ล้างทั้งหมด?\n- ใบกำกับภาษีจาก Bucket ${bucketRows.length} ใบ จะกลับไปรอใน Bucket (เก็บไว้เหมือนเดิม)\n- Invoice ที่ Load มาคู่กันจะกลับเป็น Pending\n- ล้าง Invoice List ที่เลือกไว้${manualCount > 0 ? `\n- ใบกำกับภาษีที่กรอกเอง ${manualCount} ใบ จะถูกเอาออกจาก List` : ''}\nไม่มีการลบข้อมูลใน Backup`
      : `ส่ง Tax Invoice ${bucketRows.length} ใบ กลับไปที่ Bucket?\nใบกำกับภาษีจะถูกเก็บไว้เหมือนเดิมใน Bucket และ Invoice ที่ Load มาคู่กันจะกลับเป็น Pending`;
    const ok = await confirmDialog.confirm(msg, { title: clearAll ? 'Reject -- ล้างทั้งหมด' : 'Reject -- ส่งกลับ Bucket', variant: 'warning' });
    if (!ok) return;
    const goneIds = new Set((clearAll ? targets : bucketRows).map((r) => r.id));
    const gone = addTaxInvoiceList.filter((r) => goneIds.has(r.id));
    const rest = addTaxInvoiceList.filter((r) => !goneIds.has(r.id));
    setAddTaxInvoiceList(rest);
    await revertBucketLoaded(gone, rest, 'reject'); // mode 'reject' = Backup กลับเป็น pending (ไม่ลบ)
    setSelectedTaxInvoiceRows(new Set());
    if (clearAll) { setSelectedFullPageInvoices(new Set()); setSelectedNoteRows(new Map()); }
  };
"""
    return js.replace("\n", nl)

def modal():
    return (
        " {rejectMenuOpen && ( /* " + MARKER + " */"
        "<div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1700, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onMouseDown={(e) => { if (e.target === e.currentTarget) setRejectMenuOpen(false); }}>"
        "<div style={{ background: 'white', borderRadius: '12px', width: '420px', maxWidth: '94vw', padding: '18px 20px', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' }}>"
        "<div style={{ fontSize: '15px', fontWeight: 600, color: '#1a3a5c', marginBottom: '4px' }}>Reject</div>"
        "<div style={{ fontSize: '12px', color: '#888', marginBottom: '14px' }}>เลือกวิธี Reject</div>"
        "<button type=\"button\" onClick={() => { setRejectMenuOpen(false); handleRejectBucketTax(); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', marginBottom: '8px', border: '0.5px solid #ccc', borderRadius: '8px', background: 'white', cursor: 'pointer' }}><div style={{ fontSize: '13px', fontWeight: 600, color: '#1a3a5c' }}>คืน Invoice List เป็น Pending</div><div style={{ fontSize: '11.5px', color: '#777', marginTop: '2px' }}>Invoice กลับเป็น Pending แล้วดึงแถวที่น่าจะ Match มาให้เลือกใหม่ (ใบกำกับภาษียังอยู่ใน List)</div></button>"
        "<button type=\"button\" onClick={() => handleRejectToBucket(false)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', marginBottom: '8px', border: '0.5px solid #ccc', borderRadius: '8px', background: 'white', cursor: 'pointer' }}><div style={{ fontSize: '13px', fontWeight: 600, color: '#1a3a5c' }}>ส่ง Tax Invoice กลับ Bucket</div><div style={{ fontSize: '11.5px', color: '#777', marginTop: '2px' }}>เอาใบกำกับภาษี (ที่ติ๊ก / ทั้งหมด) ออกจาก List แล้วเก็บไว้ใน Bucket เหมือนเดิม</div></button>"
        "<button type=\"button\" onClick={() => handleRejectToBucket(true)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', marginBottom: '12px', border: '0.5px solid #E5B4B0', borderRadius: '8px', background: '#FFF7F6', cursor: 'pointer' }}><div style={{ fontSize: '13px', fontWeight: 600, color: '#b3261e' }}>ล้างทั้งหมด</div><div style={{ fontSize: '11.5px', color: '#777', marginTop: '2px' }}>ล้างทั้ง Tax Invoice List และ Invoice List (ใบจาก Bucket กลับไปรอใน Bucket ไม่ลบข้อมูล)</div></button>"
        "<div style={{ textAlign: 'right' }}><button type=\"button\" onClick={() => setRejectMenuOpen(false)} style={{ padding: '6px 16px', fontSize: '12.5px', border: '0.5px solid #ccc', borderRadius: '8px', background: 'white', color: '#555', cursor: 'pointer' }}>ปิด</button></div>"
        "</div></div>)}"
    )

def main():
    base = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(base, TARGET)
    txt = open(path, "rb").read().decode("utf-8")
    if MARKER in txt:
        print("already patched"); return
    for name, old in (("ANCHOR", ANCHOR), ("OLD_BTN_CLICK", OLD_BTN_CLICK), ("OLD_BTN_TAIL", OLD_BTN_TAIL)):
        c = txt.count(old)
        if c != 1:
            print(f"ABORT: {name} found {c} times (need 1)"); sys.exit(1)
    nl = "\r\n" if "\r\n" in txt else "\n"
    shutil.copy2(path, path + ".bak_reject_menu_v1")
    txt = txt.replace(ANCHOR, block(nl) + ANCHOR)
    txt = txt.replace(OLD_BTN_CLICK, NEW_BTN_CLICK)
    txt = txt.replace(OLD_BTN_TAIL, OLD_BTN_TAIL + modal())
    open(path, "wb").write(txt.encode("utf-8"))
    print("OK patched ->", path)

if __name__ == "__main__":
    main()
