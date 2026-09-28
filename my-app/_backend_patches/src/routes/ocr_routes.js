/**
 * ocr_routes.js
 * ================================================================
 * OCR API Routes สำหรับ FastAPN Backend
 * เชื่อมกับ Database Schema (ocr_sets, ocr_queue_pages, vendor_patterns,
 * ocr_extracted_fields, ocr_validation_flags) และ ocr_worker.py ที่รันแยก
 * บน Server (poll queue เอง — routes นี้แค่ insert/read เท่านั้น)
 *
 * วิธีติดตั้งเข้า FastAPN backend:
 *   1. วางไฟล์นี้ที่ C:\apps\fastapn-backend\src\routes\ocr_routes.js
 *   2. ใน app.js เพิ่ม:
 *        const ocrRoutes = require('./routes/ocr_routes');
 *        app.use('/api/ocr', ocrRoutes);
 *   3. ต้องมี package 'multer' สำหรับรับไฟล์ upload (npm install multer)
 * ================================================================
 */

import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { pool } from '../db.js';

const router = express.Router();

// ----------------------------------------------------------------
// Config — ปรับ path ให้ตรงกับ environment จริงของ Server
// ----------------------------------------------------------------
const PYTHON_EXE = 'C:\\apps\\python-ocr-runtime\\python-3.13.12-embed-amd64\\python.exe';
const PDF_SPLIT_SCRIPT = 'C:\\apps\\fastapn-backend\\ocr_worker\\pdf_split_helper.py';
const UPLOAD_ROOT = 'C:\\apps\\fastapn-backend\\ocr_uploads';
const OCR_DPI = 150;

const upload = multer({
    dest: path.join(UPLOAD_ROOT, 'tmp'),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB — รองรับ PDF หลายสิบหน้า
});

if (!fs.existsSync(UPLOAD_ROOT)) fs.mkdirSync(UPLOAD_ROOT, { recursive: true });


// ----------------------------------------------------------------
// Helper: เรียก pdf_split_helper.py แบบ Promise
// ----------------------------------------------------------------
function splitPdf(pdfPath, outputDir, dpi = OCR_DPI) {
    return new Promise((resolve, reject) => {
        const proc = spawn(PYTHON_EXE, [PDF_SPLIT_SCRIPT, pdfPath, outputDir, String(dpi)]);
        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.stderr.on('data', (d) => { stderr += d.toString(); });

        proc.on('close', (code) => {
            try {
                const result = JSON.parse(stdout.trim().split('\n').pop());
                if (result.success) {
                    resolve(result.pages);
                } else {
                    reject(new Error(result.error || 'unknown pdf split error'));
                }
            } catch (e) {
                reject(new Error(`failed to parse pdf split output: ${stderr || stdout}`));
            }
        });
    });
}


// ----------------------------------------------------------------
// POST /api/ocr/upload
// รับ PDF -> แยกเป็นหน้า (150 DPI) -> insert เข้า ocr_sets + ocr_queue_pages
// ตัว worker (ocr_worker.py) ที่รันแยกอยู่แล้วจะดึงไปประมวลผลเอง
// ----------------------------------------------------------------
router.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'missing file' });
    }
    if (!req.user || !req.user.id) {
        return res.status(401).json({ error: 'unauthorized' });
    }

    const client = await pool.connect();
    try {
        const batchId = randomUUID();
        const batchDir = path.join(UPLOAD_ROOT, batchId);
        fs.mkdirSync(batchDir, { recursive: true });

        const finalPdfPath = path.join(batchDir, req.file.originalname);
        fs.renameSync(req.file.path, finalPdfPath);

        // แยก PDF เป็นภาพทีละหน้า (เรียก Python helper)
        const pagePaths = await splitPdf(finalPdfPath, batchDir, OCR_DPI);

        await client.query('BEGIN');

        await client.query(
            `INSERT INTO ocr_upload_batches (id, uploaded_by, source_file_name, total_pages)
             VALUES ($1, $2, $3, $4)`,
            [batchId, req.user.id, req.file.originalname, pagePaths.length]
        );

        const uploadedPages = [];
        for (let i = 0; i < pagePaths.length; i++) {
            // status = 'pending_grouping' — รอ Gemini/Fallback ตัดสินใจ Group ก่อน
            // ถึงจะเปลี่ยนเป็น 'pending' ให้ Worker หยิบไปทำ (ผ่าน /apply-groups
            // หรือ /skip-grouping)
            const insertResult = await client.query(
                `INSERT INTO ocr_queue_pages (batch_id, page_number, image_path, status)
                 VALUES ($1, $2, $3, 'pending_grouping')
                 RETURNING id`,
                [batchId, i + 1, pagePaths[i]]
            );
            uploadedPages.push({ pageId: insertResult.rows[0].id, pageNumber: i + 1 });
        }

        // MARKER_OCR_ROUTES_NOTIFY -- ปลุก ocr_worker (LISTEN ocr_new_job) ให้ตื่นทันที
        // แทนที่จะรอ Poll รอบถัดไป (จะถูกส่งจริงหลัง COMMIT สำเร็จเท่านั้น)
        await client.query("NOTIFY ocr_new_job");

        await client.query('COMMIT');

        res.json({ batchId, totalPages: pagePaths.length, status: 'pending_grouping', pages: uploadedPages });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[ocr/upload] error:', err);
        res.status(500).json({ error: 'upload failed', detail: err.message });
    } finally {
        client.release();
    }
});



