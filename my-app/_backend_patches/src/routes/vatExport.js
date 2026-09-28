import { Router } from "express";
import { pool, getUsernameByEmail } from "../db.js";
import zlib from "zlib";
import fs from "fs";
import path from "path";
import http from "http";

// MARKER_VATEXPORT_REALTIME_BROADCAST_V1
function broadcastVatExportUpdate(event, data = {}) {
  const payload = JSON.stringify({ event, ...data });
  const req = http.request({
    hostname: "127.0.0.1",
    port: process.env.PORT || 4000,
    path: "/api/internal/broadcast",
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
  }, (res) => { res.on("data", () => {}); });
  req.on("error", (e) => console.error("broadcastVatExportUpdate error:", e.message));
  req.write(payload);
  req.end();
}
import {
  periodToMmmYy,
  buildFolderPath,
  generatePopvatWorkbook,
  generateSimpleAdiWorkbook,
  generateSimpleBySheetWorkbooks,
  generateAdiOnlyWorkbook,
  convertXlsxBufferToXls,
} from "./vatExportGenerators.js";

const router = Router();

// -- Path ไฟล์ Master Template ทั้ง 3 ตัว (Static บน Backend) -- MARKER_VATEXPORT_TEMPLATE_PATH_FIX_V1 -- แก้ชื่อไฟล์ให้ตรงกับที่มีจริงบน Server (Simple/ADI ใช้ช่องว่างคั่น ไม่ใช่ _)
const TEMPLATE_DIR = "C:\\apps\\fastapn-backend\\src\\templates";
const POPVAT_TEMPLATE_PATH = `${TEMPLATE_DIR}\\Master Popvat Templete.xlsx`; // MARKER_VATEXPORT_POPVAT_EXCELJS_LIBREOFFICE_V4 -- .xlsx (ExcelJS เขียน แล้วส่งต่อ LibreOffice แปลงเป็น .xls)
const SIMPLE_TEMPLATE_PATH = `${TEMPLATE_DIR}\\Master_Simple Template.xlsx`;
const ADI_TEMPLATE_PATH = `${TEMPLATE_DIR}\\Master_ADI Template.xlsx`;

// -- Root โฟลเดอร์เก็บไฟล์ -- ใช้ STORAGE_ROOT เดียวกับ fileStorage.js --
const STORAGE_ROOT = "C:\\apps\\fastapn-backend\\storage";

