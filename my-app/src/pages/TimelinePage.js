import React from "react";
import { useAuth } from "../contexts/AuthContext";
import { useUserRole } from "../contexts/useUserRole";
import { db } from "../lib/db";
import { broadcastWs } from "../wsManager";
import { confirmDialog } from "../confirmDialog"; // MARKER_TIMELINE_DEFAULTS_CONFIRM_DIALOG_V1
import { useRealtimeRefresh } from "../useRealtimeRefresh"; // MARKER_TIMELINE_REALTIME_PROGRESS_V1
import ReactDOM from "react-dom"; // MARKER_TIMELINE_REQUEST_ID_HISTORY_V1
import { apiFetch } from "../api"; // MARKER_TIMELINE_PERIOD_DEADLINE_FROM_VAT_PERIOD_V1
import VatReconcileSystem from "./VatReconcileSystem"; // MARKER_TIMELINE_UPLOAD_DROP_V1 -- โยนไฟล์ผ่าน Timeline เข้ากระบวนการอัปโหลดปกติ (Scope ตามการ์ด)

// MARKER_TIMELINE_PAGE_PROTOTYPE_V1
// Timeline ปิดภาษี (VAT Controller > Reconcile > Timeline)
// Prototype: ใช้ข้อมูลตัวอย่างใน State (ยังไม่ต่อ Backend) -- ดู Design ที่ project doc claude/tax_close_timeline_design.md
// Lobby (ภาพรวม + % ต่อ BU) -> กด View -> หน้า BU (Request ID + เช็คลิสต์ต่อขั้นตอน + ประวัติ) -> กลับ Lobby

const DEMO_TODAY = 8; // วันที่สมมติสำหรับคำนวณ "เลยกำหนด" ในข้อมูลตัวอย่าง

