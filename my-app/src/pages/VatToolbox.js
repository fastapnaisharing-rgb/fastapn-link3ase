/* global BigInt */
import React from "react";
import { createPortal } from "react-dom";
import * as XLSX from "xlsx";
import { apiFetch } from "../api";
import { confirmDialog } from "../confirmDialog"; // MARKER_VATTOOLBOX_CONFIRMDIALOG_V1 : ใช้กล่องยืนยันของระบบแทน window.confirm
import { useAuth } from "../contexts/AuthContext"; // MARKER_VATTOOLBOX_PER_USER_V1 // MARKER_VAT_TOOLBOX_DRAFT_API_V1

// ============================================================================
// VAT Toolbox — src/pages/VatToolbox.js   (MARKER_VAT_TOOLBOX_V1)
// แทนเมนู "Monthly Report" (id เดิม vat-monthly-report) — รวมเครื่องมือ VAT เป็น Tab
//   Tab 1: VAT Swap Finder  (ทำงานจริง — คำนวณฝั่งเบราว์เซอร์ ไม่ใช้ AI/Backend)
//   Tab 2-3: Sheet Compare / Expiry Check (placeholder)
//   Tab 4: History (งานที่บันทึกไว้ เก็บใน localStorage ของเครื่องนี้)
//
// กติกา Swap (เบื้องต้น):
//   * Out = ชุดใบกำกับที่ Σ(เงินภาษี × Rate เดิม) = ยอดที่ต้องการ (±tol) จากไฟล์ Input ต้นทาง
//   * In  = ชุดใบกำกับ "คนละใบ" กับ Out ที่ Σ(เงินภาษี × Rate ใหม่) = ยอดเดียวกัน, ยังไม่หมดอายุในเดือนปลายทาง
//   * ใบกำกับใช้ได้ถึง เดือนที่ลงวันที่ + 6  → ช่วงที่ใช้ได้ที่เดือน m = [m-6 .. m]
//   * ชุด In ที่ถึงเดือนหมดอายุ ต้องสลับออก (เป็น Out ของขั้นถัดไป) ต่อทีละเดือนจนถึง Working Period
//   * Working Period: วันที่ > 10 = เดือนปัจจุบัน, ไม่เกิน 10 = เดือนก่อนหน้า
//   * จัดกลุ่มตามเลขที่ใบกำกับ (เอาทั้งใบหรือไม่เอาเลย), เฉพาะ Status = Balance (ถ้ามีคอลัมน์ Status)
// ============================================================================

const C = { navy: "#14532d", g: "#1e8e4a", gd: "#0f6b34", gl: "#e8f5ec", line: "#e3e8ee", soft: "#f5f8f6", text: "#1f2933", ok: "#1e7a3c", bad: "#b3261e", warn: "#a65f00", mute: "#6b7785" };
const LS_KEY = "vat_toolbox_swap_jobs_v1";

// ── เวลา/เดือน ──────────────────────────────────────────────────────────────
const ymStr = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
const parseYm = (s) => { const [y, m] = String(s).split("-"); return Number(y) * 12 + Number(m) - 1; };
const workingPeriod = (today = new Date()) => today.getFullYear() * 12 + today.getMonth() - (today.getDate() > 10 ? 0 : 1);
const fmt = (n) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

// อ่านค่า Period (ช่อง B ถัดจากคำว่า Period): เป็นวันที่จริง หรือข้อความเช่น 29-Feb-24 / 2024-02-29 / 29/02/2024
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function periodMonth(v) {
  if (v instanceof Date) { const d = new Date(v.getTime() + 12 * 3600e3); return d.getUTCFullYear() * 12 + d.getUTCMonth(); }
  if (typeof v !== "string") return null;
  const t = v.trim();
  let m = t.match(/^(\d{1,2})[-\/ ]([A-Za-z]{3})[A-Za-z]*[-\/ ](\d{2,4})$/);
  if (m && MON[m[2].toLowerCase()] != null) { let y = Number(m[3]); if (y < 100) y += 2000; return y * 12 + MON[m[2].toLowerCase()]; }
  m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return Number(m[1]) * 12 + Number(m[2]) - 1;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) { let y = Number(m[3]); if (y > 2400) y -= 543; return y * 12 + Number(m[2]) - 1; }
  return null;
}

// MARKER_VAT_TOOLBOX_OUT_FILE_V1 -- อ่านไฟล์รายงานแบบข้อความ (.out ของ Oracle / .txt / .lst / .dat / .tsv / .csv) เข้า Flow เดียวกับ Excel
const isTextReportName = (name) => /\.(out|txt|lst|dat|tsv|csv)$/i.test(String(name || ""));
function decodeReportText(buf) {
  const u8 = new Uint8Array(buf);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(u8).replace(/^﻿/, ""); } catch (e) { /* ไม่ใช่ UTF-8 -> ลอง windows-874 (ไทย) */ }
  try { return new TextDecoder("windows-874").decode(u8); } catch (e) { return new TextDecoder("utf-8").decode(u8); }
}
// MARKER_VATTOOLBOX_UNWRAP_EXCEL_TEXT_V2 -- เอา =" ... " ที่ไม่เกี่ยวข้องออกจากค่าในช่อง: ="321801" / ="A1801/SI26" / ="6910 021" / ข้อความที่มี " คลุมหรือค้างหัวท้าย / =123456
const unwrapXl = (v) => { let t = String(v == null ? "" : v).trim(); if (/^=\s*"/.test(t)) t = t.replace(/^=\s*"/, "").replace(/"\s*$/, ""); else if (/^".*"$/.test(t)) t = t.slice(1, -1); else if (/^=\d+$/.test(t)) t = t.slice(1); else if (/^[^"]*"$/.test(t)) t = t.slice(0, -1); else if (/^"[^"]*$/.test(t)) t = t.slice(1); return t.trim(); };
function reportCell(s) { // แปลงข้อความในช่องเป็น Date / ตัวเลข (เฉพาะที่หน้าตาเป็นวันที่/ยอดเงินชัดเจน) ที่เหลือคงเป็นข้อความ (เลขที่ใบกำกับห้ามเสียเลข 0 นำหน้า)
  let t = unwrapXl(s);
  if (t === "") return null;
  const yr = (v) => { let y = Number(v); if (y < 100) y += 2000; else if (y > 2400) y -= 543; return y; };
  let m = t.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4}|\d{2})$/);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return new Date(Date.UTC(yr(m[3]), Number(m[2]) - 1, Number(m[1])));
  m = t.match(/^(\d{1,2})[-\/ ]([A-Za-z]{3})[A-Za-z]*[-\/ ](\d{2,4})$/);
  if (m && MON[m[2].toLowerCase()] != null) return new Date(Date.UTC(yr(m[3]), MON[m[2].toLowerCase()], Number(m[1])));
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Date.UTC(yr(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (/^\(?-?\d{1,3}(,\d{3})+(\.\d+)?\)?-?$|^\(?-?\d+\.\d+\)?-?$/.test(t)) {
    const neg = /^\(.*\)-?$/.test(t) || /^-/.test(t) || /-$/.test(t);
    const n = Number(t.replace(/[(),-]/g, ""));
    if (!Number.isNaN(n)) return neg ? -n : n;
  }
  return t;
}
function splitCsvLine(l) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < l.length; i++) {
    const ch = l[i];
    if (q) { if (ch === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur); return out;
}
function textToAoa(buf) {
  const lines = decodeReportText(buf).split(/\r?\n/).map((l) => l.replace(/\f/g, ""));
  const sample = lines.filter((l) => l.trim() !== "").slice(0, 200);
  const cnt = (ch) => sample.filter((l) => l.includes(ch)).length;
  const need = Math.max(3, Math.floor(sample.length * 0.3));
  let mode = "spaces";
  if (cnt("\t") >= need) mode = "tab"; else if (cnt("|") >= need) mode = "pipe";
  else { const hl = sample.find((l) => l.includes("วันที่ใบกำกับภาษี")); if (hl && (hl.match(/,/g) || []).length >= 3 && !/\s{2,}/.test(hl)) mode = "csv"; }
  const aoa = lines.map((l) => {
    let parts;
    if (mode === "tab") parts = l.split("\t"); else if (mode === "pipe") parts = l.split("|"); else if (mode === "csv") parts = splitCsvLine(l); else parts = l.trim().split(/\s{2,}/);
    return parts.map(reportCell);
  });
  aoa.__mode = mode; aoa.__lines = lines.length;
  return aoa;
}

// ── อ่านไฟล์ Excel (รายงานภาษีซื้อ) ────────────────────────────────────────
// MARKER_VATTOOLBOX_BU_TAXCODE_RULE_V1 -- Tax Type จำแนกเหมือน VatController (VAT_WATCHLIST_TAXTYPE_RE): ลงท้าย -M = M ; ลงท้าย -N + นำหน้า A/T/F = A/T/F ; ไม่มีตัวนำหน้า = N
const taxClassOf = (tc) => { const m = String(tc || "").trim().match(/^([ATF]?).*-(N|M)\s+S?VAT\s*7$/i); if (!m) return null; return m[2].toUpperCase() === "M" ? "M" : (m[1] ? m[1].toUpperCase() : "N"); };
// MARKER_VATTOOLBOX_TAXTYPE_SELECT_V1 -- ตัวเลือก Tax Code: "type:N" = เลือกทั้ง Tax Type (รวมทุก Code ใน Type นั้น) ; ค่าอื่น = Tax Code ตัวเดียว
const tcMatch = (sel, tc) => !sel || (String(sel).startsWith("types:") ? String(sel).slice(6).split(",").includes(taxClassOf(tc)) : String(sel).startsWith("type:") ? taxClassOf(tc) === String(sel).slice(5) : tc === sel); // "types:N,T,M" = รวมหลาย Tax Type
const BU_TAXTYPE_RULES = { BTM: ["N", "A", "T", "F"] }; // BU -> Tax Type ที่ดึง (BU ที่ไม่อยู่ในรายการ = ดึงทุก Type)
const buOf = (x) => { if (!x) return ""; if (x.buc) return String(x.buc); const m = String(x.vendor || "").match(/^\s*([A-Za-z0-9_]{2,10})\s*-/); return m ? m[1].toUpperCase() : ""; }; // MARKER_VATTOOLBOX_BU_FROM_VENDOR_V1 -- BU จริงอยู่ที่หน้าชื่อผู้ค้า (เช่น "BTM-บริษัท…") ไม่ใช่คอลัมน์ Source (APN/B2M/DOC…) ระบบจับเองอัตโนมัติ
const buAllows = (x) => { const r = BU_TAXTYPE_RULES[buOf(x).toUpperCase()]; return !r || !x.tcode || r.includes(taxClassOf(x.tcode)); }; // MARKER_VATTOOLBOX_BU_RULE_AT_USE_V1 -- ใช้กฎ BU -> Tax Type ตอนใช้งานด้วย (งานที่กู้คืน/ไฟล์ที่อ่านไว้ก่อนมีกฎ ก็ไม่ปน M ของ BTM)
function parseWorkbook(buf, fileName) {
  const isText = isTextReportName(fileName); // MARKER_VAT_TOOLBOX_OUT_FILE_V1
  const wb = isText ? null : XLSX.read(buf, { type: "array", cellDates: true });
  const names = isText ? ["Detail"] : ["Detail", ...wb.SheetNames.filter((n) => n !== "Detail")].filter((n) => wb.SheetNames.includes(n));
  let textInfo = "";
  for (const n of names) {
    const aoa = isText ? textToAoa(buf) : XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null });
    if (!isText) aoa.forEach((r) => { if (r) for (let i = 0; i < r.length; i++) if (typeof r[i] === "string" && (r[i].includes('"') || r[i][0] === "=")) r[i] = unwrapXl(r[i]); }); // MARKER_VATTOOLBOX_UNWRAP_EXCEL_TEXT_V2
    if (isText) { const firstLine = (aoa.find((r) => r.some((v) => v != null)) || []).filter((v) => v != null).map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v))).join(" ¦ ").slice(0, 160); textInfo = ` [อ่านเป็นข้อความ: ${aoa.__lines} บรรทัด · แยกคอลัมน์แบบ ${aoa.__mode} · บรรทัดแรก: ${firstLine || "(ว่าง)"}]`; }
    let hr = -1, hdr = [];
    for (let r = 0; r < Math.min(aoa.length, 30); r++) {
      const vals = (aoa[r] || []).slice(0, 40).map((v) => String(v == null ? "" : v).trim());
      const hasInv = vals.some((v) => v.includes("เลขที่ใบกำกับภาษี") || /invoice\s*ref/i.test(v));
      if (vals.some((v) => v.includes("วันที่ใบกำกับภาษี")) && hasInv) { hr = r; hdr = vals; break; }
    }
    if (hr < 0) continue;
    const col = (...keys) => { const i = hdr.findIndex((v) => keys.every((k) => v.includes(k))); return i < 0 ? null : i; };
    const cBranch = col("สาขา") ?? 0, cDate = col("วันที่ใบกำกับภาษี"), cInv = col("เลขที่ใบกำกับภาษี") ?? hdr.findIndex((v) => /invoice\s*ref/i.test(v));
    const cVendor = col("ชื่อผู้ค้า"), cAmt = col("เงินภาษี"), cStatus = (() => { let i = hdr.findIndex((v) => v === "Status"); if (i < 0) i = hdr.findIndex((v) => v === "AP Invoice Status"); return i < 0 ? null : i; })();
    const cTcode = hdr.findIndex((v) => v.toLowerCase() === "tax code"), cSrc = hdr.findIndex((v) => v === "Source");
    const cRef = hdr.findIndex((v) => v === "เลขที่ใบแจ้งหนี้" || /^invoice\s*ref/i.test(v)), cMsg = hdr.findIndex((v) => v === "Message");
    const cRecv = hdr.findIndex((v) => v.startsWith("วันที่ (รับสินค้า)"));
    const cTaxId = col("TAX ID"), cVbr = col("BRANCH"), cHo = (() => { const i = hdr.findIndex((v) => v.toUpperCase() === "HO"); return i < 0 ? null : i; })(), cPre = col("มูลค่าสินค้า");
    if (cAmt == null) throw new Error(`ไม่พบคอลัมน์ "เงินภาษี" ในไฟล์ ${fileName}`);
    let period = null;
    for (let r = 0; r < hr; r++) {
      const row = aoa[r] || [];
      if (String(row[0] == null ? "" : row[0]).trim().toLowerCase() === "period") {
        const pm = periodMonth(row[1]);
        if (pm != null) period = Math.max(period ?? -1, pm);
      }
    }
    let hdrRate = null;
    for (const h of hdr) if (h.includes("ใช้สิทธิ์")) { const m = h.match(/(\d+(?:\.\d+)?)\s*%/); if (m) { hdrRate = parseFloat(m[1]); break; } }
    let lastHdr = hdr.length; while (lastHdr > 0 && !hdr[lastHdr - 1]) lastHdr--;
    const hasTaxInv = col("เลขที่ใบกำกับภาษี") != null; // MARKER_VAT_TOOLBOX_DRAFT_ROWS_V1 -- ไฟล์ที่ไม่มีคอลัมน์ใบกำกับภาษี (ใช้ Invoice Ref แทน) -> taxInv ว่าง ไม่ปนกับ ref
    const rows = []; const branches = new Set(); let total = 0;
    for (let r = hr + 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const dv = row[cDate], av = row[cAmt];
      if (!(dv instanceof Date) || av == null || av === "") continue;
      const amt = Number(av); if (Number.isNaN(amt)) continue;
      total++;
      if (cStatus != null && row[cStatus] !== "Balance" && row[cStatus] !== "Validated") continue;
      if (cMsg >= 0 && row[cMsg] != null && String(row[cMsg]).trim() !== "") continue; // Future Tax invoice Date / Over 6 Months
      const tcode = cTcode >= 0 && row[cTcode] != null ? String(row[cTcode]).trim() : "";
      if (cTcode >= 0 && !tcode) continue; // รายงานแบบ Reconcile: ต้องเป็นรายการที่มี Tax Code เท่านั้น
      { // MARKER_VATTOOLBOX_BU_TAXCODE_RULE_V1 -- ดึงเฉพาะ Tax Code ที่ BU กำหนด: BTM = ทุก Tax Type ยกเว้น M (N/A/T/F รวมกัน เพราะสลับข้ามกันได้) ; BU อื่นยังไม่มีกฎ = ดึงทุก Type (เพิ่มใน BU_TAXTYPE_RULES)
        const _src = buOf({ vendor: row[cVendor] == null ? "" : String(row[cVendor]) }).toUpperCase();
        const _rule = BU_TAXTYPE_RULES[_src];
        if (_rule && !_rule.includes(taxClassOf(tcode))) continue;
      }
      const d = new Date(dv.getTime() + 12 * 3600e3);
      const br = String(row[cBranch] == null ? "" : row[cBranch]).trim();
      branches.add(br);
      rows.push({ r: r + 1, inv: String(row[cInv]), taxInv: hasTaxInv ? String(row[cInv]) : "", ym: d.getUTCFullYear() * 12 + d.getUTCMonth(), date: d.toISOString().slice(0, 10), vendor: String(row[cVendor] == null ? "" : row[cVendor]), branch: br, raw: amt,
        orig: row.slice(0, lastHdr), bu: cSrc >= 0 && row[cSrc] != null ? String(row[cSrc]).trim() : "", tcode, ref: cRef >= 0 && row[cRef] != null ? String(row[cRef]) : "", ho: cHo != null && row[cHo] != null ? String(row[cHo]).trim() : "", taxid: cTaxId != null && row[cTaxId] != null ? String(row[cTaxId]) : "", vbr: cVbr != null && row[cVbr] != null ? String(row[cVbr]) : "", pre: cPre != null && row[cPre] !== "" && row[cPre] != null && !Number.isNaN(Number(row[cPre])) ? Number(row[cPre]) : null });
    }
    const maxYm = rows.reduce((a, x) => Math.max(a, x.ym), -1);
    if (period == null && cRecv >= 0) { // ไม่มีแถว Period → ใช้เดือนของวันที่รับสินค้าล่าสุด
      let mx = -1; for (let r = hr + 1; r < aoa.length; r++) { const v = (aoa[r] || [])[cRecv]; if (v instanceof Date) { const d = new Date(v.getTime() + 12 * 3600e3); mx = Math.max(mx, d.getUTCFullYear() * 12 + d.getUTCMonth()); } }
      if (mx >= 0) period = mx;
    }
    const buCodes = {}; rows.forEach((x) => { if (x.tcode) { (buCodes[buOf(x) || "-"] = buCodes[buOf(x) || "-"] || new Set()).add(x.tcode); } });
    Object.keys(buCodes).forEach((k) => { buCodes[k] = [...buCodes[k]].sort(); });
    let lastH = hdr.length; while (lastH > 0 && !hdr[lastH - 1]) lastH--;
    const meta = { hdr: (aoa[hr] || []).slice(0, lastH).map((v) => (v == null ? "" : v)), top: aoa.slice(0, hr).map((r) => [(r || [])[0] ?? null, (r || [])[1] ?? null]), cDate, invHdr: hdr[cInv] || "", buCodes };
    return { name: fileName, sheet: n, period, maxYm, hdrRate, total, rows, branches: [...branches].sort(), meta };
  }
  throw new Error(`ไม่พบ header (วันที่ใบกำกับภาษี / เลขที่ใบกำกับภาษี หรือ Invoice Ref.) ในไฟล์ ${fileName}${textInfo}`);
}

