// ieExport.js
// ────────────────────────────────────────────────────────────────────────
// MARKER_IEEXPORT_GENERATE_ENDPOINT_V1
// Generate ไฟล์ Simple (.xlsx) ของ IE จาก ie_simplevatdraft — ใช้ Pattern
// เดียวกับ vatExport.js/vatExportGenerators.js เป๊ะ (Confirm แล้วว่า IE
// Simple ทำงานเหมือน VAT Simple ทุกอย่าง ต่างกันแค่ชื่อตาราง/Column บางตัว)
//
// ต่างจาก vatExport.js ตรงที่:
//   - ไม่มี Popvat/ADI สำหรับ IE (มีแค่ Simple อย่างเดียว)
//   - ไม่มี batch_id Column บน ie_simplevatdraft — Endpoint นี้เลยรับ
//     simpleDraftIds (Array of ie_simplevatdraft.id) ตรงๆ จาก Frontend
//     แทน (Frontend มีอยู่แล้วจาก _simpleDraftId ที่เก็บไว้ในแต่ละ Invoice
//     Line ตอนกด Add — Pattern เดียวกับที่ใช้ทำ Tab Simple ทุกจุดก่อนหน้า)
//   - Group ด้วย invoice_type + type_sim (invoice_type ของ IE เทียบเท่า
//     invoice_ref ของ VAT — คนละชื่อ Column เพราะ invoice_ref ของ IE ถูก
//     ใช้เป็น Foreign-key อ้างอิง Invoice ต้นทางไปแล้วก่อนหน้านี้)
//   - Master Template ใช้ไฟล์เดียวกับ VAT (Master_Simple Template.xlsx)
//     -- Confirm แล้วว่าใช้ร่วมกันได้ ไม่ต้องมี Template แยกของ IE
//
// วิธี Mount เข้า app.js (ดู Pattern จริงจาก Select-String ที่ขอไปก่อนหน้า
// แล้วเพิ่มบรรทัดที่ตรงกันสำหรับไฟล์นี้ — ตัวอย่างทั่วไป):
//   import ieExportRouter from "./routes/ieExport.js";
//   app.use("/api/ie-export", authLocal, ieExportRouter);
// ────────────────────────────────────────────────────────────────────────
import { Router } from "express";
import { pool, getUsernameByEmail } from "../db.js";
import zlib from "zlib";
import fs from "fs";
import path from "path";
import http from "http";
import {
  periodToMmmYy,
  buildFolderPath,
  generateSimpleAdiWorkbook,
} from "./vatExportGenerators.js"; // MARKER_IEEXPORT_REUSE_VATEXPORTGENERATORS_V1 -- Pure Function ทั่วไป ไม่ผูกกับ VAT ใช้ร่วมกันได้ตรงๆ

// MARKER_IEEXPORT_REALTIME_BROADCAST_V1
function broadcastIeExportUpdate(event, data = {}) {
  const payload = JSON.stringify({ event, ...data });
  const req = http.request({
    hostname: "127.0.0.1",
    port: process.env.PORT || 4000,
    path: "/api/internal/broadcast",
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
  }, (res) => { res.on("data", () => {}); });
  req.on("error", (e) => console.error("broadcastIeExportUpdate error:", e.message));
  req.write(payload);
  req.end();
}

const router = Router();

// -- Master Template เดียวกับที่ VAT ใช้ (Confirm แล้ว) -- MARKER_IEEXPORT_TEMPLATE_PATH_V1
const TEMPLATE_DIR = "C:\\apps\\fastapn-backend\\src\\templates";
const SIMPLE_TEMPLATE_PATH = `${TEMPLATE_DIR}\\Master_Simple Template.xlsx`;

// -- Root โฟลเดอร์เก็บไฟล์ -- ใช้ STORAGE_ROOT เดียวกับ vatExport.js/fileStorage.js --
const STORAGE_ROOT = "C:\\apps\\fastapn-backend\\storage";

