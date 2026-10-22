/**
 * VatPdfTaxInvoicePreview.js
 * ================================================================
 * MARKER_PDFTAXINV_PREVIEW_V1
 * Overlay "PDF Tax Invoice" -- รับ .pdf / .zip (ที่มี PDF) จากช่อง Import Overall file
 * อ่านด้วย PDF.js ฝั่ง Browser (ไฟล์ไม่ถูกส่งขึ้น Server) แล้วแสดงค่าที่อ่านได้ให้ตรวจ
 *
 * รอบที่ 1 (ไฟล์นี้): อ่าน + Preview เท่านั้น  -- ยังไม่ Match / ยังไม่เขียน DB
 * รอบที่ 2: ต่อ Match (BU ก่อน, 3 กลุ่ม Match / ต้องตรวจสอบ / Reject) + Confirm
 *
 * PDF.js โหลดจาก /pdfjs/ (ไฟล์ใน public/ ถูกรวมใน build) -- ไม่ใช้ CDN (Production ไม่มีอินเทอร์เน็ต)
 * ================================================================
 */
import React from "react";
import JSZip from "jszip";
import { readPdfTaxInvoice } from "../utils/pdfTaxInvoiceReader";

let _pdfjsPromise = null;
function loadPdfjs() {
  if (!_pdfjsPromise) {
    const base = new URL((process.env.PUBLIC_URL || "") + "/pdfjs/", window.location.href).href;
    _pdfjsPromise = import(/* webpackIgnore: true */ base + "pdf.min.mjs").then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.js"; // MARKER_PDFTAXINV_WORKERJS_V1 (.js เพราะ Dev server ค้างตอนส่ง .mjs)
      return lib;
    }).catch((e) => { _pdfjsPromise = null; throw e; });
  }
  return _pdfjsPromise;
}

