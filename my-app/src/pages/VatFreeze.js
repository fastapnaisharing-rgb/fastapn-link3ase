import React from "react";
import { apiFetch } from "../api";
import { useUserRole } from "../contexts/useUserRole"; // MARKER_VATFREEZE_OWNER_ONLY_V15

// ============================================================================
// VAT Freeze — src/pages/VatFreeze.js
// กติกา:
//   * งวดเปิด  : Freeze เป็น "Draft" ตาม Live อัตโนมัติ (ไม่ต้องกดอะไร)
//   * ปิด Period: ระบบเปลี่ยนเป็น "Final" ให้เองทุก BU แล้ว Draft หยุด
//   * หลังปิด   : ภายใน 20 วัน อัปเดตได้ | 21-30 วัน ต้องยืนยัน | เกิน 30 วัน ห้ามทุกกรณี
// หน้านี้: ดูสถานะต่อ BU, สั่ง Freeze Final ด้วยมือ (กรณีพิเศษ), ดูประวัติ
// ============================================================================

const fmt = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmtDT = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  const p = (x) => String(x).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const WINDOW_INFO = {
  open: { label: "งวดเปิด — Draft ตาม Live อัตโนมัติ", bg: "#e8f4fd", fg: "#0b5394" },
  grace: { label: "ปิดแล้ว (ภายใน 20 วัน) — อัปเดตได้", bg: "#e6f4ea", fg: "#1e7a3c" },
  confirm: { label: "ปิดแล้ว (21–30 วัน) — ต้องยืนยันก่อนอัปเดต", bg: "#fff4e0", fg: "#a65f00" },
  locked: { label: "ล็อก — ห้ามอัปเดตทุกกรณี (ต้องแก้ด้วยวิธีอื่น)", bg: "#fdecea", fg: "#b3261e" },
  unknown: { label: "ไม่ทราบสถานะ Period", bg: "#eee", fg: "#555" },
};

const SYNC_INFO = {
  synced: { label: "ตรงกับ Live", fg: "#1e7a3c" },
  diff: { label: "ต่างจาก Live", fg: "#a65f00" },
  none: { label: "ยังไม่มีข้อมูล Freeze", fg: "#b3261e" },
  frozen_only: { label: "มีแต่ Freeze (Live ไม่มีแล้ว)", fg: "#555" },
};

const badge = (text, bg, fg) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 11px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: bg, color: fg, whiteSpace: "nowrap" }}>
    <span style={{ width: 6, height: 6, borderRadius: "50%", background: fg }} />{text}
  </span>
);

// MARKER_VATFREEZE_REDESIGN_V15 -- Redesign: การ์ดสรุป + ตารางเต็มความสูงจอ (เลื่อนเฉพาะตาราง) | สิทธิ์: Owner เท่านั้น
const C = { navy: "#1a3a5c", line: "#e5e9f0", soft: "#f4f6f9", text: "#222" };

function StatCard({ label, value, color, active, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{
      flex: "1 1 120px", minWidth: 110, textAlign: "left", padding: "10px 14px", borderRadius: 10, cursor: onClick ? "pointer" : "default",
      background: active ? "#eef3fa" : "white", border: `1px solid ${active ? C.navy : C.line}`, fontFamily: "inherit",
    }}>
      <div style={{ fontSize: 11.5, color: "#6b7785", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1.2 }}>{value}</div>
    </button>
  );
}

