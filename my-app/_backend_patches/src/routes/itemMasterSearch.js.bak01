import { Router } from "express";
import { pool } from "../db.js";

// MARKER_ROUTE_ITEM_MASTER_SEARCH_V1
// ── Server-side Search แทนของเดิมที่ ItemCodeSearchPopup/RealVendorPopup ──
// ── (APController.js) ดึงทั้ง itemcode_list/sm_code_list มาที่ Client ──
// ── ทั้งก้อนแล้ว Filter เอง — ย้ายมา Filter ที่ DB ผ่าน search_text ──
// ── (GENERATED Column + pg_trgm GIN Index) ให้ตรง Field ที่เคย Search ──
// ── จริงทุกตัว (ตรวจจาก APController.js บรรทัด ~1812 และ ~4138-4141) ──

const router = Router();

// GET /api/itemcode-search?q=&bu=&sourceModule=&favKey=
// Field ที่ Search: code, description, keyword, cpc, account (ตรงกับ Filter เดิมเป๊ะ)
// Prefilter: bu = 'free' หรือ ตรงกับ BU ที่ส่งมา, source_mode ตรงกับ sourceModule หรือ 'All'
router.get("/itemcode-search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const bu = String(req.query.bu || "").trim().toLowerCase();
    const sourceModule = String(req.query.sourceModule || "AP").trim();
    const favKey = String(req.query.favKey || "").trim();
    // MARKER_ITEMCODE_ALLBU_TOGGLE_V1 -- Toggle "ค้นหาทุก BU" ฝั่ง Editor+ (ItemCodeSearchPopup)
    const allBu = String(req.query.allBu || "").trim() === "true";

    const params = [sourceModule];
    let where =
      `deleted IS NOT TRUE` +
      ` AND (source_mode = $1 OR source_mode = 'All')`;

    if (!allBu) {
      params.push(bu);
      where += ` AND (LOWER(bu) = 'free' OR ($${params.length} <> '' AND LOWER(bu) = $${params.length}))`;
    }

    if (q) {
      params.push(`%${q}%`);
      where += ` AND search_text ILIKE $${params.length}`;
    }

    let orderBy = `code ASC`;
    if (favKey) {
      params.push(favKey);
      // favorite_taxids เป็น jsonb -- ใช้ @> เทียบกับ jsonb array ไม่ใช่ Postgres Array
      orderBy = `(favorite_taxids @> jsonb_build_array($${params.length}::text)) DESC, code ASC`;
    }

    params.push(50);
    const sql = `
      SELECT id, code, bu, description, cpc, account, sub, spec_tx,
             dis_g, dis_g_desc, i_and_g, i_and_g_desc, value, value_desc,
             oth, oth_desc, spi1, spi1_desc, spec_tx_desc, keyword,
             source_mode, favorite_taxids
      FROM itemcode_list
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT $${params.length}
    `;

    const { rows } = await pool.query(sql, params);
    res.json({ items: rows });
  } catch (err) {
    console.error("[itemcode-search] error:", err.message);
    res.status(500).json({ error: "ค้นหา Item Code ไม่สำเร็จ" });
  }
});

// GET /api/smcode-search?q=&favKey=
// Field ที่ Search: Company Name, SM-Code เท่านั้น (ตรงกับ Filter เดิม)
// Prefilter บังคับ: Short Name = 'INPUT' เท่านั้น (ตรงกับ inputOnly เดิม)
router.get("/smcode-search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const favKey = String(req.query.favKey || "").trim();

    const params = [];
    let where = `deleted IS NOT TRUE AND UPPER(TRIM("Short Name")) = 'INPUT'`;

    if (q) {
      params.push(`%${q}%`);
      where += ` AND search_text ILIKE $${params.length}`;
    }

    let orderBy = `"Company Name" ASC`;
    if (favKey) {
      params.push(favKey);
      orderBy = `(favorite_taxids @> jsonb_build_array($${params.length}::text)) DESC, "Company Name" ASC`;
    }

    params.push(50);
    const sql = `
      SELECT *
      FROM sm_code_list
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT $${params.length}
    `;

    const { rows } = await pool.query(sql, params);
    res.json({ items: rows });
  } catch (err) {
    console.error("[smcode-search] error:", err.message);
    res.status(500).json({ error: "ค้นหา Vendor ไม่สำเร็จ" });
  }
});

export default router;