// ----------------------------------------------------------------
// POST /api/ocr/apply-groups/:batchId
// รับผล Split & Merge จาก Gemini (Frontend เรียกหลังยิง Gemini สำเร็จ)
// สร้าง ocr_sets ใหม่ตาม Group ที่ Gemini ตัดสินใจ + ปลดล็อกหน้าให้
// Worker หยิบไปทำ (status -> 'pending')
// ----------------------------------------------------------------
router.post('/apply-groups/:batchId', async (req, res) => {
    const { batchId } = req.params;
    const { groups } = req.body || {};

    if (!Array.isArray(groups) || groups.length === 0) {
        return res.status(400).json({ error: 'groups is required and must be a non-empty array' });
    }

    // ---------------------------------------------------------------
    // Patch 89 -- Idempotency Guard กันเรียกซ้ำ/ชนกับ /skip-grouping
    // ถ้า batch นี้ถูก claim ไปแล้ว (จาก apply-groups หรือ skip-grouping
    // ก็ตาม) ให้ No-op ทันที ไม่สร้าง ocr_sets ซ้ำ (root cause ของบั๊ก
    // Set ซ้อน 2 ชุดจาก batch เดียวกัน)
    // ---------------------------------------------------------------
    const claimResult = await pool.query(
        `UPDATE ocr_upload_batches
         SET grouping_claimed_at = NOW()
         WHERE id = $1 AND grouping_claimed_at IS NULL
         RETURNING id`,
        [batchId]
    );
    if (claimResult.rowCount === 0) {
        console.warn(`[ocr/apply-groups] batch ${batchId} ถูก resolve grouping ไปแล้ว -- ข้าม (idempotent no-op)`);
        return res.json({ ok: true, groupsApplied: 0, groupsTotal: groups.length, skipped: 'already_claimed' });
    }

    const client = await pool.connect();
    let groupsApplied = 0;
    try {
        // ดึง uploaded_by ของ batch นี้ไว้ครั้งเดียวก่อน loop -- ทุกกลุ่มเป็น
        // ของ batch เดียวกัน ค่านี้เหมือนกันหมด ไม่ต้อง query ซ้ำทุกกลุ่ม
        // (เดิม INSERT ไม่ได้ใส่ uploaded_by เลย เหมือนบั๊กที่เจอใน
        // local_group_and_release_batch ฝั่ง Python -- ใส่ไว้กันเหนียว
        // แม้ Gemini path นี้จะไม่เคย error ก็ตาม เพราะ column นี้เป็น
        // NOT NULL การไม่ระบุค่าคือความเสี่ยงที่ไม่ควรปล่อยไว้)
        const batchInfoResult = await client.query(
            `SELECT uploaded_by FROM ocr_upload_batches WHERE id = $1`,
            [batchId]
        );
        const uploadedBy = batchInfoResult.rows[0]?.uploaded_by || null;

        for (const group of groups) {
            const pageNumbers = Array.isArray(group.pages) ? group.pages.map(Number).filter(Number.isInteger) : [];
            if (pageNumbers.length === 0) continue;

            const setId = randomUUID();
            const expectedLineCount = Number.isInteger(group.lineItemCount) ? group.lineItemCount : null;

            // BEGIN/COMMIT ทีละกลุ่ม (ไม่ใช่ทั้ง batch เป็น transaction เดียว)
            // เพื่อให้ชุดที่เพิ่ง apply เสร็จ โผล่ในหน้า Job Queue ได้ทันที
            // ไม่ต้องรอให้ Gemini ตัดสินกลุ่มครบทุกกลุ่มก่อนถึงจะเห็นอะไรเลย
            // (แลกกับ atomicity ระดับ batch แต่ยังคง atomic ระดับกลุ่มอยู่ —
            // ถ้ากลุ่มไหน insert พังกลางคัน กลุ่มนั้น rollback แค่กลุ่มเดียว
            // กลุ่มอื่นที่ apply ไปแล้วไม่โดนกระทบ)
            await client.query('BEGIN');
            try {
                // status='processing' เหมือน Pattern เดิมตอน Worker เปิด Set เอง
                // (open_new_set) — total_pages รู้ล่วงหน้าแล้วจาก Gemini
                await client.query(
                    `INSERT INTO ocr_sets (id, batch_id, uploaded_by, status, total_pages, expected_line_count, created_at)
                     VALUES ($1, $2, $3, 'processing', $4, $5, NOW())`,
                    [setId, batchId, uploadedBy, pageNumbers.length, expectedLineCount]
                );

                // บันทึกค่าที่ Gemini อ่านมาได้ทันที (Confidence สูง 0.98) — Field พวกนี้
                // จะ "ชนะ" PaddleOCR เสมอ เพราะ Worker Insert ทีหลังด้วย
                // ON CONFLICT DO NOTHING (ดู patch59) กันไม่ให้ทับค่าที่มีอยู่แล้ว
                const geminiFields = [
                    ['invoice_no', group.invoiceNo],
                    ['supplier_name', group.supplierName],
                    ['invoice_date', group.docDate],
                    ['buyer_tax_id', group.taxId],
                ];
                for (const [fieldName, value] of geminiFields) {
                    if (value === undefined || value === null || value === '') continue;
                    // Patch 90: Confidence-based แทน DO NOTHING — ให้สอดคล้องกับฝั่ง
                    // ocr_worker_v2.py (Python) ทั้งหมด กัน Field อื่นที่ Insert มาก่อน
                    // ด้วย Confidence ต่ำ (เช่น local_group_and_release_batch 0.6) บล็อก
                    // ค่าที่ถูกต้องกว่าจาก Gemini (0.98) ไม่ให้บันทึกทับ
                    await client.query(
                        `INSERT INTO ocr_extracted_fields (set_id, field_name, ocr_value, ocr_confidence)
                         VALUES ($1, $2, $3, 0.98)
                         ON CONFLICT (set_id, field_name) DO UPDATE SET
                             ocr_value = EXCLUDED.ocr_value, ocr_confidence = EXCLUDED.ocr_confidence
                         WHERE EXCLUDED.ocr_confidence > ocr_extracted_fields.ocr_confidence`,
                        [setId, fieldName, String(value)]
                    );
                }

                await client.query(
                    `UPDATE ocr_queue_pages
                     SET assigned_set_id = $1, status = 'pending'
                     WHERE batch_id = $2 AND page_number = ANY($3::int[])`,
                    [setId, batchId, pageNumbers]
                );

                await client.query('COMMIT');
                groupsApplied += 1;
            } catch (groupErr) {
                await client.query('ROLLBACK');
                console.error(`[ocr/apply-groups] กลุ่มพัง (pages=${pageNumbers.join(',')}):`, groupErr);
                // ไม่ throw ต่อ -- ให้กลุ่มอื่นทำงานต่อได้ ไม่ต้องพังทั้ง batch
                // เพราะกลุ่มเดียว
            }
        }

        res.json({ ok: true, groupsApplied, groupsTotal: groups.length });
    } catch (err) {
        console.error('[ocr/apply-groups] error:', err);
        res.status(500).json({ error: 'apply groups failed', detail: err.message });
    } finally {
        client.release();
    }
});