// ── Subset-sum (bitset BigInt) ──────────────────────────────────────────────
function searchSet(rows, target, tol, rate, exclude) {
  const groups = new Map();
  for (const x of rows) {
    if (exclude && exclude.has(x.inv)) continue;
    if (!groups.has(x.inv)) groups.set(x.inv, []);
    groups.get(x.inv).push({ ...x, amt: round2((x.raw * rate) / 100) });
  }
  const units = [...groups.entries()].map(([inv, v]) => ({ inv, tot: round2(v.reduce((a, x) => a + x.amt, 0)), rows: v }));
  const T = Math.round(target * 100), tl = Math.round(tol * 100), cap = T + tl;
  if (cap > 4000000) return { error: "ยอดเป้าหมายสูงเกินไปสำหรับการคำนวณในเบราว์เซอร์", units };
  const items = units.filter((u) => { const w = Math.round(u.tot * 100); return w > 0 && w <= cap; }).sort((a, b) => b.tot - a.tot);
  const mask = (1n << BigInt(cap + 1)) - 1n;
  let reach = 1n; const snaps = [], wts = [];
  for (const it of items) { const w = Math.round(it.tot * 100); snaps.push(reach); wts.push(w); reach = (reach | (reach << BigInt(w))) & mask; }
  let best = null;
  for (let s = T - tl; s <= T + tl; s++) if (s >= 0 && ((reach >> BigInt(s)) & 1n) === 1n && (best === null || Math.abs(s - T) < Math.abs(best - T))) best = s;
  if (best === null) return { units, set: null, count: units.length };
  const used = []; let s = best;
  for (let i = items.length - 1; i >= 0; i--) if (((snaps[i] >> BigInt(s)) & 1n) === 0n) { s -= wts[i]; used.push(items[i]); }
  return { units, set: used.reverse(), total: best / 100, diff: (best - T) / 100 };
}

const ymIdxOf = (v) => { const m = String(v || "").match(/^(\d{4})-(\d{1,2})/); return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : 0; }; // 'YYYY-MM' -> index เดือน
const branchHit = (sel, br) => { const t = String(sel || ""); if (t.indexOf(",") < 0) return br === t; return t.split(",").map((v) => v.trim()).filter(Boolean).indexOf(br) >= 0; }; // หลายสาขาคั่น , (Swap List ดึงมา)
const poolFrom = (files, branch, lo, hi, bu, tcode) => files.flatMap((f) => f.rows).filter((x) => buAllows(x) && (!branch || branchHit(branch, x.branch)) && (!bu || buOf(x) === bu) && tcMatch(tcode, x.tcode) && x.ym >= lo && x.ym <= hi);
const expiryOf = (set) => Math.min(...set.flatMap((u) => u.rows.map((x) => x.ym))) + 6;

// ── ประมวลผลทั้งเส้น (derived จาก input เท่านั้น) ───────────────────────────
function runChain(job, wp, back) { // MARKER_VATTOOLBOX_BACKSWAP_OUT_RANGE_V1 -- back = {lo,hi}: โหมดสลับย้อน -> ใบกำกับที่ใช้ต้องลงวันที่ในช่วง lo..hi (ไม่เกินเดือนที่สลับเข้า)
  const p = job.params, tol = Number(p.tol) || 0.05, target = Number(p.target);
  const src = job.sourceFiles;
  const P0 = Math.max(...src.map((f) => (f.period != null ? f.period : f.maxYm)));
  const res = { P0, wp, steps: [], status: "running", message: "" };
  // MARKER_VATTOOLBOX_OUT_FROM_WP_V1: Out ต้องเป็นใบที่ยังยื่นได้ ณ Working Period (ลงวันที่ >= wp-6) แล้วข้ามไปเดือน wp ทันที
  const outLo = Math.max(P0 - 6, wp - 6);
  const outPool = poolFrom(src, p.branch, back ? back.lo : outLo, back ? back.hi : P0, p.bu, p.tcode);
  // ตรวจว่าไฟล์ Input มีใบกำกับเดือนเก่าสุดที่ยังยื่นได้ (wp-6) หรือไม่ ก่อนค้นหา Out
  const nLo = outPool.filter((x) => x.ym === outLo).length;
  res.outLoN = nLo; res.outLo = outLo;
  {
    if (!back && nLo === 0 && P0 - 6 <= outLo) { res.outPoolN = outPool.length; res.status = "out-nomatch"; res.message = `ไม่พบใบกำกับเดือน ${ymStr(outLo)}${p.branch ? ` ของสาขา ${p.branch}` : ""} ในไฟล์ Input (Working Period ${ymStr(wp)} ใช้ได้ตั้งแต่ใบกำกับเดือน ${ymStr(outLo)}) — ตรวจสอบว่าไฟล์ Input ครบหรือไม่`; return res; }
  }
  res.outPoolN = outPool.length; res.srcN = src.reduce((a, f) => a + f.rows.length, 0);
  const _swapInv = new Set((Array.isArray(p.swapIn) ? p.swapIn : []).map((x) => String(x.tax_invoice_no || x.invoice_ref || x.id))); // MARKER_VATTOOLBOX_IRON_RULE_OUT_NE_IN_V1 -- กฎเหล็ก: Out กับ In ต้องคนละใบ (รวมใบจาก Swap List ที่เป็น In ด้วย)
  const o = searchSet(outPool, target, tol, Number(p.rateOld), _swapInv);
  if (o.error) { res.status = "error"; res.message = o.error; return res; }
  if (!o.set) { res.status = "out-nomatch"; res.message = `ไม่พบชุด Out ที่รวมได้ ${fmt(target)} ± ${tol} (ช่วงใบกำกับ ${ymStr(outLo)} ถึง ${ymStr(P0)}) · พบใบกำกับเดือน ${ymStr(outLo)} จำนวน ${nLo} แถว — ตรวจสอบว่าไฟล์เดือนนี้ครบหรือไม่`; return res; }
  res.out0 = o;
  if (back) { // MARKER_VATTOOLBOX_BACKSWAP_STEP_V1 -- สลับย้อน: Out = ชุดจากไฟล์ (ลงวันที่ไม่เกินเดือนเป้าหมาย) ; In = ชุดคนละใบกับ Out จากช่วงเดียวกัน -> เป็น 1 ขั้นที่เดือนเป้าหมาย (Target Input)
    const rIn = searchSet(outPool, target, tol, Number(p.rateNew) || 100, new Set(o.set.map((u) => u.inv)));
    const bstep = { k: 0, month: back.hi, expiry: expiryOf(o.set), out: o.set, outRate: Number(p.rateOld), rateIn: Number(p.rateNew) || 100, files: [], fromBack: true, poolN: outPool.length };
    res.steps.push(bstep);
    if (rIn.error) { bstep.state = "error"; res.status = "error"; res.message = rIn.error; return res; }
    if (!rIn.set) { bstep.state = "nomatch"; res.status = "nomatch"; res.message = `เดือน ${ymStr(back.hi)}: ไม่พบชุด In ที่เป็นคนละใบกับ Out และรวมได้ ${fmt(target)} ± ${tol} — ลองเลือกเดือนอื่น`; return res; }
    bstep.state = "match"; bstep.inSet = rIn; res.status = "done"; res.message = `สลับย้อนเข้าเดือน ${ymStr(back.hi)} — ใบกำกับลงวันที่ไม่เกินเดือนนี้ · In เป็นคนละใบกับ Out`; return res;
  }
  // MARKER_VATTOOLBOX_SWAPIN_V2 : ดึงจาก Swap List -> รายการใน Swap List คือชุด In ของขั้นสลับ (ไม่ต้องหาจากไฟล์) ; Out = ชุดที่หาได้จาก Input เดือนต้นทาง
  const sy = Number(p.startYm) || P0;
  const rcv = (x) => { const m = String((x && x.receive_date) || "").match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : new Date(Date.UTC(Math.floor(sy / 12), (sy % 12) + 1, 0)).toISOString().slice(0, 10); };
  const swapUnits = Array.isArray(p.swapIn) && p.swapIn.length ? p.swapIn.map((x) => { const inv = String(x.tax_invoice_no || x.invoice_ref || x.id); const v = round2(Math.abs(Number(x.vat) || 0)); return { inv, tot: v, rows: [{ r: "", inv, taxInv: inv, ym: sy, date: rcv(x), vendor: x.vendor || "", branch: x.branch || "", raw: v, amt: v, orig: null, bu: x.bu || "", tcode: "", ref: x.invoice_ref || "", ho: "", taxid: "", vbr: "" }] }; }) : null;
  let curOut = o.set, prev = P0, prevRate = Number(p.rateOld);
  for (let k = 0; k < 24; k++) {
    const E = expiryOf(curOut);
    const minM = k === 0 ? P0 : prev + 1;
    const m = Math.max(Math.min(E, wp), minM);
    const sf = (job.stepFiles && job.stepFiles[k]) || [];
    const rateIn = Number((job.stepRates && job.stepRates[k]) || (k === 0 ? p.rateNew : prevRate)) || 100;
    const step = { k, month: m, expiry: E, out: curOut, outRate: prevRate, rateIn, files: sf };
    res.steps.push(step);
    if (swapUnits && k === 0) { // In = รายการจาก Swap List
      step.state = "match"; step.files = []; step.rateIn = 100; step.fromSwapList = true;
      step.inSet = { set: swapUnits, total: round2(swapUnits.reduce((a, u) => a + u.tot, 0)), diff: 0 };
      if (m >= wp) { res.status = "done"; res.message = `ถึงเดือนปัจจุบัน (Working Period ${ymStr(wp)}) แล้ว — In = รายการจาก Swap List`; return res; }
      curOut = swapUnits; prev = m; prevRate = 100; continue;
    }
    if (!sf.length) { step.state = "need-file"; res.status = "need-file"; res.message = `ต้องการ Input เดือน ${ymStr(m)} เพื่อหาชุด In`; return res; }
    const ex = new Set(curOut.map((u) => u.inv));
    const inPool = poolFrom(sf, p.branch, m - 6, m, p.bu, p.tcode);
    step.poolN = inPool.length; step.fileN = sf.reduce((a, f) => a + f.rows.length, 0);
    const r = searchSet(inPool, target, tol, rateIn, ex);
    if (r.error) { step.state = "error"; res.status = "error"; res.message = r.error; return res; }
    if (!r.set) { step.state = "nomatch"; res.status = "nomatch"; res.message = `เดือน ${ymStr(m)}: ไม่พบชุด In ที่รวมได้ ${fmt(target)} ± ${tol} — เพิ่มไฟล์เดือนอื่นเข้ามาแล้วคำนวณใหม่`; return res; }
    step.state = "match"; step.inSet = r;
    if (m >= wp) { res.status = "done"; res.message = `ถึงเดือนปัจจุบัน (Working Period ${ymStr(wp)}) แล้ว`; return res; }
    curOut = r.set; prev = m; prevRate = rateIn;
  }
  res.status = "error"; res.message = "จำนวนขั้นเกินกำหนด"; return res;
}

// ── Export Excel (รูปแบบเดียวกับชีต Detail ของรายงาน) ───────────────────────
const NAVY = "FF14213D";
const toDate = (v) => (typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(v) : v);
async function exportWorkbook(job, res) {
  const ExcelJS = (await import("exceljs")).default || (await import("exceljs"));
  const wb = new ExcelJS.Workbook();
  const p = job.params;
  const files = [...job.sourceFiles, ...job.stepFiles.flat().filter(Boolean)];
  const meta = (files.find((f) => f.meta) || {}).meta || { hdr: ["สาขา", "ชื่อผู้ประกอบการ", "วันที่ (รับสินค้า)", "GRT_No. (รับสินค้า)", "วันที่ใบกำกับภาษี", "เลขที่ใบกำกับภาษี", "ชื่อผู้ค้า", "TAX ID", "HO", "BRANCH", "รายการ", "ภาษีซื้อที่ชำระ(มูลค่าสินค้า)", "ภาษีซื้อที่ชำระ(เงินภาษี)"], top: [], cDate: 4 };
  const ws0 = wb.addWorksheet("Summary");
  [["VAT Swap Finder — สรุป"], ["ยอดเป้าหมาย", Number(p.target)], ["Rate เดิม %", Number(p.rateOld)], ["Rate ใหม่ %", Number(p.rateNew)], ["สาขา", p.branch || "ทั้งหมด"], ["Working Period", ymStr(res.wp)], [],
    ["ขั้น", "เดือนที่สลับ", "Out (ใบ)", "Out รวม", "In (ใบ)", "In รวม", "Rate In %"],
    ...res.steps.map((s) => [s.k + 1, ymStr(s.month), s.out.length, round2(s.out.reduce((a, u) => a + u.tot, 0)), s.inSet ? s.inSet.set.length : 0, s.inSet ? s.inSet.total : 0, s.rateIn])].forEach((r) => ws0.addRow(r));
  ws0.getRow(1).font = { bold: true, size: 13 };
  const hr0 = ws0.getRow(8); hr0.font = { bold: true, color: { argb: "FFFFFFFF" } }; hr0.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  ws0.columns = [{ width: 18 }, { width: 14 }, { width: 10 }, { width: 14 }, { width: 10 }, { width: 14 }, { width: 10 }];
  const nCol = meta.hdr.length;
  const mmyyyy = (i) => `${String((i % 12) + 1).padStart(2, "0")}.${Math.floor(i / 12)}`;
  res.steps.forEach((s, si) => {
    // ชื่อชีต: เดือนต้นทางของ Out  to  เดือนที่สลับ  เช่น 04.2026 to 10.2026
    const fromM = si === 0 ? res.P0 : res.steps[si - 1].month;
    const ws = wb.addWorksheet(`${mmyyyy(fromM)} to ${mmyyyy(s.month)}`);
    const monthEnd = new Date(Date.UTC(Math.floor(s.month / 12), (s.month % 12) + 1, 0));
    ws.addRow(["DETAIL OF ACCOUNT"]); ws.getRow(1).font = { bold: true };
    ws.addRow([]);
    const tops = (meta.top || []).slice(2, 7);
    ["Company ", "Branch ", "Account code ", "Account name", "Period"].forEach((lab, i) => {
      const t = tops[i]; const v = lab === "Period" ? monthEnd : t ? toDate(t[1]) : null;
      ws.addRow([lab, v]); if (lab === "Period") ws.getCell(`B${ws.rowCount}`).numFmt = "dd-mmm-yy";
    });
    ws.addRow([]);
    const section = (title, set, rate) => {
      const tr = ws.addRow([title]); tr.font = { bold: true, color: { argb: "FF0F766E" }, size: 12 };
      const h = ws.addRow([...meta.hdr, `ยอด @${rate}%`, "แถวไฟล์ต้นทาง"]);
      h.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } }; c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; });
      h.height = 30;
      const first = ws.rowCount + 1; let tax = 0, amt = 0;
      set.forEach((u) => u.rows.forEach((x) => {
        const o = x.orig ? x.orig.map(toDate) : (() => { const a = Array(nCol).fill(null); a[0] = x.branch; a[4] = new Date(x.date); a[5] = x.inv; a[6] = x.vendor; a[7] = x.taxid; a[9] = x.vbr; a[nCol - 1] = x.raw; return a; })();
        while (o.length < nCol) o.push(null);
        const r = ws.addRow([...o.slice(0, nCol), x.amt, x.r]);
        [2, 4].forEach((ci) => { if (r.getCell(ci + 1).value instanceof Date) r.getCell(ci + 1).numFmt = "d-mmm-yy"; });
        tax += x.raw; amt += x.amt;
      }));
      const last = ws.rowCount;
      const tot = ws.addRow(["Total", ...Array(nCol - 1).fill(null), round2(amt)]);
      tot.font = { bold: true }; tot.eachCell((c) => { c.border = { top: { style: "thin" } }; });
      ws.addRow([]);
      return { first, last, taxTotal: round2(tax), amt: round2(amt) };
    };
    section("Out (สลับออก)", s.out, s.outRate);
    if (s.inSet && s.inSet.set && s.inSet.set.length) section("In (สลับเข้า)", s.inSet.set, s.rateIn); // MARKER_VATTOOLBOX_IN_OPTIONAL_V1 -- ไม่จำเป็นต้องมี In เสมอไป: ไม่มีชุด In = ไม่แสดงส่วน In เลย
    ws.columns = meta.hdr.map((h, i) => ({ width: i === 1 ? 26 : i === 6 || i === 10 ? 34 : 15 })).concat([{ width: 16 }, { width: 12 }]);
  });
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a"); a.href = url; a.download = `VAT_Swap_${p.target}_${ymStr(res.wp)}.xlsx`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ── Storage (เครื่องนี้เท่านั้น) ────────────────────────────────────────────
const loadJobs = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]").filter((j) => !isExpired(j)); } catch (e) { return []; } };
const saveJobs = (j) => { try { localStorage.setItem(LS_KEY, JSON.stringify(j)); return true; } catch (e) { return false; } };

