# -*- coding: utf-8 -*-
# MARKER_TIMELINE_RESET_AUTOFOCUS_CONFIRM_V1
# Popup ยืนยัน Reset BU: กรอกรหัสถูกต้อง -> Auto Focus ปุ่ม "ยืนยัน" (กด Enter ยืนยันได้ทันที)
import sys, io
path = sys.argv[1]
src = io.open(path, encoding="utf-8").read()
M = "MARKER_TIMELINE_RESET_AUTOFOCUS_CONFIRM_V1"
if M in src:
    print("already patched"); sys.exit(0)

def rep(old, new, label):
    global src
    assert src.count(old) == 1, "anchor count != 1: %s (found %d)" % (label, src.count(old))
    src = src.replace(old, new)

rep('  const closeReset = () => { setRstCode(""); setRstInput(""); setRstErr(false); };',
    '  const closeReset = () => { setRstCode(""); setRstInput(""); setRstErr(false); };\n'
    '  const rstBtnRef = React.useRef(null); // ' + M + '\n'
    '  const rstOk = !!rstCode && rstInput === rstCode;\n'
    '  React.useEffect(() => { if (rstOk && rstBtnRef.current) rstBtnRef.current.focus(); }, [rstOk]); // กรอกรหัสถูก -> โฟกัสปุ่มยืนยัน', "state/effect")

rep('<button type="button" onClick={confirmReset} disabled={rstInput.length !== 6} style={{ flex: 1, height: 36, background: rstInput.length === 6 ? C.navy : "#ccc", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, cursor: rstInput.length === 6 ? "pointer" : "default" }}>ยืนยัน</button>',
    '<button type="button" ref={rstBtnRef} onClick={confirmReset} disabled={rstInput.length !== 6} style={{ flex: 1, height: 36, background: rstInput.length === 6 ? C.navy : "#ccc", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, cursor: rstInput.length === 6 ? "pointer" : "default", outline: "none", boxShadow: rstOk ? "0 0 0 3px rgba(26,58,92,0.28)" : "none" }}>ยืนยัน</button>', "button")

io.open(path, "w", encoding="utf-8", newline="").write(src)
print("patched OK")