export default function VatFreeze() {
  const { isOwner, loading: roleLoading } = useUserRole();
  const [periods, setPeriods] = React.useState([]);
  const [period, setPeriod] = React.useState(null);
  const [win, setWin] = React.useState(null);
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(null);
  const [history, setHistory] = React.useState(null); // { bu, rows, loading }
  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState("all"); // all | final | draft | none | diff

  const load = React.useCallback(async (p) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch(`/vat_freeze/status${p ? `?period=${encodeURIComponent(p)}` : ""}`);
      setPeriods(data.periods || []);
      setPeriod(data.period);
      setWin(data.window);
      setRows(data.rows || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { if (isOwner) load(null); }, [load, isOwner]);

  if (roleLoading) return <div style={{ padding: 24, color: "#888" }}>กำลังตรวจสอบสิทธิ์…</div>;
  if (!isOwner) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#b3261e" }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>ไม่มีสิทธิ์เข้าถึง</div>
        <div style={{ fontSize: 13, color: "#666" }}>หน้านี้สำหรับ Owner เท่านั้น</div>
      </div>
    );
  }

  const state = (win && win.state) || "unknown";
  const info = WINDOW_INFO[state] || WINDOW_INFO.unknown;
  const canRun = state === "open" || state === "grace" || state === "confirm";

  const run = async (bus, force) => {
    let confirm = false;
    if (state === "confirm") {
      if (!window.confirm("งวดนี้ปิดมาแล้วเกิน 20 วัน (ไม่เกิน 30 วัน)\nยืนยันอัปเดต Freeze หรือไม่?")) return;
      confirm = true;
    } else if (force && !window.confirm(`Freeze Final ซ้ำ ${bus && bus.length === 1 ? bus[0] : "ทุก BU"} เป็นเวอร์ชันใหม่ (เวอร์ชันเดิมเก็บไว้ในประวัติ)?`)) {
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiFetch("/vat_freeze/run", { method: "POST", body: JSON.stringify({ period, bus, force: !!force, confirm }) });
      const errs = (r.results || []).filter((x) => x.action === "error");
      setMsg({
        ok: errs.length === 0 && r.locked === 0,
        text: `Freeze Final ${r.frozen} | ไม่เปลี่ยน ${r.unchanged} | ล็อก ${r.locked} | ต้องยืนยัน ${r.needs_confirm} | ผิดพลาด ${r.errors}` + (errs.length ? ` — ${errs[0].bu}: ${errs[0].error}` : ""),
      });
      await load(period);
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const openHistory = async (bu) => {
    setHistory({ bu, rows: [], loading: true });
    try {
      const d = await apiFetch(`/vat_freeze/history?period=${encodeURIComponent(period)}&bu=${encodeURIComponent(bu)}`);
      setHistory({ bu, rows: d.rows || [], loading: false });
    } catch (e) {
      setHistory({ bu, rows: [], loading: false, error: e.message });
    }
  };

  const nFinal = rows.filter((r) => r.freeze_status === "final").length;
  const nDraft = rows.filter((r) => r.freeze_status === "draft").length;
  const nNone = rows.filter((r) => !r.freeze_status).length;
  const nDiff = rows.filter((r) => r.sync_state === "diff" && r.freeze_status === "draft").length;
  const q = search.trim().toLowerCase();
  const shown = rows.filter((r) => {
    if (q && !String(r.bu).toLowerCase().includes(q)) return false;
    if (filter === "final") return r.freeze_status === "final";
    if (filter === "draft") return r.freeze_status === "draft";
    if (filter === "none") return !r.freeze_status;
    if (filter === "diff") return r.sync_state === "diff";
    return true;
  });
  const sumLive = shown.reduce((a, r) => a + (Number(r.live_total_expired) || 0), 0);
  const sumFrz = shown.reduce((a, r) => a + (Number(r.frozen_total_expired) || 0), 0);

  const th = { padding: "10px 14px", background: C.navy, color: "white", fontWeight: 500, textAlign: "left", fontSize: 12.5, position: "sticky", top: 0, zIndex: 1, whiteSpace: "nowrap" };
  const td = { padding: "8px 14px", borderBottom: `1px solid ${C.line}`, fontSize: 13, whiteSpace: "nowrap" };
  const num = { fontVariantNumeric: "tabular-nums", textAlign: "right" };
  const btn = { padding: "6px 14px", fontSize: 12.5, border: `1px solid #cfd8e3`, borderRadius: 8, background: "white", color: C.navy, cursor: "pointer", fontFamily: "inherit" };

  return (
    <div style={{ padding: "18px 22px", height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 12, background: "#f7f8fa", minHeight: 0 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.navy, lineHeight: 1.1 }}>Freeze</div>
          <div style={{ fontSize: 12, color: "#7b8794", marginTop: 3 }}>Snapshot ยอด VAT Watchlist รายเดือน · เฉพาะ Owner</div>
        </div>
        <select value={period || ""} onChange={(e) => load(e.target.value)} style={{ padding: "7px 12px", fontSize: 13.5, border: `1px solid #cfd8e3`, borderRadius: 8, background: "white", fontWeight: 600, color: C.navy }}>
          {periods.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        {badge(info.label, info.bg, info.fg)}
        {win && win.days_since_close !== undefined && <span style={{ fontSize: 12, color: "#666" }}>ปิดมาแล้ว {win.days_since_close} วัน</span>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input placeholder="ค้นหา BU" value={search} onChange={(e) => setSearch(e.target.value)} style={{ padding: "7px 12px", fontSize: 13, width: 180, border: `1px solid #cfd8e3`, borderRadius: 8, background: "white" }} />
          <button disabled={loading} onClick={() => load(period)} style={btn}>{loading ? "กำลังโหลด…" : "รีเฟรช"}</button>
          <button disabled={busy || !canRun || state === "open"} onClick={() => run(null, false)}
            title={state === "open" ? "งวดเปิด: ระบบทำ Draft ให้เอง และจะเปลี่ยนเป็น Final ตอนปิด Period" : ""}
            style={{ padding: "7px 16px", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", background: canRun && state !== "open" ? C.navy : "#c9ced6", color: "white", border: "none", borderRadius: 8, cursor: busy || state === "open" || !canRun ? "not-allowed" : "pointer" }}>
            {busy ? "กำลัง Freeze…" : "Freeze Final ทุก BU"}
          </button>
        </div>
      </div>

      {/* Summary cards (กดเพื่อกรอง) */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <StatCard label="BU ทั้งหมด" value={rows.length} color={C.navy} active={filter === "all"} onClick={() => setFilter("all")} />
        <StatCard label="Final" value={nFinal} color="#1e7a3c" active={filter === "final"} onClick={() => setFilter(filter === "final" ? "all" : "final")} />
        <StatCard label="Draft" value={nDraft} color="#0b5394" active={filter === "draft"} onClick={() => setFilter(filter === "draft" ? "all" : "draft")} />
        <StatCard label="ยังไม่มี Freeze" value={nNone} color="#b3261e" active={filter === "none"} onClick={() => setFilter(filter === "none" ? "all" : "none")} />
        <StatCard label="ต่างจาก Live" value={rows.filter((r) => r.sync_state === "diff").length} color="#a65f00" active={filter === "diff"} onClick={() => setFilter(filter === "diff" ? "all" : "diff")} />
      </div>

      {state === "locked" && (
        <div style={{ background: "#fdecea", color: "#b3261e", padding: "8px 12px", borderRadius: 8, fontSize: 13 }}>
          งวดนี้ถูกล็อก — ไม่สามารถอัปเดต Freeze ได้ทุกกรณี ต้องแก้ไขด้วยวิธีอื่น (Reopen / ขั้นตอนพิเศษ)
        </div>
      )}
      {msg && <div style={{ background: msg.ok ? "#e6f4ea" : "#fdecea", color: msg.ok ? "#1e7a3c" : "#b3261e", padding: "8px 12px", borderRadius: 8, fontSize: 13 }}>{msg.text}</div>}
      {error && <div style={{ color: "#b3261e", fontSize: 13 }}>โหลดไม่สำเร็จ: {error}</div>}

      {/* Table: เต็มความสูงที่เหลือ เลื่อนเฉพาะตาราง */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "white", border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>BU</th>
                <th style={th}>สถานะ Freeze</th>
                <th style={th}>เวอร์ชัน</th>
                <th style={{ ...th, textAlign: "right" }}>Total Expired (Live)</th>
                <th style={{ ...th, textAlign: "right" }}>Total Expired (Freeze)</th>
                <th style={th}>เทียบ Live</th>
                <th style={th}>Freeze เมื่อ</th>
                <th style={th}>โดย</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td style={{ ...td, textAlign: "center", color: "#999", padding: 30 }} colSpan={9}>กำลังโหลด…</td></tr>}
              {!loading && shown.length === 0 && <tr><td style={{ ...td, textAlign: "center", color: "#999", padding: 30 }} colSpan={9}>ไม่มีข้อมูล</td></tr>}
              {!loading && shown.map((r, i) => {
                const si = SYNC_INFO[r.sync_state] || SYNC_INFO.none;
                const diffNow = r.sync_state === "diff";
                return (
                  <tr key={r.bu} style={{ background: i % 2 ? "#fafbfd" : "white" }}>
                    <td style={{ ...td, fontWeight: 700, color: C.navy }}>{r.bu}</td>
                    <td style={td}>
                      {r.freeze_status === "final" ? badge("Final", "#e6f4ea", "#1e7a3c")
                        : r.freeze_status === "draft" ? badge("Draft", "#e8f4fd", "#0b5394")
                        : badge("ยังไม่มี", "#fdecea", "#b3261e")}
                    </td>
                    <td style={{ ...td, color: "#555" }}>{r.freeze_version ? `v${r.freeze_version}` : "—"}</td>
                    <td style={{ ...td, ...num }}>{fmt(r.live_total_expired)}</td>
                    <td style={{ ...td, ...num, fontWeight: 600, color: diffNow ? "#a65f00" : C.text }}>{fmt(r.frozen_total_expired)}</td>
                    <td style={{ ...td, color: si.fg, fontSize: 12.5 }}>{r.freeze_status === "final" && diffNow ? "Live เปลี่ยนหลัง Final" : si.label}</td>
                    <td style={{ ...td, color: "#555" }}>{fmtDT(r.frozen_at)}</td>
                    <td style={{ ...td, color: "#555" }}>{r.frozen_by || "—"}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <button onClick={() => openHistory(r.bu)} style={{ ...btn, padding: "3px 12px", marginRight: 6 }}>ประวัติ</button>
                      {state !== "open" && canRun && (
                        <button disabled={busy} onClick={() => run([r.bu], true)} style={{ ...btn, padding: "3px 12px" }}>Freeze ซ้ำ</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", gap: 20, padding: "8px 16px", borderTop: `1px solid ${C.line}`, background: C.soft, fontSize: 12.5, color: "#444", flexWrap: "wrap" }}>
          <span>แสดง <b>{shown.length}</b> / {rows.length} BU</span>
          <span style={{ marginLeft: "auto" }}>รวม Live <b style={num}>{fmt(sumLive)}</b></span>
          <span>รวม Freeze <b style={num}>{fmt(sumFrz)}</b></span>
        </div>
      </div>

      {history && (
        <div onClick={() => setHistory(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.42)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 12, padding: 20, width: "min(960px, 94vw)", maxHeight: "82vh", overflow: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.navy }}>ประวัติ Freeze — {history.bu}</div>
                <div style={{ fontSize: 12, color: "#7b8794" }}>งวด {period}</div>
              </div>
              <button onClick={() => setHistory(null)} style={{ ...btn, marginLeft: "auto" }}>ปิด</button>
            </div>
            {history.loading ? "กำลังโหลด…" : history.error ? <span style={{ color: "#b3261e" }}>{history.error}</span> : (
              <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, overflow: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={th}>เวลา</th><th style={th}>เวอร์ชัน</th><th style={th}>วิธี</th><th style={th}>โดย</th>
                      <th style={{ ...th, textAlign: "right" }}>Total Expired</th><th style={{ ...th, textAlign: "right" }}>Unrealized ใน Expired</th><th style={th}>หมายเหตุ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.rows.length === 0 && <tr><td style={{ ...td, textAlign: "center", color: "#999", padding: 24 }} colSpan={7}>ยังไม่มีประวัติ (Draft ไม่บันทึก log — log เกิดตอน Final)</td></tr>}
                    {history.rows.map((h) => (
                      <tr key={h.id}>
                        <td style={td}>{fmtDT(h.frozen_at)}</td><td style={td}>v{h.freeze_version}</td><td style={td}>{h.trigger_type}</td><td style={td}>{h.frozen_by}</td>
                        <td style={{ ...td, ...num }}>{fmt(h.total_expired)}</td><td style={{ ...td, ...num }}>{fmt(h.unrealized_in_expired)}</td><td style={td}>{h.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
