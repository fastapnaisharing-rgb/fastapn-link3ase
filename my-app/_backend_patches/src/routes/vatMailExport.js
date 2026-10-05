// vatMailExport.js -- MARKER_VATMAILEXPORT_ROUTER_V1
// POST /api/vat-mail-export/build    { config_id [, zone_bu, supplier_codes, rows] } -> สร้าง Excel + เนื้อหาเมล (ยังไม่ส่งเมลจริง)
// POST /api/vat-mail-export/preview  (พารามิเตอร์เดียวกัน) -> รายการ Supplier + Invoice/Aging + To/CC สำหรับหน้าต่าง Confirm (ไม่สร้างไฟล์)
// MARKER_VATMAILEXPORT_ALL_BOTH_ZONE_V1 -- Config.bu รองรับ ALL / BOTH / รายชื่อ BU คั่น , | zone_bu = สั่งจาก Incomplete Zone (Both -> เฉพาะ BU นั้น)
import { Router } from "express";
import { pool, getUsernameByEmail } from "../db.js";
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
function buildBodyHtml(template, vars, lines, buListHtml) {
  const agingHtml = lines.map((l) => `<span style="color:${l.aging >= 5 ? RED : GREEN}">${escHtml(l.text)}</span>`).join("<br>");
  const renderSeg = (tpl) => String(tpl || "").split("{AGING_LIST}").map((seg) => escHtml(applyVars(seg, vars)).replace(/\r?\n/g, "<br>")).join(agingHtml);
  const html = String(template || "").split("{BU_LIST}").map(renderSeg).join(buListHtml || "");
  return `<div style="font-family:Tahoma,'Segoe UI',sans-serif;font-size:11pt">${html}</div>`;
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
    const { rows } = await pool.query(`SELECT DISTINCT bu FROM vat_watchlist_report WHERE status = 'pending' AND bu IS NOT NULL AND TRIM(bu) <> ''`);
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
    const where = [`status = 'pending'`, `bu = ANY($1)`, `supplier_code::text = ANY(${add(codes)})`];
    const sel = (Array.isArray(ctx.rows) ? ctx.rows : []).filter((x) => x && x.supplier_code && x.invoice_ref);
    if (sel.length) {
      where.push(`(supplier_code::text, invoice_ref::text, COALESCE(check_no::text, '')) IN (SELECT * FROM unnest(${add(sel.map((x) => String(x.supplier_code).trim()))}::text[], ${add(sel.map((x) => String(x.invoice_ref).trim()))}::text[], ${add(sel.map((x) => String(x.check_no || "").trim()))}::text[]))`);
    } else {
      where.push(`aging_months IS NOT NULL`, `aging_months BETWEEN 0 AND 6`);
    }
    const { rows } = await pool.query(`SELECT * FROM vat_watchlist_report WHERE ${where.join(" AND ")}`, params);
    return { rows, rules, bus };
  }

  const params = [bus];
  const where = [`status = 'pending'`, `bu = ANY($1)`, `aging_months IS NOT NULL`, `aging_months BETWEEN 0 AND 6`];
  const add = (v) => { params.push(v); return `$${params.length}`; };

  const aging = (rules.aging || []).map(String).filter((a) => /^[0-6]$/.test(a)).map(Number);
  if (aging.length) where.push(`aging_months = ANY(${add(aging)})`);

  const pay = rules.pay || [];
  if (pay.length) where.push(`(${pay.map((p) => `UPPER(COALESCE(check_no,'')) LIKE ${add("%" + String(p).toUpperCase())}`).join(" OR ")})`);

  const types = rules.types || [];
  if (types.length) where.push(`bus_type = ANY(${add(types)})`);

  const ignore = (rules.ignore || []).map((x) => (typeof x === "string" ? x : x.code)).filter(Boolean);
  if (ignore.length) where.push(`NOT (supplier_code = ANY(${add(ignore)}))`);

  let cond = `(${where.join(" AND ")})`;
  if (cfg.scope_mode === "BY_VENDOR") {
    const vc = (Array.isArray(vendors) ? vendors : []).map((x) => (typeof x === "string" ? x : x.code)).filter(Boolean);
    cond += ` AND supplier_code = ANY(${add(vc)})`;
  }

  // Include = ดึงเพิ่มนอกเงื่อนไข (ยังจำกัด pending + BU + Aging 0-6 + ไม่อยู่ใน Ignore)
  const include = (rules.include || []).map((x) => (typeof x === "string" ? x : x.code)).filter(Boolean);
  let sql;
  if (include.length && cfg.scope_mode !== "BY_VENDOR") {
    const inc = `(status='pending' AND bu = ANY($1) AND aging_months BETWEEN 0 AND 6 AND supplier_code = ANY(${add(include)})${ignore.length ? ` AND NOT (supplier_code = ANY($${params.indexOf(ignore) + 1}))` : ""})`;
    sql = `SELECT * FROM vat_watchlist_report WHERE ${cond} OR ${inc}`;
  } else {
    sql = `SELECT * FROM vat_watchlist_report WHERE ${cond}`;
  }
  const { rows } = await pool.query(sql, params);
  return { rows, rules, bus };
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
    return { name: bi.name || "", taxId: pickCol(br, "BU-TaxID", "BU-Tax ID") || bi.taxId || "", branch: pickCol(br, "BU-Branch") };
  };
  return { buInfoByBu, rowInfo };
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