// ----------------------------------------------------------------
// POST /api/ocr/skip-grouping/:batchId
// Fallback: Gemini ใช้ไม่ได้ (Budget หมด/Error/ไม่มี Key/Timeout)
//
// เดิม: เปลี่ยน status ตรงเป็น 'pending' เลย -> หน้าเข้าคิว OCR เต็มรูปแบบ
// ทั้งไฟล์โดยไม่รู้จุดตัดเอกสารมาก่อน (Worker ต้องเดา Boundary "ระหว่าง"
// OCR แต่ละหน้า) ผิด Concept ที่ต้องการ: "รู้จุดตัดก่อนเข้าคิวเสมอ ไม่ว่า
// จะมี Gemini ใช้ได้หรือไม่ก็ตาม"
//
// ใหม่: เปลี่ยนเป็น 'local_grouping' แทน -> Worker
// (ocr_worker_v2.py, local_group_and_release_batch) จะ OCR เฉพาะแถบ
// หัวกระดาษของทุกหน้า (เร็ว ไม่ใช่ full OCR) หาจุดตัดก่อน สร้าง ocr_sets +
// assigned_set_id ให้ครบ แล้วค่อยเปลี่ยนเป็น 'pending' ให้เข้าคิว OCR เต็ม
// รูปแบบทีละ "เอกสารย่อย" เหมือน Flow ของ Gemini ทุกประการ
// ----------------------------------------------------------------
router.post('/skip-grouping/:batchId', async (req, res) => {
    const { batchId } = req.params;
    try {
        // ---------------------------------------------------------------
        // Patch 89 -- Idempotency Guard กันเรียกซ้ำ/ชนกับ /apply-groups
        // ---------------------------------------------------------------
        const claimResult = await pool.query(
            `UPDATE ocr_upload_batches
             SET grouping_claimed_at = NOW()
             WHERE id = $1 AND grouping_claimed_at IS NULL
             RETURNING id`,
            [batchId]
        );
        if (claimResult.rowCount === 0) {
            console.warn(`[ocr/skip-grouping] batch ${batchId} ถูก resolve grouping ไปแล้ว -- ข้าม (idempotent no-op)`);
            return res.json({ ok: true, pagesQueuedForLocalGrouping: 0, skipped: 'already_claimed' });
        }

        const result = await pool.query(
            `UPDATE ocr_queue_pages SET status = 'local_grouping'
             WHERE batch_id = $1 AND status = 'pending_grouping'`,
            [batchId]
        );
        res.json({ ok: true, pagesQueuedForLocalGrouping: result.rowCount });
    } catch (err) {
        console.error('[ocr/skip-grouping] error:', err);
        res.status(500).json({ error: 'skip grouping failed', detail: err.message });
    }
});


// ----------------------------------------------------------------
// GET /api/ocr/batch-status/:batchId
// เช็คว่า batch นี้แบ่งออกมากี่ชุดแล้ว ชุดไหน ready_for_review บ้าง
// (Frontend ใช้ตัวนี้แทน /status/:setId ตอนเพิ่ง upload มาใหม่)
// ----------------------------------------------------------------
router.get('/batch-status/:batchId', async (req, res) => {
    const { batchId } = req.params;
    try {
        const batchResult = await pool.query(
            `SELECT id, total_pages, current_open_set_id, created_at FROM ocr_upload_batches WHERE id = $1`,
            [batchId]
        );
        if (batchResult.rows.length === 0) {
            return res.status(404).json({ error: 'batch not found' });
        }

        const pagesResult = await pool.query(
            `SELECT COUNT(*) FILTER (WHERE status = 'done') AS done,
                    COUNT(*) FILTER (WHERE status = 'failed') AS failed,
                    COUNT(*) AS total
             FROM ocr_queue_pages WHERE batch_id = $1`,
            [batchId]
        );

        const setsResult = await pool.query(
            `SELECT
                s.id, s.status, s.total_pages, s.created_at, s.completed_at,
                f.invoice_no,
                COALESCE(f.supplier_name_matched, f.vendor_name_ocr) AS supplier_name,
                f.invoice_date,
                f.document_type,
                f.buyer_tax_id,
                cl.bu,
                f.all_confidences
             FROM ocr_sets s
             LEFT JOIN LATERAL (
                SELECT
                    MAX(ocr_value) FILTER (WHERE field_name = 'invoice_no') AS invoice_no,
                    -- supplier_name = Master Data Match (0.95) หรือ Gemini (0.98) — ให้ Priority สูงสุด
                    MAX(ocr_value) FILTER (WHERE field_name = 'supplier_name') AS supplier_name_matched,
                    -- vendor_name_ocr = อ่านจาก OCR Text ตรงๆ (0.7) — Fallback ถ้าไม่มีตัวบน
                    MAX(ocr_value) FILTER (WHERE field_name = 'vendor_name_ocr') AS vendor_name_ocr,
                    MAX(ocr_value) FILTER (WHERE field_name = 'invoice_date') AS invoice_date,
                    MAX(ocr_value) FILTER (WHERE field_name = 'document_type') AS document_type,
                    MAX(ocr_value) FILTER (WHERE field_name = 'buyer_tax_id') AS buyer_tax_id,
                    array_agg(ocr_confidence) FILTER (WHERE ocr_confidence IS NOT NULL) AS all_confidences
                FROM ocr_extracted_fields
                WHERE set_id = s.id
             ) f ON true
             LEFT JOIN company_list cl ON cl."TAX ID" = f.buyer_tax_id AND cl.deleted = false
             WHERE s.batch_id = $1
             ORDER BY s.created_at ASC`,
            [batchId]
        );

        // ---------------- คำนวณ Confidence ต่อชุด ----------------
        // >= 20 ค่า -> เฉลี่ย 10 ค่าสูงสุด + 10 ค่าต่ำสุด
        // < 20 ค่า  -> เฉลี่ยทุกค่าที่มี
        const calcConfidence = (confidences) => {
            if (!confidences || confidences.length === 0) return null;
            const nums = confidences.map(Number).filter((n) => !Number.isNaN(n));
            if (nums.length === 0) return null;
            let avg;
            if (nums.length >= 20) {
                const sorted = [...nums].sort((a, b) => a - b);
                const combined = [...sorted.slice(0, 10), ...sorted.slice(-10)];
                avg = combined.reduce((sum, n) => sum + n, 0) / combined.length;
            } else {
                avg = nums.reduce((sum, n) => sum + n, 0) / nums.length;
            }
            // ocr_confidence อาจเก็บเป็นสัดส่วน 0-1 หรือเปอร์เซ็นต์ 0-100 -> Normalize ให้เป็น % เสมอ
            return Math.round(avg <= 1 ? avg * 100 : avg);
        };

        const setsWithConfidence = setsResult.rows.map((row) => {
            const { all_confidences, ...rest } = row;
            return {
                ...rest,
                confidence: calcConfidence(all_confidences),
            };
        });

        res.json({
            batch: batchResult.rows[0],
            pageProgress: pagesResult.rows[0],
            sets: setsWithConfidence,
        });
    } catch (err) {
        console.error('[ocr/batch-status] error:', err);
        res.status(500).json({ error: 'batch status check failed' });
    }
});


