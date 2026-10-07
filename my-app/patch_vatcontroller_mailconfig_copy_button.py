# patch_vatcontroller_mailconfig_copy_button.py -- Config Email > Mail List: ปุ่ม "คัดลอก" ทำสำเนา Config เข้าฟอร์ม (ยังไม่บันทึก) เพื่อแก้บางเงื่อนไข
import sys, io
P = sys.argv[1]
s = io.open(P, encoding='utf-8', newline='').read()
MARK = 'MARKER_VATWATCHLISTOPS_MAILCFG_COPY_BUTTON_V1'
if MARK in s:
    print('already applied'); sys.exit(0)
edits = [
 ("  const openForm = (c) => {\n    if (c) {",
  "  const openForm = (c, asCopy = false) => { // " + MARK + " -- asCopy = คัดลอก: โหลดค่าทั้งหมดเข้าฟอร์มแต่เป็น Config ใหม่ (editingId = null) ยังไม่บันทึกจนกว่าจะกดบันทึก\n    if (c) {"),
 ("        config_name: c.config_name || '', bu: c.bu || '', send_type:",
  "        config_name: asCopy ? `${c.config_name || ''} (สำเนา)` : (c.config_name || ''), bu: c.bu || '', send_type:"),
 ("      setEditingId(c.id);\n    } else {\n      const f = MAIL_CFG_EMPTY();",
  "      setEditingId(asCopy ? null : c.id);\n    } else {\n      const f = MAIL_CFG_EMPTY();"),
 ("                  <button type=\"button\" onClick={() => openForm(c)} style={pill('white', '#ccc', '#555')}>แก้ไข</button>\n",
  "                  <button type=\"button\" onClick={() => openForm(c)} style={pill('white', '#ccc', '#555')}>แก้ไข</button>\n                  <button type=\"button\" onClick={() => openForm(c, true)} title=\"ทำสำเนา Config นี้เป็น Config ใหม่ (แก้เงื่อนไขก่อนบันทึกได้)\" style={pill('white', '#90caf9', '#1565c0')}>คัดลอก</button>\n"),
]
for o, n in edits:
    if s.count(o) != 1:
        print('FAIL count=%d: %s' % (s.count(o), o[:80])); sys.exit(1)
    s = s.replace(o, n)
io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('OK')
