/**
 * docenter_ocr_route.js
 * ================================================================
 * OCR Route สำหรับ Document Center
 * Node.js → POST http://localhost:5050/ocr (FastAPI) → return JSON
 *
 * ใน app.js เพิ่ม:
 *   import docenterOcrRouter from './routes/docenter_ocr_route.js';
 *   app.use('/api/docenter', docenterOcrRouter);
 * ================================================================
 */

import { Router } from 'express';
import multer     from 'multer';
import FormData   from 'form-data';
import fetch      from 'node-fetch';
import { exec }   from 'child_process';
import { promisify } from 'util';
import { pool }   from '../db.js';

const execAsync = promisify(exec);
const router = Router();

const OCR_SERVER_URL  = 'http://localhost:5050/ocr';
// MARKER_DOCENTER_GROUP_MATCH_V2
const OCR_SERVER_BASE = 'http://localhost:5050';
const OCR_SERVICE_NAME = 'docenter_ocr';
const SESSION_TIMEOUT_MIN = 2; // นาที — ถ้า last_seen เก่ากว่านี้ถือว่าออกไปแล้ว

// ── Helper: เช็คจำนวน active users ใน document-center ──────────────────────
async function getActiveDocCenterUsers() {
  const { rows } = await pool.query(`
    SELECT user_name, last_seen
    FROM menu_active_sessions
    WHERE menu_id = 'document-center'
      AND last_seen > NOW() - INTERVAL '${SESSION_TIMEOUT_MIN} minutes'
  `);
  return rows;
}

// ── Helper: run Windows sc command ──────────────────────────────────────────
async function scCommand(action) {
  try {
    const { stdout } = await execAsync(`sc ${action} ${OCR_SERVICE_NAME}`);
    return { ok: true, output: stdout.trim() };
  } catch (err) {
    return { ok: false, output: err.message };
  }
}

// MARKER_DOCENTER_OCR_GUARD_STOP_WHILE_RUNNING_V1
// ── Helper: เช็คว่ามีงาน OCR สถานะ 'ocring' ค้างอยู่ไหม (กำลังประมวลผลจริง) ──
// ── ใช้กันไม่ให้ Auto-Stop/Manual-Stop สั่งปิด Service กลางคันตอนกำลัง Loading ──
// ── PaddleOCR Model หรือกำลัง OCR อยู่ -- ถึงจะไม่มี User อยู่ใน Document ──────
// ── Center เลยก็ตาม ก็ต้องรอให้งานที่ค้างอยู่เสร็จก่อนเสมอ (เจอจริงจาก ──────
// ── ECONNRESET ที่ Auto-Stop ตัดตอน Server กลางที่กำลังโหลด Model อยู่) ──────
async function isOcrJobRunning() {
  const { rows } = await pool.query(
    `SELECT 1 FROM docenter_ocr_queue WHERE status = 'ocring' LIMIT 1`
  );
  return rows.length > 0;
}