// แตก .zip (รวมโฟลเดอร์ย่อย) -> [{ name, data:ArrayBuffer }]  ข้ามไฟล์ที่ไม่ใช่ PDF
async function expandInputs(files) {
  const pdfs = [];
  let skipped = 0;
  for (const f of files) {
    const lower = f.name.toLowerCase();
    if (lower.endsWith(".zip")) {
      const zip = await JSZip.loadAsync(await f.arrayBuffer());
      for (const entry of Object.values(zip.files)) {
        if (entry.dir || /(^|\/)__MACOSX\//.test(entry.name)) continue;
        if (/\.pdf$/i.test(entry.name)) pdfs.push({ name: entry.name.split("/").pop(), data: await entry.async("arraybuffer"), from: f.name });
        else skipped++;
      }
    } else if (lower.endsWith(".pdf")) {
      pdfs.push({ name: f.name, data: await f.arrayBuffer(), from: null });
    } else skipped++;
  }
  return { pdfs, skipped };
}

const fmt = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const buKey = (r) => (r.buyer && r.buyer.taxId ? `${r.buyer.taxId}-${r.buyer.branch || "?"}` : "(ไม่พบ)");

export default function VatPdfTaxInvoicePreview({ files, onClose, onMatch, onOpenConfirm }) {
  const [rows, setRows] = React.useState([]);
  const [progress, setProgress] = React.useState({ done: 0, total: 0 });
  const [skipped, setSkipped] = React.useState(0);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(true);
  const [matches, setMatches] = React.useState(null); // MARKER_PDFTAXINV_MATCH_UI_V1 -- ผล Match ต่อแถว (index ตรงกับ rows) -- ยังไม่เขียน DB
  const [matchMsg, setMatchMsg] = React.useState('');

  React.useEffect(() => {
    let off = false;
    (async () => {
      try {
        const [pdfjs, { pdfs, skipped: sk }] = await Promise.all([loadPdfjs(), expandInputs(files)]);
        if (off) return;
        setSkipped(sk);
        setProgress({ done: 0, total: pdfs.length });
        const acc = [];
        for (let i = 0; i < pdfs.length; i++) {
          const r = await Promise.race([
            readPdfTaxInvoice(pdfjs, pdfs[i].data, pdfs[i].name),
            new Promise((_, rej) => setTimeout(() => rej(new Error("อ่านไฟล์ " + pdfs[i].name + " เกิน 30 วินาที — Worker ของ PDF.js อาจโหลดไม่ได้ (ดู Network: pdf.worker.min.js)")), 30000)),
          ]);
          r.from = pdfs[i].from;
          acc.push(r);
          if (off) return;
          { setRows(acc.slice()); setProgress({ done: i + 1, total: pdfs.length }); }
        }
        setRows(acc.slice());
        if (onMatch && acc.length > 0) {
          setMatchMsg('กำลัง Match กับรายการค้าง…');
          const res = await onMatch(acc, (m) => { if (!off) setMatchMsg(m); });
          if (!off) setMatches(res);
          setMatchMsg('');
        }
      } catch (e) {
        if (!off) setError((e && e.message) || String(e));
      } finally {
        if (!off) setBusy(false);
      }
    })();
    return () => { off = true; };
  }, [files]);

  const okCount = rows.filter((r) => r.status === "ok").length;
  const reviewCount = rows.filter((r) => r.status === "review").length;
  const unreadable = rows.filter((r) => r.status === "unreadable").length;
  const matchOf = (r) => (matches ? matches[rows.indexOf(r)] : null);
  const mCount = React.useMemo(() => { const c = { match: 0, review: 0, notfound: 0 }; (matches || []).forEach((m) => { if (m && c[m.status] !== undefined) c[m.status]++; }); return c; }, [matches]);
  const sorted = React.useMemo(() => rows.slice().sort((a, b) => (buKey(a) + a.invoiceNo).localeCompare(buKey(b) + b.invoiceNo)), [rows]);
  const groups = [...new Set(sorted.map(buKey))];

  const th = { textAlign: "left", padding: "7px 10px", fontSize: "12px", background: "#eef2f7", position: "sticky", top: 0, whiteSpace: "nowrap", zIndex: 1 };
  const td = { padding: "6px 10px", borderTop: "1px solid #e6eaf0", fontSize: "12.5px", verticalAlign: "top" };
  const num = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
  const chip = (bg, fg) => ({ padding: "8px 14px", borderRadius: "8px", fontWeight: 600, background: bg, color: fg, fontSize: "13px" });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ fontSize: "17px", fontWeight: 500 }}>PDF Tax Invoice — ผลการอ่านไฟล์</div>
        <div style={{ display: "flex", gap: "8px" }}>
          {onOpenConfirm && matches && (mCount.match + mCount.review) > 0 && (
            <button onClick={() => onOpenConfirm(rows, matches)} style={{ border: 0, background: "#16794a", color: "#fff", borderRadius: "6px", padding: "6px 16px", cursor: "pointer", fontWeight: 600 }}>
              ไปขั้น Confirm → Draft Popvat {mCount.match} · Backup {mCount.review}
            </button>
          )}
          <button onClick={onClose} style={{ border: "0.5px solid #ccc", background: "#fff", borderRadius: "6px", padding: "6px 14px", cursor: "pointer" }}>ปิด</button>
        </div>
      </div>
      <div style={{ fontSize: "12px", color: "#777", margin: "4px 0 12px", flexShrink: 0 }}>
        อ่านด้วย PDF.js บนเครื่องของคุณ (ไฟล์ไม่ถูกส่งขึ้น Server) · ขั้นนี้ยังไม่บันทึกอะไร กด "ไปขั้น Confirm" เพื่อดู Preview Draft Popvat / Backup แยกตาม BU ก่อนยืนยันจริง
      </div>
      <div style={{ display: "flex", gap: "10px", marginBottom: "12px", flexWrap: "wrap", flexShrink: 0 }}>
        <div style={chip("#e3f6ea", "#16794a")}>อ่านครบ: {okCount}</div>
        <div style={chip("#fff3d6", "#9a6a00")}>ต้องตรวจสอบ: {reviewCount}</div>
        <div style={chip("#fde4e4", "#b42323")}>อ่านไม่ได้ (ต้อง OCR): {unreadable}</div>
        {matches && <><div style={chip("#e3f6ea", "#16794a")}>Match: {mCount.match}</div><div style={chip("#fff3d6", "#9a6a00")}>ต้องตรวจสอบ: {mCount.review}</div><div style={chip("#eef0f3", "#56606e")}>ไม่พบ (Not Found): {mCount.notfound}</div></>}
        {matchMsg && <div style={chip("#e8f0fe", "#1a56b0")}>{matchMsg}</div>}
        {skipped > 0 && <div style={chip("#eee", "#555")}>ข้ามไฟล์ที่ไม่ใช่ PDF: {skipped}</div>}
        {busy && <div style={chip("#e8f0fe", "#1a56b0")}>กำลังอ่าน {progress.done}/{progress.total}…</div>}
      </div>
      {error && <div style={{ color: "#b42323", marginBottom: "10px", flexShrink: 0 }}>เกิดข้อผิดพลาด: {error}</div>}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", border: "1px solid #e6eaf0", borderRadius: "8px" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={th}>ไฟล์</th><th style={th}>Supplier (Tax ID-สาขา)</th><th style={th}>BU ผู้ซื้อ (Tax ID-สาขา)</th>
              <th style={th}>เลขที่ใบกำกับภาษี</th><th style={th}>วันที่</th><th style={th}>Invoice Ref.</th>
              <th style={{ ...th, textAlign: "right" }}>ก่อน VAT</th><th style={{ ...th, textAlign: "right" }}>VAT</th><th style={{ ...th, textAlign: "right" }}>รวม</th>
              <th style={th}>สถานะ</th><th style={th}>ผล Match (รอบนี้ยังไม่บันทึก)</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const items = sorted.filter((r) => buKey(r) === g);
              return (
                <React.Fragment key={g}>
                  <tr><td colSpan={11} style={{ ...td, background: "#f6f8fb", fontWeight: 600 }}>BU ผู้ซื้อ {g} · {items.length} ใบ · รวม {fmt(items.reduce((s, r) => s + (r.grandTotal || 0), 0))}</td></tr>
                  {items.map((r, i) => (
                    <tr key={g + i}>
                      <td style={td} title={r.from ? "จาก " + r.from : ""}>{r.fileName}</td>
                      <td style={td}>{r.supplier.taxId ? `${r.supplier.taxId}-${r.supplier.branch || "?"}` : "—"}<br /><small style={{ color: "#888" }}>{r.supplierKey || "ไม่รู้จัก Template"}</small></td>
                      <td style={td}>{g}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{r.invoiceNo || "—"}</td>
                      <td style={td}>{r.invoiceDate || "—"}</td>
                      <td style={td}>{r.invoiceRef || "—"}</td>
                      <td style={num}>{fmt(r.beforeVat)}</td><td style={num}>{fmt(r.vat)}</td><td style={num}>{fmt(r.grandTotal)}</td>
                      <td style={td}>
                        <span style={{ padding: "2px 9px", borderRadius: "10px", fontSize: "12px", fontWeight: 600, background: r.status === "ok" ? "#e3f6ea" : r.status === "review" ? "#fff3d6" : "#fde4e4", color: r.status === "ok" ? "#16794a" : r.status === "review" ? "#9a6a00" : "#b42323" }}>
                          {r.status === "ok" ? "อ่านครบ" : r.status === "review" ? "ตรวจสอบ" : "อ่านไม่ได้"}
                        </span>
                        {r.warnings.length > 0 && <div style={{ fontSize: "11px", color: "#778", marginTop: "3px" }}>{r.warnings.join(" · ")}</div>}
                      </td>
                      {(() => { const m = matchOf(r); if (!m) return <td style={td}>{matchMsg || "—"}</td>; const c = m.status === "match" ? ["#e3f6ea", "#16794a", "Match"] : m.status === "review" ? ["#fff3d6", "#9a6a00", "ต้องตรวจสอบ"] : ["#eef0f3", "#56606e", "ไม่พบ"]; return (<td style={td}><span style={{ padding: "2px 9px", borderRadius: "10px", fontSize: "12px", fontWeight: 600, background: c[0], color: c[1] }}>{c[2]}{m.matchCase ? ` · กรณี ${m.matchCase}` : ""}{m.partial && m.partial.found < m.partial.total ? ` · พบบางส่วน ${m.partial.found}/${m.partial.total} Invoice` : ""}</span>{m.bu && <span style={{ marginLeft: "6px", fontSize: "11.5px", fontWeight: 600 }}>BU {m.bu}</span>}{m.rows && m.rows.length > 0 && <div style={{ fontSize: "11px", color: "#556", marginTop: "3px" }}>Incomplete {m.rows.length} แถว: {m.rows.slice(0, 6).map((x) => `${x.invoice_ref || "—"} (${fmt(x.total)})`).join(", ")}{m.rows.length > 6 ? ` …+${m.rows.length - 6}` : ""} · {m.rows[0].supplier_code} · ชำระ {m.rows[0].payment_date || "—"}</div>}<div style={{ fontSize: "11px", color: "#778", marginTop: "2px" }}>{m.reasons.join(" ")}</div></td>); })()}
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}
            {!busy && rows.length === 0 && !error && <tr><td colSpan={11} style={{ ...td, textAlign: "center", color: "#888", padding: "30px" }}>ไม่พบไฟล์ PDF</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
