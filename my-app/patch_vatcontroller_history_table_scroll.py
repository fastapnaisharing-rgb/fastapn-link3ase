# -*- coding: utf-8 -*-
# MARKER_VATCONTROLLER_HISTORY_TABLE_INNER_SCROLL_V1
# หน้า "VAT Resource from Operation": ให้ Scroll ได้เฉพาะแถวใน Table List (Bucket/Backup)
#  - หน้าไม่เลื่อนทั้งหน้า / แถบ Bucket-Backup + หัวคอลัมน์ (Batch ID ...) ตรึงอยู่กับที่
# ใช้: python patch_vatcontroller_history_table_scroll.py <path VatController.js>
import sys, io
path = sys.argv[1]
src = io.open(path, encoding="utf-8").read()
M = "MARKER_VATCONTROLLER_HISTORY_TABLE_INNER_SCROLL_V1"
if M in src:
    print("already patched"); sys.exit(0)
def rep(old, new, label):
    global src
    assert src.count(old) == 1, "anchor count != 1: %s (%d)" % (label, src.count(old))
    src = src.replace(old, new)

# 1) Lobby: ล็อกความสูงตามหน้าจอ (เลื่อนทั้งหน้าเฉพาะจอเตี้ยมากเท่านั้น)
rep("""<div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px', height: '100%', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '10px'""",
    """<div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px', height: '100%', minHeight: 0, overflowY: 'auto', boxSizing: 'border-box' }}> {/* MARKER_VATCONTROLLER_HISTORY_TABLE_INNER_SCROLL_V1 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, paddingBottom: '10px'""", "lobby wrapper")
rep("""<div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}> {/* MARKER_VATWATCHLISTOPS_UPLOAD_FILE_LAYOUT_V3""",
    """<div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, minHeight: 0 }}> {/* MARKER_VATWATCHLISTOPS_UPLOAD_FILE_LAYOUT_V3""", "lobby inner")
rep("""<div style={{ display: 'flex', gap: '12px', height: '330px' }}>""",
    """<div style={{ display: 'flex', gap: '12px', height: '330px', flexShrink: 0 }}>""", "zones row")

# 2) การ์ดตาราง: ไม่ Scroll ทั้งก้อน -> เลื่อนเฉพาะ Body
rep("""<div style={{ flex: '35 1 0%', border: '0.5px solid #e5e7eb', borderRadius: '10px', overflow: 'auto', display: 'flex', flexDirection: 'column', background: 'white' }}>""",
    """<div style={{ flex: '35 1 0%', minHeight: '240px', border: '0.5px solid #e5e7eb', borderRadius: '10px', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: 'white' }}>""", "history card")
rep("""      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
        <thead>
          <tr style={{ background: '#f9fafb' }}>
            <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: '500', color: '#666' }}>Batch ID</th>""",
    """      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'auto' }}> {/* Scroll เฉพาะ Table List */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
        <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f9fafb', boxShadow: '0 1px 0 #e5e7eb' }}>
          <tr style={{ background: '#f9fafb' }}>
            <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: '500', color: '#666' }}>Batch ID</th>""", "thead")
rep("""        <tbody>
          {bodyContent}
        </tbody>
      </table>
    </div>
  );
}""", """        <tbody>
          {bodyContent}
        </tbody>
      </table>
      </div>
    </div>
  );
}""", "table close")
io.open(path, "w", encoding="utf-8", newline="").write(src)
print("patched OK")