// ----------------------------------------------------------------
// GET /api/ocr/page-image/:pageId
// Serve รูปภาพของหน้านั้นๆ ให้ Frontend แสดง (สำหรับดูคู่กับผล OCR)
// ----------------------------------------------------------------
router.get('/page-image/:pageId', async (req, res) => {
    const { pageId } = req.params;
    try {
        const result = await pool.query(
            `SELECT image_path FROM ocr_queue_pages WHERE id = $1`,
            [pageId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'page not found' });
        }

        const imagePath = result.rows[0].image_path;
        const resolvedPath = path.resolve(imagePath);
        const resolvedUploadRoot = path.resolve(UPLOAD_ROOT);

        // ป้องกัน Path Traversal — ต้องอยู่ใน UPLOAD_ROOT เท่านั้น
        if (!resolvedPath.startsWith(resolvedUploadRoot)) {
            return res.status(403).json({ error: 'forbidden' });
        }
        if (!fs.existsSync(resolvedPath)) {
            return res.status(404).json({ error: 'image file not found' });
        }

        res.setHeader('Content-Type', 'image/png');
        res.sendFile(resolvedPath);
    } catch (err) {
        console.error('[ocr/page-image] error:', err);
        res.status(500).json({ error: 'fetch image failed' });
    }
});


// ----------------------------------------------------------------
// POST /api/ocr/match-supplier
// รับ Tax ID ทั้งหมดที่ OCR เจอในเอกสาร -> กรอง Tax ID ของเราออก (company_list)
// -> Match ตัวที่เหลือกับ supplier_list เพื่อหา Vendor (ผู้ขาย) ตัวจริง
// Body: { taxIds: ["0105564100220", "0105561000123"], vendorNameHint: "ECOLAB" }
// ----------------------------------------------------------------
router.post('/match-supplier', async (req, res) => {
    const { taxIds = [], vendorNameHint = "" } = req.body;

    if (!req.user || !req.user.id) {
        return res.status(401).json({ error: 'unauthorized' });
    }
    if (taxIds.length === 0) {
        return res.json({ matched: false, reason: 'no_tax_id_found' });
    }

    try {
        // 1. เช็คว่า Tax ID ไหนเป็นของบริษัทเรา (ผู้ซื้อ) -> ตัดออก
        const ownCompanyResult = await pool.query(
            `SELECT "TAX ID" FROM company_list WHERE "TAX ID" = ANY($1) AND deleted = false`,
            [taxIds]
        );
        const ownTaxIds = new Set(ownCompanyResult.rows.map(r => r["TAX ID"]));
        const vendorTaxIds = taxIds.filter(t => !ownTaxIds.has(t));

        if (vendorTaxIds.length === 0) {
            return res.json({ matched: false, reason: 'only_own_company_found', ownTaxIds: [...ownTaxIds] });
        }

        // 2. Match Tax ID ที่เหลือ (ผู้ขาย) กับ supplier_list — Tax ID ตรงเป๊ะก่อน
        const exactMatch = await pool.query(
            `SELECT id, "Supplier Name", tax_id FROM supplier_list
             WHERE tax_id = ANY($1) AND deleted = false LIMIT 1`,
            [vendorTaxIds]
        );

        if (exactMatch.rows.length > 0) {
            return res.json({
                matched: true,
                matchType: 'tax_id_exact',
                supplierId: exactMatch.rows[0].id,
                supplierName: exactMatch.rows[0]["Supplier Name"],
                excludedOwnTaxIds: [...ownTaxIds],
            });
        }

        // 3. ถ้า Tax ID ไม่ตรงเป๊ะเลย ลอง Fuzzy Match จากชื่อ (ต้องมี pg_trgm extension)
        if (vendorNameHint) {
            const fuzzyMatch = await pool.query(
                `SELECT id, "Supplier Name", similarity("Supplier Name", $1) AS score
                 FROM supplier_list
                 WHERE deleted = false AND similarity("Supplier Name", $1) > 0.3
                 ORDER BY score DESC LIMIT 1`,
                [vendorNameHint]
            );
            if (fuzzyMatch.rows.length > 0) {
                return res.json({
                    matched: true,
                    matchType: 'name_fuzzy',
                    supplierId: fuzzyMatch.rows[0].id,
                    supplierName: fuzzyMatch.rows[0]["Supplier Name"],
                    confidence: fuzzyMatch.rows[0].score,
                    excludedOwnTaxIds: [...ownTaxIds],
                });
            }
        }

        // 4. ไม่เจอเลย -> ต้องให้พนักงานเลือกเอง (Vendor ใหม่)
        return res.json({
            matched: false,
            reason: 'no_supplier_found',
            vendorTaxIdsFound: vendorTaxIds,
            excludedOwnTaxIds: [...ownTaxIds],
        });
    } catch (err) {
        console.error('[ocr/match-supplier] error:', err);
        res.status(500).json({ error: 'match supplier failed', detail: err.message });
    }
});


