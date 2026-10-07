# -*- coding: utf-8 -*-
# patch: SmComboBox (Dropdown AT-Match / Type / Sub Type ฯลฯ) ซ่อน Scrollbar แนวตั้ง-แนวนอน (ยังเลื่อนด้วย Wheel / ลูกศรได้)
import sys
p = sys.argv[1]; o = sys.argv[2]
s = open(p, encoding='utf-8-sig').read()
a = """        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '0.5px solid #ccc', borderRadius: '6px', maxHeight: '160px', overflowY: 'auto', zIndex: 50, boxShadow: '0 4px 10px rgba(0,0,0,0.1)' }}>
          {filtered.map((o, i) => ("""
assert s.count(a) == 1
b = """        <div className="sm-hide-sb" style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '0.5px solid #ccc', borderRadius: '6px', maxHeight: '160px', overflowY: 'auto', overflowX: 'hidden', zIndex: 50, boxShadow: '0 4px 10px rgba(0,0,0,0.1)' }}>{/* MARKER_SMCOMBOBOX_HIDE_SCROLLBAR_V1 */}
          <style>{'.sm-hide-sb{scrollbar-width:none;-ms-overflow-style:none}.sm-hide-sb::-webkit-scrollbar{display:none}'}</style>
          {filtered.map((o, i) => ("""
s = s.replace(a, b)
open(o, 'w', encoding='utf-8-sig', newline='').write(s)
