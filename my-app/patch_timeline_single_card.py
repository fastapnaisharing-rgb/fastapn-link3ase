# -*- coding: utf-8 -*-
# MARKER_TIMELINE_SINGLE_CARD_V1
# รวม Timeline Closed Vat + KPI 4 ช่อง + แถบฟิลเตอร์ ไว้ในการ์ดใบเดียว (ตาม Mockup v6)
#  - ลบหัวข้อ "Timeline ปิดภาษี"
#  - "Current period" -> "Timeline Closed Vat"
#  - งานของฉัน -> My Job / All User Related Status -> All Job (ชิดซ้าย) ; สถานะ + Config ชิดขวา
#  - ตารางด้านล่าง (Prepare to Transfer / Input / Incomplete ...) ไม่แก้
# ใช้: python patch_timeline_single_card.py <path TimelinePage.js>
import sys, io
path = sys.argv[1]
src = io.open(path, encoding="utf-8").read()
M = "MARKER_TIMELINE_SINGLE_CARD_V1"
if M in src:
    print("already patched"); sys.exit(0)

def rep(old, new, label):
    global src
    assert src.count(old) == 1, "anchor count != 1: %s (%d)" % (label, src.count(old))
    src = src.replace(old, new)

# ---- A) Kpi: โหมด bare (ไม่มีพื้นขาว/มุมโค้ง) + เส้นคั่นซ้าย ----
rep('function Kpi({ label, value, color, icon, small }) {',
    'function Kpi({ label, value, color, icon, small, bare, divider }) {', "kpi sig")
rep('<div style={{ background: "#fff", borderRadius: 12, padding: 12, display: "flex", alignItems: "center", gap: 12 }}>\n      {ic && (',
    '<div style={bare ? { padding: "4px 18px", display: "flex", alignItems: "center", gap: 12, borderLeft: divider ? "1px solid #e6e4dd" : "none" } : { background: "#fff", borderRadius: 12, padding: 12, display: "flex", alignItems: "center", gap: 12 }}>\n      {ic && (', "kpi box")

# ---- B) PeriodPanel: bare + เปลี่ยนคำ ----
rep('function PeriodPanel({ period }) {\n  const box = { background: "#fff", borderRadius: 12, padding: "12px 16px", marginBottom: 12, flexShrink: 0 };',
    'function PeriodPanel({ period, bare }) {\n  const box = bare ? { padding: "16px 22px" } : { background: "#fff", borderRadius: 12, padding: "12px 16px", marginBottom: 12, flexShrink: 0 };', "period box")
rep('marginBottom: 4 }}>Current period</div>', 'marginBottom: 4 }}>Timeline Closed Vat</div>', "current period")

# ---- C) Lobby: การ์ดใบเดียว (Timeline + KPI + Toolbar) ----
rep('function Lobby({ bus, tab, closed, filter, onView, onToggleScope, period }) {',
    'function Lobby({ bus, tab, closed, filter, onView, onToggleScope, period, toolbar }) {', "lobby sig")
i = src.index('      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginBottom: 12, flexShrink: 0 }}>\n        <Kpi icon="progress"')
j_marker = '      <PeriodPanel period={period} />\n'
j = src.index(j_marker, i) + len(j_marker)
new_card = '''      {/* MARKER_TIMELINE_SINGLE_CARD_V1 -- การ์ดใบเดียว: Timeline + KPI + ฟิลเตอร์ */}
      <div style={{ background: "#fff", borderRadius: 12, marginBottom: 12, flexShrink: 0, overflow: "hidden" }}>
        <PeriodPanel period={period} bare />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", padding: "12px 22px", background: "#FAF9F6", borderTop: "1px solid #e6e4dd" }}>
          <Kpi bare icon="progress" label="ภาพรวมที่ทำแล้ว" value={all === null ? "—" : `${all}%`} />
          <Kpi bare divider icon="bu" label="BU Active" value={inScope.length} />
          <Kpi bare divider icon="off" label="BU Inactive" value={shown.length - inScope.length} color="#616e7c" />
          <Kpi bare divider icon="done" label="เสร็จ 100%" value={shown.filter(({ u, i }) => u.inScope && prog[i].all === 100).length} />
        </div>
        {toolbar && <div style={{ padding: "12px 22px", borderTop: "1px solid #e6e4dd" }}>{toolbar}</div>}
      </div>
'''
src = src[:i] + new_card + src[j:]

# ---- D) Parent: ย้ายแถบฟิลเตอร์ออกจาก Header -> const toolbar ส่งเข้า Lobby ----
hs = src.index('      {cur < 0 && (\n      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>')
he_m = '      )}\n      {showInc && <IncludeModal'
he = src.index(he_m, hs)
src = src[:hs] + src[he + len('      )}\n'):]

toolbar_const = '''  // MARKER_TIMELINE_HEADER_CLEANUP_V1 (หัวข้อ "Timeline ปิดภาษี" ถูกลบแล้ว)
  // แถบฟิลเตอร์: My Job / All Job ชิดซ้าย · สถานะ + Config ชิดขวา (อยู่ในการ์ดเดียวกับ Timeline)
  const tlToolbar = (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, fontSize: 12, color: "#999" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {isAdmin && (
          <span style={{ display: "inline-flex" }}>
            {[["mine", "My Job"], ["all", "All Job"]].map(([k, t], n) => (
              <button key={k} type="button" style={{ ...btn, borderRadius: n === 0 ? "6px 0 0 6px" : "0 6px 6px 0", background: tab === k ? C.navy : "#fff", color: tab === k ? "#fff" : "#1f2933", fontWeight: tab === k ? 600 : 400, padding: "0 14px", height: 30, boxSizing: "border-box" }} onClick={() => setTab(k)}>{t}</button>
            ))}
          </span>
        )}
        {isAdmin && tab === "all" && (
          <button type="button" onClick={() => setShowInc(true)} title="เลือก User ที่ต้องการดูใน Tab นี้" style={{ ...btn, height: 30, padding: "0 12px", borderRadius: 8, boxSizing: "border-box", color: C.navy, fontWeight: 600 }}>เลือก User ({(inc || []).length})</button>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span>สถานะ</span>
        <span>
          {[["all", "All"], ["pending", "Pending"], ["confirm", "Confirm"]].map(([k, t], n) => (
            <button key={k} type="button" style={{ ...btn, borderRadius: n === 0 ? "6px 0 0 6px" : n === 2 ? "0 6px 6px 0" : 0, background: filter === k ? "#f1efe8" : "#fff", fontWeight: filter === k ? 600 : 400, color: "#1f2933", height: 30, boxSizing: "border-box" }} onClick={() => setFilter(k)}>{t}</button>
          ))}
        </span>
        <button type="button" aria-label="Config BU" title="Config BU" onClick={() => setShowCfg(true)} style={{ ...btn, width: 30, height: 30, padding: 0, borderRadius: 8, fontSize: 16, color: C.navy }}>⚙</button>
      </div>
    </div>
  );

'''
anchor = '  return (\n    <div ref={rootRef} className="tl-hide-scroll"'
assert src.count(anchor) == 1, "return anchor"
src = src.replace(anchor, toolbar_const + anchor)
rep('onToggleScope={onToggleScope} period={period} />', 'onToggleScope={onToggleScope} period={period} toolbar={tlToolbar} />', "lobby call")

io.open(path, "w", encoding="utf-8", newline="").write(src)
print("patched OK")