// ----------------------------------------------------------------
// GET /api/ocr/batches
// รายการ Batch ทั้งหมดที่ User นี้เคย Upload พร้อมสถานะโดยรวม
// ใช้สำหรับหน้า Monitor/History — ให้ User กลับมาดูงานที่เคย Upload ไปได้
// แม้จะปิดหน้าเว็บไปแล้วก็ตาม
// ----------------------------------------------------------------
router.get('/batches', async (req, res) => {
    if (!req.user || !req.user.id) {
        return res.status(401).json({ error: 'unauthorized' });
    }
    // scope=all -> เห็น Batch ของทุก User (เฉพาะ Owner เท่านั้น กันข้อมูลคนอื่นหลุด)
    const wantsAllScope = req.query.scope === 'all';
    const isOwner = String(req.user?.appRole || '').toLowerCase() === 'owner';
    const useAllScope = wantsAllScope && isOwner;
    try {
        const result = await pool.query(
            `SELECT
                b.id AS batch_id,
                b.source_file_name,
                b.total_pages,
                b.created_at,
                COALESCE(ur.username, ur.email, 'ไม่ทราบผู้อัพโหลด') AS uploaded_by_name,
                COALESCE(pg.pages_done, 0) AS pages_done,
                COALESCE(pg.pages_failed, 0) AS pages_failed,
                COALESCE(pg.pages_total, 0) AS pages_total_current,
                COALESCE(st.sets_total, 0) AS sets_total,
                COALESCE(st.sets_ready, 0) AS sets_ready,
                COALESCE(st.sets_approved, 0) AS sets_approved
             FROM ocr_upload_batches b
             LEFT JOIN user_roles ur ON ur.id = b.uploaded_by
             LEFT JOIN (
                 SELECT batch_id,
                        COUNT(*) AS pages_total,
                        COUNT(*) FILTER (WHERE status = 'done') AS pages_done,
                        COUNT(*) FILTER (WHERE status = 'failed') AS pages_failed
                 FROM ocr_queue_pages
                 GROUP BY batch_id
             ) pg ON pg.batch_id = b.id
             LEFT JOIN (
                 SELECT batch_id,
                        COUNT(*) AS sets_total,
                        COUNT(*) FILTER (WHERE status = 'ready_for_review') AS sets_ready,
                        COUNT(*) FILTER (WHERE status = 'approved') AS sets_approved
                 FROM ocr_sets
                 GROUP BY batch_id
             ) st ON st.batch_id = b.id
             WHERE ${useAllScope ? 'TRUE' : 'b.uploaded_by = $1'}
             ORDER BY b.created_at DESC
             LIMIT 50`,
            useAllScope ? [] : [req.user.id]
        );
        res.json({ batches: result.rows, scope: useAllScope ? 'all' : 'mine' });
    } catch (err) {
        console.error('[ocr/batches] error:', err);
        res.status(500).json({ error: 'fetch batches failed' });
    }
});


// ----------------------------------------------------------------
// GET /api/ocr/status/:setId
// ให้ Frontend polling เช็คความคืบหน้า
// ----------------------------------------------------------------
router.get('/status/:setId', async (req, res) => {
    const { setId } = req.params;
    try {
        const setResult = await pool.query(
            `SELECT id, status, total_pages, created_at, completed_at FROM ocr_sets WHERE id = $1`,
            [setId]
        );
        if (setResult.rows.length === 0) {
            return res.status(404).json({ error: 'set not found' });
        }

        const pagesResult = await pool.query(
            `SELECT page_number, status, avg_confidence, elapsed_seconds FROM ocr_queue_pages
             WHERE set_id = $1 ORDER BY page_number`,
            [setId]
        );

        res.json({
            set: setResult.rows[0],
            pages: pagesResult.rows,
        });
    } catch (err) {
        console.error('[ocr/status] error:', err);
        res.status(500).json({ error: 'status check failed' });
    }
});


// ----------------------------------------------------------------
// GET /api/ocr/result/:setId
// ดึงผลลัพธ์ OCR + pre-fill ที่ Pattern Engine จับคู่ได้ (field mapping แบบพื้นฐาน)
// สำหรับหน้า Approve
// ----------------------------------------------------------------
router.get('/result/:setId', async (req, res) => {
    const { setId } = req.params;
    try {
        const setResult = await pool.query(
            `SELECT s.*, sup."Supplier Name" AS supplier_name
             FROM ocr_sets s
             LEFT JOIN supplier_list sup ON sup.id = s.supplier_id
             WHERE s.id = $1`,
            [setId]
        );
        if (setResult.rows.length === 0) {
            return res.status(404).json({ error: 'set not found' });
        }

        const pagesResult = await pool.query(
            `SELECT id, page_number, image_path, raw_ocr_result, avg_confidence, status
             FROM ocr_queue_pages WHERE set_id = $1 ORDER BY page_number`,
            [setId]
        );

        const fieldsResult = await pool.query(
            `SELECT field_name, ocr_value, ocr_confidence, final_value, was_modified
             FROM ocr_extracted_fields WHERE set_id = $1`,
            [setId]
        );

        const flagsResult = await pool.query(
            `SELECT flag_type, flag_detail, severity FROM ocr_validation_flags WHERE set_id = $1`,
            [setId]
        );

        res.json({
            set: setResult.rows[0],
            pages: pagesResult.rows,
            fields: fieldsResult.rows,
            flags: flagsResult.rows,
        });
    } catch (err) {
        console.error('[ocr/result] error:', err);
        res.status(500).json({ error: 'fetch result failed' });
    }
});


// ----------------------------------------------------------------
// POST /api/ocr/approve/:setId
// พนักงาน Approve -> บันทึกค่าสุดท้าย -> ตัดสินใจ save/update pattern
// ตาม logic ที่ตกลงกันไว้: ไม่มีการแก้ไข = ไม่ save pattern ซ้ำ
// ----------------------------------------------------------------
// ----------------------------------------------------------------
// เรียนรู้ Keyword จากค่าที่พนักงานยืนยันถูกต้อง (Reverse-Lookup)
// หาว่าค่านั้น (เช่น "9,630.00") อยู่ใกล้ข้อความไหนในเอกสาร (ในระยะ Y ใกล้เคียง)
// คืนค่าเป็น Array ของข้อความใกล้เคียง (ตัวเลือก Keyword ที่น่าจะเกี่ยวข้อง)
// ไม่เก็บตัวมูลค่าเอง — เก็บแค่ Keyword ข้อความรอบข้างเท่านั้น
// ----------------------------------------------------------------
function learnKeywordsForValue(rawItems, correctedValue, yTolerance = 20) {
    const normalizedTarget = String(correctedValue).replace(/,/g, '').trim().toLowerCase();
    if (!normalizedTarget) return [];

    const matchItem = rawItems.find(item => {
        const text = (item.text || '').replace(/,/g, '').toLowerCase();
        return text.includes(normalizedTarget);
    });
    if (!matchItem) return [];

    const targetY = matchItem.y_center || 0;
    const nearbyLabels = [];
    for (const item of rawItems) {
        if (item === matchItem) continue;
        const dy = Math.abs((item.y_center || 0) - targetY);
        if (dy <= yTolerance) {
            const text = (item.text || '').trim().toLowerCase();
            // กรองข้อความที่ไม่ใช่ตัวเลขล้วน (ตัวเลขไม่ใช่ Keyword ที่มีประโยชน์)
            if (text && !/^[\d.,\s]+$/.test(text)) {
                nearbyLabels.push(text);
            }
        }
    }
    return nearbyLabels;
}


