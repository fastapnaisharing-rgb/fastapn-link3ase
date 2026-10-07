# -*- coding: utf-8 -*-
# MARKER_TIMELINE_STEP_BUTTONS_EQUAL_EN_V1
# ปุ่ม Step (เตรียมข้อมูล/ตรวจสอบยอด/บันทึก/ยื่นผล/ไม่มีข้อมูล): ขนาดเท่ากันทุกปุ่ม + ข้อความภาษาอังกฤษ
import sys, io
path = sys.argv[1]
src = io.open(path, encoding="utf-8").read()
M = "MARKER_TIMELINE_STEP_BUTTONS_EQUAL_EN_V1"
if M in src:
    print("already patched"); sys.exit(0)

def rep(old, new, label):
    global src
    assert src.count(old) == 1, "anchor count != 1: %s (found %d)" % (label, src.count(old))
    src = src.replace(old, new)

# 1) ข้อความปุ่มเป็นภาษาอังกฤษ
rep('"Special operation": ["เตรียมข้อมูล", "ตรวจสอบยอด", "บันทึก/ยื่นผล"],', '"Special operation": ["Prepare Data", "Verify Amounts", "Record / Submit"], // ' + M, "g1")
rep('"Daily": ["ดึงรายงานรายวัน", "ตรวจสอบผลต่าง", "ปิดรายการ"],', '"Daily": ["Pull Daily Report", "Check Variance", "Close Items"],', "g2")
rep('"Popup": ["ตรวจรายการ Popup", "Pop เข้าระบบ", "ตรวจสอบหลัง Pop"],', '"Popup": ["Review Popup Items", "Pop into System", "Verify After Pop"],', "g3")
rep('"รายงาน": ["ขอรายงาน (ผูก Request ID)", "ตรวจสอบรายการ", "บันทึกผลตรวจ"],', '"รายงาน": ["Request Report (Link Request ID)", "Review Items", "Record Review Result"],', "g4")

# 2) ปุ่ม No Data + Tooltip
rep('title="BU นี้ไม่มีข้อมูลของรายการนี้ (นับเป็นทำแล้ว) กดซ้ำเพื่อยกเลิก"', 'title="This BU has no data for this item (counts as done). Click again to undo"', "nodata title")
rep('{t.nodata ? "✓ " : ""}ไม่มีข้อมูล\n', '{t.nodata ? "✓ " : ""}No Data\n', "nodata text")

# 2.1) เส้นแบ่ง: ปุ่ม Stage (ลำดับงาน) กับปุ่ม No Data เป็นคนละ Function
rep('            })}\n            <button\n              type="button"\n              disabled={closed}\n              title="This BU has no data',
    '            })}\n            <div aria-hidden="true" style={{ flex: "none", alignSelf: "center", width: 1, height: 28, background: "#C9C8C0", margin: "0 2px" }} />\n            <button\n              type="button"\n              disabled={closed}\n              title="This BU has no data', "divider")

# 3) ขนาดเท่ากัน: ทุกปุ่มใน Row เป็น flex เท่ากัน (เดิมปุ่มสุดท้ายกว้างคงที่ 110px)
rep('flex: 1, height: 38, fontSize: 13, borderRadius: 10, cursor: closed ? "default" : t.nodata ? "not-allowed" : "pointer", opacity: t.nodata ? 0.45 : 1,',
    'flex: "1 1 0%", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "0 8px", height: 38, fontSize: 13, borderRadius: 10, cursor: closed ? "default" : t.nodata ? "not-allowed" : "pointer", opacity: t.nodata ? 0.45 : 1,', "stage btn style")
rep('style={{ flex: "none", width: 110, height: 38, fontSize: 13, borderRadius: 10, cursor: closed ? "default" : "pointer", border: t.nodata ?',
    'style={{ flex: "1 1 0%", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "0 8px", height: 38, fontSize: 13, borderRadius: 10, cursor: closed ? "default" : "pointer", border: t.nodata ?', "nodata btn style")

# 4) ข้อมูลที่เคยบันทึกไว้มี Label ภาษาไทยเดิม -> ใช้ Label ปัจจุบันของโค้ดเสมอ (ยกเว้น 46119 ที่เทียบตามลำดับแพลตฟอร์ม)
rep('out.tasks[k] = { ...b.tasks[k], ...st.tasks[k] }; });',
    'out.tasks[k] = { ...b.tasks[k], ...st.tasks[k], items: st.tasks[k].items.map((it, n) => (k === "46119" ? it : { ...it, label: b.tasks[k].items[n].label })) }; /* ' + M + ' */ });', "mergeProg labels")

io.open(path, "w", encoding="utf-8", newline="").write(src)
print("patched OK")