// MARKER_VATTOOLBOX_AUTODRAFT_V1 : เก็บงานที่กำลังทำอยู่ (รวมไฟล์ที่โยน) ลง IndexedDB อัตโนมัติ — refresh/สลับหน้าแล้วไม่หาย ไม่ต้องกดบันทึก
const DRAFT_DB = "vat_toolbox_swap_draft", DRAFT_STORE = "kv", DRAFT_KEY = "current";
const draftDb = () => new Promise((res, rej) => {
  try {
    const rq = indexedDB.open(DRAFT_DB, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore(DRAFT_STORE);
    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
  } catch (e) { rej(e); }
});
const draftGet = async (k = DRAFT_KEY) => { try { const db = await draftDb(); return await new Promise((res) => { const r = db.transaction(DRAFT_STORE).objectStore(DRAFT_STORE).get(k); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); }); } catch (e) { return null; } };
const draftPut = async (v, k = DRAFT_KEY) => { try { const db = await draftDb(); await new Promise((res) => { const tx = db.transaction(DRAFT_STORE, "readwrite"); if (v == null) tx.objectStore(DRAFT_STORE).delete(k); else tx.objectStore(DRAFT_STORE).put(v, k); tx.oncomplete = () => res(); tx.onerror = () => res(); }); } catch (e) { /* ไม่เป็นไร */ } };

// ── MARKER_VAT_TOOLBOX_DB_DRAFT_V1 : Draft เก็บใน DB (ตาราง vat_swap_drafts) แบบชั่วคราว ─────────────
//   * กดบันทึก  -> เก็บ Draft ลง DB (ยังไม่มีวันหมดอายุ)  /  ถ้า DB ใช้ไม่ได้ ถอยไปเก็บในเครื่องนี้เหมือนเดิม
//   * กด Export -> ตั้ง expires_at = ตอนนี้ + 7 วัน แล้วระบบล้างให้อัตโนมัติ (purge_expired_vat_swap_drafts)
//   * รายการที่หมดอายุแล้วไม่แสดงในรายการ "งานที่บันทึกไว้"
const DRAFT_API = "/vat-swap-drafts"; // MARKER_VAT_TOOLBOX_DRAFT_API_V1 -- Backend: src/routes/vatSwapDrafts.js
const EXPIRE_DAYS_AFTER_EXPORT = 7; // Export = ทำเสร็จแล้ว -> เริ่มนับ 7 วันแล้วลบ ; ยังไม่ Export = ยังไม่เสร็จ ไม่มีวันหมดอายุ
const isExpired = (j) => !!(j && j.expiresAt && Number(j.expiresAt) <= Date.now());
const cloudToItem = (r) => ({ id: r.id, name: r.name, status: r.status, lastMonth: r.last_month, savedAt: r.saved_at ? Date.parse(r.saved_at) : null, exportedAt: r.exported_at ? Date.parse(r.exported_at) : null, expiresAt: r.expires_at ? Date.parse(r.expires_at) : null, owner: r.username, cloud: true });
// รายการใบกำกับรายแถว ตามรูปแบบ Input VAT Reconcile: เลขที่ใบกำกับภาษี กับ Invoice Ref. แยกคอลัมน์ (Ref ว่างได้)
//   เก็บเฉพาะแถวของ Tax Code ที่เลือกในงาน (ไม่เลือก = ทุก Tax Code) ; tax_type = ตัวอักษรหลังขีดของ Tax Code (321801-M SVAT7 -> M)
const taxTypeOf = (tc) => { const m = String(tc || "").match(/-([A-Za-z])(?:\s|$)/); return m ? m[1].toUpperCase() : null; };
const draftRows = (item) => {
  const tc = item.params && item.params.tcode ? String(item.params.tcode) : "";
  const files = [...(item.sourceFiles || []), ...(item.stepFiles || []).flat(), ...(item.extra || [])];
  const out = [];
  files.forEach((f) => (f.rows || []).forEach((x) => {
    if (tc && !tcMatch(tc, x.tcode)) return;
    out.push({ file_name: f.name || "", file_period: f.period != null ? ymStr(f.period) : null, src_row: x.r, source: x.bu || null, branch: x.branch || null,
      tax_invoice_date: x.date || null, tax_invoice_no: (x.taxInv !== undefined ? x.taxInv : x.inv) || null, invoice_ref: x.ref ? x.ref : null, vendor_name: x.vendor || null, tax_id: x.taxid || null, vendor_branch: x.vbr || null, ho: x.ho || null,
      tax_code: x.tcode || null, tax_type: taxTypeOf(x.tcode), vat_amount: x.raw, base_amount: x.pre != null ? x.pre : null });
  }));
  return out;
};
// บันทึกตัวงาน + รายการรายแถว (ส่งเป็นชุด ชุดละ 1,000 แถว) -> true/false
async function cloudSaveJob(item) {
  try {
    await apiFetch(`${DRAFT_API}/${encodeURIComponent(item.id)}`, { method: "PUT", body: JSON.stringify({ job: item, name: item.name, status: item.status, lastMonth: item.lastMonth, savedAt: item.savedAt }) });
    const rows = draftRows(item);
    if (!rows.length) { await apiFetch(`${DRAFT_API}/${encodeURIComponent(item.id)}/rows`, { method: "POST", body: JSON.stringify({ replace: true, rows: [] }) }); return true; }
    for (let i = 0; i < rows.length; i += 1000) {
      await apiFetch(`${DRAFT_API}/${encodeURIComponent(item.id)}/rows`, { method: "POST", body: JSON.stringify({ replace: i === 0, rows: rows.slice(i, i + 1000) }) });
    }
    return true;
  } catch (e) { return false; }
}
async function cloudExportJob(item) { // บันทึกตัวงาน แล้วสั่ง Backend ตั้งเวลาลบ -> วันหมดอายุ (ms) หรือ null
  try {
    if (!(await cloudSaveJob(item))) return null;
    const r = await apiFetch(`${DRAFT_API}/${encodeURIComponent(item.id)}/export`, { method: "POST", body: "{}" });
    return r && r.expiresAt ? Date.parse(r.expiresAt) : null;
  } catch (e) { return null; }
}
async function cloudListJobs() {
  try {
    const r = await apiFetch(DRAFT_API);
    if (!r || !Array.isArray(r.items)) return null;
    return r.items.map(cloudToItem).filter((x) => !isExpired(x));
  } catch (e) { return null; }
}
async function cloudGetJob(id) {
  try {
    const r = await apiFetch(`${DRAFT_API}/${encodeURIComponent(id)}`);
    if (!r || !r.job) return null;
    const x = cloudToItem(r);
    if (isExpired(x)) return null;
    return { ...r.job, id: r.id, expiresAt: x.expiresAt, exportedAt: x.exportedAt };
  } catch (e) { return null; }
}
async function cloudDeleteJob(id) { try { await apiFetch(`${DRAFT_API}/${encodeURIComponent(id)}`, { method: "DELETE" }); } catch (e) { /* ไม่เป็นไร */ } }

// ── UI (แนว D: ตั้งเงื่อนไข + จุดโยนไฟล์ / Timeline / Monitor) ───────────────
const card = { background: "white", border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, minWidth: 0 };
const inp = { padding: "9px 11px", border: "1px solid #cfd8e0", borderRadius: 8, fontSize: 14, fontFamily: "inherit", width: "100%", boxSizing: "border-box", background: "#fbfcfd", outline: "none" };
const btn = (primary, disabled) => ({ padding: "9px 18px", borderRadius: 8, border: primary ? "none" : "1px solid #cfd8e0", background: disabled ? "#e3e8ee" : primary ? C.g : "white", color: disabled ? "#9aa7b3" : primary ? "white" : C.text, cursor: disabled ? "not-allowed" : "pointer", fontSize: 13.5, fontWeight: 600, fontFamily: "inherit" });
const Lbl = ({ children }) => <div style={{ fontSize: 12, fontWeight: 600, color: C.mute, marginBottom: 5 }}>{children}</div>;

// MARKER_VATTOOLBOX_BRANCH_COMBO_V1 : ช่องสาขาแบบพิมพ์ค้นหาได้ แสดงเริ่มต้นแค่ 10 รายการ
const BRANCH_COMBO_LIMIT = 10;
const BranchCombo = ({ value, options, disabled, onChange }) => {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [hi, setHi] = React.useState(0);
  const [dirty, setDirty] = React.useState(false); // MARKER_BRANCHCOMBO_CLEAR_V1 : พิมพ์/ลบเองแล้ว
  const wrapRef = React.useRef(null);
  const norm = (x) => String(x || "").trim().toLowerCase();
  const matches = React.useMemo(() => {
    const k = dirty ? norm(q) : "";
    return k ? options.filter((b) => norm(b).includes(k)) : options;
  }, [options, q, dirty]);
  const shown = matches.slice(0, BRANCH_COMBO_LIMIT);
  const pick = (v) => { onChange(v); setQ(""); setDirty(false); setOpen(false); };
  const commitTyped = () => {
    const k = norm(q);
    if (!dirty) { setQ(""); setOpen(false); return; }
    if (!k) { onChange(""); setQ(""); setDirty(false); setOpen(false); return; } // ลบจนว่าง = ทุกสาขา
    const exact = options.find((b) => norm(b) === k);
    if (exact) onChange(exact);
    else if (matches.length === 1) onChange(matches[0]);
    else onChange(String(q).trim()); // พิมพ์สาขาที่ไม่มีในไฟล์ -> เก็บตามที่พิมพ์ (ขึ้นเตือนสีแดง) ไม่แอบย้อนกลับเป็นค่าเดิม
    setQ(""); setDirty(false); setOpen(false);
  };
  React.useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) { if (dirty) commitTyped(); else { setQ(""); setOpen(false); } } };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dirty, q]);
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, shown.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (open && dirty && q && shown[hi]) pick(shown[hi]); else commitTyped(); }
    else if (e.key === "Escape") { setQ(""); setDirty(false); setOpen(false); }
  };
  const unknown = !!value && options.length > 0 && String(value).split(",").map((v) => v.trim()).filter(Boolean).some((v) => !options.includes(v));
  const itemSt = (active) => ({ padding: "7px 11px", cursor: "pointer", fontSize: 14, background: active ? "#e8f1fb" : "transparent" });
  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input
        style={unknown ? { ...inp, borderColor: "#b3261e", background: "#fdecea" } : inp}
        title={unknown ? `ไม่พบสาขา ${value} ในไฟล์ Input` : undefined}
        disabled={disabled}
        value={open ? q : (value || "")}
        placeholder={open ? "ทุกสาขา — พิมพ์เพื่อค้นหา" : "ทุกสาขา"}
        onFocus={() => { setOpen(true); setQ(String(value || "")); setDirty(false); setHi(0); }}
        onChange={(e) => { setQ(e.target.value); setDirty(true); setOpen(true); setHi(0); }}
        onKeyDown={onKey}
      />
      {unknown && !open && <div style={{ fontSize: 11.5, color: "#b3261e", marginTop: 3 }}>ไม่พบสาขา {value} ในไฟล์ Input</div>}
      {open && !disabled && (
        <div style={{ position: "absolute", zIndex: 50, left: 0, right: 0, top: "100%", marginTop: 2, background: "#fff", border: "1px solid #cfd8e0", borderRadius: 8, boxShadow: "0 6px 18px rgba(0,0,0,.15)", maxHeight: 340, overflowY: "auto" }}>
          <div style={itemSt(false)} onMouseDown={(e) => { e.preventDefault(); pick(""); }}>ทุกสาขา</div>
          {shown.map((b, idx) => (
            <div key={b} style={{ ...itemSt(idx === hi), fontWeight: b === value ? 700 : 400 }} onMouseEnter={() => setHi(idx)} onMouseDown={(e) => { e.preventDefault(); pick(b); }}>{b}</div>
          ))}
          {shown.length === 0 && <div style={{ padding: "7px 11px", fontSize: 13, color: "#8a97a3" }}>ไม่พบสาขาที่ตรงกับ "{q}"</div>}
          {matches.length > BRANCH_COMBO_LIMIT && <div style={{ padding: "6px 11px", fontSize: 12, color: "#8a97a3", borderTop: "1px solid #eef2f5" }}>แสดง {BRANCH_COMBO_LIMIT} จาก {matches.length} รายการ — พิมพ์เพื่อกรองเพิ่ม</div>}
        </div>
      )}
    </div>
  );
};
const pill = (t, bg, fg) => <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 600, background: bg, color: fg, whiteSpace: "nowrap" }}>{t}</span>;
const mono = { fontFamily: "ui-monospace, Consolas, monospace", fontVariantNumeric: "tabular-nums" };