router.post('/approve/:setId', async (req, res) => {
    const { setId } = req.params;
    const { supplierId, invoiceNo, fields, confirmDuplicate } = req.body;
    // fields = [{ fieldName, ocrValue, finalValue }, ...]
    // confirmDuplicate = true เมื่อพนักงานยืนยันแล้วว่าต้องการ Approve ทั้งที่ซ้ำ

    if (!req.user || !req.user.id) {
        return res.status(401).json({ error: 'unauthorized' });
    }

    const client = await pool.connect();
    try {
        // ---------------- เช็ค Duplicate Invoice ก่อน (Safety Check) ----------------
        let duplicateFound = null;
        if (supplierId && invoiceNo) {
            const dupCheck = await client.query(
                `SELECT id, approved_at FROM ocr_sets
                 WHERE supplier_id = $1 AND invoice_no = $2 AND status = 'approved' AND id != $3`,
                [supplierId, invoiceNo, setId]
            );
            if (dupCheck.rows.length > 0) {
                duplicateFound = dupCheck.rows[0];
                if (!confirmDuplicate) {
                    client.release();
                    return res.status(409).json({
                        error: 'duplicate_invoice',
                        message: `Invoice No. "${invoiceNo}" ของ Supplier นี้เคย Approve ไปแล้วเมื่อ ${duplicateFound.approved_at}`,
                        existingSetId: duplicateFound.id,
                        requireConfirmation: true,
                    });
                }
            }
        }

        await client.query('BEGIN');

        let modifiedCount = 0;
        for (const f of fields) {
            const wasModified = f.ocrValue !== f.finalValue;
            if (wasModified) modifiedCount++;

            await client.query(
                `INSERT INTO ocr_extracted_fields (set_id, field_name, ocr_value, final_value, was_modified)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (set_id, field_name)
                 DO UPDATE SET final_value = $4, was_modified = $5`,
                [setId, f.fieldName, f.ocrValue, f.finalValue, wasModified]
            );
        }

        await client.query(
            `UPDATE ocr_sets
             SET status = 'approved', supplier_id = $1, invoice_no = $2,
                 approved_at = NOW(), approved_by = $3
             WHERE id = $4`,
            [supplierId, invoiceNo, req.user.id, setId]
        );

        // ---------------- เรียนรู้ Pattern จาก Field ที่พนักงานแก้ไข ----------------
        // หลักการ: ไม่เก็บ "มูลค่า" (เปลี่ยนทุกใบ) แต่เก็บ "Keyword" ที่อยู่ใกล้ค่านั้นในเอกสาร
        // (คงที่สำหรับ Vendor เดียวกันทุกใบ) เพื่อใช้แทน Default Keyword ในครั้งถัดไป
        if (modifiedCount > 0 && supplierId) {
            // ดึง Raw OCR ทุกหน้าของชุดนี้ มาใช้ Reverse-Lookup หา Keyword ใกล้ค่าที่ถูกต้อง
            const pagesResult = await client.query(
                `SELECT raw_ocr_result FROM ocr_queue_pages WHERE set_id = $1 AND raw_ocr_result IS NOT NULL`,
                [setId]
            );
            let allItems = [];
            for (const row of pagesResult.rows) {
                const raw = typeof row.raw_ocr_result === 'string'
                    ? JSON.parse(row.raw_ocr_result) : row.raw_ocr_result;
                allItems = allItems.concat(raw);
            }

            const fieldMapping = {};
            for (const f of fields) {
                const wasModified = f.ocrValue !== f.finalValue;
                if (!wasModified || !f.finalValue) continue;

                const keywords = learnKeywordsForValue(allItems, f.finalValue);
                if (keywords.length > 0) {
                    fieldMapping[f.fieldName] = { keywords, confidence: 'learned' };
                } else {
                    // หาไม่เจอใน OCR เลย (พนักงานพิมพ์เองทั้งหมด) -> ไม่มี Keyword ให้เรียนรู้
                    fieldMapping[f.fieldName] = { keywords: [], fallback: 'manual_entry_only' };
                }
            }

            const existing = await client.query(
                `SELECT id, sample_count FROM vendor_patterns WHERE supplier_id = $1 AND is_active = TRUE`,
                [supplierId]
            );

            if (Object.keys(fieldMapping).length > 0) {
                if (existing.rows.length > 0) {
                    await client.query(
                        `UPDATE vendor_patterns
                         SET field_mapping = field_mapping || $1::jsonb,
                             sample_count = sample_count + 1,
                             update_count = update_count + 1,
                             last_updated_reason = 'field_corrected',
                             updated_at = NOW()
                         WHERE id = $2`,
                        [JSON.stringify(fieldMapping), existing.rows[0].id]
                    );
                } else {
                    await client.query(
                        `INSERT INTO vendor_patterns (supplier_id, field_mapping, sample_count, update_count, last_updated_reason)
                         VALUES ($1, $2, 1, 1, 'initial_creation')`,
                        [supplierId, JSON.stringify(fieldMapping)]
                    );
                }
            }
        }
        // ถ้า modifiedCount === 0 -> Pre-fill ถูกต้องอยู่แล้ว ไม่ต้องเรียนรู้อะไรใหม่

        // ถ้ามีการ Approve ทั้งที่ซ้ำ (คนยืนยันแล้ว) -> บันทึกไว้เป็นหลักฐาน
        if (duplicateFound) {
            await client.query(
                `INSERT INTO ocr_validation_flags (set_id, flag_type, flag_detail, severity)
                 VALUES ($1, 'duplicate_invoice_no', $2, 'critical')`,
                [setId, JSON.stringify({ existingSetId: duplicateFound.id, approvedAt: duplicateFound.approved_at, overriddenBy: req.user.id })]
            );
        }

        await client.query('COMMIT');
        res.json({ setId, status: 'approved', patternUpdated: modifiedCount > 0, duplicateOverridden: !!duplicateFound });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[ocr/approve] error:', err);
        res.status(500).json({ error: 'approve failed', detail: err.message });
    } finally {
        client.release();
    }
});


