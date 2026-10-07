# -*- coding: utf-8 -*-
# patch: ลิสต์ Vendor (Draft Monitor) ที่ช่อง Code เปลี่ยนจาก Popup ลอย -> Dropdown ใต้ช่อง Code (กรองตามที่พิมพ์)
import sys
p = sys.argv[1]; o = sys.argv[2]
s = open(p, encoding='utf-8-sig').read()
def rep(a, b):
    global s
    assert s.count(a) == 1, (s.count(a), a[:70])
    s = s.replace(a, b)
rep("""    ev.preventDefault();
    const x = Math.min(ev.clientX, window.innerWidth - 380); const y = Math.min(ev.clientY, window.innerHeight - 360);
    setQaGlDrMenu({ x: Math.max(8, x), y: Math.max(8, y) }); setQaGlDrQ(''); setQaGlDrLoading(true);""",
"""    if (ev && ev.preventDefault) ev.preventDefault();
    if (qaGlDrMenu) return; // MARKER_QA_GL_CODE_DROPDOWN_V1 -- เปิดอยู่แล้ว ไม่ต้องโหลดซ้ำ
    setQaGlDrMenu({}); setQaGlDrQ(''); setQaGlDrLoading(true);""")
rep("""onContextMenu={qaGlOpenDraftMenu} title="คลิกขวา = เลือก Vendor จาก Draft Monitor" """,
"""onContextMenu={qaGlOpenDraftMenu} onKeyDown={(ev) => { if (ev.key === 'ArrowDown' && !qaGlDrMenu) { qaGlOpenDraftMenu(ev); } else if (ev.key === 'Escape' && qaGlDrMenu) { ev.stopPropagation(); ev.preventDefault(); setQaGlDrMenu(null); } }} title="คลิกขวา / ลูกศรลง = เลือก Vendor จาก Draft Monitor (พิมพ์เพื่อกรอง)" """)
rep("""                    <div style={{ display: 'flex' }}>
                      <input type="text" value={qaGlSupplierCode} onChange={(e) => setQaGlSupplierCode(e.target.value)} onContextMenu""",
"""                    <div style={{ display: 'flex', position: 'relative' }}>
                      <input type="text" value={qaGlSupplierCode} onChange={(e) => setQaGlSupplierCode(e.target.value)} onContextMenu""")
rep("""<div style={{ position: 'fixed', left: qaGlDrMenu.x, top: qaGlDrMenu.y, width: '370px', maxHeight: '340px', display: 'flex', flexDirection: 'column', background: 'white', border: '1px solid #cfd8e3', borderRadius: '10px', boxShadow: '0 8px 24px rgba(16,24,40,0.22)', zIndex: 2601, overflow: 'hidden' }}>""",
"""<div style={{ position: 'absolute', left: 0, top: '100%', marginTop: '2px', minWidth: '340px', maxHeight: '260px', display: 'flex', flexDirection: 'column', background: 'white', border: '1px solid #cfd8e3', borderRadius: '8px', boxShadow: '0 8px 24px rgba(16,24,40,0.22)', zIndex: 2601, overflow: 'hidden' }}>""")
# ตัดหัวสีน้ำเงิน + ช่องค้นหา (กรองจากช่อง Code เอง)
i = s.index("""<div style={{ padding: '8px 10px', background: '#1a3a5c', color: 'white', fontSize: '12px', fontWeight: 500 }}>Vendor จาก Draft Monitor""")
j = s.index("""<div style={{ overflowY: 'auto', flex: 1 }}>""", i)
s = s[:i] + s[j:]
rep("""const q = qaGlDrQ.trim().toLowerCase(); return !q ||""", """const q = String(qaGlSupplierCode || '').trim().toLowerCase(); return !q ||""")
open(o, 'w', encoding='utf-8-sig', newline='').write(s)
