# -*- coding: utf-8 -*-
# Patch v3: Tax Invoice List (GL-TransferVat Tab 2) = ตารางเซลล์แบบ Excel จริง
#  เลือกช่อง/ลากคลุมหลายช่อง (Drag) | ลูกศร ↑↓←→ / Tab / Enter เลื่อนช่อง | Shift+ลูกศร ขยายการเลือก | Delete/Backspace ล้างช่องที่เลือก
#  พิมพ์ทับได้ทันที / F2 หรือดับเบิลคลิกแก้ไข / Esc ยกเลิก | Ctrl+C / Ctrl+X / Ctrl+V / Ctrl+A | วางที่ช่องที่เลือกไหลลงตามแถว-คอลัมน์ | วาง 1 ค่าลงหลายช่องที่เลือก = เติมทุกช่อง
# apply บน VatController.js ที่มี taxgrid v1+v2
# usage: python patch_vatcontroller_qagl_taxgrid_v3.py <in> <out>
import sys
src, dst = sys.argv[1], sys.argv[2]
txt = open(src, 'rb').read().decode('utf-8')
def rep(old, new):
    global txt
    assert txt.count(old) == 1, (txt.count(old), old[:80])
    txt = txt.replace(old, new)

# 1) State
rep("  const qaGlGridRef = React.useRef(qaGlGrid); qaGlGridRef.current = qaGlGrid;\n",
"""  const qaGlGridRef = React.useRef(qaGlGrid); qaGlGridRef.current = qaGlGrid;
  const [qaGlSel, setQaGlSel] = React.useState(null); // MARKER_QA_GL_TAXGRID_V3 -- {ar,ac,fr,fc} ช่อง Anchor / Focus ของการเลือก
  const [qaGlEdit, setQaGlEdit] = React.useState(null); // {r,c,val} ช่องที่กำลังพิมพ์
  const qaGlEditRef = React.useRef(null); qaGlEditRef.current = qaGlEdit;
  const qaGlDragRef = React.useRef(false);
  const qaGlBoxRef = React.useRef(null);
  React.useEffect(() => { const up = () => { qaGlDragRef.current = false; }; window.addEventListener('mouseup', up); return () => window.removeEventListener('mouseup', up); }, []);
""")
rep("setQaGlGrid(qaGlMkGrid(3));", "setQaGlGrid(qaGlMkGrid(3)); setQaGlSel(null); setQaGlEdit(null);")

# 2) Handler: แทน handleQaGlGridPaste + qaGlGridSet
s = txt.index("  const handleQaGlGridPaste = (e, rowId, colKey) =>")
e = txt.index("  const handleQaGlPasteRows = (e) =>")
txt = txt[:s] + txt[e:]
s2 = txt.index("  const qaGlGridSet = (id, k, val) =>")
e2 = txt.index("\n", s2) + 1
txt = txt[:s2] + txt[e2:]