function sanitizeForFilename(str) {
  return String(str).replace(/[\\/:*?"<>|]/g, "_");
}

// -- Module ที่ใช้แยกประเภทไฟล์ใน file_storage -- MARKER_IEEXPORT_MODULE_TAG_V1
const MODULE_IE_SIMPLE = "ie-simple";

// -- เก็บไฟล์ (Gzip) ลง Disk + Insert file_storage Record -- คืน { id, fileName } --
// (Copy Pattern เดียวกับ vatExport.js -- ตั้งใจไม่ Refactor รวมกันตอนนี้ กัน
// กระทบ VAT ที่ทำงานอยู่แล้ว)
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
     VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)
     RETURNING id, created_at`,
    [module, bu, batchId, filePath, fileName, username, null]
  );
  return { id: rows[0].id, fileName, createdAt: rows[0].created_at };
}

// MARKER_IEEXPORT_GENERATE_ENDPOINT_V1
// Body: { bu, batchName, simpleDraftIds: [...] } -- simpleDraftIds คือ Array
// ของ ie_simplevatdraft.id ที่ Frontend เก็บไว้แล้ว (_simpleDraftId ต่อ Line)
router.post("/generate", async (req, res) => {
  const username = await getUsernameByEmail(req.user.email);
  const { bu, batchName, simpleDraftIds, batchCategory } = req.body || {}; // MARKER_IEEXPORT_META_BOOK_FUNCTION_PERIOD_V1 -- batchCategory (PTC/STA) ใช้เป็น Function ใน Header

  if (!bu || !Array.isArray(simpleDraftIds) || simpleDraftIds.length === 0) {
    return res.status(400).json({ error: "ข้อมูลไม่ครบ (ต้องมี bu และ simpleDraftIds อย่างน้อย 1 รายการ)" });
  }

  try {
    const { rows: simpleRows } = await pool.query(
      `SELECT * FROM ie_simplevatdraft WHERE id = ANY($1) ORDER BY id`,
      [simpleDraftIds]
    );

    if (simpleRows.length === 0) {
      return res.status(404).json({ error: "ไม่พบข้อมูล Simple ตาม simpleDraftIds ที่ส่งมา" });
    }

    // -- Group ตาม invoice_type + type_sim (คนละ Sheet ต่อกลุ่ม เหมือน Pattern ของ VAT) --
    // MARKER_IEEXPORT_INVOICE_REF_GROUPING_V1 -- เปลี่ยนจาก invoice_type (ตอนนี้เก็บ Channel แล้ว ไม่ใช่
    // Invoice/Credit อีกต่อไป) มาใช้ invoice_ref แทน (Column ที่เก็บ "Invoice"/"Credit" จริงตั้งแต่แรก)
    const groupsMap = new Map();
    simpleRows.forEach((r) => {
      const key = `${r.invoice_ref || "Invoice"}_${r.type_sim || "NNN"}`;
      if (!groupsMap.has(key)) {
        groupsMap.set(key, { key, invoiceRef: r.invoice_ref || "", typeSim: r.type_sim || "", invoiceType: r.invoice_ref || "Invoice", rows: [] });
      }
      groupsMap.get(key).rows.push(r);
    });
    const groupedRows = Array.from(groupsMap.values());

    // -- Meta: Company/Period/Folder Path -- ใช้ company_list เดียวกับ VAT (Pattern เดียวกัน) --
    const companyRes = await pool.query(`SELECT * FROM company_list WHERE bu = $1 LIMIT 1`, [bu]);
    const companyRow = companyRes.rows[0] || {};
    const companyCodeParts = String(companyRow["COMPANY CODE"] || "").split("-").map((s) => s.trim()).filter(Boolean);
    const com = companyCodeParts[2] || "";
    const companyNameFromCompanyList = companyRow["Simple Company"] || companyRow["Company (Report Display)"] || "";
    let company = com && companyNameFromCompanyList ? `${com}-${companyNameFromCompanyList}` : companyNameFromCompanyList;
    if (!company) {
      const branchRes = await pool.query(`SELECT "Simple Company" FROM branch_list WHERE bu = $1 LIMIT 1`, [bu]);
      company = branchRes.rows[0]?.["Simple Company"] || "";
    }
    const segment3 = companyRow["SEGMENT3"] || "";

    const nowForFolderPath = new Date();
    const currentPeriodMonthYear = `${String(nowForFolderPath.getMonth() + 1).padStart(2, "0")}-${nowForFolderPath.getFullYear()}`;
    // MARKER_IEEXPORT_META_BOOK_FUNCTION_PERIOD_V1 -- เดิมใช้ ie_simplevatdraft.period (Format "YYYY-MM"
    // จาก getCurrentMonthStr ฝั่ง Frontend) เข้า periodToMmmYy() ที่ Parse แบบ "MM-YYYY" -- Format ไม่ตรง
    // ทำให้ได้ค่าว่างเปล่าเสมอ (ยืนยัน Bug แล้ว) เปลี่ยนมาคำนวณจาก receive_date ของแถวแรกแทน
    // (Date Column จริง เชื่อถือได้กว่า -- Pattern เดียวกับ Frontend Preview)
    const sampleReceiveDate = simpleRows[0]?.receive_date;
    let periodMonthYear = currentPeriodMonthYear;
    if (sampleReceiveDate) {
      const d = new Date(sampleReceiveDate);
      if (!isNaN(d.getTime())) {
        periodMonthYear = `${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
      }
    }
    const periodMmmYy = periodToMmmYy(periodMonthYear);

    const nowForFilename = new Date();
    const hhmm = `${String(nowForFilename.getHours()).padStart(2, "0")}${String(nowForFilename.getMinutes()).padStart(2, "0")}`;
    const yy = String(nowForFilename.getFullYear()).slice(-2);
    const mmNow = String(nowForFilename.getMonth() + 1).padStart(2, "0");
    const ddNow = String(nowForFilename.getDate()).padStart(2, "0");
    const simpleFilenameSuffix = `${yy}${mmNow}${ddNow}_${hhmm}`;

    // MARKER_IEEXPORT_META_BOOK_FUNCTION_PERIOD_V1 -- book จาก company_list (Query เดียวกับที่ดึง company มาแล้ว
    // ไม่ต้อง Query เพิ่ม) ใช้เป็น Prefix ชื่อไฟล์ (Cell C1) แทน bu ตรงๆ -- ตรงกับที่ Frontend Preview ใช้
    const book = companyRow["Book"] || companyRow["BOOK"] || "";
    const meta = { bu, com, company, book, functionCode: batchCategory || "", periodMmmYy, folderPath: buildFolderPath(segment3, currentPeriodMonthYear), hhmm };

    const buf = await generateSimpleAdiWorkbook(SIMPLE_TEMPLATE_PATH, groupedRows, null, [], meta); // MARKER_IEEXPORT_NO_ADI_V1 -- IE ไม่มี ADI ส่ง [] เสมอ

    const nowForBatchId = new Date();
    const yyyy = nowForBatchId.getFullYear();
    const mm2 = String(nowForBatchId.getMonth() + 1).padStart(2, "0");
    const dd2 = String(nowForBatchId.getDate()).padStart(2, "0");
    const hh2 = String(nowForBatchId.getHours()).padStart(2, "0");
    const min2 = String(nowForBatchId.getMinutes()).padStart(2, "0");
    const batchId = batchName || `${bu}_IeSimple_${yyyy}${mm2}${dd2}_${hh2}${min2}`;

    const fileName = `${bu}_Simple_${simpleFilenameSuffix}.xlsx`;
    const stored = await storeGeneratedFile(MODULE_IE_SIMPLE, bu, batchId, fileName, buf, username);

    broadcastIeExportUpdate("ie_export_updated", { bu });

    res.json({ ok: true, batchId, bu, file: { module: MODULE_IE_SIMPLE, ...stored } });
  } catch (err) {
    console.error("POST /ie-export/generate error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// MARKER_IEEXPORT_HISTORY_ENDPOINT_V1 -- ให้หน้า Invoice History ดึงไฟล์ Simple ของ IE มาโชว์/ดาวน์โหลด
router.get("/history", async (req, res) => {
  try {
    const { bu } = req.query;
    const params = [MODULE_IE_SIMPLE];
    let whereClause = `WHERE module = $1`;
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

    res.json({ ok: true, files: rows });
  } catch (err) {
    console.error("GET /ie-export/history error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// MARKER_IEEXPORT_DOWNLOAD_ENDPOINT_V1
router.get("/file/:id/download", async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(`SELECT * FROM file_storage WHERE id = $1 AND module = $2`, [id, MODULE_IE_SIMPLE]);
    const record = rows[0];
    if (!record) return res.status(404).json({ error: "ไม่พบไฟล์นี้" });
    if (!fs.existsSync(record.file_path)) {
      return res.status(404).json({ error: "ไม่พบไฟล์จริงบน Server (อาจถูกลบไปแล้ว)" });
    }

    const gzBuffer = fs.readFileSync(record.file_path);
    const fileBuffer = zlib.gunzipSync(gzBuffer);

    await pool.query(`UPDATE file_storage SET downloaded_at = NOW() WHERE id = $1`, [id]);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${record.file_name}"`);
    res.send(fileBuffer);
  } catch (err) {
    console.error("GET /ie-export/file/:id/download error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