// ── GET /api/docenter/ocr-service/status ─────────────────────────────────────
router.get('/ocr-service/status', async (req, res) => {
  try {
    const users = await getActiveDocCenterUsers();
    const { stdout } = await execAsync(`sc query ${OCR_SERVICE_NAME}`).catch(() => ({ stdout: '' }));
    const running = stdout.includes('RUNNING');
    const health  = running ? await fetch('http://localhost:5050/health', { timeout: 2000 })
      .then(r => r.json()).catch(() => ({ online: false })) : { online: false };
    return res.json({
      service_running: running,
      model_loaded:    health.model_loaded || false,
      active_users:    users.length,
      users:           users.map(u => u.user_name),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/docenter/ocr-service/start ─────────────────────────────────────
router.post('/ocr-service/start', async (req, res) => {
  try {
    const users = await getActiveDocCenterUsers();
    if (users.length === 0) {
      return res.json({ started: false, reason: 'ไม่มี user อยู่ใน Document Center' });
    }
    const result = await scCommand('start');
    return res.json({ started: result.ok, output: result.output, active_users: users.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/docenter/ocr-service/stop ──────────────────────────────────────
router.post('/ocr-service/stop', async (req, res) => {
  try {
    const users = await getActiveDocCenterUsers();
    if (users.length > 0) {
      return res.json({ stopped: false, reason: `ยังมี ${users.length} user อยู่ใน Document Center` });
    }
    // MARKER_DOCENTER_OCR_GUARD_STOP_WHILE_RUNNING_V1
    if (await isOcrJobRunning()) {
      return res.json({ stopped: false, reason: 'มีงาน OCR กำลังประมวลผลอยู่ (status=ocring) รอให้เสร็จก่อน' });
    }
    const result = await scCommand('stop');
    return res.json({ stopped: result.ok, output: result.output });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/docenter/ocr-service/auto ──────────────────────────────────────
// เรียกจาก frontend ทุกครั้งที่ heartbeat — ระบบจะ start/stop เองตาม active users
router.post('/ocr-service/auto', async (req, res) => {
  try {
    const users = await getActiveDocCenterUsers();
    const { stdout } = await execAsync(`sc query ${OCR_SERVICE_NAME}`).catch(() => ({ stdout: '' }));
    const running = stdout.includes('RUNNING');

    if (users.length > 0 && !running) {
      // มี user แต่ service ไม่รัน → start
      const result = await scCommand('start');
      return res.json({ action: 'started', ok: result.ok, active_users: users.length });
    } else if (users.length === 0 && running) {
      // MARKER_DOCENTER_OCR_GUARD_STOP_WHILE_RUNNING_V1
      // ── ไม่มี user แต่ก่อน Stop ต้องเช็คก่อนว่ามีงาน OCR ค้างอยู่ไหม ────────
      // ── (กำลังโหลด PaddleOCR Model หรือกำลัง OCR อยู่จริง) ถ้ามี ห้าม Stop ──
      // ── เด็ดขาด แม้ไม่มี User เลยก็ตาม -- รอรอบ Heartbeat ถัดไปค่อยเช็คใหม่ ──
      if (await isOcrJobRunning()) {
        return res.json({ action: 'none', running, active_users: 0, reason: 'ocr job in progress' });
      }
      // ไม่มี user แต่ service รันอยู่ → stop
      const result = await scCommand('stop');
      return res.json({ action: 'stopped', ok: result.ok, active_users: 0 });
    } else {
      return res.json({ action: 'none', running, active_users: users.length });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 30 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') cb(null, true);
        else cb(new Error('รับเฉพาะไฟล์ PDF เท่านั้น'));
    },
});

// ── POST /api/docenter/ocr-pdf ───────────────────────────────────────────────
router.post('/ocr-pdf', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'กรุณาแนบไฟล์ PDF' });
    }

    try {
        // ส่ง PDF buffer ต่อไปยัง FastAPI OCR server
        const fd = new FormData();
        fd.append('file', req.file.buffer, {
            filename:    req.file.originalname,
            contentType: 'application/pdf',
        });
        // ส่ง rotation ไปกับ request ถ้ามี
        const rotation = parseInt(req.body.rotation || '0') || 0;
        if (rotation) fd.append('rotation', String(rotation));

        const ocrRes = await fetch(OCR_SERVER_URL, {
            method:  'POST',
            body:    fd,
            headers: fd.getHeaders(),
            timeout: 3 * 60 * 1000, // 3 นาที
        });

        const data = await ocrRes.json();

        if (!ocrRes.ok) {
            return res.status(422).json({
                error:  'OCR ไม่สำเร็จ',
                detail: data.detail || data.error || 'unknown error',
            });
        }

        return res.json(data);

    } catch (err) {
        console.error('[docenter/ocr-pdf] error:', err.message);

        // ถ้า connect ไม่ได้เลย — OCR server ไม่ได้รัน
        if (err.code === 'ECONNREFUSED') {
            return res.status(503).json({
                error:  'OCR Server ไม่พร้อมใช้งาน',
                detail: 'กรุณาตรวจสอบว่า docenter_ocr_server.py กำลังรันอยู่ที่ port 5050',
            });
        }

        return res.status(500).json({ error: 'OCR ล้มเหลว', detail: err.message });
    }
});

// ── GET /api/docenter/ocr-health — เช็ค OCR server status ───────────────────
router.get('/ocr-health', async (req, res) => {
    try {
        const r = await fetch('http://localhost:5050/health', { timeout: 3000 });
        const data = await r.json();
        return res.json({ online: true, ...data });
    } catch (_) {
        return res.json({ online: false, model_loaded: false });
    }
});


// ════════════════════════════════════════════════════════════════════════════
// ── Queue flow ───────────────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════════

const uploadQueue = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 30 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') cb(null, true);
        else cb(new Error('รับเฉพาะไฟล์ PDF เท่านั้น'));
    },
});

// ── POST /api/docenter/queue/add — เพิ่ม PDF เข้า queue ────────────────────
// MARKER_DOCENTER_GROUP_MATCH_V2
// ── Helper: Normalize สำหรับเทียบ Match (เหมือน checkAllDuplicates() ฝั่ง Frontend ทุกประการ) ──────
function normMatch(v) {
    return String(v || '').trim().toLowerCase();
}
function toNumMatch(v) {
    return parseFloat(String(v || '0').replace(/,/g, '')) || 0;
}

// MARKER_DOCENTER_GROUPADD_AUTOSAVE_V1 -- ใช้ตอน Auto-Save หลัง "+ เพิ่ม" OCR เสร็จ (รูปแบบเดียวกับ Frontend)
const DOC_TYPE_NAME = { APN01: 'Invoice Register', AP07: 'Input Tax Invoice', AP09: 'Input Tax Invoice', TRANS: 'Transaction AP' };
function genSerialBackend(bu, type) {
    const now = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const yy = String(now.getFullYear()).slice(2), mm = p(now.getMonth() + 1), dd = p(now.getDate()), hh = p(now.getHours()), mi = p(now.getMinutes());
    return `${bu || 'XX'}_${DOC_TYPE_NAME[type] || type}_${type}-${yy}${mm}${dd}.${hh}${mi}`;
}

// ── Helper: เรียก /ocr-lightweight แบบ Stream (NDJSON) ทีละหน้า ──────────────
// onProgress({pages_checked, total_pages}) ถูกเรียกทุกครั้งที่มีหน้าใหม่ไหลเข้ามา (ก่อน Group/Match/Full OCR ทั้งหมด -- เร็วกว่าเดิมมาก)
async function runLightweightOcrStreaming(pdfBuffer, fileName, rotation, onProgress) {
    const fd = new FormData();
    fd.append('file', pdfBuffer, { filename: fileName, contentType: 'application/pdf' });
    if (rotation) fd.append('rotation', String(rotation));

    const res = await fetch(`${OCR_SERVER_BASE}/ocr-lightweight`, {
        method: 'POST', body: fd, headers: fd.getHeaders(),
        timeout: 10 * 60 * 1000, // เผื่อ PDF หลายสิบหน้า
    });
    if (!res.ok) {
        let detail = '';
        try { detail = (await res.json()).detail; } catch (_) {}
        throw new Error(detail || `Lightweight OCR failed (HTTP ${res.status})`);
    }

    const pageSignals = [];
    let totalPages = null;
    let buffer = '';
    for await (const chunk of res.body) {
        buffer += chunk.toString('utf8');
        let idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line) continue;
            let msg;
            try { msg = JSON.parse(line); } catch (_) { continue; }
            if (msg.type === 'start') {
                totalPages = msg.pages;
                if (onProgress) onProgress({ total_pages: totalPages, pages_checked: 0 });
            } else if (msg.type === 'page') {
                pageSignals.push(msg);
                if (onProgress) onProgress({ total_pages: totalPages, pages_checked: pageSignals.length });
            } else if (msg.type === 'error') {
                throw new Error(msg.message || 'Lightweight OCR error');
            }
            // msg.type === 'done' -- ไม่ต้องทำอะไรเพิ่ม ใช้ pageSignals ที่สะสมมาแล้ว
        }
    }
    if (pageSignals.length === 0) {
        throw new Error('Lightweight OCR ไม่คืนหน้าใดๆ กลับมาเลย');
    }
    return pageSignals;
}

// ── จับกลุ่มหน้าเป็นเอกสาร -- กฎ 3 ข้อ (Confirm แล้ว อ้างอิง Design Doc) ────
// 1. Key (Invoice Number + Vendor Name + doc_type) ตรงกับหน้าก่อนหน้า -> Merge เข้า Group เดิม
// 2. Key ต่างจากหน้าก่อนหน้า (และหน้านี้มี Key จริง) -> ขึ้น Group ใหม่
// 3. หน้านี้ไม่มี Key เลย (ตารางต่อ ไม่มีหัวกระดาษ) -> Merge เข้า Group ก่อนหน้า
function newGroupFromPage(p) {
    return {
        pages:             [p.page],
        doc_type:          p.doc_type || 'APN01',
        // MARKER_DOCENTER_SERIALCODE_GROUP_V1 -- Serial Code จาก Header (ถ้า OCR อ่านเจอ) ใช้ Fast-path Match
        serial_code:       p.serial_code || '',
        vendor_name:       p.vendor_name || '',
        invoice_number:    p.invoice_number || '',
        branch:            p.branch || '',
        amount:            p.amount || '',
        gr_transaction_no: p.gr_transaction_no || '',
    };
}

function groupPagesByDocument(pageSignals) {
    const groups = [];
    let current = null;

    const hasKey = (p) => !!((p.invoice_number || '').trim() || (p.vendor_name || '').trim());
    const keyOf  = (p) => `${p.doc_type || ''}|${normMatch(p.invoice_number)}|${normMatch(p.vendor_name)}`;

    for (const p of pageSignals) {
        if (!current) {
            current = newGroupFromPage(p);
            groups.push(current);
            continue;
        }
        if (!hasKey(p)) {
            current.pages.push(p.page);
            continue;
        }
        if (keyOf(p) === keyOf(current)) {
            current.pages.push(p.page);
        } else {
            current = newGroupFromPage(p);
            groups.push(current);
        }
    }
    return groups;
}

// ── หา Match ที่ดีที่สุดใน doc_collection สำหรับ Group นี้ ──────────────
// Match Key: Invoice Number + Branch + มูลค่ารวม (Amount) + Vendor Name (เหมือน checkAllDuplicates()
// ฝั่ง Frontend ทุกประการ) Confidence = จำนวน Field ที่ตรง/4*100% --
// Auto-Attach เฉพาะ Confidence 100% เท่านั้น (นอกนั้นถือว่าไม่แน่นอ เข้า
// Manual Review แทน)
async function findBestMatchForGroup(group) {
    // MARKER_DOCENTER_SERIALCODE_FASTMATCH_V1 -- ถ้า OCR อ่าน Serial Code เจอ (เอกสารรุ่นใหม่ที่
    // Print ออกมามี Serial Code ติดอยู่แล้วจาก excelReport.js) ให้เช็ค Exact Match กับ
    // doc_collection.serial_code ก่อนเลย ไม่ต้องรอ 4-field (Invoice Number + Branch + Amount +
    // Vendor) ซึ่งช้ากว่า -- Match ตรง = Confidence 100 ทันที
    if (group.serial_code && group.serial_code.trim()) {
        const { rows: serialCandidates } = await pool.query(
            `SELECT id, serial_code FROM doc_collection WHERE serial_code = $1 LIMIT 1`,
            [group.serial_code.trim()]
        );
        if (serialCandidates.length > 0) {
            return { doc_collection_id: serialCandidates[0].id, serial_code: serialCandidates[0].serial_code, confidence: 100 };
        }
        // ไม่เจอตรงเป๊ะ -- fallback ไป 4-field matching ต่อด้านล่างตามปกติ (ไม่ return null ทันที)
    }

    if (!group.invoice_number) return null; // ไม่มี Invoice Number เลย ไม่มีทาง Match ได้แม่นพอ

    const { rows: candidates } = await pool.query(
        `SELECT dc.id, dc.serial_code, dc.rows
         FROM doc_collection dc
         WHERE dc.doc_type = $1
           AND EXISTS (
             SELECT 1 FROM jsonb_array_elements(dc.rows) re
             WHERE lower(trim(re->>'Invoice Number')) = lower(trim($2))
           )
         ORDER BY dc.updated_at DESC
         LIMIT 10`,
        [group.doc_type, group.invoice_number]
    );

    let best = null;
    for (const cand of candidates) {
        const candRows = Array.isArray(cand.rows) ? cand.rows : [];
        for (const r of candRows) {
            if (normMatch(r['Invoice Number']) !== normMatch(group.invoice_number)) continue;
            let score = 25; // Invoice Number ตรงแน่นอนอยู่แล้ว (จาก WHERE ด้านบน)
            if (group.branch && normMatch(r['Branch']) === normMatch(group.branch)) score += 25;
            if (group.vendor_name && normMatch(r['Vendor Name']) === normMatch(group.vendor_name)) score += 25;
            if (group.amount !== '' && group.amount != null && Math.abs(toNumMatch(r['มูลค่ารวม']) - toNumMatch(group.amount)) < 0.01) score += 25;
            if (!best || score > best.confidence) {
                best = { doc_collection_id: cand.id, serial_code: cand.serial_code, confidence: score };
            }
        }
    }
    return best;
}

// ── เรียก /extract-pages (output=image) ดึงรูปเฉพาะหน้าที่ต้องการ ────────────
async function extractPagesAsImages(pdfBuffer, fileName, pages, rotation) {
    const fd = new FormData();
    fd.append('file', pdfBuffer, { filename: fileName, contentType: 'application/pdf' });
    fd.append('pages', pages.join(','));
    fd.append('output', 'image');
    if (rotation) fd.append('rotation', String(rotation));
    const res = await fetch(`${OCR_SERVER_BASE}/extract-pages`, {
        method: 'POST', body: fd, headers: fd.getHeaders(), timeout: 2 * 60 * 1000,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'extract-pages (image) failed');
    // MARKER_DOCENTER_PREVIEWIMAGE_DATAURI_FIX_V1
    // -- Python /extract-pages ใช้ image_to_base64() ซึ่งคืน Base64 ดิบ (ไม่มี
    // -- "data:image/jpeg;base64," นำหน้า เหมือนที่ /ocr เติมให้เองก่อนส่งกลับ)
    // -- เติม Prefix ที่นี่ให้ครบ ก่อนถูกเก็บเข้า doc_collection.attachments
    // -- หรือ docenter_ocr_groups.preview_images ซึ่งทั้งคู่คาดว่าเป็น Data URI
    return (data.pages || []).map(p => ({
        ...p,
        data: p.data && !String(p.data).startsWith('data:') ? `data:image/jpeg;base64,${p.data}` : p.data,
    }));
}

// ── เรียก /extract-pages (output=pdf) ตัด Sub-PDF เฉพาะหน้าของ Group นี้ ────────
async function extractPagesAsSubPdf(pdfBuffer, fileName, pages, rotation) {
    const fd = new FormData();
    fd.append('file', pdfBuffer, { filename: fileName, contentType: 'application/pdf' });
    fd.append('pages', pages.join(','));
    fd.append('output', 'pdf');
    if (rotation) fd.append('rotation', String(rotation));
    const res = await fetch(`${OCR_SERVER_BASE}/extract-pages`, {
        method: 'POST', body: fd, headers: fd.getHeaders(), timeout: 2 * 60 * 1000,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'extract-pages (pdf) failed');
    return data.pdf_base64;
}

router.post('/queue/add', uploadQueue.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'กรุณาแนบไฟล์ PDF' });
    try {
        const username   = req.user?.username || req.user?.email || 'unknown';
        const rotation   = parseInt(req.body.rotation || '0') || 0;
        const pdfBuffer  = req.file.buffer.toString('base64');
        const docType  = req.body.doc_type  || 'APN01';
        const folderId = req.body.folder_id ? parseInt(req.body.folder_id) : null;
        const menuId   = req.body.menu_id   || 'document-center';
        const { rows } = await pool.query(
            `INSERT INTO docenter_ocr_queue
               (file_name, file_data, rotation, uploaded_by, status, doc_type, folder_id, menu_id, created_at)
             VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, NOW())
             RETURNING id, file_name, status, created_at`,
            [req.file.originalname, pdfBuffer, rotation, username, docType, folderId, menuId]
        );
        // trigger OCR async (ไม่รอ)
        enqueueOcrJob(); // serial worker loop — ทำทีละ 1 job
        // start service ถ้ายังไม่รัน (idle watchdog อาจ shutdown ไปแล้ว)
        execAsync(`sc query ${OCR_SERVICE_NAME}`).then(({ stdout }) => {
            if (!stdout.includes('RUNNING')) {
                scCommand('start').then(() => console.log('[queue] docenter-ocr service started on demand'));
            }
        }).catch(() => {});
        await logCentralQueue('pending', { source:'docenter', source_id:rows[0].id, file_name:rows[0].file_name, uploaded_by:username, priority_class:2 });
        // push SSE ทันที
        getQueueSnapshot().then(snapshot => broadcastQueueUpdate('queue_update', { snapshot }));
        return res.json({ success: true, queue_id: rows[0].id, file_name: rows[0].file_name });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ── GET /api/docenter/queue — ดึงรายการ queue ──────────────────────────────
router.get('/queue', async (req, res) => {
    try {
        const username  = req.user?.username || req.user?.email || '';
        const isAdmin   = req.user?.role === 'admin' || req.user?.is_admin;
        const { rows }  = await pool.query(
            isAdmin
                ? `SELECT id, file_name, status, rotation, uploaded_by, created_at, updated_at,
                          result_meta, result_data, serial_code, error_msg
                   FROM docenter_ocr_queue
                   WHERE status IN ('pending','ocring','done','error','needs_review')
                   ORDER BY created_at DESC LIMIT 100`
                : `SELECT id, file_name, status, rotation, uploaded_by, created_at, updated_at,
                          result_meta, result_data, serial_code, error_msg
                   FROM docenter_ocr_queue
                   WHERE uploaded_by = $1
                     AND status IN ('pending','ocring','done','error','needs_review')
                   ORDER BY created_at DESC LIMIT 50`,
            isAdmin ? [] : [username]
        );
        return res.json(rows);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ── DELETE /api/docenter/queue/:id — ลบออกจาก queue ────────────────────────
router.delete('/queue/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM docenter_ocr_queue WHERE id = $1', [req.params.id]);
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ── GET /api/docenter/queue/:id/result — ดึง result ────────────────────────
router.get('/queue/:id/result', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, file_name, status, result_data, result_meta, rotation, error_msg
             FROM docenter_ocr_queue WHERE id = $1`,
            [req.params.id]
        );
        if (!rows[0]) return res.status(404).json({ error: 'ไม่พบ queue item' });
        return res.json(rows[0]);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// MARKER_DOCENTER_GROUP_MATCH_V2
// ── GET /api/docenter/queue/:id/groups — ดึงผล Split+Group+Match สำหรับ Table UI ────
router.get('/queue/:id/groups', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, group_index, pages, doc_type, vendor_name, invoice_number, branch, amount,
                    gr_transaction_no, matched, confidence, matched_doc_collection_id, matched_serial_code,
                    status, preview_images, ocr_result_meta, ocr_result_data, error_msg, was_manual_add, created_at, updated_at
             FROM docenter_ocr_groups
             WHERE queue_id = $1
             ORDER BY group_index ASC`,
            [req.params.id]
        );
        return res.json(rows);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ── POST /api/docenter/queue/:id/groups/:groupId/add — User กดปุ่ม "เพิ่ม" ────────────
// ── ให้ Group ที่ไม่ Match (status='needs_review') เข้า Full OCR เฉพาะหน้า ─────
// ── ของ Group นี้เท่านั้น (ไม่ใช่ทั้ง PDF) -- ไม่ Auto-Insert เข้า ─────────
// ── doc_collection เอง ให้ User Review+Save จาก Preview Zone เหมือน Flow เดิม ────────
router.post('/queue/:id/groups/:groupId/add', async (req, res) => {
    const queueId = parseInt(req.params.id);
    const groupId = parseInt(req.params.groupId);
    try {
        const { rows: groupRows } = await pool.query(
            `SELECT * FROM docenter_ocr_groups WHERE id = $1 AND queue_id = $2`,
            [groupId, queueId]
        );
        if (!groupRows[0]) return res.status(404).json({ error: 'ไม่พบ Group นี้' });
        const group = groupRows[0];
        if (group.status !== 'needs_review') {
            return res.status(409).json({ error: `Group นี้อยู่ในสถานะ '${group.status}' แล้ว ไม่สามารถกด "เพิ่ม" ซ้ำได้` });
        }

        const { rows: queueRows } = await pool.query(
            `SELECT file_name, file_data, rotation, uploaded_by FROM docenter_ocr_queue WHERE id = $1`,
            [queueId]
        );
        if (!queueRows[0]) return res.status(404).json({ error: 'ไม่พบ Queue Job นี้' });
        const { file_name, file_data, rotation, uploaded_by } = queueRows[0];
        const pdfBuffer = Buffer.from(file_data, 'base64');

        // MARKER_DOCENTER_MANUALADD_FLAG_V1 -- Mark ว่า Group นี้ Resolve ผ่านการกด "+ เพิ่ม" เอง (ไม่ใช่ Auto-Match ตอนแรก)
        await pool.query(`UPDATE docenter_ocr_groups SET status='ocr_queued', was_manual_add=true, updated_at=NOW() WHERE id=$1`, [groupId]);
        broadcastQueueUpdate('group_status', { queue_id: queueId, group_id: groupId, status: 'ocr_queued' });

        // ตัด Sub-PDF เฉพาะหน้าของ Group นี้ -> ส่งเข้า Full OCR ปกติ
        const subPdfBase64 = await extractPagesAsSubPdf(pdfBuffer, file_name, group.pages, rotation);
        const subPdfBuffer = Buffer.from(subPdfBase64, 'base64');

        const fd = new FormData();
        fd.append('file', subPdfBuffer, { filename: file_name, contentType: 'application/pdf' });
        if (rotation) fd.append('rotation', String(rotation));
        const ocrRes = await fetch(OCR_SERVER_URL, {
            method: 'POST', body: fd, headers: fd.getHeaders(), timeout: 5 * 60 * 1000,
        });
        const data = await ocrRes.json();
        if (!ocrRes.ok) throw new Error(data.detail || 'Full OCR failed');

        // MARKER_DOCENTER_GROUPADD_AUTOSAVE_V1 -- ไม่รอ User Review+Save เอง -- Insert เข้า
        // doc_collection ทันทีที่ OCR เสร็จ เชื่อผล OCR 100% (Amount อยู่ใน rows ต่อแถวอยู่แล้ว
        // ไม่มี Column แยก ไม่ต้องเพิ่ม Schema)
        const groupMeta = data.metadata || {};
        const ocrDocType = (groupMeta.doc_type || group.doc_type || 'APN01').toUpperCase();
        const buShort = (groupMeta.bu_short || groupMeta.bu_code?.split('-')[0]?.trim() || '').toUpperCase();
        let insertBuCode = buShort || 'XX';
        let insertBuCodeName = groupMeta.bu_code || '';
        let insertBuName = groupMeta.bu_name || groupMeta.bu_name_ocr || '';
        if (buShort) {
            try {
                const { rows: cl } = await pool.query(
                    `SELECT bu, bu_code_name, "THAI COMPANY NAME" FROM company_list WHERE bu_code_name ILIKE $1 LIMIT 1`,
                    [buShort + '%']
                );
                if (cl[0]) {
                    insertBuCode = cl[0].bu || insertBuCode;
                    insertBuCodeName = cl[0].bu_code_name || insertBuCodeName;
                    insertBuName = cl[0]['THAI COMPANY NAME'] || insertBuName;
                }
            } catch (_) {}
        }
        const groupSerialCode = genSerialBackend(insertBuCode, ocrDocType);

        const { rows: dupRows } = await pool.query(
            `SELECT 1 FROM doc_collection WHERE serial_code = $1 AND doc_type = $2 LIMIT 1`,
            [groupSerialCode, ocrDocType]
        );
        if (dupRows.length > 0) {
            const dupMsg = `Serial "${groupSerialCode}" (${ocrDocType}) มีในระบบแล้ว`;
            await pool.query(
                `UPDATE docenter_ocr_groups SET status='needs_review', ocr_result_meta=$2, ocr_result_data=$3, error_msg=$4, updated_at=NOW() WHERE id=$1`,
                [groupId, JSON.stringify(groupMeta), JSON.stringify({ rows: data.rows, ocr_text: data.ocr_text, total_rows: data.total_rows, pages: data.pages, pdf_image: data.pdf_image }), dupMsg]
            );
            broadcastQueueUpdate('group_status', { queue_id: queueId, group_id: groupId, status: 'needs_review', error: dupMsg });
            return res.status(409).json({ error: dupMsg });
        }

        const nowIso = new Date().toISOString();
        const groupAttachPayload = data.pdf_image ? [{
            name: `${groupSerialCode}.jpg`, data: data.pdf_image, mime: 'image/jpeg', source: 'ocr_pdf_group',
        }] : [];
        const groupInsertResult = await pool.query(
            `INSERT INTO doc_collection
                (serial_code, doc_type, doc_name, rows, bu_code, bu_code_name, bu_name,
                 source, file_date, uploaded_by, ocr_text, attachments, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'ocr_pdf',$8,$9,$10,$11,$12,$12)
             RETURNING id`,
            [
                groupSerialCode, ocrDocType, DOC_TYPE_NAME[ocrDocType] || ocrDocType,
                JSON.stringify(data.rows || []),
                insertBuCode, insertBuCodeName, insertBuName,
                groupMeta.receive_date || nowIso.split('T')[0],
                uploaded_by || '',
                data.ocr_text || '',
                JSON.stringify(groupAttachPayload),
                nowIso,
            ]
        );
        const groupDocId = groupInsertResult.rows[0].id;

        await pool.query(
            `UPDATE docenter_ocr_groups
             SET status='matched_attached', matched=true, confidence=100, matched_doc_collection_id=$2,
                 matched_serial_code=$3, ocr_result_meta=$4, ocr_result_data=$5, updated_at=NOW()
             WHERE id=$1`,
            [groupId, groupDocId, groupSerialCode, JSON.stringify(groupMeta), JSON.stringify({ rows: data.rows, ocr_text: data.ocr_text, total_rows: data.total_rows, pages: data.pages, pdf_image: data.pdf_image })]
        );
        broadcastQueueUpdate('group_status', { queue_id: queueId, group_id: groupId, status: 'matched_attached', matched_serial_code: groupSerialCode });

        // เช็คว่า Group ทุกตัวใน Queue Job นี้ ไม่มี needs_review/ocr_queued ค้างแล้วมั้ย -> ปิด Job
        const { rows: pending } = await pool.query(
            `SELECT 1 FROM docenter_ocr_groups WHERE queue_id=$1 AND status IN ('needs_review','ocr_queued') LIMIT 1`,
            [queueId]
        );
        if (!pending[0]) {
            await pool.query(`UPDATE docenter_ocr_queue SET status='done', updated_at=NOW() WHERE id=$1`, [queueId]);
            getQueueSnapshot().then(snapshot => broadcastQueueUpdate('queue_update', { snapshot }));
        }

        return res.json({ success: true, group_id: groupId, result: data });
    } catch (err) {
        console.error(`[docenter-group-add] error queue=${queueId} group=${groupId}:`, err.message);
        await pool.query(`UPDATE docenter_ocr_groups SET status='needs_review', error_msg=$2, updated_at=NOW() WHERE id=$1`, [groupId, err.message]);
        broadcastQueueUpdate('group_status', { queue_id: queueId, group_id: groupId, status: 'needs_review', error: err.message });
        return res.status(500).json({ error: err.message });
    }
});

// ── PATCH /queue/:id/priority — เลื่อน priority ขึ้น 1 ──────────────────────────
router.patch('/queue/:id/priority', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        // หา priority ของ item นี้
        const { rows: cur } = await pool.query(
            `SELECT priority FROM docenter_ocr_queue WHERE id=$1 AND status='pending'`,
            [id]
        );
        if (!cur[0]) return res.status(404).json({ error: 'ไม่พบ item หรือ item ไม่ได้อยู่ใน pending' });

        const curPriority = cur[0].priority || 0;
        // หา item ที่ priority สูงกว่า (เลื่อนขึ้น = priority สูงขึ้น)
        const { rows: above } = await pool.query(
            `SELECT id, priority FROM docenter_ocr_queue WHERE status='pending' AND priority > $1 ORDER BY priority ASC LIMIT 1`,
            [curPriority]
        );
        if (above[0]) {
            // สลับ priority
            await pool.query('UPDATE docenter_ocr_queue SET priority=$1 WHERE id=$2', [above[0].priority, id]);
            await pool.query('UPDATE docenter_ocr_queue SET priority=$1 WHERE id=$2', [curPriority, above[0].id]);
        } else {
            // ไม่มีตัวอื่นอยู่เหนือ เพิ่ม priority ขึ้นเอง
            await pool.query('UPDATE docenter_ocr_queue SET priority=priority+1 WHERE id=$1', [id]);
        }
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ── Helper: เช็คว่า AP OCR กำลังทำงานอยู่มั้ย ───────────────────────────────
async function isApOcrBusy() {
    try {
        const { rows } = await pool.query(`
            SELECT COUNT(*) AS cnt
            FROM ocr_queue_pages
            WHERE status IN ('pending','processing')
        `);
        return parseInt(rows[0].cnt) > 0;
    } catch (_) {
        return false; // ถ้า query ไม่ได้ (table ไม่มี) ถือว่าไม่ busy
    }
}

// ── Helper: log เข้า system_ocr_queue (Central Queue) ──────────────────────
// Patch 93: system_ocr_queue ควรมีแค่งานที่ "กำลังทำอยู่" เท่านั้น (pending/
// ocring) — พองานจบแล้ว (done/error) ต้องย้ายไปเก็บถาวรที่ activity_log
// (มีอยู่แล้วในระบบ, ใช้แสดงผลที่ System Console > Activity Log) แล้วลบ
// ออกจาก system_ocr_queue ทันที ไม่ให้ค้างสะสมไม่มีที่สิ้นสุดเหมือนเดิม
const OCR_TERMINAL_STATUSES = ['done', 'error'];

async function logCentralQueue(action, payload = {}) {
    try {
        if (OCR_TERMINAL_STATUSES.includes(action)) {
            await pool.query(
                `INSERT INTO activity_log (user_email, username, action, target, detail, module, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
                [
                    null,
                    payload.uploaded_by || null,
                    action === 'done' ? 'ocr_completed' : 'ocr_failed',
                    payload.file_name || '',
                    JSON.stringify(payload.detail || {}),
                    payload.source || 'docenter',
                ]
            );
            await pool.query(
                `DELETE FROM system_ocr_queue WHERE source = $1 AND source_id = $2`,
                [payload.source || 'docenter', String(payload.source_id || '')]
            );
            return;
        }

        await pool.query(`
            INSERT INTO system_ocr_queue
              (source, source_id, file_name, status, uploaded_by, priority_class, detail, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
            ON CONFLICT (source, source_id) DO UPDATE
              SET status=$4, detail=$7, updated_at=NOW()
        `, [
            payload.source || 'docenter',
            String(payload.source_id || ''),
            payload.file_name || '',
            action,
            payload.uploaded_by || '',
            payload.priority_class || 2,
            JSON.stringify(payload.detail || {}),
        ]);
    } catch (_) { /* ไม่ให้ central log ทำให้ OCR หยุด */ }
}

// ── Serial OCR Worker Loop ────────────────────────────────────────────────────
// PaddleOCR ไม่ thread-safe → ต้องทำทีละ 1 job — ใช้ single worker loop
// ── SSE: push queue update ไปหา frontend ทุกครั้งที่ status เปลี่ยน ────────────
// แทน polling ทุก X วิ — backend push เฉพาะตอนมี progress จริงๆ
const sseClients = new Set(); // Set of res objects

function broadcastQueueUpdate(event = 'queue_update', data = {}) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) {
        try { res.write(payload); }
        catch (_) { sseClients.delete(res); }
    }
}

// ── GET /api/docenter/queue/stream — SSE endpoint ──────────────────────────
// EventSource ไม่รองรับ custom header → รับ token จาก query string ด้วย
router.get('/queue/stream', (req, res) => {
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // ป้องกัน nginx buffer
    res.flushHeaders();

    // ส่ง ping ทุก 25 วิ กัน connection timeout
    const ping = setInterval(() => {
        try { res.write(': ping\n\n'); } catch (_) {}
    }, 25_000);

    sseClients.add(res);

    // ส่ง snapshot ทันทีที่ connect — client จะได้ข้อมูลล่าสุดเลยไม่ต้องรอ event
    getQueueSnapshot().then(snapshot => {
        try { res.write(`event: queue_update\ndata: ${JSON.stringify({ snapshot })}\n\n`); }
        catch (_) {}
    });

    req.on('close', () => {
        clearInterval(ping);
        sseClients.delete(res);
    });
});

let workerRunning = false;

// Priority Boost: งานที่รอนาน > 5 นาที ได้ priority เพิ่มอัตโนมัติ
async function boostStaleJobs() {
    try {
        const { rowCount } = await pool.query(`
            UPDATE docenter_ocr_queue
            SET priority = COALESCE(priority, 0) + 1, updated_at = NOW()
            WHERE status = 'pending'
              AND created_at < NOW() - INTERVAL '5 minutes'
              AND COALESCE(priority, 0) < 100
        `);
        if (rowCount > 0) console.log(`[queue] Priority boost: ${rowCount} stale job(s)`);
    } catch (_) {}
}

let lastBoostAt = 0;
const BOOST_CHECK_INTERVAL_MS = 60_000; // เช็ค stale job แค่ทุก 1 นาที แทนที่จะเช็คทุก job ที่หยิบ

async function startWorkerLoop() {
    if (workerRunning) return;
    workerRunning = true;
    console.log('[queue] Worker loop started');

    // MARKER_DOCENTER_OCR_STARTUP_RECOVERY_WAITING_AP_V1
    // ── Startup recovery เดิมจัดการแค่ status='ocring' (Reset กลับ pending) ──────
    // ── แต่งานที่อยู่ใน 'waiting_ap' Retry ผ่าน setTimeout ที่อยู่ในหน่วยความจำ ──
    // ── Node.js Process เท่านั้น -- พอ Restart Backend setTimeout ที่ค้างอยู่หาย ──
    // ── หมดทันที ไม่มีใครมา Retry ต่อให้อีกเลย งานนั้นค้างตายตลอดไป (ยิ่งแย่ลง ──
    // ── กว่าเดิมหลังเพิ่ม Strict FIFO เพราะงานที่ตายค้างจะบล็อกงานอื่นทั้งคิวด้วย) ──
    // ── รวม 'waiting_ap' เข้า Startup Recovery นี้ด้วยเลย ────────────────────────
    try {
        const { rowCount } = await pool.query(`
            UPDATE docenter_ocr_queue SET status='pending', updated_at=NOW() WHERE status IN ('ocring','waiting_ap')
        `);
        if (rowCount > 0) console.log(`[queue] Startup recovery: reset ${rowCount} stale ocring/waiting_ap job(s)`);
    } catch (_) {}

    while (true) {
        try {
            // boostStaleJobs เดิมรันทุกครั้งที่หยิบ job ใหม่ 1 ตัว (ถ้าคิวยาว 50 jobs
            // = UPDATE scan เต็มตาราง 50 ครั้งติดกันโดยไม่จำเป็น) — เปลี่ยนเป็นเช็คแค่
            // ทุก 1 นาที ผลลัพธ์เหมือนเดิมทุกประการ (stale job ยังถูก boost ภายใน
            // เวลาที่ยอมรับได้) แต่ลด query ที่ไม่จำเป็นลงมาก
            if (Date.now() - lastBoostAt > BOOST_CHECK_INTERVAL_MS) {
                await boostStaleJobs();
                lastBoostAt = Date.now();
            }
            // MARKER_DOCENTER_OCR_STRICT_FIFO_V1
            // ── เดิม Query เลือกงาน 'pending' ตัวเก่าสุดมาทำก่อนเสมอ แต่ไม่เคยรู้จัก ──
            // ── งานที่อยู่ในสถานะ 'waiting_ap' เลย (งานที่รอ AP OCR ว่างก่อน — จัดการ ──
            // ── ผ่าน setTimeout Retry Chain แยกต่างหาก ไม่ผ่าน Query นี้) ──────────
            // ── ผลคือถ้างานเก่าสุดกำลังรอ AP OCR อยู่ (waiting_ap) งานใหม่กว่าที่ยัง ──
            // ── เป็น 'pending' อยู่จะถูกหยิบมาทำก่อนได้ทันที (แซงคิว) เพิ่มเงื่อนไข ──
            // ── NOT EXISTS กันไว้: ห้ามหยิบงานไหนเลย ถ้ายังมีงานที่ id น้อยกว่า ──────
            // ── (เก่ากว่า) ค้างอยู่ในสถานะ pending/waiting_ap แม้แต่ตัวเดียว ────────
            const { rows } = await pool.query(`
                SELECT q.id FROM docenter_ocr_queue q
                WHERE q.status = 'pending'
                  AND NOT EXISTS (
                    SELECT 1 FROM docenter_ocr_queue older
                    WHERE older.status IN ('pending','waiting_ap')
                      AND older.id < q.id
                  )
                ORDER BY q.priority DESC NULLS LAST, q.id ASC
                LIMIT 1
            `);
            if (!rows[0]) {
                // MARKER_DOCENTER_OCR_STRICT_FIFO_V1
                // ── เดิมไม่มีแถวกลับมา = ไม่มีงาน pending เลย หยุด Loop ได้เลย ──────
                // ── แต่ตอนนี้ "ไม่มีแถวกลับมา" อาจแปลว่ามีงาน pending อยู่จริง แค่ ──
                // ── โดน FIFO บล็อกไว้เพราะรองานเก่ากว่าที่ waiting_ap อยู่ -- ต้อง ──
                // ── เช็คแยกให้ชัดว่ามีงาน pending ค้างจริงไหม ถ้ามีห้ามหยุด Loop ──────
                // ── (ไม่งั้นงานที่ถูกบล็อกไว้จะไม่มีใครมาหยิบทำต่ออีกเลย) ──────────
                const { rows: stillPending } = await pool.query(
                    `SELECT 1 FROM docenter_ocr_queue WHERE status = 'pending' LIMIT 1`
                );
                if (stillPending[0]) {
                    await new Promise(r => setTimeout(r, 5000)); // รองานเก่ากว่าที่ waiting_ap อยู่
                    continue;
                }
                workerRunning = false;
                console.log('[queue] Worker loop stopped — no pending jobs');
                break;
            }
            await processOneJob(rows[0].id);
        } catch (err) {
            console.error('[queue] Worker loop error:', err.message);
            await new Promise(r => setTimeout(r, 3000));
        }
    }
}

// ── Helper: ดึง queue snapshot พร้อมลำดับ #1 #2 #3 ──────────────────────────
async function getQueueSnapshot() {
    try {
        const { rows } = await pool.query(`
            SELECT id, file_name, status, uploaded_by, priority,
                   created_at, updated_at, error_msg,
                   ROW_NUMBER() OVER (
                       PARTITION BY status
                       ORDER BY priority DESC NULLS LAST, created_at ASC
                   ) AS position_in_status,
                   -- MARKER_DOCENTER_OCR_SNAPSHOT_ORDER_BY_TIME_V1
                   -- ── เดิมจัดกลุ่มตาม Status ก่อน (ocring > pending > waiting_ap) ──
                   -- ── ทำให้ไฟล์เก่ากว่าที่กำลัง waiting_ap ถูกเลข #2 ทั้งที่มาก่อน ──
                   -- ── ไฟล์ใหม่กว่าที่ยัง pending ซึ่งได้ #1 -- ตัดกลุ่ม Status ออก ──
                   -- ── เรียงตามเวลาเข้าคิวจริงอย่างเดียว ให้ตรงกับลำดับประมวลผล ──────
                   -- ── จริงที่ Worker Loop ใช้ (MARKER_DOCENTER_OCR_STRICT_FIFO_V1) ──
                   ROW_NUMBER() OVER (
                       ORDER BY priority DESC NULLS LAST, created_at ASC
                   ) AS queue_position
            FROM docenter_ocr_queue
            WHERE status IN ('pending','ocring','waiting_ap','error','needs_review')
            ORDER BY queue_position
        `);
        return rows;
    } catch (_) { return []; }
}

function enqueueOcrJob() {
    startWorkerLoop().catch(e => console.error('[queue] startWorkerLoop error:', e.message));
}

async function processOneJob(queueId, retryCount = 0) {
    // ── ตรวจ AP OCR priority ─────────────────────────────────────────────────
    // AP OCR (ocr_queue_pages) มี priority สูงกว่า — ถ้ามีงาน AP OCR อยู่
    // ให้ DocCenter OCR รอก่อน ไม่แย่ง CPU Core เดียวกัน
    const MAX_RETRY = 10;
    const RETRY_DELAY_MS = 30_000; // รอ 30 วิต่อรอบ

    if (retryCount < MAX_RETRY) {
        const apBusy = await isApOcrBusy();
        if (apBusy) {
            console.log(`[queue] AP OCR กำลังทำงาน → DocCenter OCR รอ (retry ${retryCount+1}/${MAX_RETRY}) queueId=${queueId}`);
            await pool.query(
                `UPDATE docenter_ocr_queue SET status='waiting_ap', updated_at=NOW() WHERE id=$1`,
                [queueId]
            );
            await logCentralQueue('waiting_ap', {
                source: 'docenter', source_id: queueId,
                detail: { retry: retryCount + 1, reason: 'AP OCR busy' }
            });
            getQueueSnapshot().then(snapshot => broadcastQueueUpdate('queue_update', { snapshot }));
            setTimeout(() => processOneJob(queueId, retryCount + 1), RETRY_DELAY_MS);
            return;
        }
    }
    // เกิน MAX_RETRY → รันเลย ไม่รอ AP OCR อีก
    if (retryCount >= MAX_RETRY) {
        console.log(`[queue] รอ AP OCR นานเกินไป (${MAX_RETRY} รอบ) → บังคับรัน DocCenter OCR queueId=${queueId}`);
    }

    // อัปเดต status → ocring
    await pool.query(
        `UPDATE docenter_ocr_queue SET status='ocring', updated_at=NOW() WHERE id=$1`,
        [queueId]
    );
    getQueueSnapshot().then(snapshot => broadcastQueueUpdate('queue_update', { snapshot }));
    try {
        const { rows } = await pool.query(
            'SELECT file_name, file_data, rotation, doc_type, folder_id, menu_id, uploaded_by FROM docenter_ocr_queue WHERE id=$1',
            [queueId]
        );
        if (!rows[0]) throw new Error('Queue item not found');

        const { file_name, file_data, rotation, doc_type, folder_id, menu_id, uploaded_by: uploader } = rows[0];
        const pdfBuffer = Buffer.from(file_data, 'base64');

        // MARKER_DOCENTER_GROUP_MATCH_V2
        // ── Phase 1: Lightweight OCR (Streaming NDJSON) -- OCR แค่ 35% บน ──────
        // ── ของทุกหน้า แทน Full OCR ทั้ง PDF ทันที ─────────────────────────────
        const pageSignals = await runLightweightOcrStreaming(pdfBuffer, file_name, rotation, (progress) => {
            broadcastQueueUpdate('lightweight_progress', { queue_id: queueId, ...progress });
        });

        // ── Phase 2: จับกลุ่มหน้าเป็นเอกสาร ───────────────────────────────────
        const groups = groupPagesByDocument(pageSignals);

        // ── Phase 3: Match แต่ละ Group กับ doc_collection ────────────────────
        let autoMatchedPages = 0;
        let needsReviewCount = 0;

        for (let gi = 0; gi < groups.length; gi++) {
            const g = groups[gi];
            let best = null;
            try {
                best = await findBestMatchForGroup(g);
            } catch (e) {
                console.error(`[docenter-group-match] find-match error queue=${queueId} group=${gi}:`, e.message);
            }
            const matched = !!(best && best.confidence === 100);

            let previewImages = [];
            try {
                previewImages = await extractPagesAsImages(pdfBuffer, file_name, g.pages, rotation);
            } catch (e) {
                console.error(`[docenter-group-match] extract-pages error queue=${queueId} group=${gi}:`, e.message);
            }

            let finalStatus = matched ? 'matched_attached' : 'needs_review';
            let groupErrMsg = null;

            if (matched) {
                try {
                    const attachPayload = previewImages.map(p => ({
                        name: `${file_name}_p${p.page}.jpg`, data: p.data, mime: 'image/jpeg', source: 'ocr_auto_match',
                    }));
                    await pool.query(
                        `UPDATE doc_collection SET attachments = COALESCE(attachments, '[]'::jsonb) || $2::jsonb, updated_at = NOW() WHERE id = $1`,
                        [best.doc_collection_id, JSON.stringify(attachPayload)]
                    );
                    autoMatchedPages += g.pages.length;
                } catch (e) {
                    console.error(`[docenter-group-match] auto-attach error queue=${queueId} group=${gi}:`, e.message);
                    finalStatus = 'needs_review';
                    groupErrMsg = e.message;
                    needsReviewCount++;
                }
            } else {
                needsReviewCount++;
            }

            await pool.query(
                `INSERT INTO docenter_ocr_groups
                   (queue_id, group_index, pages, doc_type, vendor_name, invoice_number, branch, amount,
                    gr_transaction_no, matched, confidence, matched_doc_collection_id, matched_serial_code,
                    status, preview_images, error_msg)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
                [queueId, gi, g.pages, g.doc_type, g.vendor_name, g.invoice_number, g.branch, g.amount,
                 g.gr_transaction_no, finalStatus === 'matched_attached', best ? best.confidence : 0,
                 best ? best.doc_collection_id : null, best ? best.serial_code : null,
                 finalStatus, JSON.stringify(previewImages), groupErrMsg]
            );

            broadcastQueueUpdate('lightweight_progress', {
                queue_id: queueId,
                pages_checked: g.pages[g.pages.length - 1],
                total_pages: pageSignals.length,
                auto_matched_pages: autoMatchedPages,
                groups_done: gi + 1,
                groups_total: groups.length,
            });
        }

        // ── สรุปผล Queue Job ──────────────────────────────────────────────────
        if (needsReviewCount === 0) {
            // ทุก Group Match 100% หมด -- จบงานเลย ไม่ต้อง Full OCR แม้แต่หน้าเดียว
            await pool.query(
                `UPDATE docenter_ocr_queue SET status='done', result_meta=$2, updated_at=NOW() WHERE id=$1`,
                [queueId, JSON.stringify({ auto_matched_all: true, total_pages: pageSignals.length, groups: groups.length })]
            );
            console.log(`[queue] Auto-matched ALL: ${file_name} -> ${groups.length} group(s), ${pageSignals.length} page(s) -- ข้าม Full OCR ทั้งหมด`);
            await logCentralQueue('done', { source:'docenter', source_id:queueId, file_name, uploaded_by:uploader, priority_class:2, detail:{ auto_matched_all: true, groups: groups.length } });
            broadcastQueueUpdate('queue_done', { id: queueId, file_name, auto_matched_all: true, groups: groups.length });
        } else {
            // เหลือ Group ที่ไม่ Match -- รอ User กด "เพิ่ม" เอง (Manual Gate) ก่อนเข้า Full OCR
            await pool.query(
                `UPDATE docenter_ocr_queue SET status='needs_review', result_meta=$2, updated_at=NOW() WHERE id=$1`,
                [queueId, JSON.stringify({ auto_matched_pages: autoMatchedPages, needs_review_groups: needsReviewCount, total_pages: pageSignals.length, groups: groups.length })]
            );
            console.log(`[queue] Split+Match เสร็จ: ${file_name} -> ${autoMatchedPages} หน้า Auto-Matched, ${needsReviewCount} Group รอ User กด "เพิ่ม"`);
            await logCentralQueue('needs_review', { source:'docenter', source_id:queueId, file_name, uploaded_by:uploader, priority_class:2, detail:{ auto_matched_pages: autoMatchedPages, needs_review_groups: needsReviewCount } });
        }
        getQueueSnapshot().then(snapshot => broadcastQueueUpdate('queue_update', { snapshot }));
    } catch (err) {
        console.error(`[queue] OCR error queueId=${queueId}:`, err.message);
        await logCentralQueue('error', { source:'docenter', source_id:queueId, priority_class:2, detail:{ error:err.message } });
        broadcastQueueUpdate('queue_error', { id: queueId, error: err.message });
        getQueueSnapshot().then(snapshot => broadcastQueueUpdate('queue_update', { snapshot }));
        await pool.query(
            `UPDATE docenter_ocr_queue SET status='error', error_msg=$2, updated_at=NOW() WHERE id=$1`,
            [queueId, err.message]
        );
    }
}

// ── GET /api/docenter/central-queue — ดึง Central Queue รวมทั้งระบบ ─────────
// ใช้โดย Home widget และ User Management Queue Monitor
router.get('/central-queue', async (req, res) => {
    const { role, limit = 50 } = req.query;
    const username = req.headers['x-username'] || '';
    const isOwnerOrAdmin = role === 'owner' || role === 'admin';
    try {
        // รวม 2 แหล่ง: docenter_ocr_queue + ocr_queue_pages (AP OCR)
        // MARKER_DOCENTER_CENTRALQUEUE_ORDERBY_SUBQUERY_FIX_V1
        // -- ห่อ UNION ALL เป็น Subquery -- Postgres ไม่ยอมให้ ORDER BY ของ UNION --
        // -- ใช้ Expression (CASE...END) ตรงๆ ต้องย้ายออกมานอก Subquery แทน --
        const { rows } = await pool.query(`
          SELECT * FROM (
            SELECT
                'docenter'     AS source,
                d.id           AS source_id,
                d.file_name,
                d.status,
                d.uploaded_by,
                d.created_at,
                d.updated_at,
                2              AS priority_class,
                'Document Center OCR' AS queue_type,
                d.error_msg    AS error_msg
            FROM docenter_ocr_queue d
            WHERE ($1 OR d.uploaded_by = $2)
              AND d.status IN ('pending','ocring','waiting_ap','error','done','needs_review')
              AND d.created_at > NOW() - INTERVAL '24 hours'

            UNION ALL

            SELECT
                'ap_ocr'       AS source,
                p.id           AS source_id,
                p.image_path   AS file_name,
                p.status,
                -- MARKER_DOCENTER_CENTRALQUEUE_UPLOADEDBY_SELECT_CAST_FIX_V1
                -- UNION ALL ต้องการ Type เข้ากันได้กับ d.uploaded_by (Text) -- Cast ตรงนี้ด้วย --
                b.uploaded_by::text AS uploaded_by,
                p.created_at,
                -- MARKER_DOCENTER_OCR_CENTRALQUEUE_UPDATEDAT_FIX_V1
                -- ── Table ocr_queue_pages ไม่มี Column updated_at อยู่จริง ──────────
                -- ── (COALESCE(p.updated_at, ...) Error "column p.updated_at does ──
                -- ── not exist" ทุกครั้งที่เรียก Endpoint นี้) ใช้ created_at แทนตรงๆ ──
                p.created_at AS updated_at,
                1              AS priority_class,
                'AP OCR'       AS queue_type,
                p.error_message AS error_msg
            FROM ocr_queue_pages p
            LEFT JOIN ocr_upload_batches b ON b.id = p.batch_id
            -- MARKER_DOCENTER_CENTRALQUEUE_UPLOADEDBY_CAST_FIX_V1
            -- b.uploaded_by (ocr_upload_batches) เป็นคนละ Type กับ $2 (Text) --
            -- Cast เป็น ::text ก่อนเทียบ -- เดิม Error 42883 "operator does not exist" --
            WHERE ($1 OR b.uploaded_by::text = $2)
              AND p.status IN ('pending','processing','done','failed')
              AND p.created_at > NOW() - INTERVAL '24 hours'
          ) AS combined

            -- MARKER_DOCENTER_CENTRALQUEUE_ORDER_FIX_V1
            -- ── FIX: เดิม created_at DESC (ใหม่ไปเก่า) ทำให้ไฟล์เก่ากว่าที่ ──
            -- ── กำลังประมวลผลอยู่ถูกแสดงท้ายสุด ทั้งที่ควรได้เลข #1 -- เปลี่ยน ──
            -- ── เป็น ASC ให้ตรงกับ getQueueSnapshot() (Strict FIFO ที่แก้แล้ว) ──
            ORDER BY
                CASE status
                    WHEN 'processing'    THEN 1
                    WHEN 'ocring'        THEN 1
                    WHEN 'pending'       THEN 2
                    WHEN 'needs_review'  THEN 2
                    WHEN 'waiting_ap'    THEN 3
                    WHEN 'done'          THEN 4
                    ELSE 5
                END,
                priority_class ASC,
                created_at ASC
            LIMIT $3
        `, [isOwnerOrAdmin, username, parseInt(limit)]);
        return res.json(rows);
    } catch (err) {
        // MARKER_DOCENTER_CENTRALQUEUE_LOG_ERROR_V1 -- Log ให้เห็นสาเหตุจริงใน Log File (เดิมไม่มี Log เลย)
        console.error('[central-queue] Error:', err);
        return res.status(500).json({ error: err.message });
    }
});

// ── Startup: เช็คคิวที่ค้างอยู่ตอน backend restart ──────────────────────────
// ถ้ามี pending/ocring ค้าง → start service (ถ้ายังไม่รัน) + trigger worker loop
// (รวมจาก 2 บล็อกซ้ำเดิม — เดิม query COUNT(*) เดียวกันซ้ำ 2 ครั้ง + เรียก
// enqueueOcrJob() ซ้ำ 2 ครั้งทุกครั้งที่ backend restart โดยไม่จำเป็น)
(async () => {
    try {
        const { rows } = await pool.query(`
            SELECT COUNT(*) AS cnt
            FROM docenter_ocr_queue
            WHERE status IN ('pending', 'ocring')
        `);
        if (parseInt(rows[0].cnt) > 0) {
            console.log(`[queue] Startup: found ${rows[0].cnt} pending/ocring job(s) — starting worker loop`);
            const { stdout } = await execAsync(`sc query ${OCR_SERVICE_NAME}`).catch(() => ({ stdout: '' }));
            if (!stdout.includes('RUNNING')) {
                await scCommand('start');
                console.log('[queue] Startup: docenter-ocr service started');
            }
            enqueueOcrJob();
        }
    } catch (_) {}
})();


export default router;