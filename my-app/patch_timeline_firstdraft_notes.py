# -*- coding: utf-8 -*-
# MARKER_TIMELINE_FIRSTDRAFT_NOTES_V1
# First Draft (Reconcile Vat Report): ไอคอน Note ข้างสวิตช์ Enable/Disable ของแต่ละ Tax Code x Incomplete/Input
# กดแล้วเปิด Popup เขียน Note (เช่น Reconcile แล้วเจอ Diff + เหตุผลที่ยังไม่ตรง) เก็บเป็น History (ข้อความ / ผู้บันทึก / เวลาจริง)
import sys, io
path = sys.argv[1]
src = io.open(path, encoding="utf-8").read()
M = "MARKER_TIMELINE_FIRSTDRAFT_NOTES_V1"
if M in src:
    print("already patched"); sys.exit(0)

def rep(old, new, label):
    global src
    assert src.count(old) == 1, "anchor count != 1: %s (found %d)" % (label, src.count(old))
    src = src.replace(old, new)

COMP = r'''
// ''' + M + r''' -- ปุ่ม Note + Popup (History ของ Note ต่อช่อง)
function NoteButton({ items, subtitle, readOnly, onAdd }) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const list = Array.isArray(items) ? items : [];
  const has = list.length > 0;
  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const add = () => { const t = text.trim(); if (!t || readOnly) return; onAdd(t); setText(""); };
  return (
    <>
      <button
        type="button"
        title={has ? `Notes (${list.length})` : "Add note"}
        onClick={() => setOpen(true)}
        style={{ position: "relative", flex: "none", width: 30, height: 30, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", borderRadius: 8, border: "1px solid " + (has ? "#FAC775" : "#D9D6CB"), background: has ? "#FAEEDA" : "#fff", color: has ? "#854F0B" : "#8a8a85" }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" />
        </svg>
        {has && <span style={{ position: "absolute", top: -5, right: -5, minWidth: 15, height: 15, padding: "0 3px", boxSizing: "border-box", borderRadius: 8, background: "#C0392B", color: "#fff", fontSize: 10, fontWeight: 700, lineHeight: "15px", textAlign: "center" }}>{list.length}</span>}
      </button>
      {open && ReactDOM.createPortal(
        <div onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }} style={{ position: "fixed", inset: 0, zIndex: 100000, background: "rgba(15,30,50,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ width: 460, maxWidth: "100%", maxHeight: "86vh", display: "flex", flexDirection: "column", background: "#fff", borderRadius: 14, boxShadow: "0 12px 40px rgba(15,30,50,0.28)", overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", background: "#EEF2F7", borderBottom: "1px solid #E3E5EA" }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#1a3a5c" }}>Note</div>
              <div style={{ fontSize: 12, color: "#616e7c", marginTop: 2 }}>{subtitle}</div>
            </div>
            <div style={{ padding: "14px 18px 10px" }}>
              <textarea
                autoFocus
                rows={3}
                value={text}
                disabled={readOnly}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add(); } }}
                placeholder={readOnly ? "Period is closed (read only)" : "Write a note, e.g. Diff found — reason it doesn't match yet"}
                style={{ width: "100%", boxSizing: "border-box", resize: "vertical", padding: "8px 10px", fontSize: 13, fontFamily: "inherit", border: "1px solid #ccc", borderRadius: 8, outline: "none" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                <span style={{ fontSize: 11, color: "#8a8a85" }}>Ctrl + Enter to add</span>
                <button type="button" disabled={readOnly || !text.trim()} onClick={add} style={{ height: 32, padding: "0 16px", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "none", background: !readOnly && text.trim() ? "#1a3a5c" : "#ccc", color: "#fff", cursor: !readOnly && text.trim() ? "pointer" : "default" }}>Add Note</button>
              </div>
            </div>
            <div style={{ padding: "0 18px 4px", fontSize: 12, fontWeight: 600, color: "#1a3a5c" }}>History ({list.length})</div>
            <div style={{ padding: "6px 18px 14px", overflowY: "auto", minHeight: 60 }}>
              {list.length === 0 && <div style={{ padding: "14px 0", fontSize: 12, color: "#7b8794", textAlign: "center" }}>No notes yet</div>}
              {list.map((r, n) => (
                <div key={r.at + "|" + n} style={{ padding: "9px 0", borderTop: n ? "1px solid #F0F1F3" : "none" }}>
                  <div style={{ fontSize: 13, color: "#222", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{r.text}</div>
                  <div style={{ fontSize: 11, color: "#7b8794", marginTop: 3 }}>{(r.by || "-") + " · " + fmtRidAt(r.at)}</div>
                </div>
              ))}
            </div>
            <div style={{ padding: "10px 18px", borderTop: "1px solid #E3E5EA", display: "flex", justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setOpen(false)} style={{ height: 32, padding: "0 16px", fontSize: 13, borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: "#616e7c", cursor: "pointer" }}>Close</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
'''
rep("\nfunction stampNow() {", COMP + "\nfunction stampNow() {", "component")

