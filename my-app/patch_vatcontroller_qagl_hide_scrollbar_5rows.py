# -*- coding: utf-8 -*-
# patch: GL-TransferVat ซ่อน Scrollbar (ยังเลื่อนด้วย Wheel/ลูกศรได้) + Tax Invoice List สูงพอดี 5 แถว
import sys
p = sys.argv[1]; o = sys.argv[2]
s = open(p, encoding='utf-8-sig').read()
def rep(a, b):
    global s
    assert s.count(a) == 1, (s.count(a), a[:70])
    s = s.replace(a, b)
rep("""            <div style={{ overflowY: 'auto', flex: 1, padding: '14px 20px 4px' }}>""",
"""            <div className="qa-hide-sb" style={{ overflowY: 'auto', flex: 1, padding: '14px 20px 4px' }}>{/* MARKER_QA_GL_HIDE_SCROLLBAR_V1 */}
              <style>{'.qa-hide-sb{scrollbar-width:none;-ms-overflow-style:none}.qa-hide-sb::-webkit-scrollbar{display:none}'}</style>""")
rep("style={{ minHeight: 0, maxHeight: '34vh', overflowY: 'auto',", "className=\"qa-hide-sb\" style={{ minHeight: 0, maxHeight: '196px', overflowY: 'auto',")
open(o, 'w', encoding='utf-8-sig', newline='').write(s)
