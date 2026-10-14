// vatMailExport.js -- MARKER_VATMAILEXPORT_ROUTER_V1
// POST /api/vat-mail-export/build    { config_id [, zone_bu, supplier_codes, rows] } -> สร้าง Excel + เนื้อหาเมล (ยังไม่ส่งเมลจริง)
// POST /api/vat-mail-export/preview  (พารามิเตอร์เดียวกัน) -> รายการ Supplier + Invoice/Aging + To/CC สำหรับหน้าต่าง Confirm (ไม่สร้างไฟล์)
// MARKER_VATMAILEXPORT_ALL_BOTH_ZONE_V1 -- Config.bu รองรับ ALL / BOTH / รายชื่อ BU คั่น , | zone_bu = สั่งจาก Incomplete Zone (Both -> เฉพาะ BU นั้น)
import { Router } from "express";
import { pool, getUsernameByEmail } from "../db.js";
import ExcelJS from "exceljs"; // MARKER_VATMAILEXPORT_PREVIEW_EMAIL_VIEW_V1
import zlib from "zlib";
import fs from "fs";
import path from "path";
import {
  buildBuWorkbook, buildAgingLines, applyVars,
  matchRelatedPerson, taxGroupOf, fmtMoney, monthLabel, num,
} from "./vatMailExportGenerator.js";