new_h = r"""  const qaGlSelRect = (s) => (s ? { r1: Math.min(s.ar, s.fr), r2: Math.max(s.ar, s.fr), c1: Math.min(s.ac, s.fc), c2: Math.max(s.ac, s.fc) } : null); // MARKER_QA_GL_TAXGRID_V3
  const qaGlGridClearRect = (rc) => setQaGlGrid((prev) => qaGlGridFit(prev.map((x, i) => { if (i < rc.r1 || i > rc.r2) return x; const n = { ...x }; for (let j = rc.c1; j <= rc.c2; j++) n[QA_GL_GRID_COLS[j]] = ''; return n; })));
  const qaGlGridPasteAt = (matrix, r0, c0, rect) => { // วางที่ช่อง (r0,c0) ไหลลงตามแถว/คอลัมน์ | 1 ค่า + เลือกหลายช่อง = เติมทุกช่อง | >=3 คอลัมน์ = จัดคอลัมน์ให้เอง
    const width = Math.max(...matrix.map((r) => r.length));
    setQaGlGrid((prev) => {
      const next = prev.map((x) => ({ ...x }));
      if (matrix.length === 1 && width === 1 && rect && (rect.r2 > rect.r1 || rect.c2 > rect.c1)) {
        const need = rect.r2 + 1 - next.length; if (need > 0) next.push(...qaGlMkGrid(need));
        for (let i = rect.r1; i <= rect.r2; i++) for (let j = rect.c1; j <= rect.c2; j++) next[i][QA_GL_GRID_COLS[j]] = qaGlCleanCell(QA_GL_GRID_COLS[j], matrix[0][0]);
        return qaGlGridFit(next);
      }
      const need = r0 + matrix.length - next.length; if (need > 0) next.push(...qaGlMkGrid(need));
      matrix.forEach((cells, i) => {
        if (width >= 3) { if (!/\d/.test(cells.join(''))) return; Object.assign(next[r0 + i], qaGlSmartRec(cells)); }
        else cells.forEach((v, j) => { const col = QA_GL_GRID_COLS[c0 + j]; if (col) next[r0 + i][col] = qaGlCleanCell(col, v); });
      });
      return qaGlGridFit(next);
    });
  };
  const qaGlBoxPaste = (e) => {
    const editing = e.target && e.target.tagName === 'INPUT';
    const m = qaGlClipMatrix(e);
    if (!m && editing) return; // พิมพ์/วางค่าเดียวในช่องที่กำลังแก้ -> ปกติ
    if (!qaGlSel && m) { handleQaGlPasteRows(e); return; } // ยังไม่ได้เลือกช่อง -> ต่อท้ายตาราง
    e.preventDefault(); e.stopPropagation();
    const raw = (e.clipboardData && e.clipboardData.getData('text')) || '';
    const matrix = m || [[raw.replace(/[\r\n]+$/, '')]];
    const rc = qaGlSelRect(qaGlSel) || { r1: 0, r2: 0, c1: 0, c2: 0 };
    setQaGlEdit(null); qaGlEditRef.current = null;
    qaGlGridPasteAt(matrix, rc.r1, rc.c1, rc);
    setTimeout(() => qaGlBoxRef.current && qaGlBoxRef.current.focus(), 0);
  };
  const qaGlBoxCopy = (e, cut) => {
    if (qaGlEditRef.current || !qaGlSel || (e.target && e.target.tagName === 'INPUT')) return;
    const rc = qaGlSelRect(qaGlSel); const rows = [];
    for (let i = rc.r1; i <= rc.r2; i++) { const cells = []; for (let j = rc.c1; j <= rc.c2; j++) cells.push((qaGlGrid[i] && qaGlGrid[i][QA_GL_GRID_COLS[j]]) || ''); rows.push(cells.join('\t')); }
    e.clipboardData.setData('text/plain', rows.join('\n')); e.preventDefault();
    if (cut) qaGlGridClearRect(rc);
  };
  const qaGlMoveSel = (dr, dc, extend, grow) => setQaGlSel((s) => { if (!s) return { ar: 0, ac: 0, fr: 0, fc: 0 }; const maxR = qaGlGridRef.current.length - 1 + (grow ? 1 : 0); const fr = Math.max(0, Math.min(maxR, s.fr + dr)); const fc = Math.max(0, Math.min(4, s.fc + dc)); return extend ? { ...s, fr, fc } : { ar: fr, ac: fc, fr, fc }; });
  const qaGlRefocusBox = () => setTimeout(() => qaGlBoxRef.current && qaGlBoxRef.current.focus(), 0);
  const qaGlCommitEdit = (ed, move) => { // บันทึกช่องที่พิมพ์ (จัด Format) แล้วเลื่อนช่องตาม move=[dr,dc]
    if (!ed) return; qaGlEditRef.current = null;
    const col = QA_GL_GRID_COLS[ed.c]; const cv = qaGlCleanCell(col, ed.val);
    setQaGlGrid((prev) => qaGlGridFit(prev.map((x, i) => (i === ed.r ? { ...x, [col]: cv } : x))));
    setQaGlEdit(null);
    if (move) qaGlMoveSel(move[0], move[1], false, true);
    qaGlRefocusBox();
  };
  const qaGlBoxKey = (e) => {
    if (qaGlEditRef.current || (e.target && e.target.tagName === 'INPUT')) return;
    const k = e.key; const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && /^[cvxCVX]$/.test(k)) return; // ให้ onCopy / onPaste / onCut ทำงาน
    if (ctrl && (k === 'a' || k === 'A')) { e.preventDefault(); setQaGlSel({ ar: 0, ac: 0, fr: qaGlGrid.length - 1, fc: 4 }); return; }
    if (k === 'ArrowDown') { e.preventDefault(); qaGlMoveSel(1, 0, e.shiftKey); }
    else if (k === 'ArrowUp') { e.preventDefault(); qaGlMoveSel(-1, 0, e.shiftKey); }
    else if (k === 'ArrowLeft') { e.preventDefault(); qaGlMoveSel(0, -1, e.shiftKey); }
    else if (k === 'ArrowRight') { e.preventDefault(); qaGlMoveSel(0, 1, e.shiftKey); }
    else if (k === 'Tab') { e.preventDefault(); if (!e.shiftKey && qaGlSel && qaGlSel.fc === 4) qaGlMoveSel(1, -4, false); else if (e.shiftKey && qaGlSel && qaGlSel.fc === 0) qaGlMoveSel(-1, 4, false); else qaGlMoveSel(0, e.shiftKey ? -1 : 1, false); }
    else if (k === 'Enter') { e.preventDefault(); qaGlMoveSel(e.shiftKey ? -1 : 1, 0, false); }
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); if (qaGlSel) qaGlGridClearRect(qaGlSelRect(qaGlSel)); }
    else if (k === 'F2' && qaGlSel) { e.preventDefault(); setQaGlEdit({ r: qaGlSel.fr, c: qaGlSel.fc, val: (qaGlGrid[qaGlSel.fr] && qaGlGrid[qaGlSel.fr][QA_GL_GRID_COLS[qaGlSel.fc]]) || '' }); }
    else if (k.length === 1 && !ctrl && !e.altKey && qaGlSel) { e.preventDefault(); setQaGlEdit({ r: qaGlSel.fr, c: qaGlSel.fc, val: k }); } // พิมพ์ทับทันที
  };
"""
a = txt.index("  const qaGlGridClearRow = (id) =>")
txt = txt[:a] + new_h + txt[a:]