// ----------------------------------------------------------------
// GET /api/ocr/queue-position/:setId
// บอกตำแหน่งคิว (ตามที่คุยไว้เรื่อง transparency ให้ user เห็นว่ารออีกกี่คิว)
// ----------------------------------------------------------------
router.get('/queue-position/:setId', async (req, res) => {
    const { setId } = req.params;
    try {
        const result = await pool.query(
            `SELECT COUNT(*) AS position
             FROM ocr_sets
             WHERE status = 'pending'
               AND created_at < (SELECT created_at FROM ocr_sets WHERE id = $1)`,
            [setId]
        );
        res.json({ queuePosition: parseInt(result.rows[0].position, 10) });
    } catch (err) {
        console.error('[ocr/queue-position] error:', err);
        res.status(500).json({ error: 'queue position check failed' });
    }
});



// ----------------------------------------------------------------
// DELETE /api/ocr/batch/:batchId
// ลบ Batch ทั้งหมด (Cascade) ออกจากคิว/ประวัติ — ใช้กับปุ่ม "ลบ" ใน
// Job Queue (BatchHistory) ไม่แตะ bucket_list เลย
// ----------------------------------------------------------------
router.delete('/batch/:batchId', async (req, res) => {
    const { batchId } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query(
            `DELETE FROM ocr_extracted_fields WHERE set_id IN (SELECT id FROM ocr_sets WHERE batch_id = $1)`,
            [batchId]
        );
        await client.query(
            `DELETE FROM ocr_validation_flags WHERE set_id IN (SELECT id FROM ocr_sets WHERE batch_id = $1)`,
            [batchId]
        );
        await client.query(`DELETE FROM ocr_queue_pages WHERE batch_id = $1`, [batchId]);
        await client.query(`DELETE FROM ocr_sets WHERE batch_id = $1`, [batchId]);
        const result = await client.query(`DELETE FROM ocr_upload_batches WHERE id = $1`, [batchId]);

        await client.query('COMMIT');
        res.json({ ok: true, deleted: result.rowCount > 0 });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[ocr/delete-batch] error:', err);
        res.status(500).json({ error: 'delete batch failed', detail: err.message });
    } finally {
        client.release();
    }
});



