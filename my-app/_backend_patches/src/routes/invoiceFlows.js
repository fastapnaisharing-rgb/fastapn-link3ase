import { Router } from "express";
import { pool } from "../db.js";

/**
 * Invoice Entry Flows — จำชุด Item Code (H/L) ที่ใช้ซ้ำบ่อยต่อ Vendor
 * เพื่อช่วยกรอก Invoice เร็วขึ้น (เลือก Flow -> Auto-fill Item Code ทีละบรรทัด
 * ตามจังหวะกด Enter ที่ Frontend, ไม่ใช่ยัดมาทั้งหมดพร้อมกัน)
 *
 * กติกา:
 *  - Shared ทุกคนเห็น/ใช้/บันทึกได้
 *  - ไม่เกิน 5 Flow ต่อ Vendor (เช็คที่นี่ก่อน Insert)
 *  - ลบได้เฉพาะ Owner/Admin
 */

const router = Router();

function canDelete(req) {
  const role = req.user?.appRole;
  return role === "Owner" || role === "Admin";
}

// ── GET /api/invoice-flows?vendor_no=X — รายการ Flow ของ Vendor ──────────
router.get("/", async (req, res, next) => {
  try {
    const { vendor_no } = req.query;
    if (!vendor_no) return res.status(400).json({ error: "ต้องระบุ vendor_no" });

    const { rows } = await pool.query(
      // MARKER_INVOICEFLOWS_ORDER_BY_USECOUNT_V1
      // -- Sort ตามจำนวนครั้งที่ใช้จริง (Submit สำเร็จ) มากไปน้อยก่อน --
      // -- เท่ากัน -> ใหม่ก่อน (created_at DESC) --------------------------
      `SELECT id, flow_name, vendor_no, items, example_lines, example_invoice_no,
              example_date, created_by, created_at, use_count, last_used_at
       FROM invoice_entry_flows
       WHERE vendor_no = $1
       ORDER BY use_count DESC, created_at DESC`,
      [vendor_no]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/invoice-flows — สร้าง Flow ใหม่ (เช็ค Limit 5 ต่อ Vendor) ──
router.post("/", async (req, res, next) => {
  try {
    const {
      flow_name, vendor_no, items,
      example_lines, example_invoice_no, example_date,
    } = req.body || {};

    if (!flow_name?.trim()) return res.status(400).json({ error: "ต้องระบุชื่อ Flow" });
    if (!vendor_no) return res.status(400).json({ error: "ต้องระบุ vendor_no" });
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "ต้องมี Item Code อย่างน้อย 1 บรรทัด" });
    }

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM invoice_entry_flows WHERE vendor_no = $1`,
      [vendor_no]
    );
    if (countRows[0].n >= 5) {
      return res.status(400).json({
        error: `Vendor นี้มี Flow ครบ 5 อันแล้ว (Limit สูงสุด) — ลบหรือแทนที่ Flow เดิมก่อน`,
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO invoice_entry_flows
         (flow_name, vendor_no, items, example_lines, example_invoice_no, example_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        flow_name.trim(), vendor_no, JSON.stringify(items),
        example_lines ? JSON.stringify(example_lines) : null,
        example_invoice_no || null, example_date || null,
        req.user?.email || "unknown",
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/invoice-flows/:id — แทนที่ Flow เดิม (Overwrite) ────────────
router.put("/:id", async (req, res, next) => {
  try {
    const { flow_name, items, example_lines, example_invoice_no, example_date } = req.body || {};
    if (!flow_name?.trim()) return res.status(400).json({ error: "ต้องระบุชื่อ Flow" });
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "ต้องมี Item Code อย่างน้อย 1 บรรทัด" });
    }

    const { rows } = await pool.query(
      `UPDATE invoice_entry_flows
       SET flow_name = $1, items = $2, example_lines = $3,
           example_invoice_no = $4, example_date = $5
       WHERE id = $6
       RETURNING *`,
      [
        flow_name.trim(), JSON.stringify(items),
        example_lines ? JSON.stringify(example_lines) : null,
        example_invoice_no || null, example_date || null,
        req.params.id,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: "ไม่พบ Flow นี้" });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/invoice-flows/:id — ลบ Flow (Owner/Admin เท่านั้น) ───────
router.delete("/:id", async (req, res, next) => {
  try {
    if (!canDelete(req)) {
      return res.status(403).json({ error: "เฉพาะ Owner/Admin เท่านั้นที่ลบ Flow ได้" });
    }
    const { rowCount } = await pool.query(
      `DELETE FROM invoice_entry_flows WHERE id = $1`,
      [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: "ไม่พบ Flow นี้" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// MARKER_INVOICEFLOWS_INCREMENT_USAGE_V1
// -- POST /api/invoice-flows/:id/increment-usage -----------------------
// -- เรียกจาก Frontend ทุกครั้งที่ Submit Invoice สำเร็จโดยมี Flow Active --
// -- +1 use_count และบันทึกเวลาใช้ล่าสุด ใช้เป็นตัวเรียงลำดับความถี่ใน --
// -- Dropdown เลือก Flow (ใช้บ่อยขึ้นก่อน) -------------------------------
router.post("/:id/increment-usage", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE invoice_entry_flows
       SET use_count = use_count + 1, last_used_at = NOW()
       WHERE id = $1
       RETURNING id, use_count, last_used_at`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "ไม่พบ Flow นี้" });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
