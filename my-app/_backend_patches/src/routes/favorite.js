import { Router } from "express";
import { pool } from "../db.js";

// MARKER_FAVORITE_FALLBACK_KEY_V1 -- เดิมรับ "taxId" อย่างเดียว เปลี่ยนเป็น "favKey" (Generic Key)
// เพราะ Vendor บางเจ้าไม่มี Tax ID กรอกไว้ -- Frontend เป็นคน Resolve Key เอง
// (ใช้ Tax ID ถ้ามี, Fallback เป็น Supplier Number/Vendor Code ถ้าไม่มี)
// Backend จุดนี้ไม่สนใจรูปแบบ รับเป็น String เฉยๆ เก็บใน favorite_taxids เหมือนเดิม
/**
 * Endpoint กลางสำหรับ Toggle Favorite — แยกออกจาก Generic Table Router (genericTable.js)
 * โดยสิ้นเชิง เพื่อไม่ให้ผูกกับ tablePermissions[table].write.roles ของแต่ละตาราง
 *
 * เหตุผล: Favorite เป็นสิทธิ์ส่วนตัว (ของฉันเอง ไม่กระทบ Master Data จริง)
 * ควรกดได้ทุกคนที่ Login แล้ว ไม่ควรผูกกับสิทธิ์ Edit Table เต็มรูปแบบ
 * (ที่ปกติจำกัดไว้เฉพาะ Admin/Owner เช่น itemcode_list)
 *
 * ความปลอดภัย:
 *  - ต้อง Login แล้วเท่านั้น (ผ่าน verifyAuthLocal ที่ Mount ไว้ก่อนหน้าใน app.js)
 *  - Whitelist เฉพาะตารางที่อนุญาตให้ Favorite ได้ (FAVORITABLE_TABLES ด้านล่าง)
 *  - แก้ได้แค่ Column "favorite_taxids" เท่านั้น (Hardcode ในโค้ด ไม่รับชื่อ Column จาก Body)
 */

// ── เพิ่มตารางใหม่ที่ต้องการเปิด Favorite ได้ที่นี่ที่เดียว ───────────────
const FAVORITABLE_TABLES = {
  itemcode_list: { idColumn: "id" },
  sm_code_list: { idColumn: "id" },
};

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

const router = Router();

router.post("/toggle", async (req, res, next) => {
  try {
    const { table, id, favKey } = req.body || {};

    if (!table || !FAVORITABLE_TABLES[table]) {
      return res.status(400).json({ error: `ตาราง "${table}" ไม่รองรับ Favorite` });
    }
    if (!id || !favKey) {
      return res.status(400).json({ error: "ต้องระบุ id และ favKey" });
    }

    const { idColumn } = FAVORITABLE_TABLES[table];
    const quotedTable = quoteIdent(table);
    const quotedId = quoteIdent(idColumn);

    const { rows: current } = await pool.query(
      `SELECT favorite_taxids FROM ${quotedTable} WHERE ${quotedId} = $1`,
      [id]
    );
    if (!current[0]) return res.status(404).json({ error: "Not found" });

    let favs = Array.isArray(current[0].favorite_taxids) ? current[0].favorite_taxids : [];
    const already = favs.includes(favKey);
    const newFavs = already ? favs.filter((t) => t !== favKey) : [...favs, favKey];

    const { rows: updated } = await pool.query(
  `UPDATE ${quotedTable} SET favorite_taxids = $1::jsonb WHERE ${quotedId} = $2 RETURNING *`,
  [JSON.stringify(newFavs), id]
  );

    res.json(updated[0]);
  } catch (err) {
    next(err);
  }
});

export default router;