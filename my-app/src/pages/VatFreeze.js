import React from "react";
import { apiFetch } from "../api";

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
  <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 10, fontSize: 12, fontWeight: 600, background: bg, color: fg }}>{text}</span>
);

export default function VatFreeze() {
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

  React.useEffect(() => { load(null); }, [load]);

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

  const shown = rows.filter((r) => !search || String(r.bu).toLowerCase().includes(search.toLowerCase()));
  const nFinal = rows.filter((r) => r.freeze_status === "final").length;
  const nDraft = rows.filter((r) => r.freeze_status === "draft").length;
  const nNone = rows.filter((r) => !r.freeze_status).length;
  const nDiff = rows.filter((r) => r.sync_state === "diff" && r.freeze_status === "draft").length;

  const th = { padding: "8px 10px", background: "#1a3a5c", color: "white", fontWeight: 500, textAlign: "left", fontSize: 13, position: "sticky", top: 0 };
  const td = { padding: "7px 10px", borderBottom: "1px solid #eee", fontSize: 13 };

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>🧊 Freeze</h2>
        <select value={period || ""} onChange={(e) => load(e.target.value)} style={{ padding: "6px 10px", fontSize: 14 }}>
          {periods.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        {badge(info.label, info.bg, info.fg)}
        {win && win.days_since_close !== undefined && <span style={{ fontSize: 12, color: "#666" }}>ปิดมาแล้ว {win.days_since_close} วัน</span>}
        <input placeholder="ค้นหา BU" value={search} onChange={(e) => setSearch(e.target.value)} style={{ padding: "6px 10px", fontSize: 13, marginLeft: "auto" }} />
        <button disabled={loading} onClick={() => load(period)} style={{ padding: "6px 14px" }}>รีเฟรช</button>
        <button disabled={busy || !canRun || state === "open"} onClick={() => run(null, false)}
          title={state === "open" ? "งวดเปิด: ระบบทำ Draft ให้เอง และจะเปลี่ยนเป็น Final ตอนปิด Period" : ""}
          style={{ padding: "6px 14px", background: canRun && state !== "open" ? "#1a3a5c" : "#bbb", color: "white", border: "none", borderRadius: 4, cursor: busy || state === "open" || !canRun ? "not-allowed" : "pointer" }}>
          {busy ? "กำลัง Freeze…" : "Freeze Final ทุก BU"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 24, fontSize: 13, marginBottom: 10, color: "#444" }}>
        <span>ทั้งหมด <b>{rows.length}</b> BU</span>
        <span>Final <b style={{ color: "#1e7a3c" }}>{nFinal}</b></span>
        <span>Draft <b style={{ color: "#0b5394" }}>{nDraft}</b></span>
        <span>ยังไม่มี <b style={{ color: "#b3261e" }}>{nNone}</b></span>
        {nDiff > 0 && <span>Draft ต่างจาก Live <b style={{ color: "#a65f00" }}>{nDiff}</b></span>}
      </div>

      {state === "locked" && (
        <div style={{ background: "#fdecea", color: "#b3261e", padding: "8px 12px", borderRadius: 6, marginBottom: 10, fontSize: 13 }}>
          งวดนี้ถูกล็อก — ไม่สามารถอัปเดต Freeze ได้ทุกกรณี ต้องแก้ไขด้วยวิธีอื่น (Reopen / ขั้นตอนพิเศษ)
        </div>
      )}
      {msg && (
        <div style={{ background: msg.ok ? "#e6f4ea" : "#fdecea", color: msg.ok ? "#1e7a3c" : "#b3261e", padding: "8px 12px", borderRadius: 6, marginBottom: 10, fontSize: 13 }}>{msg.text}</div>
      )}
      {error && <div style={{ color: "#b3261e", marginBottom: 10 }}>โหลดไม่สำเร็จ: {error}</div>}

      <div style={{ maxHeight: "68vh", overflow: "auto", border: "1px solid #ddd", borderRadius: 6 }}>
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
            {loading && <tr><td style={td} colSpan={9}>กำลังโหลด…</td></tr>}
            {!loading && shown.length === 0 && <tr><td style={td} colSpan={9}>ไม่มีข้อมูล</td></tr>}
            {!loading && shown.map((r) => {
              const si = SYNC_INFO[r.sync_state] || SYNC_INFO.none;
              return (
                <tr key={r.bu}>
                  <td style={{ ...td, fontWeight: 600 }}>{r.bu}</td>
                  <td style={td}>
                    {r.freeze_status === "final" ? badge("Final", "#e6f4ea", "#1e7a3c")
                      : r.freeze_status === "draft" ? badge("Draft", "#e8f4fd", "#0b5394")
                      : badge("ยังไม่มี", "#fdecea", "#b3261e")}
                  </td>
                  <td style={td}>{r.freeze_version ? `v${r.freeze_version}` : "—"}</td>
                  <td style={{ ...td, textAlign: "right" }}>{fmt(r.live_total_expired)}</td>
                  <td style={{ ...td, textAlign: "right" }}>{fmt(r.frozen_total_expired)}</td>
                  <td style={{ ...td, color: si.fg }}>{r.freeze_status === "final" && r.sync_state === "diff" ? "Live เปลี่ยนหลัง Final" : si.label}</td>
                  <td style={td}>{fmtDT(r.frozen_at)}</td>
                  <td style={td}>{r.frozen_by || "—"}</td>
                  <td style={td}>
                    <button onClick={() => openHistory(r.bu)} style={{ padding: "3px 10px", marginRight: 6 }}>ประวัติ</button>
                    {state !== "open" && canRun && (
                      <button disabled={busy} onClick={() => run([r.bu], true)} style={{ padding: "3px 10px" }}>Freeze ซ้ำ</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {history && (
        <div onClick={() => setHistory(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 8, padding: 18, width: "min(900px, 94vw)", maxHeight: "80vh", overflow: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>ประวัติ Freeze — {history.bu} / {period}</h3>
              <button onClick={() => setHistory(null)} style={{ marginLeft: "auto", padding: "4px 12px" }}>ปิด</button>
            </div>
            {history.loading ? "กำลังโหลด…" : history.error ? <span style={{ color: "#b3261e" }}>{history.error}</span> : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>เวลา</th><th style={th}>เวอร์ชัน</th><th style={th}>วิธี</th><th style={th}>โดย</th>
                    <th style={{ ...th, textAlign: "right" }}>Total Expired</th><th style={{ ...th, textAlign: "right" }}>Unrealized ใน Expired</th><th style={th}>หมายเหตุ</th>
                  </tr>
                </thead>
                <tbody>
                  {history.rows.length === 0 && <tr><td style={td} colSpan={7}>ยังไม่มีประวัติ (Draft ไม่บันทึก log — log เกิดตอน Final)</td></tr>}
                  {history.rows.map((h) => (
                    <tr key={h.id}>
                      <td style={td}>{fmtDT(h.frozen_at)}</td><td style={td}>v{h.freeze_version}</td><td style={td}>{h.trigger_type}</td><td style={td}>{h.frozen_by}</td>
                      <td style={{ ...td, textAlign: "right" }}>{fmt(h.total_expired)}</td><td style={{ ...td, textAlign: "right" }}>{fmt(h.unrealized_in_expired)}</td><td style={td}>{h.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
