// ============================================================================
// VAT Summary Dashboard — Backend Routes (เวอร์ชันแก้ไข — ใช้ createTableRouter)
// ============================================================================
// แก้จากเวอร์ชันแรกที่เขียน Route เองด้วย pool.query ตรงๆ เพราะเจอว่า Backend มี
// Mechanism กลาง genericTable.js (createTableRouter) อยู่แล้ว รองรับ Filter/Sort/
// Pagination ครบ (เหมือนที่ /company_list, /vat_watchlist_report ใช้) — ใช้ตัวนี้
// แทนจะตรงกับของเดิมทุกจุด ไม่ต้องดูแล Syntax แยกสองแบบ
//
// ⚠️ ก่อนใช้ไฟล์นี้ได้ ต้องเพิ่ม Entry ใน config/tablePermissions.js ให้ครบ 4 ตัว
//    (vat_summary_live, vat_summary_live_dashboard, vat_summary_frozen,
//     vat_summary_frozen_dashboard) ก่อนเสมอ ไม่งั้น createTableRouter() จะ throw
//    ทันทีตอน Server Start — "Table "xxx" ไม่มีอยู่ใน tablePermissions"
// ============================================================================

import express from "express";
import { createTableRouter } from "./genericTable.js"; // TODO: ปรับ Path ให้ตรงกับตำแหน่งจริงของ genericTable.js

const router = express.Router();

router.use("/vat_summary_live", createTableRouter("vat_summary_live"));
router.use("/vat_summary_live_dashboard", createTableRouter("vat_summary_live_dashboard"));
router.use("/vat_summary_frozen", createTableRouter("vat_summary_frozen"));
router.use("/vat_summary_frozen_dashboard", createTableRouter("vat_summary_frozen_dashboard"));

export default router;

// ============================================================================
// วิธี Mount เข้า Entry point หลัก (ไฟล์ที่มี app.use('/company_list', ...) อยู่)
// ============================================================================
// import vatSummaryRoutes from "./routes/vatSummaryRoutes.js"; // ปรับ Path ตามจริง
// app.use(vatSummaryRoutes);
//
// หรือถ้า Entry point เดิม Mount ทีละตารางตรงๆ แบบนี้:
//   app.use('/company_list', createTableRouter('company_list'));
//   app.use('/branch_list', createTableRouter('branch_list'));
// ก็ให้เพิ่มแบบเดียวกัน 4 บรรทัดนี้ต่อท้ายได้เลย (ไม่ต้องใช้ไฟล์นี้เลยก็ได้):
//   app.use('/vat_summary_live', createTableRouter('vat_summary_live'));
//   app.use('/vat_summary_live_dashboard', createTableRouter('vat_summary_live_dashboard'));
//   app.use('/vat_summary_frozen', createTableRouter('vat_summary_frozen'));
//   app.use('/vat_summary_frozen_dashboard', createTableRouter('vat_summary_frozen_dashboard'));
// ============================================================================