# -*- coding: utf-8 -*-
# patch: ช่อง Tax invoice Date ใน Tab 1 อย่างเดียว (เป็นค่า Default ของแถวใน Grid) ไม่นับว่า "กรอกใบกำกับค้างไว้" -> ไม่บล็อกปุ่มบันทึก
import sys
p = sys.argv[1]; o = sys.argv[2]
s = open(p, encoding='utf-8-sig').read()
a = "const qaGlPendingTouched = String(qaGlTiv || '').trim() !== '' || !!qaGlDate || String(qaGlAmt || '').trim() !== '';"
assert s.count(a) == 1
s = s.replace(a, "const qaGlPendingTouched = String(qaGlTiv || '').trim() !== '' || String(qaGlAmt || '').trim() !== ''; // MARKER_QA_GL_PENDING_IGNORE_DATE_ONLY_V1 -- วันที่อย่างเดียว = ค่า Default ของ Grid ไม่ใช่ใบที่กรอกค้าง")
open(o, 'w', encoding='utf-8-sig', newline='').write(s)
