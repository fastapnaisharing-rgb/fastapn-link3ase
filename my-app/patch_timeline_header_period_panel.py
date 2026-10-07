# -*- coding: utf-8 -*-
# MARKER_TIMELINE_HEADER_PERIOD_PANEL_V1
# Header ใหม่ (แบบ A): แถวชื่อ/ตัวกรอง -> KPI 4 ใบ -> แถบ Period (Current period / Open / Deadline / days left / แถบวัน)
# ดึงจาก VAT Period (/vat/period/status) สูตรเดียวกับ UserManagement > Period Panel
# แก้บั๊ก Deadline เดิม: เดิมใช้ vatDeadlineOf(vat_period_month) = Deadline ของรอบก่อนหน้า (4 ก.ย.) -> ที่ถูกคือ Deadline ของรอบถัดไป (06-Oct-2026)
import sys, io
path = sys.argv[1]
src = io.open(path, encoding="utf-8").read()
M = "MARKER_TIMELINE_HEADER_PERIOD_PANEL_V1"
if M in src:
    print("already patched"); sys.exit(0)
def rep(old, new, label):
    global src
    assert src.count(old) == 1, "anchor count != 1: %s (%d)" % (label, src.count(old))
    src = src.replace(old, new)

# 1) helper คำนวณข้อมูล Period + แถบวัน
HELPER = r'''// ''' + M + r''' -- ข้อมูล Period สำหรับ Header (สูตรเดียวกับ UserManagement > Period Panel)
const EN_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtFullDate = (d) => (d ? `${String(d.getDate()).padStart(2, "0")}-${EN_MON[d.getMonth()]}-${d.getFullYear()}` : "---");
function vatPeriodInfo(month) {
  const m = /^(\d{4})-(\d{2})/.exec(String(month || ""));
  if (!m) return {};
  const nx = new Date(Number(m[1]), Number(m[2]), 1); // เดือนถัดจาก vat_period_month = เดือนของรอบปัจจุบัน
  const periodYm = `${nx.getFullYear()}-${String(nx.getMonth() + 1).padStart(2, "0")}`;
  const deadline = vatDeadlineOf(periodYm);
  const prevDeadline = vatDeadlineOf(m[1] + "-" + m[2]);
  if (!deadline) return { periodYm };
  const day = 86400000;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dl = new Date(deadline); dl.setHours(0, 0, 0, 0);
  const startDate = prevDeadline ? new Date(prevDeadline) : new Date(nx);
  if (prevDeadline) startDate.setDate(startDate.getDate() + 1);
  startDate.setHours(0, 0, 0, 0);
  const totalDays = Math.max(1, Math.round((dl - startDate) / day) + 1);
  const daysPassed = Math.max(0, Math.min(totalDays, Math.round((today - startDate) / day) + 1));
  const daysLeft = Math.max(0, Math.round((dl - today) / day));
  let d = new Date(dl), wk = 0, dangerStart = null;
  while (wk < 2) { const wd = d.getDay(); if (wd !== 0 && wd !== 6) wk++; if (wk === 2) { dangerStart = new Date(d); break; } d.setDate(d.getDate() - 1); }
  const dangerZoneDays = dangerStart ? Math.round((dl - dangerStart) / day) + 1 : 2;
  return { periodYm, deadline, startDate, totalDays, daysPassed, daysLeft, dangerZoneDays, isTodayInDanger: dangerStart ? today >= dangerStart : false };
}
'''
rep("const KPI_ICON = {", HELPER + "const KPI_ICON = {", "helper")

# 2) Period state ใช้ info
rep('status: r.vat_period_current_status || "open", deadline: vatDeadlineOf(month) });',
    'status: r.vat_period_current_status || "open", ...vatPeriodInfo(month) });', "setPeriod")

# 3) ชื่อรอบหลัง Title ดึงจาก VAT Period
rep('<span style={{ fontSize: 13, color: "#666" }}>รอบ ก.ย. 2569</span>',
    '<span style={{ fontSize: 13, color: "#666" }}>{period && period.periodYm ? `รอบ ${TH_MONTH[Number(period.periodYm.slice(5, 7)) - 1]} ${Number(period.periodYm.slice(0, 4)) + 543}` : "รอบ -"}</span>', "title")

