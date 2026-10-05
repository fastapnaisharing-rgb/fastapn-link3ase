import React from "react";
import { useAuth } from "../contexts/AuthContext";
import { useUserRole } from "../contexts/useUserRole";
import { db } from "../lib/db";
import { broadcastWs } from "../wsManager";

// MARKER_TIMELINE_PAGE_PROTOTYPE_V1
// Timeline ปิดภาษี (VAT Controller > Reconcile > Timeline)
// Prototype: ใช้ข้อมูลตัวอย่างใน State (ยังไม่ต่อ Backend) -- ดู Design ที่ project doc claude/tax_close_timeline_design.md
// Lobby (ภาพรวม + % ต่อ BU) -> กด View -> หน้า BU (Request ID + เช็คลิสต์ต่อขั้นตอน + ประวัติ) -> กลับ Lobby

const DEMO_TODAY = 8; // วันที่สมมติสำหรับคำนวณ "เลยกำหนด" ในข้อมูลตัวอย่าง

const CHECKLIST_BY_GROUP = {
  "Special operation": ["เตรียมข้อมูล", "ตรวจสอบยอด", "บันทึก/ยื่นผล"],
  "Daily": ["ดึงรายงานรายวัน", "ตรวจสอบผลต่าง", "ปิดรายการ"],
  "Popup": ["ตรวจรายการ Popup", "Pop เข้าระบบ", "ตรวจสอบหลัง Pop"],
  "รายงาน": ["ขอรายงาน (ผูก Request ID)", "ตรวจสอบรายการ", "บันทึกผลตรวจ"],
};

// 46119: Checklist ครบทุกแพลตฟอร์มจึงจะ Auto เป็น Y (ตามช่อง "Percentage 46119 Completed" ใน Macro)
const PLATFORMS_46119 = [
  "Shopee", "Lazada", "Panda", "Line-MK", "W123", "Line-FD", "2C2P", "Robin",
  "Grab", "Tiktok", "Thai Happy", "Web OS", "Noc Noc", "ITC (CS)", "LineGift", "GB Prime",
  "Wechat", "Yindee", "Gokoo", "ACDS", "ADFM", "Other",
];

// แพลตฟอร์มที่ BU ตัวอย่างไม่มี (Disable ระดับรายการ ไม่นับใน %) -- ของจริงเลือกต่อ BU ต่อรอบ
const OFF_46119_SAMPLE = ["Panda", "W123", "2C2P", "Grab", "Noc Noc", "Wechat", "Gokoo", "ADFM"];

const STEPS = [
  { k: "PP36", g: "Special operation" },
  { k: "CPN", g: "Special operation" },
  { k: "46119", g: "Special operation" },
  { k: "Dailyvat", g: "Daily" },
  { k: "AP01-5", g: "Popup" },
  { k: "Pop M", g: "Popup" },
  { k: "Incomplete", g: "รายงาน" },
  { k: "Input Summary", g: "รายงาน" },
  { k: "Reconcile", g: "รายงาน" },
  { k: "Deposit Clearing", g: "Special operation" }, // เพิ่มท้ายสุดเพื่อไม่ให้ลำดับข้อมูลตัวอย่างเลื่อน
];
// TODO Zone ถัดไป: Request ID (IPR), Report (Incomplete/Input Summary/Reconcile), Daily

const C = {
  navy: "#1a3a5c",
  border: "#e0e0e0",
  muted: "#888",
  Y: { bg: "#EAF3DE", fg: "#27500A" },
  N: { bg: "#FAEEDA", fg: "#633806" },
  X: { bg: "#FCEBEB", fg: "#791F1F" },
  D: { bg: "#F1EFE8", fg: "#888" },
};
const ST_LABEL = { Y: "Y", N: "N", X: "X", D: "-" };

// สถานะเริ่มต้นของข้อมูลตัวอย่าง (อิงตัวอย่างจาก Macro): Y=ทำแล้ว N=ยังไม่ทำ X=ไม่เกี่ยวข้อง D=ไม่มี
function makeTasks(initial) {
  const out = {};
  STEPS.forEach((s, i) => {
    const v = initial[i];
    const mode = v === "X" ? "X" : v === "D" ? "D" : "auto";
    out[s.k] = {
      mode,
      due: i % 3 === 0 ? 6 : 10,
      rid: "",
      items: (s.k === "46119" ? PLATFORMS_46119 : CHECKLIST_BY_GROUP[s.g]).map((label, n) => {
        const done = v === "Y" || (v === "N" && (s.k === "46119" ? n < 3 : n === 0 && i % 2 === 0));
        const off = s.k === "46119" && OFF_46119_SAMPLE.includes(label);
        return { label, off, done: done && !off, by: done && !off ? "ตัวอย่าง · 7 ต.ค." : "" };
      }),
    };
  });
  return out;
}

// Zone "Closing Vat - Request ID": เก็บ Request ID สำหรับโอน VAT (ไม่นับรวมใน % ของ Lobby)
const VAT_CARDS = [
  { g: "DAILY AVERAGE", name: "Daily Average - A No" },
  { g: "DAILY AVERAGE", name: "Daily Average - A , T" },
  { g: "DAILY SUSPENSE", name: "Daily Suspense - N" },
  { g: "DAILY SUSPENSE", name: "Daily Suspense - T/F" },
  { g: "TRIAL BALANCE", name: "Trial Balance" },
  { g: "SIMPLE · EXPENSE", name: "Expense 100%" },
  { g: "SIMPLE · EXPENSE", name: "Expense AVG" },
  { g: "SIMPLE · ASSET", name: "Asset 100%" },
  { g: "SIMPLE · ASSET", name: "Asset AVG" },
];
function makeVat(v) {
  // v = [A No, A,T, Suspense N, Suspense T/F, Trial Balance, Expense 100%, Expense AVG, Asset 100%, Asset AVG, Transfer Vat Status]: "X"=Disable, ""=ยังไม่กรอก, ตัวเลข=Request ID, status "O"/"X"/""
  return {
    cards: VAT_CARDS.map((_, i) => ({ on: v[i] !== "X", v: v[i] === "X" ? "" : v[i], by: v[i] && v[i] !== "X" ? "ตัวอย่าง · 7 ต.ค." : "" })),
    status: { s: v[9], by: v[9] === "O" ? "ตัวอย่าง · 7 ต.ค." : "", claimed: v[9] === "O" },
  };
}

const REQ_GROUPS = ["Incomplete", "Input Summary", "Input Reconcile"];
const REQ_KEYS = ["All", "A", "N", "T", "F", "M"];
function makeReq(bu) {
  const row = (o) => REQ_KEYS.reduce((r, k) => ({ ...r, [k]: o[k] === undefined ? "" : o[k] }), {});
  if (bu === "CFM") return { "Incomplete": row({ All: "117536331", M: "X" }), "Input Summary": row({ All: "X", A: "X", F: "X", M: "X" }), "Input Reconcile": row({ All: "117536332", A: "X", N: "X", T: "X", F: "X", M: "X" }) };
  if (bu === "GM") return REQ_GROUPS.reduce((r, g) => ({ ...r, [g]: row({ All: "X", A: "X", N: "X", T: "X", F: "X", M: "X" }) }), {});
  return REQ_GROUPS.reduce((r, g) => ({ ...r, [g]: row({}) }), {});
}

const RPT_CODES = ["N", "T", "A", "F", "M"];
const RPT_SIDES = [["first", "FIRST DRAFT", "#FBF1DE", "#854F0B"], ["final", "FINAL DRAFT", "#E4F3EF", "#0F6E56"]];
const RPT_REPORTS = [["inc", "Incomplete"], ["inp", "Input"]];
function makeRpt(bu, allOn) {
  const mk = (o) => RPT_CODES.reduce((r, c) => ({ ...r, [c]: { inc: o[c] || "P", inp: o[c] || "P" } }), {});
  if (bu === "GM") { const x = mk({ N: "X", T: "X", A: "X", F: "X", M: "X" }); return { first: x, final: JSON.parse(JSON.stringify(x)) }; }
  const x = allOn ? { N: "P", T: "P", A: "P", F: "P", M: "P" } : { N: "P", T: "P", A: "X", F: "X", M: "X" };
  return { first: mk(x), final: mk(x) };
}

// BU จริงจาก Company List -- ความคืบหน้ายังไม่มีที่เก็บ จึงเริ่มต้นเป็น N ทุกขั้น (ยังไม่ทำ)
// BU จริงที่ยังไม่เคย Setting: Enable ทุกรายการ (Step 1 / 46119 ทุก Platform / Request ID ทุก Tax Code / Report ทุก Tax Code)
function allEnabledTasks() {
  const t = makeTasks(["N", "N", "N", "N", "N", "N", "N", "N", "N", "N"]);
  Object.keys(t).forEach((k) => { t[k].items.forEach((it) => { it.off = false; }); });
  return t;
}
// Active/Inactive อ้างอิงสถานะจาก VAT Config (company_list) -- ตรรกะต่างจากหน้า VAT Watchlist: ไม่มีกฎ "ไม่ Update Incomplete เกิน 2 เดือน = Inactive"
// เพราะ BU ที่ไม่มี Incomplete ค้างก็ยังต้องปิดภาษี  (Manual inactive/unclaim/out_of_scope ชนะก่อน > VAT%=0 -> unclaim > active)
const VAT_STATUS_LABEL = { inactive: "Inactive", unclaim: "Unclaim", out_of_scope: "Out of Scope" };
function vatStatusOf(c) {
  const raw = String(c.vat_watchlist_status || "").trim().toLowerCase().replace(/\s+/g, "_");
  if (raw === "inactive" || raw === "unclaim" || raw === "out_of_scope") return raw;
  const vatPct = parseFloat(c["VAT %"]);
  if (!isNaN(vatPct) && vatPct === 0) return "unclaim";
  return "active";
}
// หาค่าคอลัมน์จาก company_list แบบไม่สนตัวพิมพ์/ช่องว่าง (กันชื่อคอลัมน์เพี้ยนเล็กน้อย)
const colOf = (c, name) => {
  const t = (x) => String(x).replace(/[^0-9a-zA-Z\u0E00-\u0E7F]+/g, "").toLowerCase() || String(x).replace(/\s+/g, "").toLowerCase();
  const k = Object.keys(c || {}).find((x) => t(x) === t(name));
  return k === undefined ? undefined : c[k];
};
function mkRealBu(c) {
  const bu = String(c.bu);
  return { code: String(c["COMPANY CODE"] || ""), bu, name: String(c["THAI COMPANY NAME"] || ""), inScope: vatStatusOf(c) === "active", why: VAT_STATUS_LABEL[vatStatusOf(c)] || "", tasks: allEnabledTasks(), ids: ["", "", "", "", "", ""], vat: makeVat(["", "", "", "", "", "", "", "", "", ""]), req: makeReq(""), rpt: makeRpt("", true), buClosed: false, prep: String(c["PREPARE BY"] || "").trim(), vatRate: (() => { const v = parseFloat(String(colOf(c, "VAT %") ?? "").replace("%", "")); return Number.isFinite(v) ? v : null; })(), nameEn: String(colOf(c, "ENGLISH COMPANY NAME") || "").trim() };
}
// ดึง BU ของฉัน = Prepare By ตรงชื่อที่ผูกกับบัญชี + BU ที่ติ๊ก "ดู Progress" (timeline_watch)
async function fetchMyBus(me, all = false, include = []) {
  const [u, c, wa] = await Promise.all([db.from("user_roles").select("*"), db.from("company_list").select("*"), db.from("timeline_watch").select("*")]);
  if (u.error || c.error) return { error: String(u.error || c.error), rows: [], bound: "", mine: [], users: [] };
  const users = Array.isArray(u.data) ? u.data : [];
  const watchRows = Array.isArray(wa.data) ? wa.data : [];
  const mine = users.find((x) => (x.username || "").toLowerCase() === String(me || "").toLowerCase());
  const bound = mine && mine.vat_prepare_name ? String(mine.vat_prepare_name).trim() : "";
  const watchOf = (uname) => { const r = watchRows.find((x) => (x.username || "").toLowerCase() === String(uname || "").toLowerCase()); return r && Array.isArray(r.bus) ? r.bus : []; };
  const every = (Array.isArray(c.data) ? c.data : []).filter((x) => x.bu);
  const busOfUser = (usr) => {
    const nm = usr && usr.vat_prepare_name ? String(usr.vat_prepare_name).trim().toLowerCase() : "";
    const w = watchOf(usr && usr.username);
    return every.filter((x) => (nm && String(x["PREPARE BY"] || "").trim().toLowerCase() === nm) || w.includes(x.bu)).map((x) => x.bu);
  };
  const mineRows = every.filter((x) => (bound && String(x["PREPARE BY"] || "").trim().toLowerCase() === bound.toLowerCase()) || watchOf(mine && mine.username).includes(x.bu));
  const byBu = (a, b) => String(a.bu).localeCompare(String(b.bu));
  // ตัวเลือก User สำหรับ Popup "เลือก User" (ไม่รวมตัวเอง) พร้อมจำนวน BU ที่เกี่ยวข้อง
  const opts = users.filter((x) => x.username && !(mine && x.username === mine.username)).map((x) => ({ username: x.username, name: String(x.vat_prepare_name || "").trim(), n: busOfUser(x).length })).sort((a, b) => a.username.localeCompare(b.username));
  // Tab "All User Related Status" = BU ของฉัน + BU ของ User ที่เลือก Include ไว้เท่านั้น
  const set = new Set(mineRows.map((x) => x.bu));
  if (all) include.forEach((un) => { const usr = users.find((x) => x.username === un); if (usr) busOfUser(usr).forEach((b) => set.add(b)); });
  const rows = every.filter((x) => set.has(x.bu)).sort(byBu);
  return { error: "", rows, bound, mine: mineRows.map((x) => x.bu), users: opts };
}

