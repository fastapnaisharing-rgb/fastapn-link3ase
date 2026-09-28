import { Router } from "express";
import { pool } from "../db.js";

// MARKER_ROUTE_SUPPLIER_SEARCH_V1
// ── Server-side Search แทนของเดิมที่ SupplierSearchPopup (APController.js) ──
// ── ดึงทั้ง supplier_list มาที่ Client แล้ว Filter/Sort เองทุก Keystroke ──
// ── ย้ายมา Filter/Sort ที่ DB ผ่าน search_text (GENERATED Column + pg_trgm) ──
// ── หมายเหตุ: buHasOwnCodes/effectiveBookFilter คำนวณฝั่ง Frontend แล้วส่ง ──
// ── effectiveBookFilter ที่ Resolve เสร็จมาให้เลย (Frontend ต้องดึง supplierItems ──
// ── เต็มก้อนอยู่แล้วเพื่อใช้เช็ค invoiceRuleMatch จุดอื่น เลยไม่ต้องคำนวณซ้ำที่นี่) ──

const router = Router();

// Whitelist Column สำหรับ Sort -- กัน SQL Injection ผ่านชื่อ Column (Parameterize ค่า Column ตรงๆ ไม่ได้)
const SORT_COLUMNS = {
  "Code": '"Code"',
  "BU Code": '"BU Code"',
  "Supplier Name": '"Supplier Name"',
  "Supplier Number": '"Supplier Number"',
  "Supplier Site": '"Supplier Site"',
  "Tax-Type": '"Tax-Type"',
  "Notice": '"Notice"',
};

// GET /api/supplier-search?q=&bu=&bookFilter=&sortField=&sortDir=
// Field ที่ Search: Code, Supplier Name, Supplier Number, Tax ID (ตรงกับ Filter เดิม)
router.get("/supplier-search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const bu = String(req.query.bu || "").trim().toLowerCase();
    const bookFilter = String(req.query.bookFilter || "").trim();
    const sortField = String(req.query.sortField || "Code").trim();
    const sortDir = String(req.query.sortDir || "asc").trim().toLowerCase() === "desc" ? "DESC" : "ASC";
    const orderColumn = SORT_COLUMNS[sortField] || '"Code"';

    const params = [];
    let where = "deleted IS NOT TRUE";

    if (bookFilter) {
      params.push(bookFilter.toUpperCase());
      where += ` AND UPPER(split_part("Code", '-', 1)) = $${params.length}`;
    } else if (bu) {
      params.push(`${bu}-%`);
      params.push(bu);
      where += ` AND (LOWER("Code") LIKE $${params.length - 1} OR LOWER(TRIM("BU Code")) = $${params.length})`;
    }

    if (q) {
      params.push(`%${q}%`);
      where += ` AND search_text ILIKE $${params.length}`;
    }

    params.push(50);
    const sql = `
      SELECT *
      FROM supplier_list
      WHERE ${where}
      ORDER BY ${orderColumn} ${sortDir}
      LIMIT $${params.length}
    `;

    const { rows } = await pool.query(sql, params);
    res.json({ items: rows });
  } catch (err) {
    console.error("[supplier-search] error:", err.message);
    res.status(500).json({ error: "ค้นหา Supplier ไม่สำเร็จ" });
  }
});

export default router;