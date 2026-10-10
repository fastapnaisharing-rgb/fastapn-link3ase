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

// MARKER_VATEXPORT_FINISH_PVBACKUP_V1 -- Finish Batch: status 'exported' -> 'pv-backup' ทั้ง batch_id + บันทึกวันหมดอายุ (กด Finish + 6 เดือน) | ยังไม่ลบอะไร
for (const tbl of ["vat_upload_popvatdraft", "vat_simpleinputdraft", "vat_adi_transferdraft"]) {
  pool.query(`ALTER TABLE IF EXISTS ${tbl} ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS expire_at TIMESTAMPTZ`)
    .catch((e) => console.error(`[${tbl}] add finished_at/expire_at:`, e.message));
}

// MARKER_VATEXPORT_HISTORY_INDEX_SPEED_V1 -- History/Finish/Backup ค้นตาม batch_id+status ทุกครั้ง: ไม่มี Index = Scan ทั้งตาราง Draft (ช้ามากเมื่อข้อมูลโต)
for (const tbl of ["vat_upload_popvatdraft", "vat_simpleinputdraft", "vat_adi_transferdraft"]) {
  pool.query(`CREATE INDEX IF NOT EXISTS idx_${tbl}_batch_status ON ${tbl} (batch_id, status)`)
    .catch((e) => console.error(`[${tbl}] idx batch_status:`, e.message));
}
pool.query(`CREATE INDEX IF NOT EXISTS idx_file_storage_module_created ON file_storage (module, created_at DESC)`)
  .catch((e) => console.error("[file_storage] idx module_created:", e.message));
pool.query(`CREATE INDEX IF NOT EXISTS idx_file_storage_ref_id ON file_storage (ref_id)`)
  .catch((e) => console.error("[file_storage] idx ref_id:", e.message));

// MARKER_VATEXPORT_ARCHIVE_PURGE_V1 -- ตารางเก็บยอดรวม Transaction ของ Draft ที่ถูกลบหลังครบกำหนด (User Transaction Dashboard นับรวมตารางนี้ด้วย)
pool.query(`
  CREATE TABLE IF NOT EXISTS vat_transaction_archive (
    id SERIAL PRIMARY KEY,
    draft_id TEXT NOT NULL,
    username TEXT,
    bu TEXT,
    fill_started_at TIMESTAMP,
    created_at TIMESTAMP,
    batch_id TEXT,
    line_count INTEGER NOT NULL DEFAULT 1,
    module_type TEXT,
    archived_at TIMESTAMPTZ DEFAULT NOW()
  )
`).catch((e) => console.error("[vat_transaction_archive] create:", e.message));

// MARKER_VATEXPORT_RETENTION_V1 -- อายุเก็บหลัง Finish/ปิด Period: ADI 1 เดือน, Simple 6 เดือน, Popvat 6 เดือน
const PV_RETENTION = { popvat: "6 months", simple: "6 months", adi: "1 month" };

// MARKER_VATEXPORT_SEPARATE_BACKUP_STATUS_V1 -- สถานะ Backup แยกตามประเภท: Popvat=pv-backup, Simple=sm-backup, ADI=adi-backup
const BACKUP_STATUS = { popvat: "pv-backup", simple: "sm-backup", adi: "adi-backup" };
// ย้ายข้อมูลเก่าที่ Finish ไปแล้วด้วยสถานะ pv-backup ใน Simple/ADI ให้เป็นสถานะใหม่
pool.query(`UPDATE vat_simpleinputdraft SET status = 'sm-backup' WHERE status = 'pv-backup'`).catch((e) => console.error("[migrate sm-backup]:", e.message));
pool.query(`UPDATE vat_adi_transferdraft SET status = 'adi-backup' WHERE status = 'pv-backup'`).catch((e) => console.error("[migrate adi-backup]:", e.message));

const PURGE_TABLES = [
  { table: "vat_upload_popvatdraft", type: "popvat" },
  { table: "vat_simpleinputdraft", type: "simple" },
  { table: "vat_adi_transferdraft", type: "adi" },
];