const router = Router();
const RED = "#C00000"; const GREEN = "#1E8E3E"; // Aging 5-6 = แดง, 0-4 = เขียว (ตามตัวอย่างเมล)
const escHtml = (t) => String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// เนื้อหาเมลแบบ HTML: ตัวแปรปกติแทนค่าแล้ว escape, {AGING_LIST} ใส่สีแดง/เขียวรายบรรทัด, {BU_LIST} เป็นตาราง
function buildBodyHtml(template, vars, lines, buListHtml, invoiceHtml) {
  const agingHtml = lines.map((l) => `<span style="color:${l.aging >= 5 ? RED : GREEN}">${escHtml(l.text)}</span>`).join("<br>");
  const renderSeg = (tpl) => String(tpl || "").split("{AGING_LIST}").map((seg) => escHtml(applyVars(seg, vars)).replace(/\r?\n/g, "<br>")).join(agingHtml);
  const html = String(template || "").split("{INVOICE_LIST}").map((t) => t.split("{BU_LIST}").map(renderSeg).join(buListHtml || "")).join(invoiceHtml || ""); // MARKER_VATMAILEXPORT_INVOICE_LIST_V1
  return `<div style="font-family:Tahoma,'Segoe UI',sans-serif;font-size:11pt">${html}</div>`;
}
// MARKER_VATMAILEXPORT_PREVIEW_EMAIL_VIEW_V1 -- อ่านเนื้อหา Excel แนบ (ทุก Sheet) เป็น Array สำหรับปุ่ม View ในหน้า Draft Mail (จำกัด 300 แถว x 30 คอลัมน์)
async function readSheets(buffer) {
  try {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer);
    return wb.worksheets.slice(0, 5).map((ws) => {
      const rows = []; const maxC = Math.min(ws.columnCount || 0, 30);
      ws.eachRow({ includeEmpty: false }, (row, rn) => {
        if (rows.length >= 300) return;
        const out = [];
        for (let c = 1; c <= maxC; c++) { let v = row.getCell(c).value; if (v && typeof v === "object") { if (v instanceof Date) v = v.toISOString().slice(0, 10); else if (v.result !== undefined) v = v.result; else if (v.richText) v = v.richText.map((x) => x.text).join(""); else if (v.text) v = v.text; else v = ""; } out.push(v == null ? "" : v); }
        rows.push(out);
      });
      return { name: ws.name, rows, total_rows: ws.rowCount || rows.length };
    });
  } catch (e) { console.error("readSheets:", e.message); return []; }
}
const STORAGE_ROOT = "C:\\apps\\fastapn-backend\\storage";
const safe = (s) => String(s).replace(/[\\/:*?"<>|\s]+/g, "_");
const parseJson = (v, d) => { if (v == null) return d; if (typeof v === "object") return v; try { return JSON.parse(v); } catch { return d; } };

// ── Helper: อ่านคอลัมน์โดยไม่สนตัวพิมพ์/ช่องว่าง/underscore (กันชื่อคอลัมน์ใน DB สะกดต่างกัน) ──
const normKey = (k) => String(k).toUpperCase().replace(/[\s_]+/g, " ").trim();
const pickCol = (row, ...names) => {
  if (!row) return "";
  const want = names.map(normKey);
  for (const k of Object.keys(row)) {
    if (want.includes(normKey(k))) { const v = row[k]; if (v != null && String(v).trim() !== "") return String(v).trim(); }
  }
  return "";
};
const cleanBranch = (b) => String(b || "").trim().replace(/^[ATF]/i, "");
const toDate = (v) => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
const fmtMY = (d) => `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`; // 07/2026

async function storeFile(module, bu, refId, fileName, buffer, username) {
  const now = new Date();
  const yyyyMm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const dir = path.join(STORAGE_ROOT, safe(bu), yyyyMm);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${safe(refId)}_${module}.xlsx.gz`);
  fs.writeFileSync(filePath, zlib.gzipSync(buffer));
  const { rows } = await pool.query(
    `INSERT INTO file_storage (module, bu, ref_id, file_path, file_name, owner_username, status, retention_days)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', $7) RETURNING id`,
    [module, bu, refId, filePath, fileName, username, null]
  );
  return rows[0].id;
}

// ── ขอบเขต BU ของ Config: ALL = ทุก BU | BOTH = (สั่งจาก Incomplete Zone -> BU นั้น / สั่งจากหน้าแรก -> ทุก BU) | รายชื่อ BU คั่น , ──
async function resolveScope(cfg, ctx) {
  const raw = String(cfg.bu || "").trim();
  const up = raw.toUpperCase();
  const zoneBu = String((ctx && ctx.zone_bu) || "").trim();
  const allBus = async () => {
    const { rows } = await pool.query(`SELECT DISTINCT bu FROM vat_watchlist_report WHERE status IN ('pending','type_a') AND bu IS NOT NULL AND TRIM(bu) <> ''`);
    const list = rows.map((r) => String(r.bu).trim()).filter(Boolean).sort();
    if (list.length === 0) throw new Error("ไม่พบ BU ที่มีรายการค้าง");
    return list;
  };
  if (up === "ALL") return { bus: await allBus(), label: "ALL BU" };
  if (up === "BOTH") return zoneBu ? { bus: [zoneBu], label: zoneBu } : { bus: await allBus(), label: "ALL BU" };
  const bus = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (bus.length === 0) throw new Error("Config ไม่มี BU");
  if (zoneBu) {
    if (!bus.includes(zoneBu)) throw new Error(`Config นี้ไม่ครอบคลุม BU ${zoneBu}`);
    return { bus: [zoneBu], label: zoneBu };
  }
  return { bus, label: bus.join(", ") };
}

// ── ดึงรายการตามเงื่อนไขของ Config ──
// MARKER_VATMAILEXPORT_INCLUDE_TYPE_A_V1 -- ดึงแถว Type A (status='type_a') มารวมกับ pending ในเมล ({INVOICE_LIST}, Excel แนบ, ยอดรวม, Aging) เพราะต้องติดตามเช่นเดียวกัน
// MARKER_VATMAILEXPORT_TYPE_A_RESTORE_AGING_V1 -- Type A ถูกบันทึกด้วย aging_months = NULL (IV-Aging Uncount) ตอน Popvat จึงหลุดเงื่อนไข Aging 0-6 -> ดึงมาโดยไม่ดู Aging ใน SQL แล้วคืนค่า Aging เดิมจาก type_prev_aging ({l,m}) ก่อนกรอง/จัดกลุ่ม/ลง Excel
function restoreTypeAAging(rows, allowed) {
  const out = [];
  rows.forEach((r) => {
    if (r.status !== "type_a") { out.push(r); return; }
    let prev = r.type_prev_aging;
    if (typeof prev === "string") { try { prev = JSON.parse(prev); } catch { prev = null; } }
    const m = prev && prev.m != null && prev.m !== "" ? Number(prev.m) : null;
    if (m != null && !Number.isNaN(m)) { r.aging_months = m; if (prev.l != null) r.aging_label = prev.l; }
    if (allowed === null) { out.push(r); return; } // เลือกแถวเอง -> เก็บไว้ทุกแถว
    if (r.aging_months != null && allowed.includes(Number(r.aging_months))) out.push(r); // ไม่มี Aging เดิม / นอก 0-6 / นอกเงื่อนไข Aging ของ Config -> ไม่เอา
  });
  return out;
}

async function fetchRows(cfg, scope, ctx) {
  const rules = parseJson(cfg.rules, {});
  const vendors = parseJson(cfg.vendors, []);
  const bus = scope.bus;

  // MARKER_VATMAILEXPORT_ZONE_FETCH_V1 -- สั่งจาก Incomplete Zone: ไม่ใช้เงื่อนไข/Include/Ignore ของ Config ใช้เฉพาะ BU + Supplier (+ แถวที่ติ๊กเลือกถ้ามี)
  if (ctx && ctx.zone_bu) {
    const codes = [...new Set((Array.isArray(ctx.supplier_codes) ? ctx.supplier_codes : []).map((c) => String(c || "").trim()).filter(Boolean))];
    if (codes.length === 0) throw new Error("ไม่ได้ระบุ Supplier");
    const params = [bus];
    const add = (v) => { params.push(v); return `$${params.length}`; };
    const where = [`status IN ('pending','type_a')`, `bu = ANY($1)`, `supplier_code::text = ANY(${add(codes)})`];
    const sel = (Array.isArray(ctx.rows) ? ctx.rows : []).filter((x) => x && x.supplier_code && x.invoice_ref);
    if (sel.length) {
      where.push(`(supplier_code::text, invoice_ref::text, COALESCE(check_no::text, '')) IN (SELECT * FROM unnest(${add(sel.map((x) => String(x.supplier_code).trim()))}::text[], ${add(sel.map((x) => String(x.invoice_ref).trim()))}::text[], ${add(sel.map((x) => String(x.check_no || "").trim()))}::text[]))`);
    } else {
      where.push(`(status = 'type_a' OR (aging_months IS NOT NULL AND aging_months BETWEEN 0 AND 6))`);
    }
    const { rows: zrows } = await pool.query(`SELECT * FROM vat_watchlist_report WHERE ${where.join(" AND ")}`, params);
    const rows = restoreTypeAAging(zrows, sel.length ? null : [0, 1, 2, 3, 4, 5, 6]);
    return { rows, rules, bus };
  }

  const params = [bus];
  const where = [`status IN ('pending','type_a')`, `bu = ANY($1)`, `(status = 'type_a' OR (aging_months IS NOT NULL AND aging_months BETWEEN 0 AND 6))`];
  const add = (v) => { params.push(v); return `$${params.length}`; };

  const aging = (rules.aging || []).map(String).filter((a) => /^[0-6]$/.test(a)).map(Number);
  if (aging.length) where.push(`(status = 'type_a' OR aging_months = ANY(${add(aging)}))`);

  const pay = rules.pay || [];
  if (pay.length) where.push(`(${pay.map((p) => `UPPER(COALESCE(check_no,'')) LIKE ${add("%" + String(p).toUpperCase())}`).join(" OR ")})`);

  const types = rules.types || [];
  if (types.length) where.push(`bus_type = ANY(${add(types)})`);

  const ignore = (rules.ignore || []).map((x) => (typeof x === "string" ? x : x.code)).filter(Boolean);
  if (ignore.length) where.push(`NOT (supplier_code = ANY(${add(ignore)}))`);

  let cond = `(${where.join(" AND ")})`;
  if (cfg.scope_mode === "BY_VENDOR") {
    const vc = (Array.isArray(vendors) ? vendors : []).map((x) => (typeof x === "string" ? x : x.code)).filter((c) => c && c !== "{SupplierLine}" && c !== "{Operation_Supplier}"); // MARKER_VATMAILEXPORT_OPERATION_SUPPLIER_PH_V1 -- {Operation_Supplier} = Supplier มาจากหน้า Operation ไม่ใช่ Vendor จริง
    if (vc.length) cond += ` AND supplier_code = ANY(${add(vc)})`; // MARKER_VATMAILEXPORT_BYVENDOR_EMPTY_APPLY_BU_V1 -- ไม่ระบุ Vendor = ทุก Supplier ของ BU
  }

  // Include = ดึงเพิ่มนอกเงื่อนไข (ยังจำกัด pending + BU + Aging 0-6 + ไม่อยู่ใน Ignore)
  const include = (rules.include || []).map((x) => (typeof x === "string" ? x : x.code)).filter(Boolean);
  let sql;
  if (include.length && cfg.scope_mode !== "BY_VENDOR") {
    const inc = `(status IN ('pending','type_a') AND bu = ANY($1) AND (status = 'type_a' OR aging_months BETWEEN 0 AND 6) AND supplier_code = ANY(${add(include)})${ignore.length ? ` AND NOT (supplier_code = ANY($${params.indexOf(ignore) + 1}))` : ""})`;
    sql = `SELECT * FROM vat_watchlist_report WHERE ${cond} OR ${inc}`;
  } else {
    sql = `SELECT * FROM vat_watchlist_report WHERE ${cond}`;
  }
  const { rows: rawRows } = await pool.query(sql, params);
  // MARKER_VATMAILEXPORT_JUNK_SUBTOTAL_V1 -- ตัดข้อความสรุปยอดกลุ่ม ("Total Group Branch : &cp_group1 : ...") ที่ติดมากับชื่อผู้ค้า/คอลัมน์อื่น; แถวที่ไม่มีใบแจ้งหนี้/เช็ค = แถวสรุปล้วน ตัดทิ้ง
  const JUNK_RE = /\s*(?:[-=_]{3,}\s*)?(?:total\s*group\s*branch|&cp_).*$/i;
  const rows = [];
  rawRows.forEach((r) => {
    let junk = false;
    Object.keys(r).forEach((k) => { if (typeof r[k] === "string" && JUNK_RE.test(r[k])) { junk = true; r[k] = r[k].replace(JUNK_RE, "").trim(); } });
    if (junk && !String(r.invoice_ref || "").trim() && !String(r.check_no || "").trim()) return;
    rows.push(r);
  });
  const okAging = aging.length ? aging : [0, 1, 2, 3, 4, 5, 6];
  return { rows: restoreTypeAAging(rows, okAging), rules, bus };
}

async function loadRelatedRules(bus) {
  try {
    const { rows } = await pool.query(`SELECT * FROM vat_watchlist_related_person WHERE bu = ANY($1)`, [bus]);
    const byBu = {}; rows.forEach((r) => { (byBu[r.bu] = byBu[r.bu] || []).push(r); });
    return { byBu, all: rows };
  } catch { return { byBu: {}, all: [] }; }
}

// ── MARKER_VATMAILEXPORT_BU_LOOKUP_V1 -- ชื่อบริษัทไทย (company_list."THAI COMPANY NAME") + Tax ID/Branch ของ BU (branch_list."BU-TaxID"/"BU-Branch" Lookup ด้วย Branch Code) ──
async function loadLookups(rows) {
  const buList = [...new Set(rows.map((r) => String(r.bu || "").trim()).filter(Boolean))];
  const buInfoByBu = {};
  try {
    const { rows: cl } = await pool.query(`SELECT * FROM company_list WHERE bu = ANY($1)`, [buList]);
    cl.forEach((c) => {
      buInfoByBu[String(c.bu).trim()] = {
        name: pickCol(c, "THAI COMPANY NAME") || pickCol(c, "Business Name", "business_name", "name"),
        taxId: pickCol(c, "TAX ID", "tax_id"),
      };
    });
  } catch (e) { console.error("company_list:", e.message); }
  const branchByCode = {};
  try {
    const codes = new Set();
    rows.forEach((r) => { const b = String(r.branch || "").trim(); if (b) { codes.add(b); codes.add(cleanBranch(b)); } });
    if (codes.size) {
      const { rows: bl } = await pool.query(`SELECT * FROM branch_list WHERE TRIM("Branch Code") = ANY($1)`, [[...codes]]);
      const closed = (b) => ["closed", "relocate"].includes(String(b.status || "").trim().toLowerCase());
      bl.forEach((b) => {
        const k = String(b["Branch Code"] || "").trim();
        if (!k) return;
        if (!branchByCode[k] || (closed(branchByCode[k]) && !closed(b))) branchByCode[k] = b;
      });
    }
  } catch (e) { console.error("branch_list:", e.message); }
  const rowInfo = (r) => {
    const b = String(r.branch || "").trim();
    const br = branchByCode[b] || branchByCode[cleanBranch(b)] || {};
    const bi = buInfoByBu[String(r.bu || "").trim()] || {};
    return { name: bi.name || "", taxId: pickCol(br, "BU-TaxID", "BU-Tax ID") || bi.taxId || "", branch: pickCol(br, "BU-Branch"), brandBu: pickCol(br, "BU") }; // MARKER_VATMAILEXPORT_BU_BY_BRANCHLIST_V1 -- brandBu = branch_list."BU" (เช่น 502xxx = KFC)
  };
  return { buInfoByBu, rowInfo };
}

// MARKER_VATMAILEXPORT_BU_BY_BRANCHLIST_V1 -- Group Range (vat_watchlist_bu_group_range) ใช้เป็นตัวสำรอง: ตัด A/T/F -> อ่าน N ตำแหน่ง -> Range แคบสุดชนะ (ตรรกะเดียวกับ Frontend matchVatWatchlistBuGroup)
async function loadBuGroupRanges() {
  try { const { rows } = await pool.query(`SELECT * FROM vat_watchlist_bu_group_range`); return rows; } catch { return []; }
}
function matchBuGroup(branch, ranges) {
  if (!branch || !Array.isArray(ranges) || ranges.length === 0) return "";
  const clean = String(branch).trim().replace(/^[ATF]/i, "");
  let best = ""; let bestSpan = Infinity;
  for (const r of ranges) {
    const key = r.prefix_length ? clean.slice(0, Number(r.prefix_length)) : clean;
    if (r.exclude_start && r.exclude_end && key >= String(r.exclude_start) && key <= String(r.exclude_end)) continue;
    if (key >= String(r.range_start) && key <= String(r.range_end)) {
      const span = (Number(r.range_end) || 0) - (Number(r.range_start) || 0);
      if (span < bestSpan) { bestSpan = span; best = r.group_name || ""; }
    }
  }
  return best;
}

// ── {BU_LIST}: 1 แถวต่อ 1 BU = ชื่อบริษัทไทย, Tax ID ของ BU, ช่วงเดือนที่ตัดชำระ (Min-Max payment_date) ──
function buildBuList(rows, rowInfo) {
  const m = new Map();
  rows.forEach((r) => {
    const k = String(r.bu || "-").trim();
    if (!m.has(k)) m.set(k, { bu: k, name: "", taxId: "", min: null, max: null });
    const e = m.get(k); const info = rowInfo(r);
    if (!e.name) e.name = info.name;
    if (!e.taxId) e.taxId = info.taxId;
    const d = toDate(r.payment_date);
    if (d) { if (!e.min || d < e.min) e.min = d; if (!e.max || d > e.max) e.max = d; }
  });
  return [...m.values()].sort((a, b) => a.bu.localeCompare(b.bu)).map((e) => ({ ...e, name: e.name || e.bu, range: e.min ? `${fmtMY(e.min)} - ${fmtMY(e.max)}` : "-" }));
}
const buListText = (list) => ["BU NAME | TAX ID | RANGE PAYMENT", ...list.map((e) => `${e.name} | ${e.taxId || "-"} | ${e.range}`)].join("\n");
const buListHtmlOf = (list) => {
  const td = "style=\"border:1px solid #bbb;padding:4px 10px\"";
  const th = "style=\"border:1px solid #bbb;padding:4px 10px;background:#e3edf7;text-align:left\"";
  return `<table style="border-collapse:collapse;font-size:11pt;margin:6px 0"><tr><th ${th}>BU NAME</th><th ${th}>TAX ID</th><th ${th}>RANGE PAYMENT</th></tr>${list.map((e) => `<tr><td ${td}>${escHtml(e.name)}</td><td ${td}>${escHtml(e.taxId || "-")}</td><td ${td}>${escHtml(e.range)}</td></tr>`).join("")}</table>`;
};

// MARKER_VATMAILEXPORT_SUPPLIER_RAWCOLS_V1 -- คอลัมน์ Raw ที่ส่งให้ Supplier (เลขคอลัมน์ 1-based ในไฟล์ Incomplete): 5 7 8 9 11 12 13 14 15 16 17 18 = Branch, ใบแจ้งหนี้, Supplier Code, ชื่อผู้ค้า, ชำระเงิน, เช็ค, เลขที่เช็ค, Receive Doc., มูลค่าสินค้า, เงินภาษี, BU, Aging
const SUPPLIER_RAW_COLS = [5, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18].map((n) => n - 1);

// MARKER_VATMAILEXPORT_CONFIG_CC_V1 -- ปุ่ม Config CC (หน้า BU): เก็บอีเมล CC ต่อ (BU + User) -> Placeholder {Config_CC} ในหน้า Config Mail
pool.query(`CREATE TABLE IF NOT EXISTS vat_mail_cc_config (
  bu text NOT NULL, username text NOT NULL, cc_emails text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bu, username))`).catch((e) => console.error("[migrate vat_mail_cc_config]:", e.message));
const MAIL_RE = /^[^\s@;,<>]+@[^\s@;,<>]+\.[^\s@;,<>]+$/;
const DEFAULT_CC = String(process.env.FAST_VAT_DEFAULT_CC || "fastapnvatcontroller@central.co.th").trim(); // MARKER_VATMAILEXPORT_DEFAULT_CC_V1 -- ทุกเมลต้องมี CC นี้เป็นค่าเริ่มต้น
const withDefCc = (t) => dedupeMails(`${DEFAULT_CC};${t || ""}`).join("; "); // Defaults มาก่อนเสมอ แล้วตามด้วย CC อื่น
function dedupeMails(t) { const seen = new Set(); const out = []; String(t || "").split(/[;,\n]+/).map((x) => x.trim()).filter(Boolean).forEach((m) => { const k = m.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(m); } }); return out; }