const TH_MONTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
function stampNow() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getDate()} ${TH_MONTH[d.getMonth()]} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function statusOf(t) {
  if (t.mode === "X") return "X";
  if (t.mode === "D") return "D";
  if (t.nodata) return "Y"; // ไม่มีข้อมูล = ทำแล้ว (ตาม Macro: No Data นับเท่า Finished)
  const act = t.items.filter((x) => !x.off);
  if (!act.length) return "X"; // ทุกรายการ Disable = ไม่เกี่ยวข้อง
  return act.every((x) => x.done) ? "Y" : "N";
}
const clone = (x) => JSON.parse(JSON.stringify(x));
const resetValues = (x) => {
  Object.keys(x.tasks).forEach((k) => { const t = x.tasks[k]; t.rid = ""; t.nodata = false; t.items.forEach((it) => { it.done = false; it.by = ""; }); });
  x.vat.cards.forEach((c) => { c.v = ""; c.by = ""; });
  x.vat.status.s = ""; x.vat.status.by = ""; x.vat.status.claimed = false;
  Object.keys(x.req).forEach((g) => { Object.keys(x.req[g]).forEach((k) => { if (x.req[g][k] !== "X") x.req[g][k] = ""; }); });
  ["first", "final"].forEach((sd) => { RPT_CODES.forEach((c) => { RPT_REPORTS.forEach(([rk]) => { if (x.rpt[sd][c][rk] === "D") x.rpt[sd][c][rk] = "P"; }); }); });
  x.buClosed = false;
};
const PERIOD_YM = "2026-09"; // TODO: ดึงรอบ VAT Period จริงจาก Backend
// ส่วนที่เก็บลง DB ต่อ BU (ไม่รวมข้อมูลบริษัทที่ดึงจาก company_list)
const pickProg = (b) => ({ tasks: b.tasks, vat: b.vat, req: b.req, rpt: b.rpt, ids: b.ids, buClosed: b.buClosed, defaults: b.defaults });
// รวมค่าที่บันทึกไว้กับโครงสร้างปัจจุบัน (เติมเฉพาะ key ที่มีอยู่จริง กันโครงสร้างเปลี่ยนแล้วพัง)
const mergeProg = (b, st) => {
  const out = { ...b };
  if (st.tasks) { out.tasks = { ...b.tasks }; Object.keys(b.tasks).forEach((k) => { if (st.tasks[k] && Array.isArray(st.tasks[k].items) && st.tasks[k].items.length === b.tasks[k].items.length) out.tasks[k] = { ...b.tasks[k], ...st.tasks[k] }; }); }
  ["vat", "req", "rpt", "ids"].forEach((k) => { if (st[k] && typeof st[k] === "object") out[k] = st[k]; });
  if (st.defaults && typeof st.defaults === "object") out.defaults = st.defaults;
  if (typeof st.buClosed === "boolean") out.buClosed = st.buClosed;
  return out;
};

function Chip({ v }) {
  return (
    <span style={{ display: "inline-block", minWidth: 28, padding: "3px 0", borderRadius: 4, fontWeight: 500, fontSize: 12, background: C[v].bg, color: C[v].fg, textAlign: "center" }}>
      {ST_LABEL[v]}
    </span>
  );
}
function Pill({ bg, fg, children, style }) {
  return <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 8, background: bg, color: fg, ...style }}>{children}</span>;
}
const btn = { padding: "4px 12px", fontSize: 12, border: "0.5px solid #ccc", borderRadius: 6, background: "#fff", cursor: "pointer" };

function PeriodBanner({ closed }) {
  if (closed) {
    return (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 12px", borderRadius: 8, background: C.N.bg, color: C.N.fg, marginBottom: 12, fontSize: 13 }}>
        <span>Period ปิดแล้ว (30 ก.ย. 2569) · ข้อมูลจะถูกล้างในอีก <b>12 วัน</b> เหลือเฉพาะสรุป</span>
        <span style={{ display: "flex", gap: 6 }}>
          <button type="button" style={btn}>Export Excel</button>
          <button type="button" style={btn}>Reopen (เหลือ 4 วัน)</button>
        </span>
      </div>
    );
  }
  return (
    <div style={{ marginBottom: 12 }}>
      <Pill bg={C.Y.bg} fg={C.Y.fg} style={{ fontSize: 12 }}>Period เปิดอยู่ · ครบกำหนด 6 ต.ค.</Pill>
    </div>
  );
}

const KPI_ICON = {
  progress: { bg: "#E8EEF5", fg: "#1F3A5F", d: <><path d="M21 12a9 9 0 1 1-9-9" /><path d="M12 3a9 9 0 0 1 9 9h-9z" /></> },
  bu: { bg: "#EAF3DE", fg: "#3B6D11", d: <><path d="M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16" /><path d="M14 10h5a1 1 0 0 1 1 1v10" /><path d="M2 21h20" /><path d="M8 8h2M8 12h2M8 16h2" /></> },
  off: { bg: "#EEEDE6", fg: "#7b8794", d: <><path d="M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16" /><path d="M14 10h5a1 1 0 0 1 1 1v10" /><path d="M2 21h20" /><path d="M3 3l18 18" /></> },
  done: { bg: "#EAF3DE", fg: "#3B6D11", d: <><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.8 2.8L16 9.5" /></> },
  period: { bg: "#EAF3DE", fg: "#3B6D11", d: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /><path d="m9 15.5 2 2 4-4" /></> },
};
function Kpi({ label, value, color, icon, small }) {
  const ic = KPI_ICON[icon];
  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: 12, display: "flex", alignItems: "center", gap: 12 }}>
      {ic && (
        <span style={{ width: 40, height: 40, borderRadius: 10, background: ic.bg, color: ic.fg, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ic.d}</svg>
        </span>
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, color: "#666" }}>{label}</div>
        <div style={{ fontSize: small ? 16 : 22, fontWeight: 500, color: color || "#222", lineHeight: small ? "30px" : undefined }}>{value}</div>
      </div>
    </div>
  );
}

// กติกานับ % (ชั่วคราวในโค้ด -> ย้ายไปตารางกติกา `count_in_pct` ใน DB ภายหลัง)
// นับ: Step 1 ทุกรายการ (PP36, CPN, AP01-5, Pop M, Deposit Clearing, 46119) · Step 2 เฉพาะ Transfer Vat Status · Final Step เฉพาะ Final Draft
// ไม่นับ: Daily Average/Suspense, Trial Balance, Simple, Input Summary, Incomplete, Input Reconcile, First Draft
const COUNT_RULES = { step1: ["PP36", "CPN", "AP01-5", "Pop M", "Deposit Clearing", "46119"] };

// หน่วยนับ = รายการ (Checklist แต่ละขั้น / Platform ของ 46119 / ช่อง Report) ที่ "นับ และ Enable อยู่" ตัวหาร = จำนวนหน่วยทั้งหมดนั้น (ของที่ Disable ถูกตัดออก)
// ขั้นที่ทำเสร็จแล้วได้เครดิตตามจำนวนขั้น เช่น เสร็จ 2 ใน 3 ขั้น = 2 หน่วย; ตัวหาร 0 = null (ไม่มีรายการให้คำนวณ ไม่ใช่ 0% หรือ 100%)
function buProgress(u) {
  const t1 = { d: 0, n: 0 };
  COUNT_RULES.step1.forEach((k) => {
    const t = u.tasks[k];
    if (!t || t.mode !== "auto") return;
    t.items.forEach((it) => { if (it.off) return; t1.n += 1; if (it.done || t.nodata) t1.d += 1; });
  });
  // โอน = ทำแล้ว · ไม่โอน = ทำแล้ว (ตัดสินใจแล้ว) แต่ถ้าเคยกด "โอน" ไว้ก่อน แล้วมากด "ไม่โอน" ต้องลดค่าที่โอน Claim ไป (ไม่นับ)
  const t2 = { d: u.vat.status.s === "O" ? 1 : u.vat.status.s === "X" && !u.vat.status.claimed ? 1 : 0, n: 1 };
  const cells = RPT_CODES.flatMap((c) => RPT_REPORTS.map(([rk]) => u.rpt.final[c][rk])).filter((v) => v !== "X");
  const t3 = { d: cells.filter((v) => v === "D").length, n: cells.length };
  const one = (x) => (x.n ? Math.round((x.d * 1000) / x.n) / 10 : null);
  const tot = { d: t1.d + t2.d + t3.d, n: t1.n + t2.n + t3.n };
  const all = tot.n ? (tot.d === tot.n ? 100 : Math.min(99, Math.round((tot.d * 100) / tot.n))) : null;
  return { s1: one(t1), s2: one(t2), s3: one(t3), all, t1, t2, t3 };
}

const LOBBY_S1 = ["PP36", "AP01-5", "Pop M", "CPN", "46119"];
const LOBBY_TC = ["A", "N", "T", "F"];
// ช่อง Report ต่อ Tax Code: ครบทั้ง First และ Final Draft = Y, Disable ทั้งคู่ = X, นอกนั้น = N
function rptCell(u, c, rk) {
  const a = u.rpt.first[c][rk];
  const b = u.rpt.final[c][rk];
  return a === "X" && b === "X" ? "X" : a === "D" && b === "D" ? "Y" : "N";
}

