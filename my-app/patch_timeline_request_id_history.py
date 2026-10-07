# -*- coding: utf-8 -*-
# MARKER_TIMELINE_REQUEST_ID_HISTORY_V1
# ไอคอน Storage ข้างช่อง Request ID ทุกจุด -> Popover ประวัติ Request ID 5 รายการล่าสุด (ID / ผู้บันทึก / วันเวลาจริง / ใช้ค่านี้)
import sys, io, re
path = sys.argv[1]
src = io.open(path, encoding="utf-8").read()
M = "MARKER_TIMELINE_REQUEST_ID_HISTORY_V1"
if M in src:
    print("already patched"); sys.exit(0)

def rep(old, new, label, count=1):
    global src
    assert src.count(old) == count, "anchor count != %d: %s (found %d)" % (count, label, src.count(old))
    src = src.replace(old, new)

def rep_re(pattern, fn, label):
    global src
    ms = list(re.finditer(pattern, src, re.S))
    assert len(ms) == 1, "regex count != 1: %s (found %d)" % (label, len(ms))
    m = ms[0]
    src = src[:m.start()] + fn(m.group(0)) + src[m.end():]

# 1) import ReactDOM (Portal กัน Popover โดนตัดด้วย overflow)
rep('import { apiFetch } from "../api";', 'import ReactDOM from "react-dom"; // ' + M + '\nimport { apiFetch } from "../api";', "import")

# 2) Component RidHistory + fmt เวลา (วางก่อน stampNow)
COMP = r'''
// ''' + M + r''' -- Popover ประวัติ Request ID (ล่าสุด 5 รายการ) ใช้ซ้ำได้ทุกจุดที่กรอก Request ID
function fmtRidAt(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const o = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(d).reduce((a, p) => { a[p.type] = p.value; return a; }, {});
  return `${Number(o.day)} ${TH_MONTH[Number(o.month) - 1]} ${String((Number(o.year) + 543) % 100).padStart(2, "0")} ${o.hour}:${o.minute}`;
}
function RidHistory({ items, current, disabled, onPick, small, title }) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState({ top: 0, left: 0 });
  const btnRef = React.useRef(null);
  const list = Array.isArray(items) ? items.slice(0, 5) : [];
  React.useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (e && e.target && e.target.closest && e.target.closest("[data-rid-pop]")) return; setOpen(false); };
    document.addEventListener("mousedown", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => { document.removeEventListener("mousedown", close); window.removeEventListener("resize", close); window.removeEventListener("scroll", close, true); };
  }, [open]);
  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const W = 268, H = 56 + Math.max(list.length, 1) * 54;
      const left = Math.max(8, Math.min(r.right - W, window.innerWidth - W - 8));
      const top = r.bottom + 4 + H > window.innerHeight ? Math.max(8, r.top - H - 4) : r.bottom + 4;
      setPos({ top, left });
    }
    setOpen((v) => !v);
  };
  const sz = small ? 20 : 38;
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title={title || `ประวัติ Request ID (${list.length})`}
        onClick={toggle}
        style={{ flex: "none", width: sz, height: sz, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", borderRadius: small ? 6 : 9, border: small ? "none" : "1px solid #ccc", background: small ? "transparent" : "#fff", color: list.length ? "#1a3a5c" : "#b5b8bd", opacity: list.length ? 1 : 0.75 }}
      >
        <svg width={small ? 14 : 18} height={small ? 14 : 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
        </svg>
      </button>
      {open && ReactDOM.createPortal(
        <div data-rid-pop="1" style={{ position: "fixed", top: pos.top, left: pos.left, width: 268, zIndex: 100000, background: "#fff", border: "1px solid #E3E5EA", borderRadius: 12, boxShadow: "0 8px 24px rgba(15,30,50,0.18)", overflow: "hidden", fontFamily: "inherit" }}>
          <div style={{ padding: "9px 12px", fontSize: 12, fontWeight: 600, color: "#1a3a5c", background: "#EEF2F7", borderBottom: "1px solid #E3E5EA" }}>Request ID ที่เคยบันทึก (ล่าสุด 5 รายการ)</div>
          {list.length === 0 && <div style={{ padding: "16px 12px", fontSize: 12, color: "#7b8794", textAlign: "center" }}>ยังไม่มีประวัติ</div>}
          {list.map((r, n) => {
            const same = String(r.v) === String(current || "");
            return (
              <div key={r.v + "|" + n} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderTop: n ? "1px solid #F0F1F3" : "none" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#222", fontVariantNumeric: "tabular-nums", letterSpacing: 0.3 }}>{r.v}</div>
                  <div style={{ fontSize: 11, color: "#7b8794", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{(r.by || "-") + " · " + fmtRidAt(r.at)}</div>
                </div>
                <button type="button" disabled={disabled || same} onClick={() => { setOpen(false); onPick(r.v); }} style={{ flex: "none", height: 28, padding: "0 10px", fontSize: 11, fontWeight: 600, borderRadius: 8, border: "1px solid " + (same ? "#CFE5B0" : "#1a3a5c"), background: same ? "#EEF6E4" : "#fff", color: same ? "#27500A" : "#1a3a5c", cursor: disabled || same ? "default" : "pointer", opacity: disabled && !same ? 0.5 : 1 }}>{same ? "ใช้อยู่" : "ใช้ค่านี้"}</button>
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}
'''
rep("function stampNow() {", COMP + "\nfunction stampNow() {", "component")