async function generateMails(cfg, ctx, username, preview) {
  const zone = !!(ctx && ctx.zone_bu);
  const inhouseSet = new Set(((ctx && ctx.inhouse_codes) || []).map((c) => String(c).trim())); // MARKER_VATMAILEXPORT_INHOUSE_TOGGLE_V1 -- Supplier ที่เปิด Inhouse: To = อีเมลเจ้าของงาน (BU Contact) / เรียน = ชื่อเจ้าของงาน
  // MARKER_VATMAILEXPORT_CONFIG_CC_V1 -- {Config_CC} = อีเมล CC ที่ผู้กดสร้างเมล (username) บันทึกไว้ต่อ BU (ปุ่ม Config CC) | ยังไม่เคยตั้ง = ค่าว่าง ไม่กระทบการสร้างเมล
  const ccCfgByBu = {};
  try { const { rows: ccr } = await pool.query(`SELECT bu, cc_emails FROM vat_mail_cc_config WHERE username = $1`, [username]); ccr.forEach((r) => { ccCfgByBu[String(r.bu || "").trim()] = String(r.cc_emails || ""); }); } catch (e) { console.error("vat_mail_cc_config load:", e.message); }
  const configCcOf = (buList) => dedupeMails([...new Set([...(buList || []).map((b) => String(b || "").trim()), "*"])].map((b) => ccCfgByBu[b] || "").join(";")).join("; "); // bu = "*" = CC ที่ User ตั้งให้ใช้กับทุก BU (MARKER_VATMAILEXPORT_CONFIG_CC_ALL_BU_V1)
  const scope = await resolveScope(cfg, ctx);
  const { rows, rules, bus } = await fetchRows(cfg, scope, ctx);
  if (rows.length === 0) return { mails: [], suppliers: [], skipped: [], note: "ไม่มีรายการตามเงื่อนไขของ Config นี้" };

  const period = rows.reduce((m, r) => (String(r.period || "") > m ? String(r.period) : m), "") || null;
  const rel = await loadRelatedRules(bus);
  rows.forEach((r) => {
    r._taxGroup = taxGroupOf(r.branch);
    const rl = rel.byBu[r.bu] && rel.byBu[r.bu].length ? rel.byBu[r.bu] : rel.all;
    r._person = matchRelatedPerson(r, rl);
  });
  const lk = await loadLookups(rows);
  // MARKER_VATMAILEXPORT_BU_BY_BRANCHLIST_V1 -- _buDisp = BU ที่แสดงใน Raw/Pivot: branch_list."BU" (Branch Code) -> Group Range -> BU เดิมของแถว (r.bu ยังใช้หาอีเมล/Related Person ตามเดิม)
  const buRanges = await loadBuGroupRanges();
  rows.forEach((r) => { r._buDisp = lk.rowInfo(r).brandBu || matchBuGroup(r.branch, buRanges) || r.bu; });

  const todayStr = new Date().toLocaleDateString("en-GB");
  const baseVars = { BU: scope.label, DATE: todayStr, "ชื่อผู้รับ": rules.recipient_name || "" };
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const mails = [];
  const skipped = [];

  const makeVars = (subset, extra = {}) => {
    const lines = buildAgingLines(subset, zone ? [] : rules.aging, period);
    const withData = lines.filter((l) => l.total !== 0);
    const buList = buildBuList(subset, lk.rowInfo);
    // MARKER_VATMAILEXPORT_INVOICE_LIST_V1 -- {INVOICE_LIST}: ตารางใบแจ้งหนี้ (สูงสุด 30 รายการ เรียง Aging มาก -> น้อย)
    const invSorted = [...subset].sort((a, b) => Number(b.aging_months) - Number(a.aging_months));
    const invShow = invSorted.slice(0, 30); const invMore = invSorted.length - invShow.length;
    const fmtD = (d) => { if (!d) return ""; const t = new Date(d); return isNaN(t) ? String(d) : t.toLocaleDateString("en-GB"); };
    const invText = invShow.map((r) => `${r.bu || ""} | ${r.invoice_ref || ""} | ${r.check_no || ""} | ${fmtD(r.payment_date)} | ${fmtMoney(num(r.exp_amount))} | ${fmtMoney(num(r.exp_vat))}`).join("\n") + (invMore > 0 ? `\n... และอีก ${invMore} รายการ (ดูในไฟล์แนบ)` : "");
    const tdS = "border:1px solid #bbb;padding:3px 8px";
    const invoiceHtml = invShow.length
      ? `<table style="border-collapse:collapse;font-size:10pt"><tr>${["BU", "Invoice", "Check No", "วันที่ชำระ", "มูลค่าก่อน VAT", "VAT"].map((h) => `<th style="${tdS};background:#f0f0f0">${h}</th>`).join("")}</tr>${invShow.map((r) => `<tr><td style="${tdS}">${escHtml(r.bu)}</td><td style="${tdS}">${escHtml(r.invoice_ref)}</td><td style="${tdS}">${escHtml(r.check_no)}</td><td style="${tdS}">${escHtml(fmtD(r.payment_date))}</td><td style="${tdS};text-align:right">${escHtml(fmtMoney(num(r.exp_amount)))}</td><td style="${tdS};text-align:right">${escHtml(fmtMoney(num(r.exp_vat)))}</td></tr>`).join("")}</table>${invMore > 0 ? `<div style="font-size:10pt;color:#666">... และอีก ${invMore} รายการ (ดูในไฟล์แนบ)</div>` : ""}`
      : "";
    const vars = {
      ...baseVars, ...extra,
      INVOICE_LIST: invText,
      AGING_LIST: lines.map((l) => l.text).join("\n"),
      BU_LIST: buListText(buList),
      "เดือนเริ่ม": lines.length ? lines[0].month : "",
      "เดือนสุดท้าย": lines.length ? lines[lines.length - 1].month : "",
      TOTAL: fmtMoney(subset.reduce((s, r) => s + num(r.exp_vat), 0)),
      _hasData: withData.length,
    };
    vars.BU_Code = vars.BU; vars.Sup_Greeting = vars["ชื่อผู้รับ"]; // MARKER_VATMAILEXPORT_PLACEHOLDER_OWNER_V1 -- ชื่อใหม่ (ชื่อเดิม {BU} {ชื่อผู้รับ} ยังใช้ได้)
    if (cfg.send_type === "SUPPLIER") { // MARKER_VATMAILEXPORT_SUPPLIER_MONTH_RANGE_V1 -- เมล Supplier: เดือนเริ่ม/สุดท้าย = Min/Max วันที่ชำระ รูปแบบ MM/YYYY
      const mins = buList.map((e) => e.min).filter(Boolean); const maxs = buList.map((e) => e.max).filter(Boolean);
      if (mins.length) { vars["เดือนเริ่ม"] = fmtMY(new Date(Math.min(...mins))); vars["เดือนสุดท้าย"] = fmtMY(new Date(Math.max(...maxs))); }
    }
    return { lines, vars, buList, invoiceHtml };
  };

  if (cfg.send_type === "SUPPLIER") {
    const groups = new Map();
    rows.forEach((r) => { const k = r.supplier_code || "-"; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
    const codes = [...groups.keys()];

    const emailBySup = {};
    try {
      const { rows: sl } = await pool.query(`SELECT * FROM supplier_list WHERE "Code" = ANY($1)`, [codes]);
      sl.forEach((s) => { if (s.Email && !emailBySup[s.Code]) emailBySup[s.Code] = s.Email; });
    } catch (e) { console.error("supplier_list:", e.message); }
    // MARKER_VATMAILEXPORT_VENDOR_CATEGORY_EMAIL_V1 -- Email By Vendor + BU จาก vendor_category."EMAIL" (หลายที่อยู่คั่นด้วย ;) ใช้เป็น To เสมอ
    const emailByCodeBu = {}; const emailByCode = {};
    try {
      const { rows: vc } = await pool.query(`SELECT "Code", "BU", "EMAIL" FROM vendor_category WHERE "Code" = ANY($1) AND COALESCE(TRIM("EMAIL"), '') <> ''`, [codes]);
      vc.forEach((v) => { const k = `${String(v.Code).trim()}|${String(v.BU || "").trim()}`; if (!emailByCodeBu[k]) emailByCodeBu[k] = v.EMAIL; if (!emailByCode[v.Code]) emailByCode[v.Code] = v.EMAIL; });
    } catch (e) { console.error("vendor_category EMAIL:", e.message); }
    // MARKER_VATMAILEXPORT_VENDOR_GREETING_V1 -- Greeting Name ต่อผู้ค้า+BU จาก vendor_category."GREETING_NAME" ใช้เป็น {ชื่อผู้รับ} (ว่าง = ใช้ของ Config)
    const greetByCodeBu = {}; const greetByCode = {};
    try {
      const { rows: gv } = await pool.query(`SELECT "Code", "BU", "GREETING_NAME" FROM vendor_category WHERE "Code" = ANY($1) AND COALESCE(TRIM("GREETING_NAME"), '') <> ''`, [codes]);
      gv.forEach((v) => { const g = String(v.GREETING_NAME || "").trim(); const k = `${String(v.Code).trim()}|${String(v.BU || "").trim()}`; if (!greetByCodeBu[k]) greetByCodeBu[k] = g; if (!greetByCode[v.Code]) greetByCode[v.Code] = g; });
    } catch (e) { console.error("vendor_category GREETING_NAME:", e.message); } // ยังไม่ได้เพิ่มคอลัมน์ = ข้าม ใช้ชื่อผู้รับของ Config
    const resolveGreeting = (code, sub) => {
      for (const b of new Set(sub.map((r) => String(r.bu || "").trim()))) { const g = greetByCodeBu[`${String(code).trim()}|${b}`]; if (g) return g; }
      return greetByCode[code] || "";
    };
    const splitMails = (t) => String(t || "").split(/[;,\n]+/).map((x) => x.trim()).filter(Boolean);
    // MARKER_VATMAILEXPORT_BU_CC_V1 + MARKER_VATMAILEXPORT_PLACEHOLDER_OWNER_V1 -- ข้อมูลผู้ค้า (ที่อยู่/เบอร์ = ร่วมทุก BU) + BU Contact เจ้าของงาน (แยกตามผู้ค้า+BU) จาก vendor_category
    const vcByCodeBu = {}; const vcByCode = {};
    try {
      const { rows: vx } = await pool.query(`SELECT "Code", "BU", "ADDRESS", "PHONE", "BU_CONTACT_NAME", "BU_CONTACT_EMAIL", "BU_CONTACT_PHONE" FROM vendor_category WHERE "Code" = ANY($1)`, [codes]);
      vx.forEach((v) => { const c = String(v.Code).trim(); const k = `${c}|${String(v.BU || "").trim()}`; if (!vcByCodeBu[k]) vcByCodeBu[k] = v; (vcByCode[c] = vcByCode[c] || []).push(v); });
    } catch (e) { console.error("vendor_category address/phone/bu_contact:", e.message); } // ยังไม่ได้เพิ่มคอลัมน์ = ข้าม (ค่าว่าง ไม่เพิ่ม CC)
    const buSet = (sub) => [...new Set(sub.map((r) => String(r.bu || "").trim()))];
    const buContactOf = (code, sub, f) => [...new Set(buSet(sub).map((b) => String((vcByCodeBu[`${String(code).trim()}|${b}`] || {})[f] || "").trim()).filter(Boolean))];
    const supInfoOf = (code, sub, f) => { // ที่อยู่/เบอร์: ใช้ของ BU ในรายการก่อน ไม่มีค่อยใช้แถวอื่นของผู้ค้าเดียวกัน (ร่วมทุก BU)
      for (const b of buSet(sub)) { const v = String((vcByCodeBu[`${String(code).trim()}|${b}`] || {})[f] || "").trim(); if (v) return v; }
      return (vcByCode[String(code).trim()] || []).map((v) => String(v[f] || "").trim()).find(Boolean) || "";
    };
    const supPhoneOf = (code, sub) => supInfoOf(code, sub, "PHONE") || sub.map((r) => String(r.phone || "").trim()).find(Boolean) || ""; // ไม่มีใน Vendor Category = ใช้เบอร์จากรายงาน (vat_watchlist_report.phone)
    const resolveBuCc = (code, sub) => { // อีเมลเจ้าของงาน (อาจหลายอัน คั่น ; ) -> รายการไม่ซ้ำ
      const out = []; const seen = new Set();
      buContactOf(code, sub, "BU_CONTACT_EMAIL").forEach((e) => splitMails(e).forEach((mm) => { const k = mm.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(mm); } }));
      return out;
    };
    const resolveTo = (code, sub) => {
      const seen = new Set(); const out = [];
      const add = (t) => splitMails(t).forEach((m) => { const lk2 = m.toLowerCase(); if (!seen.has(lk2)) { seen.add(lk2); out.push(m); } });
      [...new Set(sub.map((r) => String(r.bu || "").trim()))].forEach((b) => add(emailByCodeBu[`${String(code).trim()}|${b}`]));
      if (!out.length) add(emailByCode[code]);   // ไม่มี Email ของ BU นี้ -> ใช้ Email กลางของผู้ขาย (BU อื่น)
      if (!out.length) add(emailBySup[code]);    // สุดท้ายค่อยใช้ supplier_list เดิม
      return out.join("; ");
    };
    // MARKER_VATMAILEXPORT_ZONE_CC_V1 -- สั่งจาก Incomplete Zone: CC อัตโนมัติ = FAST_VAT_CC (.env) ถ้าไม่ตั้งค่าใช้ CC ของ Config
    // MARKER_VATMAILEXPORT_BU_CC_V1 -- ccFor(extra): CC ของ Config (หรือ FAST_VAT_CC) + อีเมลเจ้าของงาน (BU Contact) ของ BU ที่อยู่ในรายการของ Supplier นี้ (ไม่ซ้ำกัน)
    // MARKER_VATMAILEXPORT_TOCC_PLACEHOLDER_V1 -- To/CC พิมพ์ {Sup_Email} / {BU_Contact_Email} ได้ -> แทนด้วยข้อมูลระดับ Vendor Detail ของผู้ค้ารายนั้น
    let curCtx = null;
    const phAddr = (t) => String(t || "").replace(/\{(Sup_Email|BU_Contact_Email|Config_CC)\}/g, (_, k) => (!curCtx ? "" : (k === "Sup_Email" ? resolveTo(curCtx[0], curCtx[1]) : k === "Config_CC" ? configCcOf(Object.keys(ccCfgByBu)) : /* MARKER_VATMAILEXPORT_CONFIG_CC_SUPPLIER_ALL_BU_V1 -- By Supplier ไม่สนใจ BU: ใช้ CC ที่ User ตั้งไว้ทุก BU */ resolveBuCc(curCtx[0], curCtx[1]).join("; ")))); // MARKER_VATMAILEXPORT_CONFIG_CC_V1
    const ccFor = (extra) => {
      const base = phAddr(zone ? (String(process.env.FAST_VAT_CC || "").trim() || cfg.mail_cc || "") : (cfg.mail_cc || ""));
      const add = splitMails(Array.isArray(extra) ? extra.join(";") : extra);
      if (!add.length) return base;
      const seen = new Set(); const out = [];
      [...splitMails(base), ...add].forEach((m) => { const k = m.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(m); } });
      return out.join("; ");
    };

    const suppliers = [];
    for (const code of codes) {
      const sub = groups.get(code);
      const name = sub[0].vendor_name || code;
      curCtx = [code, sub];
      const buCc = resolveBuCc(code, sub); // MARKER_VATMAILEXPORT_BU_CC_V1 (+ MARKER_VATMAILEXPORT_SUP_EMAIL_V1: {Sup_Email} = อีเมลผู้ค้าจาก Vendor Category -> supplier_list ผ่าน resolveTo)
      const ih = inhouseSet.has(String(code).trim()) && buCc.length > 0; // เปิดได้เฉพาะ Vendor ที่มีอีเมลเจ้าของงาน // MARKER_VATMAILEXPORT_INHOUSE_TOGGLE_V1
      const to = ih ? buCc.join("; ") : (rules.to_source === "MANUAL" && String(cfg.mail_to || "").trim()) ? splitMails(phAddr(cfg.mail_to)).join("; ") : (rules.to_source === "BU_CONTACT" ? buCc.join("; ") : resolveTo(code, sub)); /* MARKER_VATMAILEXPORT_TO_SOURCE_BU_CONTACT_V1 */ // MARKER_VATMAILEXPORT_INVOICE_LIST_V1 -- to_source
      const extraCols = { head: ["ชื่อ BU", "Tax ID (BU)", "Branch (BU)"], values: (r) => { const i = lk.rowInfo(r); return [i.name, i.taxId, i.branch]; } };
      const { buffer } = await buildBuWorkbook({ rows: sub, period, buLabel: `${name} (${code})`, generatedBy: username, extraCols, rawCols: SUPPLIER_RAW_COLS, rawOnly: true }); // MARKER_VATMAILEXPORT_SUPPLIER_RAWONLY_V1 -- ไฟล์แนบถึง Supplier: เฉพาะชีท ICP_Report_BU
      // MARKER_VATMAILEXPORT_RECIPIENT_NAME_PH_V1 -- ช่องชื่อผู้รับ/ชื่อสำรอง พิมพ์ Placeholder ได้ ({Sup_Greeting} {Sup_Name} {BU_Contact_Name}) เหมือน To/CC
      const phName = (t) => String(t || "").replace(/\{(Sup_Greeting|Sup_Name|BU_Contact_Name)\}/g, (_, k) => (k === "Sup_Greeting" ? resolveGreeting(code, sub) : k === "Sup_Name" ? name : buContactOf(code, sub, "BU_CONTACT_NAME").join("; ")));
      const recName = phName(rules.recipient_name).trim();
      let greetName = rules.name_source === "MANUAL" ? recName : (resolveGreeting(code, sub) || recName); // MARKER_VATMAILEXPORT_VENDOR_GREETING_V1
      if (ih) greetName = buContactOf(code, sub, "BU_CONTACT_NAME").join(" / ") || greetName; // MARKER_VATMAILEXPORT_INHOUSE_TOGGLE_V1 -- เรียน = ชื่อเจ้าของงาน (ไม่มี = ใช้ชื่อเดิม)
      const { vars, lines, buList, invoiceHtml } = makeVars(sub, {
        SUPPLIER: name, "Supplier Name": name, // ชื่อเดิม (ยังใช้ได้)
        // MARKER_VATMAILEXPORT_PLACEHOLDER_OWNER_V1 -- ชื่อใหม่ Sup_ = ของ Supplier / BU_Contact_ = ของเจ้าของงานฝั่ง BU
        Sup_Name: name, Sup_Email: resolveTo(code, sub), Sup_Phone: supPhoneOf(code, sub), Sup_Address: supInfoOf(code, sub, "ADDRESS"),
        BU_Contact_Name: buContactOf(code, sub, "BU_CONTACT_NAME").join("; "), BU_Contact_Email: buCc.join("; "), BU_Contact_Phone: buContactOf(code, sub, "BU_CONTACT_PHONE").join("; "),
        "ชื่อผู้รับ": greetName,
      });
      if (preview) {
        suppliers.push({
          supplier_code: code, supplier_name: name, to, to_missing: !to, cc: withDefCc(ccFor(ih ? [] : buCc)), cc_missing: !ccFor(), bu_cc: buCc.join("; "), inhouse: ih, inhouse_available: buCc.length > 0, inhouse_to: buCc.join("; "),
          count: sub.length, total_vat: sub.reduce((s, r) => s + num(r.exp_vat), 0),
          bus: [...new Set(sub.map((r) => r.bu))],
          subject: applyVars(cfg.subject_template, vars), bodyHtml: buildBodyHtml(cfg.body_template, vars, lines, buListHtmlOf(buList), invoiceHtml), file_name: `${safe(code)}_Outstanding_${stamp}.xlsx`, sheets: await readSheets(buffer), // MARKER_VATMAILEXPORT_PREVIEW_EMAIL_VIEW_V1
          invoices: [...sub].sort((a, b) => Number(b.aging_months) - Number(a.aging_months)).map((r) => ({ bu: r.bu, invoice_ref: r.invoice_ref, check_no: r.check_no, payment_date: r.payment_date, exp_vat: num(r.exp_vat), aging_months: r.aging_months })),
        });
        continue;
      }
      if (zone && !to) { skipped.push({ supplier_code: code, supplier_name: name, reason: "ไม่มีอีเมล" }); continue; } // Draft ได้เฉพาะ Supplier ที่มีอีเมล
      const fileName = `${safe(code)}_Outstanding_${stamp}.xlsx`;
      const fileId = await storeFile("vat-mail", sub[0].bu || bus[0], `mail${cfg.id}_${code}_${stamp}`, fileName, buffer, username);
      mails.push({
        supplier_code: code, supplier_name: name,
        to, to_missing: !to,
        cc: withDefCc(ccFor(ih ? [] : buCc)), bu_cc: buCc.join("; "),
        subject: applyVars(cfg.subject_template, vars), bodyText: applyVars(cfg.body_template, vars),
        bodyHtml: buildBodyHtml(cfg.body_template, vars, lines, buListHtmlOf(buList), invoiceHtml),
        file_id: fileId, file_name: fileName, count: sub.length, total_vat: sub.reduce((s, r) => s + num(r.exp_vat), 0),
        type_a_rows: sub.filter((r) => r.status === "type_a").map((r) => ({ bu: r.bu, invoice_ref: r.invoice_ref, supplier_code: r.supplier_code, check_no: r.check_no || "" })), // MARKER_VATMAILEXPORT_TYPE_A_NOTE_ON_SENT_V1 -- ให้ Frontend เขียน Note ว่าส่งเมลแล้ว
      });
    }
    if (preview) return { preview: true, suppliers, scope_label: scope.label, period };
  } else {
    if (preview) return { preview: true, suppliers: [], scope_label: scope.label, period };
    const { buffer } = await buildBuWorkbook({ rows, period, buLabel: scope.label, generatedBy: username });
    // MARKER_VATMAILEXPORT_BU_FILENAME_V1 -- ชื่อไฟล์แนบเมล To BU ตามที่ใช้จริง: Pivot_BU_Incomplete_for_Report_{BU}.xlsx (ALL = ALL, หลาย BU = ต่อด้วย _)
    const fileName = `Pivot_BU_Incomplete_for_Report_${safe(scope.label === "ALL BU" ? "ALL" : bus.join("_"))}.xlsx`;
    const fileId = await storeFile("vat-mail", bus[0], `mail${cfg.id}_${stamp}`, fileName, buffer, username);
    const { vars, lines, buList, invoiceHtml } = makeVars(rows);
    // MARKER_VATMAILEXPORT_TO_SOURCE_BU_CONTACT_V1 -- To BU: เลือก {BU_Contact_Email} = อีเมลเจ้าของงานของ BU ในรายการ (จาก vendor_category, ไม่ซ้ำ)
    let toBu = cfg.mail_to || ""; let ccBu = cfg.mail_cc || "";
    // To BU: {BU_Contact_Email} = อีเมลเจ้าของงานของ BU ในรายการ / {Sup_Email} = อีเมลผู้ค้าทุกรายในรายการ (จาก vendor_category, ไม่ซ้ำ)
    const tokTxt = String(cfg.mail_to || "") + String(cfg.mail_cc || "");
    const wantBuC = rules.to_source === "BU_CONTACT" || /\{BU_Contact_Email\}/.test(tokTxt); const wantSup = /\{Sup_Email\}/.test(tokTxt);
    const wantCfgCc = /\{Config_CC\}/.test(tokTxt); // MARKER_VATMAILEXPORT_CONFIG_CC_V1
    if (wantCfgCc && !(wantBuC || wantSup)) { const cc0 = configCcOf(bus); toBu = String(cfg.mail_to || "").replace(/\{Config_CC\}/g, cc0); ccBu = String(cfg.mail_cc || "").replace(/\{Config_CC\}/g, cc0); }
    if (wantBuC || wantSup) {
      const emBu = []; const emSup = []; const seenB = new Set(); const seenS = new Set();
      const addTo = (arr, seen, t) => String(t || "").split(/[;,\n]+/).map((x) => x.trim()).filter(Boolean).forEach((m) => { const k = m.toLowerCase(); if (!seen.has(k)) { seen.add(k); arr.push(m); } });
      try {
        const pairs = new Set(rows.map((r) => `${String(r.supplier_code || "").trim()}|${String(r.bu || "").trim()}`));
        const { rows: vx } = await pool.query(`SELECT "Code", "BU", "EMAIL", "BU_CONTACT_EMAIL" FROM vendor_category WHERE "Code" = ANY($1)`, [[...new Set(rows.map((r) => String(r.supplier_code || "").trim()))]]);
        vx.forEach((v) => { if (!pairs.has(`${String(v.Code).trim()}|${String(v.BU || "").trim()}`)) return; addTo(emBu, seenB, v.BU_CONTACT_EMAIL); addTo(emSup, seenS, v.EMAIL); });
      } catch (e) { console.error("BU mail To/CC placeholders:", e.message); }
      const sub2 = (t) => String(t || "").replace(/\{BU_Contact_Email\}/g, emBu.join("; ")).replace(/\{Sup_Email\}/g, emSup.join("; "));
      const ccCfgTxt = configCcOf(bus); // MARKER_VATMAILEXPORT_CONFIG_CC_V1
      toBu = rules.to_source === "BU_CONTACT" ? emBu.join("; ") : sub2(cfg.mail_to).replace(/\{Config_CC\}/g, ccCfgTxt);
      ccBu = sub2(cfg.mail_cc).replace(/\{Config_CC\}/g, ccCfgTxt);
    }
    mails.push({
      to: toBu, cc: withDefCc(ccBu),
      subject: applyVars(cfg.subject_template, vars), bodyText: applyVars(cfg.body_template, vars),
      bodyHtml: buildBodyHtml(cfg.body_template, vars, lines, buListHtmlOf(buList), invoiceHtml),
      file_id: fileId, file_name: fileName, count: rows.length, total_vat: rows.reduce((s, r) => s + num(r.exp_vat), 0),
      aging_lines: lines,
      type_a_rows: rows.filter((r) => r.status === "type_a").map((r) => ({ bu: r.bu, invoice_ref: r.invoice_ref, supplier_code: r.supplier_code, check_no: r.check_no || "" })), // MARKER_VATMAILEXPORT_TYPE_A_NOTE_ON_SENT_V1
    });
  }
  return { mails, skipped, period };
}

