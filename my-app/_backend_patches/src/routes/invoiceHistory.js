import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

function canSeeAll(req) {
  const role = req.user?.appRole;
  return role === "Owner" || role === "Admin";
}

// ── GET /api/invoice-history — รวม bucket_list (จริง) + legacy_poc_history ──
// ── (Legacy เห็นเฉพาะ Owner/Admin เหมือน canSeeAll เดิมของหน้า Invoice History) ──
// Query params: all_users=true|false, recent=true|false, date_from, date_to,
//               user_name, limit
router.get("/invoice-history", async (req, res, next) => {
  try {
    const {
      all_users, recent, date_from, date_to, user_name, limit, module,
    } = req.query;

    const isAllUsers = all_users === "true";
    const isRecent = recent === "true";
    const sevenDaysAgoISO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const includeLegacy = isAllUsers && canSeeAll(req) && module !== 'IE';
    // MARKER_INVOICEHISTORY_LEGACY_EXCLUDE_IE_V1 -- legacy_poc_history เป็นข้อมูล
    // เก่าจากระบบก่อนหน้า (ก่อน IE จะมีในระบบด้วยซ้ำ) เป็นของ AP โดยธรรมชาติ
    // ทั้งหมด -- ไม่ควรโผล่ตอนดู History ฝั่ง IE เลย ไม่ว่าจะติ๊ก All Users หรือไม่

    // ── ส่วน bucket_list (Batch จริง) — Filter ตรงกับ fetchHistory เดิมทุกจุด ──
    const actualConditions = [`status = 'done'`];
    const actualValues = [];
    let idx = 1;

    if (!isAllUsers) {
      actualConditions.push(`created_by = $${idx++}`);
      actualValues.push(user_name || req.user?.email || "");
    }
    if (isRecent) {
      actualConditions.push(`exported_at >= $${idx++}`);
      actualValues.push(sevenDaysAgoISO);
    } else {
      actualConditions.push(`exported_at < $${idx++}`);
      actualValues.push(sevenDaysAgoISO);
    }
    if (date_from) {
      actualConditions.push(`receive_date >= $${idx++}`);
      actualValues.push(date_from);
    }
    if (date_to) {
      actualConditions.push(`receive_date <= $${idx++}`);
      actualValues.push(date_to);
    }
    // MARKER_INVOICEHISTORY_MODULE_FILTER_V1
    // -- กรองตาม Module (AP/IE) -- ไม่ส่งมา หรือส่ง 'ALL' = ไม่กรอง (โชว์ทั้งหมด) --
    if (module && module !== 'ALL') {
      actualConditions.push(`module = $${idx++}`);
      actualValues.push(module);
    }

    // MARKER_INVOICEHISTORY_SENTSTAMP_V1 -- LEFT JOIN batch_sent_archive เอา Template
    // Name + วันที่ส่งมาด้วย (Stamp ระดับ Batch ถาวร ไม่มีวันหาย) โชว์เป็น Badge หลังชื่อ Batch
    let sql = `
      SELECT
        bl.batch_id AS batch_name, bl.invoice_no AS invoice, bl.vendor_name AS vendor,
        bl.bu, bl.receive_date, bl.amount, bl.vat, bl.net AS total, bl.exported_at, bl.created_by,
        'actual' AS record_type, bl.id::text AS record_id,
        bsa.template_name AS sent_stamp, bsa.sent_at AS sent_stamp_at
      FROM bucket_list bl
      LEFT JOIN batch_sent_archive bsa ON bsa.batch_id = bl.batch_id
      WHERE ${actualConditions.join(" AND ")}
    `;
    const values = [...actualValues];

    if (includeLegacy) {
      // ── ส่วน legacy_poc_history — ไม่ Filter ตาม created_by (ไม่ใช่ Username จริง) ──
      // ── ใช้ imported_at เทียบ Recent/History เหมือน exported_at ของฝั่งจริง ──────
      const legacyConditions = [];
      const legacyValues = [];
      let lidx = idx;

      if (isRecent) {
        legacyConditions.push(`lp.imported_at >= $${lidx++}`);
        legacyValues.push(sevenDaysAgoISO);
      } else {
        legacyConditions.push(`lp.imported_at < $${lidx++}`);
        legacyValues.push(sevenDaysAgoISO);
      }
      if (date_from) {
        legacyConditions.push(`lp.doc_date >= $${lidx++}`);
        legacyValues.push(date_from);
      }
      if (date_to) {
        legacyConditions.push(`lp.doc_date <= $${lidx++}`);
        legacyValues.push(date_to);
      }

      // MARKER_INVOICEHISTORY_SENTSTAMP_V1 -- เพิ่ม NULL 2 คอลัมน์ให้ตรงจำนวนกับฝั่ง actual (Legacy ไม่มี Stamp นี้)
      sql += `
        UNION ALL
        SELECT
          lp.po_num AS batch_name, lp.invoice_num AS invoice,
          COALESCE(sl."Supplier Name", lp.vendor_no) AS vendor,
          NULL AS bu, lp.doc_date AS receive_date, lp.amount,
          NULL::numeric AS vat, lp.amount AS total,
          lp.imported_at AS exported_at, lp.source AS created_by,
          'legacy' AS record_type, lp.id::text AS record_id,
          NULL AS sent_stamp, NULL::timestamptz AS sent_stamp_at
        FROM legacy_poc_history lp
        LEFT JOIN supplier_list sl ON sl."Supplier Number" = lp.vendor_no
        ${legacyConditions.length ? `WHERE ${legacyConditions.join(" AND ")}` : ""}
      `;
      values.push(...legacyValues);
      idx = lidx;
    }

    sql += ` ORDER BY exported_at DESC`;
    if (limit) {
      sql += ` LIMIT $${idx++}`;
      values.push(parseInt(limit, 10));
    }

    const { rows } = await pool.query(sql, values);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/legacy_poc_history/:id — Field เต็มสำหรับ Detail Popup (Owner/Admin) ──
router.get("/legacy_poc_history/:id", async (req, res, next) => {
  try {
    if (!canSeeAll(req)) {
      return res.status(403).json({ error: "ไม่มีสิทธิ์ดูข้อมูลนี้" });
    }
    const { rows } = await pool.query(
      `SELECT * FROM legacy_poc_history WHERE id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// MARKER_DUPLICATE_CHECK_CONFIDENCE_SCORE_V1
// ── Helper: Levenshtein Distance (เทียบว่า Invoice No. สองตัวต่างกันกี่ตัวอักษร) ──
function levenshteinDistance(a, b) {
  a = String(a || "");
  b = String(b || "");
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

// ── Helper: ตัด First Part/Last Part ของ Vendor ออกจาก Invoice No. เหลือแค่ "เลขรันจริง" ──
// ── (Field เดียวกับที่ Frontend ใช้คำนวณ Invoice No. ตอนกรอก -- ดู APController.js) ──
// ── เทียบ Edit Distance บนส่วนนี้แม่นกว่าเทียบทั้งก้อน เพราะ Prefix/Suffix คงที่อยู่แล้ว ──
function extractCoreRunningNumber(invoiceNo, firstPart, lastPart) {
  let core = String(invoiceNo || "").trim();
  const fp = String(firstPart || "").trim();
  const lp = String(lastPart || "").trim();
  if (fp && core.toUpperCase().startsWith(fp.toUpperCase())) {
    core = core.slice(fp.length);
  }
  if (lp && core.toUpperCase().endsWith(lp.toUpperCase())) {
    core = core.slice(0, core.length - lp.length);
  }
  return core;
}

// ── GET /api/invoice-duplicate-check — Exact Match (RED) + Confidence Score (YELLOW) ──
// ── ทุก Role ใช้ได้ — เช็คทั้ง bucket_list + legacy_poc_history พร้อมกัน ──────
// ── เดิม related_by_po/related_by_amount ขึ้นเตือนทันทีแค่เจอเงื่อนไขเดียว (PO ──
// ── ตรง หรือ Amount ตรง) ไม่คำนึงเงื่อนไขอื่นเลย ทำให้เตือนพร่ำเพรื่อ (PO ซ้ำกัน ──
// ── ข้าม Vendor เพราะไม่เคยเช็ค Vendor, จ่ายค่าประจำยอดเท่ากันทุกเดือน) -- เปลี่ยน ──
// ── เป็นคะแนนสะสมแบบถ่วงน้ำหนัก ต้อง >= 70 คะแนนถึงจะขึ้นเตือน (ตกลงกับ User แล้ว) ──
router.get("/invoice-duplicate-check", async (req, res, next) => {
  try {
    const { vendor_no, invoice_no, po_num, amount, inv_date, bu } = req.query;
    if (!vendor_no || !invoice_no) {
      return res.status(400).json({ error: "ต้องระบุ vendor_no และ invoice_no" });
    }

    // ── RED: Exact Match -- Vendor + Invoice No. ตรงเป๊ะ (+ BU ตรงด้วยถ้าส่งมา) = Duplicate 100% ──
    // ── คนละ BU ไม่นับว่าซ้ำ (ตกลงกับ User แล้ว) -- legacy_poc_history ไม่มี ──────
    // ── Column bu เก็บไว้ (ข้อมูลเก่าก่อนระบบนี้) เลยไม่เช็ค BU ฝั่ง Legacy ได้ ──────
    // MARKER_INVOICE_DUP_RED_REMOVE_RECEIVEDATE_GATE_V1
    // -- Bug เดิม: เทียบ inv_date (วันที่ Invoice) กับ Column receive_date (วันที่รับงาน --
    // -- ของ Batch -- คนละ Field กันคนละความหมาย) ทำให้ Vendor+Invoice No. ตรงเป๊ะ --
    // -- หลุดจาก RED ทุกครั้งที่ receive_date ของ Batch ใหม่ไม่ตรง Batch เดิม (ปกติไม่ --
    // -- ตรงกันอยู่แล้ว) -- ตัดเงื่อนไข Date ออก: Vendor+Invoice No.(+BU) ตรง = ซ้ำ 100% --
    const { rows } = await pool.query(
      `
      SELECT
        'actual' AS record_type, batch_id AS ref, invoice_no, vendor_no,
        vendor_name, amount, exported_at, NULL AS po_num
      FROM bucket_list
      WHERE vendor_no = $1 AND invoice_no = $2
        AND ($3::text IS NULL OR bu = $3)

      UNION ALL

      SELECT
        'legacy' AS record_type, lp.po_num AS ref, lp.invoice_num AS invoice_no,
        lp.vendor_no, COALESCE(sl."Supplier Name", lp.vendor_no) AS vendor_name,
        lp.amount, lp.imported_at AS exported_at, lp.po_num
      FROM legacy_poc_history lp
      LEFT JOIN supplier_list sl ON sl."Supplier Number" = lp.vendor_no
      WHERE lp.vendor_no = $1 AND lp.invoice_num = $2
      `,
      [vendor_no, invoice_no, bu || null]
    );

    // ── YELLOW: Confidence Score -- Vendor ตรงกันเป็น Gate เสมอ (WHERE บังคับ) ──
    // ── ถ้าส่ง bu มา ก็ Gate ด้วย (เฉพาะ bucket_list -- legacy ไม่มี bu ให้เช็ค) ────
    let relatedMatches = [];
    if (rows.length === 0) {
      const { rows: vendorRows } = await pool.query(
        `SELECT "First Part", "Last Part" FROM supplier_list WHERE "Supplier Number" = $1 LIMIT 1`,
        [vendor_no]
      );
      const firstPart = vendorRows[0]?.["First Part"] || "";
      const lastPart = vendorRows[0]?.["Last Part"] || "";
      const currentCore = extractCoreRunningNumber(invoice_no, firstPart, lastPart);

      // MARKER_INVOICE_DUP_YELLOW_SPLIT_SUM_AND_INVDATE_V1
      // -- ตัด Suffix /1, /2, _NV ออกจาก invoice_no ก่อน แล้ว GROUP BY + SUM(amount) --
      // -- ต่อ 1 Invoice จริง (เดิมเทียบยอดทีละแถว Split แยกกัน ทำให้เทียบผิด) --
      // -- และเทียบ Invoice Date กับ Column inv_date จริง (เดิมใช้ exported_at ผิด) --
      const { rows: candidates } = await pool.query(
        `
        SELECT 'actual' AS record_type, ref, base_invoice_no AS invoice_no, vendor_no,
               vendor_name, amount, exported_at, inv_date, bu, NULL AS po_num
        FROM (
          SELECT
            regexp_replace(invoice_no, '(/\d+|_NV)$', '') AS base_invoice_no,
            vendor_no, bu,
            MAX(batch_id) AS ref,
            MAX(vendor_name) AS vendor_name,
            SUM(amount) AS amount,
            MAX(exported_at) AS exported_at,
            MAX(inv_date) AS inv_date
          FROM bucket_list
          -- MARKER_INVOICE_DUP_YELLOW_LIMIT_HISTORY_6M_V1
          -- ตัด History ที่เก่าเกิน 6 เดือนออกก่อน Group (ตกลงกับ User แล้ว) --
          -- ใช้ inv_date (วันที่ Invoice จริง) ไม่ใช่ exported_at เพราะ Invoice --
          -- ที่ยัง Pending (ยังไม่ Gen) ไม่มี exported_at -- ถ้าใช้ตัวนั้นกรอง --
          -- Invoice Pending จะหลุดจาก Candidate ไปเลยทั้งหมด --
          WHERE vendor_no = $1
            AND inv_date >= (CURRENT_DATE - INTERVAL '6 months')
          GROUP BY regexp_replace(invoice_no, '(/\d+|_NV)$', ''), vendor_no, bu
        ) grouped
        WHERE base_invoice_no != $2
          AND ($3::text IS NULL OR bu = $3)

        UNION ALL

        SELECT 'legacy' AS record_type, lp.po_num AS ref, lp.invoice_num AS invoice_no,
               lp.vendor_no, COALESCE(sl."Supplier Name", lp.vendor_no) AS vendor_name,
               lp.amount, lp.imported_at AS exported_at, NULL::date AS inv_date, NULL AS bu, lp.po_num
        FROM legacy_poc_history lp
        LEFT JOIN supplier_list sl ON sl."Supplier Number" = lp.vendor_no
        WHERE lp.vendor_no = $1 AND lp.invoice_num != $2

        ORDER BY exported_at DESC
        LIMIT 100
        `,
        [vendor_no, invoice_no, bu || null]
      );

      const currentAmount = amount != null && amount !== "" ? parseFloat(amount) : null;
      const currentDate = inv_date ? new Date(inv_date) : null;

      for (const c of candidates) {
        let score = 0;
        const reasons = [];

        // MARKER_INVOICE_DUP_YELLOW_SPLIT_SUM_AND_INVDATE_V1
        // -- Amount: เทียบยอดรวมหลัง Sum Split แล้ว -- เท่ากันเป๊ะ (<=1 บาท) = +35 --
        // -- ใกล้เคียง (<=5 บาท แต่ไม่เท่ากันเป๊ะ) = +10 (คะแนนน้อยกว่าเท่ากันเป๊ะ) --
        if (currentAmount != null && c.amount != null) {
          const diff = Math.abs(currentAmount - parseFloat(c.amount));
          if (diff <= 1) { score += 35; reasons.push("amount_match"); }
          else if (diff <= 5) { score += 10; reasons.push("amount_close"); }
        }

        // PO ตรงกัน (ต้องมี po_num ส่งมาด้วย)
        if (po_num && c.po_num && String(po_num).trim() === String(c.po_num).trim()) {
          score += 30; reasons.push("po_match");
        }

        // Invoice No. ใกล้เคียง (Edit Distance บนเลขรันจริงหลังตัด First/Last Part)
        const candCore = extractCoreRunningNumber(c.invoice_no, firstPart, lastPart);
        const dist = levenshteinDistance(currentCore, candCore);
        if (dist <= 2) { score += 25; reasons.push("invoiceno_very_close"); }
        else if (dist <= 5) { score += 10; reasons.push("invoiceno_close"); }
        else { score -= 70; reasons.push("invoiceno_far"); }

        // MARKER_INVOICE_DUP_YELLOW_SPLIT_SUM_AND_INVDATE_V1
        // -- Invoice Date ห่างกัน -- เทียบกับ inv_date จริงของ bucket_list (เดิมเทียบ --
        // -- exported_at ผิด -- legacy_poc_history ไม่มี inv_date เลยข้ามเงื่อนไขนี้ไป --
        if (currentDate && c.inv_date) {
          const days = Math.abs((currentDate - new Date(c.inv_date)) / 86400000);
          if (days <= 3) { score += 10; reasons.push("date_close"); }
          else if (days > 30) { score -= 10; reasons.push("date_far"); }
        }

        if (score >= 70) {
          relatedMatches.push({ ...c, confidence_score: score, match_reasons: reasons });
        }
      }
      relatedMatches.sort((a, b) => b.confidence_score - a.confidence_score);
    }

    res.json({
      is_duplicate: rows.length > 0,
      matches: rows,
      related_by_po: [],
      related_by_amount: relatedMatches,
      has_warning: rows.length === 0 && relatedMatches.length > 0,
    });
  } catch (err) {
    next(err);
  }
});

// MARKER_INVOICE_DIGIT_CHECK_V1 -- เช็คว่าความยาว Invoice No. (ตัด /N, _NV ออกก่อน) ผิดปกติจาก
// ค่าเฉลี่ยย้อนหลังของ Supplier นี้ไหม (ข้อมูลจริงที่เคย Submit ผ่านแล้วใน History
// ต้องครบทุกหลักอยู่แล้ว เอามาเป็นฐานเทียบแทนการเดา) -- Idea จาก User: "Data ที่
// ออกไปมันต้องเต็ม ไปดักจาก History ได้ไหม"
function stripInvoiceSuffix(s) {
  return String(s || "").replace(/(\/\d+|_NV)$/, "");
}

// GET /api/invoice-digit-check?vendor_no=&invoice_no=
router.get("/invoice-digit-check", async (req, res, next) => {
  try {
    const { vendor_no, invoice_no } = req.query;
    if (!vendor_no || !invoice_no) {
      return res.status(400).json({ error: "ต้องระบุ vendor_no และ invoice_no" });
    }

    const currentLen = stripInvoiceSuffix(invoice_no).length;

    const { rows } = await pool.query(
      `
      SELECT invoice_no AS num FROM bucket_list WHERE vendor_no = $1 AND invoice_no IS NOT NULL

      UNION ALL

      SELECT invoice_num AS num FROM legacy_poc_history WHERE vendor_no = $1 AND invoice_num IS NOT NULL
      `,
      [vendor_no]
    );

    const lengths = rows
      .map((r) => stripInvoiceSuffix(r.num).length)
      .filter((len) => len > 0);

    // ตัวอย่างน้อยกว่า 5 ใบ -- ข้อมูลย้อนหลังยังน้อยเกินไป ไม่มั่นใจพอจะเตือน
    if (lengths.length < 5) {
      return res.json({ has_history: false, warning: false, sample_size: lengths.length });
    }

    // MARKER_INVOICE_DIGIT_CHECK_MODE_BASED_V2 -- เปลี่ยนจากเทียบ "ค่าเฉลี่ย +/- 2 ตัวอักษร" เป็นเทียบ "ค่าที่คีย์บ่อยที่สุด (Mode)"
    // เพราะ Supplier ที่คีย์ความยาวเดิมซ้ำๆ สม่ำเสมอ (เช่น 10 หลักตลอด) ต่างไปแม้แค่ 1 หลัก
    // ก็ถือว่าผิดปกติแล้ว -- ถ้าประวัติ Supplier นี้ความยาวไม่คงที่อยู่แล้ว (สลับไปมา) ก็ไม่ต้องเตือน
    const freq = {};
    lengths.forEach((len) => { freq[len] = (freq[len] || 0) + 1; });
    const modeLen = Number(Object.keys(freq).reduce((a, b) => (freq[a] >= freq[b] ? a : b)));
    const modeRatio = freq[modeLen] / lengths.length;
    // Supplier ต้องคีย์ความยาวเดิมซ้ำ >= 70% ของประวัติ ถึงจะถือว่ามี "ความยาวมาตรฐาน" ชัดพอจะเตือน
    const CONSISTENCY_THRESHOLD = 0.7;
    const isConsistent = modeRatio >= CONSISTENCY_THRESHOLD;

    res.json({
      has_history: true,
      sample_size: lengths.length,
      mode_length: modeLen,
      mode_ratio: Math.round(modeRatio * 100),
      current_length: currentLen,
      warning: isConsistent && currentLen !== modeLen,
    });
  } catch (err) {
    next(err);
  }
});

// MARKER_INVOICE_TRANSACTIONS_BY_USER_ENDPOINT_V1
// -- GET /api/invoice-transactions-by-user -- นับ Transaction (1 Invoice = 1 Transaction --
// -- ตัด Suffix /1 /2 _NV ก่อนนับ กัน Split Invoice นับซ้ำ) แยกราย created_by/เดือน/Module --
// -- ดึงจาก bucket_list ตรงๆ ไม่มีตาราง Summary แยก (bucket_list ไม่มี Cron ลบ เก็บถาวร) --
// -- Owner/Admin เท่านั้น เพราะเป็นข้อมูล Productivity ข้าม User ทั้งทีม -----------------
// -- ยังไม่มี UI เรียกใช้ -- เก็บไว้ก่อนตามที่ตกลงกัน รอออกแบบ Display ทีหลัง -----------
router.get("/invoice-transactions-by-user", async (req, res, next) => {
  try {
    if (!canSeeAll(req)) return res.status(403).json({ error: "ไม่มีสิทธิ์เข้าถึง" });

    const { module, date_from, date_to } = req.query;
    const conditions = [];
    const params = [];
    if (module) { params.push(module); conditions.push(`module = $${params.length}`); }
    if (date_from) { params.push(date_from); conditions.push(`created_at >= $${params.length}::date`); }
    if (date_to) { params.push(date_to); conditions.push(`created_at < $${params.length}::date + INTERVAL '1 day'`); }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    // MARKER_INVOICE_TRANSACTIONS_BY_USER_ENDPOINT_V2
    // -- นับ Invoice = นับ H เท่านั้น (Split เป็นคนละ Invoice ตาม Row จริงใน DB) --
    // -- นับ Transaction = นับทั้ง H+L รวมกัน (1H+3L = 1 Invoice, 4 Transaction) --
    // -- ต้อง status='done' เท่านั้น -- Pending ยังไม่นับ เพราะยังเปลี่ยนใจได้ --
    // -- Delete/Restore ไม่ต้องมี Logic พิเศษ -- Query สดจาก bucket_list ตรงๆ --
    const { rows } = await pool.query(
      `
      SELECT
        created_by,
        DATE_TRUNC('month', created_at) AS month,
        module,
        COUNT(*) FILTER (WHERE line->>'hl' = 'H') AS invoice_count,
        COUNT(*) AS transaction_count
      FROM bucket_list, jsonb_array_elements(lines) AS line
      ${where ? where + " AND status = 'done'" : "WHERE status = 'done'"}
      GROUP BY created_by, DATE_TRUNC('month', created_at), module
      ORDER BY month DESC, transaction_count DESC
      `,
      params
    );

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

export default router;