function sanitizeForFilename(str) {
  return String(str).replace(/[\\/:*?"<>|]/g, "_");
}

// -- Module ที่ใช้แยกประเภทไฟล์ใน file_storage -- Frontend เช็คจากตัวนี้ว่า Batch มีไฟล์อะไรบ้าง --
const MODULE_POPVAT = "vat-popvat";
const MODULE_SIMPLE = "vat-simple";
const MODULE_ADI = "vat-adi";
const MODULE_SIMPLE_ADI = "vat-simple-adi";

// -- เก็บไฟล์ (Gzip) ลง Disk + Insert file_storage Record -- คืน { id, fileName } --
async function storeGeneratedFile(module, bu, batchId, fileName, buffer, username) {
  const now = new Date();
  const yyyyMm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const dir = path.join(STORAGE_ROOT, bu, yyyyMm);
  fs.mkdirSync(dir, { recursive: true });
  const safeBatchId = sanitizeForFilename(batchId);
  const ext = fileName.endsWith(".xlsx") ? "xlsx" : "xls";
  const filePath = path.join(dir, `${safeBatchId}_${module}.${ext}.gz`);

  const gzBuffer = zlib.gzipSync(buffer);
  fs.writeFileSync(filePath, gzBuffer);

  const { rows } = await pool.query(
    `INSERT INTO file_storage (module, bu, ref_id, file_path, file_name, owner_username, status, retention_days)
     VALUES ($1, $2, $3, $4, $5, $6, \'active\', $7)
     RETURNING id, created_at`,
    [module, bu, batchId, filePath, fileName, username, null]
  );
  return { id: rows[0].id, fileName, createdAt: rows[0].created_at };
}

function toStandardPeriod(periodStr) {
  return periodStr || "";
}

// MARKER_VATEXPORT_GENERATE_ENDPOINT_V3 -- Checkbox เลือก Report + BU/Book Mode + Menu Source Filter + Simple By Sheet
// Body: { bu, scope: 'bu'|'book', book, reports: ['popvat','simple','adi'], simpleMode: 'all'|'by_sheet', menuSource }
router.post("/generate", async (req, res) => {
  const username = await getUsernameByEmail(req.user.email);
  const { bu, scope = "bu", book, reports, simpleMode = "all", menuSource, simpleGroupKeys } = req.body || {}; // MARKER_VATEXPORT_SIMPLE_GROUPKEYS_FILTER_V1 -- simpleGroupKeys: Optional Array เลือกเฉพาะบาง Sheet ตอน By sheet

  if (!bu || !Array.isArray(reports) || reports.length === 0) {
    return res.status(400).json({ error: "ข้อมูลไม่ครบ (ต้องมี bu และ reports อย่างน้อย 1 รายการ)" });
  }
  if (scope === "book" && !book) {
    return res.status(400).json({ error: "เลือกโหมด Book ต้องระบุ book มาด้วย" });
  }

  const wantPopvat = reports.includes("popvat");
  const wantSimple = reports.includes("simple");
  const wantAdi = reports.includes("adi");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // -- BU List สำหรับ Popvat/ADI (Book Mode กวาดหลาย BU / BU Mode แค่ BU เดียว) -- Simple ใช้แค่ [bu] เสมอ (ทำ Book ไม่ได้) --
    let popvatAdiBuList = [bu];
    if (scope === "book") {
      const buListRes = await client.query(`SELECT DISTINCT bu FROM company_list WHERE book = $1`, [book]);
      popvatAdiBuList = buListRes.rows.map((r) => r.bu);
      if (popvatAdiBuList.length === 0) popvatAdiBuList = [bu];
    }

    const label = scope === "book" ? book : bu; // ใช้เป็นชื่อไฟล์ Popvat/ADI ตอน Book Mode

    const nowForBatchId = new Date();
    const yyyy = nowForBatchId.getFullYear();
    const mm = String(nowForBatchId.getMonth() + 1).padStart(2, "0");
    const dd = String(nowForBatchId.getDate()).padStart(2, "0");
    const hh = String(nowForBatchId.getHours()).padStart(2, "0");
    const min = String(nowForBatchId.getMinutes()).padStart(2, "0");
    const batchId = `${label}_TransferVat_${yyyy}${mm}${dd}_${hh}${min}`;

    // -- Update batch_id เฉพาะตารางที่เลือกไว้ พร้อม Filter Menu Source (ถ้ามี) --
    let popvatUpdated = { rowCount: 0 };
    let simpleUpdated = { rowCount: 0 };
    let adiUpdated = { rowCount: 0 };

    if (wantPopvat) {
      const params = [batchId, popvatAdiBuList];
      let sql = `UPDATE vat_upload_popvatdraft SET batch_id = $1, status = 'exported' WHERE bu = ANY($2) AND batch_id IS NULL`; // MARKER_VATWATCHLISTOPS_EXPORT_STATUS_SYNC_V1
      if (menuSource) { params.push(menuSource); sql += ` AND menu_source = $${params.length}`; }
      sql += ` RETURNING id`;
      console.log("DEBUG POPVAT UPDATE SQL:", sql); // MARKER_VATWATCHLISTOPS_DEBUG_TEMP_V1 -- ลบออกทีหลัง
      console.log("DEBUG POPVAT UPDATE PARAMS:", JSON.stringify(params)); // MARKER_VATWATCHLISTOPS_DEBUG_TEMP_V1
      popvatUpdated = await client.query(sql, params);
      console.log("DEBUG POPVAT UPDATE ROWCOUNT:", popvatUpdated.rowCount, "ROWS:", JSON.stringify(popvatUpdated.rows)); // MARKER_VATWATCHLISTOPS_DEBUG_TEMP_V1
    }

    if (wantSimple) {
      const params = [batchId, bu];
      let sql = `UPDATE vat_simpleinputdraft SET batch_id = $1, status = 'exported' WHERE bu = $2 AND batch_id IS NULL`; // MARKER_VATWATCHLISTOPS_EXPORT_STATUS_SYNC_V1
      if (menuSource) { params.push(menuSource); sql += ` AND menu_source = $${params.length}`; }
      if (Array.isArray(simpleGroupKeys) && simpleGroupKeys.length > 0) { // MARKER_VATEXPORT_SIMPLE_GROUPKEYS_FILTER_V1 -- เลือกเฉพาะ Sheet ที่ติ๊กไว้ (ไม่ติ๊ก = ไม่แตะแถวนั้น ยังคง Pending ต่อ)
        params.push(simpleGroupKeys);
        sql += ` AND (COALESCE(invoice_ref,'Invoice') || '_' || COALESCE(type_sim,'NNN')) = ANY($${params.length})`;
      }
      sql += ` RETURNING id`;
      simpleUpdated = await client.query(sql, params);
    }

    if (wantAdi) {
      const params = [batchId, popvatAdiBuList];
      let sql = `UPDATE vat_adi_transferdraft SET batch_id = $1, status = 'exported' WHERE bu = ANY($2) AND batch_id IS NULL`; // MARKER_VATWATCHLISTOPS_EXPORT_STATUS_SYNC_V1
      if (menuSource) { params.push(menuSource); sql += ` AND menu_source = $${params.length}`; }
      sql += ` RETURNING id`;
      adiUpdated = await client.query(sql, params);
    }

    if (popvatUpdated.rowCount === 0 && simpleUpdated.rowCount === 0 && adiUpdated.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "ไม่พบข้อมูล Draft ที่ยังไม่ได้ Export ตามเงื่อนไขที่เลือก" });
    }

    const [popvatRows, simpleRows, adiRows] = await Promise.all([
      wantPopvat ? client.query(`SELECT * FROM vat_upload_popvatdraft WHERE batch_id = $1 ORDER BY id`, [batchId]) : Promise.resolve({ rows: [] }),
      wantSimple ? client.query(`SELECT * FROM vat_simpleinputdraft WHERE batch_id = $1 ORDER BY id`, [batchId]) : Promise.resolve({ rows: [] }),
      wantAdi ? client.query(`SELECT * FROM vat_adi_transferdraft WHERE batch_id = $1 ORDER BY id`, [batchId]) : Promise.resolve({ rows: [] }),
    ]);

    await client.query("COMMIT");
    // MARKER_VATEXPORT_REALTIME_BROADCAST_V1
    broadcastVatExportUpdate("vat_export_updated", { buList: [...new Set([...(Array.isArray(popvatAdiBuList) ? popvatAdiBuList : []), bu].filter(Boolean))] });

    // MARKER_VATWATCHLISTOPS_PERIOD_FALLBACK_CURRENT_V1 -- คำนวณ Current Period ของระบบไว้ก่อน ใช้เป็น Fallback เมื่อ Draft ไม่มี Period (Column ว่าง)
    const nowForFolderPath = new Date();
    const currentPeriodMonthYear = `${String(nowForFolderPath.getMonth() + 1).padStart(2, "0")}-${nowForFolderPath.getFullYear()}`;

    const samplePeriod = popvatRows.rows[0]?.period || simpleRows.rows[0]?.period || adiRows.rows[0]?.period || "";
    const periodMonthYear = toStandardPeriod(samplePeriod) || currentPeriodMonthYear; // MARKER_VATWATCHLISTOPS_PERIOD_FALLBACK_CURRENT_V1 -- Fallback เป็น Current Period ถ้า Draft ว่าง
    const periodMmmYy = periodToMmmYy(periodMonthYear);

    const companyRes = await pool.query(`SELECT * FROM company_list WHERE bu = $1 LIMIT 1`, [bu]);
    const companyRow = companyRes.rows[0] || {};
    const companyCodeParts = String(companyRow["COMPANY CODE"] || "").split("-").map((s) => s.trim()).filter(Boolean);
    const com = companyCodeParts[2] || "";
    const companyNameFromCompanyList = companyRow["Simple Company"] || companyRow["Company (Report Display)"] || "";
    let company = com && companyNameFromCompanyList ? `${com}-${companyNameFromCompanyList}` : companyNameFromCompanyList;

    // MARKER_VATEXPORT_COMPANY_BRANCHLIST_FALLBACK_V1 -- company_list บาง BU ไม่มีข้อมูล -- Fallback ไปดู branch_list แทน
    // (Column "Simple Company" ของ branch_list มี Code+ชื่อรวมมาให้พร้อมเป็น String เดียว ใช้ตรงๆ ไม่ต้อง Combine กับ com ซ้ำ)
    if (!company) {
      const branchRes = await pool.query(`SELECT "Simple Company" FROM branch_list WHERE bu = $1 LIMIT 1`, [bu]);
      company = branchRes.rows[0]?.["Simple Company"] || "";
    }

    // MARKER_VATEXPORT_FOLDERPATH_SEGMENT3_CURRENTPERIOD_V1 -- Folder Path ใช้ SEGMENT3 (คนละ Field กับ com) + Current Period ของระบบ (ไม่ใช่ Period ของ Draft)
    const segment3 = companyRow["SEGMENT3"] || "";

    const meta = { bu, com, company, periodMmmYy, folderPath: buildFolderPath(segment3, currentPeriodMonthYear) };

    // MARKER_VATEXPORT_POPVAT_FILENAME_DDMM_TODAY_FIX_V1 -- ddmm ของ Popvat ต้องเป็นวันที่ Export "วันนี้" (Today)
    // ไม่ใช่ Parse จาก receipt_date (เดิม Regex คาดหวัง ISO YYYY-MM-DD แต่
    // Popvat เก็บวันที่เป็น Text DD-MMM-YY เลย Match ไม่ติด ได้ค่าว่างตลอด)
    const nowForFilename = new Date();
    const hhmm = `${String(nowForFilename.getHours()).padStart(2, "0")}${String(nowForFilename.getMinutes()).padStart(2, "0")}`;
    const yy = String(nowForFilename.getFullYear()).slice(-2);
    const mmNow = String(nowForFilename.getMonth() + 1).padStart(2, "0");
    const ddNow = String(nowForFilename.getDate()).padStart(2, "0");
    const ddmm = `${ddNow}${mmNow}`;
    const popvatFilenameSuffix = `${periodMmmYy}_${ddmm}_${hhmm}`;
    const simpleAdiFilenameSuffix = `${yy}${mmNow}${ddNow}_${hhmm}`;
    meta.hhmm = hhmm; // MARKER_VATEXPORT_META_HHMM_FOR_Y2_V1 -- ให้ Y2 ใน Simple Sheet ใช้เวลาเดียวกับชื่อไฟล์จริง

    const generatedFiles = [];

    // -- Popvat (แยกไฟล์เดี่ยวเสมอ -- Confirm แล้ว) --
    if (wantPopvat && popvatRows.rows.length > 0) {
      const xlsxBuf = await generatePopvatWorkbook(POPVAT_TEMPLATE_PATH, popvatRows.rows, meta); // MARKER_VATEXPORT_POPVAT_EXCELJS_LIBREOFFICE_V4
      const buf = await convertXlsxBufferToXls(xlsxBuf, `popvat_${batchId}`); // MARKER_VATEXPORT_POPVAT_EXCELJS_LIBREOFFICE_V4 -- แปลงเป็น .xls แท้ผ่าน LibreOffice
      const fileName = `${label}_Popvat_APN_${popvatFilenameSuffix}.xls`;
      const stored = await storeGeneratedFile(MODULE_POPVAT, bu, batchId, fileName, buf, username);
      generatedFiles.push({ module: MODULE_POPVAT, ...stored });
    }

    const hasSimpleData = wantSimple && simpleRows.rows.length > 0;
    const hasAdiData = wantAdi && adiRows.rows.length > 0;

    const buildSimpleGroups = () => {
      const groupsMap = new Map();
      simpleRows.rows.forEach((r) => {
        const key = `${r.invoice_ref || "Invoice"}_${r.type_sim || "NNN"}`;
        if (!groupsMap.has(key)) {
          groupsMap.set(key, { key, invoiceRef: r.invoice_ref || "", typeSim: r.type_sim || "", invoiceType: r.invoice_ref || "Invoice", rows: [] });
        }
        groupsMap.get(key).rows.push(r);
      });
      return Array.from(groupsMap.values());
    };

    if (hasSimpleData && simpleMode === "by_sheet") {
      // -- Simple By Sheet: แยกแต่ละกลุ่มเป็นคนละไฟล์ (ADI แยกเดี่ยวเสมอในโหมดนี้ รวมกับ Simple ไม่ได้) --
      const sheetFiles = await generateSimpleBySheetWorkbooks(SIMPLE_TEMPLATE_PATH, buildSimpleGroups(), meta);
      for (const sf of sheetFiles) {
        const fileName = `${bu}_Simple_${sanitizeForFilename(sf.sheetKey)}_${simpleAdiFilenameSuffix}.xlsx`;
        const stored = await storeGeneratedFile(MODULE_SIMPLE, bu, batchId, fileName, sf.buffer, username);
        generatedFiles.push({ module: MODULE_SIMPLE, ...stored });
      }
      if (hasAdiData) {
        const buf = await generateAdiOnlyWorkbook(ADI_TEMPLATE_PATH, adiRows.rows, meta);
        const fileName = `${label}_ADI_${simpleAdiFilenameSuffix}.xlsx`;
        const stored = await storeGeneratedFile(MODULE_ADI, bu, batchId, fileName, buf, username);
        generatedFiles.push({ module: MODULE_ADI, ...stored });
      }
    } else if (hasSimpleData && hasAdiData) {
      // -- ติ๊กทั้ง Simple + ADI พร้อมกัน (simpleMode = all) -- รวมเป็นไฟล์เดียว --
      const buf = await generateSimpleAdiWorkbook(SIMPLE_TEMPLATE_PATH, buildSimpleGroups(), ADI_TEMPLATE_PATH, adiRows.rows, meta);
      const fileName = `${bu}_Simple_ADI_${simpleAdiFilenameSuffix}.xlsx`;
      const stored = await storeGeneratedFile(MODULE_SIMPLE_ADI, bu, batchId, fileName, buf, username);
      generatedFiles.push({ module: MODULE_SIMPLE_ADI, ...stored });
    } else if (hasSimpleData) {
      // -- ติ๊กแค่ Simple อย่างเดียว --
      const buf = await generateSimpleAdiWorkbook(SIMPLE_TEMPLATE_PATH, buildSimpleGroups(), ADI_TEMPLATE_PATH, [], meta);
      const fileName = `${bu}_Simple_${simpleAdiFilenameSuffix}.xlsx`;
      const stored = await storeGeneratedFile(MODULE_SIMPLE, bu, batchId, fileName, buf, username);
      generatedFiles.push({ module: MODULE_SIMPLE, ...stored });
    } else if (hasAdiData) {
      // -- ติ๊กแค่ ADI อย่างเดียว --
      const buf = await generateAdiOnlyWorkbook(ADI_TEMPLATE_PATH, adiRows.rows, meta);
      const fileName = `${label}_ADI_${simpleAdiFilenameSuffix}.xlsx`;
      const stored = await storeGeneratedFile(MODULE_ADI, bu, batchId, fileName, buf, username);
      generatedFiles.push({ module: MODULE_ADI, ...stored });
    }

    if (generatedFiles.length === 0) {
      return res.status(404).json({ error: "ไม่มีข้อมูลให้ Generate ไฟล์เลย" });
    }

    res.json({ ok: true, batchId, bu, files: generatedFiles });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (e) { /* ignore */ }
    console.error("POST /vat-export/generate error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

// MARKER_VATEXPORT_MENU_SOURCES_ENDPOINT_V1 -- List ค่า menu_source ที่มีจริงแบบ Dynamic (มีเพิ่มได้เรื่อยๆ ในอนาคต)
router.get("/menu-sources", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT menu_source FROM vat_upload_popvatdraft WHERE menu_source IS NOT NULL
       UNION
       SELECT DISTINCT menu_source FROM vat_simpleinputdraft WHERE menu_source IS NOT NULL
       UNION
       SELECT DISTINCT menu_source FROM vat_adi_transferdraft WHERE menu_source IS NOT NULL
       ORDER BY 1`
    );
    res.json({ ok: true, menuSources: rows.map((r) => r.menu_source) });
  } catch (err) {
    console.error("GET /vat-export/menu-sources error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// MARKER_VATEXPORT_DRAFT_COUNTS_ENDPOINT_V1 -- Count แบบเบา (COUNT GROUP BY) แทนดึงทั้งตารางมานับฝั่ง Frontend
// MARKER_VATEXPORT_DRAFT_COUNTS_EXCLUDE_PREDRAFT_V1 -- Bug Fix: ตามที่แจ้ง Dashboard "VAT Resource from Operation" ไม่ควรนับ status='pre-draft' (แถวที่ยังไม่ Confirm จาก Simple Input Ops "+Add") ปนกับ status='draft' (Confirm แล้ว) -- เดิม Query ไม่มี Filter status เลย นับทุก Status รวมกันหมด
router.get("/draft-counts", async (req, res) => {
  try {
    const [popvatRes, simpleRes, adiRes] = await Promise.all([
      pool.query(`SELECT bu, COUNT(*)::int AS cnt FROM vat_upload_popvatdraft WHERE batch_id IS NULL AND status = 'draft' GROUP BY bu`),
      pool.query(`SELECT bu, COUNT(*)::int AS cnt FROM vat_simpleinputdraft WHERE batch_id IS NULL AND status = 'draft' GROUP BY bu`),
      pool.query(`SELECT bu, COUNT(*)::int AS cnt FROM vat_adi_transferdraft WHERE batch_id IS NULL AND status = 'draft' GROUP BY bu`),
    ]);

    const counts = {};
    const categoryCounts = {};
    const applyRows = (rows, catKey) => {
      rows.forEach((r) => {
        const bu = r.bu;
        if (!bu) return;
        counts[bu] = (counts[bu] || 0) + r.cnt;
        if (!categoryCounts[bu]) categoryCounts[bu] = { popvat: 0, simple: 0, adi: 0 };
        categoryCounts[bu][catKey] += r.cnt;
      });
    };
    applyRows(popvatRes.rows, "popvat");
    applyRows(simpleRes.rows, "simple");
    applyRows(adiRes.rows, "adi");

    res.json({ ok: true, counts, categoryCounts });
  } catch (err) {
    console.error("GET /vat-export/draft-counts error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// MARKER_VATEXPORT_HISTORY_ENDPOINT_V1
router.get("/history", async (req, res) => {
  try {
    const { bu } = req.query;
    const params = [];
    let whereClause = `WHERE module IN (\'${MODULE_POPVAT}\', \'${MODULE_SIMPLE}\', \'${MODULE_ADI}\', \'${MODULE_SIMPLE_ADI}\')`;
    if (bu) {
      params.push(bu);
      whereClause += ` AND bu = $${params.length}`;
    }

    const { rows } = await pool.query(
      `SELECT id, module, bu, ref_id AS batch_id, file_name, created_at, downloaded_at
       FROM file_storage
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT 200`,
      params
    );

    const batchMap = new Map();
    rows.forEach((r) => {
      if (!batchMap.has(r.batch_id)) {
        batchMap.set(r.batch_id, { batchId: r.batch_id, bu: r.bu, exportedAt: r.created_at, files: [] });
      }
      const batch = batchMap.get(r.batch_id);
      batch.files.push({
        id: r.id,
        module: r.module,
        fileName: r.file_name,
        downloadedAt: r.downloaded_at,
      });
      if (new Date(r.created_at) < new Date(batch.exportedAt)) batch.exportedAt = r.created_at;
    });

    res.json({ ok: true, batches: Array.from(batchMap.values()) });
  } catch (err) {
    console.error("GET /vat-export/history error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// MARKER_VATEXPORT_DOWNLOAD_ENDPOINT_V1
router.get("/file/:id/download", async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(`SELECT * FROM file_storage WHERE id = $1`, [id]);
    const record = rows[0];
    if (!record) return res.status(404).json({ error: "ไม่พบไฟล์นี้" });
    if (!fs.existsSync(record.file_path)) {
      return res.status(404).json({ error: "ไม่พบไฟล์จริงบน Server (อาจถูกลบไปแล้ว)" });
    }

    const gzBuffer = fs.readFileSync(record.file_path);
    const fileBuffer = zlib.gunzipSync(gzBuffer);

    await pool.query(`UPDATE file_storage SET downloaded_at = NOW() WHERE id = $1`, [id]);

    const contentType = record.file_name.endsWith(".xlsx")
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/vnd.ms-excel";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${record.file_name}"`);
    res.send(fileBuffer);
  } catch (err) {
    console.error("GET /vat-export/file/:id/download error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// MARKER_VATEXPORT_RESTORE_BATCH_ENDPOINT_V1
// ── DELETE /api/vat-export/batch/:batchId — Restore: ลบไฟล์ + file_storage Record ของ Batch นี้ + Set batch_id กลับเป็น NULL ในตาราง Draft ทั้ง 3 (กลับไปเป็น "รอ Export" เหมือนเดิม) ──
router.delete("/batch/:batchId", async (req, res) => {
  const { batchId } = req.params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: files } = await client.query(`SELECT * FROM file_storage WHERE ref_id = $1`, [batchId]);
    for (const f of files) {
      try { if (fs.existsSync(f.file_path)) fs.unlinkSync(f.file_path); } catch (e) { /* ไฟล์จริงหายไปแล้วก็ไม่เป็นไร ลบ Record ต่อได้ */ }
    }
    await client.query(`DELETE FROM file_storage WHERE ref_id = $1`, [batchId]);

    await Promise.all([
      client.query(`UPDATE vat_upload_popvatdraft SET batch_id = NULL, status = 'draft' WHERE batch_id = $1`, [batchId]), // MARKER_VATWATCHLISTOPS_EXPORT_STATUS_SYNC_V1
      client.query(`UPDATE vat_simpleinputdraft SET batch_id = NULL, status = 'draft' WHERE batch_id = $1`, [batchId]), // MARKER_VATWATCHLISTOPS_EXPORT_STATUS_SYNC_V1
      client.query(`UPDATE vat_adi_transferdraft SET batch_id = NULL, status = 'draft' WHERE batch_id = $1`, [batchId]), // MARKER_VATWATCHLISTOPS_EXPORT_STATUS_SYNC_V1
    ]);

    await client.query("COMMIT");
    // MARKER_VATEXPORT_REALTIME_BROADCAST_V1
    broadcastVatExportUpdate("vat_export_updated", { batchId });
    res.json({ ok: true, deletedFiles: files.length });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (e) { /* ignore */ }
    console.error("DELETE /vat-export/batch/:batchId error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

export default router;