const handle = (preview) => async (req, res) => {
  try {
    const username = await getUsernameByEmail(req.user.email);
    const { config_id, zone_bu, supplier_codes, rows: selRows, inhouse_codes } = req.body || {};
    const { rows: cr } = await pool.query(`SELECT * FROM vat_mail_config WHERE id = $1`, [config_id]);
    const cfg = cr[0];
    if (!cfg) return res.status(404).json({ error: "ไม่พบ Config" });
    // MARKER_VATMAILEXPORT_USE_DRAFT_TEMPLATE_V1 -- Config ที่ผูก Draft (draft_id) ต้องใช้ Subject/Body จาก Draft ล่าสุดเสมอ (หน้า Config บันทึก Draft แล้วบอก "มีผลกับทุก Config ที่ใช้ Draft นี้" แต่เดิม Backend อ่านสำเนาเก่าที่ฝังใน vat_mail_config ทำให้แก้แล้วไม่ Update)
    if (cfg.draft_id) {
      try {
        const { rows: dr } = await pool.query(`SELECT subject_template, body_template FROM vat_mail_draft WHERE id = $1`, [cfg.draft_id]);
        if (dr[0]) { cfg.subject_template = dr[0].subject_template; cfg.body_template = dr[0].body_template; }
      } catch (e) { console.warn("vat_mail_draft lookup skipped:", e.message); }
    }
    const out = await generateMails(cfg, { zone_bu, supplier_codes, rows: selRows, inhouse_codes: Array.isArray(inhouse_codes) ? inhouse_codes : [] }, username, preview);
    res.json(out);
  } catch (err) {
    console.error(`POST /vat-mail-export/${preview ? "preview" : "build"} error:`, err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
};
router.post("/build", handle(false));
router.post("/preview", handle(true));

// ── POST /api/vat-mail-export/files/delete { ids: [file_id,...] } -- ลบไฟล์แนบชั่วคราว (module 'vat-mail' ของตัวเองเท่านั้น) หลังผู้ใช้ยืนยันว่าส่งเมลแล้ว/ยกเลิก
router.post("/files/delete", async (req, res) => {
  try {
    const username = await getUsernameByEmail(req.user.email);
    // MARKER_VATMAILEXPORT_DELETE_ID_AS_TEXT_V1 -- file_storage.id เป็น uuid -> เทียบเป็น text (เดิมแปลงเป็น Number ทำให้ลบไม่ได้เลย)
    const ids = (Array.isArray(req.body && req.body.ids) ? req.body.ids : []).map((x) => String(x || "").trim()).filter((x) => /^[0-9a-fA-F-]{8,40}$/.test(x));
    if (ids.length === 0) return res.json({ deleted: 0 });
    const { rows } = await pool.query(`SELECT id, file_path FROM file_storage WHERE id::text = ANY($1::text[]) AND module = 'vat-mail' AND owner_username = $2`, [ids, username]);
    for (const r of rows) { try { if (r.file_path && fs.existsSync(r.file_path)) fs.unlinkSync(r.file_path); } catch (e) { console.error("unlink vat-mail file:", e.message); } }
    if (rows.length) await pool.query(`DELETE FROM file_storage WHERE id::text = ANY($1::text[])`, [rows.map((r) => String(r.id))]);
    res.json({ deleted: rows.length });
  } catch (err) {
    console.error("POST /vat-mail-export/files/delete error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// ── Config CC (ต่อ BU + User) ──
// GET  /api/vat-mail-export/cc-config?bu=REV[&scope=all]  -> { mine: {bu, cc_emails, updated_at}|null, others: [{bu, username, cc_emails, updated_at}] }
// PUT  /api/vat-mail-export/cc-config  { bu, cc_emails }   -> บันทึกของตัวเอง (ว่าง = ลบ)
// DELETE /api/vat-mail-export/cc-config?bu=REV             -> ลบของตัวเอง
router.get("/cc-config", async (req, res) => {
  try {
    const username = await getUsernameByEmail(req.user.email);
    const bu = String((req.query && req.query.bu) || "").trim();
    const all = String((req.query && req.query.scope) || "") === "all";
    const mine = bu ? (await pool.query(`SELECT bu, cc_emails, updated_at FROM vat_mail_cc_config WHERE bu = $1 AND username = $2`, [bu, username])).rows[0] || null : null;
    const mine_all = (await pool.query(`SELECT bu, cc_emails, updated_at FROM vat_mail_cc_config WHERE bu = '*' AND username = $1`, [username])).rows[0] || null; // MARKER_VATMAILEXPORT_CONFIG_CC_ALL_BU_V1
    const others = (await pool.query(
      `SELECT bu, username, cc_emails, updated_at FROM vat_mail_cc_config WHERE username <> $1 AND ($2::boolean OR bu = $3 OR bu = '*') AND COALESCE(TRIM(cc_emails), '') <> '' ORDER BY updated_at DESC LIMIT 200`,
      [username, all || !bu, bu])).rows;
    res.json({ mine, mine_all, others, default_cc: DEFAULT_CC });
  } catch (err) { console.error("GET /vat-mail-export/cc-config error:", err); res.status(500).json({ error: err.message || "Internal server error" }); }
});
router.put("/cc-config", async (req, res) => {
  try {
    const username = await getUsernameByEmail(req.user.email);
    const bu = String((req.body && req.body.bu) || "").trim();
    if (!bu || bu.length > 60) return res.status(400).json({ error: "ไม่ระบุ BU" });
    const list = dedupeMails(req.body && req.body.cc_emails);
    const bad = list.filter((m) => !MAIL_RE.test(m));
    if (bad.length) return res.status(400).json({ error: "รูปแบบอีเมลไม่ถูกต้อง: " + bad.join(", ") });
    const extra = list.filter((m) => m.toLowerCase() !== DEFAULT_CC.toLowerCase());
    if (extra.length === 0) { await pool.query(`DELETE FROM vat_mail_cc_config WHERE bu = $1 AND username = $2`, [bu, username]); return res.json({ ok: true, cc_emails: "" }); }
    const text = dedupeMails([DEFAULT_CC, ...list].join(";")).join("; "); // MARKER_VATMAILEXPORT_DEFAULT_CC_V1 -- ลง DB: Defaults นำหน้าเสมอ ตามด้วย CC ของ User
    await pool.query(`INSERT INTO vat_mail_cc_config (bu, username, cc_emails) VALUES ($1,$2,$3) ON CONFLICT (bu, username) DO UPDATE SET cc_emails = EXCLUDED.cc_emails, updated_at = now()`, [bu, username, text]);
    res.json({ ok: true, cc_emails: text });
  } catch (err) { console.error("PUT /vat-mail-export/cc-config error:", err); res.status(500).json({ error: err.message || "Internal server error" }); }
});
router.delete("/cc-config", async (req, res) => {
  try {
    const username = await getUsernameByEmail(req.user.email);
    const bu = String((req.query && req.query.bu) || "").trim();
    if (!bu) return res.status(400).json({ error: "ไม่ระบุ BU" });
    await pool.query(`DELETE FROM vat_mail_cc_config WHERE bu = $1 AND username = $2`, [bu, username]);
    res.json({ ok: true });
  } catch (err) { console.error("DELETE /vat-mail-export/cc-config error:", err); res.status(500).json({ error: err.message || "Internal server error" }); }
});

export default router;