# 3) Container: Keyboard / Copy / Paste
rep("<div tabIndex={0} onPaste={handleQaGlPasteRows} title=\"คลิกในกรอบนี้แล้วกด Ctrl+V เพื่อวางข้อมูลจาก Excel\" style={{ minHeight: '300px', maxHeight: '52vh', overflowY: 'auto', outline: 'none' }}>",
    "<div ref={qaGlBoxRef} tabIndex={0} onKeyDown={qaGlBoxKey} onPaste={qaGlBoxPaste} onCopy={(ev) => qaGlBoxCopy(ev, false)} onCut={(ev) => qaGlBoxCopy(ev, true)} style={{ minHeight: '300px', maxHeight: '52vh', overflowY: 'auto', outline: 'none' }}>")

# 4) Grid JSX ใหม่ (เซลล์)
g_start = txt.index("                    {qaGlGrid.map((gr, gi) => { // MARKER_QA_GL_TAXGRID_V2")
g_end_tok = "                    })}\n"
g_end = txt.index(g_end_tok, g_start) + len(g_end_tok)
new_grid = r"""                    {qaGlGrid.map((gr, gi) => { // MARKER_QA_GL_TAXGRID_V3
                      const itIdx = listGl.findIndex((x) => x.id === `grid-${gr.id}`); const ok = itIdx >= 0; const filled = !!(gr.date || gr.tiv || gr.g || gr.v);
                      const tivT = qaGlCl(gr.tiv); const tivDup = !!tivT && (qaGlTivList.some((it) => it.tiv === tivT) || qaGlGrid.findIndex((x) => qaGlCl(x.tiv) === tivT) !== gi);
                      const rcSel = qaGlSelRect(qaGlSel);
                      const cell = (c, ph, right) => {
                        const k = QA_GL_GRID_COLS[c]; const val = gr[k];
                        const inSel = !!rcSel && gi >= rcSel.r1 && gi <= rcSel.r2 && c >= rcSel.c1 && c <= rcSel.c2;
                        const act = !!qaGlSel && qaGlSel.fr === gi && qaGlSel.fc === c; const editing = !!qaGlEdit && qaGlEdit.r === gi && qaGlEdit.c === c;
                        return (
                          <td key={k}
                            onMouseDown={(ev) => { if (ev.button !== 0 || editing) return; ev.preventDefault(); if (qaGlEditRef.current) qaGlCommitEdit(qaGlEditRef.current, null); qaGlDragRef.current = true; setQaGlSel((s) => (ev.shiftKey && s ? { ...s, fr: gi, fc: c } : { ar: gi, ac: c, fr: gi, fc: c })); if (qaGlBoxRef.current) qaGlBoxRef.current.focus(); }}
                            onMouseEnter={() => { if (qaGlDragRef.current) setQaGlSel((s) => (s ? { ...s, fr: gi, fc: c } : s)); }}
                            onDoubleClick={() => setQaGlEdit({ r: gi, c, val })}
                            title={k === 'tiv' && tivDup ? 'TIV ซ้ำ' : undefined}
                            style={{ ...tdS, position: 'relative', cursor: 'cell', userSelect: 'none', padding: '0 8px', height: '28px', textAlign: right ? 'right' : 'left', background: inSel && !act ? '#dcebfb' : (ok ? '#f1faf3' : '#fff'), outline: act ? '2px solid #1a73e8' : (k === 'tiv' && tivDup ? '1px solid #e5484d' : 'none'), outlineOffset: '-2px', borderRight: '0.5px solid #eef0f2', color: val ? (k === 'tiv' && tivDup ? '#e5484d' : '#222') : '#c4c9d0' }}>
                            {editing
                              ? (<input autoFocus value={qaGlEdit.val} onChange={(ev) => setQaGlEdit((x) => (x ? { ...x, val: ev.target.value } : x))}
                                  onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); qaGlCommitEdit(qaGlEditRef.current, [ev.shiftKey ? -1 : 1, 0]); } else if (ev.key === 'Tab') { ev.preventDefault(); ev.stopPropagation(); qaGlCommitEdit(qaGlEditRef.current, [0, ev.shiftKey ? -1 : 1]); } else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); qaGlEditRef.current = null; setQaGlEdit(null); qaGlRefocusBox(); } else ev.stopPropagation(); }}
                                  onBlur={() => { if (qaGlEditRef.current) qaGlCommitEdit(qaGlEditRef.current, null); }}
                                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', boxSizing: 'border-box', border: 'none', outline: '2px solid #1a73e8', outlineOffset: '-2px', padding: '0 8px', fontSize: '12px', background: 'white', textAlign: right ? 'right' : 'left' }} />)
                              : (val || ph)}
                          </td>
                        );
                      };
                      return (
                        <tr key={gr.id}>
                          <td style={{ ...tdS, textAlign: 'center', color: ok ? '#2e7d32' : '#bbb' }}>{ok ? itIdx + 1 : '·'}</td>
                          {cell(0, 'วว/ดด/ปปปป')}{cell(1, 'TIV number')}
                          <td style={{ ...tdS, color: ok ? '#1a3a5c' : '#bbb' }}>{ok ? (grnOfGl(itIdx) || '—') : '—'}{filled && <button type="button" title="ล้างแถวนี้" onClick={() => qaGlGridClearRow(gr.id)} style={{ marginLeft: '6px', border: 'none', background: 'none', color: '#c0392b', cursor: 'pointer' }}>✕</button>}</td>
                          {cell(2, String(qaGlBranchDr || '') || 'auto')}{cell(3, 'Amount', true)}{cell(4, 'Vat (ว่าง = 7%)', true)}
                        </tr>
                      );
                    })}
"""
txt = txt[:g_start] + new_grid + txt[g_end:]
rep("วางจากช่องไหนก็ได้)", "คลิกช่อง · ลากเลือก · ลูกศร · Delete · Ctrl+V ได้เหมือน Excel)")
open(dst, 'wb').write(txt.encode('utf-8'))
print('ok')