// ลบ Batch ที่หมดอายุ (status='pv-backup' และ expire_at <= NOW()): เก็บยอดรวมต่อ draft_id ลง vat_transaction_archive ก่อน แล้วค่อยลบแถว Draft + ไฟล์
async function purgeExpiredPvBackup() {
  try {
    const { rows: batches } = await pool.query(
      `SELECT DISTINCT batch_id FROM (
         SELECT batch_id FROM vat_upload_popvatdraft WHERE status = 'pv-backup' AND expire_at <= NOW() AND batch_id IS NOT NULL
         UNION SELECT batch_id FROM vat_simpleinputdraft WHERE status = 'sm-backup' AND expire_at <= NOW() AND batch_id IS NOT NULL
         UNION SELECT batch_id FROM vat_adi_transferdraft WHERE status = 'adi-backup' AND expire_at <= NOW() AND batch_id IS NOT NULL
       ) t`
    );
    for (const { batch_id: batchId } of batches) {
      const client = await pool.connect();
      let filesToDelete = [];
      try {
        await client.query("BEGIN");
        for (const { table, type } of PURGE_TABLES) {
          await client.query(
            `INSERT INTO vat_transaction_archive (draft_id, username, bu, fill_started_at, created_at, batch_id, line_count, module_type)
             SELECT DISTINCT ON (draft_id, username) draft_id::text, username, bu, fill_started_at, created_at, batch_id::text, cnt::int, $2
             FROM (
               SELECT draft_id, username, bu, fill_started_at, created_at, batch_id,
                      COUNT(*) OVER (PARTITION BY draft_id, username) AS cnt
               FROM ${table}
               WHERE batch_id = $1 AND status = '${BACKUP_STATUS[type]}' AND expire_at <= NOW()
                 AND draft_id IS NOT NULL AND draft_id::text <> ''
             ) s
             ORDER BY draft_id, username, created_at`,
            [batchId, type]
          );
          await client.query(`DELETE FROM ${table} WHERE batch_id = $1 AND status = '${BACKUP_STATUS[type]}' AND expire_at <= NOW()`, [batchId]);
        }
        // ไฟล์ลบเมื่อ Draft ที่ไฟล์นั้นพึ่งพาไม่เหลือใน Batch แล้ว (vat-simple-adi พึ่งทั้ง Simple และ ADI -> ลบตอนที่ทั้งสองหมด)
        const remain = {};
        for (const { table, type } of PURGE_TABLES) {
          const r = await client.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE batch_id = $1 AND status = '${BACKUP_STATUS[type]}'`, [batchId]);
          remain[type] = r.rows[0].n;
        }
        const deps = { [MODULE_POPVAT]: ["popvat"], [MODULE_SIMPLE]: ["simple"], [MODULE_ADI]: ["adi"], [MODULE_SIMPLE_ADI]: ["simple", "adi"] };
        const { rows: files } = await client.query(`SELECT id, module, file_path FROM file_storage WHERE ref_id = $1`, [batchId]);
        filesToDelete = files.filter((f) => (deps[f.module] || []).every((t) => remain[t] === 0));
        for (const f of filesToDelete) await client.query(`DELETE FROM file_storage WHERE id = $1`, [f.id]);
        await client.query("COMMIT");
      } catch (err) {
        try { await client.query("ROLLBACK"); } catch (e) { /* ignore */ }
        console.error(`[purgeExpiredPvBackup] batch ${batchId} error:`, err.message);
        continue;
      } finally {
        client.release();
      }
      for (const f of filesToDelete) {
        try { if (f.file_path && fs.existsSync(f.file_path)) fs.unlinkSync(f.file_path); } catch (e) { /* ไฟล์หายไปแล้วก็ไม่เป็นไร */ }
      }
      console.log(`[purgeExpiredPvBackup] archived+deleted batch ${batchId} (${filesToDelete.length} files)`);
      broadcastVatExportUpdate("vat_export_updated", { batchId });
    }
  } catch (err) {
    console.error("[purgeExpiredPvBackup] error:", err.message);
  }
}
setTimeout(purgeExpiredPvBackup, 2 * 60 * 1000);
setInterval(purgeExpiredPvBackup, 24 * 60 * 60 * 1000);

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
      let sql = `UPDATE vat_upload_popvatdraft SET batch_id = $1, status = 'exported' WHERE bu = ANY($2) AND batch_id IS NULL AND status = 'draft'`; // MARKER_VATEXPORT_ONLY_CONFIRMED_DRAFT_V1 -- Export เฉพาะ status='draft' (Confirm แล้ว) ห้ามหยิบ pre-draft ไปด้วย // MARKER_VATWATCHLISTOPS_EXPORT_STATUS_SYNC_V1
      if (menuSource) { params.push(menuSource); sql += ` AND menu_source = $${params.length}`; }
      sql += ` RETURNING id`;
      console.log("DEBUG POPVAT UPDATE SQL:", sql); // MARKER_VATWATCHLISTOPS_DEBUG_TEMP_V1 -- ลบออกทีหลัง
      console.log("DEBUG POPVAT UPDATE PARAMS:", JSON.stringify(params)); // MARKER_VATWATCHLISTOPS_DEBUG_TEMP_V1
      popvatUpdated = await client.query(sql, params);
      console.log("DEBUG POPVAT UPDATE ROWCOUNT:", popvatUpdated.rowCount, "ROWS:", JSON.stringify(popvatUpdated.rows)); // MARKER_VATWATCHLISTOPS_DEBUG_TEMP_V1
    }

    if (wantSimple) {
      const params = [batchId, bu];
      let sql = `UPDATE vat_simpleinputdraft SET batch_id = $1, status = 'exported' WHERE bu = $2 AND batch_id IS NULL AND status = 'draft'`; // MARKER_VATEXPORT_ONLY_CONFIRMED_DRAFT_V1 -- Export เฉพาะ status='draft' (Confirm แล้ว) ห้ามหยิบ pre-draft ไปด้วย // MARKER_VATWATCHLISTOPS_EXPORT_STATUS_SYNC_V1
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
      let sql = `UPDATE vat_adi_transferdraft SET batch_id = $1, status = 'exported' WHERE bu = ANY($2) AND batch_id IS NULL AND status = 'draft'`; // MARKER_VATEXPORT_ONLY_CONFIRMED_DRAFT_V1 -- Export เฉพาะ status='draft' (Confirm แล้ว) ห้ามหยิบ pre-draft ไปด้วย // MARKER_VATWATCHLISTOPS_EXPORT_STATUS_SYNC_V1
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

    const meta = { bu, com, company, book: String(companyRow.BOOK ?? companyRow.Book ?? companyRow.book ?? "").trim() || bu, /* MARKER_VATEXPORT_BOOK_UPPERCASE_COLUMN_V1 -- column ใน company_list ชื่อ BOOK (ตัวพิมพ์ใหญ่) เดิมอ่าน .book จึงได้ undefined แล้ว Fallback เป็น bu */ periodMmmYy, folderPath: buildFolderPath(segment3, periodMonthYear) }; // MARKER_VATEXPORT_FOLDERPATH_FOLLOW_PERIOD_V1 -- Folder Path (M3) ต้องตาม Period เดียวกับช่อง Period (M8) เช่น SEP-26 -> 0402\\2026.09 (เดิมใช้เดือนจากนาฬิกาเครื่อง ทำให้ได้ 2026.10 แล้ว Time/Save หาโฟลเดอร์ไม่เจอ)

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

    // MARKER_VATEXPORT_DELETE_USED_TAXINVOICE_V1 -- Tax Invoice (vat_backup_tax_invoice) ที่ถูกดึงไปใช้ใน Popvat ของ Batch นี้แล้ว (Generate File แล้ว) ลบทิ้ง Hard Delete (ทำหลังสร้างไฟล์สำเร็จแล้วเท่านั้น) | จับคู่ด้วย BU + เลข Tax Invoice
    try {
      const del = await pool.query(
        `DELETE FROM vat_backup_tax_invoice t
         USING vat_upload_popvatdraft p
         WHERE p.batch_id = $1
           AND t.bu = p.bu
           AND NULLIF(UPPER(TRIM(p.tax_invoice_number)), '') = UPPER(TRIM(t.tax_invoice_number))
           AND UPPER(TRIM(COALESCE(t.ofin, ''))) <> 'YES'`,
        [batchId]
      );
      if (del.rowCount > 0) console.log(`[vat-export] batch ${batchId}: hard deleted ${del.rowCount} used tax invoice rows`);
      // MARKER_VATEXPORT_DELETE_USED_TAXINVOICE_SIMPLE_V1 -- แถว OFIN = Yes ไปเข้า Simple: ลบหลัง Generate Simple สำเร็จ (จับคู่ BU + เลข Tax Invoice)
      const delSm = await pool.query(
        `DELETE FROM vat_backup_tax_invoice t
         USING vat_simpleinputdraft p
         WHERE p.batch_id = $1
           AND t.bu = p.bu
           AND UPPER(TRIM(COALESCE(t.ofin, ''))) = 'YES'
           AND UPPER(TRIM(COALESCE(t.tax_invoice_number, ''))) <> ''
           AND UPPER(TRIM(t.tax_invoice_number)) IN (
             NULLIF(UPPER(TRIM(p.tax_invoice_number)), ''),
             NULLIF(UPPER(TRIM(p.vendor_tax_invoice_number)), '')
           )`,
        [batchId]
      );
      if (delSm.rowCount > 0) console.log(`[vat-export] batch ${batchId}: hard deleted ${delSm.rowCount} OFIN tax invoice rows used by Simple`);
    } catch (e) {
      console.error("[vat-export] delete used tax invoice error:", e.message);
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

    const batchIds = Array.from(batchMap.keys()).filter(Boolean);
    if (batchIds.length > 0) { // MARKER_VATEXPORT_FINISH_PVBACKUP_V1
      const { rows: fin } = await pool.query(
        `SELECT batch_id, MIN(finished_at) AS finished_at, MIN(expire_at) AS expire_at, MIN(NULLIF(period, '')) AS period FROM ( /* MARKER_VATEXPORT_HISTORY_RETURN_PERIOD_V1 */
           SELECT batch_id, finished_at, expire_at, period FROM vat_upload_popvatdraft WHERE status = 'pv-backup' AND batch_id = ANY($1)
           UNION ALL SELECT batch_id, finished_at, expire_at, period FROM vat_simpleinputdraft WHERE status = 'sm-backup' AND batch_id = ANY($1)
           UNION ALL SELECT batch_id, finished_at, expire_at, period FROM vat_adi_transferdraft WHERE status = 'adi-backup' AND batch_id = ANY($1)
         ) t GROUP BY batch_id`,
        [batchIds]
      );
      fin.forEach((f) => {
        const bt = batchMap.get(f.batch_id);
        if (bt) { bt.status = 'pv-backup'; /* รวมทุกประเภท Backup: UI ใช้ซ่อนจากประวัติ Export */ bt.finishedAt = f.finished_at; bt.expireAt = f.expire_at; bt.period = f.period || null; }
      });
    }
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

// MARKER_VATEXPORT_BACKUP_LIST_V1
// ── GET /api/vat-export/backup?type=popvat|simple|adi — สรุปตาม Batch ของรายการ status='pv-backup' (หน้า Transaction Backup)
router.get("/backup", async (req, res) => {
  try {
    const type = String(req.query.type || "popvat");
    const tbl = { popvat: "vat_upload_popvatdraft", simple: "vat_simpleinputdraft", adi: "vat_adi_transferdraft" }[type];
    if (!tbl) return res.status(400).json({ error: "type ไม่ถูกต้อง" });
    // MARKER_VATEXPORT_BACKUP_SEARCH_TAXINV_V14 -- ?q= ค้นทุก Field (ค่าอย่างเดียว ไม่รวมชื่อ Column) ของรายการใน Backup เช่น Tax Invoice / Vendor Tax Invoice / Invoice / GRT / Supplier -> คืนเฉพาะ Batch ที่เจอ + match_count
    const q = String(req.query.q || "").trim();
    const params = [];
    let hitSel = "FALSE AS _hit";
    let having = "";
    if (q) {
      params.push(`%${q.replace(/[\\%_]/g, "\\$&")}%`);
      hitSel = `EXISTS (SELECT 1 FROM jsonb_each_text(to_jsonb(x) - 'id' - 'status' - 'draft_id' - 'created_at' - 'updated_at' - 'finished_at' - 'expire_at' - 'batch_id' - 'bu') e WHERE e.value ILIKE $1) AS _hit`;
      having = "HAVING COUNT(*) FILTER (WHERE _hit) > 0";
    }
    const { rows } = await pool.query(
      `SELECT bu, batch_id,
              COUNT(*) FILTER (WHERE _hit)::int AS match_count,
              MIN(NULLIF(period, '')) AS period,
              MIN(NULLIF(to_jsonb(t)->>'receive_date', '')) AS receive_from,
              MAX(NULLIF(to_jsonb(t)->>'receive_date', '')) AS receive_to,
              COUNT(DISTINCT COALESCE(NULLIF(to_jsonb(t)->>'invoice_ref', ''), id::text))::int AS count_inv,
              MIN(created_at) AS upload_at,
              MIN(finished_at) AS finished_at,
              MIN(expire_at) AS expire_at
       FROM (SELECT x.*, ${hitSel} FROM ${tbl} x WHERE x.status = '${BACKUP_STATUS[type]}' AND x.batch_id IS NOT NULL) t
       GROUP BY bu, batch_id
       ${having}
       ORDER BY MIN(finished_at) DESC NULLS LAST, batch_id DESC
       LIMIT 500`,
      params
    );
    const batchIds = rows.map((r) => r.batch_id);
    let filesByBatch = {};
    if (batchIds.length > 0) {
      const { rows: files } = await pool.query(
        `SELECT id, module, ref_id AS batch_id, file_name, downloaded_at FROM file_storage WHERE ref_id = ANY($1) ORDER BY id`,
        [batchIds]
      );
      files.forEach((f) => {
        (filesByBatch[f.batch_id] = filesByBatch[f.batch_id] || []).push({ id: f.id, module: f.module, fileName: f.file_name, downloadedAt: f.downloaded_at });
      });
    }
    res.json({ ok: true, type, batches: rows.map((r) => ({ ...r, files: filesByBatch[r.batch_id] || [] })) });
  } catch (err) {
    console.error("GET /vat-export/backup error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// MARKER_VATEXPORT_FINISH_PVBACKUP_V1
// ── POST /api/vat-export/batch/:batchId/finish — เปลี่ยนทั้ง Batch จาก 'exported' เป็น 'pv-backup' + กำหนดวันหมดอายุ = วันนี้ + 6 เดือน
router.post("/batch/:batchId/finish", async (req, res) => {
  const { batchId } = req.params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: files } = await client.query(`SELECT COUNT(*)::int AS total, COUNT(downloaded_at)::int AS downloaded FROM file_storage WHERE ref_id = $1`, [batchId]);
    // อายุเก็บ: Popvat 6 เดือน / Simple 6 เดือน / ADI 1 เดือน (นับจากวันกด Finish)
    const setsFor = (interval, st) => `status = '${st}', finished_at = NOW(), expire_at = NOW() + INTERVAL '${interval}'`;
    const results = await Promise.all([
      client.query(`UPDATE vat_upload_popvatdraft SET ${setsFor(PV_RETENTION.popvat, BACKUP_STATUS.popvat)} WHERE batch_id = $1 AND status = 'exported' RETURNING expire_at`, [batchId]),
      client.query(`UPDATE vat_simpleinputdraft SET ${setsFor(PV_RETENTION.simple, BACKUP_STATUS.simple)} WHERE batch_id = $1 AND status = 'exported' RETURNING expire_at`, [batchId]),
      client.query(`UPDATE vat_adi_transferdraft SET ${setsFor(PV_RETENTION.adi, BACKUP_STATUS.adi)} WHERE batch_id = $1 AND status = 'exported' RETURNING expire_at`, [batchId]),
    ]);
    const updated = results.reduce((n, r) => n + r.rowCount, 0);
    if (updated === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "ไม่พบรายการสถานะ exported ใน Batch นี้ (อาจ Finish ไปแล้ว)" });
    }
    const expireAt = results.map((r) => r.rows[0] && r.rows[0].expire_at).find(Boolean) || null;
    await client.query("COMMIT");
    broadcastVatExportUpdate("vat_export_updated", { batchId });
    res.json({ ok: true, updated, expireAt, files: files[0] });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (e) { /* ignore */ }
    console.error("POST /vat-export/batch/:batchId/finish error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

// MARKER_VATEXPORT_POPVAT_END_PROCESS_DIRECT_V1 -- Feature ใหม่แยกจาก Flow เดิมทั้งหมด (ไม่แก้ /generate /finish เดิม)
// ── POST /api/vat-export/popvat/end-process-direct -- ข้าม Generate/Download: รายการ Popvat ที่ติ๊กไว้ (status='draft' เท่านั้น)
//    ย้ายตรงเป็น 'pv-backup' + expire_at = +6 เดือน เหมือนผ่าน Finish ปกติ แต่ไม่มีไฟล์จริง (ไม่ผ่าน status='exported' เลย)
//    ใช้ Batch_id สมมติ (Label "DirectBackup" ให้ดูออกว่าข้าม Generate) เพื่อให้ยังโผล่ในหน้า Transaction Backup + Restore คืนเป็น Draft ได้ปกติ (ใช้ Endpoint Restore เดิมร่วมกันได้เลย เพราะ Restore ไม่ได้เช็คว่ามีไฟล์)
router.post("/popvat/end-process-direct", async (req, res) => {
  const { bu, ids } = req.body || {};
  if (!bu || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ข้อมูลไม่ครบ (ต้องมี bu และ ids อย่างน้อย 1 รายการ)" });
  }
  const idInts = ids.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0);
  if (idInts.length === 0) {
    return res.status(400).json({ error: "ids ไม่ถูกต้อง" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    // MARKER_VATEXPORT_DIRECTBACKUP_DAILY_V1 -- รวมเป็น 1 Batch ต่อ BU ต่อวัน (เดิมแยกตามนาที ทำให้ Transaction Backup มี Batch เยอะ)
    const batchId = `${bu}_DirectBackup_${yyyy}${mm}${dd}`;
    const upd = await client.query(
      `UPDATE vat_upload_popvatdraft
       SET batch_id = $1, status = '${BACKUP_STATUS.popvat}', finished_at = NOW(), expire_at = NOW() + INTERVAL '${PV_RETENTION.popvat}'
       WHERE id = ANY($2) AND bu = $3 AND status = 'draft'
       RETURNING id, expire_at`,
      [batchId, idInts, bu]
    );
    if (upd.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "ไม่พบรายการสถานะ draft ตรงกับที่เลือก (อาจถูก Export/End Process ไปแล้ว)" });
    }
    await client.query("COMMIT");
    broadcastVatExportUpdate("vat_export_updated", { batchId, buList: [bu] });
    const expireAt = upd.rows[0]?.expire_at || null;
    res.json({ ok: true, updated: upd.rowCount, skipped: idInts.length - upd.rowCount, batchId, expireAt });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (e) { /* ignore */ }
    console.error("POST /vat-export/popvat/end-process-direct error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
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
      client.query(`UPDATE vat_upload_popvatdraft SET batch_id = NULL, status = 'draft', finished_at = NULL, expire_at = NULL WHERE batch_id = $1`, [batchId]), // MARKER_VATWATCHLISTOPS_EXPORT_STATUS_SYNC_V1
      client.query(`UPDATE vat_simpleinputdraft SET batch_id = NULL, status = 'draft', finished_at = NULL, expire_at = NULL WHERE batch_id = $1`, [batchId]), // MARKER_VATWATCHLISTOPS_EXPORT_STATUS_SYNC_V1
      client.query(`UPDATE vat_adi_transferdraft SET batch_id = NULL, status = 'draft', finished_at = NULL, expire_at = NULL WHERE batch_id = $1`, [batchId]), // MARKER_VATWATCHLISTOPS_EXPORT_STATUS_SYNC_V1
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