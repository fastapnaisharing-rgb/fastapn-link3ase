import { Router } from "express";
import { pool } from "../db.js";

/**
 * Legacy POC History — Import (Custom Column Mapping)
 *
 * ใช้เก็บข้อมูล PO/Invoice จากระบบเก่า (User_Backup.xlsx, Host_Backup.xlsx และไฟล์
 * ในอนาคต) เข้า legacy_poc_history เพื่อใช้เป็น Dictionary กันซ้ำ (Duplicate Check)
 * และแสดงผลปนกับ Invoice History ของระบบใหม่ (เฉพาะ Owner/Admin เห็น)
 *
 * TODO: เปลี่ยน import ด้านล่างให้ตรงกับ Path จริงของ Vendor SheetJS (.cjs) ที่ใช้อยู่แล้ว
 * ในระบบ (ดู fileStorage.js เป็นตัวอย่าง — ที่นี่สมมติชื่อไฟล์ไว้ก่อน)
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const XLSX = require("../../vendor/xlsx.full.min.cjs");

const router = Router();

const REQUIRED_FIELDS = ["invoice_num", "vendor_no", "amount"];
const TARGET_FIELDS = [
  "po_num", "doc_date", "invoice_num", "vendor_no",
  "tax_code", "gl_code", "dept_code", "amount", "description", "note",
];

function requireOwner(req, res, next) {
  if (req.user?.appRole !== "Owner") {
    return res.status(403).json({ error: "เฉพาะ Owner เท่านั้นที่ Import ข้อมูล Legacy ได้" });
  }
  next();
}

function parseWorkbook(fileBase64) {
  const buf = Buffer.from(fileBase64.replace(/^data:.*;base64,/, ""), "base64");
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { headers, rows };
}

function applyMapping(rows, columnMapping) {
  // columnMapping: { "PO Num.": "po_num", "Invoice Num": "invoice_num", ... }
  return rows.map((row) => {
    const mapped = {};
    for (const [sourceCol, targetField] of Object.entries(columnMapping)) {
      if (!targetField || !TARGET_FIELDS.includes(targetField)) continue;
      mapped[targetField] = row[sourceCol] ?? null;
    }
    return mapped;
  });
}

// ── POST /api/legacy-import/preview — อ่านไฟล์ + แนะนำ Mapping จาก Template เดิม ──
router.post("/preview", requireOwner, async (req, res, next) => {
  try {
    const { file_base64, file_name } = req.body || {};
    if (!file_base64) return res.status(400).json({ error: "ต้องแนบไฟล์ (file_base64)" });

    const { headers, rows } = parseWorkbook(file_base64);
    if (!headers.length) {
      return res.status(400).json({ error: "อ่านไฟล์ไม่พบ Header หรือไฟล์ว่างเปล่า" });
    }

    // ── หา Template เดิมที่ Header ตรงกันเป๊ะ (Auto-detect) ─────────────────
    const { rows: templates } = await pool.query(
      `SELECT id, template_name, source_headers, column_mapping FROM import_mapping_templates`
    );
    const matchedTemplate = templates.find((t) => {
      const saved = Array.isArray(t.source_headers) ? t.source_headers : [];
      return saved.length === headers.length && saved.every((h, i) => h === headers[i]);
    });

    const suggestedMapping = matchedTemplate?.column_mapping || {};

    // ── Preview 3 แถวแรกตาม Mapping ที่แนะนำ (หรือว่างถ้ายังไม่มี Template) ──
    const previewRows = applyMapping(rows.slice(0, 3), suggestedMapping);

    // ── นับจำนวนที่จะซ้ำกับของเดิม (เฉพาะถ้า Mapping มี vendor_no+invoice_num ครบ) ──
    let duplicateCount = 0;
    const hasKeyFields = suggestedMapping &&
      Object.values(suggestedMapping).includes("vendor_no") &&
      Object.values(suggestedMapping).includes("invoice_num");
    if (hasKeyFields) {
      const mappedAll = applyMapping(rows, suggestedMapping);
      const pairs = mappedAll
        .filter((r) => r.vendor_no && r.invoice_num)
        .map((r) => `${r.vendor_no}|${r.invoice_num}`);
      if (pairs.length) {
        const { rows: existing } = await pool.query(
          `SELECT vendor_no, invoice_num FROM legacy_poc_history
           WHERE (vendor_no, invoice_num) = ANY (
             SELECT unnest($1::text[]), unnest($2::text[])
           )`,
          [mappedAll.map((r) => r.vendor_no), mappedAll.map((r) => r.invoice_num)]
        );
        const existingSet = new Set(existing.map((e) => `${e.vendor_no}|${e.invoice_num}`));
        duplicateCount = pairs.filter((p) => existingSet.has(p)).length;
      }
    }

    res.json({
      file_name,
      headers,
      total_rows: rows.length,
      matched_template: matchedTemplate ? { id: matchedTemplate.id, name: matchedTemplate.template_name } : null,
      suggested_mapping: suggestedMapping,
      required_fields: REQUIRED_FIELDS,
      target_fields: TARGET_FIELDS,
      preview_rows: previewRows,
      estimated_duplicate_count: duplicateCount,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/legacy-import/confirm — Insert จริง (Skip ซ้ำ) + บันทึก Template ──
router.post("/confirm", requireOwner, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const {
      file_base64, headers, column_mapping,
      save_template, template_name, source_label,
    } = req.body || {};

    if (!file_base64) return res.status(400).json({ error: "ต้องแนบไฟล์ (file_base64)" });
    if (!column_mapping) return res.status(400).json({ error: "ต้องระบุ column_mapping" });

    const mappedTargets = Object.values(column_mapping);
    const missingRequired = REQUIRED_FIELDS.filter((f) => !mappedTargets.includes(f));
    if (missingRequired.length) {
      return res.status(400).json({
        error: `ต้อง Map Field ที่จำเป็นให้ครบ: ${missingRequired.join(", ")}`,
      });
    }

    const { rows } = parseWorkbook(file_base64);
    const mapped = applyMapping(rows, column_mapping).filter((r) => r.vendor_no && r.invoice_num);

    await client.query("BEGIN");

    // ── หาแถวที่ซ้ำกับของเดิมอยู่แล้ว (Skip) ────────────────────────────
    const { rows: existing } = await client.query(
      `SELECT vendor_no, invoice_num FROM legacy_poc_history
       WHERE (vendor_no, invoice_num) IN (
         SELECT * FROM UNNEST($1::text[], $2::text[])
       )`,
      [mapped.map((r) => r.vendor_no), mapped.map((r) => r.invoice_num)]
    );
    const existingSet = new Set(existing.map((e) => `${e.vendor_no}|${e.invoice_num}`));
    const toInsert = mapped.filter((r) => !existingSet.has(`${r.vendor_no}|${r.invoice_num}`));

    let insertedCount = 0;
    for (const r of toInsert) {
      await client.query(
        `INSERT INTO legacy_poc_history
           (po_num, doc_date, invoice_num, vendor_no, tax_code, gl_code, dept_code, amount, description, note, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          r.po_num || null, r.doc_date || null, r.invoice_num, r.vendor_no,
          r.tax_code || null, r.gl_code || null, r.dept_code || null,
          r.amount != null ? Number(r.amount) : null,
          r.description || null, r.note || null,
          source_label || "manual_import",
        ]
      );
      insertedCount++;
    }

    if (save_template && template_name && Array.isArray(headers)) {
      await client.query(
        `INSERT INTO import_mapping_templates (template_name, source_headers, column_mapping, created_by)
         VALUES ($1, $2, $3, $4)`,
        [template_name, JSON.stringify(headers), JSON.stringify(column_mapping), req.user?.email || "unknown"]
      );
    }

    await client.query("COMMIT");
    res.status(201).json({
      inserted: insertedCount,
      skipped_duplicate: mapped.length - insertedCount,
      total_in_file: rows.length,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

export default router;