function Lobby({ bus, tab, closed, filter, onView, onToggleScope }) {
  const shown = bus.map((u, i) => ({ u, i })).filter(({ u }) => tab === "all" || u.mine);
  const inScope = shown.filter(({ u }) => u.inScope);
  const prog = bus.map(buProgress);
  const allList = shown.map(({ u, i }) => (u.inScope ? prog[i].all : null)).filter((v) => v !== null);
  const all = allList.length ? Math.round(allList.reduce((a, v) => a + v, 0) / allList.length) : null;
  // หัวตารางตรึงบน (GAP 0): ตารางอยู่ใน Scroller ของตัวเอง (ความสูงพอดีหน้าจอ ซ่อน Scrollbar) จึงตรึงได้แน่นอนไม่ขึ้นกับกล่องภายนอก; แถวที่ 2 ต่อจากแถวแรกสูง 34
  const TOP = 5; // = border-spacing บนสุดของตาราง ทำให้หัวตรึงตรงตำแหน่งเดิมพอดี ไม่กระโดดตอนเริ่มเลื่อน
  const HGAP = 5; // = border-spacing ระหว่างแถวหัวกลุ่มกับแถวหัว Column
  const GH = 34;
  const th = { padding: "6px 2px", textAlign: "center", fontSize: 12, fontWeight: 500, color: "#616e7c", background: "#F4F3EF", position: "sticky", top: TOP + GH + HGAP, zIndex: 5, boxSizing: "border-box", boxShadow: "0 6px 0 #F4F3EF" };
  const gh = () => ({ ...th, top: TOP, height: GH, padding: 0, fontSize: 13, fontWeight: 700, color: C.navy, background: "#EEF2F7", borderBottom: `2px solid ${C.navy}`, borderRadius: "10px 10px 0 0", boxShadow: `0 -6px 0 #F4F3EF, 0 5px 0 #F4F3EF` });
  const TINT = { p: "#E3E8EF", i: "#EAF0F9", c: "#EAF1E8" };
  const td = { padding: "7px 2px", textAlign: "center", fontSize: 13, verticalAlign: "middle", background: "#fff" };
  const tdp = { ...td, background: TINT.p };
  const tdi = { ...td, background: TINT.i };
  const tdc = { ...td, background: TINT.c };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: "1 1 0%", minHeight: 0 }}>
      <style>{".tl-hide-scroll{scrollbar-width:none;-ms-overflow-style:none}.tl-hide-scroll::-webkit-scrollbar{display:none}"}</style>
      {closed && <div style={{ flexShrink: 0 }}><PeriodBanner closed={closed} /></div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginBottom: 12, flexShrink: 0 }}>
        <Kpi icon="progress" label="ภาพรวมที่ทำแล้ว" value={all === null ? "—" : `${all}%`} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, minWidth: 0 }}>
          <Kpi icon="bu" label="BU Active" value={inScope.length} />
          <Kpi icon="off" label="BU Inactive" value={shown.length - inScope.length} color="#616e7c" />
        </div>
        <Kpi icon="done" label="เสร็จ 100%" value={shown.filter(({ u, i }) => u.inScope && prog[i].all === 100).length} />
        <Kpi icon="period" label="Period" value={closed ? "ปิดแล้ว (30 ก.ย. 2569)" : "เปิดอยู่ · ครบกำหนด 6 ต.ค."} color={closed ? "#791F1F" : "#27500A"} small />
      </div>
      <div className="tl-hide-scroll" style={{ flex: "1 1 0%", minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", background: "#F4F3EF" }}>
      <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 5px", tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: 128 }} />
          <col style={{ width: 130 }} />
          {[...LOBBY_S1, "Daily", ...LOBBY_TC, ...LOBBY_TC].map((c, n) => <col key={n} style={{ width: n === 5 ? 62 : 48 }} />)}
          <col />
          <col style={{ width: 90 }} />
          <col style={{ width: 70 }} />
        </colgroup>
        <thead>
          <tr>
            <th style={{ ...th, top: TOP, height: GH, boxShadow: "0 -6px 0 #F4F3EF, 0 5px 0 #F4F3EF" }} colSpan={2} />
            <th style={gh()} colSpan={LOBBY_S1.length + 1}>Prepare to Transfer</th>
            <th style={gh()} colSpan={LOBBY_TC.length}>Input</th>
            <th style={gh()} colSpan={LOBBY_TC.length}>Incomplete</th>
            <th style={{ ...th, top: TOP, height: GH, boxShadow: "0 -6px 0 #F4F3EF, 0 5px 0 #F4F3EF" }} colSpan={3} />
          </tr>
          <tr>
            <th style={th}>Status</th>
            <th style={{ ...th, textAlign: "left" }}>BU</th>
            {LOBBY_S1.map((c) => <th key={c} style={{ ...th, background: TINT.p, whiteSpace: "nowrap" }}>{c}</th>)}
            <th style={{ ...th, background: TINT.p }}>Daily Vat</th>
            {LOBBY_TC.map((c) => <th key={"i" + c} style={{ ...th, background: TINT.i }}>{c}</th>)}
            {LOBBY_TC.map((c) => <th key={"c" + c} style={{ ...th, background: TINT.c }}>{c}</th>)}
            <th style={th}>Process</th>
            <th style={th}>Status</th>
            <th style={th} />
          </tr>
        </thead>
        <tbody>
          {/* เรียง: ยังไม่ Confirm (Pending) ขึ้นบน -> Confirm แล้ว -> ไม่ปิดเดือนนี้ (ลำดับเดิมในกลุ่มเดียวกัน) */}
          {shown.filter(({ u }) => filter === "pending" ? u.inScope && !u.buClosed : filter === "confirm" ? u.buClosed : true).sort((x, y) => (x.u.inScope ? (x.u.buClosed ? 1 : 0) : 2) - (y.u.inScope ? (y.u.buClosed ? 1 : 0) : 2) || x.i - y.i).map(({ u, i }) => {
            const pr = prog[i];
            const p = pr.all;
            return (
              <tr key={u.code} style={{ opacity: u.inScope ? 1 : 0.55 }}>
                <td style={{ ...td, borderRadius: "12px 0 0 12px" }}>
                  <button type="button" disabled={closed} title={u.inScope ? "กดเพื่อเปลี่ยนเป็น Inactive" : "กดเพื่อเปลี่ยนเป็น Active"} onClick={() => onToggleScope(i)} style={{ width: 78, height: 28, borderRadius: 999, border: "none", fontSize: 12, fontWeight: 500, cursor: closed ? "default" : "pointer", background: u.inScope ? "#3B6D11" : "#A32D2D", color: "#fff" }}>{u.inScope ? "Active" : "Inactive"}</button>
                </td>
                <td style={{ ...td, textAlign: "left" }}>
                  <span style={{ fontWeight: 500, fontSize: 14, color: C.navy }}>{u.bu}</span>
                  <div style={{ fontSize: 11, color: "#aaa" }}>{u.inScope ? u.code : u.why}</div>
                </td>
                {LOBBY_S1.map((k) => <td key={k} style={tdp}><Chip v={statusOf(u.tasks[k])} /></td>)}
                <td style={tdp}><Chip v={statusOf(u.tasks.Dailyvat)} /></td>
                {LOBBY_TC.map((c) => <td key={"i" + c} style={tdi}><Chip v={rptCell(u, c, "inp")} /></td>)}
                {LOBBY_TC.map((c) => <td key={"c" + c} style={tdc}><Chip v={rptCell(u, c, "inc")} /></td>)}
                {u.inScope ? (
                  <>
                    <td style={td}>
                      <b style={{ fontWeight: 500, color: C.navy }}>{p === null ? "—" : `${p}%`}</b>
                    </td>
                    <td style={td}>
                      <span style={{ display: "inline-block", minWidth: 64, padding: "3px 8px", borderRadius: 999, fontWeight: 500, fontSize: 12, background: u.buClosed ? C.Y.bg : C.N.bg, color: u.buClosed ? C.Y.fg : C.N.fg }}>{u.buClosed ? "Confirm" : "Pending"}</span>
                    </td>
                    <td style={{ ...td, borderRadius: "0 12px 12px 0" }}><button type="button" style={{ ...btn, borderRadius: 8 }} onClick={() => onView(i)}>{closed ? "ดู" : "View"}</button></td>
                  </>
                ) : (
                  <>
                    <td style={{ ...td, fontSize: 12, color: "#aaa" }} colSpan={2}>Inactive</td>
                    <td style={{ ...td, borderRadius: "0 12px 12px 0" }} />
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      <p style={{ fontSize: 12, color: "#666", margin: "10px 0 0", flexShrink: 0 }}>
        เขียว Y = ทำแล้ว · เหลือง N = ยังไม่ทำ · แดง X = ไม่เกี่ยวข้อง · เทา - = ไม่มี · Process = รายการที่นับและ Enable ทำเสร็จ ÷ รายการที่นับและ Enable ทั้งหมด (คิดรวมก้อนเดียว ไม่แบ่ง Step) · Pending = ยังไม่กด Confirm Closed · ติ๊ก/เอาออก BU ได้เฉพาะ Owner หรือ Admin ที่มีสิทธิ์ VAT
      </p>
    </div>
  );
}

function EnableToggle({ on, disabled, onChange, full, labels, compact }) {
  const seg = (active, label, val, radius) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(val)}
      style={{ flex: full ? 1 : "none", height: 26, padding: compact ? "0 8px" : "0 12px", fontSize: 11, border: "none", borderRadius: radius, cursor: disabled ? "default" : "pointer", background: active ? (val ? "#3B6D11" : "#A32D2D") : "transparent", color: active ? "#fff" : "#8a8a85", fontWeight: active ? 600 : 400, transition: "all .15s" }}
    >
      {label}
    </button>
  );
  return (
    <span style={{ display: full ? "flex" : "inline-flex", padding: 2, borderRadius: 999, background: "#EEEDE6" }}>
      {seg(on, (labels || ["Enable", "Disable"])[0], true, 999)}
      {seg(!on, (labels || ["Enable", "Disable"])[1], false, 999)}
    </span>
  );
}

const ZONE_CHIP = {
  done: { t: "เสร็จแล้ว", bg: "#EAF3DE", fg: "#27500A" },
  doing: { t: "กำลังทำ", bg: "#FAEEDA", fg: "#633806" },
  todo: { t: "ยังไม่เริ่ม", bg: "#EEEDE6", fg: "#616e7c" },
  na: { t: "ไม่ใช้ในรอบนี้", bg: "#FCEBEB", fg: "#791F1F" },
};
function ZoneHeader({ badge, title, state, children }) {
  const ch = ZONE_CHIP[state];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", borderBottom: "2px solid " + C.navy, background: "#EEF2F7" }}>
      <span style={{ width: 28, height: 28, borderRadius: "50%", background: C.navy, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600, flexShrink: 0 }}>{badge}</span>
      <b style={{ fontSize: 16, fontWeight: 600, color: C.navy }}>{title}</b>
      <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
        {children}
        <span style={{ fontSize: 12, padding: "3px 12px", borderRadius: 999, background: ch.bg, color: ch.fg, fontWeight: 600 }}>{ch.t}</span>
      </span>
    </div>
  );
}

function BuPage({ u, closed, onBack, onTick, onTickAll, onStage, onNoData, onStepClear, onMode, onItemEnable, onVatEnable, onVatId, onVatCommit, onVatStatus, onReqId, onReqToggle, onRptSet, onBuClose, onReset, onDefaultsSet, userName, prepBy }) {
  // หน้า BU ทำทีละ Zone: ตอนนี้มีเฉพาะ Zone "เตรียมข้อมูล" (ซ้าย PP36/CPN/AP01-5/Pop M/Deposit Clearing, ขวา 46119)
  const LEFT = ["PP36", "CPN", "AP01-5", "Pop M", "Deposit Clearing"];
  const pg = buProgress(u);

  const stateOf = (en, done) => (en === 0 ? "na" : done === en ? "done" : done > 0 ? "doing" : "todo");
  const z1State = stateOf(pg.t1.n, pg.t1.d);
  const z2State = stateOf(pg.t2.n, pg.t2.d);
  const z3State = stateOf(pg.t3.n, pg.t3.d);
  const buReady = [z1State, z2State, z3State].every((x) => x === "done" || x === "na");
  const overallPct = pg.all;
  const ink = "#1f2933";
  const initials = (prepBy || "").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  const [files, setFiles] = React.useState({});
  // Reset ต้องยืนยันด้วยรหัส 6 หลัก (สุ่มโชว์ + พิมพ์ยืนยัน) รูปแบบเดียวกับ Setup Rule ใน IEController
  const [rstCode, setRstCode] = React.useState("");
  const [rstInput, setRstInput] = React.useState("");
  const [rstErr, setRstErr] = React.useState(false);
  const askReset = () => { setRstInput(""); setRstErr(false); setRstCode(String(Math.floor(100000 + Math.random() * 900000))); };
  const closeReset = () => { setRstCode(""); setRstInput(""); setRstErr(false); };
  const confirmReset = () => {
    if (rstInput.trim() !== rstCode) { setRstErr(true); return; }
    closeReset();
    onReset();
  };
  const hdrRef = React.useRef(null);
  const [stickyTop, setStickyTop] = React.useState(0);
  React.useLayoutEffect(() => {
    // ตรึง Header ชิดขอบบน (GAP 0) โดยหักระยะ padding-top ของ container ที่เลื่อน และซ่อน Scrollbar (ยังเลื่อนได้ด้วยล้อเมาส์/ทัชแพด)
    let el = hdrRef.current ? hdrRef.current.parentElement : null;
    while (el) {
      const cs = window.getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY)) break;
      el = el.parentElement;
    }
    if (!el) { setStickyTop(0); return undefined; }
    setStickyTop(-(parseFloat(window.getComputedStyle(el).paddingTop) || 0));
    const st = document.createElement("style");
    st.textContent = ".tl-hide-scroll{scrollbar-width:none;-ms-overflow-style:none}.tl-hide-scroll::-webkit-scrollbar{display:none}";
    document.head.appendChild(st);
    el.classList.add("tl-hide-scroll");
    const oldBg = el.style.background;
    el.style.background = "#F4F3EF";
    return () => { el.style.background = oldBg; el.classList.remove("tl-hide-scroll"); if (st.parentNode) st.parentNode.removeChild(st); };
  }, []);
  const renderVatCard = (i) => {
            const c = u.vat.cards[i];
            const filled = c.on && c.v !== "";
            const cl = !c.on ? "X" : filled ? "Y" : "N";
            const acc = cl === "Y" ? "#3B6D11" : cl === "X" ? "#C9C8C0" : "#E0A030";
    return (
              <div key={VAT_CARDS[i].name} style={{ border: "1px solid #E3E5EA", borderRadius: 12, overflow: "hidden", background: "#fff", opacity: c.on ? 1 : 0.65 }}>
                <div style={{ height: 4, background: acc }} />
                <div style={{ padding: "12px 12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Chip v={cl} />
                    <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.4, color: "#7b8794" }}>{VAT_CARDS[i].g}</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: ink, minHeight: 36 }}>{VAT_CARDS[i].name}</div>
                  <EnableToggle full on={c.on} disabled={closed} onChange={(v) => onVatEnable(i, v)} />
                  {c.on ? (
                    <>
                      <input
                        value={c.v}
                        inputMode="numeric"
                        placeholder="Request ID"
                        disabled={closed}
                        onChange={(e) => onVatId(i, e.target.value)}
                        onBlur={() => onVatCommit(i)}
                        style={{ width: "100%", boxSizing: "border-box", height: 38, fontSize: 14, textAlign: "center", borderRadius: 9, padding: "0 6px", border: filled ? "1px solid #CFE5B0" : "1px solid #ccc", background: filled ? "#EEF6E4" : "#fff", color: filled ? "#27500A" : "#222", fontWeight: filled ? 600 : 400 }}
                      />
                      <div style={{ fontSize: 11, color: "#7b8794", textAlign: "center" }}>{filled && c.by ? c.by : "ยังไม่ได้กรอก"}</div>
                      {i >= 4 && (
                        <label style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 34, borderRadius: 9, border: files[i] ? "1px solid #CFE5B0" : "1px dashed #1a3a5c", background: files[i] ? "#EEF6E4" : "#F7F9FC", color: files[i] ? "#27500A" : "#1a3a5c", fontSize: 12, fontWeight: 600, cursor: closed ? "default" : "pointer", overflow: "hidden", padding: "0 8px", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                          <input type="file" disabled={closed} style={{ display: "none" }} onChange={(e) => { const f = e.target.files && e.target.files[0]; setFiles((p) => ({ ...p, [i]: f ? { name: f.name, at: stampNow(), by: userName || "คุณ" } : null })); }} />
                          {files[i] ? files[i].name : "Upload File"}
                        </label>
                      )}
                      {i >= 4 && (
                        <div style={{ fontSize: 11, color: "#7b8794", textAlign: "center" }}>{files[i] ? `อัปโหลด ${files[i].at} · ${files[i].by}` : "ยังไม่ได้อัปโหลด"}</div>
                      )}
                    </>
                  ) : (
                    <div style={{ height: 38, borderRadius: 9, border: "1px dashed #C9C8C0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#7b8794" }}>ไม่ใช้ในรอบนี้</div>
                  )}
                </div>
              </div>
            );
  };

  const renderReqCard = (g, title, cols) => {
    const cells = u.req[g];
    const en = REQ_KEYS.filter((k) => cells[k] !== "X");
    const done = en.filter((k) => cells[k] !== "");
    const cl = en.length === 0 ? "X" : done.length === en.length ? "Y" : "N";
    const acc = cl === "Y" ? "#3B6D11" : cl === "X" ? "#C9C8C0" : "#E0A030";
    const fk = "R" + g;
    return (
      <div style={{ border: "1px solid #E3E5EA", borderRadius: 12, overflow: "hidden", background: "#fff", opacity: en.length ? 1 : 0.7, gridColumn: cols === 6 ? "span 2" : undefined }}>
        <div style={{ height: 4, background: acc }} />
        <div style={{ padding: "12px 14px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Chip v={cl} />
            <span style={{ fontSize: 15, fontWeight: 600, color: ink }}>{title || g}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 8 }}>
            {REQ_KEYS.map((k) => {
              const v = cells[k];
              const off = v === "X";
              const filled = !off && v !== "";
              return (
                <div key={k}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#616e7c" }}>{k}</span>
                    {!off && !closed && <button type="button" title="Disable" onClick={() => onReqToggle(g, k, false)} style={{ border: "none", background: "transparent", color: "#8a8a85", cursor: "pointer", fontSize: 12, padding: 0, lineHeight: 1 }}>✕</button>}
                  </div>
                  {off ? (
                    <button type="button" disabled={closed} title="คลิกเพื่อ Enable" onClick={() => onReqToggle(g, k, true)} style={{ width: "100%", height: 38, borderRadius: 9, border: "1px solid #F5C4C4", background: "#FCEBEB", color: "#791F1F", fontWeight: 600, fontSize: 13, cursor: closed ? "default" : "pointer" }}>X</button>
                  ) : (
                    <input
                      value={v}
                      inputMode="numeric"
                      placeholder="Request ID"
                      disabled={closed}
                      onChange={(e) => onReqId(g, k, e.target.value)}
                      style={{ width: "100%", boxSizing: "border-box", height: 38, fontSize: 13, textAlign: "center", borderRadius: 9, padding: "0 4px", border: filled ? "1px solid #CFE5B0" : "1px solid #ccc", background: filled ? "#EEF6E4" : "#fff", color: filled ? "#27500A" : "#222", fontWeight: filled ? 600 : 400 }}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <label style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 36, borderRadius: 9, border: files[fk] ? "1px solid #CFE5B0" : "1px dashed #1a3a5c", background: files[fk] ? "#EEF6E4" : "#F7F9FC", color: files[fk] ? "#27500A" : "#1a3a5c", fontSize: 13, fontWeight: 600, cursor: closed ? "default" : "pointer", overflow: "hidden", padding: "0 8px", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
            <input type="file" disabled={closed} style={{ display: "none" }} onChange={(e) => { const f = e.target.files && e.target.files[0]; setFiles((p) => ({ ...p, [fk]: f ? { name: f.name, at: stampNow(), by: userName || "คุณ" } : null })); }} />
            {files[fk] ? files[fk].name : "Upload File"}
          </label>
          <div style={{ fontSize: 11, color: "#7b8794", textAlign: "center" }}>{files[fk] ? `อัปโหลด ${files[fk].at} · ${files[fk].by}` : "ยังไม่ได้อัปโหลด"}</div>
        </div>
      </div>
    );
  };

  const renderRptSide = (side, title, bg, fg) => (
    <div key={side} style={{ background: bg }}>
      <div style={{ padding: "14px 16px 0", fontSize: 12, fontWeight: 600, letterSpacing: 0.4, color: fg }}>{title}</div>
      <div style={{ display: "grid", gridTemplateColumns: "100px repeat(2, minmax(0, 1fr))", gap: 8, padding: "10px 16px 16px", alignItems: "center" }}>
        <span />
        {RPT_REPORTS.map(([rk, rl]) => <span key={rk} style={{ fontSize: 12, fontWeight: 600, color: "#616e7c", textAlign: "center" }}>{rl}</span>)}
        {RPT_CODES.map((c) => (
          <React.Fragment key={c}>
            <span style={{ fontSize: 14, fontWeight: 600, color: ink }}>Tax Code {c}</span>
            {RPT_REPORTS.map(([rk]) => {
              const v = u.rpt[side][c][rk];
              const on = v !== "X";
              const fin = v === "D";
              return (
                <div key={rk} style={{ display: "flex", flexDirection: "column", gap: 5, background: "#fff", border: "1px solid #E3E5EA", borderRadius: 10, padding: 6, opacity: on ? 1 : 0.8 }}>
                  <EnableToggle full on={on} disabled={closed} onChange={(e) => onRptSet(side, c, rk, e ? "P" : "X")} />
                  {on ? (
                    <button type="button" disabled={closed} title="คลิกเพื่อสลับ Pending / Finish" onClick={() => onRptSet(side, c, rk, fin ? "P" : "D")} style={{ height: 34, borderRadius: 8, border: "1px solid " + (fin ? "#C0DD97" : "#FAC775"), background: fin ? "#EAF3DE" : "#FAEEDA", color: fin ? "#27500A" : "#633806", fontSize: 13, fontWeight: 600, cursor: closed ? "default" : "pointer" }}>{fin ? "Finish" : "Pending"}</button>
                  ) : (
                    <div style={{ height: 34, borderRadius: 8, border: "1px dashed #C9C8C0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#7b8794" }}>ไม่ใช้ในรอบนี้</div>
                  )}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );

  const renderSumCard = (k) => {
    const v = u.req["Input Summary"][k];
    const on = v !== "X";
    const filled = on && v !== "";
    const cl = !on ? "X" : filled ? "Y" : "N";
    const acc = cl === "Y" ? "#3B6D11" : cl === "X" ? "#C9C8C0" : "#E0A030";
    return (
      <div key={k} style={{ border: "1px solid #E3E5EA", borderRadius: 12, overflow: "hidden", background: "#fff", opacity: on ? 1 : 0.65 }}>
        <div style={{ height: 4, background: acc }} />
        <div style={{ padding: "12px 12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Chip v={cl} />
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.4, color: "#7b8794" }}>INPUT SUMMARY</span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: ink, minHeight: 36 }}>Input Summary - {k}</div>
          <EnableToggle full on={on} disabled={closed} onChange={(e) => onReqToggle("Input Summary", k, e)} />
          {on ? (
            <input
              value={v}
              inputMode="numeric"
              placeholder="Request ID"
              disabled={closed}
              onChange={(e) => onReqId("Input Summary", k, e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", height: 38, fontSize: 14, textAlign: "center", borderRadius: 9, padding: "0 6px", border: filled ? "1px solid #CFE5B0" : "1px solid #ccc", background: filled ? "#EEF6E4" : "#fff", color: filled ? "#27500A" : "#222", fontWeight: filled ? 600 : 400 }}
            />
          ) : (
            <div style={{ height: 38, borderRadius: 9, border: "1px dashed #C9C8C0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#7b8794" }}>ไม่ใช้ในรอบนี้</div>
          )}
          {on && <div style={{ fontSize: 11, color: "#7b8794", textAlign: "center" }}>{filled ? "บันทึกแล้ว" : "ยังไม่ได้กรอก"}</div>}
          {on && (
            <label style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 34, borderRadius: 9, border: files["S" + k] ? "1px solid #CFE5B0" : "1px dashed #1a3a5c", background: files["S" + k] ? "#EEF6E4" : "#F7F9FC", color: files["S" + k] ? "#27500A" : "#1a3a5c", fontSize: 12, fontWeight: 600, cursor: closed ? "default" : "pointer", overflow: "hidden", padding: "0 8px", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
              <input type="file" disabled={closed} style={{ display: "none" }} onChange={(e) => { const f = e.target.files && e.target.files[0]; setFiles((p) => ({ ...p, ["S" + k]: f ? { name: f.name, at: stampNow(), by: userName || "คุณ" } : null })); }} />
              {files["S" + k] ? files["S" + k].name : "Upload File"}
            </label>
          )}
          {on && <div style={{ fontSize: 11, color: "#7b8794", textAlign: "center" }}>{files["S" + k] ? `อัปโหลด ${files["S" + k].at} · ${files["S" + k].by}` : "ยังไม่ได้อัปโหลด"}</div>}
        </div>
      </div>
    );
  };

  const renderStep = (k) => {
    const t = u.tasks[k];
    const st = statusOf(t);
    const on = t.mode === "auto";
    const od = st === "N" && t.due < DEMO_TODAY;
    const accent = !on ? "#C9C8C0" : st === "Y" ? "#3B6D11" : od ? "#C0392B" : "#E0A030";
    const nextIdx = t.items.findIndex((x) => !x.done);
    return (
      <div key={k} style={{ display: "flex", borderBottom: "1px solid #EEF0F4" }}>
        <div style={{ width: 4, background: accent, flexShrink: 0 }} />
        <div style={{ flex: 1, padding: "14px 20px 16px", opacity: on ? 1 : 0.7 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            <Chip v={st} />
            <span style={{ fontWeight: 600, fontSize: 15, color: ink, flex: 1 }}>{k}</span>
            {!od && (st === "N" || st === "Y") && (
              <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 999, background: od ? "#FCEBEB" : "#F1F2F5", color: od ? "#791F1F" : "#616e7c", fontWeight: od ? 600 : 400 }}>
                {od ? "เลยกำหนด · " : "ครบ "}{t.due} ต.ค.
              </span>
            )}
            {on && !closed && (t.nodata || t.items.some((x) => x.done)) && (
              <button type="button" onClick={() => onStepClear(k)} title="ล้างความคืบหน้าของ Step นี้" style={{ ...btn, height: 26, borderRadius: 999, fontSize: 11, padding: "0 12px" }}>ล้าง</button>
            )}
            <span style={{ opacity: 1 }}><EnableToggle on={on} disabled={closed} onChange={(v) => onMode(k, v ? "auto" : "X")} /></span>
          </div>
          <div style={{ display: "flex", gap: 6, opacity: on ? 1 : 0.5 }}>
            {t.items.map((x, n) => {
              const isNext = on && n === nextIdx;
              return (
                <button
                  key={x.label}
                  type="button"
                  disabled={closed || !!t.nodata}
                  title={x.done ? `${x.label} · ${x.by}` : x.label}
                  onClick={() => onStage(k, n, userName)}
                  style={{
                    flex: 1, height: 38, fontSize: 13, borderRadius: 10, cursor: closed ? "default" : t.nodata ? "not-allowed" : "pointer", opacity: t.nodata ? 0.45 : 1,
                    border: x.done ? "1px solid #3B6D11" : isNext ? "1.5px dashed #97C459" : "1px solid #E3E5EA",
                    background: x.done ? "#3B6D11" : isNext ? "#F4F9EC" : "#FAFAFB",
                    color: x.done ? "#fff" : isNext ? "#3B6D11" : "#7b8794",
                    fontWeight: x.done || isNext ? 600 : 400, transition: "all .15s",
                  }}
                >
                  {x.done ? "✓ " : ""}{x.label}
                </button>
              );
            })}
            <button
              type="button"
              disabled={closed}
              title="BU นี้ไม่มีข้อมูลของรายการนี้ (นับเป็นทำแล้ว) กดซ้ำเพื่อยกเลิก"
              onClick={() => onNoData(k)}
              style={{ flex: "none", width: 110, height: 38, fontSize: 13, borderRadius: 10, cursor: closed ? "default" : "pointer", border: t.nodata ? "1px solid #52606d" : "1px solid #E3E5EA", background: t.nodata ? "#52606d" : "#FAFAFB", color: t.nodata ? "#fff" : "#7b8794", fontWeight: t.nodata ? 600 : 400, transition: "all .15s" }}
            >
              {t.nodata ? "✓ " : ""}ไม่มีข้อมูล
            </button>
          </div>
        </div>
      </div>
    );
  };

  const t46 = u.tasks["46119"];
  const on46 = t46.mode === "auto";
  const act46 = t46.items.filter((x) => !x.off);
  const d46 = act46.filter((x) => x.done).length;
  const p46 = act46.length ? Math.round((d46 * 1000) / act46.length) / 10 : 0;
  const left46 = act46.length - d46;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, flexWrap: "wrap", padding: `${16 - stickyTop}px 20px 16px`, borderRadius: 0, background: "#F4F3EF", border: "none", marginTop: stickyTop, marginBottom: 14, position: "sticky", top: stickyTop, zIndex: 20 }} ref={hdrRef}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
          <button type="button" style={{ ...btn, height: 32, padding: "0 14px", borderRadius: 8 }} onClick={onBack}>← กลับ Lobby</button>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 28, fontWeight: 600, color: C.navy }}>{u.bu}</span>
          </div>
          <span style={{ fontSize: 13, color: ink }}>{u.name}</span>
          {u.nameEn ? <span style={{ fontSize: 12, color: "#616e7c", marginTop: -4 }}>{u.nameEn}</span> : null}
          {closed && !u.buClosed && <Pill bg={C.N.bg} fg={C.N.fg}>Period ปิดแล้ว อ่านอย่างเดียว</Pill>}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 14px 6px 8px", borderRadius: 12, background: "#fff", border: "1px solid #E3E5EA", marginTop: 2 }}>
            <span style={{ width: 28, height: 28, borderRadius: "50%", background: "#E8EEF5", color: C.navy, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>{initials}</span>
            <span style={{ lineHeight: 1.25 }}>
              <span style={{ display: "block", fontSize: 10, color: "#7b8794" }}>Prepare by</span>
              <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: ink }}>{prepBy}</span>
            </span>
          </div>
        </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }} title="Rate ใช้สิทธิ์ (VAT %) ของ BU นี้">
            <div style={{ width: 84, height: 84, borderRadius: "50%", background: `conic-gradient(#1F3A5F ${((typeof u.vatRate === "number") ? Math.max(0, Math.min(100, u.vatRate)) : 0) * 3.6}deg, #D9D6CB 0deg)`, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
              <div style={{ width: 66, height: 66, borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <b style={{ fontSize: 18, fontWeight: 700, color: C.navy }}>{(typeof u.vatRate === "number") ? `${u.vatRate}%` : "-"}</b>
              </div>
            </div>
            <span style={{ fontSize: 11, color: "#616e7c" }}>Rate ใช้สิทธิ์</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 16 }}>
          {/* Reset + Confirm อยู่ด้านซ้ายของวงกลม % — Confirm ใช้เปลี่ยน Status ใน Lobby จาก Pending เป็น Confirm (ไม่เกี่ยวกับ Period) */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 8, width: 120 }}>
            {!closed && (
              <button type="button" title="บันทึก Enable/Disable ปัจจุบันของ BU นี้เป็นค่าเริ่มต้น (เก็บลง DB)" onClick={onDefaultsSet} style={{ ...btn, height: 36, width: "100%", padding: 0, fontSize: 14, fontWeight: 600, borderRadius: 8, boxSizing: "border-box", background: "#F4F9EC", color: "#3B6D11", border: "1px solid #D9E8C3" }}>Defaults Set</button>
            )}
            {!closed && (
              <button type="button" title="ล้างค่าที่กรอก/ติ๊ก/Finish/Confirm ของ BU นี้ (Enable/Disable ไม่ถูกล้าง) ต้องยืนยันด้วยรหัส 6 หลัก" onClick={askReset} style={{ ...btn, height: 36, width: "100%", padding: 0, fontSize: 14, fontWeight: 600, borderRadius: 8, boxSizing: "border-box", background: "#FEF8F0", color: "#B3691B", border: "1px solid #F7E3C8" }}>Reset</button>
            )}
            {u.buClosed ? (
              <span style={{ height: 36, width: "100%", boxSizing: "border-box", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 600, borderRadius: 8, background: "#EAF3DE", color: "#27500A", border: "1px solid #C0DD97" }}>✓ Confirm</span>
            ) : (
              <button type="button" disabled={!buReady} title={buReady ? "ยืนยัน BU นี้" : "ต้องครบ 100% ก่อน"} onClick={onBuClose} style={{ border: "none", borderRadius: 8, height: 36, width: "100%", padding: 0, boxSizing: "border-box", fontSize: 14, fontWeight: 600, cursor: buReady ? "pointer" : "not-allowed", background: buReady ? C.navy : "#D9D6CB", color: buReady ? "#fff" : "#7b8794" }}>Confirm</button>
            )}
          </div>
          <div style={{ width: 84, height: 84, borderRadius: "50%", background: `conic-gradient(#3B6D11 ${(overallPct || 0) * 3.6}deg, #D9D6CB 0deg)`, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
            <div style={{ width: 66, height: 66, borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <b style={{ fontSize: 20, fontWeight: 700, color: C.navy }}>{overallPct === null ? "—" : `${overallPct}%`}</b>
            </div>
          </div>
        </div>
      </div>

      <div style={{ borderRadius: 16, background: "#F4F3EF", overflow: "hidden", border: "none", boxShadow: "none" }}>
        <ZoneHeader badge="1" title="Step 1 : Prepare & Analyze Data" state={z1State} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
          <div>
            {LEFT.map(renderStep)}
          </div>
          <div style={{ borderLeft: "1px solid #E9ECF1", position: "relative", minHeight: 0 }}>
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", padding: "16px 20px 5px", boxSizing: "border-box", opacity: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, flexWrap: "wrap", flexShrink: 0 }}>
                <div style={{ width: 64, height: 64, borderRadius: "50%", background: `conic-gradient(${on46 ? "#3B6D11" : "#C9C8C0"} ${p46 * 3.6}deg, #EEF0F4 0deg)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <div style={{ width: 50, height: 50, borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: p46 >= 100 ? 11 : 13, fontWeight: 700, color: ink }}>{p46}%</div>
                </div>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Chip v={statusOf(t46)} />
                    <span style={{ fontSize: 15, fontWeight: 600, color: ink }}>Percentage 46119 Completed</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#7b8794", marginTop: 4 }}>
                    {!act46.length ? "ยังไม่ได้เลือกแพลตฟอร์มของ BU นี้" : left46 === 0 ? `ครบทั้ง ${act46.length} แพลตฟอร์มของ BU นี้แล้ว` : `BU นี้มี ${act46.length} แพลตฟอร์ม · เหลืออีก ${left46} · ครบทุกอันของ BU = Y อัตโนมัติ`}
                  </div>
                </div>
                <EnableToggle on={on46} disabled={closed} onChange={(v) => onMode("46119", v ? "auto" : "X")} />
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 12, flexShrink: 0 }}>
                <button type="button" disabled={closed || !on46} style={{ ...btn, borderRadius: 999, height: 28 }} onClick={() => onTickAll("46119", true, userName)}>ติ๊กทั้งหมด</button>
                <button type="button" disabled={closed || !on46} style={{ ...btn, borderRadius: 999, height: 28 }} onClick={() => onTickAll("46119", false, userName)}>ล้างทั้งหมด</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12, alignItems: "stretch", opacity: on46 ? 1 : 0.5, flex: "1 1 0%", minHeight: 0 }}>
                {/* ซ้าย: แพลตฟอร์มที่ BU นี้มี (Enable) = Checklist ตามจำนวนที่ Enable */}
                <div style={{ border: "1px solid #CFE5B0", borderRadius: 12, background: "#FAFCF6", padding: 10, display: "flex", flexDirection: "column", minHeight: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#27500A", margin: "2px 2px 8px" }}>Enable · {act46.length} แพลตฟอร์ม</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, flex: "1 1 0%", minHeight: 0, overflowY: "auto", alignContent: "start" }}>
                    {t46.items.map((x, n) => ({ x, n })).filter(({ x }) => !x.off).map(({ x, n }) => (
                      <label
                        key={x.label}
                        style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 10, cursor: closed || !on46 ? "default" : "pointer", fontSize: 13, fontWeight: 500, background: x.done ? "#EEF6E4" : "#FDF3F3", color: x.done ? "#27500A" : "#8a3b3b", border: `1px solid ${x.done ? "#CFE5B0" : "#F5D3D3"}`, transition: "all .15s" }}
                      >
                        <input type="checkbox" checked={x.done} disabled={closed || !on46} onChange={() => onTick("46119", n, userName)} style={{ display: "none" }} />
                        <span style={{ width: 18, height: 18, borderRadius: "50%", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#fff", background: x.done ? "#3B6D11" : "transparent", border: x.done ? "none" : "1.5px solid #E3A9A9" }}>{x.done ? "✓" : ""}</span>
                        <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.label}</span>
                        {!closed && on46 && (
                          <button
                            type="button"
                            title="Disable · BU นี้ไม่มีแพลตฟอร์มนี้ (ย้ายไปฝั่งขวา)"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onItemEnable("46119", n, false); }}
                            style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 13, color: "inherit", opacity: 0.55, padding: "0 2px", lineHeight: 1 }}
                          >
                            ✕
                          </button>
                        )}
                      </label>
                    ))}
                    {!act46.length && <div style={{ fontSize: 12, color: "#7b8794", padding: 8 }}>ยังไม่มีแพลตฟอร์มที่ Enable</div>}
                  </div>
                </div>
                {/* ขวา: แพลตฟอร์มที่ BU นี้ไม่มี (Disable) -- กด Enable เพื่อย้ายกลับไปซ้าย */}
                <div style={{ border: "1px dashed #D3D1C7", borderRadius: 12, background: "#F7F7F5", padding: 10, display: "flex", flexDirection: "column", minHeight: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#7b8794", margin: "2px 2px 8px" }}>Disable · {t46.items.length - act46.length} แพลตฟอร์ม</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, flex: "1 1 0%", minHeight: 0, overflowY: "auto", alignContent: "start" }}>
                    {t46.items.map((x, n) => ({ x, n })).filter(({ x }) => x.off).map(({ x, n }) => (
                      <div
                        key={x.label}
                        title="กดเพื่อ Enable ย้ายกลับไปฝั่งซ้าย"
                        onClick={() => { if (!closed && on46) onItemEnable("46119", n, true); }}
                        style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", borderRadius: 10, fontSize: 13, background: "#fff", color: "#9a9a95", border: "1px dashed #D3D1C7", cursor: closed || !on46 ? "default" : "pointer" }}
                      >
                        <span style={{ width: 18, height: 18, flexShrink: 0, borderRadius: "50%", border: "1.5px dashed #C9C8C0", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>+</span>
                        <span style={{ flex: 1, textDecoration: "line-through", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.label}</span>
                      </div>
                    ))}
                    {act46.length === t46.items.length && <div style={{ fontSize: 12, color: "#7b8794", padding: 8 }}>ไม่มี</div>}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Zone 2: Closing Vat - Request ID (ID สำหรับโอน VAT) */}
      <div style={{ marginTop: 16, borderRadius: 16, background: "#F4F3EF", overflow: "hidden", border: "none", boxShadow: "none" }}>
        <ZoneHeader badge="2" title="Step 2 : Pre-Reconcile Vat" state={z2State} />
        <div style={{ background: "#F4F3EF" }}>
        <div style={{ padding: "14px 16px 0", fontSize: 12, fontWeight: 600, letterSpacing: 0.4, color: "#1a3a5c" }}>DAILY · TRANSFER VAT</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 12, padding: "10px 16px 16px" }}>
          {[0, 1, 2, 3].map(renderVatCard)}

          {(() => {
            const sv = u.vat.status.s;
            const cl = sv === "O" ? "Y" : sv === "X" ? "X" : "N";
            const acc = cl === "Y" ? "#3B6D11" : cl === "X" ? "#C9C8C0" : "#E0A030";
            const seg = (val, label, col) => (
              <button
                type="button"
                disabled={closed}
                onClick={() => onVatStatus(val)}
                style={{ flex: 1, height: 26, padding: 0, fontSize: 11, border: "none", borderRadius: 999, cursor: closed ? "default" : "pointer", background: sv === val ? col : "transparent", color: sv === val ? "#fff" : "#8a8a85", fontWeight: sv === val ? 600 : 400 }}
              >
                {label}
              </button>
            );
            return (
              <div style={{ border: "1px solid #E3E5EA", borderRadius: 12, overflow: "hidden", background: "#fff", display: "flex", flexDirection: "column", }}>
                <div style={{ height: 4, background: acc }} />
                <div style={{ padding: "12px 12px 14px", display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ display: "inline-block", minWidth: 28, padding: "3px 0", borderRadius: 4, fontWeight: 500, fontSize: 12, textAlign: "center", background: C[cl].bg, color: C[cl].fg }}>{sv || "-"}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.4, color: "#7b8794" }}>TRANSFER VAT</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: ink, minHeight: 36 }}>Transfer Vat Status</div>
                  <div style={{ display: "flex", padding: 2, borderRadius: 999, background: "#EEEDE6", marginTop: "auto" }}>
                    {seg("O", "O · โอน", "#3B6D11")}
                    {seg("X", "X · ไม่โอน", "#A32D2D")}
                  </div>
                  <div style={{ fontSize: 11, color: "#7b8794", textAlign: "center" }}>
                    {sv === "O" ? `โอน VAT แล้ว · ${u.vat.status.by}` : sv === "X" ? "ไม่โอนรอบนี้" : "ยังไม่ได้เลือก"}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 12, padding: "12px 16px 16px", background: "#F4F3EF" }}>
          <div style={{ border: "1px solid #D9D6CB", borderRadius: 12, padding: "10px 10px 12px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.4, color: "#854F0B", marginBottom: 10 }}>TRIAL BALANCE</div>
            {renderVatCard(4)}
          </div>
          <div style={{ gridColumn: "span 4", border: "1px solid #D9D6CB", borderRadius: 12, padding: "10px 10px 12px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.4, color: "#0F6E56", marginBottom: 10, textAlign: "center" }}>SIMPLE</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
              {[5, 6, 7, 8].map(renderVatCard)}
            </div>
          </div>
        </div>
        <div style={{ background: "#F4F3EF" }}>
          <div style={{ padding: "14px 16px 0", fontSize: 12, fontWeight: 600, letterSpacing: 0.4, color: "#534AB7" }}>INPUT SUMMARY</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 12, padding: "10px 16px 16px" }}>
            {["A", "N", "T", "F", "M"].map(renderSumCard)}
          </div>
        </div>
        <div style={{ background: "#F4F3EF" }}>
          <div style={{ padding: "14px 16px 0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.4, color: "#0C447C" }}>INCOMPLETE · INPUT RECONCILE</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, padding: "10px 16px 16px" }}>
            {renderReqCard("Incomplete", "Incomplete", 3)}
            {renderReqCard("Input Reconcile", "Input Reconcile", 3)}
          </div>
        </div>
      </div>

      {/* Zone 3: Report (First Draft | Final Draft) */}
      <div style={{ marginTop: 16, borderRadius: 16, background: "#F4F3EF", overflow: "hidden", border: "none", boxShadow: "none" }}>
        <ZoneHeader badge="F" title="Final Step : Reconcile Vat Report" state={z3State} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
          {RPT_SIDES.map(([side, title, bg, fg]) => renderRptSide(side, title, bg, fg))}
        </div>
      </div>
      {rstCode && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 9999999, display: "flex", alignItems: "center", justifyContent: "center" }} onMouseDown={(e) => { if (e.target === e.currentTarget) closeReset(); }}>
          <div style={{ background: "#fff", borderRadius: 12, maxWidth: 320, width: "90%", padding: 22, boxShadow: "0 10px 40px rgba(0,0,0,0.25)", textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: C.navy, marginBottom: 4 }}>ยืนยันการ Reset BU {u.bu}</div>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 16 }}>ล้างค่าที่กรอก/ติ๊ก/Finish/Confirm ของ BU นี้เท่านั้น (Enable/Disable ไม่ถูกล้าง) กรุณายืนยันรหัสด้านล่าง</div>
            <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: "0.15em", color: C.navy, background: "#f7f8fa", borderRadius: 8, padding: 12, marginBottom: 16, fontFamily: "monospace" }}>{rstCode}</div>
            <input value={rstInput} onChange={(e) => { setRstInput(e.target.value.replace(/\D/g, "").slice(0, 6)); setRstErr(false); }} onKeyDown={(e) => { if (e.key === "Enter" && rstInput.length === 6) confirmReset(); }} placeholder="พิมพ์รหัส 6 หลักด้านบน" autoFocus style={{ width: "100%", height: 38, textAlign: "center", fontSize: 16, letterSpacing: "0.15em", border: `1px solid ${rstErr ? "#C0392B" : "#ccc"}`, borderRadius: 6, outline: "none", boxSizing: "border-box", marginBottom: rstErr ? 6 : 14 }} />
            {rstErr && <div style={{ fontSize: 11, color: "#C0392B", marginBottom: 10 }}>รหัสยืนยันไม่ถูกต้อง กรุณาลองใหม่</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={closeReset} style={{ flex: 1, height: 36, background: "none", border: "1px solid #ddd", color: "#888", borderRadius: 6, fontSize: 13, cursor: "pointer" }}>ยกเลิก</button>
              <button type="button" onClick={confirmReset} disabled={rstInput.length !== 6} style={{ flex: 1, height: 36, background: rstInput.length === 6 ? C.navy : "#ccc", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, cursor: rstInput.length === 6 ? "pointer" : "default" }}>ยืนยัน</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Config BU: เลือก BU จาก Company List แล้วเขียนชื่อผู้ใช้ลง PREPARE BY (VAT Setting) -- บันทึกจริงที่ company_list
// ผู้ที่มีสิทธิ์ VAT: Owner หรือ permissions.VAT = true (ถ้าไม่มี permissions ใช้ค่าเริ่มต้นตาม Role เหมือนหน้า User Management)
const VAT_BY_ROLE = { owner: true, admin: true, editor: true, viewer: false };
function hasVatPerm(u) {
  const role = String(u.role || "").toLowerCase();
  if (role === "owner") return true;
  let p = u.permissions;
  if (typeof p === "string") { try { p = JSON.parse(p); } catch (e) { p = null; } }
  if (p && typeof p === "object" && "VAT" in p) return p.VAT === true;
  return !!VAT_BY_ROLE[role];
}
function IncludeModal({ opts, sel, onSave, onClose }) {
  const [pick, setPick] = React.useState(sel);
  const [q, setQ] = React.useState("");
  const list = opts.filter((o) => (o.username + " " + o.name).toLowerCase().includes(q.trim().toLowerCase()));
  const tog = (un) => setPick((p) => (p.includes(un) ? p.filter((x) => x !== un) : [...p, un]));
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center" }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#fff", borderRadius: 12, width: 440, maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 12px 40px rgba(0,0,0,.25)" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #E3E5EA" }}>
          <div style={{ fontWeight: 600, fontSize: 15, color: C.navy }}>เลือก User ที่ต้องการดูใน All User Related Status</div>
          <div style={{ fontSize: 12, color: "#7b8794", marginTop: 4 }}>จะแสดง BU ของคุณ + BU ของ User ที่ติ๊กไว้เท่านั้น</div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา User" style={{ marginTop: 10, width: "100%", boxSizing: "border-box", height: 32, border: "1px solid #CBD2D9", borderRadius: 8, padding: "0 10px", fontSize: 13 }} />
        </div>
        <div style={{ overflowY: "auto", padding: "6px 10px", flex: 1 }}>
          {list.length === 0 && <div style={{ padding: 16, fontSize: 13, color: "#7b8794" }}>ไม่พบ User</div>}
          {list.map((o) => (
            <label key={o.username} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 8px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>
              <input type="checkbox" checked={pick.includes(o.username)} onChange={() => tog(o.username)} />
              <span style={{ flex: 1 }}>{o.username}{o.name ? <span style={{ color: "#7b8794" }}> · {o.name}</span> : null}</span>
              <span style={{ fontSize: 11, color: "#7b8794" }}>{o.n} BU</span>
            </label>
          ))}
        </div>
        <div style={{ padding: "12px 18px", borderTop: "1px solid #E3E5EA", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "#7b8794" }}>เลือกแล้ว {pick.length} คน</span>
          <span style={{ display: "inline-flex", gap: 8 }}>
            <button type="button" style={{ ...btn, height: 32, padding: "0 14px", borderRadius: 8 }} onClick={onClose}>ยกเลิก</button>
            <button type="button" style={{ ...btn, height: 32, padding: "0 16px", borderRadius: 8, background: C.navy, color: "#fff", border: "none", fontWeight: 600 }} onClick={() => onSave(pick)}>บันทึก</button>
          </span>
        </div>
      </div>
    </div>
  );
}

function ConfigModal({ me, isAdmin, who, onClose }) {
  const [users, setUsers] = React.useState([]);
  const [companies, setCompanies] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState("");
  const [uid, setUid] = React.useState("");
  const [name, setName] = React.useState("");
  const [q, setQ] = React.useState("");
  const [own, setOwn] = React.useState({});
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState("");
  const [dd, setDd] = React.useState(false);
  const [ctx, setCtx] = React.useState(null);
  const [ud, setUd] = React.useState(false);
  const [cf, setCf] = React.useState(false);

  React.useEffect(() => {
    let off = false;
    (async () => {
      const [u, c] = await Promise.all([db.from("user_roles").select("*"), db.from("company_list").select("*")]);
      if (off) return;
      if (u.error || c.error) setErr(String(u.error || c.error));
      const ul = Array.isArray(u.data) ? u.data : [];
      setUsers(ul);
      setCompanies((Array.isArray(c.data) ? c.data : []).filter((r) => r.bu).sort((a, b) => String(a.bu).localeCompare(String(b.bu))));
      const mine = ul.find((x) => (x.username || "").toLowerCase() === String(me || "").toLowerCase());
      if (mine) { setUid(String(mine.id)); setName(mine.vat_prepare_name || ""); }
      setLoading(false);
    })();
    return () => { off = true; };
  }, [me]);

  const user = users.find((x) => String(x.id) === uid);
  const isMeUser = (x) => String(x.username || "").toLowerCase() === String(me || "").toLowerCase();
  const vatUsers = users.filter((x) => hasVatPerm(x) || isMeUser(x));
  // ดู Progress — โหลดรายการ BU ที่ User นี้เลือกดู (timeline_watch 1 แถวต่อ User)
  const [watch, setWatch] = React.useState({});
  const [wRow, setWRow] = React.useState(null);
  const uname = user ? user.username : "";
  React.useEffect(() => {
    let off = false;
    setWatch({}); setWRow(null);
    if (!uname) return undefined;
    (async () => {
      const r = await db.from("timeline_watch").select("*").eq("username", uname);
      if (off || r.error) return;
      const row = Array.isArray(r.data) && r.data[0] ? r.data[0] : null;
      const bus = row && Array.isArray(row.bus) ? row.bus : [];
      setWRow(row ? { id: row.id, bus } : { id: null, bus: [] });
      const m = {}; bus.forEach((b) => { m[b] = true; }); setWatch(m);
    })();
    return () => { off = true; };
  }, [uname]);
  const wBase = new Set(wRow ? wRow.bus : []);
  const watchDirty = !!wRow && companies.some((c) => !!watch[c.bu] !== wBase.has(c.bu));
  const names = React.useMemo(() => [...new Set(companies.map((c) => (c["PREPARE BY"] || "").trim()).filter(Boolean))].sort(), [companies]);
  const pickUser = (id) => { setCf(false); setUid(id); const x = users.find((y) => String(y.id) === id); setName((x && x.vat_prepare_name) || ""); setOwn({}); setMsg(""); };
  const nm = name.trim();
  // เลือก/พิมพ์ชื่อที่ถูกผูกกับบัญชีไว้แล้ว -> เด้ง "ผู้ใช้" ไปเป็นเจ้าของชื่อนั้นให้ Sync กัน (ชื่อที่ยังไม่มีใครผูก = ไม่ทำอะไร)
  const syncUserByName = (n) => {
    const t = String(n || "").trim().toLowerCase();
    if (!t) return;
    const owner = users.find((x) => String(x.vat_prepare_name || "").trim().toLowerCase() === t);
    if (owner && String(owner.id) !== uid) { setUid(String(owner.id)); setMsg(""); }
  };
  // Broadcast: ชื่อ <-> ผู้ใช้ ต้องตรงกันตลอด ไม่ว่าเปลี่ยนจากทางไหน (เลือกผู้ใช้ / เลือก-พิมพ์ชื่อ / โหลดข้อมูล)
  // ถ้าชื่อที่แสดงมีเจ้าของอยู่แล้ว และผู้ใช้ที่เลือกอยู่ไม่ใช่เจ้าของ -> เด้งผู้ใช้ไปเป็นเจ้าของชื่อนั้นทันที
  React.useEffect(() => {
    if (!nm || users.length === 0) return;
    const t = nm.toLowerCase();
    const holds = (x) => String(x.vat_prepare_name || "").trim().toLowerCase() === t;
    const cur = users.find((x) => String(x.id) === uid);
    if (cur && holds(cur)) return;
    const owner = users.find(holds);
    if (owner) setUid(String(owner.id));
  }, [nm, users, uid]);
  const nameOpts = names.filter((n) => !nm || names.some((x) => x.toLowerCase() === nm.toLowerCase()) || n.toLowerCase().includes(nm.toLowerCase()));
  const holder = (c) => (c["PREPARE BY"] || "").trim();
  const isMine = (c) => nm && holder(c).toLowerCase() === nm.toLowerCase();
  const locked = (c) => !isMine(c) && holder(c) !== "" && !isAdmin;
  const rows = companies.filter((c) => !q.trim() || `${c.bu} ${c["THAI COMPANY NAME"] || ""} ${c["COMPANY CODE"] || ""} ${c["TAX ID"] || ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  const picked = companies.filter((c) => own[c.id] && !isMine(c));
  const released = companies.filter((c) => isMine(c) && own[c.id] === false);
  const needBind = !!(user && nm && (user.vat_prepare_name || "") !== nm);
  const canSave = picked.length > 0 || released.length > 0 || needBind || watchDirty;

  const setMany = (list, v) => {
    setOwn((o) => { const n = { ...o }; list.forEach((c) => { if (!locked(c) && nm) n[c.id] = v; }); return n; });
    setCtx(null);
  };
  const setAllShown = (v) => setMany(rows, v);
  const setWatchMany = (list, v) => {
    if (wRow) setWatch((w) => { const n = { ...w }; list.forEach((c) => { n[c.bu] = v; }); return n; });
    setCtx(null);
  };
  const setWatchAllOf = (owner, v) => setWatchMany(companies.filter((c) => holder(c) === owner), v);
  const setAllOf = (owner, v) => setMany(companies.filter((c) => holder(c) === owner), v);

  const save = async () => {
    if (!nm && !watchDirty) { setMsg("กรอกชื่อที่ใช้ตอนทำ VAT ก่อน"); return; }
    if (needBind && !cf) { setCf(true); return; }
    setSaving(true); setMsg(""); setCf(false);
    let done = 0; const skipped = []; let bindErr = ""; let bindOk = false;
    for (const c of picked) {
      const cur = await db.from("company_list").select("*").eq("id", c.id).single();
      const now = cur.data ? holder(cur.data) : holder(c);
      if (now !== holder(c) && !isAdmin) { skipped.push(c.bu); continue; } // มีคนเปลี่ยนไปก่อนระหว่างเปิดหน้าต่าง
      const r = await db.from("company_list").update({ "PREPARE BY": nm, updated_by: who, updated_at: new Date().toISOString() }).eq("id", c.id);
      if (r.error) skipped.push(c.bu); else done += 1;
    }
    for (const c of released) {
      const r = await db.from("company_list").update({ "PREPARE BY": "", updated_by: who, updated_at: new Date().toISOString() }).eq("id", c.id);
      if (r.error) skipped.push(c.bu); else done += 1;
    }
    if (user && (user.vat_prepare_name || "") !== nm) {
      const r = await db.from("user_roles").update({ vat_prepare_name: nm }).eq("id", user.id);
      if (r.error) bindErr = "ผูกชื่อกับบัญชีไม่สำเร็จ (ตรวจว่ามีคอลัมน์ vat_prepare_name ใน user_roles)";
      else { setUsers((l) => l.map((x) => (x.id === user.id ? { ...x, vat_prepare_name: nm } : x))); bindOk = true; }
    }
    let watchMsg = "";
    if (watchDirty && uname) {
      const bus = companies.filter((c) => watch[c.bu]).map((c) => c.bu);
      const payload = { bus, updated_by: who, updated_at: new Date().toISOString() };
      const wr = wRow && wRow.id ? await db.from("timeline_watch").update(payload).eq("id", wRow.id) : await db.from("timeline_watch").insert({ username: uname, ...payload });
      if (wr.error) watchMsg = "บันทึก ดู Progress ไม่สำเร็จ (ตรวจว่า Deploy Backend/ตาราง timeline_watch แล้ว)";
      else { watchMsg = `บันทึก ดู Progress แล้ว ${bus.length} BU`; const nr = await db.from("timeline_watch").select("*").eq("username", uname); const row = Array.isArray(nr.data) && nr.data[0] ? nr.data[0] : null; setWRow(row ? { id: row.id, bus: Array.isArray(row.bus) ? row.bus : bus } : { id: null, bus }); }
    }
    if (done) broadcastWs("company_list_updated", { action: "update" });
    const fresh = await db.from("company_list").select("*");
    if (Array.isArray(fresh.data)) setCompanies(fresh.data.filter((r) => r.bu).sort((a, b) => String(a.bu).localeCompare(String(b.bu))));
    setOwn({});
    setSaving(false);
    setMsg([`บันทึก Prepare By แล้ว ${done} BU`, bindOk ? "ผูกชื่อกับบัญชีแล้ว" : "", watchMsg, skipped.length ? `ข้าม ${skipped.length} BU (${skipped.join(", ")})` : "", bindErr].filter(Boolean).join(" · "));
  };

  const inp = { height: 34, border: "0.5px solid #ccc", borderRadius: 8, padding: "0 10px", fontSize: 13, background: "#fff", boxSizing: "border-box", width: "100%" };
  const lbl = { fontSize: 11, color: "#616e7c", margin: "0 0 4px" };
  const grid = "54px 1fr 150px 62px 74px";
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center" }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#fff", borderRadius: 14, width: 680, maxWidth: "94vw", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", background: "#EEF2F7", borderBottom: "2px solid " + C.navy, fontWeight: 700, color: C.navy, fontSize: 15 }}>
          Config BU
          <button type="button" onClick={onClose} aria-label="ปิด" style={{ marginLeft: "auto", border: "none", background: "transparent", fontSize: 16, cursor: "pointer", color: "#616e7c" }}>✕</button>
        </div>
        <div style={{ padding: 16, overflowY: "auto" }}>
          {loading ? <div style={{ color: "#616e7c" }}>กำลังโหลด…</div> : (
            <>
              {err && <div style={{ background: C.X.bg, color: C.X.fg, padding: "6px 10px", borderRadius: 8, marginBottom: 10, fontSize: 12 }}>{err}</div>}
              <div style={{ display: "grid", gridTemplateColumns: "190px 1fr", gap: 10 }}>
                <div>
                  <div style={lbl}>ผู้ใช้</div>
                  <div style={{ position: "relative" }}>
                    <button type="button" disabled={!isAdmin} onClick={() => setUd((v) => !v)} onBlur={() => setTimeout(() => setUd(false), 120)} style={{ ...inp, display: "flex", alignItems: "center", justifyContent: "space-between", textAlign: "left", cursor: isAdmin ? "pointer" : "default", color: "#1f2933" }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user ? `${user.username || user.email}${isMeUser(user) ? " (ฉัน)" : ""}` : "— เลือกผู้ใช้ —"}</span>
                      <span style={{ fontSize: 10, color: "#616e7c" }}>▾</span>
                    </button>
                    {ud && isAdmin && (
                      <div style={{ position: "absolute", left: 0, right: 0, top: 38, zIndex: 6, background: "#fff", border: "0.5px solid #ccc", borderRadius: 8, boxShadow: "0 6px 18px rgba(0,0,0,.14)", maxHeight: 170, overflowY: "auto" }}>
                        {vatUsers.map((x) => (
                          <div key={x.id} onMouseDown={() => { pickUser(String(x.id)); setUd(false); }} style={{ height: 34, boxSizing: "border-box", padding: "0 10px", display: "flex", alignItems: "center", fontSize: 13, cursor: "pointer", background: String(x.id) === uid ? "#EEF2F7" : "#fff" }} onMouseEnter={(e) => { e.currentTarget.style.background = "#EEF2F7"; }} onMouseLeave={(e) => { e.currentTarget.style.background = String(x.id) === uid ? "#EEF2F7" : "#fff"; }}>{x.username || x.email}{isMeUser(x) ? " (ฉัน)" : ""}</div>
                        ))}
                        {!vatUsers.length && <div style={{ padding: 10, fontSize: 12, color: "#8a8a85" }}>ไม่พบผู้ใช้ที่มีสิทธิ์ VAT</div>}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ position: "relative" }}>
                  <div style={lbl}>ชื่อที่ใช้ตอนทำ VAT (Prepare By)</div>
                  <input value={name} onChange={(e) => { setCf(false); setName(e.target.value); syncUserByName(e.target.value); setDd(true); }} onFocus={() => setDd(true)} onBlur={() => setTimeout(() => setDd(false), 120)} placeholder="เลือกจากรายชื่อ หรือพิมพ์ชื่อใหม่" style={inp} />
                  {needBind && (
                    <div style={{ marginTop: 4, fontSize: 11, color: cf ? "#B42318" : "#B54708" }}>
                      {user.vat_prepare_name ? `จะเปลี่ยนชื่อที่ผูกของ ${user.username || user.email} จาก "${user.vat_prepare_name}" เป็น "${nm}"` : `ชื่อนี้ยังไม่ผูกกับใคร จะผูกกับ ${user.username || user.email}`}{cf ? " — กดบันทึกอีกครั้งเพื่อยืนยัน" : ""}
                    </div>
                  )}
                  {dd && nameOpts.length > 0 && (
                    <div style={{ position: "absolute", left: 0, right: 0, top: 56, zIndex: 5, background: "#fff", border: "0.5px solid #ccc", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,.12)", maxHeight: 190, overflowY: "auto" }}>
                      {nameOpts.map((n) => (
                        <div key={n} onMouseDown={() => { setCf(false); setName(n); syncUserByName(n); setDd(false); }} style={{ padding: "6px 10px", fontSize: 13, cursor: "pointer", background: n === nm ? "#EEF2F7" : "#fff" }} onMouseEnter={(e) => { e.currentTarget.style.background = "#EEF2F7"; }} onMouseLeave={(e) => { e.currentTarget.style.background = n === nm ? "#EEF2F7" : "#fff"; }}>{n}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ ...lbl, marginTop: 10 }}>เลือก BU จาก Company List</div>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา BU / รหัส / ชื่อบริษัท" style={inp} />
              <div style={{ border: "0.5px solid #E3E5EA", borderRadius: 10, marginTop: 8, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: grid, gap: 8, padding: "7px 10px", background: "#F4F3EF", color: "#616e7c", fontSize: 11 }}>
                  <span>BU</span><span>บริษัท</span><span>Prepare By (VAT)</span><span style={{ textAlign: "center" }} title="BU ที่ต้องการดู Progress ใน Timeline (ไม่เปลี่ยนเจ้าของ)">ดู Progress</span><span style={{ textAlign: "center" }}>เป็นของผู้ใช้</span>
                </div>
                <div style={{ height: 300, overflowY: "auto" }} onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY }); }}>
                  {rows.map((c) => (
                    <div key={c.id} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtx({ x: e.clientX, y: e.clientY, owner: holder(c) }); }} style={{ display: "grid", gridTemplateColumns: grid, gap: 8, padding: "6px 10px", borderTop: "0.5px solid #E3E5EA", alignItems: "center", fontSize: 12 }}>
                      <b style={{ fontWeight: 500, color: C.navy }}>{c.bu}</b>
                      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c["THAI COMPANY NAME"]}</span>
                      <span style={{ color: holder(c) ? "#1f2933" : "#8a8a85" }}>{holder(c) || "(ว่าง)"}</span>
                      <span style={{ textAlign: "center" }}><input type="checkbox" checked={!!watch[c.bu]} disabled={!wRow} onChange={(e) => setWatch((w) => ({ ...w, [c.bu]: e.target.checked }))} title="ติ๊กเพื่อดู Progress ของ BU นี้ใน Timeline" /></span>
                      <span style={{ textAlign: "center" }}>
                        <input type="checkbox" checked={isMine(c) ? own[c.id] !== false : !!own[c.id]} disabled={locked(c) || !nm} onChange={(e) => setOwn((o) => ({ ...o, [c.id]: e.target.checked }))} title={locked(c) ? "เป็นของคนอื่น เฉพาะ Admin/Owner" : ""} />
                        {locked(c) ? <span style={{ fontSize: 11, color: "#8a8a85" }}> 🔒</span> : null}
                      </span>
                    </div>
                  ))}
                  {!rows.length && <div style={{ padding: 12, color: "#8a8a85", fontSize: 12 }}>ไม่พบ BU</div>}
                </div>
              </div>
              <div style={{ fontSize: 11, color: "#616e7c", marginTop: 8 }}>เลือกใหม่ {picked.length} BU · จะเปลี่ยน Prepare By เป็น "{nm || "-"}"{released.length ? ` · ปลดออก ${released.length} BU` : ""}{picked.some((c) => holder(c)) ? ` · ทับของเดิม ${picked.filter((c) => holder(c)).length} BU` : ""}</div>
              {ctx && (
                <div onMouseDown={() => setCtx(null)} onContextMenu={(e) => { e.preventDefault(); setCtx(null); }} style={{ position: "fixed", inset: 0, zIndex: 1100 }}>
                  <div onMouseDown={(e) => e.stopPropagation()} style={{ position: "fixed", left: ctx.x, top: ctx.y, background: "#fff", border: "0.5px solid #ccc", borderRadius: 8, boxShadow: "0 6px 18px rgba(0,0,0,.18)", padding: 4, minWidth: 170 }}>
                    {[
                      ["เป็นของผู้ใช้", [...(ctx.owner ? [[`ติ๊กทั้งหมดของ ${ctx.owner}`, () => setAllOf(ctx.owner, true)], [`ล้างทั้งหมดของ ${ctx.owner}`, () => setAllOf(ctx.owner, false)]] : []), ["ติ๊กทั้งหมดที่แสดง", () => setAllShown(true)], ["ล้างทั้งหมดที่แสดง", () => setAllShown(false)]]],
                      ["ดู Progress", [...(ctx.owner ? [[`ติ๊กดู Progress ทั้งหมดของ ${ctx.owner}`, () => setWatchAllOf(ctx.owner, true)], [`ล้างดู Progress ทั้งหมดของ ${ctx.owner}`, () => setWatchAllOf(ctx.owner, false)]] : []), ["ติ๊กดู Progress ทั้งหมดที่แสดง", () => setWatchMany(rows, true)], ["ล้างดู Progress ทั้งหมดที่แสดง", () => setWatchMany(rows, false)]]],
                    ].map(([title, items], gi) => (
                      <div key={title}>
                        {gi > 0 && <div style={{ height: 1, background: "#E3E5EA", margin: "3px 0" }} />}
                        <div style={{ padding: "4px 12px 2px", fontSize: 10, color: "#8a8a85", fontWeight: 600 }}>{title}</div>
                        {items.map(([label, fn]) => (
                          <div key={label} role="button" onClick={fn} style={{ padding: "7px 12px", fontSize: 13, cursor: "pointer", borderRadius: 6 }} onMouseEnter={(e) => { e.currentTarget.style.background = "#EEF2F7"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}>{label}</div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {msg && <div style={{ fontSize: 12, marginTop: 8, color: C.Y.fg, background: C.Y.bg, padding: "6px 10px", borderRadius: 8 }}>{msg}</div>}
            </>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", background: "#F4F3EF", borderTop: "0.5px solid #E3E5EA" }}>
          <span style={{ fontSize: 11, color: "#616e7c", flex: 1 }}>บันทึกลง Company List (VAT Setting) ทันที</span>
          <button type="button" style={{ ...btn, borderRadius: 8, padding: "6px 14px" }} onClick={onClose}>ปิด</button>
          <button type="button" disabled={saving || loading || !canSave} style={{ ...btn, borderRadius: 8, padding: "6px 14px", border: "none", background: saving || !canSave ? "#D9D6CB" : C.navy, color: saving || !canSave ? "#7b8794" : "#fff" }} onClick={save}>{saving ? "กำลังบันทึก…" : cf ? "ยืนยันบันทึก" : "บันทึก"}</button>
        </div>
      </div>
    </div>
  );
}

export default function TimelinePage() {
  const { userName } = useAuth();
  const { isAdmin } = useUserRole();
  const [showCfg, setShowCfg] = React.useState(false);
  const [bus, setBus] = React.useState([]);
  const [src, setSrc] = React.useState({ loading: true, error: "", bound: "" });
  const [reload, setReload] = React.useState(0);
  // User ที่เลือก Include ใน Tab All User Related Status (เก็บต่อผู้ใช้ใน timeline_progress: period_ym="__include__", bu=username)
  const [inc, setInc] = React.useState(null);
  const [userOpts, setUserOpts] = React.useState([]);
  const [showInc, setShowInc] = React.useState(false);
  const incRowRef = React.useRef(null);
  React.useEffect(() => {
    let off = false;
    (async () => {
      const r = await db.from("timeline_progress").select("*").eq("period_ym", "__include__").eq("bu", userName || "");
      if (off) return;
      const row = Array.isArray(r.data) && r.data[0] ? r.data[0] : null;
      incRowRef.current = row ? row.id : null;
      setInc(row && row.state && Array.isArray(row.state.users) ? row.state.users : []);
    })();
    return () => { off = true; };
  }, [userName]);
  const saveInc = async (list) => {
    setInc(list); setShowInc(false);
    const payload = { state: { users: list }, updated_by: userName || "", updated_at: new Date().toISOString() };
    let res;
    if (incRowRef.current) res = await db.from("timeline_progress").update(payload).eq("id", incRowRef.current);
    else {
      res = await db.from("timeline_progress").insert({ period_ym: "__include__", bu: userName || "", ...payload });
      if (!res.error) { const q = await db.from("timeline_progress").select("*").eq("period_ym", "__include__").eq("bu", userName || ""); const row = Array.isArray(q.data) ? q.data[0] : null; if (row) incRowRef.current = row.id; }
    }
    if (res.error) setSaveMsg("บันทึกรายชื่อ User ไม่สำเร็จ: " + (res.error.message || res.error));
  };
  React.useEffect(() => {
    if (inc === null) return undefined;
    let off = false;
    (async () => {
      const r = await fetchMyBus(userName, isAdmin, inc);
      if (off) return;
      setUserOpts(r.users || []);
      setBus((prev) => r.rows.map((c) => {
        const fresh = mkRealBu(c);
        const old = prev.find((b) => b.bu === c.bu);
        // คงความคืบหน้าเดิมไว้ แต่รีเฟรชข้อมูลบริษัท (ชื่อ/Rate) จาก company_list ทุกครั้ง
        const mine = r.mine.includes(c.bu);
        return old ? { ...old, code: fresh.code, name: fresh.name, nameEn: fresh.nameEn, vatRate: fresh.vatRate, prep: fresh.prep, mine } : { ...fresh, mine };
      }));
      setCur(-1);
      setSrc({ loading: false, error: r.error, bound: r.bound });
    })();
    return () => { off = true; };
  }, [userName, reload, isAdmin, inc]);
  const closed = false; // Dashboard นี้ไม่มีการปิด Period
  // ── บันทึกความคืบหน้าลง DB (ตาราง timeline_progress: 1 แถวต่อ Period + BU) ──
  const savedRef = React.useRef({}); // bu -> JSON ที่บันทึก/โหลดล่าสุด
  const rowIdRef = React.useRef({}); // bu -> id แถวใน DB
  const [loadedProg, setLoadedProg] = React.useState(false);
  const [saveMsg, setSaveMsg] = React.useState("");
  const busKeys = bus.map((b) => b.bu).join("|");
  React.useEffect(() => {
    if (!busKeys) return undefined;
    let off = false;
    (async () => {
      const r = await db.from("timeline_progress").select("*").eq("period_ym", PERIOD_YM);
      if (off) return;
      if (r.error) { setSaveMsg("โหลดความคืบหน้าไม่สำเร็จ (ตรวจว่า Deploy Backend/ตาราง timeline_progress แล้ว)"); setLoadedProg(false); return; }
      const rows = Array.isArray(r.data) ? r.data : [];
      rows.forEach((x) => { rowIdRef.current[x.bu] = x.id; });
      setBus((prev) => prev.map((b) => {
        const row = rows.find((x) => x.bu === b.bu);
        const m = row && row.state && typeof row.state === "object" ? mergeProg(b, row.state) : b;
        savedRef.current[b.bu] = JSON.stringify(pickProg(m));
        return m;
      }));
      setSaveMsg("");
      setLoadedProg(true);
    })();
    return () => { off = true; };
  }, [busKeys, userName]);
  React.useEffect(() => {
    if (!loadedProg) return undefined;
    const tm = setTimeout(async () => {
      for (const b of bus) {
        const js = JSON.stringify(pickProg(b));
        if (savedRef.current[b.bu] === js) continue;
        const payload = { state: pickProg(b), updated_by: userName || "", updated_at: new Date().toISOString() };
        let res;
        if (rowIdRef.current[b.bu]) res = await db.from("timeline_progress").update(payload).eq("id", rowIdRef.current[b.bu]);
        else {
          res = await db.from("timeline_progress").insert({ period_ym: PERIOD_YM, bu: b.bu, ...payload });
          if (!res.error) { const q = await db.from("timeline_progress").select("*").eq("period_ym", PERIOD_YM).eq("bu", b.bu); const row = Array.isArray(q.data) ? q.data[0] : null; if (row) rowIdRef.current[b.bu] = row.id; }
        }
        if (res.error) setSaveMsg("บันทึกความคืบหน้าไม่สำเร็จ: " + (res.error.message || res.error));
        else { savedRef.current[b.bu] = js; setSaveMsg(""); }
      }
    }, 600);
    return () => clearTimeout(tm);
  }, [bus, loadedProg, userName]);
  const [filter, setFilter] = React.useState("all"); // all | pending | confirm
  const [tab, setTab] = React.useState("mine"); // mine = งานของฉัน | all = ทั้งหมด (Owner/Admin)
  const tabEff = isAdmin ? tab : "mine";
  const [cur, setCur] = React.useState(-1);
  const rootRef = React.useRef(null);
  // Lobby: ล็อกกล่องแม่ที่เลื่อนได้ (main-scroll ของแอป) ไม่ให้เลื่อนทั้งหน้า -- ให้เลื่อนเฉพาะแถวในตาราง
  React.useEffect(() => {
    if (cur >= 0) return undefined;
    let el = rootRef.current ? rootRef.current.parentElement : null;
    while (el && el !== document.body) {
      if (/(auto|scroll)/.test(window.getComputedStyle(el).overflowY)) break;
      el = el.parentElement;
    }
    if (!el || el === document.body) return undefined;
    const old = el.style.overflowY;
    el.scrollTop = 0;
    el.style.overflowY = "hidden";
    return () => { el.style.overflowY = old; };
  }, [cur]);
  const [hist, setHist] = React.useState([]);
  const who = userName || "คุณ";

  const mutate = (i, fn) => setBus((prev) => { const next = clone(prev); fn(next[i]); return next; });
  const log = (i, text) => setHist((h) => [...h, { id: `${Date.now()}-${h.length}`, i, text: `${who} · ${text}` }]);

  const onTick = (k, n, by) => {
    const u = bus[cur];
    const before = statusOf(u.tasks[k]);
    const nextDone = !u.tasks[k].items[n].done;
    mutate(cur, (x) => { const it = x.tasks[k].items[n]; it.done = nextDone; it.by = nextDone ? `${by || "คุณ"} · 8 ต.ค.` : ""; });
    const afterDone = u.tasks[k].items.filter((it) => !it.off).map((it) => (it === u.tasks[k].items[n] ? nextDone : it.done)).every(Boolean);
    const after = afterDone ? "Y" : "N";
    log(cur, `${k} › ${u.tasks[k].items[n].label}: ${nextDone ? "ติ๊ก" : "ยกเลิกติ๊ก"}${before !== after ? ` (สถานะ ${before} → ${after})` : ""}`);
  };
  // กดช่องขั้นที่ n = ทำเสร็จถึงขั้น n (ขั้นก่อนหน้าติ๊กให้อัตโนมัติ); กดขั้นสุดท้ายที่ทำแล้วซ้ำ = ถอยกลับ 1 ขั้น
  const onStage = (k, n, by) => {
    const items = bus[cur].tasks[k].items;
    const lastDone = items.reduce((a, it, i) => (it.done ? i : a), -1);
    const target = n === lastDone ? n - 1 : n;
    const before = statusOf(bus[cur].tasks[k]);
    mutate(cur, (x) => { x.tasks[k].mode = "auto"; x.tasks[k].nodata = false; x.tasks[k].items.forEach((it, i) => { const d = i <= target; if (d && !it.done) it.by = `${by || "คุณ"} · 8 ต.ค.`; if (!d) it.by = ""; it.done = d; }); });
    const after = target === items.length - 1 ? "Y" : "N";
    log(cur, `${k}: ${target < 0 ? "ล้างความคืบหน้า" : `ทำถึง "${items[target].label}" (${target + 1}/${items.length})`}${before !== after ? ` (สถานะ ${before} → ${after})` : ""}`);
  };
  // Enable/Disable ระดับรายการ (เช่น แพลตฟอร์มที่ BU นี้ไม่มี) -- Disable แล้วไม่นับใน %
  const onItemEnable = (k, n, enabled) => {
    const label = bus[cur].tasks[k].items[n].label;
    const before = statusOf(bus[cur].tasks[k]);
    mutate(cur, (x) => { const it = x.tasks[k].items[n]; it.off = !enabled; if (!enabled) { it.done = false; it.by = ""; } });
    const nextT = clone(bus[cur].tasks[k]); nextT.items[n].off = !enabled; if (!enabled) nextT.items[n].done = false;
    log(cur, `${k} › ${label}: ${enabled ? "Enable" : "Disable"} (สถานะ ${before} → ${statusOf(nextT)})`);
  };
  const onNoData = (k) => {
    const was = !!bus[cur].tasks[k].nodata;
    mutate(cur, (x) => { x.tasks[k].mode = "auto"; x.tasks[k].nodata = !was; if (!was) x.tasks[k].items.forEach((it) => { it.done = false; it.by = ""; }); });
    log(cur, `${k}: ${was ? "ยกเลิก ไม่มีข้อมูล" : "ไม่มีข้อมูล (นับเป็นทำแล้ว)"}`);
  };
  const onStepClear = (k) => {
    const before = statusOf(bus[cur].tasks[k]);
    mutate(cur, (x) => { x.tasks[k].nodata = false; x.tasks[k].items.forEach((it) => { it.done = false; it.by = ""; }); });
    log(cur, `${k}: ล้างความคืบหน้า (สถานะ ${before} → N)`);
  };
  const onVatEnable = (i, on) => {
    mutate(cur, (x) => { const c = x.vat.cards[i]; c.on = on; if (!on) { c.v = ""; c.by = ""; } });
    log(cur, `Closing Vat › ${VAT_CARDS[i].name}: ${on ? "Enable" : "Disable"}`);
  };
  const onVatId = (i, v) => mutate(cur, (x) => { x.vat.cards[i].v = v.replace(/\D/g, ""); });
  const onVatCommit = (i) => {
    const c = bus[cur].vat.cards[i];
    mutate(cur, (x) => { x.vat.cards[i].by = x.vat.cards[i].v ? `${who} · 8 ต.ค.` : ""; });
    if (c.v) log(cur, `Closing Vat › ${VAT_CARDS[i].name}: บันทึก Request ID ${c.v}`);
  };
  const onVatStatus = (sv) => {
    mutate(cur, (x) => {
      if (x.vat.status.s === sv) { x.vat.status.s = ""; x.vat.status.by = ""; if (sv === "O") x.vat.status.claimed = false; return; }
      if (sv === "O") x.vat.status.claimed = true;
      x.vat.status.s = sv; x.vat.status.by = `${who} · 8 ต.ค.`;
    });
    log(cur, `Closing Vat › Transfer Vat Status: ${sv === "O" ? "O · โอน" : "X · ไม่โอน"}`);
  };
  const onReqId = (g, k, v) => mutate(cur, (x) => { const val = v.replace(/\D/g, ""); x.req[g][k] = val; });
  const onReqToggle = (g, k, on) => {
    mutate(cur, (x) => { x.req[g][k] = on ? "" : "X"; });
    log(cur, `Closing Vat › ${g} ${k}: ${on ? "Enable" : "Disable"}`);
  };
  const onRptSet = (side, c, rk, v) => {
    // Enable/Disable ของ First Draft กับ Final Draft ต้อง Sync กัน -- สลับฝั่งไหนก็มีผลทั้งสองฝั่ง (Finish/Pending ไม่ Sync)
    const prev = bus[cur].rpt[side][c][rk];
    const isToggle = v === "X" || (v === "P" && prev === "X");
    mutate(cur, (x) => {
      if (!isToggle) {
        x.rpt[side][c][rk] = v;
        // Finish ที่ Final Draft = Finish First Draft ด้วย (Finish ที่ First Draft ไม่ไป Finish Final)
        // ถอย Final Draft (Finish -> Pending) = ถอย First Draft ด้วย
        if (side === "final" && (v === "D" || v === "P") && x.rpt.first[c][rk] !== "X") x.rpt.first[c][rk] = v;
        return;
      }
      ["first", "final"].forEach((sd) => { const o = x.rpt[sd][c][rk]; x.rpt[sd][c][rk] = v === "X" ? "X" : (o === "X" ? "P" : o); });
    });
    log(cur, `Reconcile Report › ${isToggle ? "First + Final Draft" : side === "first" ? "First Draft" : (v === "D" || v === "P") ? "Final Draft (+ First Draft)" : "Final Draft"} Tax Code ${c} ${rk === "inc" ? "Incomplete" : "Input"}: ${v === "D" ? "Finish" : v === "P" ? (isToggle ? "Enable" : "Pending") : "Disable"}`);
  };
  const onBuClose = () => {
    mutate(cur, (x) => { x.buClosed = true; });
    log(cur, "Confirm Closed");
  };
  // Reset: ล้างเฉพาะค่าที่กรอก/ต้อง Confirm ของ BU นี้ (ติ๊ก Checklist, Request ID, Finish, สถานะโอน Vat, Confirm) -- Enable/Disable (Config) ไม่ล้าง
  const onReset = () => {
    mutate(cur, (x) => { resetValues(x); });
    log(cur, "Reset ค่าที่กรอก (คง Enable/Disable)");
  };
  // Defaults Set: เก็บ Enable/Disable ปัจจุบัน (ค่าที่กรอกถูกล้างในสำเนา) เป็นค่าเริ่มต้นของ BU -- บันทึกลง DB พร้อม state
  const onDefaultsSet = () => {
    mutate(cur, (x) => { const snap = clone(pickProg(x)); delete snap.defaults; resetValues(snap); x.defaults = snap; });
    log(cur, "Defaults Set (บันทึก Enable/Disable เป็นค่าเริ่มต้นของ BU)");
  };
  const onTickAll = (k, val, by) => {
    const before = statusOf(bus[cur].tasks[k]);
    mutate(cur, (x) => { x.tasks[k].items.forEach((it) => { if (it.off) return; it.done = val; it.by = val ? `${by || "คุณ"} · 8 ต.ค.` : ""; }); });
    log(cur, `${k}: ${val ? "ติ๊กทั้งหมด" : "ล้างทั้งหมด"} (สถานะ ${before} → ${val ? "Y" : "N"})`);
  };
  const onMode = (k, v) => {
    const before = statusOf(bus[cur].tasks[k]);
    // Disable = ล้างเช็คลิสต์ที่เลือกไว้ด้วย (Unselect ทุกข้อ)
    mutate(cur, (x) => { x.tasks[k].mode = v; if (v !== "auto") x.tasks[k].items.forEach((it) => { it.done = false; it.by = ""; }); });
    const after = v === "X" ? "X" : v === "D" ? "D" : (bus[cur].tasks[k].items.every((it) => it.done) ? "Y" : "N");
    log(cur, `${k}: ${v === "auto" ? "Enable" : "Disable"} (สถานะ ${before} → ${after})`);
  };
  const onBind = (k, v) => { mutate(cur, (x) => { x.tasks[k].rid = v; }); log(cur, `${k}: ผูก Request ID ${v || "(ยกเลิก)"}`); };
  const onId = (n, v) => mutate(cur, (x) => { x.ids[n] = v; });

  // Active <-> Inactive: กดแล้วสลับทันที (กดซ้ำกลับเป็น Active ได้) ไม่ต้องใส่เหตุผล
  const onToggleScope = (i) => {
    const was = bus[i].inScope;
    mutate(i, (x) => { x.inScope = !was; x.why = was ? "Inactive" : ""; });
    log(i, was ? "ตั้งเป็น Inactive" : "ตั้งเป็น Active");
  };

  return (
    <div ref={rootRef} className="tl-hide-scroll" style={{ padding: "12px 16px", height: "100vh", display: cur < 0 ? "flex" : "block", flexDirection: "column", overflowY: cur < 0 ? "hidden" : "auto", overscrollBehavior: "contain", boxSizing: "border-box", background: "#F4F3EF" }}>
      {saveMsg && <div style={{ flex: "none", marginBottom: 8, padding: "6px 12px", borderRadius: 8, background: "#FCEBEB", color: "#791F1F", fontSize: 12 }}>{saveMsg}</div>}
      {cur < 0 && (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <div>
          <span style={{ fontWeight: 500, fontSize: 18, color: C.navy }}>Timeline ปิดภาษี</span>{" "}
          <span style={{ fontSize: 13, color: "#666" }}>รอบ ก.ย. 2569</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#999" }}>
          {isAdmin && (
            <span style={{ display: "inline-flex", marginRight: 8 }}>
              {[["mine", "งานของฉัน"], ["all", "All User Related Status"]].map(([k, t], n) => (
                <button key={k} type="button" style={{ ...btn, borderRadius: n === 0 ? "6px 0 0 6px" : "0 6px 6px 0", background: tab === k ? C.navy : "#fff", color: tab === k ? "#fff" : "#1f2933", fontWeight: tab === k ? 600 : 400, padding: "0 14px", height: 30, boxSizing: "border-box" }} onClick={() => setTab(k)}>{t}</button>
              ))}
            </span>
          )}
          {isAdmin && tab === "all" && (
            <button type="button" onClick={() => setShowInc(true)} title="เลือก User ที่ต้องการดูใน Tab นี้" style={{ ...btn, height: 30, padding: "0 12px", borderRadius: 8, boxSizing: "border-box", color: C.navy, fontWeight: 600 }}>เลือก User ({(inc || []).length})</button>
          )}
          <span>สถานะ</span>
          <span>
            {[["all", "All"], ["pending", "Pending"], ["confirm", "Confirm"]].map(([k, t], n) => (
              <button key={k} type="button" style={{ ...btn, borderRadius: n === 0 ? "6px 0 0 6px" : n === 2 ? "0 6px 6px 0" : 0, background: filter === k ? "#f1efe8" : "#fff", fontWeight: filter === k ? 600 : 400, color: "#1f2933", height: 30, boxSizing: "border-box" }} onClick={() => setFilter(k)}>{t}</button>
            ))}
          </span>
          <button type="button" aria-label="Config BU" title="Config BU" onClick={() => setShowCfg(true)} style={{ ...btn, width: 30, height: 30, padding: 0, borderRadius: 8, fontSize: 16, color: C.navy }}>⚙</button>
        </div>
      </div>
      )}
      {showInc && <IncludeModal opts={userOpts} sel={inc || []} onSave={saveInc} onClose={() => setShowInc(false)} />}
      {showCfg && <ConfigModal me={userName} isAdmin={isAdmin} who={who} onClose={() => { setShowCfg(false); setReload((n) => n + 1); }} />}

      {cur < 0 ? (
        <>
          {!src.loading && (src.error || !bus.length) && (
            <div style={{ background: "#fff", border: `0.5px solid ${C.border}`, borderRadius: 12, padding: "14px 16px", marginBottom: 10, fontSize: 13, color: "#52606d" }}>
              {src.error ? `ดึงข้อมูล BU ไม่สำเร็จ: ${src.error}` : src.bound ? `ยังไม่มี BU ที่ Prepare By = "${src.bound}" และยังไม่ได้ติ๊กดู Progress BU ใด กด ⚙ Config BU เพื่อเลือก BU` : "ยังไม่ได้ผูกชื่อที่ใช้ตอนทำ VAT กับบัญชีนี้ กด ⚙ Config BU เพื่อผูกชื่อและเลือก BU"}
            </div>
          )}
          <Lobby bus={bus} tab={tabEff} closed={closed} filter={filter} onView={setCur} onToggleScope={onToggleScope} />
        </>
      ) : (
        <BuPage
          u={bus[cur]}
          closed={closed || bus[cur].buClosed}
          history={hist.filter((h) => h.i === cur).slice(-5).reverse()}
          onBack={() => setCur(-1)}
          onTick={onTick}
          onTickAll={onTickAll}
          onStage={onStage}
          onVatEnable={onVatEnable}
          onVatId={onVatId}
          onVatCommit={onVatCommit}
          onVatStatus={onVatStatus}
          onReqId={onReqId}
          onReqToggle={onReqToggle}
          onRptSet={onRptSet}
          onBuClose={onBuClose}
          onReset={onReset}
          onDefaultsSet={onDefaultsSet}
          onNoData={onNoData}
          onStepClear={onStepClear}
          onItemEnable={onItemEnable}
          prepBy={bus[cur].prep || src.bound || "-"}
          onMode={onMode}
          onBind={onBind}
          onId={onId}
          userName={who}
        />
      )}
    </div>
  );
}