async function generateMails(cfg, ctx, username, preview) {
  const zone = !!(ctx && ctx.zone_bu);
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

  const todayStr = new Date().toLocaleDateString("en-GB");
  const baseVars = { BU: scope.label, DATE: todayStr, "ชื่อผู้รับ": rules.recipient_name || "" };
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const mails = [];
  const skipped = [];

  const makeVars = (subset, extra = {}) => {
    const lines = buildAgingLines(subset, zone ? [] : rules.aging, period);
    const withData = lines.filter((l) => l.total !== 0);
    const buList = buildBuList(subset, lk.rowInfo);
    const vars = {
      ...baseVars, ...extra,
      AGING_LIST: lines.map((l) => l.text).join("\n"),
      BU_LIST: buListText(buList),
      "เดือนเริ่ม": lines.length ? lines[0].month : "",
      "เดือนสุดท้าย": lines.length ? lines[lines.length - 1].month : "",
      TOTAL: fmtMoney(subset.reduce((s, r) => s + num(r.exp_vat), 0)),
      _hasData: withData.length,
    };
    if (cfg.send_type === "SUPPLIER") { // MARKER_VATMAILEXPORT_SUPPLIER_MONTH_RANGE_V1 -- เมล Supplier: เดือนเริ่ม/สุดท้าย = Min/Max วันที่ชำระ รูปแบบ MM/YYYY
      const mins = buList.map((e) => e.min).filter(Boolean); const maxs = buList.map((e) => e.max).filter(Boolean);
      if (mins.length) { vars["เดือนเริ่ม"] = fmtMY(new Date(Math.min(...mins))); vars["เดือนสุดท้าย"] = fmtMY(new Date(Math.max(...maxs))); }
    }
    return { lines, vars, buList };
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
    const splitMails = (t) => String(t || "").split(/[;,\n]+/).map((x) => x.trim()).filter(Boolean);
    const resolveTo = (code, sub) => {
      const seen = new Set(); const out = [];
      const add = (t) => splitMails(t).forEach((m) => { const lk2 = m.toLowerCase(); if (!seen.has(lk2)) { seen.add(lk2); out.push(m); } });
      [...new Set(sub.map((r) => String(r.bu || "").trim()))].forEach((b) => add(emailByCodeBu[`${String(code).trim()}|${b}`]));
      if (!out.length) add(emailByCode[code]);   // ไม่มี Email ของ BU นี้ -> ใช้ Email กลางของผู้ขาย (BU อื่น)
      if (!out.length) add(emailBySup[code]);    // สุดท้ายค่อยใช้ supplier_list เดิม
      return out.join("; ");
    };
    // MARKER_VATMAILEXPORT_ZONE_CC_V1 -- สั่งจาก Incomplete Zone: CC อัตโนมัติ = FAST_VAT_CC (.env) ถ้าไม่ตั้งค่าใช้ CC ของ Config
    const ccFor = () => (zone ? (String(process.env.FAST_VAT_CC || "").trim() || cfg.mail_cc || "") : (cfg.mail_cc || ""));

    const suppliers = [];
    for (const code of codes) {
      const sub = groups.get(code);
      const name = sub[0].vendor_name || code;
      const to = resolveTo(code, sub);
      if (preview) {
        suppliers.push({
          supplier_code: code, supplier_name: name, to, to_missing: !to, cc: ccFor(), cc_missing: !ccFor(),
          count: sub.length, total_vat: sub.reduce((s, r) => s + num(r.exp_vat), 0),
          bus: [...new Set(sub.map((r) => r.bu))],
          invoices: [...sub].sort((a, b) => Number(b.aging_months) - Number(a.aging_months)).map((r) => ({ bu: r.bu, invoice_ref: r.invoice_ref, check_no: r.check_no, payment_date: r.payment_date, exp_vat: num(r.exp_vat), aging_months: r.aging_months })),
        });
        continue;
      }
      if (zone && !to) { skipped.push({ supplier_code: code, supplier_name: name, reason: "ไม่มีอีเมล" }); continue; } // Draft ได้เฉพาะ Supplier ที่มีอีเมล
      const extraCols = { head: ["ชื่อ BU", "Tax ID (BU)", "Branch (BU)"], values: (r) => { const i = lk.rowInfo(r); return [i.name, i.taxId, i.branch]; } };
      const { buffer } = await buildBuWorkbook({ rows: sub, period, buLabel: `${name} (${code})`, generatedBy: username, extraCols, rawCols: SUPPLIER_RAW_COLS });
      const fileName = `${safe(code)}_Outstanding_${stamp}.xlsx`;
      const fileId = await storeFile("vat-mail", sub[0].bu || bus[0], `mail${cfg.id}_${code}_${stamp}`, fileName, buffer, username);
      const { vars, lines, buList } = makeVars(sub, { SUPPLIER: name, "Supplier Name": name });
      mails.push({
        supplier_code: code, supplier_name: name,
        to, to_missing: !to,
        cc: ccFor(),
        subject: applyVars(cfg.subject_template, vars), bodyText: applyVars(cfg.body_template, vars),
        bodyHtml: buildBodyHtml(cfg.body_template, vars, lines, buListHtmlOf(buList)),
        file_id: fileId, file_name: fileName, count: sub.length, total_vat: sub.reduce((s, r) => s + num(r.exp_vat), 0),
      });
    }
    if (preview) return { preview: true, suppliers, scope_label: scope.label, period };
  } else {
    if (preview) return { preview: true, suppliers: [], scope_label: scope.label, period };
    const { buffer } = await buildBuWorkbook({ rows, period, buLabel: scope.label, generatedBy: username });
    // MARKER_VATMAILEXPORT_BU_FILENAME_V1 -- ชื่อไฟล์แนบเมล To BU ตามที่ใช้จริง: Pivot_BU_Incomplete_for_Report_{BU}.xlsx (ALL = ALL, หลาย BU = ต่อด้วย _)
    const fileName = `Pivot_BU_Incomplete_for_Report_${safe(scope.label === "ALL BU" ? "ALL" : bus.join("_"))}.xlsx`;
    const fileId = await storeFile("vat-mail", bus[0], `mail${cfg.id}_${stamp}`, fileName, buffer, username);
    const { vars, lines, buList } = makeVars(rows);
    mails.push({
      to: cfg.mail_to || "", cc: cfg.mail_cc || "",
      subject: applyVars(cfg.subject_template, vars), bodyText: applyVars(cfg.body_template, vars),
      bodyHtml: buildBodyHtml(cfg.body_template, vars, lines, buListHtmlOf(buList)),
      file_id: fileId, file_name: fileName, count: rows.length, total_vat: rows.reduce((s, r) => s + num(r.exp_vat), 0),
      aging_lines: lines,
    });
  }
  return { mails, skipped, period };
}

const handle = (preview) => async (req, res) => {
  try {
    const username = await getUsernameByEmail(req.user.email);
    const { config_id, zone_bu, supplier_codes, rows: selRows } = req.body || {};
    const { rows: cr } = await pool.query(`SELECT * FROM vat_mail_config WHERE id = $1`, [config_id]);
    const cfg = cr[0];
    if (!cfg) return res.status(404).json({ error: "ไม่พบ Config" });
    const out = await generateMails(cfg, { zone_bu, supplier_codes, rows: selRows }, username, preview);
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

export default router;