# state persistence
rep("defaults: b.defaults, rhist: b.rhist });", "defaults: b.defaults, rhist: b.rhist, rnotes: b.rnotes });", "pickProg")
rep('  if (st.rhist && typeof st.rhist === "object") out.rhist = st.rhist;', '  if (st.rnotes && typeof st.rnotes === "object") out.rnotes = st.rnotes; // ' + M + '\n  if (st.rhist && typeof st.rhist === "object") out.rhist = st.rhist;', "mergeProg")
rep("delete snap.defaults; delete snap.rhist;", "delete snap.defaults; delete snap.rhist; delete snap.rnotes;", "defaults snap")

# handler
rep("  const onRptSet = (side, c, rk, v) => {",
"""  const onRptNote = (c, rk, text) => { // """ + M + """ -- Note ต่อช่อง First Draft (เก็บเป็น History ล่าสุดก่อน)
    const t = String(text || "").trim();
    if (!t) return;
    const key = `first:${c}:${rk}`;
    mutate(cur, (x) => { const arr = Array.isArray(x.rnotes && x.rnotes[key]) ? x.rnotes[key] : []; x.rnotes = { ...(x.rnotes || {}), [key]: [{ text: t, by: who, at: new Date().toISOString() }, ...arr].slice(0, 100) }; });
    log(cur, `Reconcile Report › First Draft Tax Code ${c} ${rk === "inc" ? "Incomplete" : "Input"}: Note added`);
  };
  const onRptSet = (side, c, rk, v) => {""", "handler")

# props
rep("onReqPick, onRptSet,", "onReqPick, onRptSet, onRptNote,", "BuPage sig")
rep("          onRptSet={onRptSet}\n", "          onRptSet={onRptSet}\n          onRptNote={onRptNote}\n", "call site")

# UI
rep('<EnableToggle full on={on} disabled={closed} onChange={(e) => onRptSet(side, c, rk, e ? "P" : "X")} />',
'''{side === "first" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ flex: 1, minWidth: 0 }}><EnableToggle full on={on} disabled={closed} onChange={(e) => onRptSet(side, c, rk, e ? "P" : "X")} /></div>
                      <NoteButton items={(u.rnotes || {})[`first:${c}:${rk}`]} subtitle={`First Draft · Tax Code ${c} · ${rk === "inc" ? "Incomplete" : "Input"}`} readOnly={closed} onAdd={(t) => onRptNote(c, rk, t)} />
                    </div>
                  ) : (
                    <EnableToggle full on={on} disabled={closed} onChange={(e) => onRptSet(side, c, rk, e ? "P" : "X")} />
                  )}''', "ui")

io.open(path, "w", encoding="utf-8", newline="").write(src)
print("patched OK")