// ----------------------------------------------------------------
// GET /api/ocr/gemini/toggle-status
// เช็คว่าตอนนี้เปิด Gemini OCR อยู่ไหม (Manual Override)
// ----------------------------------------------------------------
router.get('/gemini/toggle-status', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT value FROM system_settings WHERE key = 'gemini_ocr_enabled'`
        );
        const enabled = result.rows[0] ? result.rows[0].value === 'true' : true;
        res.json({ enabled });
    } catch (err) {
        console.error('[ocr/gemini/toggle-status] error:', err);
        // Error -> Default ปลอดภัยไว้ก่อนว่า "เปิด" (ให้ระบบทำงานต่อได้ ไม่ Block)
        res.json({ enabled: true });
    }
});

// ----------------------------------------------------------------
// POST /api/ocr/gemini/toggle
// เปลี่ยนค่า Toggle เปิด/ปิด Gemini OCR
// ----------------------------------------------------------------
router.post('/gemini/toggle', async (req, res) => {
    const { enabled, updatedBy } = req.body || {};
    try {
        await pool.query(
            `INSERT INTO system_settings (key, value, updated_at, updated_by)
             VALUES ('gemini_ocr_enabled', $1, NOW(), $2)
             ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW(), updated_by = $2`,
            [String(!!enabled), updatedBy || null]
        );
        res.json({ ok: true, enabled: !!enabled });
    } catch (err) {
        console.error('[ocr/gemini/toggle] error:', err);
        res.status(500).json({ error: 'toggle failed', detail: err.message });
    }
});



// ----------------------------------------------------------------
// DELETE /api/ocr/set/:setId
// ลบทีละ "ชุดเอกสาร" (Set) เดียว — คนละจุดจาก DELETE /batch/:batchId
// (patch55) ที่ลบทั้ง Batch ไม่แตะ bucket_list เลย
// ----------------------------------------------------------------
router.delete('/set/:setId', async (req, res) => {
    const { setId } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query(`DELETE FROM ocr_extracted_fields WHERE set_id = $1`, [setId]);
        await client.query(`DELETE FROM ocr_validation_flags WHERE set_id = $1`, [setId]);
        await client.query(
            `DELETE FROM ocr_queue_pages WHERE set_id = $1 OR assigned_set_id = $1`,
            [setId]
        );
        const result = await client.query(`DELETE FROM ocr_sets WHERE id = $1`, [setId]);

        await client.query('COMMIT');
        res.json({ ok: true, deleted: result.rowCount > 0 });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[ocr/delete-set] error:', err);
        res.status(500).json({ error: 'delete set failed', detail: err.message });
    } finally {
        client.release();
    }
});



// ----------------------------------------------------------------
// GET /api/ocr/grouping-in-progress
// Batch ที่ยังอยู่ขั้นตอน "หาจุดตัดเอกสาร" (pending_grouping/local_grouping)
// -- ช่วงนี้ยังไม่มี ocr_sets เกิดขึ้นเลยสักแถว (/active-sets จะว่างเปล่า)
// ทั้งที่งานกำลังทำงานอยู่จริง ต้องมี Endpoint แยกให้ Job Queue โชว์สถานะ
// นี้ได้ด้วย ไม่งั้นผู้ใช้จะเห็นคิว "0" ทั้งที่เพิ่งอัพโหลด+กด Start
// Processing ไปหมาดๆ ซึ่งดูเหมือนไม่มีอะไรเกิดขึ้นเลย
// ----------------------------------------------------------------
router.get('/grouping-in-progress', async (req, res) => {
    if (!req.user || !req.user.id) {
        return res.status(401).json({ error: 'unauthorized' });
    }
    const wantsAllScope = req.query.scope === 'all';
    const isOwner = String(req.user?.appRole || '').toLowerCase() === 'owner';
    const useAllScope = wantsAllScope && isOwner;
    try {
        const result = await pool.query(
            `SELECT
                b.id AS batch_id,
                b.source_file_name,
                COALESCE(ur.username, ur.email, 'ไม่ทราบผู้อัพโหลด') AS uploaded_by_name,
                COUNT(*) AS pages_grouping
             FROM ocr_queue_pages p
             JOIN ocr_upload_batches b ON b.id = p.batch_id
             LEFT JOIN user_roles ur ON ur.id = b.uploaded_by
             WHERE p.status IN ('pending_grouping', 'local_grouping')
               AND (${useAllScope ? 'TRUE' : 'b.uploaded_by = $1'})
             GROUP BY b.id, b.source_file_name, ur.username, ur.email
             ORDER BY MIN(p.created_at) ASC`,
            useAllScope ? [] : [req.user.id]
        );
        res.json({ batches: result.rows });
    } catch (err) {
        console.error('[ocr/grouping-in-progress] error:', err);
        res.status(500).json({ error: 'fetch grouping-in-progress failed' });
    }
});


// ----------------------------------------------------------------
// GET /api/ocr/active-sets
// รายชุดเอกสาร (Set) ที่ยังทำงานไม่เสร็จ (status='processing') พร้อม
// % Progress — Job Queue Modal ใช้แสดงระดับ Set จริง (ไม่ใช่ระดับไฟล์)
// Set ไหนปิดแล้วจะหายไปจาก List นี้เองอัตโนมัติ
// ----------------------------------------------------------------
router.get('/active-sets', async (req, res) => {
    if (!req.user || !req.user.id) {
        return res.status(401).json({ error: 'unauthorized' });
    }
    // scope=all -> เห็นชุดของทุก User (เฉพาะ Owner) เหมือน pattern เดียวกับ /batches
    const wantsAllScope = req.query.scope === 'all';
    const isOwner = String(req.user?.appRole || '').toLowerCase() === 'owner';
    const useAllScope = wantsAllScope && isOwner;
    try {
        const result = await pool.query(
            `SELECT
                s.id AS set_id,
                s.batch_id,
                b.source_file_name,
                b.uploaded_by,
                COALESCE(ur.username, ur.email, 'ไม่ทราบผู้อัพโหลด') AS uploaded_by_name,
                s.total_pages,
                s.expected_line_count,
                s.progress_pct,
                s.priority,
                s.status,
                ef.ocr_value AS invoice_no,
                COALESCE(pg.pages_done, 0) AS pages_done,
                COALESCE(pg.pages_processing, 0) AS pages_processing,
                tp.page_ids,
                -- Patch 92: Hybrid Sync ระหว่าง Line-based (s.progress_pct) กับ
                -- Page-based (pages_done/total_pages) -- ใช้ GREATEST ให้ % ลื่นไหล
                -- ตามที่สูงกว่าเสมอ (กันตกต่ำผิดปกติ) แล้ว LEAST บังคับเพดาน 99.99
                -- ห้ามถึง 100% จนกว่า pages_done จะครบ total_pages จริงเท่านั้น
                CASE
                    WHEN COALESCE(pg.pages_done, 0) >= s.total_pages AND s.total_pages > 0
                        THEN 100
                    WHEN s.total_pages > 0 THEN
                        LEAST(
                            GREATEST(
                                COALESCE(s.progress_pct, 0),
                                ROUND((COALESCE(pg.pages_done, 0)::numeric / s.total_pages) * 100, 2)
                            ),
                            99.99
                        )
                    ELSE 0
                END AS display_progress_pct
             FROM ocr_sets s
             JOIN ocr_upload_batches b ON b.id = s.batch_id
             LEFT JOIN user_roles ur ON ur.id = b.uploaded_by
             LEFT JOIN ocr_extracted_fields ef ON ef.set_id = s.id AND ef.field_name = 'invoice_no'
             LEFT JOIN (
                 SELECT assigned_set_id,
                        COUNT(*) FILTER (WHERE status = 'done') AS pages_done,
                        COUNT(*) FILTER (WHERE status = 'processing') AS pages_processing
                 FROM ocr_queue_pages
                 WHERE assigned_set_id IS NOT NULL
                 GROUP BY assigned_set_id
             ) pg ON pg.assigned_set_id = s.id
             LEFT JOIN LATERAL (
                 SELECT array_agg(qp.id ORDER BY qp.page_number ASC) AS page_ids
                 FROM ocr_queue_pages qp
                 WHERE qp.assigned_set_id = s.id
             ) tp ON true
             WHERE ${useAllScope ? 'TRUE' : 'b.uploaded_by = $1'} AND s.status = 'processing'
             ORDER BY s.priority DESC, s.created_at ASC
             LIMIT 100`,
            useAllScope ? [] : [req.user.id]
        );
        res.json({ activeSets: result.rows, scope: useAllScope ? 'all' : 'mine' });
    } catch (err) {
        console.error('[ocr/active-sets] error:', err);
        res.status(500).json({ error: 'fetch active sets failed' });
    }
});


// ----------------------------------------------------------------
// POST /api/ocr/set/:setId/prioritize
// เฉพาะ Owner -- เลื่อนชุดเอกสารนี้ให้ Worker หยิบไปทำก่อนชุดอื่นที่
// priority=0 ทั้งหมด (ไม่แซงหน้าเพจที่ status='processing' อยู่แล้ว
// เพราะ fetch_next_ocr_page_v2() กรองแค่ status='pending' เท่านั้น)
// ----------------------------------------------------------------
router.post('/set/:setId/prioritize', async (req, res) => {
    if (!req.user || !req.user.id) {
        return res.status(401).json({ error: 'unauthorized' });
    }
    const isOwner = String(req.user?.appRole || '').toLowerCase() === 'owner';
    if (!isOwner) {
        return res.status(403).json({ error: 'เฉพาะ Owner เท่านั้นที่เลื่อนคิวได้' });
    }
    const { setId } = req.params;
    const priority = Number.isInteger(req.body?.priority) ? req.body.priority : 1;
    try {
        const result = await pool.query(
            `UPDATE ocr_sets SET priority = $2 WHERE id = $1 RETURNING id, priority`,
            [setId, priority]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'ไม่พบชุดเอกสารนี้' });
        }
        res.json({ ok: true, setId, priority: result.rows[0].priority });
    } catch (err) {
        console.error('[ocr/prioritize] error:', err);
        res.status(500).json({ error: 'prioritize failed', detail: err.message });
    }
});


export default router;