# 3) pickProg / mergeProg / defaults snapshot
rep("ids: b.ids, buClosed: b.buClosed, defaults: b.defaults });", "ids: b.ids, buClosed: b.buClosed, defaults: b.defaults, rhist: b.rhist });", "pickProg")
rep('  if (st.defaults && typeof st.defaults === "object") out.defaults = st.defaults;',
    '  if (st.defaults && typeof st.defaults === "object") out.defaults = st.defaults;\n  if (st.rhist && typeof st.rhist === "object") out.rhist = st.rhist; // ' + M, "mergeProg")
rep("const snap = clone(pickProg(x)); delete snap.defaults;", "const snap = clone(pickProg(x)); delete snap.defaults; delete snap.rhist;", "defaults snap")

# 4) Handlers
rep("""  const onVatCommit = (i) => {
    const c = bus[cur].vat.cards[i];
    mutate(cur, (x) => { x.vat.cards[i].by = x.vat.cards[i].v ? `${who} · 8 ต.ค.` : ""; });
    if (c.v) log(cur, `Closing Vat › ${VAT_CARDS[i].name}: บันทึก Request ID ${c.v}`);
  };""",
"""  // """ + M + r""" -- เก็บประวัติ Request ID ต่อช่อง (ล่าสุด 5 รายการ: ID / ผู้บันทึก / เวลาจริง) ไว้ใน state.rhist -> บันทึกลง timeline_progress
  const lastRid = (u, key) => { const a = u && u.rhist && u.rhist[key]; return Array.isArray(a) && a[0] ? String(a[0].v) : ""; };
  const pushRid = (x, key, val) => {
    const v = String(val || "");
    if (!v || v === "X") return;
    const arr = Array.isArray(x.rhist && x.rhist[key]) ? x.rhist[key] : [];
    if (arr[0] && String(arr[0].v) === v) return;
    x.rhist = { ...(x.rhist || {}), [key]: [{ v, by: who, at: new Date().toISOString() }, ...arr.filter((r) => String(r.v) !== v)].slice(0, 5) };
  };
  const onVatCommit = (i) => {
    const c = bus[cur].vat.cards[i];
    const changed = !!c.v && lastRid(bus[cur], `vat:${i}`) !== String(c.v);
    mutate(cur, (x) => { const cd = x.vat.cards[i]; if (!cd.v) cd.by = ""; else if (changed || !cd.by) cd.by = `${who} · ${stampNow()}`; pushRid(x, `vat:${i}`, cd.v); });
    if (changed) log(cur, `Closing Vat › ${VAT_CARDS[i].name}: บันทึก Request ID ${c.v}`);
  };
  const onVatPick = (i, v) => {
    mutate(cur, (x) => { x.vat.cards[i].v = String(v); x.vat.cards[i].by = `${who} · ${stampNow()}`; pushRid(x, `vat:${i}`, v); });
    log(cur, `Closing Vat › ${VAT_CARDS[i].name}: ใช้ Request ID ${v} (จากประวัติ)`);
  };
  const onReqCommit = (g, k) => {
    const val = bus[cur].req[g][k];
    if (!val || val === "X") return;
    const changed = lastRid(bus[cur], `req:${g}:${k}`) !== String(val);
    mutate(cur, (x) => { pushRid(x, `req:${g}:${k}`, x.req[g][k]); });
    if (changed) log(cur, `Request ID › ${g} ${k}: บันทึก Request ID ${val}`);
  };
  const onReqPick = (g, k, v) => {
    mutate(cur, (x) => { x.req[g][k] = String(v); pushRid(x, `req:${g}:${k}`, v); });
    log(cur, `Request ID › ${g} ${k}: ใช้ Request ID ${v} (จากประวัติ)`);
  };""", "handlers")