const CHECKLIST_BY_GROUP = {
  "Special operation": ["Prepare Data", "Verify Amounts", "Record / Submit"], // MARKER_TIMELINE_STEP_BUTTONS_EQUAL_EN_V1
  "Daily": ["Pull Daily Report", "Check Variance", "Close Items"],
  "Popup": ["Review Popup Items", "Pop into System", "Verify After Pop"],
  "รายงาน": ["Request Report (Link Request ID)", "Review Items", "Record Review Result"],
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
// MARKER_TIMELINE_BU_DEFAULT_DISABLED_V1 -- BU ที่ยังไม่เคย Setting/ยังไม่เปิดใช้งานจริง: เริ่มต้น Disable ทุกช่อง (ผู้ใช้ Enable เองทีหลัง) ไม่ใช้ค่าตามตัวอย่าง
function allDisabledTasks() {
  const t = allEnabledTasks();
  Object.keys(t).forEach((k) => { t[k].mode = "X"; });
  return t;
}
const allDisabledReq = () => REQ_GROUPS.reduce((r, g) => ({ ...r, [g]: REQ_KEYS.reduce((o, k) => ({ ...o, [k]: "X" }), {}) }), {});
const allDisabledRpt = () => { const mk = () => RPT_CODES.reduce((r, c) => ({ ...r, [c]: { inc: "X", inp: "X" } }), {}); return { first: mk(), final: mk() }; };
const allDisabledVat = () => makeVat(["X", "X", "X", "X", "X", "X", "X", "X", "X", ""]); // การ์ด Closing Vat 9 ใบ Disable (Transfer Vat Status ไม่มีสวิตช์ Enable)
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
// MARKER_TIMELINE_DEFAULTS_TAXTYPE_SORT_V1 -- กฎ Defaults ตาม Tax Type + Rate
const TAX_CODES = ["A", "N", "T", "F", "M"];
// 'N,T' / 'A,T' / 'All Type' / 'No Type' -> Set ของ Tax Code ที่ใช้ (null = อ่านรูปแบบไม่ออก -> ไม่ใช้กฎ)
function parseTaxTypes(raw) {
  const s = String(raw == null ? "" : raw).trim().toUpperCase().replace(/\s+/g, " ");
  if (!s) return null;
  if (/^ALL( TYPE)?$/.test(s)) return new Set(TAX_CODES);
  if (/^NO( TYPE)?$/.test(s)) return new Set();
  const toks = s.split(/[^A-Z]+/).filter(Boolean);
  if (!toks.length || !toks.every((t) => TAX_CODES.includes(t))) return null;
  return new Set(toks);
}
// vat[i] = true/false/undefined(ไม่แตะ) ตาม VAT_CARDS: 0,1 Daily Average (ต้องมี A) · 2 Suspense N · 3 Suspense T/F · 4 Trial Balance · 5,6 Expense · 7,8 Asset
function defaultsRule(taxRaw, rate) {
  const tt = parseTaxTypes(taxRaw);
  const hasRate = typeof rate === "number" && rate > 0;
  if (!tt && !hasRate) return null; // MARKER_TIMELINE_DEFAULTS_NOTYPE_FALLBACK_V1 -- Tax Type อ่านไม่ได้ แต่มี Rate = ยังตั้งส่วน Rate ให้ (ส่วน Tax Code ไม่แตะ)
  const none = !!tt && tt.size === 0;
  const codes = tt ? TAX_CODES.reduce((o, k) => ({ ...o, [k]: tt.has(k) }), {}) : null;
  const vat = tt ? [tt.has("A"), tt.has("A"), tt.has("N"), tt.has("N") && (tt.has("T") || tt.has("F"))] : [undefined, undefined, undefined, undefined];
  const r100 = typeof rate === "number" && Math.abs(rate - 100) < 1e-9;
  const rLt = typeof rate === "number" && rate > 0 && rate < 100;
  if (none) vat.push(false, false, false, false, false);
  else if (r100) vat.push(true, true, false, true, false); // Rate 100%: Trial Balance เปิด · Expense 100% เปิด · Asset 100% เปิด (AVG ปิด) // MARKER_TIMELINE_DEFAULTS_RATE100_FIX_V1
  else if (rLt) vat.push(true, false, true, false, true); // Rate < 100%: Trial Balance เปิด · Expense AVG เปิด · Asset AVG เปิด (ตัวที่เป็น 100% ปิด)
  else vat.push(undefined, undefined, undefined, undefined, undefined);  // MARKER_TIMELINE_DEFAULTS_RATE_LT100_V1
  return { none, codes, vat };
}
function applyDefaultsRule(x, rule) {
  if (rule.codes) REQ_GROUPS.forEach((g) => {
    const cells = x.req[g];
    TAX_CODES.forEach((k) => { if (!rule.codes[k]) cells[k] = "X"; else if (cells[k] === "X") cells[k] = ""; });
    if (g !== "Input Summary") { if (rule.none) cells.All = "X"; else if (cells.All === "X") cells.All = ""; }
  });
  if (rule.codes) ["first", "final"].forEach((sd) => RPT_CODES.forEach((c) => ["inc", "inp"].forEach((rk) => {
    const cur = x.rpt[sd][c][rk];
    x.rpt[sd][c][rk] = !rule.codes[c] ? "X" : cur === "X" ? "P" : cur; // Final Step: Incomplete และ Input เปิดตาม Tax Type เหมือนกัน /* MARKER_TIMELINE_FINALSTEP_INPUT_BY_TAXTYPE_V1 */
  })));
  rule.vat.forEach((want, i) => {
    if (want === undefined) return;
    const c = x.vat.cards[i];
    c.on = want;
    if (!want) { c.v = ""; c.by = ""; }
  });
}

function mkRealBu(c) {
  const bu = String(c.bu);
  return { code: String(c["COMPANY CODE"] || ""), bu, name: String(c["THAI COMPANY NAME"] || ""), inScope: vatStatusOf(c) === "active", why: VAT_STATUS_LABEL[vatStatusOf(c)] || "", tasks: allDisabledTasks(), ids: ["", "", "", "", "", ""], vat: allDisabledVat(), req: allDisabledReq(), rpt: allDisabledRpt(), /* MARKER_TIMELINE_BU_DEFAULT_DISABLED_V1 */ buClosed: false, prep: String(c["PREPARE BY"] || "").trim(), vatRate: (() => { const v = parseFloat(String(colOf(c, "VAT %") ?? "").replace("%", "")); return Number.isFinite(v) ? v : null; })(), nameEn: String(colOf(c, "ENGLISH COMPANY NAME") || "").trim(), taxType: String(colOf(c, "allowed_tax_type") ?? "").trim() /* MARKER_TIMELINE_DEFAULTS_TAXTYPE_SORT_V1 */ };
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

// MARKER_TIMELINE_REQUEST_ID_HISTORY_V1 -- Popover ประวัติ Request ID (ล่าสุด 5 รายการ) ใช้ซ้ำได้ทุกจุดที่กรอก Request ID
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

// MARKER_TIMELINE_FIRSTDRAFT_NOTES_V1 -- ปุ่ม Note + Popup (History ของ Note ต่อช่อง)
function NoteButton({ items, subtitle, readOnly, onAdd, onDelete }) { // MARKER_TIMELINE_NOTE_DELETE_V1 -- ลบ Note รายตัวได้ (กดถังขยะ -> ยืนยันในแถว)
  const [delIdx, setDelIdx] = React.useState(-1);
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
                <div key={r.at + "|" + n} style={{ padding: "9px 0", borderTop: n ? "1px solid #F0F1F3" : "none", display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: "#222", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{r.text}</div>
                    <div style={{ fontSize: 11, color: "#7b8794", marginTop: 3 }}>{(r.by || "-") + " · " + fmtRidAt(r.at)}</div>
                  </div>
                  {!readOnly && onDelete && (delIdx === n ? (
                    <div style={{ flex: "none", display: "flex", gap: 4, alignItems: "center" }}>
                      <button type="button" onClick={() => { onDelete(n); setDelIdx(-1); }} style={{ height: 24, padding: "0 8px", fontSize: 11, fontWeight: 600, borderRadius: 6, border: "none", background: "#C0392B", color: "#fff", cursor: "pointer" }}>ลบ</button>
                      <button type="button" onClick={() => setDelIdx(-1)} style={{ height: 24, padding: "0 8px", fontSize: 11, borderRadius: 6, border: "1px solid #ddd", background: "#fff", color: "#616e7c", cursor: "pointer" }}>ยกเลิก</button>
                    </div>
                  ) : (
                    <button type="button" title="ลบ Note นี้" onClick={() => setDelIdx(n)} style={{ flex: "none", width: 24, height: 24, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 6, border: "none", background: "transparent", color: "#a0a4aa", cursor: "pointer" }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = "#C0392B"; e.currentTarget.style.background = "#FDECEA"; }} onMouseLeave={(e) => { e.currentTarget.style.color = "#a0a4aa"; e.currentTarget.style.background = "transparent"; }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /></svg>
                    </button>
                  ))}
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
  ["first", "final"].forEach((sd) => { RPT_CODES.forEach((c) => { RPT_REPORTS.forEach(([rk]) => { if (x.rpt[sd][c][rk] === "D" || x.rpt[sd][c][rk] === "ND") x.rpt[sd][c][rk] = "P"; }); }); }); /* MARKER_TIMELINE_RPT_NODATA_V1 */
  x.buClosed = false;
};
// MARKER_TIMELINE_PERIOD_DEADLINE_FROM_VAT_PERIOD_V1 -- Deadline ปิด VAT = 4 วันทำการแรกของเดือนถัดจาก vat_period_month (สูตรเดียวกับ UserManagement > Period Panel; ยังไม่หักวันหยุดนักขัตฤกษ์เหมือนที่นั่น)
const VAT_DEADLINE_BUSINESS_DAYS = 4;
function vatDeadlineOf(ym) {
  const m = /^(\d{4})-(\d{2})/.exec(String(ym || ""));
  if (!m) return null;
  let d = new Date(Number(m[1]), Number(m[2]), 1), cnt = 0;
  while (true) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) { cnt++; if (cnt === VAT_DEADLINE_BUSINESS_DAYS) return new Date(d); }
    d.setDate(d.getDate() + 1);
  }
}
const PERIOD_YM = "2026-09"; // TODO: ดึงรอบ VAT Period จริงจาก Backend
// ส่วนที่เก็บลง DB ต่อ BU (ไม่รวมข้อมูลบริษัทที่ดึงจาก company_list)
const pickProg = (b) => ({ tasks: b.tasks, vat: b.vat, req: b.req, rpt: b.rpt, ids: b.ids, buClosed: b.buClosed, defaults: b.defaults, rhist: b.rhist, rnotes: b.rnotes });
// รวมค่าที่บันทึกไว้กับโครงสร้างปัจจุบัน (เติมเฉพาะ key ที่มีอยู่จริง กันโครงสร้างเปลี่ยนแล้วพัง)
const mergeProg = (b, st) => {
  const out = { ...b };
  if (st.tasks) { out.tasks = { ...b.tasks }; Object.keys(b.tasks).forEach((k) => { if (st.tasks[k] && Array.isArray(st.tasks[k].items) && st.tasks[k].items.length === b.tasks[k].items.length) out.tasks[k] = { ...b.tasks[k], ...st.tasks[k], items: st.tasks[k].items.map((it, n) => (k === "46119" ? it : { ...it, label: b.tasks[k].items[n].label })) }; /* MARKER_TIMELINE_STEP_BUTTONS_EQUAL_EN_V1 */ }); }
  ["vat", "req", "rpt", "ids"].forEach((k) => { if (st[k] && typeof st[k] === "object") out[k] = st[k]; });
  if (st.defaults && typeof st.defaults === "object") out.defaults = st.defaults;
  if (st.rnotes && typeof st.rnotes === "object") out.rnotes = st.rnotes; // MARKER_TIMELINE_FIRSTDRAFT_NOTES_V1
  if (st.rhist && typeof st.rhist === "object") out.rhist = st.rhist; // MARKER_TIMELINE_REQUEST_ID_HISTORY_V1
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

// MARKER_TIMELINE_HEADER_PERIOD_PANEL_V1 -- ข้อมูล Period สำหรับ Header (สูตรเดียวกับ UserManagement > Period Panel)
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
const KPI_ICON = {
  progress: { bg: "#E8EEF5", fg: "#1F3A5F", d: <><path d="M21 12a9 9 0 1 1-9-9" /><path d="M12 3a9 9 0 0 1 9 9h-9z" /></> },
  bu: { bg: "#EAF3DE", fg: "#3B6D11", d: <><path d="M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16" /><path d="M14 10h5a1 1 0 0 1 1 1v10" /><path d="M2 21h20" /><path d="M8 8h2M8 12h2M8 16h2" /></> },
  off: { bg: "#EEEDE6", fg: "#7b8794", d: <><path d="M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16" /><path d="M14 10h5a1 1 0 0 1 1 1v10" /><path d="M2 21h20" /><path d="M3 3l18 18" /></> },
  done: { bg: "#EAF3DE", fg: "#3B6D11", d: <><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.8 2.8L16 9.5" /></> },
  period: { bg: "#EAF3DE", fg: "#3B6D11", d: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /><path d="m9 15.5 2 2 4-4" /></> },
};
function Kpi({ label, value, color, icon, small, bare, divider }) {
  const ic = KPI_ICON[icon];
  return (
    <div style={bare ? { padding: "4px 18px", display: "flex", alignItems: "center", gap: 12, borderLeft: divider ? "1px solid #e6e4dd" : "none" } : { background: "#fff", borderRadius: 12, padding: 12, display: "flex", alignItems: "center", gap: 12 }}>
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
  const t3 = { d: cells.filter((v) => v === "D" || v === "ND").length, n: cells.length };
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
  return a === "X" && b === "X" ? "X" : (a === "D" || a === "ND") && (b === "D" || b === "ND") ? "Y" : "N";
}

// MARKER_TIMELINE_HEADER_PERIOD_PANEL_V1 -- แถบ Period (พื้นขาว ใต้ KPI)
function PeriodPanel({ period, bare }) {
  const box = bare ? { padding: "16px 22px" } : { background: "#fff", borderRadius: 12, padding: "12px 16px", marginBottom: 12, flexShrink: 0 };
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
          <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>Timeline Closed Vat</div>
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
      {!closedP && (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 6, fontSize: 12, color: "#7b8794" }}>
          <span>{`เริ่มรอบ ${period.startDate.getDate()} ${TH_MONTH[period.startDate.getMonth()]}`}</span>
          <span>{`วันนี้ ${new Date().getDate()} ${TH_MONTH[new Date().getMonth()]} · ครบกำหนด ${period.deadline.getDate()} ${TH_MONTH[period.deadline.getMonth()]}`}</span>
        </div>
      )}
    </div>
  );
}
function Lobby({ bus, tab, closed, filter, onView, onToggleScope, period, toolbar }) {
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
      {/* MARKER_TIMELINE_SINGLE_CARD_V1 -- การ์ดใบเดียว: Timeline + KPI + ฟิลเตอร์ */}
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

function BuPage({ u, closed, onBack, onTick, onTickAll, onStage, onNoData, onStepClear, onMode, onItemEnable, onVatEnable, onVatId, onVatCommit, onVatStatus, onReqId, onReqToggle, onVatPick, onReqCommit, onReqPick, onRptSet, onRptNote, onRptNoteDel, onBuClose, onReset, onDefaultsSet, userName, prepBy, reconPeriod, onGoRecon, onRidDone }) {
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
  // MARKER_TIMELINE_GO_RECON_V1 -- ปุ่ม "ไป Reconcile": กดแล้วไปหน้า Input Vat Rec. พร้อมเลือก Period / BU / Account ให้ -- กดได้เมื่อการ์ด Enable และมีข้อมูลใน DB จริง (ดึงจาก /vat-reconcile/dashboard/status)
  const [rst, setRst] = React.useState([]);
  const [dbOk, setDbOk] = React.useState(false); // true เมื่อดึงสถานะจาก DB สำเร็จแล้วเท่านั้น (กันเคลียร์ Request ID ผิดตอนโหลดไม่ได้)
  React.useEffect(() => {
    const rp = reconPeriod; // งวดปัจจุบันของ Timeline (ตามหัวหน้า) -- ไม่มี = ไม่ตรวจ
    if (!rp) { setRst([]); setDbOk(false); return; }
    let dead = false;
    const token = sessionStorage.getItem("fastapn_token");
    const base = process.env.REACT_APP_API_URL || "http://10.101.87.126:4000/api";
    fetch(`${base}/vat-reconcile/dashboard/status?period=${encodeURIComponent(rp)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.json().catch(() => ({})))
      .then((d) => { if (!dead) { setRst(Array.isArray(d.rows) ? d.rows : []); setDbOk(Array.isArray(d.rows)); } })
      .catch(() => { if (!dead) { setRst([]); setDbOk(false); } });
    return () => { dead = true; };
  }, [reconPeriod, u.bu, files]);
  const curP = reconPeriod || "";
  // ตรวจข้อมูลจริงใน DB (BU + Account + ชนิดข้อมูล) ของงวดปัจจุบัน -> ใช้ทั้งขึ้นข้อความบนการ์ดและเปิดปุ่ม Goto
  const dbHit = (kind, group, tt) => {
    if (kind === "none") return null;
    const has = (r) => (kind === "tb" ? r.tb_active : kind === "s100" ? r.simple_100_active : kind === "savg" ? r.simple_avg_active : r.input_summary_active);
    // tt = Tax Type ของการ์ด Input Summary (N/A/F/T/M) -> ถ้า Backend ส่ง tax_types มา ต้องมี Tax Type นั้นจริงในข้อมูล (MARKER_TIMELINE_STATUS_TAX_TYPES_V1)
    const ttOk = (r) => !tt || !Array.isArray(r.tax_types) || !r.tax_types.length || r.tax_types.includes(tt);
    return rst.filter((r) => r.label === u.bu && (!group || r.group === group || r.account === group) && ttOk(r)).find(has) || null; // group = Expense | Asset | เลข Account (เช่น 11610751 ของการ์ด M)
  };
  const dbLine = (kind, group, tt) => { const h = dbHit(kind, group, tt); return h ? `มีข้อมูลในระบบ · งวด ${curP}${h.ready ? " · พร้อม Reconcile" : ""}` : null; };
  React.useEffect(() => { // MARKER_TIMELINE_RID_CLEAR_ON_DATA_V1 -- ตรวจข้อมูลปัจจุบันใน DB: การ์ดไหนมีข้อมูลแล้ว แต่ยังมี Request ID ค้างในช่อง -> เก็บลง History แล้วเคลียร์ช่อง
    if (!dbOk || closed || !onRidDone || !curP) return;
    for (let i = 4; i <= 8; i++) {
      const cd = u.vat && u.vat.cards ? u.vat.cards[i] : null;
      if (cd && cd.on && cd.v && dbHit(i === 4 ? "tb" : (i === 5 || i === 7) ? "s100" : "savg", i === 4 ? null : i <= 6 ? "Expense" : "Asset")) onRidDone(i);
    }
    ["N", "T", "A", "F", "M"].forEach((k) => {
      const v = u.req && u.req["Input Summary"] ? u.req["Input Summary"][k] : "";
      if (v && v !== "X" && dbHit("is", k === "N" || k === "A" ? "Expense" : k === "F" || k === "T" ? "Asset" : "11610751", k)) onRidDone("S" + k);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rst, dbOk]);
  const reconBtn = (kind, group, on, tt) => {
    const row = dbHit(kind, group, tt);
    if (kind === "tb") { // TB = บอกสถานะเท่านั้น (จุดเขียว = มีข้อมูลในระบบ / จุดแดง = ยังไม่มี) ไม่มีปุ่ม Goto
      const ok = !!on && !!row;
      return <span title={!on ? "การ์ดนี้ Disable" : ok ? "มีข้อมูล TB ในระบบ (งวดปัจจุบัน)" : "ยังไม่มีข้อมูล TB ในระบบ (งวดปัจจุบัน)"} aria-label={ok ? "มีข้อมูล" : "ไม่มีข้อมูล"} style={{ marginLeft: "auto", flex: "none", width: 12, height: 12, borderRadius: "50%", background: !on ? "#C9C6BA" : ok ? "#3B6D11" : "#CF222E", boxShadow: "0 0 0 3px " + (!on ? "#C9C6BA33" : ok ? "#3B6D1133" : "#CF222E33"), alignSelf: "center", marginRight: 8 }} />;
    }
    const can = !!on && !!row && !!curP && !!onGoRecon;
    const tip = !on ? "การ์ดนี้ Disable" : kind === "none" ? "ยังไม่รองรับการ์ดนี้" : !row ? "ยังไม่มีข้อมูลในระบบ (งวดปัจจุบัน)" : "ไปหน้า Reconcile (เลือก Period / BU / Account ให้)";
    return (
      <button type="button" disabled={!can} title={tip} aria-label="ไป Reconcile"
        onClick={() => can && onGoRecon({ period: curP, bu: u.bu, account: row.account })}
        style={{ marginLeft: "auto", flex: "none", width: 28, height: 28, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 8, cursor: can ? "pointer" : "not-allowed", border: can ? "1px solid #3B6D11" : "1px solid #D9D6CB", background: can ? "#3B6D11" : "#F1F0EB", color: can ? "#fff" : "#b5b8bd" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
      </button>
    );
  };
  // MARKER_TIMELINE_UPLOAD_DROP_V1 -- ลากไฟล์วาง/เลือกไฟล์ที่ปุ่ม Upload File ของการ์ด TB / Simple / Input Summary -> เข้ากระบวนการอัปโหลดปกติ (Preview > Confirm > Commit) โดยรู้ Report Type จากการ์ด
  const [upl, setUpl] = React.useState(null); // { key, file, scope:{ type, simple?, label } }
  const UPL_SCOPE = { 4: { type: "tb", label: "Trial Balance" }, 5: { type: "simple", simple: "100", label: "Expense 100%" }, 6: { type: "simple", simple: "avg", label: "Expense AVG" }, 7: { type: "simple", simple: "100", label: "Asset 100%" }, 8: { type: "simple", simple: "avg", label: "Asset AVG" } };
  const uplFileRef = React.useRef(null);
  // ดักประเภทไฟล์ก่อนเข้ากระบวนการ: แต่ละการ์ด (Template) รับเฉพาะนามสกุล/ชื่อไฟล์ที่กำหนด
  const checkAccept = (file, scope) => {
    const name = String((file && file.name) || "");
    const ext = (name.split(".").pop() || "").toLowerCase();
    if (scope.type === "simple") {
      if (ext !== "xlsx") return `${scope.label} รับเฉพาะไฟล์ .xlsx (Simple Report) — ไฟล์ที่โยนเป็น .${ext || "?"}`;
      const m = /Simple[ _]+Report[ _]+Vat[ _]+(100|AVG)/i.exec(name);
      if (!m) return `ชื่อไฟล์ไม่ใช่ Simple Report (ต้องมี Simple_Report_Vat_100 หรือ Simple_Report_Vat_AVG) — ${name}`;
      if (scope.simple && m[1].toLowerCase() !== String(scope.simple).toLowerCase()) return `ไฟล์นี้เป็น Simple ${m[1].toUpperCase()} แต่ช่อง ${scope.label} รับเฉพาะ Simple ${String(scope.simple).toUpperCase() === "100" ? "100%" : "AVG"}`;
      return "";
    }
    if (!["out", "txt", "tsv", "xlsx"].includes(ext)) return `${scope.label} รับเฉพาะไฟล์ .out / .txt / .xlsx (หรือ Paste text) — ไฟล์ที่โยนเป็น .${ext || "?"}`;
    return "";
  };
  const UPL_HINT = { tb: "TB: ไฟล์ดิบ .out จาก GLCRC064 (หรือ .xlsx ที่ตัดแล้ว)", input_summary: "Input Summary: ไฟล์ดิบ .out จาก APCRC201 (หรือ .xlsx ที่ Confirm แล้ว)", simple: "Simple: ไฟล์ .xlsx ชื่อมี Simple_Report_Vat_100 หรือ _AVG" };
  const openUplPopup = (key, scope) => { if (closed || !scope) return; setUpl({ key, scope, file: null, tab: "file", err: "" }); };
  const openUpl = (key, file, scope) => { if (closed || !file || !scope) return; const err = checkAccept(file, scope); setUpl(err ? { key, scope, file: null, tab: "file", err } : { key, scope, file, tab: "file", err: "" }); };
  const uplDnD = (key, scope) => ({
    onDragOver: (e) => { if (!closed) e.preventDefault(); },
    onDrop: (e) => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) openUpl(key, f, scope); },
    // วางข้อความที่ Copy จาก Excel / Notepad (Ctrl+V) -- ชี้เมาส์ที่ปุ่มแล้ว Ctrl+V | ใช้ Logic เดียวกับ Paste ในหน้า Upload File
    tabIndex: 0,
    onMouseEnter: (e) => { try { if (!closed) e.currentTarget.focus({ preventScroll: true }); } catch (_) {} },
    onPaste: (e) => {
      if (closed) return;
      const text = e.clipboardData && e.clipboardData.getData ? e.clipboardData.getData("text/plain") : "";
      const cf = e.clipboardData && e.clipboardData.files && e.clipboardData.files[0];
      if (text && text.trim()) {
        e.preventDefault();
        const isTsv = text.includes("\t");
        openUpl(key, new File([new Blob([text], { type: "text/plain" })], isTsv ? "pasted-excel.tsv" : "pasted-data.out", { type: "text/plain" }), scope);
      } else if (cf) { e.preventDefault(); openUpl(key, cf, scope); }
    },
  });
  // Reset ต้องยืนยันด้วยรหัส 6 หลัก (สุ่มโชว์ + พิมพ์ยืนยัน) รูปแบบเดียวกับ Setup Rule ใน IEController
  const [rstCode, setRstCode] = React.useState("");
  const [rstInput, setRstInput] = React.useState("");
  const [rstErr, setRstErr] = React.useState(false);
  const askReset = () => { setRstInput(""); setRstErr(false); setRstCode(String(Math.floor(100000 + Math.random() * 900000))); };
  const closeReset = () => { setRstCode(""); setRstInput(""); setRstErr(false); };
  const rstBtnRef = React.useRef(null); // MARKER_TIMELINE_RESET_AUTOFOCUS_CONFIRM_V1
  const rstOk = !!rstCode && rstInput === rstCode;
  React.useEffect(() => { if (rstOk && rstBtnRef.current) rstBtnRef.current.focus(); }, [rstOk]); // กรอกรหัสถูก -> โฟกัสปุ่มยืนยัน
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
  // MARKER_TIMELINE_DEFAULTS_TAXTYPE_SORT_V1 -- Enable ขึ้นก่อน (Stable) ภายใน Box ตัวเอง · คำนวณใหม่เฉพาะตอนเปิดหน้า BU / กด Defaults Set (ไม่วิ่งตามตอนกดสวิตช์)
  const [sortVer, setSortVer] = React.useState(0);
  const order = React.useMemo(() => {
    const onFirst = (arr, isOn) => [...arr].sort((a, b) => (isOn(a) ? 0 : 1) - (isOn(b) ? 0 : 1));
    const rptOn = (c) => ["first", "final"].some((sd) => ["inc", "inp"].some((rk) => u.rpt[sd][c][rk] !== "X"));
    return {
      daily: onFirst([0, 1, 2, 3], (i) => u.vat.cards[i].on),
      simple: onFirst([5, 7, 6, 8], (i) => u.vat.cards[i].on), // 100% คู่กัน (Expense 100%, Asset 100%) แล้วตามด้วย AVG คู่กัน // MARKER_TIMELINE_SIMPLE_PAIR_ORDER_V1
      sum: onFirst(["A", "N", "T", "F", "M"], (k) => u.req["Input Summary"][k] !== "X"),
      req: ["All", ...onFirst(REQ_KEYS.filter((k) => k !== "All"), (k) => u.req.Incomplete[k] !== "X" || u.req["Input Reconcile"][k] !== "X")],
      rpt: onFirst(RPT_CODES, rptOn),
    };
  }, [sortVer, u.bu]); // eslint-disable-line react-hooks/exhaustive-deps
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
                    {i >= 4 && reconBtn(i === 4 ? "tb" : (i === 5 || i === 7) ? "s100" : "savg", i === 4 ? null : i <= 6 ? "Expense" : "Asset", c.on)}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: ink, minHeight: 36 }}>{VAT_CARDS[i].name}</div>
                  <EnableToggle full on={c.on} disabled={closed} onChange={(v) => onVatEnable(i, v)} />
                  {c.on ? (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
<input
                        value={c.v}
                        inputMode="numeric"
                        placeholder="Request ID"
                        disabled={closed}
                        onChange={(e) => onVatId(i, e.target.value)}
                        onBlur={() => onVatCommit(i)}
                        style={{ flex: "1 1 0%", minWidth: 0, boxSizing: "border-box", height: 38, fontSize: 14, textAlign: "center", borderRadius: 9, padding: "0 6px", border: filled ? "1px solid #CFE5B0" : "1px solid #ccc", background: filled ? "#EEF6E4" : "#fff", color: filled ? "#27500A" : "#222", fontWeight: filled ? 600 : 400 }}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                      />
<RidHistory items={(u.rhist || {})[`vat:${i}`]} current={c.v} disabled={closed} onPick={(v) => onVatPick(i, v)} />
</div>
                      <div style={{ fontSize: 11, color: "#7b8794", textAlign: "center" }}>{filled && c.by ? c.by : "ยังไม่ได้กรอก"}</div>
                      {i >= 4 && (
                        <div role="button" onClick={() => openUplPopup(i, UPL_SCOPE[i])} {...uplDnD(i, UPL_SCOPE[i])} title="คลิกเพื่อเปิดหน้าอัปโหลด (โยนไฟล์ / วาง Text) · ลากไฟล์มาวางที่ปุ่มได้เลย" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 34, borderRadius: 9, border: files[i] ? "1px solid #CFE5B0" : "1px dashed #1a3a5c", background: files[i] ? "#EEF6E4" : "#F7F9FC", color: files[i] ? "#27500A" : "#1a3a5c", fontSize: 12, fontWeight: 600, cursor: closed ? "default" : "pointer", overflow: "hidden", padding: "0 8px", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                                                    {files[i] ? files[i].name : "Upload File"}
                        </div>
                      )}
                      {i >= 4 && (
                        (() => { const dl = files[i] ? null : dbLine(i === 4 ? "tb" : (i === 5 || i === 7) ? "s100" : "savg", i === 4 ? null : i <= 6 ? "Expense" : "Asset"); return <div style={{ fontSize: 11, color: dl ? "#3B6D11" : "#7b8794", fontWeight: dl ? 600 : 400, textAlign: "center" }}>{files[i] ? `อัปโหลด ${files[i].at} · ${files[i].by}` : (dl || "ยังไม่ได้อัปโหลด")}</div>; })()
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
            {order.req.map((k) => {
              const v = cells[k];
              const off = v === "X";
              const filled = !off && v !== "";
              return (
                <div key={k}>
                  <div style={{ marginBottom: 3 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#616e7c" }}>{k}</span>
                  </div>
                  {off ? (
                    <button type="button" disabled={closed} title="คลิกเพื่อ Enable" onClick={() => onReqToggle(g, k, true)} style={{ width: "100%", height: 38, borderRadius: 9, border: "1px solid #F5C4C4", background: "#FCEBEB", color: "#791F1F", fontWeight: 600, fontSize: 13, cursor: closed ? "default" : "pointer" }}>X</button>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>{/* MARKER_TIMELINE_REQID_X_INSIDE_HISTORY_SIDE_V1 -- ✕ (Disable) อยู่ใน Input ด้านขวา / ไอคอนประวัติอยู่ข้าง Input เหมือน Input Summary */}
                      <div style={{ position: "relative", flex: "1 1 0%", minWidth: 0 }}>
                    <input
                        value={v}
                        inputMode="numeric"
                        placeholder="Request ID"
                        disabled={closed}
                        onChange={(e) => onReqId(g, k, e.target.value)}
                        onBlur={() => onReqCommit(g, k)}
                        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                        style={{ width: "100%", boxSizing: "border-box", height: 38, fontSize: 13, textAlign: "center", borderRadius: 9, padding: "0 22px", border: filled ? "1px solid #CFE5B0" : "1px solid #ccc", background: filled ? "#EEF6E4" : "#fff", color: filled ? "#27500A" : "#222", fontWeight: filled ? 600 : 400 }}
                      />
                        {!closed && <button type="button" title="Disable" onClick={() => onReqToggle(g, k, false)} style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", width: 18, height: 18, padding: 0, border: "none", borderRadius: 4, background: "transparent", color: "#8a8a85", cursor: "pointer", fontSize: 12, lineHeight: 1 }}>✕</button>}
                      </div>
                      <RidHistory items={(u.rhist || {})[`req:${g}:${k}`]} current={v} disabled={closed} onPick={(val) => onReqPick(g, k, val)} />
                    </div>
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
        {order.rpt.map((c) => (
          <React.Fragment key={c}>
            <span style={{ fontSize: 14, fontWeight: 600, color: ink }}>Tax Code {c}</span>
            {RPT_REPORTS.map(([rk]) => {
              const v = u.rpt[side][c][rk];
              const on = v !== "X";
              const fin = v === "D";
              const nod = v === "ND"; // MARKER_TIMELINE_RPT_NODATA_V1
              return (
                <div key={rk} style={{ display: "flex", flexDirection: "column", gap: 5, background: "#fff", border: "1px solid #E3E5EA", borderRadius: 10, padding: 6, opacity: on ? 1 : 0.8 }}>
                  {side === "first" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ flex: 1, minWidth: 0 }}><EnableToggle full on={on} disabled={closed} onChange={(e) => onRptSet(side, c, rk, e ? "P" : "X")} /></div>
                      <NoteButton items={(u.rnotes || {})[`first:${c}:${rk}`]} subtitle={`First Draft · Tax Code ${c} · ${rk === "inc" ? "Incomplete" : "Input"}`} readOnly={closed} onAdd={(t) => onRptNote(c, rk, t)} onDelete={(i) => onRptNoteDel(c, rk, i)} />
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ flex: 1, minWidth: 0 }}><EnableToggle full on={on} disabled={closed} onChange={(e) => onRptSet(side, c, rk, e ? "P" : "X")} /></div>
                      <button type="button" disabled={closed || !on} title={nod ? "No Data (กดอีกครั้งเพื่อยกเลิก)" : "ตั้งเป็น No Data"} onClick={() => onRptSet(side, c, rk, nod ? "P" : "ND")} style={{ flex: "none", width: 30, height: 30, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: closed || !on ? "default" : "pointer", opacity: on ? 1 : 0.45, borderRadius: 8, border: "1px solid " + (nod ? "#7A1F2B" : "#D9D6CB"), background: nod ? "#7A1F2B" : "#fff", color: nod ? "#fff" : "#8a8a85" }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" /><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /><path d="M3 3l18 18" /></svg>
                      </button>
                    </div>
                  )}
                  {on ? (
                    <button type="button" disabled={closed} title="คลิกเพื่อสลับ Pending / Finish" onClick={() => onRptSet(side, c, rk, fin || nod ? "P" : "D")} style={{ height: 34, borderRadius: 8, border: "1px solid " + (nod ? "#7A1F2B" : fin ? "#C0DD97" : "#FAC775"), background: nod ? "#7A1F2B" : fin ? "#EAF3DE" : "#FAEEDA", color: nod ? "#fff" : fin ? "#27500A" : "#633806", fontSize: 13, fontWeight: 600, cursor: closed ? "default" : "pointer" }}>{nod ? "✓ No Data" : fin ? "Finish" : "Pending"}</button>
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
            {reconBtn("is", k === "N" || k === "A" ? "Expense" : k === "F" || k === "T" ? "Asset" : "11610751", on, k)}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: ink, minHeight: 36 }}>Input Summary - {k}</div>
          <EnableToggle full on={on} disabled={closed} onChange={(e) => onReqToggle("Input Summary", k, e)} />
          {on ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
<input
              value={v}
              inputMode="numeric"
              placeholder="Request ID"
              disabled={closed}
              onChange={(e) => onReqId("Input Summary", k, e.target.value)}
 onBlur={() => onReqCommit("Input Summary", k)}
              style={{ flex: "1 1 0%", minWidth: 0, boxSizing: "border-box", height: 38, fontSize: 14, textAlign: "center", borderRadius: 9, padding: "0 6px", border: filled ? "1px solid #CFE5B0" : "1px solid #ccc", background: filled ? "#EEF6E4" : "#fff", color: filled ? "#27500A" : "#222", fontWeight: filled ? 600 : 400 }}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            />
<RidHistory items={(u.rhist || {})[`req:Input Summary:${k}`]} current={v} disabled={closed} onPick={(v) => onReqPick("Input Summary", k, v)} />
</div>
          ) : (
            <div style={{ height: 38, borderRadius: 9, border: "1px dashed #C9C8C0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#7b8794" }}>ไม่ใช้ในรอบนี้</div>
          )}
          {on && <div style={{ fontSize: 11, color: "#7b8794", textAlign: "center" }}>{filled ? "บันทึกแล้ว" : "ยังไม่ได้กรอก"}</div>}
          {on && (
            <div role="button" onClick={() => openUplPopup("S" + k, { type: "input_summary", taxType: k, label: "Input Summary - " + k })} {...uplDnD("S" + k, { type: "input_summary", taxType: k, label: "Input Summary - " + k })} title="คลิกเพื่อเปิดหน้าอัปโหลด (โยนไฟล์ / วาง Text) · ลากไฟล์มาวางที่ปุ่มได้เลย" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 34, borderRadius: 9, border: files["S" + k] ? "1px solid #CFE5B0" : "1px dashed #1a3a5c", background: files["S" + k] ? "#EEF6E4" : "#F7F9FC", color: files["S" + k] ? "#27500A" : "#1a3a5c", fontSize: 12, fontWeight: 600, cursor: closed ? "default" : "pointer", overflow: "hidden", padding: "0 8px", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                            {files["S" + k] ? files["S" + k].name : "Upload File"}
            </div>
          )}
          {on && (() => { const dl = files["S" + k] ? null : dbLine("is", k === "N" || k === "A" ? "Expense" : k === "F" || k === "T" ? "Asset" : "11610751", k); return <div style={{ fontSize: 11, color: dl ? "#3B6D11" : "#7b8794", fontWeight: dl ? 600 : 400, textAlign: "center" }}>{files["S" + k] ? `อัปโหลด ${files["S" + k].at} · ${files["S" + k].by}` : (dl || "ยังไม่ได้อัปโหลด")}</div>; })()}
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
            {/* MARKER_TIMELINE_REMOVE_DUE_BADGE_V1 -- ตัดป้าย "ครบ N ต.ค." ออกจากแถว Step 1 */}
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
                    flex: "1 1 0%", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "0 8px", height: 38, fontSize: 13, borderRadius: 10, cursor: closed ? "default" : t.nodata ? "not-allowed" : "pointer", opacity: t.nodata ? 0.45 : 1,
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
            <div aria-hidden="true" style={{ flex: "none", alignSelf: "center", width: 1, height: 28, background: "#C9C8C0", margin: "0 2px" }} />
            <button
              type="button"
              disabled={closed}
              title="This BU has no data for this item (counts as done). Click again to undo"
              onClick={() => onNoData(k)}
              style={{ flex: "1 1 0%", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "0 8px", height: 38, fontSize: 13, borderRadius: 10, cursor: closed ? "default" : "pointer", border: t.nodata ? "1px solid #7A1F2B" : "1px solid #E3E5EA", background: t.nodata ? "#7A1F2B" : "#FAFAFB" /* MARKER_TIMELINE_NODATA_MAROON_V1 */, color: t.nodata ? "#fff" : "#7b8794", fontWeight: t.nodata ? 600 : 400, transition: "all .15s" }}
            >
              {t.nodata ? "✓ " : ""}No Data
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
  // MARKER_TIMELINE_BU_ESC_BACK_V1 -- กด ESC = กลับ Lobby (ข้ามถ้ากำลังพิมพ์ในช่อง หรือมี Popup/Modal เปิดอยู่)
  React.useEffect(() => {
    const onEsc = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = e.target;
      const tag = el && el.tagName ? el.tagName.toUpperCase() : "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el && el.isContentEditable)) return;
      if (document.querySelector('[data-rid-pop], [style*="inset: 0"]')) return;
      onBack();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onBack]);

  return (
    <div>
      {/* MARKER_TIMELINE_BU_HEADER_ENLARGE_V1 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, flexWrap: "wrap", padding: `${16 - stickyTop}px 20px 16px`, borderRadius: 0, background: "#F4F3EF", border: "none", marginTop: stickyTop, marginBottom: 14, position: "sticky", top: stickyTop, zIndex: 20 }} ref={hdrRef}>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 32 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
          <button type="button" style={{ ...btn, height: 34, padding: "0 14px", borderRadius: 8, fontSize: 13 }} onClick={onBack}>← กลับ Lobby</button>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 36, fontWeight: 600, color: C.navy }}>{u.bu}</span>
          </div>
          <span style={{ fontSize: 14, color: ink }}>{u.name}</span>
          {u.nameEn ? <span style={{ fontSize: 12, color: "#616e7c", marginTop: -4 }}>{u.nameEn}</span> : null}
          {closed && !u.buClosed && <Pill bg={C.N.bg} fg={C.N.fg}>Period ปิดแล้ว อ่านอย่างเดียว</Pill>}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 14px 6px 8px", borderRadius: 12, background: "#fff", border: "1px solid #E3E5EA", marginTop: 2 }}>
            <span style={{ width: 30, height: 30, borderRadius: "50%", background: "#E8EEF5", color: C.navy, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>{initials}</span>
            <span style={{ lineHeight: 1.25 }}>
              <span style={{ display: "block", fontSize: 10, color: "#7b8794" }}>Prepare by</span>
              <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: ink }}>{prepBy}</span>
            </span>
          </div>
        </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }} title="Rate ใช้สิทธิ์ (VAT %) ของ BU นี้">
            <div style={{ width: 116, height: 116, borderRadius: "50%", background: `conic-gradient(#1F3A5F ${((typeof u.vatRate === "number") ? Math.max(0, Math.min(100, u.vatRate)) : 0) * 3.6}deg, #D9D6CB 0deg)`, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
              <div style={{ width: 92, height: 92, borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <b style={{ fontSize: 24, fontWeight: 700, color: C.navy }}>{(typeof u.vatRate === "number") ? `${u.vatRate}%` : "-"}</b>
              </div>
            </div>
            <span style={{ fontSize: 12, color: "#616e7c" }}>Rate ใช้สิทธิ์</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 24 }}>
          {/* Reset + Confirm อยู่ด้านซ้ายของวงกลม % — Confirm ใช้เปลี่ยน Status ใน Lobby จาก Pending เป็น Confirm (ไม่เกี่ยวกับ Period) */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 8, width: 170 }}>
            {!closed && (
              <button type="button" title="บันทึก Enable/Disable ปัจจุบันของ BU นี้เป็นค่าเริ่มต้น (เก็บลง DB)" onClick={async () => { if (await onDefaultsSet()) setSortVer((v) => v + 1); }} style={{ ...btn, height: 40, width: "100%", padding: 0, fontSize: 14, fontWeight: 600, borderRadius: 8, boxSizing: "border-box", background: "#F4F9EC", color: "#3B6D11", border: "1px solid #D9E8C3" }}>Defaults Set</button>
            )}
            {!closed && (
              <button type="button" title="ล้างค่าที่กรอก/ติ๊ก/Finish/Confirm ของ BU นี้ (Enable/Disable ไม่ถูกล้าง) ต้องยืนยันด้วยรหัส 6 หลัก" onClick={askReset} style={{ ...btn, height: 40, width: "100%", padding: 0, fontSize: 14, fontWeight: 600, borderRadius: 8, boxSizing: "border-box", background: "#FEF8F0", color: "#B3691B", border: "1px solid #F7E3C8" }}>Reset</button>
            )}
            {u.buClosed ? (
              <span style={{ height: 40, width: "100%", boxSizing: "border-box", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 600, borderRadius: 8, background: "#EAF3DE", color: "#27500A", border: "1px solid #C0DD97" }}>✓ Confirm</span>
            ) : (
              <button type="button" disabled={!buReady} title={buReady ? "ยืนยัน BU นี้" : "ต้องครบ 100% ก่อน"} onClick={onBuClose} style={{ border: "none", borderRadius: 8, height: 40, width: "100%", padding: 0, boxSizing: "border-box", fontSize: 14, fontWeight: 600, cursor: buReady ? "pointer" : "not-allowed", background: buReady ? C.navy : "#D9D6CB", color: buReady ? "#fff" : "#7b8794" }}>Confirm</button>
            )}
          </div>
          <div style={{ width: 116, height: 116, borderRadius: "50%", background: `conic-gradient(#3B6D11 ${(overallPct || 0) * 3.6}deg, #D9D6CB 0deg)`, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
            <div style={{ width: 92, height: 92, borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <b style={{ fontSize: 26, fontWeight: 700, color: C.navy }}>{overallPct === null ? "—" : `${overallPct}%`}</b>
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
          {order.daily.map(renderVatCard)}

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
              {order.simple.map(renderVatCard)}
            </div>
          </div>
        </div>
        <div style={{ background: "#F4F3EF" }}>
          <div style={{ padding: "14px 16px 0", fontSize: 12, fontWeight: 600, letterSpacing: 0.4, color: "#534AB7" }}>INPUT SUMMARY</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 12, padding: "10px 16px 16px" }}>
            {order.sum.map(renderSumCard)}
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

      {upl && ReactDOM.createPortal( // MARKER_TIMELINE_UPLOAD_DROP_V1 -- Popup อัปโหลด: แท็บ "โยนไฟล์" (ลากวาง/คลิกเปิด Browser) | "วาง Text" -- ดักชนิดไฟล์ตามการ์ด (Template) ก่อนเข้ากระบวนการอัปโหลดปกติ
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(15,23,42,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 12, width: upl.file ? "min(1280px, 96vw)" : "min(900px, 96vw)", minHeight: upl.file ? undefined : "min(560px, 80vh)", maxHeight: "94vh", overflow: "auto", boxShadow: "0 16px 48px rgba(0,0,0,.3)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderBottom: "1px solid #E3E5EA", position: "sticky", top: 0, background: "#fff", zIndex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.navy }}>Upload · {upl.scope.label} · BU {u.bu}</div>
              <button type="button" onClick={() => setUpl(null)} style={{ border: "1px solid #d0d7de", background: "#fff", borderRadius: 6, padding: "4px 12px", fontSize: 13, cursor: "pointer" }}>ปิด</button>
            </div>
            {!upl.file ? (
              <div style={{ padding: 16 }}>
                <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                  {[["file", "โยนไฟล์"], ["text", "วาง Text"]].map(([k2, t2]) => (
                    <button key={k2} type="button" onClick={() => setUpl((d) => ({ ...d, tab: k2, err: "" }))} style={{ padding: "6px 16px", fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: "pointer", border: upl.tab === k2 ? "1px solid #27500A" : "1px solid #d0d7de", background: upl.tab === k2 ? "#EAF3DE" : "#fff", color: upl.tab === k2 ? "#27500A" : "#57606a" }}>{t2}</button>
                  ))}
                </div>
                {upl.tab === "file" ? (
                  <div
                    role="button" tabIndex={0}
                    onClick={() => uplFileRef.current && uplFileRef.current.click()}
                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.background = "#EEF6E4"; }}
                    onDragLeave={(e) => { e.currentTarget.style.background = "#F7F9FC"; }}
                    onDrop={(e) => { e.preventDefault(); e.currentTarget.style.background = "#F7F9FC"; const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) openUpl(upl.key, f, upl.scope); }}
                    style={{ border: "2px dashed #1a3a5c", borderRadius: 12, background: "#F7F9FC", padding: "120px 16px", textAlign: "center", cursor: "pointer", color: C.navy }}
                  >
                    <div style={{ fontSize: 15, fontWeight: 600 }}>ลากไฟล์มาวางที่นี่</div>
                    <div style={{ fontSize: 12.5, color: "#57606a", marginTop: 4 }}>หรือคลิกเพื่อเลือกไฟล์จากเครื่อง (Browse)</div>
                    <input ref={uplFileRef} type="file" style={{ display: "none" }} onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) openUpl(upl.key, f, upl.scope); }} />
                  </div>
                ) : upl.scope.type === "simple" ? (
                  <div style={{ border: "1px dashed #C9C8C0", borderRadius: 10, padding: "28px 16px", textAlign: "center", fontSize: 13, color: "#7b8794" }}>Simple Report เป็นไฟล์ .xlsx — ไม่รองรับการวาง Text ให้ใช้แท็บ "โยนไฟล์"</div>
                ) : (
                  <textarea
                    autoFocus rows={16}
                    placeholder="วางข้อมูลที่ Copy จาก Excel / Notepad ที่นี่ (Ctrl+V) — ระบบตรวจรูปแบบและแสดง Preview ให้อัตโนมัติ"
                    onPaste={(e) => { const t = e.clipboardData && e.clipboardData.getData ? e.clipboardData.getData("text/plain") : ""; if (t && t.trim()) { e.preventDefault(); const isTsv = t.includes("\t"); openUpl(upl.key, new File([new Blob([t], { type: "text/plain" })], isTsv ? "pasted-excel.tsv" : "pasted-data.out", { type: "text/plain" }), upl.scope); } }}
                    style={{ width: "100%", boxSizing: "border-box", fontSize: 13, padding: 10, border: "1px solid #d0d7de", borderRadius: 8, resize: "vertical", fontFamily: "monospace" }}
                  />
                )}
                <div style={{ fontSize: 11.5, color: "#7b8794", marginTop: 8 }}>ช่องนี้รับ: {UPL_HINT[upl.scope.type]}</div>
                {upl.err && <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: "#FCEBEB", color: "#791F1F", fontSize: 12.5 }}>{upl.err}</div>}
              </div>
            ) : (
              <div style={{ padding: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, fontSize: 12.5, color: "#57606a" }}>
                  <span>ไฟล์: <b>{upl.file.name}</b></span>
                  <button type="button" onClick={() => setUpl((d) => ({ ...d, file: null, err: "" }))} style={{ border: "1px solid #d0d7de", background: "#fff", borderRadius: 6, padding: "2px 10px", fontSize: 12, cursor: "pointer" }}>เปลี่ยนไฟล์</button>
                </div>
                <VatReconcileSystem
                  key={upl.file.name + "|" + upl.file.size + "|" + upl.file.lastModified}
                  initialFile={upl.file}
                  expectedType={upl.scope.type}
                  expectedSimple={upl.scope.simple || null}
                  expectedBu={u.bu}
                  expectedBuNum={String(u.code || "").split("-")[3] || null}
                  expectedLabel={upl.scope.label}
                  expectedTaxType={["N", "A", "F", "T", "M"].includes(String(upl.scope.taxType || "").toUpperCase()) ? upl.scope.taxType : null}
                  onCommitSuccess={() => { setFiles((p) => ({ ...p, [upl.key]: { name: upl.file.name, at: stampNow(), by: userName || "คุณ" } })); if (onRidDone) onRidDone(upl.key); }}
                />
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
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
              <button type="button" ref={rstBtnRef} onClick={confirmReset} disabled={rstInput.length !== 6} style={{ flex: 1, height: 36, background: rstInput.length === 6 ? C.navy : "#ccc", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, cursor: rstInput.length === 6 ? "pointer" : "default", outline: "none", boxShadow: rstOk ? "0 0 0 3px rgba(26,58,92,0.28)" : "none" }}>ยืนยัน</button>
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

// MARKER_TIMELINE_CONNECT_POPUP_V1 -- Popup Connect: ซ้าย = ชื่อ Prepare By (VAT Setting) · ขวา = ผู้ใช้ที่มีสิทธิ์ VAT · กด Connect แล้วบันทึก user_roles.vat_prepare_name ลง DB ทันที (เฉพาะ Admin/Owner)
function ConnectModal({ users, names, nameCount, initialUid, onClose, onDone }) {
  const [selName, setSelName] = React.useState("");
  const [selUid, setSelUid] = React.useState(initialUid || "");
  const [qn, setQn] = React.useState("");
  const [qu, setQu] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [err, setErr] = React.useState("");
  const low = (v) => String(v || "").trim().toLowerCase();
  const nameOf = (x) => String(x.vat_prepare_name || "").trim();
  const uLabel = (x) => x.username || x.email || "";
  const holderOf = (n) => users.find((x) => low(nameOf(x)) === low(n));
  const selUser = users.find((x) => String(x.id) === selUid);
  const nameHolder = selName ? holderOf(selName) : null;
  const conflict = nameHolder && selUser && String(nameHolder.id) !== String(selUser.id) ? nameHolder : null;
  const replacing = !!(selUser && nameOf(selUser) && selName && low(nameOf(selUser)) !== low(selName));
  const same = !!(selUser && selName && low(nameOf(selUser)) === low(selName));
  const ready = !!(selUser && selName) && !same && !busy && !done;
  React.useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  const write = async (id, val) => {
    const r = await db.from("user_roles").update({ vat_prepare_name: val }).eq("id", id);
    if (r.error) throw new Error(r.error.message || String(r.error));
  };
  const connect = async () => {
    if (!ready) return;
    setBusy(true); setErr("");
    try {
      if (conflict) await write(conflict.id, "");
      await write(selUser.id, selName);
      setDone(true);
      onDone({ uid: String(selUser.id), name: selName, clearedId: conflict ? String(conflict.id) : null });
      setTimeout(onClose, 700);
    } catch (e) { setErr("Connect ไม่สำเร็จ: " + (e && e.message ? e.message : String(e))); setBusy(false); }
  };
  const disconnect = async () => {
    if (!selUser || !nameOf(selUser) || busy) return;
    setBusy(true); setErr("");
    try { await write(selUser.id, ""); onDone({ uid: String(selUser.id), name: "", clearedId: null }); setSelName(""); }
    catch (e) { setErr("ยกเลิกการผูกไม่สำเร็จ: " + (e && e.message ? e.message : String(e))); }
    setBusy(false);
  };
  const nl = names.filter((n) => !qn.trim() || low(n).includes(low(qn)));
  const ul = users.filter((x) => !qu.trim() || low(`${uLabel(x)} ${nameOf(x)}`).includes(low(qu)));
  const head = { padding: "8px 12px", background: "#F4F3EF", fontSize: 12, fontWeight: 600, color: "#616e7c" };
  const search = { height: 30, margin: "8px 10px", border: "0.5px solid #ccc", borderRadius: 8, padding: "0 10px", fontSize: 12, boxSizing: "border-box", width: "calc(100% - 20px)" };
  const item = (on) => ({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "7px 12px", fontSize: 13, cursor: "pointer", borderTop: "0.5px solid #EEF0F3", background: on ? "#E3EEFB" : "#fff", fontWeight: on ? 600 : 400, color: "#1f2933" });
  return ReactDOM.createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 100001, background: "rgba(15,30,50,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: 720, maxWidth: "96vw", maxHeight: "90vh", background: "#fff", borderRadius: 14, boxShadow: "0 12px 40px rgba(15,30,50,0.28)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", background: "#EEF2F7", borderBottom: "2px solid " + C.navy, fontWeight: 700, color: C.navy, fontSize: 15 }}>
          Connect · ผูกผู้ใช้ ⇄ ชื่อ Prepare By
          <button type="button" onClick={onClose} aria-label="ปิด" style={{ marginLeft: "auto", border: "none", background: "transparent", fontSize: 16, cursor: "pointer", color: "#616e7c" }}>✕</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: 14, minHeight: 0 }}>
          {[
            ["ชื่อ Prepare By (VAT Setting)", qn, setQn, "ค้นหาชื่อ", nl.map((n) => { const h = holderOf(n); return (
              <div key={n} onClick={() => { setSelName(n); setErr(""); }} style={item(n === selName)}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n}</span>
                {h ? <span style={{ fontSize: 11, color: "#27500A", whiteSpace: "nowrap" }}>⇄ {uLabel(h)}</span> : <span style={{ fontSize: 11, color: "#8a8a85", whiteSpace: "nowrap" }}>{nameCount(n)} BU</span>}
              </div>); }), nl.length === 0 ? "ไม่พบชื่อ" : ""],
            ["ผู้ใช้ที่มีสิทธิ์ VAT", qu, setQu, "ค้นหาผู้ใช้", ul.map((x) => (
              <div key={x.id} onClick={() => { setSelUid(String(x.id)); setErr(""); }} style={item(String(x.id) === selUid)}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{uLabel(x)}</span>
                {nameOf(x) ? <span style={{ fontSize: 11, color: "#27500A", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 170 }}>⇄ {nameOf(x)}</span> : <span style={{ fontSize: 11, color: "#8a8a85" }}>ยังไม่ Connect</span>}
              </div>)), ul.length === 0 ? "ไม่พบผู้ใช้ที่มีสิทธิ์ VAT" : ""],
          ].map(([title, qv, setQv, ph, list, empty]) => (
            <div key={title} style={{ border: "0.5px solid #E3E5EA", borderRadius: 10, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div style={head}>{title}</div>
              <input value={qv} onChange={(e) => setQv(e.target.value)} placeholder={ph} style={search} />
              <div style={{ height: 300, overflowY: "auto" }}>{list}{empty && <div style={{ padding: 12, fontSize: 12, color: "#8a8a85" }}>{empty}</div>}</div>
            </div>
          ))}
        </div>
        <div style={{ padding: "10px 16px", background: "#F4F3EF", borderTop: "0.5px solid #E3E5EA", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, fontSize: 12, color: "#616e7c", minWidth: 0 }}>
            {err ? <span style={{ color: "#B42318" }}>{err}</span>
              : selUser && selName ? (
                <span>
                  <b style={{ color: C.navy }}>{uLabel(selUser)} ⇄ {selName}</b>
                  {same ? " · ผูกกันอยู่แล้ว" : ""}
                  {conflict ? <span style={{ color: "#B54708" }}> · ชื่อนี้ผูกกับ {uLabel(conflict)} อยู่ จะย้ายมาผูกกับ {uLabel(selUser)}</span> : ""}
                  {replacing ? <span style={{ color: "#B54708" }}> · เดิม {uLabel(selUser)} ผูกกับ "{nameOf(selUser)}" จะถูกแทนที่</span> : ""}
                </span>
              ) : "เลือกชื่อทางซ้าย และผู้ใช้ทางขวา แล้วกด Connect (บันทึกลงฐานข้อมูลทันที)"}
          </div>
          {selUser && nameOf(selUser) ? <button type="button" disabled={busy} onClick={disconnect} style={{ ...btn, borderRadius: 8, padding: "6px 12px", color: "#B42318", borderColor: "#F1B8B0" }}>ยกเลิกการผูก {uLabel(selUser)}</button> : null}
          <button type="button" disabled={!ready && !done} onClick={connect} style={{ ...btn, borderRadius: 8, padding: "6px 18px", border: "none", fontWeight: 600, background: done ? "#3B6D11" : ready ? C.navy : "#D9D6CB", color: done || ready ? "#fff" : "#7b8794", cursor: ready ? "pointer" : "default" }}>{done ? "Connected ✓" : busy ? "กำลังบันทึก…" : "Connect"}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ConfigModal({ me, isAdmin, who, onClose }) {
  const [users, setUsers] = React.useState([]);
  const [companies, setCompanies] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState("");
  const [uid, setUid] = React.useState("");
  const [q, setQ] = React.useState("");
  const [own, setOwn] = React.useState({});
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState("");
  const [ctx, setCtx] = React.useState(null);
  const [ud, setUd] = React.useState(false);
  const [cn, setCn] = React.useState(false); // MARKER_TIMELINE_CONNECT_POPUP_V1

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
      if (mine) setUid(String(mine.id));
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
  const pickUser = (id) => { setUid(id); setOwn({}); setMsg(""); };
  const nm = user ? String(user.vat_prepare_name || "").trim() : ""; // MARKER_TIMELINE_CONNECT_POPUP_V1 -- ชื่อมาจากการ Connect เท่านั้น (แก้ไม่ได้จากหน้านี้ ไม่มีการเด้งสลับผู้ใช้/ชื่อ)
  const nameCount = (n) => companies.filter((c) => String(c["PREPARE BY"] || "").trim().toLowerCase() === String(n).toLowerCase()).length;
  const onConnected = (r) => {
    setUsers((l) => l.map((x) => (String(x.id) === String(r.clearedId) ? { ...x, vat_prepare_name: "" } : String(x.id) === r.uid ? { ...x, vat_prepare_name: r.name } : x)));
    if (r.name) { setUid(r.uid); setOwn({}); }
    setMsg(r.name ? "Connect แล้ว (บันทึกลงฐานข้อมูลแล้ว)" : "ยกเลิกการผูกแล้ว");
    broadcastWs("company_list_updated", { action: "update" });
  };
  const holder = (c) => (c["PREPARE BY"] || "").trim();
  const isMine = (c) => nm && holder(c).toLowerCase() === nm.toLowerCase();
  const locked = (c) => !isMine(c) && holder(c) !== "" && !isAdmin;
  const rows = companies.filter((c) => !q.trim() || `${c.bu} ${c["THAI COMPANY NAME"] || ""} ${c["COMPANY CODE"] || ""} ${c["TAX ID"] || ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  const picked = companies.filter((c) => own[c.id] && !isMine(c));
  const released = companies.filter((c) => isMine(c) && own[c.id] === false);
  const canSave = picked.length > 0 || released.length > 0 || watchDirty;

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
    if (!nm && !watchDirty) { setMsg("ต้อง Connect ผู้ใช้กับชื่อ Prepare By ก่อน"); return; }
    setSaving(true); setMsg("");
    let done = 0; const skipped = [];
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
    setMsg([`บันทึก Prepare By แล้ว ${done} BU`, watchMsg, skipped.length ? `ข้าม ${skipped.length} BU (${skipped.join(", ")})` : ""].filter(Boolean).join(" · "));
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
              <div style={{ display: "grid", gridTemplateColumns: isAdmin ? "150px 190px 1fr" : "190px 1fr", gap: 10, alignItems: "end" }}>
                {isAdmin && <div>
                  <div style={lbl}>ผูกผู้ใช้ ⇄ ชื่อ VAT</div>
                  <button type="button" onClick={() => setCn(true)} title="เลือกชื่อ Prepare By กับผู้ใช้ แล้วกด Connect" style={{ ...inp, fontWeight: 600, cursor: "pointer", border: nm ? "1px solid #C0DD97" : "1px solid " + C.navy, background: nm ? "#EAF3DE" : "#fff", color: nm ? "#27500A" : C.navy }}>{nm ? "✓ Connected" : "Connect"}</button>
                </div>} {/* MARKER_TIMELINE_CONNECT_ADMIN_ONLY_V1 -- ปุ่ม Connect เห็นเฉพาะ Admin/Owner */}
                <div>
                  <div style={lbl}>ผู้ใช้</div>
                  <div style={{ position: "relative" }}>
                    <button type="button" disabled={!isAdmin} onClick={() => setUd((v) => !v)} onBlur={() => setTimeout(() => setUd(false), 120)} style={{ ...inp, display: "flex", alignItems: "center", justifyContent: "space-between", textAlign: "left", cursor: isAdmin ? "pointer" : "default", color: "#1f2933" }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user ? `${user.username || user.email}${isMeUser(user) ? " (ฉัน)" : ""}` : "— เลือกผู้ใช้ —"}</span>
                      {isAdmin ? <span style={{ fontSize: 10, color: "#616e7c" }}>▾</span> : null}
                    </button>
                    {ud && isAdmin && (
                      <div style={{ position: "absolute", left: 0, right: 0, top: 38, zIndex: 6, background: "#fff", border: "0.5px solid #ccc", borderRadius: 8, boxShadow: "0 6px 18px rgba(0,0,0,.14)", maxHeight: 170, overflowY: "auto" }}>
                        {vatUsers.map((x) => (
                          <div key={x.id} onMouseDown={() => { pickUser(String(x.id)); setUd(false); }} style={{ height: 34, boxSizing: "border-box", padding: "0 10px", display: "flex", alignItems: "center", fontSize: 13, cursor: "pointer", background: String(x.id) === uid ? "#EEF2F7" : "#fff" }} onMouseEnter={(e) => { e.currentTarget.style.background = "#EEF2F7"; }} onMouseLeave={(e) => { e.currentTarget.style.background = String(x.id) === uid ? "#EEF2F7" : "#fff"; }}><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.username || x.email}{isMeUser(x) ? " (ฉัน)" : ""}</span><span style={{ marginLeft: "auto", paddingLeft: 8, fontSize: 11, color: String(x.vat_prepare_name || "").trim() ? "#27500A" : "#B54708", whiteSpace: "nowrap" }}>{String(x.vat_prepare_name || "").trim() ? "✓" : "ยังไม่ Connect"}</span></div>
                        ))}
                        {!vatUsers.length && <div style={{ padding: 10, fontSize: 12, color: "#8a8a85" }}>ไม่พบผู้ใช้ที่มีสิทธิ์ VAT</div>}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <div style={lbl}>ชื่อที่ใช้ตอนทำ VAT (Prepare By)</div>
                  <div style={{ ...inp, display: "flex", alignItems: "center", background: "#F4F3EF", color: nm ? "#1f2933" : "#8a8a85", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{nm || "— ยังไม่ได้ Connect —"}</div>
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
          <button type="button" disabled={saving || loading || !canSave} style={{ ...btn, borderRadius: 8, padding: "6px 14px", border: "none", background: saving || !canSave ? "#D9D6CB" : C.navy, color: saving || !canSave ? "#7b8794" : "#fff" }} onClick={save}>{saving ? "กำลังบันทึก…" : "บันทึก"}</button>
        </div>
      </div>
      {isAdmin && cn && <ConnectModal users={vatUsers} names={names} nameCount={nameCount} initialUid={uid} onClose={() => setCn(false)} onDone={onConnected} />}
    </div>
  );
}

// MARKER_TIMELINE_EMAIL_REPORT_V1 -- ปุ่ม Email Report: เปิด Outlook Draft พร้อมตารางสถานะ (Final Draft > Incomplete) · My Job = เฉพาะ BU ของฉัน (ไม่มีคอลัมน์ Prepare by, จำค่าไว้ที่ user_roles.timeline_mail_cfg) · All Job = ทุก BU ที่ Viewer เห็น (มี Prepare by, ไม่บันทึกค่า)
const MAIL_DEFAULT = { to: "FAST TAX Staff Group", cc: "FAST TAX Manager; FAST APN Vat Controller; FAST AP Non Merchandise Manager; FASTAPN Mailbox", greeting: "เรียน เจ้าหน้าที่ Tax", name: "" };
const MAIL_TAX_GROUPS = [["11610752", ["N", "A"]], ["11610755", ["T", "F"]]];
const MAIL_MAX_URL = 28000; // เพดานความยาวลิงก์ fastapn:// (คำสั่ง Windows ~32,000 ตัวอักษร เผื่อไว้)
const MAIL_DRIVER_KEY = "fastapn_driver_status"; // ใช้ Key เดียวกับหน้า VAT Controller
const mailEsc = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const MAIL_LABEL = { X: "X", P: "Pending", D: "Finished", ND: "No Data" };
// Code ในเมลใช้เฉพาะส่วน Com (ส่วนที่ 3 ของ COMPANY CODE เช่น 1-32-3218- -> 3218) ไม่เอา Segment
const mailCom = (code) => { const p = String(code || "").split("-").map((x) => x.trim()); return p.length >= 3 && p[2] ? p[2] : String(code || "").trim(); };
function mailRowHtml(u, withPrep) {
  const f = (u.rpt && u.rpt.final) || {};
  const vals = MAIL_TAX_GROUPS.flatMap(([, cs]) => cs.map((c) => { const raw = f[c] && f[c].inc; return raw === "X" || raw === "D" || raw === "ND" ? raw : "P"; }));
  const done = !vals.includes("P");
  const allX = vals.every((v) => v === "X"); // ทั้ง 4 ช่องเป็น X = ไม่มีงานให้ทำ -> No Detail (สีเทา) ไม่ใช่ Completed
  const rate = u.vatRate == null ? "" : String(Math.round(u.vatRate * 100) / 100);
  return "<tr><td>" + mailEsc(mailCom(u.code)) + "</td><td>" + mailEsc(u.bu) + "</td><td align=left>" + mailEsc(u.name) + "</td>" + (withPrep ? "<td>" + mailEsc(u.prep) + "</td>" : "") + "<td>" + rate + "</td>" + vals.map((v) => "<td>" + MAIL_LABEL[v] + "</td>").join("") + "<td class=" + (allX ? "n>No Detail" : done ? "g>Completed" : "r>Not Complete") + "</td></tr>";
}
function mailBodyHtml(rows, withPrep, cfg, ymText) {
  const ncol = 9 + (withPrep ? 1 : 0);
  const style = "<style>table{border-collapse:collapse;font-family:Tahoma,Arial,sans-serif;font-size:12px;text-align:center}td,th{border:1px solid #bfbfbf;padding:3px 6px}th{background:#1f1f1f;color:#fff;font-weight:bold}.g{background:#C6EFCE;color:#1F3864;font-weight:bold}.r{background:#FFC7CE;color:#9C0006;font-weight:bold}.n{background:#E5E7EB;color:#52606d;font-weight:bold}</style>";
  const head = "<tr><th colspan=" + ncol + ">Information display for responsible persons</th></tr><tr><th rowspan=2>Code</th><th rowspan=2>Brand</th><th rowspan=2>Company Name</th>" + (withPrep ? "<th rowspan=2>Prepare by</th>" : "") + "<th rowspan=2>(%)</th>" + MAIL_TAX_GROUPS.map(([id]) => "<th colspan=2>" + id + "</th>").join("") + "<th rowspan=2>Status</th></tr><tr>" + MAIL_TAX_GROUPS.flatMap(([, cs]) => cs.map((c) => "<th width=75>" + c + "</th>")).join("") + "</tr>";
  return style + "<p>" + mailEsc(cfg.greeting) + "<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;ขอแจ้งปิดภาษีซื้อ ประจำเดือน " + ymText + "</p><table>" + head + rows.map((u) => mailRowHtml(u, withPrep)).join("") + "</table><p style=font-size:12px>Finished = ทำแล้ว | Pending = ยังไม่ทำ | No Data = ไม่มีข้อมูล | X = Out of Scope<br>Status: Completed = ไม่มีช่อง Pending เหลือ | Not Complete = ยังมี Pending อย่างน้อย 1 ช่อง | No Detail = ทุกช่องเป็น X</p><p>" + mailEsc(cfg.name) + "</p>";
}
function mailUrlOf(m) {
  const token = sessionStorage.getItem("fastapn_token");
  const apiBase = (process.env.REACT_APP_API_URL || "http://10.101.87.126:4000/api").replace(/\/api$/, "");
  const params = [
    "to=" + encodeURIComponent(String(m.to || "").trim()),
    String(m.cc || "").trim() ? "cc=" + encodeURIComponent(String(m.cc).trim()) : null,
    "subject=" + encodeURIComponent(m.subject || ""),
    "body=" + encodeURIComponent(m.bodyText || ""),
    "bodyHtml=" + encodeURIComponent(m.bodyHtml || ""),
    "attachIds=", "attachNames=",
    "token=" + encodeURIComponent(token || ""),
    "apiBase=" + encodeURIComponent(apiBase),
    "sendMode=draft",
  ].filter(Boolean).join("&");
  return "fastapn://" + params;
}
// แบ่ง BU เป็นจำนวนฉบับน้อยที่สุดที่ทุกฉบับยาวไม่เกินเพดาน (แบ่งเท่าๆ กัน) -- พอใส่ฉบับเดียวก็ไม่แบ่ง ไม่ใส่เลข (i/N)
function planMailDrafts(rows, withPrep, cfg, ymText) {
  const subj = "แจ้งปิดภาษีซื้อ ประจำเดือน " + ymText;
  const build = (list, i, k) => {
    const m = { to: cfg.to, cc: cfg.cc, subject: k > 1 ? subj + " (" + (i + 1) + "/" + k + ")" : subj, bodyText: String(cfg.greeting || "") + " ขอแจ้งปิดภาษีซื้อ ประจำเดือน " + ymText, bodyHtml: mailBodyHtml(list, withPrep, cfg, ymText) };
    return { subject: m.subject, count: list.length, first: list[0], last: list[list.length - 1], html: m.bodyHtml, url: mailUrlOf(m) };
  };
  const n = rows.length;
  for (let k = 1; k <= n; k++) {
    const base = Math.floor(n / k), extra = n % k;
    const out = []; let at = 0;
    for (let i = 0; i < k; i++) { const sz = base + (i < extra ? 1 : 0); out.push(build(rows.slice(at, at + sz), i, k)); at += sz; }
    if (k === n || out.every((d) => d.url.length <= MAIL_MAX_URL)) return out.map((d, i) => ({ ...d, from: out.slice(0, i).reduce((s, x) => s + x.count, 0) + 1 }));
  }
  return [];
}
function EmailReportModal({ bus, tab, period, userName, onClose }) {
  const withPrep = tab === "all";
  const rows = React.useMemo(() => bus.filter((u) => u.inScope && (withPrep || u.mine)), [bus, withPrep]);
  const [cfg, setCfg] = React.useState({ ...MAIL_DEFAULT, name: userName || "" });
  const [loaded, setLoaded] = React.useState(false);
  const [msg, setMsg] = React.useState("");
  const meRef = React.useRef(null);
  const savedRef = React.useRef("");
  React.useEffect(() => {
    let off = false;
    (async () => {
      const r = await db.from("user_roles").select("*");
      if (off) return;
      const list = Array.isArray(r && r.data) ? r.data : [];
      const me = list.find((x) => (x.username || "").toLowerCase() === String(userName || "").toLowerCase()) || null;
      meRef.current = me;
      let c = me ? me.timeline_mail_cfg : null;
      if (typeof c === "string") { try { c = JSON.parse(c); } catch (e) { c = null; } }
      const next = { ...MAIL_DEFAULT, name: (me && String(me.vat_prepare_name || "").trim()) || userName || "", ...(c && typeof c === "object" ? c : {}) };
      savedRef.current = JSON.stringify(c && typeof c === "object" ? next : null);
      setCfg(next); setLoaded(true);
    })();
    return () => { off = true; };
  }, [userName]);
  React.useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  const ymText = (() => { /* เดือนในเมล = รอบเดียวกับที่หัว Timeline แสดง (period.periodYm) */ const m = /^(\d{4})-(\d{2})/.exec(String((period && (period.periodYm || period.month)) || PERIOD_YM)); return m ? m[2] + "." + m[1] : String(PERIOD_YM); })();
  const drafts = React.useMemo(() => (loaded ? planMailDrafts(rows, withPrep, cfg, ymText) : []), [loaded, rows, withPrep, cfg, ymText]);
  const driver = (() => { try { return window.localStorage.getItem(MAIL_DRIVER_KEY); } catch (e) { return null; } })();
  const launch = (url, detect) => {
    if (detect) {
      let handled = false;
      const t = setTimeout(() => { if (!handled) { try { window.localStorage.setItem(MAIL_DRIVER_KEY, "missing"); } catch (e) { /* no-op */ } setMsg("เปิด Outlook ไม่สำเร็จ -- เครื่องนี้ยังไม่ได้ติดตั้งตัวช่วย fastapn:// (ดูคู่มือติดตั้งในหน้า Batch Control)"); } }, 1500);
      window.addEventListener("blur", function onBlur() { handled = true; clearTimeout(t); try { window.localStorage.setItem(MAIL_DRIVER_KEY, "ok"); } catch (e) { /* no-op */ } window.removeEventListener("blur", onBlur); }, { once: true });
    }
    window.location.href = url;
  };
  const saveCfg = async () => {
    if (withPrep || !meRef.current) return; // All Job ไม่บันทึกค่า
    const js = JSON.stringify(cfg);
    if (js === savedRef.current) return;
    const r = await db.from("user_roles").update({ timeline_mail_cfg: { to: cfg.to, cc: cfg.cc, greeting: cfg.greeting, name: cfg.name } }).eq("id", meRef.current.id);
    if (r && r.error) setMsg("บันทึกค่าเมลไม่สำเร็จ (ตรวจว่าเพิ่มคอลัมน์ timeline_mail_cfg และ Deploy Backend แล้ว): " + (r.error.message || r.error));
    else savedRef.current = js;
  };
  const openAll = () => {
    if (!drafts.length) return;
    setMsg("");
    saveCfg();
    drafts.forEach((d, i) => setTimeout(() => launch(d.url, i === 0), i * 2500));
  };
  const input = { height: 32, border: "0.5px solid #ccc", borderRadius: 8, padding: "0 10px", fontSize: 13, width: "100%", boxSizing: "border-box" };
  const fixed = { background: "#F4F3EF", border: "0.5px solid #E3E5EA", borderRadius: 8, padding: "8px 10px", color: "#1f2933", fontSize: 13 };
  const rowS = { display: "grid", gridTemplateColumns: "110px 1fr", gap: 8, alignItems: "center", marginBottom: 8 };
  const lab = { fontSize: 12, color: "#616e7c" };
  const tag = { display: "inline-block", fontSize: 10, padding: "1px 6px", borderRadius: 8, background: "#EAF3DE", color: "#27500A", marginLeft: 6 };
  const set = (k) => (e) => setCfg((c) => ({ ...c, [k]: e.target.value }));
  const sample = rows.slice(0, 3);
  const previewHtml = "<html><body style='margin:6px;font-family:Tahoma,Arial,sans-serif;font-size:13px'>" + mailBodyHtml(sample, withPrep, cfg, ymText) + "</body></html>";
  return ReactDOM.createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 100001, background: "rgba(15,30,50,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: 860, maxWidth: "96vw", maxHeight: "92vh", background: "#fff", borderRadius: 14, boxShadow: "0 12px 40px rgba(15,30,50,0.28)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", background: "#EEF2F7", borderBottom: "2px solid " + C.navy, fontWeight: 700, color: C.navy, fontSize: 15 }}>
          Email Report · แจ้งปิดภาษีซื้อ
          <button type="button" onClick={onClose} aria-label="ปิด" style={{ marginLeft: "auto", border: "none", background: "transparent", fontSize: 16, cursor: "pointer", color: "#616e7c" }}>✕</button>
        </div>
        <div style={{ padding: "14px 16px", overflowY: "auto" }}>
          <div style={rowS}><label style={lab}>ขอบเขตข้อมูล</label><div style={fixed}>{withPrep ? "All Job — ทุก BU ที่ Viewer เห็น" : "My Job — เฉพาะ BU ของฉัน"} ({rows.length} BU)</div></div>
          <div style={rowS}><label style={lab}>To</label><input style={input} value={cfg.to} onChange={set("to")} /></div>
          <div style={rowS}><label style={lab}>Cc</label><input style={input} value={cfg.cc} onChange={set("cc")} /></div>
          <div style={rowS}><label style={lab}>หัวเรื่อง</label><div style={fixed}>แจ้งปิดภาษีซื้อ ประจำเดือน {ymText}<span style={tag}>อัตโนมัติ จากรอบ VAT</span></div></div>
          <div style={rowS}><label style={lab}>Greeting</label><input style={input} value={cfg.greeting} onChange={set("greeting")} /></div>
          <div style={rowS}><label style={lab}>Name (ท้ายเมล)</label><input style={input} value={cfg.name} onChange={set("name")} /></div>
          <div style={rowS}><label style={lab}>Body</label><div style={fixed}>ขอแจ้งปิดภาษีซื้อ ประจำเดือน {ymText}<span style={tag}>Fix</span> — แล้วตามด้วยตารางที่ดึงจากระบบอัตโนมัติ</div></div>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.navy, margin: "12px 0 6px" }}>ตารางด้านล่าง ดึงอะไรบ้าง (Fix — แก้ไม่ได้)</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <tbody>
              {[
                ["Code · Brand · Company Name", "Company List (VAT Setting)"],
                ...(withPrep ? [["Prepare by (เฉพาะ All Job)", "Company List › Prepare By"]] : []),
                ["(%)", "VAT Rate ของ BU จาก Company List"],
                ["11610752 (N, A) · 11610755 (T, F)", "Timeline › Final Draft › Incomplete ของแต่ละ Tax Code — Finished / Pending / No Data / X (Out of Scope)"],
                ["Status", "Completed = ไม่มีช่อง Pending เหลือ · Not Complete = ยังมี Pending · No Detail = ทั้ง 4 ช่องเป็น X (สีเทา)"],
              ].map(([a, b]) => (<tr key={a}><td style={{ borderTop: "0.5px solid #E3E5EA", padding: "5px 8px", width: "38%" }}>{a}</td><td style={{ borderTop: "0.5px solid #E3E5EA", padding: "5px 8px", color: "#52606d" }}>{b}</td></tr>))}
            </tbody>
          </table>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.navy, margin: "12px 0 6px" }}>ตัวอย่างเนื้อเมล (แสดง 3 BU แรก)</div>
          <iframe title="ตัวอย่างเนื้อเมล" sandbox="" srcDoc={previewHtml} style={{ width: "100%", height: 250, border: "0.5px solid #E3E5EA", borderRadius: 8, background: "#fff" }} />
          {drafts.length > 1 && (
            <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "#FFF8E5", border: "0.5px solid #F0D58A", fontSize: 12, color: "#7a4b00" }}>
              ข้อมูลยาวเกินใส่ในเมลเดียว จึงแบ่งเป็น {drafts.length} Draft (ผู้รับจะได้หลายเมล):
              {drafts.map((d, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <span style={{ flex: 1 }}>{d.subject} — {d.count} BU (ลำดับที่ {d.from}–{d.from + d.count - 1})</span>
                  <button type="button" onClick={() => { setMsg(""); launch(d.url, false); }} style={{ ...btn, height: 26, padding: "0 10px" }}>เปิดเฉพาะฉบับนี้</button>
                </div>
              ))}
            </div>
          )}
          {(msg || driver === "missing") && <div style={{ marginTop: 10, fontSize: 12, color: "#B42318" }}>{msg || "เครื่องนี้ยังไม่ได้ติดตั้งตัวช่วย fastapn:// (ดูคู่มือติดตั้งในหน้า Batch Control)"}</div>}
        </div>
        <div style={{ padding: "10px 16px", background: "#F4F3EF", borderTop: "0.5px solid #E3E5EA", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ flex: 1, fontSize: 11, color: "#616e7c" }}>เปิดเป็น Draft ใน Outlook (ยังไม่ส่งจริง) ตรวจแล้วกดส่งเอง{withPrep ? "" : " · ค่า To/Cc/Greeting/Name จะถูกจำไว้ของคุณ"}</span>
          <button type="button" onClick={onClose} style={{ ...btn, height: 32, padding: "0 16px", borderRadius: 8 }}>ยกเลิก</button>
          <button type="button" disabled={!loaded || !drafts.length} onClick={openAll} style={{ ...btn, height: 32, padding: "0 16px", borderRadius: 8, border: "none", fontWeight: 600, background: loaded && drafts.length ? C.navy : "#D9D6CB", color: loaded && drafts.length ? "#fff" : "#7b8794", cursor: loaded && drafts.length ? "pointer" : "default" }}>{drafts.length > 1 ? "เปิด " + drafts.length + " Draft ใน Outlook" : "เปิด Draft ใน Outlook"}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function TimelinePage({ onNavigate }) {
  const { userName } = useAuth();
  const { isAdmin } = useUserRole();
  const [showCfg, setShowCfg] = React.useState(false);
  const [showMail, setShowMail] = React.useState(false); // MARKER_TIMELINE_EMAIL_REPORT_V1
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
        return old ? { ...old, code: fresh.code, name: fresh.name, nameEn: fresh.nameEn, vatRate: fresh.vatRate, taxType: fresh.taxType, prep: fresh.prep, mine } : { ...fresh, mine };
      }));
      setCur(-1);
      setSrc({ loading: false, error: r.error, bound: r.bound });
    })();
    return () => { off = true; };
  }, [userName, reload, isAdmin, inc]);
  const [period, setPeriod] = React.useState({ loading: true, error: "", month: "", status: "open", deadline: null }); // MARKER_TIMELINE_PERIOD_DEADLINE_FROM_VAT_PERIOD_V1
  React.useEffect(() => {
    let off = false;
    (async () => {
      try {
        const r = await apiFetch("/vat/period/status");
        if (off) return;
        const month = r && r.vat_period_month ? String(r.vat_period_month) : "";
        if (!month) { setPeriod({ loading: false, error: "no-period", month: "", status: "open", deadline: null }); return; }
        setPeriod({ loading: false, error: "", month, status: r.vat_period_current_status || "open", ...vatPeriodInfo(month) });
      } catch (e) {
        if (!off) setPeriod({ loading: false, error: String((e && e.message) || e), month: "", status: "open", deadline: null });
      }
    })();
    return () => { off = true; };
  }, [reload]);
  const closed = false; // Dashboard นี้ไม่มีการปิด Period
  // MARKER_TIMELINE_CURRENT_PERIOD_KEY_V1 -- แถวใน timeline_progress อ้างตาม Current Period (เดิม Hard-code 2026-09) | ยังไม่รู้ Period = "" (ยังไม่โหลดความคืบหน้า)
  const curYm = period.loading ? "" : (period.periodYm ? String(period.periodYm).slice(0, 7) : PERIOD_YM);
  const prevYmOf = (ym) => { const m = /^(\d{4})-(\d{2})$/.exec(ym || ""); if (!m) return ""; const d = new Date(Number(m[1]), Number(m[2]) - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
  // ── บันทึกความคืบหน้าลง DB (ตาราง timeline_progress: 1 แถวต่อ Period + BU) ──
  const savedRef = React.useRef({}); // bu -> JSON ที่บันทึก/โหลดล่าสุด
  const rowIdRef = React.useRef({}); // bu -> id แถวใน DB
  const [loadedProg, setLoadedProg] = React.useState(false);
  const [saveMsg, setSaveMsg] = React.useState("");
  const busKeys = bus.map((b) => b.bu).join("|");
  React.useEffect(() => {
    if (!busKeys || !curYm) return undefined;
    let off = false;
    (async () => {
      const [r, sc] = await Promise.all([db.from("timeline_progress").select("*").eq("period_ym", curYm), db.from("tax_close_bu_config").select("*").eq("config_key", "scope")]); /* MARKER_TIMELINE_SCOPE_DEFAULTS_CONFIG_V1 */
      if (off) return;
      const scopeRows = sc && !sc.error && Array.isArray(sc.data) ? sc.data : [];
      if (r.error) { setSaveMsg("โหลดความคืบหน้าไม่สำเร็จ (ตรวจว่า Deploy Backend/ตาราง timeline_progress แล้ว)"); setLoadedProg(false); return; }
      const rows = Array.isArray(r.data) ? r.data : [];
      rows.forEach((x) => { rowIdRef.current[x.bu] = x.id; });
      // Period ใหม่ (ยังไม่มีแถว) -> คัดลอกเฉพาะ Request ID History (rhist) จาก Period ก่อนหน้า | Note / Request ID / Finish เริ่มว่าง
      let prevRows = [];
      if (rows.length < busRef.current.length) { try { const pr = await db.from("timeline_progress").select("*").eq("period_ym", prevYmOf(curYm)); if (pr && !pr.error && Array.isArray(pr.data)) prevRows = pr.data; } catch (e) { /* ไม่มี = เริ่มว่าง */ } }
      if (off) return;
      setBus((prev) => prev.map((b) => {
        const row = rows.find((x) => x.bu === b.bu);
        const pRow = !row ? prevRows.find((x) => x.bu === b.bu) : null;
        let m = row && row.state && typeof row.state === "object" ? mergeProg(b, row.state) : (pRow && pRow.state && typeof pRow.state === "object" && pRow.state.rhist ? mergeProg(b, { rhist: pRow.state.rhist }) : b);
        const sr = scopeRows.find((x) => String(x.bu_code) === String(b.bu));
        if (sr && typeof sr.enabled === "boolean") m = { ...m, inScope: sr.enabled, why: sr.enabled ? "" : "Inactive" };
        savedRef.current[b.bu] = JSON.stringify(pickProg(m));
        return m;
      }));
      setSaveMsg("");
      setLoadedProg(true);
    })();
    return () => { off = true; };
  }, [busKeys, userName, curYm]);
  React.useEffect(() => {
    if (!loadedProg) return undefined;
    const tm = setTimeout(async () => {
      const savedBus = [];
      for (const b of bus) {
        const js = JSON.stringify(pickProg(b));
        if (savedRef.current[b.bu] === js) continue;
        const payload = { state: pickProg(b), updated_by: userName || "", updated_at: new Date().toISOString() };
        let res;
        if (rowIdRef.current[b.bu]) res = await db.from("timeline_progress").update(payload).eq("id", rowIdRef.current[b.bu]);
        else {
          res = await db.from("timeline_progress").insert({ period_ym: curYm, bu: b.bu, ...payload });
          if (!res.error) { const q = await db.from("timeline_progress").select("*").eq("period_ym", curYm).eq("bu", b.bu); const row = Array.isArray(q.data) ? q.data[0] : null; if (row) rowIdRef.current[b.bu] = row.id; }
        }
        if (res.error) setSaveMsg("บันทึกความคืบหน้าไม่สำเร็จ: " + (res.error.message || res.error));
        else { savedRef.current[b.bu] = js; setSaveMsg(""); savedBus.push(b.bu); }
      }
      if (savedBus.length) broadcastWs("timeline_progress_updated", { period_ym: curYm, bus: savedBus, by: userName || "" }); // Realtime: แจ้งเครื่องอื่นให้ดึงข้อมูลใหม่
    }, 600);
    return () => clearTimeout(tm);
  }, [bus, loadedProg, userName, curYm]);
  // MARKER_TIMELINE_REALTIME_PROGRESS_V1 -- รับ Event แล้วดึง timeline_progress ใหม่ (+ Poll สำรองทุก 60 วิ) · BU ที่เรามีแก้ค้างยังไม่บันทึกจะไม่ถูกทับ
  const busRef = React.useRef(bus);
  busRef.current = bus;
  const refreshProgress = React.useCallback(async () => {
    if (!loadedProg) return;
    const r = await db.from("timeline_progress").select("*").eq("period_ym", curYm);
    if (!r || r.error || !Array.isArray(r.data)) return;
    const updates = {};
    const sc = await db.from("tax_close_bu_config").select("*").eq("config_key", "scope"); // MARKER_TIMELINE_SCOPE_SYNC_V1 -- Active/Inactive ตาม DB เสมอ (กันเด้งกลับ)
    const scopeRows = sc && !sc.error && Array.isArray(sc.data) ? sc.data : [];
    const scopeChg = {};
    busRef.current.forEach((b) => { const sr = scopeRows.find((x) => String(x.bu_code) === String(b.bu)); if (sr && typeof sr.enabled === "boolean" && sr.enabled !== b.inScope) scopeChg[b.bu] = sr.enabled; });
    r.data.forEach((row) => {
      if (row.id) rowIdRef.current[row.bu] = row.id;
      const b = busRef.current.find((x) => x.bu === row.bu);
      if (!b || !row.state || typeof row.state !== "object") return;
      if (JSON.stringify(pickProg(b)) !== savedRef.current[b.bu]) return; // เรามีแก้ค้างอยู่ ไม่ทับ
      const m = mergeProg(b, row.state);
      const js = JSON.stringify(pickProg(m));
      if (js === savedRef.current[b.bu]) return; // ไม่มีอะไรเปลี่ยน
      savedRef.current[b.bu] = js;
      updates[b.bu] = { ...m, inScope: b.inScope, why: b.why };
    });
    if (Object.keys(updates).length || Object.keys(scopeChg).length) setBus((prev) => prev.map((b) => { let n = updates[b.bu] || b; if (b.bu in scopeChg) n = { ...n, inScope: scopeChg[b.bu], why: scopeChg[b.bu] ? "" : "Inactive" }; return n; }));
  }, [loadedProg, curYm]);
  React.useEffect(() => { if (loadedProg) refreshProgress(); }, [loadedProg, busKeys]); // eslint-disable-line react-hooks/exhaustive-deps
  useRealtimeRefresh(["timeline_progress_updated"], refreshProgress, 60000);
  const [filter, setFilter] = React.useState("all"); // all | pending | confirm
  const [tab, setTab] = React.useState("mine"); // mine = งานของฉัน | all = ทั้งหมด (Owner/Admin)
  const tabEff = isAdmin ? tab : "mine";
  const [cur, setCur] = React.useState(-1);
  React.useEffect(() => { // MARKER_RECON_GO_TIMELINE_V1 -- มาจากปุ่ม Timeline ในหน้า Reconcile -> เปิดหน้า BU นั้นให้เลย
    if (!bus.length) return;
    let j = null;
    try { j = JSON.parse(sessionStorage.getItem("timeline_jump") || "null"); } catch (e) {}
    if (!j || !j.bu || Date.now() - (j.t || 0) > 60000) return;
    try { sessionStorage.removeItem("timeline_jump"); } catch (e) {}
    const ix = bus.findIndex((x) => x.bu === j.bu);
    if (ix >= 0) setCur(ix);
  }, [bus]);
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
  // MARKER_TIMELINE_REQUEST_ID_HISTORY_V1 -- เก็บประวัติ Request ID ต่อช่อง (ล่าสุด 5 รายการ: ID / ผู้บันทึก / เวลาจริง) ไว้ใน state.rhist -> บันทึกลง timeline_progress
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
  const onRidDone = (key) => { // MARKER_TIMELINE_RID_CLEAR_ON_DATA_V1 -- ข้อมูลเข้า DB แล้ว -> เก็บ Request ID ลง History แล้วเคลียร์ช่อง (ช่องเก็บเฉพาะค่าที่ยัง "ค้าง")
    const b = bus[cur];
    if (!b) return;
    const isSum = typeof key === "string" && key.startsWith("S");
    const k = isSum ? key.slice(1) : null;
    const val = isSum ? (b.req && b.req["Input Summary"] ? b.req["Input Summary"][k] : "") : (b.vat && b.vat.cards[key] ? b.vat.cards[key].v : "");
    if (!val || val === "X") return;
    mutate(cur, (x) => {
      if (isSum) { pushRid(x, `req:Input Summary:${k}`, x.req["Input Summary"][k]); x.req["Input Summary"][k] = ""; }
      else { const cd = x.vat.cards[key]; pushRid(x, `vat:${key}`, cd.v); cd.v = ""; cd.by = ""; }
    });
    log(cur, `Request ID › ${isSum ? "Input Summary " + k : VAT_CARDS[key].name}: ข้อมูลเข้าระบบแล้ว เคลียร์ช่อง (เก็บ ${val} ไว้ใน History)`);
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
  const onRptNote = (c, rk, text) => { // MARKER_TIMELINE_FIRSTDRAFT_NOTES_V1 -- Note ต่อช่อง First Draft (เก็บเป็น History ล่าสุดก่อน)
    const t = String(text || "").trim();
    if (!t) return;
    const key = `first:${c}:${rk}`;
    mutate(cur, (x) => { const arr = Array.isArray(x.rnotes && x.rnotes[key]) ? x.rnotes[key] : []; x.rnotes = { ...(x.rnotes || {}), [key]: [{ text: t, by: who, at: new Date().toISOString() }, ...arr].slice(0, 100) }; });
    log(cur, `Reconcile Report › First Draft Tax Code ${c} ${rk === "inc" ? "Incomplete" : "Input"}: Note added`);
  };
  const onRptNoteDel = (c, rk, idx) => { // MARKER_TIMELINE_NOTE_DELETE_V1 -- ลบ Note ตัวที่ idx ของช่อง First Draft
    const key = `first:${c}:${rk}`;
    mutate(cur, (x) => { const arr = Array.isArray(x.rnotes && x.rnotes[key]) ? x.rnotes[key] : []; const next = arr.filter((_, i) => i !== idx); const rn = { ...(x.rnotes || {}) }; if (next.length) rn[key] = next; else delete rn[key]; x.rnotes = rn; });
    log(cur, `Reconcile Report › First Draft Tax Code ${c} ${rk === "inc" ? "Incomplete" : "Input"}: Note deleted`);
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
        if (side === "final" && (v === "D" || v === "P" || v === "ND") && x.rpt.first[c][rk] !== "X") x.rpt.first[c][rk] = v;
        return;
      }
      ["first", "final"].forEach((sd) => { const o = x.rpt[sd][c][rk]; x.rpt[sd][c][rk] = v === "X" ? "X" : (o === "X" ? "P" : o); });
    });
    log(cur, `Reconcile Report › ${isToggle ? "First + Final Draft" : side === "first" ? "First Draft" : (v === "D" || v === "P" || v === "ND") ? "Final Draft (+ First Draft)" : "Final Draft"} Tax Code ${c} ${rk === "inc" ? "Incomplete" : "Input"}: ${v === "ND" ? "No Data" : v === "D" ? "Finish" : v === "P" ? (isToggle ? "Enable" : "Pending") : "Disable"}`);
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
  const onDefaultsSet = async () => { // MARKER_TIMELINE_DEFAULTS_CONFIRM_DIALOG_V1 -- ใช้ confirmDialog ของแอป + สรุปสิ่งที่จะตั้งให้อ่านง่าย
    const b = bus[cur];
    const rule = defaultsRule(b.taxType, b.vatRate);
    const rateTxt = typeof b.vatRate === "number" ? `${b.vatRate}%` : "ไม่ระบุ";
    const typeTxt = String(b.taxType || "").trim() || "ไม่ระบุ";
    const names = (on) => (rule ? rule.vat.map((w, n) => (w === on ? VAT_CARDS[n].name : null)).filter(Boolean) : []);
    const en = names(true), dis = names(false);
    const msg = [
      `Tax Type : ${typeTxt}     Rate : ${rateTxt}`,
      "",
      rule ? (en.length ? `Enable   →  ${en.join(" · ")}` : "") : "",
      rule ? (dis.length ? `Disable  →  ${dis.join(" · ")}` : "") : "",
      rule && rule.codes ? "Tax Code / Input Summary / Final Step  →  ตั้งตาม Tax Type" : "",
      rule && !rule.codes ? "Tax Code / Input Summary / Final Step  →  ไม่เปลี่ยน (ไม่มี Tax Type ใน Company List)" : "",
      !rule ? "ไม่มี Tax Type และ Rate ใน Company List จึงไม่มีอะไรให้ตั้งตามกฎ\nจะบันทึกค่า Enable/Disable ที่เห็นอยู่ตอนนี้เป็นค่าเริ่มต้นแทน" : "",
      "",
      "ค่าที่กรอกไว้แล้ว (Request ID ฯลฯ) ไม่หาย · ทับเฉพาะ Enable/Disable",
    ].filter((l, n, a) => l !== "" || (n > 0 && a[n - 1] !== "")).join("\n");
    const ok = await confirmDialog.confirm(msg, { title: `Defaults Set · BU ${b.bu}`, confirmText: "ตั้งค่า", cancelText: "ยกเลิก" });
    if (!ok) return false;
    mutate(cur, (x) => { if (rule) applyDefaultsRule(x, rule); const snap = clone(pickProg(x)); delete snap.defaults; delete snap.rhist; delete snap.rnotes; resetValues(snap); x.defaults = snap; });
    log(cur, rule ? `Defaults Set (Tax Type ${typeTxt} · Rate ${rateTxt})` : "Defaults Set (บันทึก Enable/Disable เป็นค่าเริ่มต้นของ BU)");
    return true;
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
    db.from("tax_close_bu_config").upsert({ bu_code: String(bus[i].bu), config_key: "scope", enabled: !was, updated_by: who, updated_at: new Date().toISOString() }, { onConflict: "bu_code,config_key" }).then((res) => { if (res && res.error) { setSaveMsg("บันทึกสถานะ Active/Inactive ไม่สำเร็จ: " + (res.error.message || res.error)); window.alert("บันทึกสถานะ Active/Inactive ของ BU " + bus[i].bu + " ไม่สำเร็จ จึงอาจเด้งกลับเป็นเดิมเมื่อโหลดใหม่\n" + (res.error.message || res.error)); } else broadcastWs("timeline_progress_updated", { period_ym: PERIOD_YM, bus: [bus[i].bu], by: userName || "" }); });
    log(i, was ? "ตั้งเป็น Inactive" : "ตั้งเป็น Active");
  };

  // MARKER_TIMELINE_HEADER_CLEANUP_V1 (หัวข้อ "Timeline ปิดภาษี" ถูกลบแล้ว)
  // แถบฟิลเตอร์: My Job / All Job ชิดซ้าย · สถานะ + Config ชิดขวา (อยู่ในการ์ดเดียวกับ Timeline)
  const tlToolbar = (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, fontSize: 12, color: "#999" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {isAdmin && (
          <span style={{ display: "inline-flex" }}>
            {[["mine", "My Job"], ["all", "All Job"]].map(([k, t], n) => (
              <button key={k} type="button" style={{ ...btn, borderRadius: n === 0 ? "6px 0 0 6px" : "0 6px 6px 0", background: tab === k ? C.navy : "#fff", color: tab === k ? "#fff" : "#1f2933", fontWeight: tab === k ? 600 : 400, padding: "0 14px", height: 30, boxSizing: "border-box" }} onClick={() => { setTab(k); setFilter(k === "all" ? "confirm" : "all"); /* MARKER_TIMELINE_ALLJOB_DEFAULT_CONFIRM_V1 -- All Job = Viewer ดูงานที่ Confirm แล้ว */ }}>{t}</button>
            ))}
          </span>
        )}
        {isAdmin && tab === "all" && (
          <button type="button" onClick={() => setShowInc(true)} title="เลือก User ที่ต้องการดูใน Tab นี้" style={{ ...btn, height: 30, padding: "0 12px", borderRadius: 8, boxSizing: "border-box", color: C.navy, fontWeight: 600 }}>เลือก User ({(inc || []).length})</button>
        )}
        <button type="button" onClick={() => setShowMail(true)} title="เปิด Outlook Draft แจ้งปิดภาษีซื้อ" style={{ ...btn, height: 30, padding: "0 12px", borderRadius: 8, boxSizing: "border-box", color: C.navy, fontWeight: 600 }}>✉ Email Report</button>
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

  return (
    <div ref={rootRef} className="tl-hide-scroll" style={{ padding: "12px 16px", height: "100vh", display: cur < 0 ? "flex" : "block", flexDirection: "column", overflowY: cur < 0 ? "hidden" : "auto", overscrollBehavior: "contain", boxSizing: "border-box", background: "#F4F3EF" }}>
      {saveMsg && <div style={{ flex: "none", marginBottom: 8, padding: "6px 12px", borderRadius: 8, background: "#FCEBEB", color: "#791F1F", fontSize: 12 }}>{saveMsg}</div>}
      {showInc && <IncludeModal opts={userOpts} sel={inc || []} onSave={saveInc} onClose={() => setShowInc(false)} />}
      {showMail && <EmailReportModal bus={bus} tab={tabEff} period={period} userName={userName} onClose={() => setShowMail(false)} />}
      {showCfg && <ConfigModal me={userName} isAdmin={isAdmin} who={who} onClose={() => { setShowCfg(false); setReload((n) => n + 1); }} />}

      {cur < 0 ? (
        <>
          {!src.loading && (src.error || !bus.length) && (
            <div style={{ background: "#fff", border: `0.5px solid ${C.border}`, borderRadius: 12, padding: "14px 16px", marginBottom: 10, fontSize: 13, color: "#52606d" }}>
              {src.error ? `ดึงข้อมูล BU ไม่สำเร็จ: ${src.error}` : src.bound ? `ยังไม่มี BU ที่ Prepare By = "${src.bound}" และยังไม่ได้ติ๊กดู Progress BU ใด กด ⚙ Config BU เพื่อเลือก BU` : "ยังไม่ได้ผูกชื่อที่ใช้ตอนทำ VAT กับบัญชีนี้ กด ⚙ Config BU เพื่อผูกชื่อและเลือก BU"}
            </div>
          )}
          <Lobby bus={bus} tab={tabEff} closed={closed} filter={filter} onView={setCur} onToggleScope={onToggleScope} period={period} toolbar={tlToolbar} />
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
          onVatPick={onVatPick}
          onReqCommit={onReqCommit}
          onReqPick={onReqPick}
          onReqToggle={onReqToggle}
          onRptSet={onRptSet}
          onRptNote={onRptNote}
          onRptNoteDel={onRptNoteDel}
          onBuClose={onBuClose}
          onReset={onReset}
          onDefaultsSet={onDefaultsSet}
          onNoData={onNoData}
          onStepClear={onStepClear}
          onItemEnable={onItemEnable}
          prepBy={bus[cur].prep || src.bound || "-"}
          reconPeriod={period && period.periodYm ? String(period.periodYm).slice(0, 7) : ""}
          onRidDone={onRidDone}
          onGoRecon={onNavigate ? (j) => { try { sessionStorage.setItem("recon_jump", JSON.stringify({ ...j, t: Date.now() })); } catch (e) {} onNavigate("vat-input-rec"); } : null}
          onMode={onMode}
          onBind={onBind}
          onId={onId}
          userName={who}
        />
      )}
    </div>
  );
}