# 4) PeriodPanel component
PANEL = r'''// ''' + M + r''' -- แถบ Period (พื้นขาว ใต้ KPI)
function PeriodPanel({ period }) {
  const box = { background: "#fff", borderRadius: 12, padding: "12px 16px", marginBottom: 12, flexShrink: 0 };
  if (!period || period.loading) return <div style={{ ...box, fontSize: 13, color: "#7b8794" }}>กำลังโหลด Period...</div>;
  if (period.error || !period.deadline) return <div style={{ ...box, fontSize: 13, color: "#616e7c" }}>ไม่พบข้อมูล Period</div>;
  const closedP = period.status === "closed";
  const SB = { open: ["Open", "#EAF3DE", "#27500A"], "pre-close": ["Pre-close", "#FCEBEB", "#791F1F"], blocked: ["Pre-close", "#FCEBEB", "#791F1F"], closed: ["Closed", "#f5f5f5", "#555"] };
  const sb = SB[period.status] || SB.open;
  const label = `${EN_MON[Number(period.periodYm.slice(5, 7)) - 1]} ${Number(period.periodYm.slice(0, 4)) + 543}`;
  return (
    <div style={box}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>Current period</div>
          <div style={{ fontSize: 20, fontWeight: 500, color: C.navy, lineHeight: 1.15 }}>{fmtFullDate(period.startDate)}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
            <span style={{ fontSize: 12, color: "#aaa" }}>{label}</span>
            <span style={{ fontSize: 11, padding: "2px 9px", borderRadius: 20, background: sb[1], color: sb[2], fontWeight: 500 }}>{sb[0]}</span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>Deadline</div>
          <div style={{ fontSize: 20, fontWeight: 500, color: C.navy, lineHeight: 1.15 }}>{fmtFullDate(period.deadline)}</div>
          <div style={{ fontSize: 12, marginTop: 2, color: closedP ? "#27500A" : period.isTodayInDanger ? "#791F1F" : "#856404" }}>
            {closedP ? "Closed" : period.daysLeft <= 0 ? "Deadline passed" : `${period.daysLeft} day${period.daysLeft === 1 ? "" : "s"} left`}
          </div>
        </div>
      </div>
      {!closedP && (
        <div style={{ display: "flex", gap: 3, marginTop: 10 }}>
          {Array.from({ length: period.totalDays }, (_, i) => {
            const done = i < period.daysPassed;
            const danger = period.isTodayInDanger && i >= period.totalDays - period.dangerZoneDays;
            return <div key={i} style={{ flex: 1, height: 6, borderRadius: 2, background: danger ? "#E24B4A" : done ? "#FAC775" : "#eeede6" }} />;
          })}
        </div>
      )}
    </div>
  );
}
'''
rep("function Lobby({ bus, tab, closed, filter, onView, onToggleScope, period }) {", PANEL + "function Lobby({ bus, tab, closed, filter, onView, onToggleScope, period }) {", "panel")

# 5) KPI 4 ใบ + PeriodPanel แทนบล็อก KPI เดิม
a = src.index('      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginBottom: 12, flexShrink: 0 }}>')
b = src.index('      <div className="tl-hide-scroll" style={{ flex: "1 1 0%", minHeight: 0, overflowY: "auto"')
assert a < b
NEW = '''      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginBottom: 12, flexShrink: 0 }}>
        <Kpi icon="progress" label="ภาพรวมที่ทำแล้ว" value={all === null ? "—" : `${all}%`} />
        <Kpi icon="bu" label="BU Active" value={inScope.length} />
        <Kpi icon="off" label="BU Inactive" value={shown.length - inScope.length} color="#616e7c" />
        <Kpi icon="done" label="เสร็จ 100%" value={shown.filter(({ u, i }) => u.inScope && prog[i].all === 100).length} />
      </div>
      <PeriodPanel period={period} />
'''
src = src[:a] + NEW + src[b:]
io.open(path, "w", encoding="utf-8", newline="").write(src)
print("patched OK")