# 5) ส่ง props
rep("onVatCommit, onVatStatus, onReqId, onReqToggle,", "onVatCommit, onVatStatus, onReqId, onReqToggle, onVatPick, onReqCommit, onReqPick,", "BuPage sig")
rep("          onReqId={onReqId}\n", "          onReqId={onReqId}\n          onVatPick={onVatPick}\n          onReqCommit={onReqCommit}\n          onReqPick={onReqPick}\n", "call site")

# 6) UI จุดที่ 1: การ์ด Closing Vat (ไอคอนข้างช่อง)
def wrap_input(block, histKey, pickExpr, curExpr, commitExpr):
    block = block.replace('style={{ width: "100%", boxSizing', 'style={{ flex: "1 1 0%", minWidth: 0, boxSizing', 1)
    assert 'flex: "1 1 0%", minWidth: 0' in block, "input style not found"
    block = re.sub(r"(\n\s*)/>$", lambda mm: mm.group(1) + "onKeyDown={(e) => { if (e.key === \"Enter\") e.currentTarget.blur(); }}" + mm.group(1) + "/>", block)
    return ('<div style={{ display: "flex", alignItems: "center", gap: 6 }}>\n' + block +
            '\n<RidHistory items={(u.rhist || {})[' + histKey + ']} current={' + curExpr + '} disabled={closed} onPick={(v) => ' + pickExpr + '} />\n</div>')

rep_re(r'<input\s+value=\{c\.v\}.*?\n\s*/>',
       lambda b: wrap_input(b, "`vat:${i}`", "onVatPick(i, v)", "c.v", None), "vat input")

# 7) UI จุดที่ 3: การ์ด Input Summary
rep_re(r'<input\s+value=\{v\}\s+inputMode="numeric"\s+placeholder="Request ID"\s+disabled=\{closed\}\s+onChange=\{\(e\) => onReqId\("Input Summary", k, e\.target\.value\)\}.*?\n\s*/>',
       lambda b: wrap_input(b.replace('onChange={(e) => onReqId("Input Summary", k, e.target.value)}', 'onChange={(e) => onReqId("Input Summary", k, e.target.value)}\n onBlur={() => onReqCommit("Input Summary", k)}'),
                            '`req:Input Summary:${k}`', 'onReqPick("Input Summary", k, v)', "v", None), "sum input")

# 8) UI จุดที่ 2: ตาราง Request ID (ช่องแคบ -> ไอคอนเล็กในแถวหัวช่อง + blur commit)
rep('onChange={(e) => onReqId(g, k, e.target.value)}',
    'onChange={(e) => onReqId(g, k, e.target.value)}\n                      onBlur={() => onReqCommit(g, k)}\n                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}', "matrix input")
rep_re(r'\{!off && !closed && <button type="button" title="Disable".*?</button>\}',
       lambda b: '<span style={{ display: "flex", alignItems: "center", gap: 2 }}>{!off && <RidHistory small items={(u.rhist || {})[`req:${g}:${k}`]} current={v} disabled={closed} onPick={(val) => onReqPick(g, k, val)} />}' + b + '</span>', "matrix header")

io.open(path, "w", encoding="utf-8", newline="").write(src)
print("patched OK")
