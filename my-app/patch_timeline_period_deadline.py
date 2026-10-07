# -*- coding: utf-8 -*-
# MARKER_TIMELINE_PERIOD_DEADLINE_FROM_VAT_PERIOD_V1
# ช่อง Period (KPI) ใน Timeline ดึง Period/Deadline จาก /vat/period/status (เดียวกับ System Console > Period Panel > VAT control)
import sys, io
path = sys.argv[1]
src = io.open(path, encoding="utf-8").read()
M = "MARKER_TIMELINE_PERIOD_DEADLINE_FROM_VAT_PERIOD_V1"
if M in src:
    print("already patched"); sys.exit(0)

def rep(old, new, label):
    global src
    assert src.count(old) == 1, "anchor not unique/missing: " + label
    src = src.replace(old, new)

# 1) import apiFetch
rep('import { broadcastWs } from "../wsManager";',
    'import { broadcastWs } from "../wsManager";\nimport { apiFetch } from "../api"; // ' + M, "import")

# 2) helper: Deadline = N วันทำการแรกของเดือนถัดไป (สูตรเดียวกับ Period Panel: VAT = 4 วันทำการ)
rep('const PERIOD_YM = "2026-09";',
'''// ''' + M + ''' -- Deadline ปิด VAT = 4 วันทำการแรกของเดือนถัดจาก vat_period_month (สูตรเดียวกับ UserManagement > Period Panel; ยังไม่หักวันหยุดนักขัตฤกษ์เหมือนที่นั่น)
const VAT_DEADLINE_BUSINESS_DAYS = 4;
function vatDeadlineOf(ym) {
  const m = /^(\\d{4})-(\\d{2})/.exec(String(ym || ""));
  if (!m) return null;
  let d = new Date(Number(m[1]), Number(m[2]), 1), cnt = 0;
  while (true) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) { cnt++; if (cnt === VAT_DEADLINE_BUSINESS_DAYS) return new Date(d); }
    d.setDate(d.getDate() + 1);
  }
}
const PERIOD_YM = "2026-09";''', "helper")

# 3) Lobby รับ prop period + แสดงในช่อง Period
rep('function Lobby({ bus, tab, closed, filter, onView, onToggleScope }) {',
    'function Lobby({ bus, tab, closed, filter, onView, onToggleScope, period }) {', "Lobby sig")
rep('<Kpi icon="period" label="Period" value={closed ? "ปิดแล้ว (30 ก.ย. 2569)" : "เปิดอยู่ · ครบกำหนด 6 ต.ค."} color={closed ? "#791F1F" : "#27500A"} small />',
'''<Kpi icon="period" label="Period" value={(() => { // ''' + M + '''
          if (!period || period.loading) return "กำลังโหลด...";
          if (period.error) return "ไม่พบข้อมูล Period";
          const dl = period.deadline ? `ครบกำหนด ${period.deadline.getDate()} ${TH_MONTH[period.deadline.getMonth()]}` : "";
          return `${period.status === "closed" ? "ปิดแล้ว" : "เปิดอยู่"}${dl ? " · " + dl : ""}`;
        })()} color={period && !period.loading && !period.error && period.status === "closed" ? "#791F1F" : period && period.error ? "#616e7c" : "#27500A"} small />''', "Kpi")

# 4) State + fetch ใน TimelinePage
rep('  const closed = false; // Dashboard นี้ไม่มีการปิด Period',
'''  const [period, setPeriod] = React.useState({ loading: true, error: "", month: "", status: "open", deadline: null }); // ''' + M + '''
  React.useEffect(() => {
    let off = false;
    (async () => {
      try {
        const r = await apiFetch("/vat/period/status");
        if (off) return;
        const month = r && r.vat_period_month ? String(r.vat_period_month) : "";
        if (!month) { setPeriod({ loading: false, error: "no-period", month: "", status: "open", deadline: null }); return; }
        setPeriod({ loading: false, error: "", month, status: r.vat_period_current_status || "open", deadline: vatDeadlineOf(month) });
      } catch (e) {
        if (!off) setPeriod({ loading: false, error: String((e && e.message) || e), month: "", status: "open", deadline: null });
      }
    })();
    return () => { off = true; };
  }, [reload]);
  const closed = false; // Dashboard นี้ไม่มีการปิด Period''', "state")

rep('<Lobby bus={bus} tab={tabEff} closed={closed} filter={filter} onView={setCur} onToggleScope={onToggleScope} />',
    '<Lobby bus={bus} tab={tabEff} closed={closed} filter={filter} onView={setCur} onToggleScope={onToggleScope} period={period} />', "Lobby use")

io.open(path, "w", encoding="utf-8", newline="").write(src)
print("patched OK")