function Dropzone({ onFiles, busy, hasFiles }) {
  const ref = React.useRef(null);
  const [over, setOver] = React.useState(false);
  return (
    <div onClick={() => ref.current && ref.current.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const fs = [...e.dataTransfer.files]; if (fs.length) onFiles(fs); }}
      style={{ flex: 1, minHeight: hasFiles ? 44 : 64, border: `2px dashed ${C.g}`, background: over ? "#d7eedf" : C.gl, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", cursor: "pointer", color: C.gd, fontWeight: 600, fontSize: 13.5, padding: 8 }}>
      <input ref={ref} type="file" accept=".xlsx,.xlsm,.xls,.out,.txt,.lst,.dat,.tsv,.csv" multiple style={{ display: "none" }} onChange={(e) => { const fs = [...e.target.files]; e.target.value = ""; if (fs.length) onFiles(fs); }} />
      <div>{busy ? "กำลังอ่านไฟล์…" : hasFiles ? "＋ โยนไฟล์เดือนถัดไปที่นี่" : <>ลากไฟล์รายงานภาษีซื้อมาวางที่นี่<br />หรือคลิกเพื่อเลือกไฟล์</>}
        {!busy && !hasFiles && <div style={{ fontWeight: 400, fontSize: 12, color: C.mute, marginTop: 6 }}>ไฟล์ทุกเดือนโยนที่จุดเดียว · ระบบอ่าน Period ในรายงานแล้วจัดเข้าเดือนให้เอง</div>}</div>
    </div>
  );
}

// ตารางรายละเอียด Out / In
const fmtCell = (v) => {
  if (v == null || v === "") return "";
  if (v instanceof Date || (typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v))) { const d = new Date(v); return Number.isNaN(d.getTime()) ? String(v) : new Date(d.getTime() + 12 * 3600e3).toISOString().slice(0, 10); }
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : fmt(v);
  return String(v);
};
const COL_LS = "vat_toolbox_cols_v5"; // v3: แยก Tax ID / สาขา เป็นสองคอลัมน์ ; v4: ค่าเริ่มต้นไม่แสดง "แถวไฟล์" / Tax Code / BU (ยังเปิดได้จากปุ่ม คอลัมน์)
const BASE_COLS = [
  { id: "inv", label: "เลขที่ใบกำกับภาษี" }, { id: "date", label: "วันที่ใบกำกับ" }, { id: "vendor", label: "ผู้ค้า" }, { id: "ref", label: "Invoice Ref." }, { id: "taxid", label: "Tax ID" }, { id: "vbr", label: "สาขา" },
  { id: "pre", label: "มูลค่าก่อน VAT", num: true }, { id: "raw", label: "เงินภาษี", num: true }, { id: "rate", label: "Rate", num: true }, { id: "amt", label: "ยอด", num: true },
  { id: "exp", label: "ใช้ได้ถึง" }, { id: "cnt", label: "จำนวนรายการ" }, { id: "row", label: "แถวไฟล์" }, // MARKER_VATTOOLBOX_ROWCOUNT_COL_V1 -- จำนวนรายการ (แถว) ของใบกำกับเลขนี้ที่ถูกนับรวมมา
  { id: "tcode", label: "Tax Code" }, { id: "bu", label: "BU" },
];
const DEFAULT_COLS = BASE_COLS.map((c) => c.id).filter((id) => id !== "bu" && id !== "row" && id !== "tcode"); // MARKER_VATTOOLBOX_DEFAULT_COLS_V4
// Invoice Ref. แสดงเสมอ (ไม่ผูกกับ Tax Code) และวางต่อจากผู้ค้า ; Tax Code / BU แสดงเมื่อไฟล์มีข้อมูล BU
const showCols2 = (sel, hasTc) => {
  const ids = sel.filter((id) => hasTc || (id !== "tcode" && id !== "bu"));
  if (!ids.includes("ref")) return ids;
  const rest = ids.filter((id) => id !== "ref"), i = rest.indexOf("vendor");
  return i < 0 ? ids : [...rest.slice(0, i + 1), "ref", ...rest.slice(i + 1)];
};
// MARKER_VATTOOLBOX_COLS_V2 : ความกว้างคอลัมน์คงที่ (ผู้ค้ากินที่เหลือ) ไม่ให้เบียดกัน
const COLW = { inv: 175, date: 120, ref: 210, taxid: 155, vbr: 88, pre: 140, raw: 128, rate: 76, amt: 140, exp: 104, cnt: 120, row: 96, tcode: 200, bu: 120 };
const widthOf = (c) => COLW[c.id] || 200;
const colW = (defs) => 44 + 340 + defs.filter((c) => c.id !== "vendor").reduce((a, c) => a + widthOf(c), 0);
function DetailTable({ set, rate, label, target, hdr, cols, invLabel }) {
  const wrapRef = React.useRef(null);
  const [selSum, setSelSum] = React.useState(null);
  const [selRect, setSelRect] = React.useState(null);
  const [ctx, setCtx] = React.useState(null); // MARKER_VATTOOLBOX_RIGHTCLICK_COPY_V1 -- คลิกขวาในตาราง Monitor -> เมนู คัดลอก
  React.useEffect(() => { if (!ctx) return undefined; const close = () => setCtx(null); const esc = (e) => { if (e.key === "Escape") setCtx(null); }; window.addEventListener("click", close); window.addEventListener("scroll", close, true); window.addEventListener("keydown", esc); return () => { window.removeEventListener("click", close); window.removeEventListener("scroll", close, true); window.removeEventListener("keydown", esc); }; }, [ctx]);
  React.useEffect(() => { // ลากคลุมตัวเลขในตาราง → รวมยอดให้ (เหมือนแถบสถานะ Excel)
    let t = null;
    const cellOf = (n) => { const el = n && (n.nodeType === 3 ? n.parentElement : n); return el && el.closest ? el.closest("td[data-r]") : null; };
    const calc = () => {
      const sel = window.getSelection && window.getSelection();
      const root = wrapRef.current;
      if (!sel || sel.isCollapsed || !root || !sel.rangeCount || !root.contains(sel.getRangeAt(0).commonAncestorContainer)) { setSelSum(null); setSelRect(null); return; }
      const a = cellOf(sel.anchorNode), f = cellOf(sel.focusNode);
      if (!a || !f) { setSelSum(null); setSelRect(null); return; }
      const r1 = Math.min(+a.dataset.r, +f.dataset.r), r2 = Math.max(+a.dataset.r, +f.dataset.r), c1 = Math.min(+a.dataset.c, +f.dataset.c), c2 = Math.max(+a.dataset.c, +f.dataset.c);
      const vals = [];
      root.querySelectorAll("td[data-num]").forEach((td) => {
        const r = +td.dataset.r, c = +td.dataset.c;
        if (r < r1 || r > r2 || c < c1 || c > c2) return;
        const txt = td.textContent.trim().replace(/,/g, "");
        if (/^-?\d+(\.\d+)?$/.test(txt)) vals.push(Number(txt));
      });
      setSelRect({ r1, r2, c1, c2 });
      if (!vals.length) { setSelSum(null); return; }
      const total = vals.reduce((x, y) => x + y, 0);
      setSelSum({ n: vals.length, sum: round2(total), avg: round2(total / vals.length), min: Math.min(...vals), max: Math.max(...vals) });
    };
    const onChange = () => { clearTimeout(t); t = setTimeout(calc, 80); };
    document.addEventListener("selectionchange", onChange);
    return () => { clearTimeout(t); document.removeEventListener("selectionchange", onChange); };
  }, []);
  const rows = set.flatMap((u) => u.rows);
  const cntOf = {}; set.forEach((u) => { cntOf[u.inv] = u.rows.length; });
  const sum = (k) => round2(rows.reduce((a, x) => a + (Number(x[k]) || 0), 0));
  // MARKER_VATTOOLBOX_TABLE_DESIGN_V1 : จัดคอลัมน์ใหม่ — ผู้ค้ากินพื้นที่ที่เหลือ คอลัมน์อื่นพอดีเนื้อหา, หัวตารางเข้ม, แถวสลับสี, hover, ลบเป็นสีแดง
  const th = { textAlign: "left", fontSize: 11.5, color: "#44515e", fontWeight: 700, padding: "10px 12px", background: "#eef4f0", borderBottom: "2px solid #cfe3d6", borderRight: "1px solid #dde9e1", whiteSpace: "nowrap", overflow: "clip", textOverflow: "ellipsis", letterSpacing: 0.2 };
  const td = { padding: "9px 12px", borderBottom: `1px solid ${C.line}`, borderRight: "1px solid #eef2ef", whiteSpace: "nowrap", overflow: "clip", textOverflow: "ellipsis", fontSize: 13 };
  const total = sum("amt");
  const all = [...BASE_COLS.map((c) => (c.id === "amt" ? { ...c, label: `ยอด @${rate}%` } : c.id === "inv" && invLabel ? { ...c, label: invLabel } : c)), ...hdr.map((h, i) => ({ id: "o" + i, label: String(h || `คอลัมน์ ${i + 1}`), orig: i }))];
  const defs = cols.map((id) => all.find((c) => c.id === id)).filter(Boolean).filter((c) => !((c.id === "taxid" || c.id === "vbr") && !rows.some((x) => x.taxid)));
  const cell = (c, x, i) => {
    switch (c.id) {
      case "inv": return x.inv; case "date": return x.date; case "vendor": return x.vendor;
      case "taxid": return x.taxid || "—"; case "vbr": return x.taxid ? (x.vbr || x.ho || "00000") : "—";
      case "pre": return x.pre != null ? fmt(x.pre) : "—"; case "raw": return fmt(x.raw); case "rate": return `${rate}%`; case "amt": return fmt(x.amt);
      case "exp": return ymStr(x.ym + 6); case "cnt": return cntOf[x.inv] != null ? cntOf[x.inv] : 1; case "row": return x.r;
      case "tcode": return x.tcode || "—"; case "ref": return x.ref || "—"; case "bu": return x.bu || "—";
      default: return x.orig ? fmtCell(toDate(x.orig[c.orig])) : "—";
    }
  };
  const cellTxt = (i, ci) => { const c = defs[ci]; const v = String(cell(c, rows[i], i)); if (v === "—") return ""; return isNum(c) ? v.replace(/,/g, "") : v; };
  const copyText = async (t) => { try { await navigator.clipboard.writeText(t); } catch (e) { const ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e2) { /* ignore */ } ta.remove(); } };
  const openCtx = (e, i, ci) => { e.preventDefault(); setCtx({ x: Math.min(e.clientX, window.innerWidth - 230), y: Math.min(e.clientY, window.innerHeight - 140), i, ci }); };
  const inSel = (i, ci) => !!selRect && !(selRect.r1 === selRect.r2 && selRect.c1 === selRect.c2) && i >= selRect.r1 && i <= selRect.r2 && ci >= selRect.c1 && ci <= selRect.c2;
  const ctxCopy = (kind) => { if (!ctx) return; let t = ""; if (kind === "cell") { if (inSel(ctx.i, ctx.ci)) { const L = []; for (let r = selRect.r1; r <= selRect.r2; r++) { const C2 = []; for (let c = selRect.c1; c <= selRect.c2; c++) C2.push(cellTxt(r, c)); L.push(C2.join("\t")); } t = L.join("\n"); } else t = cellTxt(ctx.i, ctx.ci); } else if (kind === "row") t = defs.map((_, c) => cellTxt(ctx.i, c)).join("\t"); else t = [defs.map((c) => c.label).join("\t"), ...rows.map((_, r) => defs.map((__, c) => cellTxt(r, c)).join("\t"))].join("\n"); copyText(t); setCtx(null); };
  // MARKER_VATTOOLBOX_TABLE_COPY_V1 : ลากคลุมหลายช่องแล้ว Ctrl+C -> คัดลอกเป็นแถว/คอลัมน์ (Tab คั่น) วางใน Excel ได้ ; ลากในช่องเดียวใช้การคัดลอกข้อความปกติ
  const copySel = (e) => {
    if (!selRect || (selRect.r1 === selRect.r2 && selRect.c1 === selRect.c2)) {
      const t = window.getSelection ? String(window.getSelection()) : "";
      if (t) { e.clipboardData.setData("text/plain", t); e.preventDefault(); }
      return;
    }
    const root = wrapRef.current; if (!root) return;
    const lines = [];
    for (let r = selRect.r1; r <= selRect.r2; r++) {
      const cells = [];
      for (let c = selRect.c1; c <= selRect.c2; c++) {
        const td = root.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
        let t = td ? td.textContent.trim() : "";
        if (td && td.dataset.num && /^-?[\d,]+(\.\d+)?$/.test(t)) t = t.replace(/,/g, "");
        cells.push(t === "—" ? "" : t);
      }
      lines.push(cells.join("\t"));
    }
    e.clipboardData.setData("text/plain", lines.join("\n"));
    e.preventDefault();
  };
  const isNum = (c) => c.num || (c.orig != null && rows.length > 0 && rows.every((x) => !x.orig || x.orig[c.orig] == null || typeof x.orig[c.orig] === "number"));
  const footer = (c) => (c.id === "pre" ? (rows.some((x) => x.pre != null) ? fmt(sum("pre")) : "—") : c.id === "raw" ? fmt(sum("raw")) : c.id === "amt" ? fmt(total) : "");
  return (
    <div ref={wrapRef} className={"vtb-tbl" + (selRect && (selRect.r1 !== selRect.r2 || selRect.c1 !== selRect.c2) ? " vtb-multi" : "")} onCopy={copySel}>
    <style>{".vtb-tbl td::selection{background:#bfe5cc;color:inherit}.vtb-tbl td{user-select:text}.vtb-multi td::selection{background:transparent}.vtb-tbl tbody tr:nth-child(even) td{background:#fafcfb}.vtb-tbl tbody tr:hover td{background:#eef8f1}.vtb-tbl th:first-child{border-top-left-radius:8px}.vtb-tbl th:last-child{border-top-right-radius:8px}"}</style>
    <div style={{ overflowX: "auto", border: `1px solid ${C.line}`, borderRadius: 10 }}>
      <table style={{ borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed", width: "100%", minWidth: colW(defs) }}>
        <colgroup><col style={{ width: 44 }} />{defs.map((c) => <col key={c.id} style={c.id === "vendor" ? undefined : { width: widthOf(c) }} />)}</colgroup>
        <thead><tr><th style={{ ...th, width: 44, textAlign: "center" }}>#</th>{defs.map((c) => <th key={c.id} style={{ ...th, ...(isNum(c) ? { textAlign: "right" } : null),  ...(c.id === "rate" || c.id === "exp" || c.id === "row" || c.id === "vbr" ? { textAlign: "center" } : null) }}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((x, i) => (
            <tr key={i}><td style={{ ...td, textAlign: "center", color: C.mute, fontSize: 12 }}>{i + 1}</td>{defs.map((c, ci) => <td key={c.id} data-r={i} data-c={ci} data-num={isNum(c) ? "1" : undefined} onContextMenu={(e) => openCtx(e, i, ci)} style={{ ...td, ...(selRect && i >= selRect.r1 && i <= selRect.r2 && ci >= selRect.c1 && ci <= selRect.c2 ? { background: "#d7eedf" } : null), ...(isNum(c) ? { textAlign: "right" } : null), ...(["inv", "date", "pre", "raw", "rate", "amt", "exp", "row", "taxid", "vbr", "ref"].includes(c.id) ? mono : null), ...(c.id === "amt" ? { fontWeight: 700 } : null), ...(["pre", "raw", "amt"].includes(c.id) && Number(c.id === "amt" ? x.amt : x[c.id]) < 0 ? { color: C.bad } : null), ...(c.id === "vendor" ? { whiteSpace: "normal", wordBreak: "break-word" } : null), ...(c.id === "rate" || c.id === "exp" || c.id === "row" || c.id === "vbr" ? { textAlign: "center", ...(c.id === "vbr" ? null : { color: C.mute }) } : null), ...(c.id === "ref" && !x.ref ? { color: "#b6c0c9" } : null) }}>{cell(c, x, i)}</td>)}</tr>))}
          <tr style={{ background: "#eef4f0" }}>
            <td style={{ ...td, borderTop: "2px solid #cfe3d6", background: "#eef4f0", whiteSpace: "normal", overflow: "visible" }} colSpan={1 + Math.max(0, defs.findIndex((c) => ["pre", "raw", "amt"].includes(c.id)))}>รวม {label}<div style={{ color: C.mute, fontSize: 11.5, fontWeight: 400 }}>ผลต่างจากเป้า {fmt(round2(total - target))}</div></td>{defs.slice(Math.max(0, defs.findIndex((c) => ["pre", "raw", "amt"].includes(c.id)))).map((c) => <td key={c.id} style={{ ...td, borderTop: "2px solid #cfe3d6", background: "#eef4f0", ...(isNum(c) ? { textAlign: "right" } : null), ...mono, fontWeight: 700 }}>{footer(c)}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
    {ctx && (<div onClick={(e) => e.stopPropagation()} style={{ position: "fixed", left: ctx.x, top: ctx.y, zIndex: 1000, minWidth: 210, background: "white", border: `1px solid ${C.line}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.2)", padding: 4, fontSize: 13 }}>
      {[["cell", inSel(ctx.i, ctx.ci) ? "คัดลอกช่องที่เลือก" : "คัดลอก"], ["row", "คัดลอกทั้งแถว"], ["all", "คัดลอกทั้งตาราง (รวมหัวตาราง)"]].map(([k, l]) => (<div key={k} onClick={() => ctxCopy(k)} style={{ padding: "8px 12px", borderRadius: 6, cursor: "pointer" }} onMouseEnter={(e) => { e.currentTarget.style.background = C.gl; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>{l}</div>))}
    </div>)}
    {selSum && (
      <div style={{ position: "sticky", bottom: 8, marginTop: 8, display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center", background: "#14213d", color: "white", borderRadius: 10, padding: "8px 14px", fontSize: 13, boxShadow: "0 4px 14px rgba(0,0,0,.25)" }}>
        <span>ที่เลือก <b>{selSum.n}</b> ช่อง</span>
        <span>ผลรวม <b style={{ ...mono, fontSize: 15, color: "#7ee0a8" }}>{fmt(selSum.sum)}</b></span>
        <span style={{ opacity: 0.85 }}>เฉลี่ย <span style={mono}>{fmt(selSum.avg)}</span></span>
        <span style={{ opacity: 0.85 }}>ต่ำสุด <span style={mono}>{fmt(selSum.min)}</span></span>
        <span style={{ opacity: 0.85 }}>สูงสุด <span style={mono}>{fmt(selSum.max)}</span></span>
      </div>)}
    </div>
  );
}

// MARKER_VATTOOLBOX_OVERPAY_V1 -- "สลับยื่นเกิน" : เอาชุด In ที่เคยสลับเข้าไปออก แล้วคืนยอดเดิมจาก Out เดือนต้นทาง
// ระบบรู้ได้จาก "งานที่บันทึกไว้" : ชุด In สุดท้ายของงานนั้น มีเลขที่ใบกำกับอยู่ในไฟล์ Input ที่โยนเข้ามา (เดือนล่าสุด) = ถูกสลับเข้าไปแล้ว
function findOverpay(job, wp) {
  const files = [...(job.sourceFiles || []), ...(job.extra || []), ...(job.stepFiles || []).flat().filter(Boolean)];
  if (!files.length) return [];
  const invSet = new Set(files.flatMap((f) => f.rows.map((x) => String(x.inv))));
  const out = [];
  loadJobs().filter((j) => j && j.id !== job.id && j.params && Array.isArray(j.sourceFiles) && j.sourceFiles.length && Number(j.params.target) > 0).slice(0, 12).forEach((j) => {
    try {
      const r = runChain(j, wp);
      const inStep = [...r.steps].reverse().find((s) => s.inSet && s.inSet.set && s.inSet.set.length);
      if (!inStep) return;
      const hits = inStep.inSet.set.filter((u) => invSet.has(String(u.inv)));
      if (!hits.length) return;
      const back = r.steps[0] ? r.steps[0].out : [];
      out.push({ id: j.id, name: `${fmt(j.params.target)} · ${j.params.branch || "ทุกสาขา"}`, month: inStep.month, from: r.P0, inSet: inStep.inSet.set, hits, backSet: back, target: Number(j.params.target), params: j.params });
    } catch (e) { /* งานเก่าที่คำนวณไม่ได้ ข้ามไป */ }
  });
  return out;
}
const unitRow = (u, kind) => { const r0 = (u.rows && u.rows[0]) || {}; return [kind, u.inv, r0.date || "", r0.vendor || "", r0.branch || "", round2(u.tot)]; };
async function exportOverpay(c, inNew, ym) {
  const ExcelJS = (await import("exceljs")).default || (await import("exceljs"));
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("สลับยื่นเกิน");
  ws.addRow(["สลับยื่นเกิน", c.name]); ws.addRow([]);
  ws.addRow(["รายการ", "เลขที่ใบกำกับ", "วันที่", "ผู้ค้า", "สาขา", "เงินภาษี"]).font = { bold: true };
  c.inSet.forEach((u) => ws.addRow(unitRow(u, "เอาออก (In เดิม)")));
  c.backSet.forEach((u) => ws.addRow(unitRow(u, "คืนยอดเดิม (Out ต้นทาง)")));
  if (inNew && inNew.set) inNew.set.forEach((u) => ws.addRow(unitRow(u, `สลับเข้า (ไม่เกินเดือน ${ymStr(ym)})`)));
  ws.columns = [{ width: 24 }, { width: 24 }, { width: 12 }, { width: 36 }, { width: 10 }, { width: 14 }];
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a"); a.href = url; a.download = `VAT_สลับยื่นเกิน_${c.target}_${ymStr(ym || c.month)}.xlsx`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// MARKER_VATTOOLBOX_TAXTYPE_DROPDOWN_V1 -- Dropdown เลือก Tax Type (ติ๊กได้หลายตัว ไม่เลือก = รวมทุก Type) ; โชว์ Code ที่รวมอยู่ในแต่ละ Type
function TaxTypeDropdown({ typeList, sel, toggle, clear }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => { if (!open) return undefined; const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, [open]);
  const shown = sel.filter((t) => typeList.some((x) => x.t === t));
  const text = shown.length ? shown.map((t) => `Tax Type ${t}`).join(", ") : "ทุก Tax Type";
  const box = { width: "100%", boxSizing: "border-box", padding: "9px 12px", border: `1px solid ${C.line}`, borderRadius: 8, background: "white", fontFamily: "inherit", fontSize: 14, color: C.text, textAlign: "left", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 };
  return (<div ref={ref} style={{ position: "relative" }}><Lbl>Tax Type</Lbl>
    <button type="button" style={box} onClick={() => setOpen((v) => !v)}><span>{text}</span><span style={{ fontSize: 11, color: C.mute }}>▾</span></button>
    {open && (<div style={{ position: "absolute", left: 0, right: 0, minWidth: 230, top: "calc(100% + 4px)", zIndex: 40, background: "white", border: `1px solid ${C.line}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.16)", padding: 6 }}>
      <div onClick={() => { clear(); }} style={{ padding: "7px 10px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: shown.length ? 400 : 700, color: shown.length ? C.text : C.g }}>ทุก Tax Type (รวมทั้งหมด)</div>
      {typeList.map(({ t, codes }) => (<label key={t} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "7px 10px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}><input type="checkbox" checked={sel.includes(t)} onChange={() => toggle(t)} style={{ marginTop: 3 }} /><span><b>Tax Type {t}</b><span style={{ display: "block", color: C.mute, fontSize: 11.5 }}>{codes.join(" · ")}</span></span></label>))}
    </div>)}
  </div>);
}

function SwapFinder({ initial, onSaved, hk, onOpenJob }) {
  const wp = React.useMemo(() => workingPeriod(), []);
  const blank = () => ({ id: String(Date.now()), params: { target: "", rateOld: "100", rateNew: "100", branch: "", bu: "", tcode: "", tol: "0.05", startYm: 0, swapIn: [], swapKeys: [] }, sourceFiles: [], stepFiles: [], stepRates: [], extra: [], started: false });
  const [job, setJob] = React.useState(initial || blank());
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [note, setNote] = React.useState("");
  const [sel, setSel] = React.useState(null);   // เดือนที่เลือกใน Timeline
  const [tab, setTab] = React.useState("out");
  const set = (patch) => setJob((j) => ({ ...j, ...patch }));
  const setP = (patch) => setJob((j) => ({ ...j, params: { ...j.params, ...patch } }));
  React.useEffect(() => { // MARKER_VATTOOLBOX_SWAPLIST_USE_V1 : ดึงรายการจาก Swap List มาเป็นเงื่อนไข (ยอด VAT รวม + สาขา)
    const h = (e) => { const d = (e && e.detail) || {}; if (d.target == null) return; setJob((j) => ({ ...j, params: { ...j.params, target: String(d.target), startYm: d.ym ? Number(d.ym) : 0, swapIn: Array.isArray(d.items) ? d.items : [], swapKeys: Array.isArray(d.keys) ? d.keys : [], ...(d.branch != null ? { branch: d.branch } : {}) } })); };
    window.addEventListener("vat-toolbox-swap-use", h);
    return () => window.removeEventListener("vat-toolbox-swap-use", h);
  }, []);
  // ── กู้/บันทึกงานค้างอัตโนมัติ (ไม่ใช้เมื่อเปิดมาจากงานที่บันทึกไว้) ──
  const auth0 = useAuth();
  const dk = `${DRAFT_KEY}:${userKeyOf(auth0)}`; // งานค้างแยกตามผู้ใช้ ไม่เกี่ยวพันกัน
  const draftReady = React.useRef(!!initial);
  const draftExp = React.useRef(null); // เวลาหมดอายุของงานค้าง (ตั้งตอน Export เท่านั้น)
  React.useEffect(() => {
    if (initial) return undefined;
    let alive = true;
    draftGet(dk).then((d0) => {
      let d = d0;
      if (!alive) return;
      if (d && d.expiresAt) { if (Number(d.expiresAt) <= Date.now()) { draftPut(null, dk); d = null; } else draftExp.current = Number(d.expiresAt); } // ตั้งเวลาลบ: Export แล้วครบ 7 วันถึงล้างทิ้ง
      if (d && d.job) {
        setJob((cur) => (cur.sourceFiles.length || (cur.extra || []).length || cur.params.target ? cur : { ...blank(), ...d.job, params: { ...blank().params, ...(d.job.params || {}) }, sourceFiles: d.job.sourceFiles || [], stepFiles: d.job.stepFiles || [], stepRates: d.job.stepRates || [], extra: d.job.extra || [] }));
        if (d.job.sourceFiles && d.job.sourceFiles.length) setNote("กู้งานล่าสุดที่ค้างไว้ให้อัตโนมัติ");
      }
      draftReady.current = true;
    });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  React.useEffect(() => {
    if (!draftReady.current) return undefined;
    const t = setTimeout(() => {
      const empty = !job.sourceFiles.length && !(job.extra || []).length && !(job.stepFiles || []).some((x) => x && x.length) && !job.params.target;
      draftPut(empty ? null : { savedAt: Date.now(), expiresAt: draftExp.current, job }, dk);
    }, 800);
    return () => clearTimeout(t);
  }, [job]);
  const fileMonth = (f) => (f.period != null ? f.period : f.maxYm);

  const readFiles = async (fs) => {
    setBusy(true); setErr("");
    try { const out = []; for (const f of fs) out.push(parseWorkbook(await f.arrayBuffer(), f.name)); return out; }
    catch (e) { setErr(e.message); return []; } finally { setBusy(false); }
  };
  const addFiles = async (fs) => { const parsed = await readFiles(fs); if (parsed.length) setJob((j) => ({ ...j, extra: [...(j.extra || []), ...parsed] })); };

  const branches = React.useMemo(() => [...new Set(job.sourceFiles.flatMap((f) => f.branches))].sort(), [job.sourceFiles]);
  const canRun = job.sourceFiles.length > 0 && Number(job.params.target) > 0;
  // MARKER_VATTOOLBOX_SHIFT_MONTH_V1 -- อ่าน "วันที่ (รับสินค้า)" ของ Input = Receive date เพื่อแสดงให้ผู้ใช้เห็น (ตัวเลือก "สลับไปอนาคต" ถอนออกแล้ว: ผู้ใช้ยืนยันว่าต้องสลับย้อนหลังเพราะยื่นเกินในเดือนนั้น)
  const [pickMode, setPickMode] = React.useState("normal"); // MARKER_VATTOOLBOX_OVERPAY_V1 : normal | back | id ของงานที่จะทำ "สลับยื่นเกิน"
  const recvMonths = [...new Set(job.sourceFiles.map(fileMonth).filter((m) => m != null && m >= 0))].sort((a, b) => a - b);
  const recvYm = recvMonths.length ? recvMonths[recvMonths.length - 1] : null;
  // MARKER_VATTOOLBOX_BACKSWAP_V1 -- "สลับย้อน" (ยื่นเกินในเดือนนั้น): สลับเข้าเดือน M ได้เมื่อ "วันที่ใบกำกับภาษี" ไม่เกินเดือน M และไม่เก่ากว่า M-6 ; เดือนที่ให้เลือกอ่านจากใบกำกับในไฟล์ (ตามสาขา/BU/Tax Code ที่กรอก)
  const [backYm, setBackYm] = React.useState(0);
  const backOpts = React.useMemo(() => { if (recvYm == null) return []; try { const o = []; for (let m = recvYm - 1; m >= recvYm - 6; m--) { const n = poolFrom(job.sourceFiles, job.params.branch, m - 6, m, job.params.bu, job.params.tcode).length; if (n) o.push({ m, n }); } return o; } catch (e) { return []; } }, [job.sourceFiles, job.params.branch, job.params.bu, job.params.tcode, recvYm]); // eslint-disable-line react-hooks/exhaustive-deps
  const backM = backOpts.some((o) => o.m === backYm) ? backYm : (backOpts[0] ? backOpts[0].m : 0);
  // MARKER_VATTOOLBOX_NORMAL_ONLY_WHEN_PAST_V1 -- "สลับตามปกติ" (Out -> In ไปถึง Working Period) มีความหมายเมื่อ Input เป็นเดือนย้อนหลังเท่านั้น ; Input = Period ปัจจุบันอยู่แล้ว -> ไม่เสนอ
  const normalPossible = recvYm == null || recvYm < wp;
  const invMonths = [...new Set(job.sourceFiles.flatMap((f) => f.rows.map((x) => x.ym)))].sort((x, y) => x - y);
  React.useEffect(() => { if (!normalPossible && pickMode === "normal") setPickMode(backOpts.length ? "back" : "none"); }, [normalPossible, pickMode, backOpts.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const backIn = React.useMemo(() => { if (pickMode !== "back" || !backM || !(Number(job.params.target) > 0)) return null; try { const pp = job.params; const pool = poolFrom(job.sourceFiles, pp.branch, backM - 6, backM, pp.bu, pp.tcode); const tol = Number(pp.tol) || 0.05; const o = searchSet(pool, Number(pp.target), tol, Number(pp.rateOld) || 100, new Set()); if (!o.set) return { poolN: pool.length, error: o.error || null }; const r = searchSet(pool, Number(pp.target), tol, Number(pp.rateNew) || 100, new Set(o.set.map((u) => u.inv))); /* MARKER_VATTOOLBOX_BACKSWAP_DIFF_INVOICE_V1 -- กติกาเดิม: In ต้องเป็นใบ "คนละใบ" กับ Out (กันใบของ Out ออกก่อนหา In) */ return { poolN: pool.length, outN: o.set.length, ...r }; } catch (e) { return { poolN: 0, error: String(e.message || e) }; } }, [pickMode, backM, job.sourceFiles, job.params]); // eslint-disable-line react-hooks/exhaustive-deps
  const res = React.useMemo(() => (job.started && canRun ? runChain(job, wp, pickMode === "back" && backM ? { lo: backM - 6, hi: backM } : null) : null), [job, canRun, wp, pickMode, backM]);
  const overpay = React.useMemo(() => { try { return findOverpay(job, wp); } catch (e) { return []; } }, [job.sourceFiles, job.extra, job.stepFiles, wp]); // eslint-disable-line react-hooks/exhaustive-deps
  const overSel = overpay.find((c) => c.id === pickMode) || null;
  const [overMonth, setOverMonth] = React.useState(0); // เดือนที่เลือกสำหรับ "สลับยื่นเกิน" (0 = ใช้เดือนของชุด In เดิม)
  const overM = overSel ? (overMonth || overSel.month) : 0;
  const overMonths = overSel ? Array.from({ length: Math.max(1, wp - overSel.from + 1) }, (_, i) => overSel.from + i) : [];
  // ดึงรายการที่ "ไม่เกินเดือน" ที่เลือก (ลงวันที่ ≤ เดือนนั้น และยังไม่หมดอายุ = ไม่เก่ากว่า 6 เดือน) มาหาชุดที่จะสลับเข้า
  const overIn = React.useMemo(() => {
    if (!overSel) return null;
    try {
      const fs = [...(job.sourceFiles || []), ...(job.extra || []), ...(job.stepFiles || []).flat().filter(Boolean)];
      const pp = overSel.params || {};
      const pool = poolFrom(fs, pp.branch, overM - 6, overM, pp.bu, pp.tcode);
      const ex = new Set([...overSel.inSet.map((u) => u.inv), ...overSel.backSet.map((u) => u.inv)]);
      const r = searchSet(pool, overSel.target, Number(pp.tol) || 0.05, Number(pp.rateNew) || 100, ex);
      return { poolN: pool.length, ...r };
    } catch (e) { return { poolN: 0, error: String(e.message || e) }; }
  }, [overSel, overM, job.sourceFiles, job.extra, job.stepFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  // จัดไฟล์เข้าเดือนตาม Period
  React.useEffect(() => {
    const ex = job.extra || [];
    if (!ex.length) return;
    if (!job.sourceFiles.length) {
      const minM = Math.min(...ex.map(fileMonth));
      setJob((j) => ({ ...j, sourceFiles: ex.filter((f) => fileMonth(f) === minM), extra: ex.filter((f) => fileMonth(f) !== minM), started: false }));
      return;
    }
    if (!res) return;
    const stepFiles = [...job.stepFiles]; const left = []; let moved = false;
    ex.forEach((f) => { const st = res.steps.find((x) => x.month === fileMonth(f)); if (st) { stepFiles[st.k] = [...(stepFiles[st.k] || []), f]; moved = true; } else left.push(f); });
    if (moved) setJob((j) => ({ ...j, stepFiles, extra: left }));
  }, [job.extra, job.sourceFiles, job.stepFiles, res]); // eslint-disable-line react-hooks/exhaustive-deps

  // เลือกเดือนเริ่มต้น = ขั้นล่าสุด
  const steps = res ? res.steps : [];
  const isStart = sel === "start";
  const curStep = isStart ? steps[0] || null : steps.find((s) => s.month === sel) || steps[steps.length - 1] || null;
  React.useEffect(() => { if (curStep && sel !== "start" && curStep.month !== sel) setSel(curStep.month); }, [res]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (curStep && tab === "in" && !curStep.inSet) setTab("out"); }, [curStep, tab]);

  const save = () => {
    const name = `${fmt(job.params.target)} · ${job.params.branch || "ทุกสาขา"} · ${new Date().toLocaleString("th-TH")}`;
    const jobs = loadJobs().filter((x) => x.id !== job.id);
    const used = new Set(); steps.forEach((st) => { [...st.out, ...(st.inSet ? st.inSet.set : [])].forEach((u) => u.rows.forEach((x) => used.add(`${x.r}|${x.inv}`))); });
    const slim = (f) => ({ ...f, rows: f.rows.map((x) => (x.orig && !used.has(`${x.r}|${x.inv}`) ? { ...x, orig: undefined } : x)) });
    const item = { ...job, sourceFiles: job.sourceFiles.map(slim), stepFiles: job.stepFiles.map((a) => (a || []).map(slim)), extra: (job.extra || []).map(slim), name, savedAt: Date.now(), status: res ? res.status : "draft", lastMonth: steps.length ? ymStr(steps[steps.length - 1].month) : null };
    // MARKER_VAT_TOOLBOX_DB_DRAFT_V1 -- เก็บลง DB ก่อน (ข้ามเครื่องได้) ถ้าไม่สำเร็จค่อยถอยไปเก็บในเครื่องนี้
    setNote("กำลังบันทึก…");
    cloudSaveJob(item).then((cloudOk) => { // MARKER_VAT_TOOLBOX_DRAFT_API_V1
      if (cloudOk) { saveJobs(jobs.filter((x) => x.id !== item.id)); setNote("บันทึก Draft ลงฐานข้อมูลแล้ว — เปิดทำต่อได้ที่แท็บ 'งานที่บันทึกไว้' (เมื่อ Export แล้วจะถูกลบอัตโนมัติใน " + EXPIRE_DAYS_AFTER_EXPORT + " วัน)"); if (onSaved) onSaved(); return; }
      jobs.unshift(item);
      const ok = saveJobs(jobs);
      setNote(ok ? "บันทึกแล้ว — เปิดทำต่อได้ที่แท็บ 'งานที่บันทึกไว้' ด้านขวาบน (ฐานข้อมูลใช้ไม่ได้ จึงเก็บในเครื่องนี้)" : "บันทึกไม่สำเร็จ (ฐานข้อมูลใช้ไม่ได้ และพื้นที่เบราว์เซอร์เต็ม)");
      if (ok && onSaved) onSaved();
    });
  };
  const doExport = () => { // MARKER_VAT_TOOLBOX_DB_DRAFT_V1 -- Export แล้วตั้งเวลาลบ Draft ใน 7 วัน
    exportWorkbook(job, res);
    if (job.params.swapKeys && job.params.swapKeys.length) markSwapDone(userKeyOf(auth0), job.params.swapKeys); // Export แล้วเอาออกจาก Swap List
    draftExp.current = Date.now() + EXPIRE_DAYS_AFTER_EXPORT * 86400e3; draftPut({ savedAt: Date.now(), expiresAt: draftExp.current, job }, dk); // เริ่มนับ 7 วันของงานค้างในเครื่อง
    const name = job.name || `${fmt(job.params.target)} · ${job.params.branch || "ทุกสาขา"} · ${new Date().toLocaleString("th-TH")}`;
    const item = { ...job, name, savedAt: job.savedAt || Date.now(), status: res ? res.status : "draft", lastMonth: steps.length ? ymStr(steps[steps.length - 1].month) : null };
    cloudExportJob(item).then((expMs) => { // MARKER_VAT_TOOLBOX_DRAFT_API_V1
      if (expMs) { setNote("Export แล้ว — Draft นี้จะถูกลบอัตโนมัติวันที่ " + new Date(expMs).toLocaleDateString("th-TH")); if (onSaved) onSaved(); }
      else { const jl = loadJobs().map((x) => (x.id === job.id ? { ...x, expiresAt: Date.now() + EXPIRE_DAYS_AFTER_EXPORT * 86400e3 } : x)); saveJobs(jl); }
    });
  };
  const fileIn = React.useRef(null);
  const saveFile = () => { // บันทึกงานเป็นไฟล์ (ไม่จำกัดขนาด เก็บไว้ที่ไหนก็ได้ แล้วเปิดกลับมาทำต่อ)
    const body = JSON.stringify({ app: "vat-swap-finder", version: 1, savedAt: new Date().toISOString(), job });
    const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = `VATSwap_${job.params.target || "job"}_${new Date().toISOString().slice(0, 10)}.vatswap.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    setNote("บันทึกเป็นไฟล์แล้ว — เก็บไฟล์ .vatswap.json ไว้ แล้วกด 'เปิดงานจากไฟล์' เพื่อทำต่อ");
  };
  const loadFile = async (f) => {
    try {
      const d = JSON.parse(await f.text());
      if (!d || d.app !== "vat-swap-finder" || !d.job) throw new Error("ไม่ใช่ไฟล์งานของ VAT Swap Finder");
      const j = d.job;
      setJob({ ...blank(), ...j, params: { ...blank().params, ...(j.params || {}) }, sourceFiles: j.sourceFiles || [], stepFiles: j.stepFiles || [], stepRates: j.stepRates || [], extra: j.extra || [], id: String(Date.now()) });
      setSel(null); setErr(""); setNote(`เปิดงานจากไฟล์ ${f.name} แล้ว`);
    } catch (e) { setErr(e.message || "เปิดไฟล์งานไม่สำเร็จ"); }
  };
  const reset = async () => { if (await confirmDialog.confirm("ล้างงานนี้ทั้งหมดและเริ่มใหม่?", { title: "เริ่มใหม่", variant: "danger" })) { setJob(blank()); setNote(""); setSel(null); draftExp.current = null; draftPut(null, dk); } };
  const [ftab, setFtab] = React.useState("drop");
  const [pvIdx, setPvIdx] = React.useState(null); // คลิกไฟล์ในรายการ → ดูตัวอย่าง 5 แถวแรกที่อ่านได้
  const [rateSlot, setRateSlot] = React.useState(null); React.useEffect(() => { setRateSlot(document.getElementById("swap-rate-slot")); }, []); // Rate เดิม/ใหม่ แสดงที่ Header (Portal)
  const nFiles = job.sourceFiles.length + (job.extra || []).length; const nFilesRef = React.useRef(nFiles);
  React.useEffect(() => { if (nFiles > nFilesRef.current) setFtab("todo"); nFilesRef.current = nFiles; }, [nFiles]); // โยนไฟล์เข้าแล้วสลับไปแท็บ "สิ่งที่ต้องทำ" เอง
  const [colSel, setColSel] = React.useState(() => { try { const v = JSON.parse(localStorage.getItem(COL_LS) || "null"); return Array.isArray(v) && v.length ? v : DEFAULT_COLS; } catch (e) { return DEFAULT_COLS; } });
  const [showCols, setShowCols] = React.useState(false);
  const toggleCol = (id) => setColSel((cur) => { const nx = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]; try { localStorage.setItem(COL_LS, JSON.stringify(nx)); } catch (e) { /* ไม่เป็นไร */ } return nx; });
  const allFiles = job.sourceFiles.concat(...job.stepFiles.map((a) => a || []), job.extra || []);
  const buOpts = [...new Set(allFiles.flatMap((f) => Object.keys((f.meta && f.meta.buCodes) || {})))].filter((b) => b !== "-").sort();
  const tcOpts = [...new Set(allFiles.flatMap((f) => (f.rows || []).filter((x) => x.tcode && buAllows(x) && (!job.params.branch || branchHit(job.params.branch, x.branch)) && (!job.params.bu || buOf(x) === job.params.bu)).map((x) => x.tcode)))].sort(); // MARKER_VATTOOLBOX_TAXTYPE_BY_BRANCH_V1 -- ตัดสาขาที่ไม่ได้เลือกออก: ปุ่ม Tax Type นับเฉพาะ Code ของสาขา/BU ที่กรอก (ไม่กรอก = ทุกสาขา)
  const hasTc = allFiles.some((f) => f.meta && f.meta.buCodes && Object.keys(f.meta.buCodes).length);
  const metaAny = (job.sourceFiles.concat(...job.stepFiles.map((a) => a || []), job.extra || []).find((f) => f.meta) || {}).meta || {};
  const hdrAll = metaAny.hdr || [];
  const invLabel = metaAny.invHdr || "";
  const fileRows = [
    ...job.sourceFiles.map((f, i) => ({ file: f, name: f.name, period: f.period != null ? ymStr(f.period) : "ไม่มี", rows: f.rows.length, status: "ต้นทาง", remove: () => set({ sourceFiles: job.sourceFiles.filter((_, j) => j !== i), started: false }) })),
    ...steps.flatMap((s) => (s.files || []).map((f, i) => ({ file: f, name: f.name, period: ymStr(fileMonth(f)), rows: f.rows.length, status: `ใช้ใน ${ymStr(s.month)}`, remove: () => { const sf = [...job.stepFiles]; sf[s.k] = sf[s.k].filter((_, j) => j !== i); set({ stepFiles: sf }); } }))),
    ...(job.extra || []).map((f, i) => ({ file: f, name: f.name, period: ymStr(fileMonth(f)), rows: f.rows.length, status: "รอเดือนที่รองรับ", wait: true, remove: () => set({ extra: job.extra.filter((_, j) => j !== i) }) })),
  ];
  const done = res && res.status === "done";
  const waitLatest = !!(res && res.status === "need-file" && steps.length && steps[steps.length - 1].month >= wp); // รอไฟล์ Period ล่าสุด (เดือนยังไม่ปิด) → Export ได้
  const canExport = done || waitLatest;
  const target = Number(job.params.target) || 0;
  const dis = !job.sourceFiles.length;

  const stateOf = (s) => (s.fromBack && s.state !== "nomatch" && s.state !== "error" ? [`Target Input ${String((s.month % 12) + 1).padStart(2, "0")}.${Math.floor(s.month / 12)}`, C.gl, C.g] : s.state === "match" ? ["MATCH", C.gl, C.g] : s.state === "nomatch" ? ["NOT MATCH", "#fdecea", C.bad] : ["รอ Input", "#fff1dc", C.warn]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minHeight: 0 }}>
      {rateSlot && createPortal(<div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
        <div style={{ width: 96 }}><Lbl>Rate เดิม %</Lbl><input style={{ ...inp, ...mono }} inputMode="decimal" value={job.params.rateOld} onChange={(e) => setP({ rateOld: e.target.value })} /></div>
        <div style={{ width: 96 }}><Lbl>Rate ใหม่ %</Lbl><input style={{ ...inp, ...mono }} inputMode="decimal" value={job.params.rateNew} onChange={(e) => setP({ rateNew: e.target.value })} /></div>
      </div>, rateSlot)}
      {/* แถวบน: เงื่อนไข + จุดโยนไฟล์ */}
      <div style={{ ...card, flexShrink: 0 }}> {/* Split-Pane แบบ Dashboard: ส่วนบนอยู่กับที่ ไม่ใช้ sticky */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,380px),1fr))", gap: 14, alignItems: "stretch", minHeight: 340 }}> {/* ความสูงเริ่มต้นของกล่องบน คงที่ ไม่กระโดดตามเนื้อหา */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <div style={{ display: "inline-flex", alignSelf: "flex-start", background: "#eaf1ed", borderRadius: 10, padding: 3, gap: 2 }}>
              {[["drop", "จุดโยนไฟล์ Input"], ["todo", "สิ่งที่ต้องทำ"], ["saved", "งานที่บันทึกไว้"]].map(([k, l]) => (
                <button key={k} type="button" onClick={() => setFtab(k)} style={{ border: 0, borderRadius: 8, padding: "6px 14px", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer", background: ftab === k ? "white" : "none", color: ftab === k ? C.text : C.mute, boxShadow: ftab === k ? "0 1px 3px rgba(0,0,0,.15)" : "none" }}>{l}</button>))}
            </div>
            {ftab === "saved" ? (
              <div style={{ maxHeight: 260, overflowY: "auto" }}><History flat refreshKey={hk} onOpen={onOpenJob} /></div>
            ) : ftab === "todo" ? (
<div style={{ marginTop: 0, minHeight: 150, maxHeight: 280, overflowY: "auto", boxSizing: "border-box", border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 12px", background: C.soft, ...((job.sourceFiles.length > 0 || (job.extra || []).length > 0) ? {} : { opacity: 0.55, pointerEvents: "none", userSelect: "none" }) }}>
              {!(job.sourceFiles.length > 0 || (job.extra || []).length > 0) && <div style={{ fontSize: 12, color: C.mute }}>โยนไฟล์ Input ก่อน</div>}
              {normalPossible && (<label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, padding: "4px 0", cursor: "pointer" }}>
                <input type="radio" name="swapmode" checked={pickMode === "normal"} onChange={() => setPickMode("normal")} />
                <span><b>สลับตามปกติ</b> <span style={{ color: C.mute }}>— Out → In ไปจนถึง Working Period ({ymStr(wp)})</span></span>
              </label>)}
              {backOpts.length > 0 && (
                <div style={{ padding: "4px 0" }}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, cursor: "pointer", flexWrap: "wrap" }}>
                    <input type="radio" name="swapmode" checked={pickMode === "back"} onChange={() => setPickMode("back")} />
                    <span><b>สลับย้อนเข้าเดือนที่ยื่นเกิน</b> <span style={{ color: C.mute }}>— วันที่ใบกำกับภาษีต้องไม่เกินเดือนที่เลือก</span></span>
                    <select style={{ ...inp, width: "auto" }} value={backM} disabled={pickMode !== "back"} onChange={(e) => setBackYm(Number(e.target.value))}>{backOpts.map((o) => <option key={o.m} value={o.m}>{ymStr(o.m)} ({o.n} ใบ)</option>)}</select>
                  </label>
                  {pickMode === "back" && (
                    <div style={{ paddingLeft: 24, marginTop: 4 }}>
                      {!(Number(job.params.target) > 0) ? <div style={{ fontSize: 12.5, color: C.warn, marginTop: 4 }}>กรอก "ยอด VAT" ที่ยื่นเกินก่อน แล้วระบบจะหาชุดใบกำกับที่สลับเข้าได้</div>
                        : backIn && backIn.set ? null
                        : <div style={{ fontSize: 12.5, color: C.warn, marginTop: 4 }}>{backIn && backIn.error ? backIn.error : `ไม่พบชุดที่รวมได้ ${fmt(Number(job.params.target))} ในเดือน ${ymStr(backM)} (พบ ${backIn ? backIn.poolN : 0} แถว) ที่เป็นคนละใบกับชุด Out — ลองเลือกเดือนอื่น`}</div>}
                    </div>)}
                </div>)}
              {!normalPossible && backOpts.length === 0 && (<div style={{ fontSize: 12.5, color: C.warn, margin: "4px 0" }}>ไฟล์นี้ Receive date = Working Period ({ymStr(wp)}) จึงไม่มี "สลับตามปกติ" และสลับย้อนไม่ได้ เพราะไม่มีใบกำกับลงวันที่เดือนก่อนหน้าที่ยังยื่นได้ (ใบกำกับในไฟล์ลงวันที่เดือน {invMonths.map(ymStr).join(", ") || "—"})</div>)}
              {overpay.length === 0 ? (
                null
              ) : overpay.map((c) => (
                <label key={c.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, padding: "4px 0", cursor: "pointer" }}>
                  <input type="radio" name="swapmode" checked={pickMode === c.id} onChange={() => setPickMode(c.id)} />
                  <span><b>สลับยื่นเกิน</b> <span style={{ color: C.mute }}>— งาน {c.name}: พบชุด In เดือน {ymStr(c.month)} อยู่ในไฟล์ {c.hits.length}/{c.inSet.length} ใบ → เอาออก แล้วคืนยอดเดิม {c.backSet.length} ใบจากเดือน {ymStr(c.from)}</span></span>
                </label>))}
              {overSel && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: C.bad, marginBottom: 4 }}>เอาออก (In เดิม) · {overSel.inSet.length} ใบ · รวม {fmt(round2(overSel.inSet.reduce((a, u) => a + u.tot, 0)))}</div>
                  <div style={{ maxHeight: 120, overflow: "auto", fontSize: 12, ...mono }}>{overSel.inSet.map((u) => <div key={u.inv}>{u.inv} · {fmt(u.tot)}{overSel.hits.includes(u) ? "" : "  (ไม่พบในไฟล์ที่โยน)"}</div>)}</div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: C.ok, margin: "8px 0 4px" }}>คืนยอดเดิม (Out ต้นทาง) · {overSel.backSet.length} ใบ · รวม {fmt(round2(overSel.backSet.reduce((a, u) => a + u.tot, 0)))}</div>
                  <div style={{ maxHeight: 120, overflow: "auto", fontSize: 12, ...mono }}>{overSel.backSet.map((u) => <div key={u.inv}>{u.inv} · {fmt(u.tot)}</div>)}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "10px 0 4px" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>เลือกเดือนที่จะสลับเข้า</span>
                    <select style={{ ...inp, width: "auto" }} value={overM} onChange={(e) => setOverMonth(Number(e.target.value))}>{overMonths.map((m) => <option key={m} value={m}>{ymStr(m)}</option>)}</select>
                  </div>
                  <div style={{ fontSize: 12, color: C.mute, marginBottom: 4 }}>ดึงรายการที่ไม่เกินเดือน {ymStr(overM)} (ลงวันที่ {ymStr(overM - 6)} ถึง {ymStr(overM)}) จากไฟล์ที่โยน · พบ {overIn ? overIn.poolN : 0} แถว</div>
                  {overIn && overIn.set ? (
                    <>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: C.g, marginBottom: 4 }}>สลับเข้า · {overIn.set.length} ใบ · รวม {fmt(overIn.total)} (ต่าง {fmt(overIn.diff)})</div>
                      <div style={{ maxHeight: 120, overflow: "auto", fontSize: 12, ...mono }}>{overIn.set.map((u) => <div key={u.inv}>{u.inv} · {fmt(u.tot)}</div>)}</div>
                    </>
                  ) : <div style={{ fontSize: 12.5, color: C.warn }}>{overIn && overIn.error ? overIn.error : `ไม่พบชุดที่รวมได้ ${fmt(overSel.target)} — ลองเลือกเดือนอื่น หรือโยนไฟล์เดือนอื่นเพิ่ม`}</div>}
                  <div style={{ marginTop: 8 }}><button type="button" style={btn(true)} onClick={() => exportOverpay(overSel, overIn, overM)}>Export สลับยื่นเกิน</button></div>
                </div>)}
            </div>
            ) : (
              <>
                <Dropzone onFiles={addFiles} busy={busy} hasFiles={job.sourceFiles.length > 0} />
              <div style={{ overflowY: "auto", height: 196 }}> {/* ความสูงเริ่มต้น = 5 แถว เกินนั้นเลื่อนดู */}
                {fileRows.length === 0 ? <div style={{ color: C.mute, fontSize: 13, padding: "10px 0" }}>ยังไม่มีไฟล์ — โยนไฟล์ที่แท็บ "จุดโยนไฟล์ Input"</div> : (
                  <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
                    <thead><tr>{["#", "ชื่อไฟล์", "Period", "แถว", "สถานะ", ""].map((h) => <th key={h} style={{ textAlign: "left", padding: "5px 8px", color: C.mute, fontWeight: 600, borderBottom: `1px solid ${C.line}`, whiteSpace: "nowrap", position: "sticky", top: 0, background: "white" }}>{h}</th>)}</tr></thead>
                    <tbody>{fileRows.map((x, i) => (
                      <tr key={i} onClick={() => setPvIdx(pvIdx === i ? null : i)} title="คลิกเพื่อดูตัวอย่าง 5 แถว" style={{ cursor: "pointer", background: pvIdx === i ? C.gl : undefined }}>
                        <td style={{ padding: "6px 8px", borderBottom: `1px solid ${C.line}` }}>{i + 1}</td>
                        <td style={{ padding: "6px 8px", borderBottom: `1px solid ${C.line}`, wordBreak: "break-all" }}>{x.name}</td>
                        <td style={{ padding: "6px 8px", borderBottom: `1px solid ${C.line}`, ...mono }}>{x.period}</td>
                        <td style={{ padding: "6px 8px", borderBottom: `1px solid ${C.line}`, ...mono, textAlign: "right" }}>{x.rows.toLocaleString()}</td>
                        <td style={{ padding: "6px 8px", borderBottom: `1px solid ${C.line}`, color: x.wait ? C.warn : C.ok, whiteSpace: "nowrap" }}>{x.status}</td>
                        <td style={{ padding: "6px 8px", borderBottom: `1px solid ${C.line}` }}><button type="button" onClick={(e) => { e.stopPropagation(); setPvIdx(null); x.remove(); }} style={{ border: "none", background: "none", color: C.bad, cursor: "pointer", fontFamily: "inherit" }}>ลบ</button></td>
                      </tr>))}</tbody>
                  </table>)}
              </div>
              {(() => { const pf = pvIdx != null && fileRows[pvIdx] ? fileRows[pvIdx].file : null; if (!pf) return fileRows.length ? <div style={{ fontSize: 12, color: C.mute }}>คลิกที่ไฟล์ในรายการ เพื่อดูตัวอย่างข้อมูลที่อ่านได้ 5 แถว</div> : null; const pv = (pf.rows || []).slice(0, 5); const th = { textAlign: "left", padding: "4px 6px", color: C.mute, fontWeight: 600, borderBottom: `1px solid ${C.line}`, whiteSpace: "nowrap" }; const td = { padding: "4px 6px", borderBottom: `1px solid ${C.line}`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 190 };
                return (<div><Lbl>ตัวอย่าง 5 แถวแรก · {pf.name} (อ่านได้ {(pf.rows || []).length.toLocaleString()} แถว)</Lbl>
                  <div style={{ overflowX: "auto" }}><table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11.5 }}>
                    <thead><tr>{["เลขที่ใบกำกับ", "วันที่", "สาขา", "ผู้ค้า", "Tax Code", "VAT"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                    <tbody>{pv.map((x, i) => (<tr key={i}><td style={{ ...td, ...mono }}>{x.inv}</td><td style={{ ...td, ...mono }}>{x.date}</td><td style={{ ...td, ...mono }}>{x.branch}</td><td style={td} title={x.vendor}>{x.vendor}</td><td style={td}>{x.tcode || "—"}</td><td style={{ ...td, ...mono, textAlign: "right" }}>{fmt(x.raw)}</td></tr>))}</tbody>
                  </table></div></div>); })()}
              </>
            )}
            {err && <div style={{ color: C.bad, fontSize: 13, background: "#fdf1f0", padding: "8px 12px", borderRadius: 8 }}>{err}</div>}
          </div>
          <div style={{ minWidth: 0, alignSelf: "stretch", borderLeft: `1px solid ${C.line}`, paddingLeft: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr .8fr 1fr 1.4fr", gap: 8 }}>
            <div><Lbl>ยอด VAT</Lbl><input style={{ ...inp, ...mono }} inputMode="decimal" value={job.params.target} disabled={false} placeholder="เช่น 500" onChange={(e) => setP({ target: e.target.value.replace(/,/g, "") })} /></div>
            <div><Lbl>ต่าง ±</Lbl><input style={{ ...inp, ...mono }} inputMode="decimal" value={job.params.tol} disabled={false} onChange={(e) => setP({ tol: e.target.value })} /></div>
            <div><Lbl>สาขา</Lbl><BranchCombo value={job.params.branch} options={branches} disabled={false} onChange={(v) => setP({ branch: v })} /></div>
            {/* ไม่โชว์ช่อง BU: ระบบจับ BU จากชื่อผู้ค้าเอง (กฎ BTM ไม่ดึง Tax Type M ยังทำงานเบื้องหลัง) */}
            {hasTc && (() => { // MARKER_VATTOOLBOX_TAXTYPE_CHIPS_V1 -- เลือกเป็น Tax Type (กดได้หลายตัว รวมทุก Code ของ Type นั้น) ไม่ต้องเลือกรายตัว ; ไม่เลือก = รวมทุก Type
              const codeForm = (b) => String(b).trim().replace(/^([ATF]?)[^-]*-/i, (m, pf) => (pf ? pf.toUpperCase() + "-" : "")); /* MARKER_VATTOOLBOX_TAXTYPE_CHIP_COUNT_V1 -- ตัดเลขสาขาออก: 321801-N VAT7 / 321807-N VAT7 = แบบเดียวกัน (N VAT7) */
              const typeList = ["N", "A", "T", "F", "M"].map((t) => ({ t, codes: [...new Set(tcOpts.filter((b) => taxClassOf(b) === t).map(codeForm))].sort() })).filter((x) => x.codes.length);
              const sel = String(job.params.tcode || "").startsWith("types:") ? String(job.params.tcode).slice(6).split(",").filter(Boolean) : [];
              const toggle = (t) => { const nx = sel.includes(t) ? sel.filter((v) => v !== t) : [...sel, t]; setP({ tcode: nx.length ? `types:${nx.join(",")}` : "" }); };
              return (<TaxTypeDropdown typeList={typeList} sel={sel} toggle={toggle} clear={() => setP({ tcode: "" })} />); })()}
          </div>
          <div style={{ fontSize: 12, color: C.mute, marginTop: 10 }}>เดือนปลายทาง = Working Period เสมอ (ตอนนี้ {ymStr(wp)}) · ใบกำกับใช้ได้ถึงเดือนที่ลง + 6</div>
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button type="button" style={btn(true, !canRun)} disabled={!canRun} onClick={() => set({ started: true })}>{job.started ? "คำนวณใหม่" : "หายอด"}</button>
            <button type="button" style={btn(false, dis)} disabled={dis} onClick={save}>บันทึก</button>
            <button type="button" style={btn(false, !canExport)} disabled={!canExport} title={canExport ? "" : "Export ได้เมื่อถึงเดือนปัจจุบัน (Working Period) แล้วเท่านั้น"} onClick={doExport}>Export</button>
            <button type="button" style={btn(false, dis)} disabled={dis} onClick={saveFile} title="ดาวน์โหลดงานนี้เป็นไฟล์เก็บไว้">บันทึกเป็นไฟล์</button>
            <button type="button" style={btn(false)} onClick={() => fileIn.current && fileIn.current.click()}>เปิดงานจากไฟล์</button>
            <input ref={fileIn} type="file" accept=".json,.vatswap.json" style={{ display: "none" }} onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; if (f) loadFile(f); }} />
            <button type="button" style={btn(false)} onClick={reset}>เริ่มใหม่</button>
          </div>
          {note && <div style={{ fontSize: 12.5, color: C.ok, marginTop: 8 }}>{note}</div>}
          {(<div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.line}`, minHeight: 120 }}>
        <Lbl>Timeline · คลิกเดือนเพื่อดูใน Monitor</Lbl>
          {!res ? <div style={{ display: "flex", alignItems: "center", gap: 0, padding: "14px 4px 6px", opacity: 0.45 }}><span style={{ width: 22, height: 22, borderRadius: "50%", background: C.line, flex: "none" }} /><span style={{ flex: "0 1 120px", height: 3, background: C.line }} /><span style={{ width: 22, height: 22, borderRadius: "50%", background: C.line, flex: "none" }} /><span style={{ marginLeft: 14, fontSize: 12.5, color: C.mute }}>กด "หายอด" แล้วเดือนที่ต้องสลับจะขึ้นที่นี่</span></div> : (
            <div style={{ display: "flex", overflowX: "auto", padding: "6px 4px 2px" }}>
              <button type="button" onClick={() => { setSel("start"); setTab("out"); }} style={{ flex: "0 0 170px", position: "relative", textAlign: "center", cursor: "pointer", border: 0, background: "none", fontFamily: "inherit", padding: "0 4px", color: C.text }}>
                <span style={{ position: "relative", zIndex: 1, display: "block", width: 22, height: 22, borderRadius: "50%", margin: "0 auto 6px", boxSizing: "border-box", background: C.g, border: `3px solid ${C.g}` }} />
                <span style={{ ...mono, display: "inline-block", padding: "1px 8px", fontWeight: 700, fontSize: 13, borderRadius: 6, background: isStart ? C.gl : "transparent" }}>{ymStr(res.P0)}</span><br />
                {pill("เริ่มต้น · เลือก Out", C.gl, C.g)}
              </button>
              {steps.map((s, idx) => {
                const [t, bg, fg] = stateOf(s); const on = !isStart && curStep && curStep.month === s.month;
                return (
                  <button key={s.k} type="button" onClick={() => setSel(s.month)} style={{ flex: "0 0 170px", position: "relative", textAlign: "center", cursor: "pointer", border: 0, background: "none", fontFamily: "inherit", padding: "0 4px", color: C.text }}>
                    {<span style={{ position: "absolute", top: 11, left: "-50%", right: "50%", height: 3, background: C.g }} />}
                    <span style={{ position: "relative", zIndex: 1, display: "block", width: 22, height: 22, borderRadius: "50%", margin: "0 auto 6px", boxSizing: "border-box", background: s.state === "match" ? C.g : "white", border: `3px solid ${s.state === "nomatch" ? C.bad : C.g}`, boxShadow: s.state === "need-file" ? `0 0 0 4px ${C.gl}` : "none" }} />
                    <span style={{ ...mono, display: "inline-block", padding: "1px 8px", fontWeight: 700, fontSize: 13, borderRadius: 6, background: on ? C.gl : "transparent" }}>{ymStr(s.month)}</span><br />
                    {pill(t, bg, fg)}
                  </button>
                );
              })}
            </div>
          )}
          {res && <div style={{ fontSize: 12.5, marginTop: 8, color: res.status === "done" ? C.ok : res.status === "need-file" ? C.warn : C.bad }}>{res.message}{done ? " — Export ได้แล้ว" : waitLatest ? " (เดือนนี้ยังไม่ปิด — Export ได้ โดยเดือนล่าสุดจะมีเฉพาะชุด Out)" : ""}</div>}
          </div>)}
          </div>
        </div>
      </div>

      {/* Monitor */}
      {res && curStep && (
        <div style={{ ...card, flex: 1, minHeight: 0, overflowY: "auto" }}>
          <Lbl>Monitor · {isStart ? `เริ่มต้น ${ymStr(res.P0)} (เลือก Out จากไฟล์ต้นทาง · ต้องสลับภายใน ${ymStr(curStep.month)})` : ymStr(curStep.month)}</Lbl>
          <div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", position: "relative" }}>
              <div style={{ display: "inline-flex", background: "#eaf1ed", borderRadius: 10, padding: 3, gap: 2, marginBottom: 10, flexWrap: "wrap" }}>
                {[["out", `Transaction ที่จะเอาออก (Out) · ${curStep.out.length} ใบ`, true], ["in", `Transaction ที่จะเอาเข้า (In) · ${curStep.inSet ? curStep.inSet.set.length : 0} ใบ`, !!curStep.inSet && (!isStart || !!curStep.fromSwapList || !!curStep.fromBack)]].map(([k, l, en]) => (
                  <button key={k} type="button" disabled={!en} onClick={() => setTab(k)} style={{ border: 0, borderRadius: 8, padding: "7px 14px", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: en ? "pointer" : "not-allowed", background: tab === k ? "white" : "none", color: tab === k ? C.text : C.mute, opacity: en ? 1 : 0.5, boxShadow: tab === k ? "0 1px 3px rgba(0,0,0,.15)" : "none" }}>{l}</button>))}
              </div>
              <div style={{ position: "relative", marginBottom: 10 }}>
                <button type="button" onClick={() => setShowCols((v) => !v)} style={btn(false)}>＋ คอลัมน์ ({colSel.length})</button>
                {showCols && (
                  <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 30, width: 320, maxHeight: 380, overflowY: "auto", background: "white", border: `1px solid ${C.line}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.16)", padding: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 8 }}>
                      <b style={{ color: C.text }}>เลือกคอลัมน์ที่แสดง</b>
                      <span><button type="button" onClick={() => { setColSel(DEFAULT_COLS); try { localStorage.setItem(COL_LS, JSON.stringify(DEFAULT_COLS)); } catch (e) { /* ไม่เป็นไร */ } }} style={{ border: "none", background: "none", color: C.g, cursor: "pointer", fontFamily: "inherit" }}>ค่าเริ่มต้น</button>
                        <button type="button" onClick={() => setShowCols(false)} style={{ border: "none", background: "none", color: C.mute, cursor: "pointer", fontFamily: "inherit" }}>ปิด</button></span>
                    </div>
                    <div style={{ fontSize: 11.5, color: C.mute, margin: "4px 0" }}>คอลัมน์หลัก</div>
                    {BASE_COLS.map((c) => <label key={c.id} style={{ display: "flex", gap: 8, fontSize: 13, padding: "2px 0", cursor: "pointer" }}><input type="checkbox" checked={colSel.includes(c.id)} onChange={() => toggleCol(c.id)} />{c.label}</label>)}
                    <div style={{ fontSize: 11.5, color: C.mute, margin: "10px 0 4px" }}>คอลัมน์จากไฟล์รายงานต้นทาง</div>
                    {hdrAll.length === 0 ? <div style={{ fontSize: 12, color: C.mute }}>ยังไม่มีข้อมูลคอลัมน์ (โยนไฟล์ใหม่อีกครั้ง)</div> : hdrAll.map((h, i2) => <label key={i2} style={{ display: "flex", gap: 8, fontSize: 13, padding: "2px 0", cursor: "pointer" }}><input type="checkbox" checked={colSel.includes("o" + i2)} onChange={() => toggleCol("o" + i2)} />{String(h || `คอลัมน์ ${i2 + 1}`)}</label>)}
                  </div>)}
              </div>
              </div>
              {(isStart && !curStep.fromSwapList) || tab === "out" || !curStep.inSet
                ? <DetailTable set={curStep.out} rate={curStep.outRate} label="Out" target={target} hdr={hdrAll} cols={showCols2(colSel, hasTc)} invLabel={invLabel} />
                : <DetailTable set={curStep.inSet.set} rate={curStep.rateIn} label="In" target={target} hdr={hdrAll} cols={showCols2(colSel, hasTc)} invLabel={invLabel} />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: History ────────────────────────────────────────────────────────────
function History({ onOpen, refreshKey, flat }) {
  const [jobs, setJobs] = React.useState(loadJobs());
  React.useEffect(() => { // รายการจาก DB + รายการที่เก็บในเครื่อง (ที่ยังไม่ได้ขึ้น DB)
    let off = false;
    setJobs(loadJobs());
    cloudListJobs().then((cl) => { if (off || !cl) return; const ids = new Set(cl.map((x) => x.id)); setJobs([...cl, ...loadJobs().filter((x) => !ids.has(x.id))]); });
    return () => { off = true; };
  }, [refreshKey]);
  const del = (id) => { const j = loadJobs().filter((x) => x.id !== id); saveJobs(j); setJobs((cur) => cur.filter((x) => x.id !== id)); cloudDeleteJob(id); };
  const openJob = async (j) => { if (j.cloud) { const full = await cloudGetJob(j.id); if (full) onOpen(full); return; } onOpen(j); };
  if (!jobs.length) return <div style={{ ...(flat ? {} : card), color: "#6b7785", fontSize: 13 }}>ยังไม่มีงานที่บันทึกไว้ (บันทึกจากหน้า VAT Swap Finder · เก็บในเครื่องนี้)</div>;
  const label = { done: "ครบแล้ว", "need-file": "รอ Input เดือนถัดไป", nomatch: "NOT MATCH", "out-nomatch": "NOT MATCH (Out)", draft: "ฉบับร่าง", error: "ผิดพลาด", running: "-" };
  return (
    <div style={flat ? {} : card}>
      {jobs.map((j) => (
        <div key={j.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 0", borderTop: `1px solid ${C.line}`, flexWrap: "wrap" }}>
          <div><div style={{ fontWeight: 600 }}>{j.name}</div><div style={{ fontSize: 12, color: "#6b7785" }}>{label[j.status] || j.status}{j.lastMonth ? ` · ล่าสุดเดือน ${j.lastMonth}` : ""}{j.expiresAt ? ` · จะถูกลบ ${new Date(j.expiresAt).toLocaleDateString("th-TH")}` : ""}</div></div>
          <div style={{ display: "flex", gap: 8 }}><button type="button" style={btn(true)} onClick={() => openJob(j)}>เปิดทำต่อ</button><button type="button" style={btn(false)} onClick={() => del(j.id)}>ลบ</button></div>
        </div>))}
    </div>
  );
}


// MARKER_VATTOOLBOX_SWAPLIST_V1 : Swap List — รายการที่ Watchlist ส่งมาให้สลับ (รอรับข้อมูลจาก Watchlist ; ตอนนี้เก็บในเครื่องของแต่ละคน)
const SWAPLIST_LS = "vat_toolbox_swap_list_v1";
const SWAPLIST_EVT = "vat-toolbox-swap-list"; // window.dispatchEvent(new CustomEvent("vat-toolbox-swap-list", { detail: { items: [...] } })) -> เพิ่มรายการ
// Swap List เป็นของ User นั้นๆ : แยกคีย์ตามอีเมล/ชื่อผู้ใช้ (เครื่องเดียวกันแต่ login คนละคน ไม่เห็นรายการของกัน)
const userKeyOf = (auth) => String((auth && ((auth.currentUser && auth.currentUser.email) || auth.userName)) || "anon").trim().toLowerCase();
const MON3 = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const ymFromReceipt = (t) => { const v = String(t || "").trim(); let m = v.match(/^(\d{4})-(\d{2})/); if (m) return `${m[1]}-${m[2]}`; m = v.match(/^\d{1,2}-([A-Za-z]{3})-(\d{2})$/); if (m) { const i = MON3.indexOf(m[1].toUpperCase()); if (i >= 0) return `20${m[2]}-${String(i + 1).padStart(2, "0")}`; } return ""; };
const recvLabel = (x) => { const v = String((x && x.receive_date) || "").trim(); const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[3]}-${MON3[Number(m[2]) - 1][0]}${MON3[Number(m[2]) - 1].slice(1).toLowerCase()}-${m[1].slice(2)}`; return v || adjLabel(x && x.adjust_month); };
const adjLabel = (ym) => (/^\d{4}-\d{2}$/.test(ym || "") ? `${ym.slice(5)}.${ym.slice(0, 4)}` : "—");
// MARKER_VATTOOLBOX_SWAP_DONE_V1 : Export แล้วรายการที่ดึงมาใช้ต้องหายจาก Swap List (และไม่ถูกดึงกลับจาก Draft ใน DB)
const SWAPDONE_LS = "vat_toolbox_swap_done_v1";
const swapKeysOf = (x) => [x.id, x.draft_id ? `${x.draft_id}|${x.invoice_ref}` : null].filter(Boolean).map(String);
const loadSwapDone = (uk) => { try { const v = JSON.parse(localStorage.getItem(`${SWAPDONE_LS}:${uk}`) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
const markSwapDone = (uk, keys) => {
  if (!keys || !keys.length) return;
  try { localStorage.setItem(`${SWAPDONE_LS}:${uk}`, JSON.stringify([...new Set([...loadSwapDone(uk), ...keys.map(String)])].slice(-2000))); } catch (e) { /* ไม่เป็นไร */ }
  try {
    const ks = new Set(keys.map(String));
    const cur = JSON.parse(localStorage.getItem(`${SWAPLIST_LS}:${uk}`) || "[]");
    const nx = (Array.isArray(cur) ? cur : []).filter((x) => !swapKeysOf(x).some((k) => ks.has(k)));
    localStorage.setItem(`${SWAPLIST_LS}:${uk}`, JSON.stringify(nx));
  } catch (e) { /* ไม่เป็นไร */ }
  window.dispatchEvent(new CustomEvent(SWAPLIST_EVT, { detail: { refresh: true } }));
};
const loadSwapList = (uk) => { try { const v = JSON.parse(localStorage.getItem(`${SWAPLIST_LS}:${uk}`) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
const saveSwapList = (uk, v) => { try { localStorage.setItem(`${SWAPLIST_LS}:${uk}`, JSON.stringify(v)); } catch (e) { /* ไม่เป็นไร */ } };
function SwapListButton() {
  const auth = useAuth();
  const uk = userKeyOf(auth);
  const [items, setItems] = React.useState(() => loadSwapList(uk));
  React.useEffect(() => { // Export ไปแล้ว (งานที่บันทึกไว้มีเวลาหมดอายุ) -> ล้างรายการนั้นออกจาก Swap List ให้เอง
    try {
      const ks = loadJobs().filter((j) => j && j.expiresAt && j.params && Array.isArray(j.params.swapKeys) && j.params.swapKeys.length).flatMap((j) => j.params.swapKeys);
      if (ks.length) { markSwapDone(uk, ks); setItems(loadSwapList(uk)); }
    } catch (e) { /* ไม่เป็นไร */ }
  }, [uk]);
  // MARKER_VATTOOLBOX_SWAPLIST_FROM_DRAFT_V1 : ดึง Popvat_S ที่ยังเป็น Draft ของผู้ใช้นี้จาก DB เข้ามารวม (เติมรายการจาก Draft เข้ามา (ไม่ลบเมื่อ Draft ถูก Confirm; Restore จะลบผ่าน VatController))
  const syncFromDrafts = React.useCallback(async () => {
    try {
      const mine = new Set([String(auth.userName || "").trim().toLowerCase(), String((auth.currentUser && auth.currentUser.email) || "").trim().toLowerCase()].filter(Boolean));
      const rows = await apiFetch("/vat_upload_popvatdraft?eq_action=Popvat_S");
      const dr = (Array.isArray(rows) ? rows : []).filter((r) => mine.has(String(r.username || "").trim().toLowerCase()) && String(r.status || "").toLowerCase().includes("draft"));
      const fromDb = dr.map((r) => ({ id: `draft:${r.draft_id}:${r.original_invoice_number}`, draft_id: r.draft_id, from: "Watchlist (Draft)", addedAt: Date.parse(r.created_at) || Date.now(), owner: uk, bu: r.bu, invoice_ref: r.original_invoice_number, branch: r.branch, vendor: r.supplier_name, tax_invoice_no: r.grt_number || "", amount: Number(r.product_value) || 0, vat: Number(r.vat_amount) || 0, adjust_month: ymFromReceipt(r.receipt_date), receive_date: r.receipt_date || "" }));
      const doneSet = new Set(loadSwapDone(uk));
      const fromDbAll = fromDb; fromDb.splice(0, fromDb.length, ...fromDbAll.filter((y) => !swapKeysOf(y).some((k) => doneSet.has(k))));
      setItems((cur) => {
        const keep = cur; // Confirm/End Process แล้ว Draft หายจาก DB ก็ยังไม่ลบ (งาน Swap ยังไม่เสร็จ) ; ลบเฉพาะเมื่อ Restore หรือกด ✕ / ล้างทั้งหมด
        const have = new Set(keep.filter((x) => x.draft_id).map((x) => `${x.draft_id}|${x.invoice_ref}`));
        const merged = [...keep.map((x) => { const d = fromDb.find((y) => String(y.draft_id) === String(x.draft_id) && y.invoice_ref === x.invoice_ref); return d ? { ...x, ...d, tax_invoice_no: x.tax_invoice_no || d.tax_invoice_no, supplier_code: x.supplier_code } : x; }), ...fromDb.filter((y) => !have.has(`${y.draft_id}|${y.invoice_ref}`))];
        saveSwapList(uk, merged);
        return merged;
      });
    } catch (e) { /* ไม่มี Endpoint/เน็ตหลุด -> ใช้รายการในเครื่องต่อไป */ }
  }, [auth, uk]);
  React.useEffect(() => { syncFromDrafts(); }, [syncFromDrafts]);
  const [open, setOpen] = React.useState(false);
  const [sel, setSel] = React.useState(() => new Set());
  const [useMsg, setUseMsg] = React.useState("");
  React.useEffect(() => { if (open) syncFromDrafts(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { setItems(loadSwapList(uk)); }, [uk]);
  React.useEffect(() => {
    const add = (e) => {
      // ถ้าส่งมาระบุผู้รับ (detail.user) ต้องตรงกับผู้ใช้ที่ login อยู่เท่านั้น
      const target = e && e.detail && e.detail.user ? String(e.detail.user).trim().toLowerCase() : "";
      if (target && target !== uk) return;
      if (e && e.detail && e.detail.refresh) { setItems(loadSwapList(uk)); return; } // Restore ใน Draft Monitor -> ตัดรายการที่ Draft หายไปออกจาก Swap List
      const inc = (e && e.detail && Array.isArray(e.detail.items) ? e.detail.items : []).map((x, i) => ({ id: x.id || `${Date.now()}_${i}`, from: "Watchlist", addedAt: Date.now(), owner: uk, ...x }));
      if (!inc.length) return;
      setItems((cur) => { const seen = new Set(cur.map((x) => x.id)); const nx = [...cur, ...inc.filter((x) => !seen.has(x.id))]; saveSwapList(uk, nx); return nx; });
    };
    window.addEventListener(SWAPLIST_EVT, add);
    return () => window.removeEventListener(SWAPLIST_EVT, add);
  }, [uk, syncFromDrafts]);
  const del = (id) => setItems((cur) => { const nx = cur.filter((x) => x.id !== id); saveSwapList(uk, nx); return nx; });
  const toggleSel = (id) => setSel((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const useItems = () => { // ดึงมาใช้ : ที่ติ๊กไว้ (ไม่ติ๊ก = ทั้งหมด) -> ยอด VAT รวม + สาขา ไปที่ Swap Finder
    const ch = items.filter((x) => sel.has(x.id)); const use = ch.length ? ch : items; if (!use.length) return;
    const target = Math.round(use.reduce((a, x) => a + (Number(x.vat) || 0), 0) * 100) / 100;
    const brs = [...new Set(use.map((x) => String(x.branch || "").trim()).filter(Boolean))];
    window.dispatchEvent(new CustomEvent("vat-toolbox-swap-use", { detail: { target: Math.abs(target), branch: brs.join(", "), items: use, keys: use.flatMap(swapKeysOf), ym: Math.min(...use.map((x) => ymIdxOf(ymFromReceipt(x.receive_date) || x.adjust_month)).filter(Boolean).concat([1e9])) % 1e9 } }));
    setUseMsg(`ดึง ${use.length} ใบ ยอด VAT ${fmt(target)}${brs.length ? ` สาขา ${brs.join(", ")}` : ""} ไปที่เงื่อนไขแล้ว`);
    setOpen(false);
  };
  const clear = async () => { if (items.length && await confirmDialog.confirm("ล้างรายการ Swap List ทั้งหมด?", { title: "ล้าง Swap List", variant: "danger" })) { setItems([]); saveSwapList(uk, []); } };
  const th = { textAlign: "left", fontSize: 11.5, color: "#44515e", fontWeight: 700, padding: "8px 10px", background: "#eef4f0", borderBottom: "2px solid #cfe3d6", whiteSpace: "nowrap" };
  const td = { padding: "8px 10px", borderBottom: `1px solid ${C.line}`, fontSize: 13, whiteSpace: "nowrap" };
  return (
    <div style={{ position: "relative", marginTop: 8, display: "inline-block" }}>
      <button type="button" onClick={() => setOpen((v) => !v)} style={{ ...btn(false), display: "inline-flex", alignItems: "center", gap: 8, padding: "7px 14px" }}>
        <span>📋 Swap List</span>
        <span style={{ minWidth: 20, padding: "1px 7px", borderRadius: 10, fontSize: 12, textAlign: "center", background: items.length ? C.g : "#e3e8ee", color: items.length ? "white" : C.mute }}>{items.length}</span>
      </button>
      {open && (
        <div style={{ position: "absolute", right: 0, top: "100%", marginTop: 6, zIndex: 60, width: 640, maxWidth: "90vw", background: "white", border: `1px solid ${C.line}`, borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,.18)", padding: 14, textAlign: "left" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontWeight: 700, color: "#14213d" }}>Swap List <span style={{ fontWeight: 400, fontSize: 12, color: C.mute }}>· รายการที่ส่งมาจาก Watchlist</span></div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={useItems} disabled={!items.length} style={{ ...btn(true, !items.length), padding: "5px 12px", fontSize: 12.5 }}>ดึงมาใช้{sel.size ? ` (${sel.size})` : " (ทั้งหมด)"}</button>
              <button type="button" onClick={clear} disabled={!items.length} style={{ ...btn(false, !items.length), padding: "5px 12px", fontSize: 12.5 }}>ล้างทั้งหมด</button>
              <button type="button" onClick={() => setOpen(false)} style={{ ...btn(false), padding: "5px 12px", fontSize: 12.5 }}>ปิด</button>
            </div>
          </div>
          {useMsg && <div style={{ margin: "0 0 8px", padding: "6px 10px", background: "#eef8f1", border: "1px solid #cfe3d6", borderRadius: 8, fontSize: 12.5 }}>{useMsg}</div>}
          {items.length === 0
            ? <div style={{ padding: "22px 8px", textAlign: "center", fontSize: 13, color: C.mute, border: `1px dashed ${C.line}`, borderRadius: 10 }}>ยังไม่มีรายการที่ส่งมาจาก Watchlist</div>
            : <div style={{ maxHeight: 340, overflow: "auto", border: `1px solid ${C.line}`, borderRadius: 10 }}>
                <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%" }}>
                  <thead><tr><th style={th} /><th style={th}>BU</th><th style={th}>Receive Date (Popvat)</th><th style={th}>เลขที่ใบกำกับภาษี</th><th style={th}>Invoice Ref.</th><th style={th}>ผู้ค้า</th><th style={{ ...th, textAlign: "right" }}>เงินภาษี</th><th style={th}>ส่งมาเมื่อ</th><th style={th} /></tr></thead>
                  <tbody>{items.map((x) => (
                    <tr key={x.id} onDoubleClick={() => { window.dispatchEvent(new CustomEvent("vat-toolbox-swap-use", { detail: { target: Math.abs(Number(x.vat) || 0), branch: String(x.branch || "").trim(), items: [x], keys: swapKeysOf(x), ym: ymIdxOf(ymFromReceipt(x.receive_date) || x.adjust_month) } })); setOpen(false); }} title="Double Click เพื่อดึงเฉพาะใบนี้" style={{ cursor: "pointer" }}>
                      <td style={td}><input type="checkbox" checked={sel.has(x.id)} onChange={() => toggleSel(x.id)} /></td>
                      <td style={td}>{x.bu || "—"}</td><td style={{ ...td, ...mono, fontWeight: 700 }}>{recvLabel(x)}</td><td style={{ ...td, ...mono }}>{x.tax_invoice_no || x.inv || "—"}</td><td style={{ ...td, ...mono }}>{x.invoice_ref || x.ref || "—"}</td>
                      <td style={{ ...td, whiteSpace: "normal", minWidth: 160 }}>{x.vendor || x.vendor_name || "—"}</td>
                      <td style={{ ...td, ...mono, textAlign: "right" }}>{x.vat != null && x.vat !== "" ? fmt(x.vat) : "—"}</td>
                      <td style={{ ...td, color: C.mute, fontSize: 12 }}>{x.addedAt ? new Date(x.addedAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "—"}</td>
                      <td style={td}><button type="button" onClick={() => del(x.id)} title="ลบรายการนี้" style={{ border: "none", background: "none", color: C.bad, cursor: "pointer", fontSize: 14 }}>✕</button></td>
                    </tr>))}</tbody>
                </table>
              </div>}
        </div>
      )}
    </div>
  );
}

export default function VatToolbox() {
  const [resume, setResume] = React.useState(null);
  const [mountKey, setMountKey] = React.useState(0);
  const [hk, setHk] = React.useState(0);
  React.useEffect(() => { // เปิดงานที่เลือกจาก Flyout เมนูซ้าย
    const pick = () => {
      let id = null; try { id = localStorage.getItem("vat_toolbox_open_job"); localStorage.removeItem("vat_toolbox_open_job"); } catch (e) { id = null; }
      if (id === null) return;
      const j = id ? loadJobs().find((x) => x.id === id) : null;
      if (id && !j) { cloudGetJob(id).then((full) => { setResume(full ? { ...full, extra: full.extra || [] } : null); setMountKey((x) => x + 1); }); return; } // MARKER_VAT_TOOLBOX_DB_DRAFT_V1 -- Draft อยู่ใน DB
      setResume(j ? { ...j, extra: j.extra || [] } : null); setMountKey((x) => x + 1);
    };
    pick(); window.addEventListener("vat-toolbox-open", pick);
    return () => window.removeEventListener("vat-toolbox-open", pick);
  }, []);
  return (
    <div style={{ padding: "10px 24px 12px", width: "100%", height: "100%", overflow: "hidden", boxSizing: "border-box", color: C.text, display: "flex", flexDirection: "column", gap: 6 }}> {/* Split-Pane แบบ VatDashboard: ส่วนบนอยู่กับที่ ส่วน Monitor เลื่อนในกรอบตัวเอง */}
      <div style={{ background: "white", border: `1px solid ${C.line}`, borderLeft: "4px solid #0f766e", borderRadius: 14, padding: "14px 20px", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, color: "#0f766e" }}>VAT CONTROLLER</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#14213d", lineHeight: 1.2 }}>VAT <span style={{ color: "#0f766e" }}>Swap Finder</span></div>
          <div style={{ fontSize: 12, color: C.mute, marginTop: 4, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span><span style={{ color: "#1e8e4a" }}>●</span> Toolbox</span><span>|</span>
            <span>Period: {ymStr(workingPeriod())}</span><span>|</span>
            <span>อัปเดตล่าสุด: {new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}</span>
          </div>
        </div>
        <div id="swap-rate-slot" style={{ alignSelf: "center", marginLeft: "auto", marginRight: 8 }} />
        <div style={{ fontSize: 13, color: "#14213d", textAlign: "right" }}>
          <div>{new Date().toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
          <div style={{ fontSize: 11.5, color: C.mute, marginTop: 4 }}>คำนวณในเบราว์เซอร์ · ไฟล์ไม่ถูกส่งออกจากเครื่อง</div>
          <SwapListButton />
        </div>
      </div>
      <SwapFinder key={mountKey} initial={resume} hk={hk} onSaved={() => setHk((x) => x + 1)} onOpenJob={(j) => { setResume({ ...j, extra: j.extra || [] }); setMountKey((x) => x + 1); }} />
    </div>
  );
}
