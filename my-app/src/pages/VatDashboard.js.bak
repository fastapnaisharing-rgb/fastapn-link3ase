import React from "react";
import { apiFetch } from "../api";
import { useAuth } from "../contexts/AuthContext";

// ============================================================================
// VAT Watchlist Dashboard — src/pages/VatDashboard.js
// ============================================================================
// แยกไฟล์ออกจาก VatController.js ตามที่ตกลงไว้ (แก้ง่ายกว่า ไม่ปนกับไฟล์ใหญ่)
//
// Data source: ตาราง/VIEW ที่สร้างไว้ใน vat_summary_schema.sql
//   - vat_summary_live_dashboard  (real-time, ยังไม่ Freeze)
//   - vat_summary_frozen_dashboard (Freeze แล้ว ของเดือนที่ปิดไปแล้ว — ยังไม่ได้ใช้ใน v1 นี้)
//
// สมมติฐานเรื่อง Backend (ยังไม่ยืนยัน 100% เพราะมองไม่เห็นโค้ด Express จริง):
//   จากของเดิมใน VatController.js พบว่า apiFetch('/company_list') และ
//   apiFetch('/branch_list') ยิง GET ตรงไปที่ชื่อ Table แล้วได้ Array กลับมาตรงๆ
//   (ไม่ต้องมี Query Param อะไรเลย) — ดังนั้นคาดว่า apiFetch('/vat_summary_live_dashboard')
//   จะทำงานแบบเดียวกัน คือ SELECT * จาก VIEW นั้นได้ตรงๆ โดยไม่ต้องเพิ่ม Backend Route ใหม่
//   ถ้าพี่ลองรันแล้ว apiFetch('/vat_summary_live_dashboard') ไม่เจอ/Error ให้บอกเลย
//   จะได้รู้ว่าต้องให้ทีม Backend เพิ่ม Route ให้ก่อน
//
// เพราะ View นี้เป็นข้อมูลสรุป (Pre-aggregated) ขนาดเล็กอยู่แล้ว (ไม่กี่ร้อยแถว)
// เลยดึงมาทั้งหมดครั้งเดียว แล้วไป Filter/รวมยอดฝั่ง Frontend เอา — ไม่ต้องพึ่ง
// Query Param สำหรับ group_by/sum_col แบบที่ /vat_watchlist_report ใช้
//
// MARKER_ONE_FRAME_V1 — Header + Zone A + Zone B + Zone F ถูกรวมเป็น "กรอบเดียว" (Card เดียว)
// จริงๆ แล้ว ไม่ใช่ 4 กล่องแยก border คนละก้อนเหมือนก่อนหน้านี้ — คั่นภายในด้วยเส้นบางๆ
// (divider) แทน ตามที่ยืนยันจาก Mockup v2 ("Ok ถูกต้องแล้ว")
//
// MARKER_ZONE_NAMING_CONVENTION_V1 — หลักการแบ่ง/เรียกชื่อ Zone ของหน้านี้ (บันทึกไว้กันลืม/กันสับสน)
//   โครงหน้าแบ่งเป็น 2 ส่วนใหญ่ตาม MARKER_STICKY_FIXED_HEIGHT_40VH_V1:
//   1) ส่วนบน Fix สูง 40vh (Header + Zone A + Zone B + Zone F) — การ์ดเดียวกัน ไม่ลอย ไม่ Sticky
//      - Zone A = คอลัมน์ซ้าย: Base Filter (ทั้งหมด/CDG/CRC/RBS) แถวบน + ปุ่ม BU (Grid) แถวล่าง
//      - Zone B = Donut ยอด VAT คงค้างแยก Type/Category (CPN/ITC/LAND/UTL/OTH) — อยู่ชิดซ้ายของ
//        Panel "Summary Overall"
//      - Zone F = ฝั่งขวาของ Panel "Summary Overall" ปกติเป็น Bar List รายม BU (เรียงยอดมาก->น้อย)
//        แต่พอเลือก BU เดียว (buFilter) จะเปลี่ยนเป็นกราฟเส้น Aging (Single-BU Line Chart) แทน
//        รวมถึง Popup "ดูทั้งหมด BU" (ปุ่ม "ดูทั้งหมด (N)") ก็นับเป็นส่วนขยายของ Zone F
//   2) ส่วนล่าง (พื้นที่ที่เหลือ ใต้การ์ด 40vh) — ยังไม่ได้สร้าง ตอนนี้มีแค่ข้อความ Placeholder
//      "Zone C — สรุปตาม Payment Status 4 แถว — ยังไม่สร้าง" ค้างไว้เฉยๆ รอออกแบบเพิ่มเติม
//      (แผนเดิมกันที่ไว้สำหรับ Zone C/D/E แต่ยังไม่ได้ลงรายละเอียดว่าแต่ละ Zone คืออะไร)
//   หลักการเรียกชื่อ: ใช้ตัวอักษร (Zone A/B/C/D/E/F ฯลฯ) อ้างอิงตำแหน่ง/หน้าที่เดิมที่คุยกันไว้
//   ตั้งแต่แรก ถ้าจะเพิ่ม Zone ใหม่หรือเปลี่ยนชื่อเรียก (เช่น "Zone หลัก"/"Main") ให้ระบุว่าหมายถึง
//   แทนที่ Zone ตัวอักษรไหน หรือเป็น Zone ใหม่ถัดจากตัวไหน กันสับสนตอนอ้างอิงในโค้ด/คุยกันภายหลัง
//
// MARKER_FREEZE_REFREEZE_BUSINESS_RULE_V1 — กฎเรื่อง Freeze/Re-freeze ยอดรายเดือน (คุยกันไว้
// ก่อนจะมี Previous Period จริง ใช้เป็นข้อมูลอ้างอิงตอน Backend พร้อมทำ vat_summary_frozen_dashboard
// จริง — ยังไม่ได้ Implement โค้ดใดๆ ตอนนี้ แค่บันทึกหลักการไว้):
//   1) Trigger ที่ทำให้ต้อง Freeze/Re-freeze ยอดของ Period หนึ่งๆ มี 2 แบบ:
//      a) ปิดงวด (Close Period) ตามรอบปกติ — Freeze ครั้งแรกของเดือนนั้น
//      b) สถานะรายการเปลี่ยน (เช่น Incomplete -> Active) ไม่ว่าจะกด ณ เดือนไหนก็ตาม — ถ้า
//         "วันที่เอกสาร" ของรายการนั้นตกอยู่ใน Period ที่ Freeze ไปแล้ว ต้องพิจารณา Re-freeze
//         Period นั้นด้วย (ยึดวันที่เอกสารเป็นตัวตัดสินว่ากระทบ Period ไหน ไม่ใช่ยึดว่า Action
//         เกิดขึ้นตอนไหน)
//   2) ถ้าต้องแก้ไขข้อมูลของ Period ที่ Freeze ไปแล้ว ให้ Reopen Period นั้นก่อน (ปลดล็อกกลับมา
//      แก้ได้) ไม่แก้ทับ Freeze ตรงๆ — แก้เสร็จแล้วปิดงวดซ้ำ ให้ Re-freeze แบบ UPSERT ทับยอดเดิม
//      ของ Period นั้น (ไม่เก็บ Version เก่าไว้ เว้นแต่จะต้องการ Audit Trail ในอนาคต)
//   3) กรณี Re-freeze อัตโนมัติจาก (1b) — มีเพดานตามระยะเวลาตั้งแต่ปิดงวดของ Period นั้น:
//        - ≤ 15 วันหลังปิดงวด  → Auto Re-freeze ให้เลยทันที ไม่ต้องถาม
//        - เกิน 15 วัน แต่ไม่เกิน 1 เดือน → ต้องขึ้น Prompt ถามก่อนว่าต้องการ Auto Re-freeze
//          หรือไม่ ให้ User ตัดสินใจเอง
//        - เกิน 1 เดือน → ล็อกไว้เด็ดขาด "ไม่อัปเดตทุกกรณี" (ไม่ Auto, ไม่ถาม Prompt ด้วย — ไม่มี
//          ทางอัปเดตยอด Frozen ของ Period นั้นได้เลยจากช่องทางนี้ ไม่ว่ากรณีใดก็ตาม) ต้อง Manual
//          Reopen เท่านั้นถึงจะแก้ได้
//   พอ Backend มี Endpoint ดึงยอด Previous Period จริงแล้ว ให้ผูกเข้ากับ Placeholder ที่เตรียมไว้ใน
//   ไฟล์นี้ได้เลย: singleBuPrevTotal / singleBuPrevByBucket / categoryPrevByType (ตอนนี้เป็น null
//   เสมอ ทุกจุด UI คำนวณลูกศร/% ให้อัตโนมัติเมื่อไม่เป็น null)
// ============================================================================

// ============================================================================
// MARKER_RATE_GROSS_VAT_BUSINESS_RULE_V1 — กฎเรื่อง "ยอด 100% (เต็ม) vs ยอดเฉลี่ยตาม Rate (Avg)"
//   (ยังไม่ Implement จุดใดในระบบ — บันทึกไว้กันลืมตอน Backend ทำจริง)
// ----------------------------------------------------------------------------
//   ปัญหา: บางหัว (Company/Branch) คิดภาษีที่ 100% ของยอดเอกสาร แต่บางหัวต้องคิดตาม "Rate"
//   เฉลี่ยเฉพาะของหัวนั้น เช่น CFW ใช้ Rate 59.53% -> ยอด VAT เฉลี่ยที่ต้องใช้ คือ
//     Round(VAT_เต็ม * 59.53 / 100, 2)   (ต้องปัดเก็บ 2 ตำแหน่งทศนิยม)
//   และต้องคำนวณแบบเดียวกันทั้ง Gross และ VAT (ไม่ใช่คิดแค่ VAT ฝั่งเดียว) — ได้ทั้งคู่เป็นคนละคู่
//   ค่า: คู่ "เต็ม 100%" (exp_amount/exp_vat) และคู่ "เฉลี่ยตาม Rate" (avg_amount/avg_vat)
//
//   ที่เก็บ Rate: อยู่ใน CompanyList หรือ BranchList ก็มีได้ทั้งคู่ — ลำดับความสำคัญการจับคู่
//   (เจอก่อนใช้ก่อน) คือ:
//       Group Range  >  Branch List  >  Company
//
//   จุดที่ต้อง Implement จริง (จุดเดียว ไม่ต้องแยกทำหลายที่): ชั้น Import/Live — คือตอน Import
//   ข้อมูลเข้า vat_watchlist_report (หรือตอนสร้าง View vat_summary_live_dashboard) ต้องคำนวณ Rate
//   แล้วใส่ค่าที่ถูกต้องลง avg_amount/avg_vat ตั้งแต่จุดนั้นเลย เพราะ:
//     - vat_summary_live_dashboard (View ที่หน้า Dashboard นี้ดึงมาแสดง) อ่านมาจาก
//       vat_watchlist_report โดยตรง — ถ้าคำนวณถูกตั้งแต่ Import, Live ก็ได้ค่าถูกต้องไปอัตโนมัติ
//       ไม่ต้องไปทำ Logic คำนวณ Rate ซ้ำอีกจุดในหน้า Dashboard
//     - Freeze (ดู MARKER_FREEZE_REFREEZE_BUSINESS_RULE_V1 ด้านบน) แค่ "Snapshot" ค่าที่ Live มี
//       อยู่ ณ ขณะปิดงวดเท่านั้น ไม่มี Logic คำนวณ Rate ของตัวเอง — ตอน Freeze ต้องเก็บทั้ง 2 ค่า
//       (ยอดเต็ม 100% และยอด Avg ตาม Rate) ไปคู่กัน เผื่อใช้งานคนละมุมมองกันในอนาคต
//     - ถ้าไม่ทำที่ชั้น Live/Import เลย แล้วไปทำ Logic แค่ตอน Freeze อย่างเดียว จะมีปัญหาคือ: ก่อน
//       ปิดงวด (ช่วงที่ User เข้ามาดู Watchlist แบบ Real-time ทุกวัน) ยอด VAT ของหัวที่ใช้ Rate
//       (เช่น CFW 59.53%) จะเป็นยอดเต็ม 100% ผิดไปเรื่อยๆ จนกว่าจะ Freeze — ขัดกับจุดประสงค์ของ
//       หน้า Watchlist ที่ต้องดูยอดเสี่ยงแบบ Real-time ให้ถูกตั้งแต่วันแรก
//
//   Schema ที่เกี่ยวข้อง: ตาราง vat_watchlist_report มีคอลัมน์ครบอยู่แล้ว 4 ช่อง — exp_amount /
//   exp_vat (ยอดเต็ม 100%) และ avg_amount / avg_vat (ตั้งใจไว้ให้เป็นยอดหลังคำนวณตาม Rate) — แต่
//   ณ จุดนี้ avg_amount/avg_vat ยังเป็นแค่ค่า Placeholder ที่ copy มาจาก exp_amount/exp_vat เฉยๆ
//   (ค่าเท่ากันทุกแถวที่เช็คมา) ยังไม่มี Logic คำนวณ Rate จริงที่จุดไหนในระบบเลย
//
//   สรุป: งานนี้เป็นงาน Backend/Import-pipeline (ทำครั้งเดียวที่ชั้น Import/View) ไม่ใช่งานฝั่ง
//   Frontend ของไฟล์นี้ — เมื่อ Backend ทำ Logic คำนวณ Rate เสร็จและ avg_amount/avg_vat เป็นค่า
//   จริงแล้ว ค่อยมาคุยต่อว่าหน้านี้จะต้องแสดง/สลับไปใช้ชุดไหนในสถานการณ์ใดบ้าง (ไม่ใช่แค่สลับ
//   exp_vat -> avg_vat เฉยๆ เพราะต้อง Freeze เก็บไว้ทั้ง 2 ชุด)
//
//   สิ่งที่ยังต้องสร้างก่อนเริ่ม Implement (ยังไม่มีสักจุด ณ ขณะบันทึกนี้):
//     1) ที่เก็บ Rate เอง — เช็คว่า CompanyList/BranchList (และ "Group Range") มีช่อง Rate (%)
//        อยู่แล้วหรือยัง ถ้ายังไม่มีต้องเพิ่มคอลัมน์/ตารางเก็บ Rate ก่อน พร้อม Logic จับคู่ตาม
//        ลำดับ Group Range > Branch List > Company
//     2) จุดคำนวณ — เลือกระหว่าง (ก) คำนวณตอน Import เข้า vat_watchlist_report แล้ว Store ค่าลง
//        avg_amount/avg_vat ตรงๆ (เข้ากับ Schema ที่มีคอลัมน์ไว้รองรับอยู่แล้ว แต่ถ้า Rate ถูกแก้
//        ย้อนหลัง ค่าที่ Import ไปแล้วจะไม่ Update ตามอัตโนมัติ ต้องมี Job แยกไป Re-calculate) หรือ
//        (ข) คำนวณแบบ Dynamic ใน View vat_summary_live_dashboard (JOIN กับตาราง Rate ตอน Query
//        เลย ไม่ Store ใน vat_watchlist_report) — Live จะสดเสมอ แต่ตอน Freeze ต้องไป "จับภาพ"
//        ผลลัพธ์จาก View ณ ขณะนั้นมา Insert ลง vat_summary_frozen_dashboard แยกอยู่ดี
//        แนวทางที่เข้ากับ Schema ปัจจุบันมากกว่า คือ (ก) เพราะคอลัมน์ avg_amount/avg_vat ถูก
//        ออกแบบมาให้ Store ค่า ไม่ใช่ Computed Column — แต่สุดท้ายต้องตกลงกับทีม Backend อีกที
// ============================================================================

// ── ปุ่ม BU แบบ Grid เท่ากันทุกช่อง (5 ต่อแถว) — Style Option 2: Pill มนเต็ม (Teal) ──
const gridBtnStyle = (active) => ({
  padding: "7px 8px",
  fontSize: "12px",
  fontWeight: active ? 700 : 500,
  borderRadius: "999px",
  border: active ? "1px solid #0f7a6b" : "1px solid #cfe3df",
  background: active ? "#0f7a6b" : "white",
  color: active ? "white" : "#2a6b60",
  cursor: "pointer",
  textAlign: "center",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  width: "100%",
  height: "100%", // MARKER_ZONEA_FIXED_6_ROWS_V1 — เต็มความสูง Track ที่ gridAutoRows คำนวณไว้
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  transition: "background 0.15s, color 0.15s, border 0.15s",
});

// ── ปุ่ม Filter By Base (แถวที่ 1) — Pill เหมือนกัน แต่ตอนเลือกอยู่ = สี Navy แยกจาก BU (Teal) ──
const baseBtnStyle = (active) => ({
  padding: "7px 8px",
  fontSize: "12px",
  fontWeight: active ? 700 : 500,
  borderRadius: "999px",
  border: active ? "1px solid #1a3a5c" : "1px solid #ccd5e0",
  background: active ? "#1a3a5c" : "white",
  color: active ? "white" : "#3a4a5c",
  cursor: "pointer",
  textAlign: "center",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  width: "100%",
  transition: "background 0.15s, color 0.15s, border 0.15s",
});

// ── Badge จำนวน BU — เกาะมุมขวาบนของปุ่ม Base แต่ละปุ่ม ──
const cornerBadgeStyle = {
  position: "absolute",
  top: "-7px",
  right: "-6px",
  display: "inline-block",
  padding: "0px 6px",
  fontSize: "10px",
  fontWeight: 700,
  lineHeight: "16px",
  borderRadius: "999px",
  background: "#0f7a6b",
  color: "white",
  border: "1.5px solid white",
  minWidth: "16px",
  textAlign: "center",
};

// ── Card เดียวที่ครอบ Header + Zone A + Zone B + Zone F ทั้งหมด (MARKER_ONE_FRAME_V1) ──
const outerCardStyle = {
  background: "white",
  borderRadius: "10px",
  border: "1px solid #e5e5e5",
  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
  overflow: "hidden",
};

// ── วันที่ไทย (พ.ศ.) แบบเดียวกับ Header การ์ดหลัก ──────────────────────────
const THAI_DAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
const THAI_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
function formatThaiDate(d) {
  return `วัน${THAI_DAYS[d.getDay()]}ที่ ${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
}
function formatThaiTime(d) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ── ย่อตัวเลขให้อ่านง่าย: 258,500,000 -> "258.5M", 12,300 -> "12.3K" ────────
function formatCompact(n) {
  const num = Number(n) || 0;
  const abs = Math.abs(num);
  if (abs >= 1e6) return (num / 1e6).toFixed(1) + "M";
  if (abs >= 1e3) return (num / 1e3).toFixed(1) + "K";
  return num.toFixed(0);
}

// MARKER_FORMAT_FULL_V1 — ยอดละเอียดแบบเต็ม พร้อม Comma คั่นหลักพัน (ไม่ย่อ M/K) ใช้กับ
// กราฟเส้น Single BU ที่ขอให้โชว์ยอดละเอียดถาวร ไม่ต้อง Hover ดู — MARKER_FORMAT_FULL_SATANG_V1:
// เดิม Math.round() ตัดเศษสตางค์ทิ้งหมด เปลี่ยนให้โชว์ทศนิยม 2 ตำแหน่ง (สตางค์) เสมอ ตามที่ขอ
function formatFull(n) {
  return (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// MARKER_FORMAT_DATE_DDMMMYY_V1 — ตามที่ขอ "ปรับ Format Date เป็น dd-mmm-yy" ใช้กับ Column ที่ชื่อ
// ลงท้าย "_date" ในตาราง Detail Zone (doc_date, payment_date, check_date, receive_doc_date,
// old_ref_pay_date ฯลฯ) — Parse แบบ Manual จาก "YYYY-MM-DD..." ไม่พึ่ง toLocaleDateString เพราะ
// Format/Locale ของแต่ละเครื่อง/Browser ไม่เหมือนกัน ให้ได้ผลลัพธ์คงที่เสมอ เช่น "02-Jul-23"
const MONTH_ABBR_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatDdMmmYy(value) {
  const s = String(value);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s; // ไม่ตรง Pattern วันที่ -- คืนค่าเดิมไป (เช่น "-" หรือค่าแปลกๆ)
  const [, y, mo, d] = m;
  const mi = parseInt(mo, 10) - 1;
  if (mi < 0 || mi > 11) return s;
  return `${d}-${MONTH_ABBR_EN[mi]}-${y.slice(2)}`;
}

// ── Zone B: สี per ประเภท (display_type จาก vat_summary_live_dashboard) ───
const CATEGORY_ORDER = ["CPN", "ITC", "LAND", "UTL", "OTH"]; // MARKER_VATDASHBOARD_TRUE_TYPE_V1 -- ไม่มี Type "Unpaid" (Unpaid = Payment Status ไม่ใช่ Type)
const CATEGORY_COLORS = {
  CPN: "#0f7a6b",
  ITC: "#1a3a5c",
  LAND: "#d9a441",
  UTL: "#5aa9c9",
  OTH: "#c5ccd6",
  // MARKER_UNPAID_COLOR_CLASH_FIX_V1 — เดิมใช้ "#1a3a5c" (Navy) ตาม MARKER_UNPAID_NAVY_V1 แต่สีซ้ำ
  // กับ ITC เป๊ะ (ITC ก็ Navy เดียวกัน) ทำให้แยกไม่ออกใน Donut/Legend เปลี่ยนเป็นสีเทาเข้ม (Slate)
  // แทน ไม่ซ้ำกับสีอื่นในชุดนี้เลย (CPN เขียว/ITC น้ำเงินเข้ม/LAND ทอง/UTL ฟ้า/OTH เทาอ่อน)
};

// ── Zone F: สี per Aging Bucket — MARKER_ZONEF_EXCLUDE_UNPAID_V1
// แก้ตามที่ขอ: "ไม่จ่าย" (payment_type = Unpaid) ทำให้มันขึ้น TOP ของทุก BU เพราะเป็นก้อนใหญ่สุด
// เสมอ ไม่มีประโยชน์ในการจัดอันดับ — เลยตัดออกจาก Zone F ไปเลย (ไม่ Sum เข้า total/การจัดอันดับ
// ด้วย) เหลือเฉพาะรายการที่ "จ่ายแล้ว" แบ่งตาม aging_risk เป็นความเสี่ยงต่ำ/กลาง/สูง + Expired ──
const AGING_BUCKET_ORDER = ["zero", "low", "medium", "high", "expired"]; // MARKER_AGING_ZERO_BUCKET_V1 -- Aging 0 (No Risk) แยกเป็นอีก Bucket/สี ไม่รวมกับ 1-2
// MARKER_AGING_COLORS_V2 — ตามที่ขอ: เสี่ยงต่ำ=เขียว, เสี่ยงปานกลาง=เหลือง, เสี่ยงสูง=แดง,
// หมดอายุ=เทา (ไม่ใช่ Traffic Light ไล่เขียว→แดง→แดงเข้มแบบเดิม เพราะหมดอายุเปลี่ยนเป็นเทาแทน)
const AGING_BUCKET_COLORS = { zero: "#3fb8c9", low: "#6fcf73", medium: "#f0c419", high: "#e53935", expired: "#9aa2ae" };
// MARKER_AGING_LABELS_DATERANGE_V1 — เปลี่ยนป้ายจากชื่อความเสี่ยงเป็นช่วงเดือนตามที่ขอ
// "low" ครอบคลุม aging_month 0/1/2 จริง (No Risk + Low Risk พับรวมกันอยู่แล้วใน agingBucketOf)
// เลยเป็น "0-2" ไม่ใช่ "1-2"
const AGING_BUCKET_LABELS = { zero: "0", low: "1-2", medium: "3-4", high: "5-6", expired: "Expired" };
const UNPAID_BUCKET_COLOR = "#1a3a5c"; // MARKER_UNPAID_NAVY_V1 — Navy เหมือนกับ Zone B
const UNPAID_BUCKET_LABEL = "Unpaid";

// ── MARKER_ZONED_WATERFALL_V1 — Zone D: Waterfall แยกตาม Aging Risk (High/Medium/Low) แตกยอด
// ตาม Type (CPN/ITC/LAND/UTL/OTH) + แท่ง "Total" ปิดท้าย ตามภาพตัวอย่าง Power BI ที่ส่งมา —
// ไม่โชว์ Expired (ภาพตัวอย่างมีแค่ 3 แผง High/Medium/Low เท่านั้น)
const WATERFALL_BUCKET_ORDER = ["high", "medium", "low"];
// MARKER_ZONED_WATERFALL_HOVER_V2 -- Hover ทุกแท่ง (รวม Total) แยกยอดตาม Aging เดือนของแผงนั้น (สีเดียวกันก็แยกบรรทัด)
const WATERFALL_AGING_MONTHS = { high: ["5", "6"], medium: ["3", "4"], low: ["0", "1", "2"] };
const WATERFALL_BUCKET_LABELS = {
  high: "Outstanding balances by High Risk (Aging ≥ 5)",
  medium: "Outstanding balances by Medium Risk (Aging ≥ 3)",
  low: "Outstanding balances by Low Risk (Aging ≤ 2)",
};

// ── MARKER_ZONEC_PAYMENT_STATUS_V1 — Zone C: การ์ดแบ่งตามสถานะการจ่าย ตามภาพตัวอย่างที่ส่งมา
// (Total Vat Paid/Unpaid/Expired All + แยกตาม Type)
// MARKER_ZONEC_REALIZED_UNREALIZED_V1 -- Expired แบ่งเป็น Realized/Unrealized ภายใน (คำนวณใน
// paymentStatusBreakdown ด้านล่าง) แต่ "ไม่โชว์เป็นแถวในตารางหลัก" ตามที่ขอ — โชว์ผ่าน Popup
// แทน (กดปุ่มที่การ์ด "Total Vat Expired All" เปิด Popup รายละเอียด) ดู
// MARKER_ZONEC_EXPIRED_DETAIL_POPUP_V1 ท้ายไฟล์
const PAYMENT_STATUS_TYPES = ["CPN", "ITC", "LAND", "UTL", "OTH"];
// MARKER_VATDASHBOARD_TRUE_TYPE_V1 -- Type จริงของ Vendor (View ส่ง true_type มาให้ ไม่ว่าจ่ายแล้วหรือยัง) -- Unpaid/Paid/Expired เป็น Payment Status คนละมิติ ไม่ใช่ Type
// ถ้า View ยังไม่มี true_type (ยังไม่ได้รัน SQL) -> Fallback เป็น bus_type ที่เป็น 4 Type หลัก ไม่งั้น OTH
const typeKeyOf = (r) => (PAYMENT_STATUS_TYPES.includes(r.true_type) ? r.true_type : (PAYMENT_STATUS_TYPES.includes(r.bus_type) ? r.bus_type : "OTH"));
// MARKER_ZONEC_EXPIRED_TREND_TYPE_COLORS_V1 — สีประจำแต่ละ Type สำหรับเส้นในกราฟเทียบ 3 เดือน
const TYPE_TREND_COLORS = {
  CPN: "#1a56db",
  ITC: "#0f7a6b",
  LAND: "#b45309",
  UTL: "#7c3aed",
  OTH: "#64748b",
};
// MARKER_ZONEC_EXPIRED_DETAIL_VIEW_FIXED_HEIGHT_V1 — ความสูงคงที่ของโซนเนื้อหาใน Popup
// Expired Detail (ใช้ทั้ง By Type และ By BU) ไม่ให้ Popup ยืด/หดตอนสลับ Toggle
const EXPIRED_VIEW_HEIGHT = "62vh";
const PAYMENT_STATUS_ROWS = [
  { key: "paid", label: "Total Vat Paid", color: "#1a56db" },
  { key: "unpaid", label: "Total Vat Unpaid", color: "#0f7a6b" },
  { key: "expired", label: "Total Vat Expired", color: "#b91c1c" },
];
// Reason เฉพาะของ Unrealized Expired — รองรับขยายเป็นหลาย Reason ในอนาคตได้ (ตอนนี้มีตัวเดียว)
const UNREALIZED_EXPIRED_REASONS = [{ key: "cheque_return", label: "Cheque Return" }];

// ── MARKER_SINGLEBU_LINECHART_V1 — เมื่อเลือก BU เดียว (buFilter) ให้แสดงกราฟเส้นแบบ
// "VAT Watchlist Ops" (Green Flag / Red Flag / Expired) แทน Bar List ปกติของ Zone F
// 9 จุดตามที่ขอ: Unpaid | 0,1,2,3,4,5,6 | Expired (เดิมของ VatController มี 8 จุด ไม่มี Unpaid)
const SINGLEBU_POINT_ORDER = ["unpaid", "0", "1", "2", "3", "4", "5", "6", "expired"];
const SINGLEBU_POINT_LABELS = { unpaid: "Unpaid", "0": "0", "1": "1", "2": "2", "3": "3", "4": "4", "5": "5", "6": "6", expired: "Expired" };
// สีจุด: ใช้ Palette เดียวกับ Zone F ทุกประการ — Unpaid=Navy, 0-2=เขียว(low), 3-4=เหลือง(medium),
// 5-6=แดง(high), Expired=เทา
const SINGLEBU_POINT_COLORS = {
  unpaid: UNPAID_BUCKET_COLOR,
  "0": AGING_BUCKET_COLORS.zero,
  "1": AGING_BUCKET_COLORS.low,
  "2": AGING_BUCKET_COLORS.low,
  "3": AGING_BUCKET_COLORS.medium,
  "4": AGING_BUCKET_COLORS.medium,
  "5": AGING_BUCKET_COLORS.high,
  "6": AGING_BUCKET_COLORS.high,
  expired: AGING_BUCKET_COLORS.expired,
};
const SINGLEBU_CHART_W = 300;
const SINGLEBU_CHART_H = 100;
// MARKER_SINGLEBU_SCOPE_SYNC_V1 — จุดไหนอยู่กลุ่มไหน (ใช้คำนวณขอบเขตโซนพื้นหลังแบบ Dynamic
// เมื่อจำนวนจุดเปลี่ยนไปตาม vatScope — ดู singleBuPointOrder ด้านล่าง)
const SINGLEBU_GROUP_OF = { unpaid: "unpaid", "0": "green", "1": "green", "2": "green", "3": "green", "4": "green", "5": "red", "6": "red", expired: "expired" };
// ── ปุ่ม Scope: All / Paid / Aging — MARKER_SCOPE_SEGMENTED_PILL_V1: เปลี่ยนจากปุ่มหลอดแยกเป็น
// "หลอดเดียวต่อกัน" (Segmented Control) มีเส้นคั่นบางๆ ระหว่างช่อง ตามภาพอ้างอิงที่ส่งมา
// (Sync ระหว่าง Zone B กับ Zone F) ──
// MARKER_SCOPE_PILL_FULLWIDTH_V1 — ขยายให้เต็มความกว้าง Container (ติดขอบ) แทน inline-flex เดิม
// ที่ยึดตามขนาดเนื้อหา — เว้น Gap 3px จากขอบซ้าย/ขวาจริงของ Container (margin ที่จุดเรียกใช้)
// แต่ละปุ่มเป็น flex:1 แบ่งความกว้างเท่ากัน + จัดข้อความให้อยู่กึ่งกลางปุ่ม
const scopeGroupStyle = {
  display: "flex",
  width: "100%",
  border: "1px solid #dde3e8",
  borderRadius: "999px",
  overflow: "hidden",
  background: "white",
};
const scopeBtnStyle = (active, isLast) => ({
  flex: 1,
  padding: "5px 12px",
  fontSize: "11px",
  fontWeight: active ? 700 : 500,
  border: "none",
  borderRight: isLast ? "none" : "1px solid #dde3e8",
  background: active ? "#0f7a6b" : "white",
  color: active ? "white" : "#555",
  textAlign: "center",
  cursor: "pointer",
  transition: "background 0.15s, color 0.15s",
});

// ── Hook: ดึงข้อมูลสรุปจริงจาก vat_summary_live_dashboard ──────────────────
function useVatSummaryDashboard() {
  const [rows, setRows] = React.useState([]);
  const [buToBase, setBuToBase] = React.useState({}); // MARKER_VATDASHBOARD_BU_BASE_MAP_V1 -- company_list.base
  const [periodMonth, setPeriodMonth] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  const fetchData = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, periodRes, companies] = await Promise.all([
        apiFetch("/vat_summary_live_dashboard"),
        apiFetch("/vat/period/status").catch(() => null),
        apiFetch("/company_list").catch(() => []),
      ]);
      const list = Array.isArray(summaryRes) ? summaryRes : (Array.isArray(summaryRes?.rows) ? summaryRes.rows : []);
      setRows(list);
      setPeriodMonth(periodRes?.vat_period_current_month || null);
      const map = {};
      (Array.isArray(companies) ? companies : []).forEach((c) => { if (c.bu) map[c.bu] = c.base || ""; });
      setBuToBase(map);
    } catch (err) {
      console.error("useVatSummaryDashboard error:", err);
      setError(err);
      setRows([]);
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchData();
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [fetchData]);

  return { rows, buToBase, periodMonth, loading, error, refetch: fetchData };
}

export default function VatDashboard() {
  const { rows: rowsRaw, buToBase, periodMonth, loading, error, refetch } = useVatSummaryDashboard();
  const { userName, currentUser } = useAuth();
  // MARKER_VATDASHBOARD_PAYMENT_TYPE_FILTER_V1 -- หลอด Filter Bank Transfer | Cheque | Direct Debit (กรองทั้งหน้า)
  // คลิกธรรมดา = เลือกค่าเดียว (คลิกค่าที่เลือกอยู่ซ้ำ = ปลดเป็น No Filter) | Ctrl/Cmd+คลิก = เพิ่ม/เอาออกจากชุดที่เลือก
  // ถ้าเลือกหลายค่าอยู่แล้วคลิกธรรมดาที่ค่าที่เลือกอยู่ = ปลดหมด | ไม่เลือกเลย = ทุกค่า
  // rowsRaw = ข้อมูลเต็ม (ใช้ทำรายชื่อ BU/Base ให้ปุ่มไม่หายตอนกรอง) | rows = หลังกรอง payment_type ที่ทุก Zone ใช้
  const PAY_FILTER_OPTIONS = ["Bank Transfer", "Cheque", "Direct Debit"];
  const [payFilter, setPayFilter] = React.useState([]);
  const rows = React.useMemo(
    () => (payFilter.length ? rowsRaw.filter((r) => payFilter.includes(r.payment_type)) : rowsRaw),
    [rowsRaw, payFilter]
  );
  const togglePayFilter = (val, e) => {
    const multi = !!(e && (e.ctrlKey || e.metaKey));
    setPayFilter((prev) => {
      const on = prev.includes(val);
      if (multi) return on ? prev.filter((v) => v !== val) : [...prev, val];
      if (on) return [];
      return [val];
    });
  };
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  // MARKER_VATDASHBOARD_BOOKING_CLAIM_TOGGLE_V1 -- 'booking' = ยอดเต็ม (exp_vat) / 'claim' = ยอดเฉลี่ยตาม Rate (avg_vat)
  // Default = 'claim' เพราะเป็นค่าตามความเป็นจริง (ยอดที่ Claim ได้จริงหลังคูณ Rate แล้ว)
  const [valueMode, setValueMode] = React.useState("claim");
  const vatField = valueMode === "claim" ? "avg_vat" : "exp_vat";

  // ── Zone A, แถวที่ 1: Base Filter (ทั้งหมด + Base จริงจาก company_list.base) ──
  const buTabs = React.useMemo(
    () => [...new Set(rowsRaw.map((r) => r.bu).filter(Boolean))].sort(), // ใช้ rowsRaw: ปุ่ม BU/Base ไม่หายเมื่อกรอง payment_type
    [rowsRaw]
  );
  const baseTabs = React.useMemo(
    () => [...new Set(buTabs.map((b) => buToBase[b]).filter(Boolean))].sort(),
    [buTabs, buToBase]
  );
  const [baseFilter, setBaseFilter] = React.useState(null);

  // ── จำนวน BU ต่อ Base แต่ละตัว — ใช้โชว์เป็น Badge มุมขวาบนของปุ่ม Base แต่ละปุ่ม ──
  const baseCounts = React.useMemo(() => {
    const counts = {};
    baseTabs.forEach((b) => {
      counts[b] = buTabs.filter((bu) => buToBase[bu] === b).length;
    });
    return counts;
  }, [baseTabs, buTabs, buToBase]);

  // ── Zone A, แถวที่ 2 เป็นต้นไป: BU Filter — ถูกกรองตาม Base ที่เลือกไว้แถวบน ──
  const buTabsForStep2 = React.useMemo(
    () => (baseFilter ? buTabs.filter((b) => buToBase[b] === baseFilter) : buTabs),
    [buTabs, buToBase, baseFilter]
  );
  const [buFilter, setBuFilter] = React.useState(null);

  // เปลี่ยน Base แล้ว BU ที่เคยเลือกไว้อาจไม่อยู่ใน Base ใหม่ — เคลียร์ทิ้ง
  const handleSetBase = (b) => {
    setBaseFilter(b);
    setBuFilter(null);
  };

  // MARKER_HEADER_STALE_STATUS_V1 -- เดือนล่าสุดที่มีข้อมูลจริง < Period ปัจจุบัน = ปิด Period แล้วแต่ยังไม่มี Incomplete ใหม่
  const dataMonth = React.useMemo(() => {
    let latest = null;
    rowsRaw.forEach((r) => { const pm = r.period_month; if (typeof pm === "string" && /^\d{4}-\d{2}$/.test(pm) && (!latest || pm > latest)) latest = pm; });
    return latest;
  }, [rowsRaw]);
  const isStale = !!(dataMonth && periodMonth && dataMonth < periodMonth);

  const displayRows = React.useMemo(() => {
    let r = rows;
    if (baseFilter) r = r.filter((row) => buToBase[row.bu] === baseFilter);
    if (buFilter) r = r.filter((row) => row.bu === buFilter);
    return r;
  }, [rows, buToBase, baseFilter, buFilter]);

  // ── MARKER_VATSCOPE_V2 — ตัวเลือก Scope เดียว ใช้ร่วมกันทั้ง Zone B และ Zone F (Sync)
  // แก้ตามที่ขอ: Zone B ยังคงแบ่งตาม Type/Category (CPN/ITC/LAND/UTL/OTH) เหมือนเดิมเสมอ ไม่ว่า
  // จะเลือกปุ่มไหน — ปุ่ม All/Paid/Aging แค่กรอง "ขอบเขตข้อมูล" (Scope) ที่จะเอามานับ ไม่ได้
  // เปลี่ยนมิติ (Dimension) ของการแบ่ง:
  //   "all"   = รวมทุกแถว ทั้งจ่ายแล้วและยังไม่จ่าย
  //   "paid"  = เฉพาะที่จ่ายแล้วทั้งหมด (ตัด payment_type='Unpaid' ออก) รวม Aging 0 (No Risk) ด้วย
  //   "aging" = เฉพาะที่จ่ายแล้ว "และ" เริ่มมีอายุแล้ว (ตัด Unpaid + ตัด aging_risk='No Risk' ออก
  //             เหลือเฉพาะ 1-2/3-4/5-6 เดือน หรือ หมดอายุ)
  const [vatScope, setVatScope] = React.useState("aging"); // Default ตามที่ขอ
  // MARKER_VATDASHBOARD_BROWSER_FULLSCREEN_V1 -- ปุ่มเต็มจอจริงของเบราว์เซอร์ (เหมือนกด F5 ใน PowerPoint) เฉพาะส่วน Dashboard (ซ่อนเมนู/Sidebar) กด Esc หรือกดปุ่มอีกครั้งเพื่อออก
  const dashRootRef = React.useRef(null);
  const [isBrowserFull, setIsBrowserFull] = React.useState(false);
  React.useEffect(() => {
    const onChange = () => setIsBrowserFull(!!document.fullscreenElement && document.fullscreenElement === dashRootRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleBrowserFull = () => {
    try {
      if (document.fullscreenElement) { document.exitFullscreen && document.exitFullscreen(); }
      else if (dashRootRef.current && dashRootRef.current.requestFullscreen) { dashRootRef.current.requestFullscreen().catch(() => {}); }
    } catch (e) { /* เบราว์เซอร์ไม่รองรับ/ถูกบล็อก -- ไม่ทำอะไร */ }
  };
  // ปุ่มลัด Insert = สลับเต็มจอ (Insert ไม่มีหน้าที่อื่นในเบราว์เซอร์) -- ไม่ทำงานตอนกำลังพิมพ์ในช่องกรอก
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Insert" || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      const el = e.target;
      const tag = el && el.tagName ? el.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea" || tag === "select" || (el && el.isContentEditable)) return;
      e.preventDefault();
      toggleBrowserFull();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const [sbHover, setSbHover] = React.useState(null); // MARKER_SINGLEBU_TYPE_TOOLTIP_V1 -- จุดที่เมาส์ชี้ในกราฟเส้น BU เดียว { inst, key } (inst = กราฟหน้าหลัก/Popup)
  const [wfPos, setWfPos] = React.useState({ x: 0, y: 0 }); // MARKER_WATERFALL_TOOLTIP_FIXED_V1 -- ตำแหน่งเมาส์ ใช้วาง Tooltip แบบ fixed ไม่ถูกกรอบแผงบัง
  const [wfHover, setWfHover] = React.useState(null); // MARKER_ZONED_WATERFALL_HOVER_V1 -- แท่งที่เมาส์ชี้ (แผง Low) เพื่อโชว์ Tooltip แบ่ง Aging 0 / 1-2

  // MARKER_UNPAID_DEFINITION_SYNC_V1 -- เดิมต้องตรงกับ CASE ของ display_type ใน vat_summary_schema.sql
  // เป๊ะ (WHEN bus_type IN ('N-PAY','N-PO3') THEN 'Unpaid' / WHEN payment_type='Cheque Return' THEN
  // 'Unpaid' / ELSE bus_type) -- MARKER_CHEQUE_RETURN_AS_EXPIRED_V1 (ฉบับแก้ไขให้ตรงกับ Business Rule
  // จริงที่เจอใน vat_summary_schema.sql TODO #6): "หมดอายุ" ชนะทุกกรณีเสมอ (ตาม fn_vat_payment_group
  // จริง: IF aging_month='Expired' THEN 'expired' — เช็คก่อน payment_type ทุกครั้ง) ส่วน Cheque Return
  // จะกลายเป็น Expired ก็ต่อเมื่อผ่าน Note "Accept with Condition" แล้วเท่านั้น (Trigger
  // sync_aging_on_accept_condition ใน DB จริง Sync aging_label='Accept' กลับมาให้เอง ซึ่งรวมกับ
  // payment_type='Cheque Return' แล้วฝั่ง Backend คำนวณเป็น aging_risk='Expired' ส่งมาให้ Dashboard
  // นี้โดยตรงอยู่แล้ว) -- ไม่ใช่ Cheque Return ทุกแถวเป็น Expired ทันทีแบบที่เคยแก้ไปรอบก่อน (แถวที่
  // ยังไม่ผ่าน Accept ให้ยังนับเป็น Unpaid ตามปกติ)
  // MARKER_CHEQUE_RETURN_FROM_REMARK_V1 -- เปลี่ยนจากเช็ค payment_type='Cheque Return' มาเช็ค
  // r.is_cheque_return แทน (Backend ส่งมาให้แล้ว คำนวณจาก remark='Check Return' ใน
  // vat_watchlist_report เป็นหลักตามที่ยืนยัน ไม่ใช่ payment_type อีกต่อไป — payment_type เดิม
  // บางใบไม่ตรงกับ remark จริง ทำให้นับยอดตกหล่น)
  // MARKER_CHEQUE_RETURN_NEVER_UNPAID_V1 -- Cheque Return แปลว่ามีการ "จ่าย" (ออกเช็ค) ไปแล้ว
  // เช็คถึงจะมีสิทธิ์ "คืน" กลับมาได้ -- ถ้ายังไม่จ่ายเลยจะไม่มีทางเป็น Cheque Return ได้ตั้งแต่ต้น
  // (ไม่มีใบกำกับภาษีมาก่อนด้วยซ้ำ) ดังนั้น Cheque Return ต้องไม่มีทางเป็น Unpaid ได้เลย นับเป็น
  // Paid เสมอ ไม่ว่า aging_risk จะถูก Sync เป็น Expired แล้วหรือยัง (ตัดออกจากเงื่อนไข Unpaid
  // โดยสิ้นเชิง แทนที่จะเป็นเงื่อนไข OR ให้กลายเป็น Unpaid แบบเดิม)
  function isUnpaidRow(r) {
    if (r.aging_risk === "Expired") return false; // หมดอายุชนะทุกกรณี แม้จะเป็น N-PAY/N-PO3/Unpaid
    if (r.is_cheque_return) return false; // Cheque Return = มีการจ่ายไปแล้วเสมอ ไม่มีทางเป็น Unpaid
    return r.payment_type === "Unpaid" || r.bus_type === "N-PAY" || r.bus_type === "N-PO3";
  }

  // ── Helper: แถวนี้อยู่ใน Scope ที่เลือกอยู่หรือไม่ (ใช้ร่วมกันทั้ง Zone B และ Zone F) ─────
  function inVatScope(r, scope) {
    if (scope === "all") return true;
    if (isUnpaidRow(r)) return false; // "paid" และ "aging" ตัด Unpaid ออกทั้งคู่ (ทุกกรณีตาม isUnpaidRow)
    if (scope === "aging") return r.aging_risk !== "No Risk"; // ต้องเริ่มมีอายุแล้วเท่านั้น
    return true; // scope === "paid": เอาที่จ่ายแล้วทั้งหมด (รวม No Risk/Aging 0 ด้วย)
  }

  // MARKER_ZONEA_BU_SORT_BY_AGING_V1 — เรียงปุ่ม BU (Zone A แถว 2 เป็นต้นไป) ตามยอด VAT คงค้างรวม
  // (Aging) จากมากไปน้อย ตามที่ขอ — คำนวณจาก rows ดิบ กรองแค่ baseFilter + vatScope เดียวกับที่
  // Zone B/F ใช้ (ไม่กรองตาม buFilter เอง) เพราะถ้าอิง displayRows ที่กรอง buFilter ด้วย พอเลือก
  // ปุ่มใดปุ่มหนึ่งแล้ว ยอดของ BU อื่นๆ จะหายไปหมด ทำให้ลำดับเพี้ยนทันทีที่เลือก BU
  const buAgingTotals = React.useMemo(() => {
    const map = {};
    rows.forEach((r) => {
      const bu = r.bu;
      if (!bu) return;
      if (baseFilter && buToBase[bu] !== baseFilter) return;
      if (!inVatScope(r, vatScope)) return;
      map[bu] = (map[bu] || 0) + (Number(r[vatField]) || 0);
    });
    return map;
  }, [rows, baseFilter, buToBase, vatScope, vatField]);

  const buTabsForStep2Sorted = React.useMemo(
    () => [...buTabsForStep2].sort((a, b) => (buAgingTotals[b] || 0) - (buAgingTotals[a] || 0)),
    [buTabsForStep2, buAgingTotals]
  );

  // ── Helper: Bucket จาก aging_risk (ใช้สำหรับแถบ Aging ของ Zone F) ─────────────────────
  // MARKER_CHEQUE_RETURN_AS_EXPIRED_V1 -- ไม่ Hardcode Cheque Return → Expired ตรงๆ อีกแล้ว (ย้อนกลับ
  // จากที่แก้รอบก่อน) เพราะ Backend Sync เรื่องนี้ให้เองอยู่แล้วผ่าน r.aging_risk (Trigger
  // sync_aging_on_accept_condition + fn_vat_aging_month) เชื่อ r.aging_risk ตรงๆ พอ — แถว Cheque
  // Return ที่ยังไม่ Accept จะยังมี aging_risk ปกติ (ไม่ใช่ Expired) ตามจริง
  function agingBucketOf(r) {
    if (r.aging_risk === "Medium Risk") return "medium";
    if (r.aging_risk === "High Risk") return "high";
    if (r.aging_risk === "Expired") return "expired";
    if (r.aging_risk === "No Risk") return "zero"; // MARKER_AGING_ZERO_BUCKET_V1 -- Aging 0 แยกสีต่างหาก
    return "low"; // "Low Risk" / อื่นๆ (เช่น Uncount) → fallback เป็น "low"
  }

  // ── Zone B: รวมยอด VAT คงค้าง (exp_vat) แยกตาม Type/Category เสมอ — กรองด้วย vatScope เท่านั้น
  // MARKER_ZONEB_SYNC_WITH_ZONEF_V1 — Sync Scope กับ Zone F ผ่าน vatScope ตัวเดียวกัน ──
  const categoryBreakdown = React.useMemo(() => {
    const sums = {};
    displayRows.forEach((r) => {
      if (!inVatScope(r, vatScope)) return;
      const key = typeKeyOf(r);
      sums[key] = (sums[key] || 0) + (Number(r[vatField]) || 0);
    });
    const total = Object.values(sums).reduce((a, b) => a + b, 0);
    const list = Object.keys(sums)
      .sort((a, b) => {
        const ia = CATEGORY_ORDER.indexOf(a);
        const ib = CATEGORY_ORDER.indexOf(b);
        if (ia === -1 && ib === -1) return sums[b] - sums[a];
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      })
      .map((key) => ({ key, amount: sums[key], pct: total ? (sums[key] / total) * 100 : 0 }));
    return { list, total };
  }, [displayRows, vatScope, vatField]);

  // MARKER_CATEGORY_CARDS_OVERALL_IGNORE_STATUS_V1 — การ์ดสรุปด้านบน (Zone หลัก) ตั้งใจให้เป็น
  // ภาพรวม "Overall" เสมอ ไม่ผูกกับปุ่ม All/Paid/Aging (vatScope) ที่กดอยู่ใน Zone B — นับทุก
  // Record ไม่สนสถานะ Payment เลย แบ่งแค่ตาม Type (CPN/ITC/LAND/UTL/OTH) อย่างเดียวตามที่ขอ
  // (คนละอันกับ categoryBreakdown ด้านบนที่ยัง Sync กับ vatScope ไว้ให้ Donut/Legend ของ Zone B)
  const categoryBreakdownOverall = React.useMemo(() => {
    const sums = {};
    displayRows.forEach((r) => {
      const key = typeKeyOf(r);
      sums[key] = (sums[key] || 0) + (Number(r[vatField]) || 0);
    });
    const total = Object.values(sums).reduce((a, b) => a + b, 0);
    const list = Object.keys(sums)
      .sort((a, b) => {
        const ia = CATEGORY_ORDER.indexOf(a);
        const ib = CATEGORY_ORDER.indexOf(b);
        if (ia === -1 && ib === -1) return sums[b] - sums[a];
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      })
      .map((key) => ({ key, amount: sums[key], pct: total ? (sums[key] / total) * 100 : 0 }));
    return { list, total };
  }, [displayRows, vatField]);

  // MARKER_CATEGORY_CARDS_MERGE_UNPAID_INTO_OTH_V1 — Type "Unpaid" (จาก display_type/bus_type ที่
  // ตอนนี้แบ่ง Type จริงไม่ได้ เพราะ Backend View ยังไม่ส่ง "Category จริง" ของ Vendor มาด้วย — ดู
  // MARKER_CATEGORY_TRUECATEGORY_BACKEND_TODO_V1) ให้ไปรวมกับ OTH แทนที่จะโชว์เป็น Card แยก เหลือ
  // แค่ 5 Card Type (CPN/ITC/LAND/UTL/OTH) เสมอ — Donut/Legend ของ Zone B ยังโชว์ "Unpaid" แยกปกติ
  const categoryBreakdownForCards = React.useMemo(() => {
    const merged = {};
    categoryBreakdownOverall.list.forEach((c) => {
      const key = c.key === "Unpaid" ? "OTH" : c.key;
      merged[key] = (merged[key] || 0) + c.amount;
    });
    return CATEGORY_ORDER.filter((k) => k !== "Unpaid" && merged[k] != null).map((key) => ({ key, amount: merged[key] }));
  }, [categoryBreakdownOverall]);

  // MARKER_CATEGORY_TRUECATEGORY_BACKEND_TODO_V1 — (บันทึกไว้กันลืม ยังไม่ Implement) เจอใน
  // VatController.js ว่าของเดิมมี computeVatWatchlistTrueCategory() คำนวณ "Category จริง" ของ
  // Vendor จากตาราง Mapping (vendorCategoryByCode[supplier_code]['TYPE']) ซึ่งหาได้เสมอไม่ว่า
  // Record จะจ่ายแล้วหรือยัง — แต่ View vat_summary_live_dashboard ที่หน้านี้ดึงมาใช้ยังไม่ส่ง
  // Field นี้มาด้วย เลยเอา "Unpaid" ไปแยกย่อยเป็น CPN/ITC/LAND/UTL/OTH ไม่ได้จริงๆ ตามที่ของเดิม
  // ทำได้ (ตาราง "Total Vat Unpaid [Type]") ถ้า Backend เพิ่ม Field True Type เข้า View แล้ว ค่อย
  // กลับมาแยก "Unpaid" ตาม Type จริงแทนการรวมเข้า OTH แบบตอนนี้

  // MARKER_CATEGORY_CARDS_DATA_V1 — รวม "การ์ด Overall รวมยอด" (ใบแรกสุด) เข้ากับ 5 การ์ด Type
  // เป็น List เดียว สำหรับ Render แถว Summary Card ด้านบนของ Zone หลัก ตามที่ขอ "ด้านหน้าสุดอยากให้
  // มีรวมยอด Overall"
  const summaryCardsData = React.useMemo(() => {
    return [
      { key: "ALL", label: "Summary Vat Overall", amount: categoryBreakdownOverall.total, isTotal: true },
      ...categoryBreakdownForCards.map((c) => ({ key: c.key, label: `Summary Vat All [${c.key}]`, amount: c.amount, isTotal: false })),
    ];
  }, [categoryBreakdownOverall, categoryBreakdownForCards]);

  // ── สี/ป้ายของ Donut (Zone B) — เป็น Type/Category เสมอ ──────────────────────────────────
  const breakdownColorOf = (key) => CATEGORY_COLORS[key] || "#999";
  const breakdownLabelOf = (key) => key;

  // MARKER_BU_EFFECTIVE_RATE_PCT_V1 -- Rate % จริงที่ใช้ Claim ต่อ BU (sum avg_vat / sum exp_vat * 100)
  // คำนวณจาก rows ดิบ (ไม่ผูก Filter/vatScope) เพื่อให้เป็นค่าคงที่ของ BU นั้นเสมอ ไม่ขยับตามปุ่มกรอง
  const buRatePct = React.useMemo(() => {
    const exp = {};
    const avg = {};
    rows.forEach((r) => {
      const bu = r.bu;
      if (!bu) return;
      exp[bu] = (exp[bu] || 0) + (Number(r.exp_vat) || 0);
      avg[bu] = (avg[bu] || 0) + (Number(r.avg_vat) || 0);
    });
    const map = {};
    Object.keys(exp).forEach((bu) => { map[bu] = exp[bu] > 0 ? (avg[bu] / exp[bu]) * 100 : null; });
    return map;
  }, [rows]);

  // ── Zone F: รวมยอด VAT คงค้างต่อ BU แยกตาม Aging Bucket — Sync Scope เดียวกับ Zone B
  // (vatScope) โหมด "all" จะรวม "ไม่จ่าย" กลับเข้ามาเป็นอีก 1 Bucket (unpaid) ด้วย ส่วนโหมด
  // "aging" ตัด aging_risk='No Risk' ออกเพิ่มเติม (เหลือเฉพาะที่เริ่มมีอายุแล้ว) ──
  const buOverview = React.useMemo(() => {
    const map = {};
    displayRows.forEach((r) => {
      const bu = r.bu;
      if (!bu) return;
      if (!inVatScope(r, vatScope)) return;
      const isUnpaid = isUnpaidRow(r);
      if (!map[bu]) map[bu] = { bu, zero: 0, low: 0, medium: 0, high: 0, expired: 0, unpaid: 0, total: 0 };
      const amt = Number(r[vatField]) || 0;
      const bucket = isUnpaid ? "unpaid" : agingBucketOf(r);
      map[bu][bucket] += amt;
      map[bu].total += amt;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [displayRows, vatScope, vatField]);

  // ── Zone D: Waterfall แยกตาม Aging Risk + Type — MARKER_ZONED_WATERFALL_V1
  // Fix Scope เป็น "Aging" เสมอ (ตัด Unpaid + ตัด aging_risk='No Risk' ออก) ไม่ผูกกับปุ่ม
  // All/Paid/Aging ของ Zone B เพราะความหมายของ Zone นี้คือ "ยอดที่เริ่มมีอายุแล้ว" โดยเฉพาะ
  const agingRiskWaterfall = React.useMemo(() => {
    // MARKER_ZONED_WATERFALL_ZERO_SPLIT_V1 -- ปุ่ม All/Paid: แผง Low (Aging ≤ 2) รวม Aging 0 (No Risk) เข้ามาด้วย แล้วแบ่งแต่ละแท่ง/Total เป็น 2 สี (0 กับ 1-2) ; ปุ่ม Aging: ไม่รวม Aging 0 เหมือนเดิม
    const includeZero = vatScope !== "aging";
    const buckets = { high: {}, medium: {}, low: {} };
    displayRows.forEach((r) => {
      if (isUnpaidRow(r)) return;
      let bucket = agingBucketOf(r);
      const isZero = bucket === "zero";
      if (isZero) { if (!includeZero) return; bucket = "low"; }
      if (bucket === "expired" || !buckets[bucket]) return;
      const key = typeKeyOf(r);
      const amt = Number(r[vatField]) || 0;
      const e = buckets[bucket][key] || (buckets[bucket][key] = { amount: 0, zero: 0, ag: {} });
      e.amount += amt;
      const am = String(r.aging_month == null ? "" : r.aging_month).trim();
      e.ag[am] = (e.ag[am] || 0) + amt;
      if (isZero) e.zero += amt;
    });
    const result = {};
    WATERFALL_BUCKET_ORDER.forEach((bucket) => {
      const sums = buckets[bucket];
      const items = Object.keys(sums)
        .map((key) => ({ key, amount: sums[key].amount, zero: sums[key].zero, ag: sums[key].ag }))
        .sort((a, b) => b.amount - a.amount);
      const total = items.reduce((s, it) => s + it.amount, 0);
      const zero = items.reduce((s, it) => s + it.zero, 0);
      const ag = {};
      items.forEach((it) => Object.keys(it.ag).forEach((m) => { ag[m] = (ag[m] || 0) + it.ag[m]; }));
      result[bucket] = { items, total, zero, ag };
    });
    return result;
  }, [displayRows, vatField, vatScope]);

  // ── Zone C: แบ่งตามสถานะการจ่าย (Paid/Unpaid/Expired → Realized/Unrealized) x Type —
  // MARKER_ZONEC_PAYMENT_STATUS_V1 — ใช้ r.bus_type ดิบ (ไม่ใช่ display_type) เป็นตัวแบ่ง Type
  // เพราะ display_type ถูกเขียนทับเป็น "Unpaid" สำหรับแถวที่ไม่จ่าย ทำให้ Type เดิมหายไป — bus_type
  // ดิบยังเก็บ Type จริงไว้เสมอ (ยกเว้นแถว N-PAY/N-PO3 ที่ไม่มี Type จริงอยู่แล้ว พับรวมเข้า OTH
  // เหมือน categoryBreakdownForCards) — "Expired" = Paid แต่ aging_risk='Expired'
  // MARKER_ZONEC_REALIZED_UNREALIZED_V1 -- "Expired" แตกย่อยเป็น Realized/Unrealized เสมอ (Subset
  // ของ Expired เป๊ะ ไม่คาบเกี่ยวข้าม Unpaid อีกต่อไปแบบ Cheque Return เดิม เพราะ isUnpaidRow()
  // กันไว้แล้วว่า Cheque Return ไม่มีทางเป็น Unpaid): Unrealized = ผ่าน Workflow Accept with
  // Condition มี Reason แนบมาด้วย (ตอนนี้เช็คจาก is_cheque_return แต่รองรับ Reason อื่นในอนาคตได้
  // โดยไม่ต้องแก้โครงสร้าง) / Realized = หมดอายุตามเวลาธรรมชาติ ไม่มี Reason
  const paymentStatusBreakdown = React.useMemo(() => {
    const groups = { paid: {}, unpaid: {}, expired: {}, realized_expired: {}, unrealized_expired: {} };
    const typeOf = typeKeyOf;
    displayRows.forEach((r) => {
      const amt = Number(r[vatField]) || 0;
      const t = typeOf(r);
      if (isUnpaidRow(r)) {
        groups.unpaid[t] = (groups.unpaid[t] || 0) + amt;
      } else {
        groups.paid[t] = (groups.paid[t] || 0) + amt;
        if (agingBucketOf(r) === "expired") {
          groups.expired[t] = (groups.expired[t] || 0) + amt;
          if (r.is_cheque_return) {
            groups.unrealized_expired[t] = (groups.unrealized_expired[t] || 0) + amt;
          } else {
            groups.realized_expired[t] = (groups.realized_expired[t] || 0) + amt;
          }
        }
      }
    });
    const result = {};
    Object.keys(groups).forEach((k) => {
      const total = Object.values(groups[k]).reduce((a, b) => a + b, 0);
      result[k] = { sums: groups[k], total };
    });
    return result;
  }, [displayRows, vatField]);

  // MARKER_ZONEC_PAID_AGING_TOOLTIP_V1 -- Tooltip การ์ด Total Vat Paid: ยอดที่จ่ายแล้วแยกตาม Aging (0-6, Expired)
  // ใช้แถวชุดเดียวกับ groups.paid ใน paymentStatusBreakdown (ไม่ใช่ Unpaid) ผลรวม = ยอดบนการ์ดพอดี (Aging ที่ไม่รู้จักรวมใน "อื่นๆ")
  const paidAgingBreakdown = React.useMemo(() => {
    const keys = ["0", "1", "2", "3", "4", "5", "6", "Expired", "other"];
    const make = () => { const o = {}; keys.forEach((k) => { o[k] = 0; }); return o; };
    const out = { ALL: make() };
    PAYMENT_STATUS_TYPES.forEach((t) => { out[t] = make(); });
    displayRows.forEach((r) => {
      if (isUnpaidRow(r)) return;
      const amt = Number(r[vatField]) || 0;
      const raw = r.aging_month === "Expired" ? "Expired" : String(r.aging_month ?? "");
      const k = keys.includes(raw) && raw !== "other" ? raw : "other";
      const t = typeKeyOf(r);
      out.ALL[k] += amt;
      if (out[t]) out[t][k] += amt;
    });
    return out;
  }, [displayRows, vatField]);

  // MARKER_ZONEC_EXPIRED_DETAIL_BY_BU_V1 -- เหมือน paymentStatusBreakdown แต่ Group ตาม r.bu แทน
  // Type เพื่อตอบคำถาม "ประกอบไปด้วย BU อะไรบ้าง" ใน Popup Expired Detail — เรียงจากยอด Unrealized
  // มากไปน้อย (BU ที่มีปัญหา Cheque Return เยอะสุดขึ้นก่อน) — เอากลับมาแล้ว (ก่อนหน้าเข้าใจผิดว่าให้ตัดออก)
  const expiredDetailByBU = React.useMemo(() => {
    const realized = {};
    const unrealized = {};
    displayRows.forEach((r) => {
      if (isUnpaidRow(r)) return;
      if (agingBucketOf(r) !== "expired") return;
      const amt = Number(r[vatField]) || 0;
      const bu = r.bu || "-";
      if (r.is_cheque_return) {
        unrealized[bu] = (unrealized[bu] || 0) + amt;
      } else {
        realized[bu] = (realized[bu] || 0) + amt;
      }
    });
    const buList = Array.from(new Set([...Object.keys(realized), ...Object.keys(unrealized)]));
    const buRows = buList
      .map((bu) => ({ bu, realized: realized[bu] || 0, unrealized: unrealized[bu] || 0, total: (realized[bu] || 0) + (unrealized[bu] || 0) }))
      .sort((a, b) => b.unrealized - a.unrealized || b.total - a.total);
    return buRows;
  }, [displayRows, vatField]);

  // MARKER_ZONEC_EXPIRED_DETAIL_3MONTH_TREND_V1 -- เทียบ Realized/Unrealized/Expired ย้อนหลัง
  // อย่างน้อย 3 เดือนจากเดือนปัจจุบัน (periodMonth) — ใช้ "rows" ดิบทั้งหมด (ไม่ใช่ displayRows ที่
  // derive มาจาก rows เดือนเดียว) กรองแค่ baseFilter/buFilter เหมือน displayRows เพื่อให้ Sync กับ
  // BU/Base ที่เลือกอยู่ แต่ไม่ล็อก Period เดียว — ตอนนี้ Backend (vat_summary_live) ยังไม่เก็บ
  // ประวัติเดือนเก่าไว้จริง (มีแค่ Period ปัจจุบัน) ดังนั้นเดือนที่ไม่มีข้อมูลจะโชว์เป็น 0/ไม่มีข้อมูล
  // ไปก่อน — พอ Backend เก็บประวัติ (ผ่าน Freeze หรือกลไกอื่น) ย้อนหลังจริง Logic นี้จะดึงมาใช้ได้ทันที
  // โดยไม่ต้องแก้โครงสร้างซ้ำ (Group ตาม period_month อยู่แล้ว)
  const expiredTrend3Month = React.useMemo(() => {
    // สร้างรายชื่อ 3 เดือนล่าสุด (รวมเดือนปัจจุบัน) ตามรูปแบบ "YYYY-MM" ของ periodMonth
    const months = [];
    // MARKER_ZONEC_EXPIRED_TREND_ANCHOR_LAST_LIVE_V1 -- หลังปิด Period แล้วยังไม่มี Live เดือนใหม่
    // ให้ยึดเดือนล่าสุดที่มีข้อมูลจริง (<= periodMonth) เพื่อให้ Compare 3 month คงเดิมจนกว่า Live ใหม่จะเข้ามา
    const _isPm = (s) => typeof s === "string" && /^\d{4}-\d{2}$/.test(s);
    let anchorMonth = periodMonth;
    if (_isPm(periodMonth)) {
      let latest = null;
      rows.forEach((row) => {
        const pm = row.period_month;
        if (_isPm(pm) && pm <= periodMonth && (!latest || pm > latest)) latest = pm;
      });
      if (latest) anchorMonth = latest;
    }
    if (_isPm(anchorMonth)) {
      const [y, m] = anchorMonth.split("-").map(Number);
      for (let i = 2; i >= 0; i--) {
        const d = new Date(y, m - 1 - i, 1);
        months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      }
    } else {
      months.push(periodMonth || "-");
    }

    let r = rows;
    if (baseFilter) r = r.filter((row) => buToBase[row.bu] === baseFilter);
    if (buFilter) r = r.filter((row) => row.bu === buFilter);

    // MARKER_ZONEC_EXPIRED_TREND_BYTYPE_V1 — แยก Realized+Unrealized ตาม Type (CPN/ITC/LAND/UTL/OTH)
    // ด้วย เพื่อใช้เปรียบเทียบ MoM รายTypeใน Popup (MARKER_ZONEC_EXPIRED_MOM_BYTYPE_V1 ด้านล่าง)
    const typeOfRow = typeKeyOf;
    const byMonth = {};
    months.forEach((m) => { byMonth[m] = { realized: 0, unrealized: 0, expired: 0, hasData: false, byType: {} }; });
    r.forEach((row) => {
      const pm = row.period_month;
      if (!byMonth[pm]) return; // นอกช่วง 3 เดือนที่สนใจ ข้าม
      if (isUnpaidRow(row)) return;
      if (agingBucketOf(row) !== "expired") return;
      const amt = Number(row[vatField]) || 0;
      const t = typeOfRow(row);
      if (!byMonth[pm].byType[t]) byMonth[pm].byType[t] = { realized: 0, unrealized: 0 };
      byMonth[pm].expired += amt;
      byMonth[pm].hasData = true;
      if (row.is_cheque_return) {
        byMonth[pm].unrealized += amt;
        byMonth[pm].byType[t].unrealized += amt;
      } else {
        byMonth[pm].realized += amt;
        byMonth[pm].byType[t].realized += amt;
      }
    });
    return months.map((m) => ({ month: m, ...byMonth[m] }));
  }, [rows, baseFilter, buFilter, buToBase, vatField, periodMonth]);

  // MARKER_ZONEC_EXPIRED_MOM_BYTYPE_V1 — เปรียบเทียบเดือนปัจจุบัน vs เดือนก่อนหน้า รายType (All +
  // CPN/ITC/LAND/UTL/OTH) สำหรับลูกศรขึ้น/ลงข้างตาราง By Type ใน Popup -- ใช้ expiredTrend3Month
  // (เดือนสุดท้าย = ปัจจุบัน, เดือนก่อนสุดท้าย = เดือนก่อนหน้า) ถ้าเดือนก่อนหน้ายังไม่มีข้อมูล (ไม่มี
  // Freeze) จะส่ง compare:false กลับไปเพื่อโชว์ "ไม่มีข้อมูลเปรียบเทียบ" แทนลูกศร
  const expiredMomByType = React.useMemo(() => {
    const n = expiredTrend3Month.length;
    const curr = expiredTrend3Month[n - 1];
    const prev = n >= 2 ? expiredTrend3Month[n - 2] : null;
    const canCompare = !!(curr && curr.hasData && prev && prev.hasData);
    const mk = (currVal, prevVal) => {
      if (!canCompare) return { current: currVal || 0, previous: null, deltaPct: null, direction: "none" };
      const c = currVal || 0;
      const p = prevVal || 0;
      const deltaPct = p === 0 ? (c === 0 ? 0 : null) : ((c - p) / p) * 100;
      const direction = c > p ? "up" : c < p ? "down" : "flat";
      return { current: c, previous: p, deltaPct, direction };
    };
    const rowsOut = {};
    rowsOut.All = mk(curr?.expired, prev?.expired);
    PAYMENT_STATUS_TYPES.forEach((t) => {
      const c = curr?.byType?.[t];
      const p = prev?.byType?.[t];
      const cTotal = (c?.realized || 0) + (c?.unrealized || 0);
      const pTotal = (p?.realized || 0) + (p?.unrealized || 0);
      rowsOut[t] = mk(cTotal, pTotal);
    });
    return { canCompare, currMonth: curr?.month, prevMonth: prev?.month, rows: rowsOut };
  }, [expiredTrend3Month]);

  // MARKER_ZONEC_EXPIRED_MOM_ARROW_RENDER_V1 — Render ลูกศรขึ้น/ลง + %Change จาก expiredMomByType
  // (ใช้ทั้งแถว "All" และราย Type ในฝั่งขวาของตาราง By Type ใน Popup)
  const renderMomArrow = (entry) => {
    if (!entry || entry.direction === "none") {
      return <span style={{ color: "#bbb", fontSize: "12px" }}>—</span>;
    }
    const arrow = entry.direction === "up" ? "▲" : entry.direction === "down" ? "▼" : "●";
    const color = entry.direction === "up" ? "#16a34a" : entry.direction === "down" ? "#dc2626" : "#888";
    const pctText = entry.deltaPct === null ? "" : ` ${entry.deltaPct >= 0 ? "+" : ""}${entry.deltaPct.toFixed(1)}%`;
    return (
      <span style={{ color, fontWeight: 700, fontSize: "13px" }}>
        {arrow}{pctText}
      </span>
    );
  };

  // MARKER_SINGLEBU_SCOPE_SYNC_V1 — จุดที่โชว์ในกราฟต้องเปลี่ยนตามปุ่ม All/Paid/Aging ที่กดอยู่
  // (Sync กับ vatScope เหมือน Zone B/F) ไม่ใช่โชว์ทุก Bucket ตลอดแบบเดิม — ให้ตรงกับความหมายจริง
  // ของ inVatScope(): "all"=ทุกแถว (9 จุด รวม Unpaid+0), "paid"=ตัด Unpaid ออก (8 จุด เหมือน
  // VatController ต้นแบบ), "aging"=ตัดทั้ง Unpaid และ aging_month=0/No Risk ออกด้วย (7 จุด: 1-6,Expired)
  const singleBuPointOrder = React.useMemo(() => {
    if (vatScope === "all") return SINGLEBU_POINT_ORDER;
    if (vatScope === "paid") return SINGLEBU_POINT_ORDER.filter((k) => k !== "unpaid");
    return SINGLEBU_POINT_ORDER.filter((k) => k !== "unpaid" && k !== "0");
  }, [vatScope]);

  // ── MARKER_SINGLEBU_LINECHART_V1 — เมื่อเลือก BU เดียว (buFilter) ให้รวม displayRows (กรองตาม
  // BU นั้นแล้วจาก memo ด้านบน + กรองตาม vatScope ด้วย inVatScope() เดียวกับ Zone B/F) เข้า Bucket
  // ตาม singleBuPointOrder ด้านบน: Unpaid(payment_type='Unpaid'), 0-6(aging_month ดิบของแถวที่จ่าย
  // แล้ว), Expired(aging_month='Expired')
  const singleBuMonthlyPoints = React.useMemo(() => {
    if (!buFilter) return null;
    const sums = {};
    const typeSums = {}; // MARKER_SINGLEBU_TYPE_TOOLTIP_V1 -- ยอดแยกตาม Type (CPN/ITC/LAND/UTL/OTH) ของแต่ละจุด ใช้โชว์ใน Tooltip
    singleBuPointOrder.forEach((k) => { sums[k] = 0; typeSums[k] = {}; });
    const addTo = (k, r, amt) => {
      sums[k] += amt;
      const t = typeKeyOf(r);
      typeSums[k][t] = (typeSums[k][t] || 0) + amt;
    };
    displayRows.forEach((r) => {
      if (!inVatScope(r, vatScope)) return;
      const amt = Number(r[vatField]) || 0;
      if (isUnpaidRow(r)) {
        if (Object.prototype.hasOwnProperty.call(sums, "unpaid")) addTo("unpaid", r, amt);
        return;
      }
      if (r.aging_month === "Expired") {
        if (Object.prototype.hasOwnProperty.call(sums, "expired")) addTo("expired", r, amt);
        return;
      }
      if (Object.prototype.hasOwnProperty.call(sums, r.aging_month)) addTo(r.aging_month, r, amt);
    });
    const total = Object.values(sums).reduce((a, b) => a + b, 0);
    const points = singleBuPointOrder.map((k) => ({
      key: k,
      label: SINGLEBU_POINT_LABELS[k],
      value: sums[k],
      color: SINGLEBU_POINT_COLORS[k],
      byType: typeSums[k],
    }));
    return { points, total };
  }, [displayRows, buFilter, vatScope, singleBuPointOrder, vatField]);

  // MARKER_SINGLEBU_PREV_COMPARE_V1 — เทียบยอดรวมของ BU ที่เลือกกับ "Last Period" (เดือนก่อนหน้า)
  // ตอนนี้ Backend (vat_summary_live_dashboard) ยังไม่มี Endpoint ดึงข้อมูลย้อนหลังเป็นรายเดือน
  // เลย singleBuPrevTotal คงเป็น null เสมอไปก่อน (= ไม่โชว์ลูกศร/% ตามที่ตกลงกันไว้) พอมี Endpoint
  // พร้อมแล้ว ผูกค่าจริงเข้ามาแทน null ตรงนี้ได้เลย ตัว UI (makeSingleBuLineChartNode) คำนวณ % ให้เอง
  const singleBuPrevTotal = null; // TODO: ผูกกับยอดรวมของ BU เดียวกัน ณ เดือนก่อนหน้า เมื่อ Backend พร้อม
  const singleBuPrevCompare = React.useMemo(() => {
    if (!singleBuMonthlyPoints || singleBuPrevTotal == null || singleBuPrevTotal <= 0) return null;
    const pct = ((singleBuMonthlyPoints.total - singleBuPrevTotal) / singleBuPrevTotal) * 100;
    return { pct, prevTotal: singleBuPrevTotal };
  }, [singleBuMonthlyPoints, singleBuPrevTotal]);
  // MARKER_SINGLEBU_PREV_BY_BUCKET_V1 — ยอด Previous Period แยกตาม Aging Bucket (สำหรับตาราง
  // Previous/Current รายแถว) ตอนนี้ยังไม่มี Endpoint ให้ดึง เลยเป็น null เสมอ (ตารางจะโชว์ "–" ใน
  // คอลัมน์ Previous/% เปลี่ยนแปลง) — พอ Backend พร้อม ผูก object { [bucketKey]: amount } เข้ามาแทนได้เลย
  const singleBuPrevByBucket = null; // TODO: { unpaid, "0", "1", ... , expired } ของเดือนก่อนหน้า

  // MARKER_CATEGORY_PREV_BY_TYPE_V1 — ยอด Previous Period แยกตาม Type (CPN/ITC/LAND/UTL/OTH)
  // สำหรับ Popup Preview Panel (คอลัมน์ Previous/Current ข้าง Donut) ตอนนี้ยังไม่มี Endpoint
  // ให้ดึงเหมือนกัน เลยเป็น null เสมอ (โชว์ "–") — พอ Backend พร้อม ผูก { [typeKey]: amount } แทนได้เลย
  const categoryPrevByType = null; // TODO: { CPN, ITC, LAND, UTL, OTH, ... } ของเดือนก่อนหน้า

  // เตรียมพิกัด x,y + เส้นแบ่งโซน Green Flag/Red Flag/Expired (+ Unpaid) ล่วงหน้าไว้ Render
  // viewBox คงที่ 300x100 (เหมือน VatController ต้นแบบ) แล้วค่อยยืดเต็ม Container ด้วย
  // preserveAspectRatio="none" ตอน Render
  const singleBuChartGeom = React.useMemo(() => {
    if (!singleBuMonthlyPoints) return null;
    const pts = singleBuMonthlyPoints.points;
    const n = pts.length;
    const stepX = SINGLEBU_CHART_W / (n - 1);
    const maxVal = Math.max(0, ...pts.map((p) => p.value));
    const rawStep = Math.max(maxVal / 4, 1);
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / mag;
    const niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    const step = Math.max(50000, niceNorm * mag);
    const ceilMax = Math.max(step, Math.ceil(maxVal / step) * step);
    const yOf = (v) => SINGLEBU_CHART_H - (v / ceilMax) * SINGLEBU_CHART_H;
    const coords = pts.map((p, i) => ({ ...p, x: i * stepX, y: yOf(p.value) }));
    const gridLines = [];
    for (let v = 0; v <= ceilMax + 0.5; v += step) gridLines.push(v);
    // MARKER_SINGLEBU_ZONE_BOUNDARY_DYNAMIC_V1 — เดิม Fix Index ตายตัว (ใช้ได้แค่ตอน 9 จุดคงที่)
    // ตอนนี้จำนวน/ชนิดจุดเปลี่ยนตาม vatScope แล้ว เลยต้องหาขอบเขตแต่ละโซนจาก "จุดสุดท้ายของกลุ่ม
    // นั้นที่ยังเหลืออยู่จริง" แทน (กึ่งกลางระหว่างจุดนั้นกับจุดถัดไปเสมอ = stepX*(index+0.5)) —
    // ถ้ากลุ่มไหนไม่มีจุดเหลือเลย (เช่น "aging" ไม่มี Unpaid) ให้ Fallback เป็น 0 (โซนนั้นไม่กิน
    // พื้นที่) หรือพับรวมกับขอบเขตก่อนหน้า
    let unpaidEnd = 0;
    let greenEnd = 0;
    let redEnd = 0;
    pts.forEach((p, i) => {
      const boundary = stepX * (i + 0.5);
      const g = SINGLEBU_GROUP_OF[p.key];
      if (g === "unpaid") unpaidEnd = boundary;
      if (g === "green") greenEnd = boundary;
      if (g === "red") redEnd = boundary;
    });
    if (greenEnd === 0) greenEnd = unpaidEnd;
    if (redEnd === 0) redEnd = greenEnd;
    return { coords, stepX, ceilMax, gridLines, unpaidEnd, greenEnd, redEnd };
  }, [singleBuMonthlyPoints]);

  // ── Bucket Order/สี/ป้าย ของแถบ Zone F ตามโหมดปัจจุบัน ──────────────────────────────────
  // MARKER_ZONEF_ORDER_UNPAID_FIRST_V1 — เรียง Unpaid ไว้หน้าสุดตามที่ขอ: Unpaid|0-2|3-4|5-6|Expired
  const zoneFBucketOrder = vatScope === "all" ? ["unpaid", ...AGING_BUCKET_ORDER] : AGING_BUCKET_ORDER;
  const zoneFBucketColors = vatScope === "all" ? { ...AGING_BUCKET_COLORS, unpaid: UNPAID_BUCKET_COLOR } : AGING_BUCKET_COLORS;
  const zoneFBucketLabels = vatScope === "all" ? { ...AGING_BUCKET_LABELS, unpaid: UNPAID_BUCKET_LABEL } : AGING_BUCKET_LABELS;
  // ── MARKER_ZONEF_FIXED10_DYNAMIC_ROWH_V1 — กลับทางจากเดิม: เดิม Fix ขนาดแถว (ROW_H คงที่)
  // แล้ววัดพื้นที่เพื่อคำนวณว่าใส่ได้กี่แถว (Dynamic Count) — ตอนนี้ตามที่ขอ "10 List พอแล้ว"
  // เลย Fix จำนวนแถวที่โชว์ไว้ที่ 10 แทน แล้ววัดพื้นที่ที่เหลือจริงด้วย ResizeObserver มาคำนวณ
  // "ขนาดหลอด" (ความสูงแต่ละแถว) ให้พอดีเต็มพื้นที่แทน (Dynamic Row Height) — ถ้าพื้นที่สูงขึ้น
  // ทีหลัง แถวจะโตขึ้นเองอัตโนมัติ ไม่ใช่โชว์มากแถวขึ้น
  const ZONEF_VISIBLE_N = 10;
  const ZONEF_ROW_GAP = 4;
  const zoneFRowsRef = React.useRef(null);
  const [zoneFRowH, setZoneFRowH] = React.useState(14); // fallback ก่อนวัดความสูงจริงครั้งแรก
  // MARKER_ZONEF_RESIZEOBSERVER_BUG_FIX_V1 — บั๊กที่เจอ: ตอน Mount ครั้งแรก buOverview ยังว่าง
  // (ข้อมูลจาก API ยังไม่มาถึง) เลยเรนเดอร์ Branch "ไม่มีข้อมูล" แทน ซึ่ง <div ref={zoneFRowsRef}>
  // ไม่ได้อยู่ใน DOM ตอนนั้นเลย — Effect (deps: []) รันครั้งเดียวตอนนั้นพอดี เจอ el เป็น null เลย
  // return ออกไปโดยไม่ได้ผูก ResizeObserver เลย พอข้อมูลมาทีหลังก็ไม่รันซ้ำอีก (deps ว่าง) ทำให้
  // ค้างอยู่ที่ Fallback ตลอดไป — แก้โดยใส่ buOverview.length เป็น dependency ให้ Effect รันซ้ำ
  // ทุกครั้งที่ข้อมูล/Filter เปลี่ยน (รวมถึงตอนจาก 0 เป็นมีข้อมูลครั้งแรก) จะได้มี el จริงให้วัด
  React.useEffect(() => {
    const el = zoneFRowsRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const compute = () => {
      // MARKER_ZONEF_ROW_PADDING_3PX_V1 — เผื่อ Gap บน/ล่างของ el เอง (paddingTop/Bottom 3px
      // ที่ใส่ไว้ด้านล่าง) ออกจากพื้นที่ที่เอาไปหารแถวด้วย ไม่งั้นแถวจะล้นออกมาทับ Padding
      const h = el.clientHeight - 6;
      const n = Math.max(1, Math.min(ZONEF_VISIBLE_N, buOverview.length || ZONEF_VISIBLE_N));
      const totalGap = ZONEF_ROW_GAP * (n - 1);
      setZoneFRowH(Math.max(14, Math.min(20, (h - totalGap) / n))); // MARKER_ZONEF_ROWH_MIN14_V1 — ขยายขั้นต่ำแต่ไม่สูงเกินไป
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [buOverview.length]);

  const [showAllBU, setShowAllBU] = React.useState(false);
  React.useEffect(() => { setShowAllBU(false); }, [baseFilter, buFilter]);
  const buOverviewVisible = showAllBU ? buOverview : buOverview.slice(0, Math.min(ZONEF_VISIBLE_N, buOverview.length));
  const buMax = buOverview.length ? buOverview[0].total : 0;

  // ── MARKER_ZONEF_ALLBU_POPUP_V1 — ปุ่ม "ดูทั้งหมด" เปิด Popup แสดงทุก BU (แบบ Detail Overview
  // ของ VatController) คลิกแถวไหน -> ตั้ง buFilter เป็น BU นั้น + ปิด Popup (ไปโชว์กราฟเส้นด้านล่าง)
  // MARKER_ZONEF_ALLBU_POPUP_SCOPE_SYNC_V1 — "แสดงยอดตามที่กด" ตามที่ขอ: ข้อมูลในตารางต้องกรอง
  // ตาม vatScope (All/Paid/Aging) เดียวกับปุ่มหลักเสมอ ไม่ใช่โชว์ความเสี่ยงดิบคงที่แบบต้นแบบ
  const [showAllBuPopup, setShowAllBuPopup] = React.useState(false);
  // MARKER_ZONEC_EXPIRED_DETAIL_POPUP_V1 — Popup แสดง Realized/Unrealized Expired แบบละเอียด
  // (กดปุ่ม "i" ที่การ์ด Total Vat Expired All เปิด)
  const [showExpiredDetailPopup, setShowExpiredDetailPopup] = React.useState(false);
  const [expiredDetailFull, setExpiredDetailFull] = React.useState(false); // MARKER_EXPIRED_DETAIL_FULLSCREEN_V1 -- ปุ่มขยาย Popup Expired Detail เต็มจอ
  const [paidHoverTip, setPaidHoverTip] = React.useState(null); // MARKER_ZONEC_PAID_AGING_TOOLTIP_V1 -- { key: 'ALL'|Type, x, y } | null
  const [expiredHoverTip, setExpiredHoverTip] = React.useState(null); // MARKER_ZONEC_EXPIRED_HOVER_RU_V1 -- { key: 'ALL'|Type, x, y } | null
  // MARKER_ZONEC_EXPIRED_DETAIL_VIEW_TOGGLE_V1 — สลับมุมมองใน Popup Expired Detail: "type" หรือ "bu"
  // (เอากลับมาแล้วตามที่ขอ — "ตัด Zone BU" ที่พูดก่อนหน้าเข้าใจผิด)
  const [expiredDetailView, setExpiredDetailView] = React.useState("type");
  // MARKER_ZONEC_EXPIRED_TREND_CHART_HOVER_TOOLTIP_V1 — Hover แท่งกราฟ "เทียบ 3 เดือนย้อนหลัง" แล้วโชว์
  // Tooltip Detail (เดือน/Type/ยอดเต็ม) ตามที่ขอ "ขอ Hover แล้วแสดง Detail มาให้ด้วยสิ" — เก็บ Key ของ
  // แท่งที่กำลังชี้อยู่ (month+type) ไว้เฉยๆ ไม่ต้องยิง API ซ้ำ ข้อมูลมีอยู่ในมือ (expiredTrend3Month) แล้ว
  const [hoveredTrendBar, setHoveredTrendBar] = React.useState(null); // { month, type, value } | null
  // MARKER_ZONEC_EXPIRED_DETAIL_CELL_NAV_V1 — ตามที่ขอ "กดลูกศรขึ้นลง/ซ้ายขวาต้องเลื่อน Cell ถ้าจะ
  // Scroll ให้กดค้าง" — คลิก Cell เพื่อเลือก แล้วใช้ลูกศรเลื่อนทีละ Cell (Auto Scroll ตามไปด้วยถ้า Cell
  // ที่เลื่อนไปอยู่นอกจอ) กดค้างลูกศร = Browser ยิง keydown ซ้ำเร็วๆ เอง ทำให้เหมือนเลื่อน/Scroll รัว
  const [selectedDetailCell, setSelectedDetailCell] = React.useState(null); // { row, col } | null
  const detailCellRefs = React.useRef(new Map());
  // MARKER_ZONEC_EXPIRED_BU_DETAIL_ZONE_V1 — กดยอด Realized/Unrealized ในตาราง By BU แล้วดึงรายการ
  // Invoice จาก vat_watchlist_report (ผ่าน /vat_watchlist_detail) มาโชว์ใน "Zone ว่าง" คงที่ด้านล่าง
  // ตาราง By BU เสมอ (ไม่ใช่แทรกใต้แถวที่กดแบบเดิม) ตามที่ขอ: "ด้านบนเป็นจุดแสดง BU ด้านล่างเป็น
  // Zone ว่าง เมื่อมีการกด Unrealize ให้แสดง Detail ที่มาของข้อมูลนี้"
  // MARKER_ZONEC_EXPIRED_DETAIL_JUNK_SUBTOTAL_FILTER_V1 — ดักแถว "Total Group Branch" (แถวสรุปยอด
  // รวมกลุ่ม Branch ที่หลุดติดมาปนกับ Invoice จริงใน vat_watchlist_report เช่น
  // "ELMECH ENGINEERING CO.,LTD. -------------- Total Group Branch : &cp_group1 ...") ตามที่ขอ
  // "ระบบดักว่าอันไหนเป็นแบบนี้ให้ตัดตั้งแต่ตรงที่กรอบออก" -- เช็คทุก Column ของแถว ถ้าเจอ Pattern
  // นี้ที่ไหนก็ตาม ให้ตัดแถวนั้นทิ้งทั้งแถว ไม่นับเป็น Invoice จริง
  const isJunkSubtotalRow = React.useCallback((r) => {
    return Object.values(r).some((v) => typeof v === "string" && /total\s*group\s*branch/i.test(v));
  }, []);
  const [buDetailSelection, setBuDetailSelection] = React.useState(null); // { bu, bucket }
  const [buDetailState, setBuDetailState] = React.useState({ loading: false, error: null, rows: [] });
  // MARKER_ZONEC_EXPIRED_DETAIL_CELL_NAV_V1 — ต้องอยู่หลัง buDetailSelection/buDetailState ประกาศแล้ว
  // เท่านั้น (ก่อนหน้านี้วางไว้เหนือจุดประกาศ ทำให้ Error "Cannot access 'buDetailSelection' before
  // initialization" เพราะ const ไม่ Hoist) -- เปลี่ยน BU/Reason ที่เลือกดู Detail ใหม่ ให้เคลียร์ Cell
  // ที่เคยเลือกไว้ (ข้อมูลเปลี่ยนแล้ว ตำแหน่งเดิมไม่มีความหมาย)
  React.useEffect(() => {
    setSelectedDetailCell(null);
  }, [buDetailSelection]);
  // Cell ที่เลือกเปลี่ยนตำแหน่ง (จากลูกศร) -- เลื่อน Scroll ให้ Cell นั้นอยู่ในจอเสมอ
  React.useEffect(() => {
    if (!selectedDetailCell) return;
    const el = detailCellRefs.current.get(`${selectedDetailCell.row}-${selectedDetailCell.col}`);
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [selectedDetailCell]);
  const selectBuDetail = React.useCallback(async (bu, bucket) => {
    setBuDetailSelection({ bu, bucket });
    setBuDetailState({ loading: true, error: null, rows: [] });
    try {
      const qs = new URLSearchParams({ bu, bucket });
      const data = await apiFetch(`/vat_watchlist_detail?${qs.toString()}`);
      const list = Array.isArray(data) ? data : (Array.isArray(data?.rows) ? data.rows : []);
      setBuDetailState({ loading: false, error: null, rows: list.filter((r) => !isJunkSubtotalRow(r)) });
    } catch (err) {
      console.error("selectBuDetail error:", err);
      setBuDetailState({ loading: false, error: "โหลดรายละเอียดไม่สำเร็จ", rows: [] });
    }
  }, [isJunkSubtotalRow]);
  // MARKER_ZONEC_EXPIRED_UNREALIZED_REASON_CARDS_V1 — Zone 40% บน By BU แบ่งแนวกว้าง 70:30
  // (70 = ตาราง By BU เดิม, 30 = Card สรุป Unrealized แยกตาม Reason: Check Return / Issue / Other)
  // ดึง Unrealized ทุก BU มาครั้งเดียว (ไม่ระบุ bu) แล้วจัดกลุ่มจาก Column "remark"/Note ฝั่ง Frontend
  // กด Card แล้วโชว์ Detail (รวม Note) ใน Zone 60% ด้านล่างได้ทันทีโดยไม่ต้องยิง Fetch ซ้ำ
  const [unrealizedReasonState, setUnrealizedReasonState] = React.useState({ loading: false, error: null, rows: [] });
  React.useEffect(() => {
    if (!showExpiredDetailPopup || expiredDetailView !== "bu") return;
    let cancelled = false;
    setUnrealizedReasonState((prev) => ({ ...prev, loading: true, error: null }));
    (async () => {
      try {
        const data = await apiFetch(`/vat_watchlist_detail?bucket=unrealized`);
        const list = Array.isArray(data) ? data : (Array.isArray(data?.rows) ? data.rows : []);
        if (!cancelled) setUnrealizedReasonState({ loading: false, error: null, rows: list });
      } catch (err) {
        console.error("unrealizedReasonState fetch error:", err);
        if (!cancelled) setUnrealizedReasonState({ loading: false, error: "โหลดสรุป Reason ไม่สำเร็จ", rows: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [showExpiredDetailPopup, expiredDetailView]);
  // MARKER_ZONEC_EXPIRED_REASON_MATCH_FIX_V1 — เช็คจาก pgAdmin พบว่า vat_watchlist_report มี 2
  // Column แยกกัน: "note" (มักเป็น [null]) กับ "remark" (เก็บข้อความจริงเช่น "Check Return") --
  // ตามที่ขอ: Check Return = Remark มีคำว่า "Check Return", Issue = Remark มีคำว่า "Issue" ตรงๆ
  // (ไม่ใช่ Catch-all), Other = ที่เหลือทั้งหมดที่ไม่เข้า 2 เงื่อนไขแรก */
  const UNREALIZED_REASON_CARDS = [
    { key: "check_return", label: "Check Return", color: "#7c3aed", match: (s) => /check\s*return|cheque\s*return/i.test(s) },
    { key: "issue", label: "Issue", color: "#b45309", match: (s) => /issue/i.test(s) },
    { key: "other", label: "Other", color: "#64748b", match: () => true },
  ];
  // MARKER_ZONEC_EXPIRED_REASON_NOTECOL_HELPER_V1 — หา Column ที่เป็น remark จริง: ให้ Priority
  // Column ชื่อ "remark" แบบตรงตัวก่อนเสมอ (ไม่ใช่ "note" ที่มักเป็น [null]) แล้วค่อย Fallback ไปหา
  // Column อื่นที่ชื่อคล้ายกันถ้าไม่เจอ "remark" ตรงๆ
  const reasonNoteColOf = React.useCallback((r) => {
    const keys = Object.keys(r);
    const exact = keys.find((c) => c.toLowerCase() === "remark");
    const k = exact || keys.find((c) => /remark/i.test(c)) || keys.find((c) => /note/i.test(c));
    return k ? String(r[k] ?? "").trim() : "";
  }, []);
  // MARKER_ZONEC_EXPIRED_REASON_CARDS_SCOPE_BY_BU_V1 — ตอนกดยอด Unrealized ของ BU ไหนในตาราง
  // ด้านบน (ซ้าย 70%) Card ฝั่งขวา (30%) ต้องเปลี่ยนมาแบ่งองค์ประกอบเฉพาะ BU นั้น ไม่ใช่โชว์ยอดรวม
  // ทุก BU ค้างอยู่เหมือนเดิม ตามที่ขอ: "เมื่อกดด้านข้างต้องเปลี่ยนแล้วแบ่งมาให้ว่าประกอบด้วยอะไรบ้าง"
  // MARKER_ZONEC_EXPIRED_REASON_CARDS_FOLLOW_VIEW_SCOPE_V1 -- การ์ดต้องตาม Scope เดียวกับตารางซ้าย:
  // กดยอด Unrealized ของ BU -> BU นั้น / ไม่งั้นถ้าหน้าหลักเลือก BU (buFilter) -> BU นั้น /
  // ไม่งั้นถ้าเลือก Base (baseFilter) -> เฉพาะ BU ใน Base นั้น / ไม่เลือกอะไร = ภาพรวมทุก BU
  // MARKER_ZONEC_EXPIRED_UNREALIZED_ANY_REASON_V2 -- Unrealized = Expired ที่มี Reason/Remark แนบ "ทุกชนิด"
  // (Check Return, Issue, Other) ไม่ใช่แค่ is_cheque_return -- ตารางซ้ายและการ์ดขวาใช้ข้อมูลชุดเดียวกัน
  // (/vat_watchlist_detail?bucket=unrealized) และจำกัดเฉพาะ BU ที่ปรากฏในตารางตาม Scope ปัจจุบัน
  const viewBuSet = React.useMemo(() => new Set(expiredDetailByBU.map((r) => r.bu)), [expiredDetailByBU]);
  const reasonCardsScopeBu = (buDetailSelection && buDetailSelection.bu && buDetailSelection.bucket === "unrealized")
    ? buDetailSelection.bu
    : (buFilter || (viewBuSet.size === 1 ? Array.from(viewBuSet)[0] : null));
  const reasonCardsScopeBase = !reasonCardsScopeBu && baseFilter ? baseFilter : null;
  const unrealizedReasonBuckets = React.useMemo(() => {
    const buckets = { check_return: { rows: [], total: 0 }, issue: { rows: [], total: 0 }, other: { rows: [], total: 0 } };
    const source = reasonCardsScopeBu
      ? unrealizedReasonState.rows.filter((r) => r.bu === reasonCardsScopeBu)
      : unrealizedReasonState.rows.filter((r) => viewBuSet.has(r.bu));
    source.forEach((r) => {
      const note = reasonNoteColOf(r);
      const amt = Number(r[vatField]) || 0;
      const card = UNREALIZED_REASON_CARDS.find((c) => c.match(note));
      const key = card ? card.key : "other";
      buckets[key].rows.push(r);
      buckets[key].total += amt;
    });
    return buckets;
  }, [unrealizedReasonState.rows, vatField, reasonNoteColOf, reasonCardsScopeBu, viewBuSet]);
  // ตาราง By BU: Unrealized นับจากชุดเดียวกับการ์ด (Reason ใดก็ได้) / Realized = Total Expired - Unrealized
  // ถ้ายังโหลดไม่เสร็จ ใช้ค่าเดิมจาก View ไปก่อน
  const expiredDetailRows = React.useMemo(() => {
    if (unrealizedReasonState.loading || unrealizedReasonState.error) return expiredDetailByBU;
    const un = {};
    unrealizedReasonState.rows.forEach((r) => {
      if (!viewBuSet.has(r.bu)) return;
      un[r.bu] = (un[r.bu] || 0) + (Number(r[vatField]) || 0);
    });
    return expiredDetailByBU
      .map((row) => {
        const unrealized = Math.min(un[row.bu] || 0, row.total);
        return { bu: row.bu, realized: row.total - unrealized, unrealized, total: row.total };
      })
      .sort((a, b) => b.unrealized - a.unrealized || b.total - a.total);
  }, [expiredDetailByBU, unrealizedReasonState, viewBuSet, vatField]);
  const selectReasonDetail = React.useCallback((reasonKey, reasonLabel) => {
    const bucket = unrealizedReasonBuckets[reasonKey] || { rows: [] };
    setBuDetailSelection((prev) => ({
      reason: reasonKey, reasonLabel,
      // คง bu ที่ Scope อยู่ไว้ ถ้ากด Card ตอนที่ Card กำลังโชว์เฉพาะ BU ใดอยู่ เพื่อให้ Title บอกบริบทถูก
      scopedBu: prev && prev.bu && prev.bucket === "unrealized" ? prev.bu : null,
    }));
    setBuDetailState({ loading: false, error: null, rows: bucket.rows });
  }, [unrealizedReasonBuckets]);
  const [popupSearch, setPopupSearch] = React.useState("");
  const [popupBase, setPopupBase] = React.useState(null); // null = All Base (เฉพาะใน Popup เอง แยกจาก baseFilter หลัก)
  // MARKER_POPUP_DONUT_PREV_CURRENT_TOGGLE_V1 — สลับ Donut Preview ระหว่าง Current/Previous
  const [popupDonutView, setPopupDonutView] = React.useState("current");
  React.useEffect(() => { setPopupDonutView("current"); }, [buFilter]); // MARKER_POPUP_DONUT_PREV_CURRENT_TOGGLE_V1

  // MARKER_DONUT_CUSTOM_TOOLTIP_V1 — Custom Tooltip ลอยตามเมาส์ แทน <title> ของ Browser (ของเดิม
  // เป็นกล่องดำเรียบๆ ไม่มีสไตล์ ไม่สวย) ใช้ร่วมกันทั้ง Donut หลัก (Zone B) และ Donut ใน Popup
  // Preview เก็บแค่ State เดียวพอ เพราะ Hover ได้ทีละวงอยู่แล้ว
  const [donutTooltip, setDonutTooltip] = React.useState(null); // { key, amount, pct, x, y } | null
  const showDonutTooltip = (c, e) => setDonutTooltip({ key: c.key, amount: c.amount, pct: c.pct, x: e.clientX, y: e.clientY });
  const hideDonutTooltip = () => setDonutTooltip(null);
  const openAllBuPopup = () => {
    setPopupSearch("");
    setPopupBase(baseFilter);
    setShowAllBuPopup(true);
  };
  React.useEffect(() => {
    if (!showAllBuPopup) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setShowAllBuPopup(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showAllBuPopup]);

  // MARKER_ZONEA_ESC_UNFILTER_BU_V1 — กด ESC แล้ว Auto Unfilter BU ที่เลือกอยู่ (buFilter) ทันที
  // ตามที่ขอ — ไม่ทำงานตอน Popup "ดูทั้งหมด BU" เปิดอยู่ (ให้ ESC ปิด Popup ก่อนตาม Effect ด้านบน
  // กด ESC อีกทีถึงจะเคลียร์ BU Filter ของหน้าหลัก กันไม่ให้ ESC ครั้งเดียวทำ 2 อย่างพร้อมกัน)
  React.useEffect(() => {
    if (!buFilter || showAllBuPopup) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setBuFilter(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [buFilter, showAllBuPopup]);

  // ทุก BU (ไม่ผูก buFilter ของหน้าหลัก) กรองด้วย vatScope เดียวกับปุ่ม All/Paid/Aging เท่านั้น —
  // ส่วน Base/Search ค่อยกรองซ้ำตอน Render ด้วย popupBase/popupSearch (State ของ Popup เอง)
  const popupAllBuOverview = React.useMemo(() => {
    const map = {};
    rows.forEach((r) => {
      const bu = r.bu;
      if (!bu) return;
      if (!inVatScope(r, vatScope)) return;
      const isUnpaid = isUnpaidRow(r);
      if (!map[bu]) map[bu] = { bu, zero: 0, low: 0, medium: 0, high: 0, expired: 0, unpaid: 0, total: 0 };
      const amt = Number(r[vatField]) || 0;
      const bucket = isUnpaid ? "unpaid" : agingBucketOf(r);
      map[bu][bucket] += amt;
      map[bu].total += amt;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [rows, vatScope, vatField]);

  const popupRowsVisible = React.useMemo(() => {
    const q = popupSearch.trim().toLowerCase();
    return popupAllBuOverview.filter((r) => {
      if (popupBase && buToBase[r.bu] !== popupBase) return false;
      if (q && !r.bu.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [popupAllBuOverview, popupBase, popupSearch, buToBase]);
  const popupMax = popupRowsVisible.length ? Math.max(...popupRowsVisible.map((r) => r.total), 1) : 1;

  // MARKER_ZONEF_ROW_TOOLTIP_V1 — Hover ที่ยอดรวมท้ายแถว Zone F แล้วขึ้น Tooltip แยกราย Bucket
  // (เหมือนแบบใน VatController) ลอยขึ้น "สูงขวา" ของ Mouse แทนที่ Native title เดิม
  const [zoneFTooltip, setZoneFTooltip] = React.useState(null); // { row, x, y }
  const showZoneFTooltip = (row, e) => setZoneFTooltip({ row, x: e.clientX, y: e.clientY });
  const moveZoneFTooltip = (e) => setZoneFTooltip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t));
  const hideZoneFTooltip = () => setZoneFTooltip(null);

  // ── Donut Zone B: คำนวณ arc แต่ละประเภทจาก % สะสม ─────────────────────────
  const DONUT_R = 70;
  const DONUT_CIRC = 2 * Math.PI * DONUT_R;
  let donutCumulative = 0;

  // MARKER_SINGLEBU_LINECHART_SHARED_NODE_V1 — ดึง JSX กราฟเส้น Single BU ออกมาเป็นตัวแปรก่อน
  // return (ไม่ใช่เขียนซ้ำ) เพื่อให้ใช้ร่วมกันได้ทั้งใน Zone F ปกติ และใน Popup "ดูทั้งหมด BU"
  // (MARKER_ZONEF_ALLBU_POPUP_PREVIEW_V1 — คลิกแถวใน Popup แล้วไม่ต้องปิด Popup ออกมาดูข้างนอก
  // ให้โชว์ Preview Graph ในนั้นเลย)
  // MARKER_SINGLEBU_LEGEND_TOGGLE_V1 — Popup มี Legend ของตัวเองอยู่แล้วที่ Header (zoneFBucketOrder)
  // เลยไม่ต้องโชว์ Legend ซ้ำอีกรอบในกราฟ Preview ข้างใน ส่วน Zone F ปกติไม่มี Legend ตรงไหนมาก่อน
  // เลยยังโชว์ไว้เหมือนเดิม — ทำเป็นฟังก์ชันรับ showLegend แทน Const ตัวเดียว เพื่อสั่งแยกได้ 2 จุดใช้งาน
  const makeSingleBuLineChartNode = (showLegend, showCompare) => (buFilter && singleBuMonthlyPoints && singleBuChartGeom) ? (
    /* MARKER_SINGLEBU_LINECHART_V1 — เลือก BU เดียวแล้ว: แสดงกราฟเส้น Green Flag/Red
       Flag/Expired (+ Unpaid) แทน Bar List ปกติด้านล่าง ตามแบบ VatController "VAT
       Watchlist Ops" แต่เพิ่มจุด Unpaid นำหน้า (9 จุดรวม: Unpaid,0,1,2,3,4,5,6,Expired) */
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: "10px", color: "#999", marginBottom: "6px", flexShrink: 0 }}>
        BU {buFilter} · แยกตาม Aging (รวม {formatCompact(singleBuMonthlyPoints.total)})
      </div>
      <div style={{ flex: 1, minHeight: "130px", maxHeight: "220px", display: "flex", gap: "4px" }}>
        {/* MARKER_SINGLEBU_YAXIS_LABELS_V1 — Range ของยอดเงินฝั่งซ้าย ตาม Grid Line
            (gridLines คำนวณจาก singleBuChartGeom แบบ Nice Step อยู่แล้ว) เรียงจากมาก
            (บนสุด) ไปน้อย (ล่างสุด=0) ให้ตรงกับตำแหน่งเส้น Grid แนวนอนในกราฟ */}
        <div style={{ display: "flex", flexDirection: "column-reverse", justifyContent: "space-between", fontSize: "8px", color: "#999", flexShrink: 0, textAlign: "right", paddingBottom: "1px" }}>
          {singleBuChartGeom.gridLines.map((v) => (
            <span key={v}>{formatCompact(v)}</span>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
        {/* MARKER_SINGLEBU_TYPE_TOOLTIP_V1 -- Tooltip ตอนชี้จุด: ยอดของ Aging นั้นประกอบด้วย Type อะไรเท่าไหร่ (รวมกัน = ยอดจุดนั้น) */}
        {sbHover && sbHover.inst === showCompare && (() => {
          const c = singleBuChartGeom.coords.find((q) => q.key === sbHover.key);
          if (!c || !c.value) return null;
          const entries = PAYMENT_STATUS_TYPES
            .map((t) => [t, (c.byType && c.byType[t]) || 0])
            .filter(([, v]) => Math.abs(v) > 0.004)
            .sort((a, b) => b[1] - a[1]);
          const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
          const tipLeft = wfPos.x + 16 + 260 > vw ? Math.max(8, wfPos.x - 260 - 16) : wfPos.x + 16;
          const title = /^\d+$/.test(String(c.label)) ? `Aging ${c.label}` : c.label;
          return (
            <div style={{ position: "fixed", left: tipLeft, top: Math.max(8, wfPos.y - 60), zIndex: 9999, pointerEvents: "none", background: "white", border: "1px solid #dde3e8", borderRadius: "8px", boxShadow: "0 4px 14px rgba(0,0,0,0.15)", padding: "8px 10px", minWidth: "170px", fontSize: "11px", color: "#333" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", fontWeight: 700, borderBottom: "1px solid #eee", paddingBottom: "4px", marginBottom: "4px" }}>
                <span>BU {buFilter} · {title}</span>
                <span>{formatFull(c.value)}</span>
              </div>
              {entries.map(([t, v]) => (
                <div key={t} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "1px 0" }}>
                  <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: CATEGORY_COLORS[t] || "#999", display: "inline-block" }} />
                  <span style={{ flex: 1 }}>{t}</span>
                  <span style={{ fontWeight: 600 }}>{formatFull(v)}</span>
                  <span style={{ color: "#999", width: "42px", textAlign: "right" }}>{c.value ? ((v / c.value) * 100).toFixed(1) : "0.0"}%</span>
                </div>
              ))}
            </div>
          );
        })()}
        <svg width="100%" height="100%" viewBox={`0 0 ${SINGLEBU_CHART_W} ${SINGLEBU_CHART_H}`} preserveAspectRatio="none" style={{ display: "block", overflow: "visible" }}>
          {/* โซนพื้นหลัง: Unpaid / Green Flag (0-4) / Red Flag (5-6) / Expired */}
          <rect x={0} y={0} width={singleBuChartGeom.unpaidEnd} height={SINGLEBU_CHART_H} fill={UNPAID_BUCKET_COLOR} opacity={0.08} />
          <rect x={singleBuChartGeom.unpaidEnd} y={0} width={singleBuChartGeom.greenEnd - singleBuChartGeom.unpaidEnd} height={SINGLEBU_CHART_H} fill="#22C55E" opacity={0.08} />
          <rect x={singleBuChartGeom.greenEnd} y={0} width={singleBuChartGeom.redEnd - singleBuChartGeom.greenEnd} height={SINGLEBU_CHART_H} fill="#EF4444" opacity={0.07} />
          <rect x={singleBuChartGeom.redEnd} y={0} width={SINGLEBU_CHART_W - singleBuChartGeom.redEnd} height={SINGLEBU_CHART_H} fill="#9CA3AF" opacity={0.12} />
          {/* เส้น Grid แนวนอน (Nice Step) */}
          {singleBuChartGeom.gridLines.map((v) => {
            const y = SINGLEBU_CHART_H - (v / singleBuChartGeom.ceilMax) * SINGLEBU_CHART_H;
            return <line key={v} x1={0} y1={y} x2={SINGLEBU_CHART_W} y2={y} stroke="#eee" strokeWidth={0.5} />;
          })}
          {/* เส้นคั่นโซน (เส้นประแนวตั้ง) */}
          {[singleBuChartGeom.unpaidEnd, singleBuChartGeom.greenEnd, singleBuChartGeom.redEnd].map((x) => (
            <line key={x} x1={x} y1={0} x2={x} y2={SINGLEBU_CHART_H} stroke="#ccc" strokeWidth={0.4} strokeDasharray="2 2" />
          ))}
          {/* เส้นเชื่อมจุดทั้งหมด — MARKER_SINGLEBU_LINE_THICKER_V1: เพิ่มความหนาเส้น 1.2 -> 1.8 */}
          <path
            d={singleBuChartGeom.coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x},${c.y}`).join(" ")}
            fill="none"
            stroke="#1a3a5c"
            strokeWidth={1.8}
          />
          {/* จุดแต่ละ Bucket — ค่า 0 แสดง Badge "Clear" แทนจุดทึบ (เหมือนต้นแบบ)
              MARKER_SINGLEBU_POINT_HOVER_ONLY_V1 — กลับมาเป็น Hover-only ตามที่ขอ (เอา
              Label ถาวรที่ติดจุดออก เพราะชนกับ % Legend ของ Zone B/ขอบกราฟ) แต่ตอน
              Hover ให้ขึ้นยอดละเอียดแบบเต็ม (formatFull มี Comma ไม่ย่อ M/K) ผ่าน
              <title> ซึ่งเป็น Tooltip มาตรฐานของเบราว์เซอร์ */}
          {singleBuChartGeom.coords.map((c) =>
            c.value === 0 ? (
              <g key={c.key}>
                <circle cx={c.x} cy={c.y} r={2} fill="white" stroke="#ccc" strokeWidth={0.8} />
                <rect x={c.x - 9} y={c.y - 11} width={18} height={8} rx={4} fill="white" stroke="#ddd" strokeWidth={0.5} />
                <text x={c.x} y={c.y - 4.6} textAnchor="middle" fontSize={5} fill="#999">
                  Clear
                </text>
                <title>{`${c.label}: 0`}</title>
              </g>
            ) : (
              <g key={c.key} onMouseEnter={(e) => { setWfPos({ x: e.clientX, y: e.clientY }); setSbHover({ inst: showCompare, key: c.key }); }} onMouseMove={(e) => setWfPos({ x: e.clientX, y: e.clientY })} onMouseLeave={() => setSbHover(null)} style={{ cursor: "default" }}>
                <circle cx={c.x} cy={c.y} r={7} fill="transparent" />
                <circle cx={c.x} cy={c.y} r={2.8} fill={c.color} stroke="white" strokeWidth={0.8} />
              </g>
            )
          )}
        </svg>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "9px", color: "#999", marginTop: "4px", flexShrink: 0, marginLeft: "28px" }}>
        {singleBuMonthlyPoints.points.map((p) => (
          <span key={p.key}>{p.label}</span>
        ))}
      </div>
      {/* MARKER_SINGLEBU_LEGEND_SYNC_V1 — โชว์เฉพาะ Legend ของกลุ่มที่ยังมีจุดเหลืออยู่
          จริงตาม singleBuPointOrder (เช่น Scope "Aging" จะไม่มี Unpaid ให้โชว์)
          MARKER_SINGLEBU_LEGEND_TOGGLE_V1 — ซ่อนได้ด้วย showLegend (Popup ไม่ต้องโชว์ซ้ำ) */}
      {showLegend && (
        <div style={{ display: "flex", gap: "8px", fontSize: "9px", color: "#555", flexWrap: "wrap", marginTop: "6px", flexShrink: 0 }}>
          {[
            ["Unpaid", UNPAID_BUCKET_COLOR, "unpaid"],
            ["0 (No Risk)", AGING_BUCKET_COLORS.zero, "__zero"],
            ["1-4 (Green Flag)", AGING_BUCKET_COLORS.low, "green"],
            ["5-6 (Red Flag)", AGING_BUCKET_COLORS.high, "red"],
            ["Expired", AGING_BUCKET_COLORS.expired, "expired"],
          ]
            .filter(([, , g]) => (g === "__zero" ? singleBuPointOrder.includes("0") : singleBuPointOrder.some((k) => SINGLEBU_GROUP_OF[k] === g)))
            .map(([label, color]) => (
            <span key={label} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: color, display: "inline-block" }} />
              {label}
            </span>
          ))}
        </div>
      )}
      {/* MARKER_SINGLEBU_PREV_COMPARE_V1 — แถวเทียบ Last Period (ลูกศรขึ้น/ลง + %) และตารางสรุป
          MARKER_SINGLEBU_COMPARE_POPUP_ONLY_V1 — โชว์เฉพาะใน Popup เท่านั้น (showCompare=true)
          ส่วน Zone F ปกติไม่ต้องมี (showCompare=false) ตามที่ขอ */}
      {showCompare && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", marginTop: "8px", paddingTop: "8px", borderTop: "1px solid #f0f0f0", flexShrink: 0 }}>
            <span style={{ color: "#999" }}>เทียบ Last Period:</span>
            {singleBuPrevCompare ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", fontWeight: 700, color: singleBuPrevCompare.pct >= 0 ? "#dc2626" : "#16a34a" }}>
                <span style={{ fontSize: "12px" }}>{singleBuPrevCompare.pct >= 0 ? "▲" : "▼"}</span>
                {Math.abs(singleBuPrevCompare.pct).toFixed(1)}%
                <span style={{ color: "#999", fontWeight: 400 }}>
                  (เดือนก่อน {formatCompact(singleBuPrevCompare.prevTotal)})
                </span>
              </span>
            ) : (
              <span style={{ color: "#bbb" }}>— ยังไม่มีข้อมูลเทียบ</span>
            )}
          </div>
          {/* MARKER_SINGLEBU_BREAKDOWN_TABLE_V1 — ระหว่างยังไม่มีข้อมูล Previous Period ให้เติมพื้นที่
              ว่างด้านล่างด้วยตารางสรุปยอดแยกตาม Aging (ข้อมูลเดียวกับกราฟเส้นด้านบน) แทนปล่อยว่างไว้เฉยๆ
              MARKER_SINGLEBU_TABLE_PREV_CURRENT_V1 — มีคอลัมน์ Previous/Current/% เปลี่ยนแปลงไว้รอ
              Backend เลย ตอนนี้ยังไม่มีข้อมูล Previous รายแถว (singleBuPrevByBucket เป็น null) คอลัมน์
              Previous กับ % เปลี่ยนแปลง เลยโชว์ "–" ไปก่อน พอมีข้อมูลจริงจะคำนวณให้เองอัตโนมัติ */}
          {!singleBuPrevCompare && (
            <div className="table-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", marginTop: "10px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
                <thead>
                  {/* MARKER_SINGLEBU_TABLE_STICKY_HEAD_V1 — หัวตาราง Sticky ไม่ให้เลื่อนหายไปตอน Scroll
                      Body (Container ห่อตารางเป็น overflowY:auto) — Sticky ต้องกำหนดที่ th เอง
                      ไม่ใช่ tr เพราะ tr เป็น display:table-row ใช้ sticky ไม่ได้ผลข้าม Browser */}
                  <tr>
                    <th style={{ position: "sticky", top: 0, zIndex: 1, padding: "6px", fontWeight: 700, color: "#0f7a6b", textAlign: "left", background: "#eaf5f3", borderRadius: "6px 0 0 6px" }}>Aging</th>
                    <th style={{ position: "sticky", top: 0, zIndex: 1, padding: "6px", fontWeight: 700, color: "#0f7a6b", textAlign: "right", background: "#eaf5f3" }}>Previous</th>
                    <th style={{ position: "sticky", top: 0, zIndex: 1, padding: "6px", fontWeight: 700, color: "#0f7a6b", textAlign: "right", background: "#eaf5f3" }}>Current</th>
                    <th style={{ position: "sticky", top: 0, zIndex: 1, padding: "6px", fontWeight: 700, color: "#0f7a6b", textAlign: "right", background: "#eaf5f3", borderRadius: "0 6px 6px 0" }}>% เปลี่ยนแปลง</th>
                  </tr>
                </thead>
                <tbody>
                  {singleBuMonthlyPoints.points.map((p) => {
                    const prevVal = singleBuPrevByBucket && singleBuPrevByBucket[p.key] != null ? singleBuPrevByBucket[p.key] : null;
                    const rowPct = prevVal != null && prevVal > 0 ? ((p.value - prevVal) / prevVal) * 100 : null;
                    return (
                      <tr key={p.key} style={{ borderBottom: "1px solid #f5f5f5" }}>
                        <td style={{ padding: "5px 6px" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: p.color, display: "inline-block", flexShrink: 0 }} />
                            {p.label}
                          </span>
                        </td>
                        <td style={{ padding: "5px 6px", textAlign: "right", color: prevVal != null ? "#555" : "#ccc" }}>
                          {prevVal != null ? formatFull(prevVal) : "–"}
                        </td>
                        <td style={{ padding: "5px 6px", textAlign: "right", fontWeight: 700, color: "#1a3a5c" }}>{formatFull(p.value)}</td>
                        <td style={{ padding: "5px 6px", textAlign: "right", fontWeight: rowPct != null ? 700 : 400, color: rowPct == null ? "#ccc" : rowPct >= 0 ? "#dc2626" : "#16a34a" }}>
                          {rowPct != null ? `${rowPct >= 0 ? "▲" : "▼"} ${Math.abs(rowPct).toFixed(1)}%` : "–"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td style={{ padding: "6px", fontWeight: 700, color: "#1a3a5c", borderTop: "1px solid #eee" }}>รวม</td>
                    <td style={{ padding: "6px", textAlign: "right", color: "#ccc", borderTop: "1px solid #eee" }}>–</td>
                    <td style={{ padding: "6px", textAlign: "right", fontWeight: 700, color: "#1a3a5c", borderTop: "1px solid #eee" }}>{formatFull(singleBuMonthlyPoints.total)}</td>
                    <td style={{ padding: "6px", textAlign: "right", color: "#ccc", borderTop: "1px solid #eee" }}>–</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  ) : null;

  const singleBuLineChartNode = makeSingleBuLineChartNode(true, false);

  // MARKER_ZONEF_ALLBU_POPUP_PREVIEW_DONUT_V1 — Donut เล็กๆ สำหรับ Preview ใน Popup (ใช้
  // categoryBreakdown ตัวเดียวกับ Zone B เพราะ categoryBreakdown คำนวณจาก displayRows ที่กรองตาม
  // buFilter อยู่แล้ว พอคลิกแถวใน Popup แล้ว setBuFilter มันจะอัปเดตให้เองอัตโนมัติ)
  // MARKER_POPUP_DONUT_PREV_CURRENT_TOGGLE_V1 — แทนที่จะวาด 2 วง Previous/Current ข้างกัน ใช้วงเดียว
  // แล้วคลิกสลับได้แทน (popupDonutView: "current" | "previous") ตามที่ขอ — prevCategoryBreakdown
  // คำนวณจาก categoryPrevByType ซึ่งตอนนี้ยังเป็น null เลย View "Previous" จะโชว่ Placeholder
  // "ยังไม่มีข้อมูลเทียบ" แทน Donut ไปก่อน พอมีข้อมูลจริงจะวาดวง Previous ให้เองอัตโนมัติ
  const prevCategoryBreakdown = React.useMemo(() => {
    if (!categoryPrevByType) return null;
    const list = categoryBreakdown.list.map((c) => ({ key: c.key, amount: categoryPrevByType[c.key] || 0 }));
    const total = list.reduce((a, b) => a + b.amount, 0);
    return { total, list: list.map((c) => ({ ...c, pct: total > 0 ? (c.amount / total) * 100 : 0 })) };
  }, [categoryPrevByType, categoryBreakdown]);

  const makePopupPreviewDonutNode = (view) => {
    const bd = view === "previous" ? prevCategoryBreakdown : categoryBreakdown;
    if (!buFilter || !bd || bd.total <= 0) return null;
    let cumulative = 0;
    return (
      <svg width="210" height="210" viewBox="0 0 180 180" style={{ overflow: "visible", flexShrink: 0 }}>
        {bd.list.map((c) => {
          const dash = (c.pct / 100) * DONUT_CIRC;
          const el = (
            <circle
              key={c.key}
              cx="90"
              cy="90"
              r={DONUT_R}
              fill="none"
              stroke={breakdownColorOf(c.key)}
              strokeWidth="26"
              strokeDasharray={`${dash} ${DONUT_CIRC - dash}`}
              strokeDashoffset={-cumulative}
              transform="rotate(-90 90 90)"
              onMouseEnter={(e) => showDonutTooltip(c, e)}
              onMouseMove={(e) => showDonutTooltip(c, e)}
              onMouseLeave={hideDonutTooltip}
              style={{ cursor: "pointer" }}
            />
          );
          cumulative += dash;
          return el;
        })}
        <text x="90" y="86" textAnchor="middle" fontSize="24" fontWeight="700" fill="#1a3a5c">
          {formatCompact(bd.total)}
        </text>
        <text x="90" y="106" textAnchor="middle" fontSize="11" fill="#999">
          ยอด VAT คงค้าง {view === "previous" ? "(เดือนก่อน)" : ""}
        </text>
      </svg>
    );
  };

  return (
    // MARKER_SPLIT_PANE_V2 — เปลี่ยนจาก position:"sticky" (ที่ต้องพึ่ง Scroll ของทั้งหน้าแล้วหลอก
    // ให้ Header ค้างด้วย Sticky) มาเป็น Split-Pane ตรงๆ ตามที่ขอ: Header+Zone A/B/F เป็นส่วนปกติ
    // ของหน้า (ไม่ลอย ไม่ใช้ sticky/zIndex อะไรเลย) ความสูง Fix 40vh ส่วน Zone C/D/E แยกเป็นกรอบ
    // Scroll ของตัวเองต่างหาก (flex:1) เริ่มต้นพอดีที่ขอบล่างของส่วน 40% — Root Container เลยไม่ต้อง
    // Scroll เองอีกต่อไป (overflow:"hidden") เพราะแบ่งให้ลูกแต่ละก้อนจัดการ Scroll ของตัวเอง
    <div ref={dashRootRef} style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", padding: "16px", gap: "14px", overflow: "hidden", boxSizing: "border-box", background: isBrowserFull ? "#f3f4f6" : undefined }}>
      {/* ── ส่วนบน 40%: Header + Zone A + Zone B + Zone F เป็น "ส่วนนึงของ Page" ปกติ ไม่ลอย ──── */}
      <div style={{ flexShrink: 0 }}>
        {/* MARKER_STICKY_FIXED_HEIGHT_40VH_V1 — Fix ความสูงส่วนนี้ (Header+Zone A/B/F) ไว้ที่ 40vh
            ตายตัวเสมอ ไม่ว่าจะกด Filter (Base/BU) แบบไหนก็ตาม
            MARKER_LAYOUT_BUG_FIX_V1 — บั๊กที่เจอ: Card นี้เดิมไม่ใช่ Flex Container เลย ตอนกด
            "ทั้งหมด" (BU เยอะ 73 ตัว) เนื้อหา Zone A เลยโตเกิน Row แบบไม่มีเพดาน (Grid "auto" row
            sizing ยึดตาม max-content ของ Cell ที่สูงสุดเสมอ ไม่สน flex:1 ข้างในที่ตั้งไว้) ทำให้ทั้ง
            การ์ดสูงเกิน 40vh แล้ว Scroll ทั้งการ์ดแทน (Zone B/F เลยโดนบีบ/ตัดขาดไปด้วย) แก้โดยทำให้
            Card นี้เป็น Flex Column จริง: Header/เส้นคั่น = flexShrink:0, ส่วน Row 3 Block = flex:1 +
            minHeight:0 กำหนดเพดานความสูงให้ Row ชัดเจน แล้ว Zone A จะ Scroll แค่ภายในตัวเองได้จริง */}
        <div style={{ ...outerCardStyle, height: "40vh", display: "flex", flexDirection: "column" }}>
          {/* Header — MARKER_HEADER_ONE_ROW_V1: รวม Live/Period/อัปเดตล่าสุด/Refresh ที่เคยแยกเป็น
              แถวล่างมีเส้นคั่นของตัวเอง เข้ามาอยู่ในแถวเดียวกับ Title/วันที่ ตามที่ขอ (ลากลูกศรย้าย
              ขึ้นมา) ประหยัดพื้นที่แนวตั้งของ Header ลงไปทั้งแถว (~27px) ไปให้ Zone B/F ด้านล่าง
              แทน (Row 3 Block เป็น flex:1 อยู่แล้ว พอ Header เตี้ยลง มันกว้างขึ้นเองอัตโนมัติ) */}
          <div style={{ display: "flex", flexShrink: 0 }}>
            <div style={{ width: "4px", background: "linear-gradient(180deg, #1a3a5c, #0f7a6b)" }} />
            <div style={{ flex: 1, padding: "10px 18px", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.5px", color: "#0f7a6b", textTransform: "uppercase" }}>
                  VAT Controller
                </div>
                <div style={{ fontSize: "20px", fontWeight: 700, color: "#1a3a5c", marginTop: "2px" }}>
                  VAT <span style={{ color: "#0f7a6b" }}>Watchlist</span> Dashboard
                </div>
                <div style={{ fontSize: "12px", color: "#999", marginTop: "2px", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  {/* MARKER_VATDASHBOARD_HEADER_SUBTITLE_REMOVE_V1 -- ตัด "ภาพรวม VAT Incomplete แบบ Real-time" ออก,
                      ย้าย Refresh มาเป็น Icon หน้าคำว่า Live แทนปุ่มแยกที่มุมขวาเดิม */}
                  <span style={{ fontSize: "11px", display: "flex", alignItems: "center", gap: "5px" }}>
                    <button
                      type="button"
                      onClick={refetch}
                      title="Refresh"
                      aria-label="Refresh"
                      style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "16px", height: "16px", padding: 0, border: "none", background: "transparent", color: "#888", cursor: "pointer", fontSize: "11px", lineHeight: 1 }}
                    >
                      🔄
                    </button>
                    <span style={{ color: loading || isStale ? "#d9a441" : "#2e9e5b" }}>●</span>
                    {loading ? "กำลังโหลด..." : isStale
                      ? <span style={{ color: "#b7791f", fontWeight: 600 }} title={`ปิด Period แล้ว ยังไม่มี Incomplete เดือน ${periodMonth} เข้ามา — ตัวเลขที่เห็นคือข้อมูลเดือน ${dataMonth}`}>รอข้อมูลใหม่</span>
                      : "Live"}
                    {isStale
                      ? <> &nbsp;|&nbsp; <span style={{ color: "#b7791f" }}>ข้อมูลเดือน {dataMonth} (รอไฟล์ {periodMonth})</span></>
                      : (periodMonth && <> &nbsp;|&nbsp; Period: {periodMonth}</>)}
                    &nbsp;|&nbsp; อัปเดตล่าสุด: {formatThaiTime(now)}
                  </span>
                </div>
              </div>
              <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "5px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={toggleBrowserFull}
                    title={isBrowserFull ? "ออกจากเต็มจอ (Esc หรือ Insert)" : "เต็มจอ (Insert) — ซ่อนเมนู/แถบเบราว์เซอร์"}
                    aria-label={isBrowserFull ? "ออกจากเต็มจอ" : "เต็มจอ"}
                    style={{ width: "22px", height: "22px", padding: 0, border: "0.5px solid #d0d5dd", borderRadius: "6px", background: "#f0f0f0", color: "#555", cursor: "pointer", fontSize: "13px", lineHeight: 1 }}
                  >
                    {isBrowserFull ? "🗗" : "⛶"}
                  </button>
                  <div style={{ fontSize: "12px", color: "#555" }}>{formatThaiDate(now)}</div>
                </div>
                {(userName || currentUser?.username) && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "6px" }}>
                    <span style={{ fontSize: "12px", color: "#555" }}>{userName || currentUser?.username}</span>
                    {currentUser?.appRole && (
                      <span style={{ fontSize: "10px", fontWeight: 600, padding: "1px 8px", borderRadius: "10px", background: "#e8f4f1", color: "#0f7a6b" }}>
                        {currentUser.appRole}
                      </span>
                    )}
                  </div>
                )}
                {/* MARKER_VATDASHBOARD_BOOKING_CLAIM_TOGGLE_V1 -- แทนที่ปุ่ม Refresh เดิม: สลับยอดเต็ม (Booking)
                    กับยอดเฉลี่ยตาม Rate (Claim %) ทั่วทั้งหน้า (Zone A/B/F + Summary Overall + Popup) */}
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div
                    title="กรองตามวิธีจ่าย (คลิก = เลือกค่าเดียว / คลิกซ้ำ = ปลด / Ctrl+คลิก = เลือกหลายค่า)"
                    style={{ display: "flex", alignItems: "center", border: "0.5px solid #d0d5dd", borderRadius: "14px", padding: "2px", background: "#f0f0f0" }}
                  >
                    {PAY_FILTER_OPTIONS.map((opt) => {
                      const active = payFilter.includes(opt);
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={(e) => togglePayFilter(opt, e)}
                          style={{ padding: "3px 10px", fontSize: "10px", fontWeight: 600, borderRadius: "12px", border: "none", cursor: "pointer", background: active ? "#0f7a6b" : "transparent", color: active ? "white" : "#777", transition: "background 0.15s, color 0.15s", whiteSpace: "nowrap" }}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                  <div
                    title={valueMode === "claim" ? "ยอดเฉลี่ยตาม Rate (avg_vat)" : "ยอดเต็ม 100% (exp_vat)"}
                    style={{ display: "flex", alignItems: "center", border: "0.5px solid #d0d5dd", borderRadius: "14px", padding: "2px", background: "#f0f0f0" }}
                  >
                    <button
                      type="button"
                      onClick={() => setValueMode("booking")}
                      style={{ padding: "3px 10px", fontSize: "10px", fontWeight: 600, borderRadius: "12px", border: "none", cursor: "pointer", background: valueMode === "booking" ? "#1a3a5c" : "transparent", color: valueMode === "booking" ? "white" : "#777", transition: "background 0.15s, color 0.15s" }}
                    >
                      Booking
                    </button>
                    <button
                      type="button"
                      onClick={() => setValueMode("claim")}
                      style={{ padding: "3px 10px", fontSize: "10px", fontWeight: 600, borderRadius: "12px", border: "none", cursor: "pointer", background: valueMode === "claim" ? "#0f7a6b" : "transparent", color: valueMode === "claim" ? "white" : "#777", transition: "background 0.15s, color 0.15s" }}
                    >
                      Claim %
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* เส้นคั่น Header ออกจาก 3 Block ด้านล่าง (เส้นเดียว ไม่ใช่กล่องแยก) */}
          <div style={{ borderTop: "1px solid #e5e5e5", flexShrink: 0 }} />

          {/* 3 Block: Zone A | Zone B | Zone F — flex:1 + minHeight:0 กำหนดเพดานความสูงให้ Row
              ชัดเจน (= พื้นที่ที่เหลือหลัง Header ภายใน Card สูง 40vh) ไม่ปล่อยให้ Grid "auto" row
              โตตาม max-content ของ Zone A แบบไม่มีเพดานอีก (ดู MARKER_LAYOUT_BUG_FIX_V1 ด้านบน) */}
          {/* MARKER_SUMMARY_OVERALL_TITLE_V1 — เปลี่ยนจาก 3 คอลัมน์ (30/35/35) เป็น 2 คอลัมน์
              (30/70) โดยคอลัมน์ขวารวม Zone B+F ไว้ด้วยกัน มีหัวข้อเดียว "Summary Overall" อยู่
              กึ่งกลางด้านบนของทั้งคู่ (แทนที่ Label แยก "Zone B" / "Zone F" คนละอัน) ตามที่ขอ */}
          <div style={{ display: "grid", gridTemplateColumns: "30fr 70fr", alignItems: "stretch", width: "100%", boxSizing: "border-box", flex: 1, minHeight: 0, overflow: "hidden" }}>
            {/* Block 1 — Zone A */}
            <div style={{ padding: "10px", borderRight: "1px solid #eee", display: "flex", flexDirection: "column", boxSizing: "border-box", minWidth: 0, minHeight: 0 }}>
              {loading && (
                <div style={{ fontSize: "11px", fontWeight: 400, color: "#999", textAlign: "right", marginBottom: "4px" }}>
                  (กำลังโหลด...)
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "6px", paddingBottom: "8px", marginBottom: "8px", borderBottom: "1px dashed #ddd" }}>
                <div style={{ position: "relative" }}>
                  <button onClick={() => handleSetBase(null)} style={baseBtnStyle(!baseFilter)}>
                    ทั้งหมด
                  </button>
                  <span style={cornerBadgeStyle}>{buTabs.length}</span>
                </div>
                {baseTabs.map((b) => (
                  <div key={b} style={{ position: "relative" }}>
                    <button onClick={() => handleSetBase(b)} style={baseBtnStyle(baseFilter === b)}>
                      {b}
                    </button>
                    <span style={cornerBadgeStyle}>{baseCounts[b]}</span>
                  </div>
                ))}
              </div>

              {/* MARKER_ZONEA_FIXED_6_ROWS_V1 — ความสูงปุ่มคำนวณให้ "6 แถวพอดี" เต็มพื้นที่ที่มี
                  (flex:1 กำหนด 100% = พื้นที่ที่ Zone A ได้จริง) ด้วย gridAutoRows: calc((100% -
                  รวม Gap ของ 5 ช่องว่างระหว่าง 6 แถว) / 6) → แต่ละแถว ≈ 16.6% ของพื้นที่ทั้งหมด
                  ลบ Gap ไปก่อน ไม่ใช่ 16.6% ตรงๆ เพราะงั้น ถ้ามีมากกว่า 6 แถว ก็ Scroll ต่อ (บาง
                  ด้วย className="table-scroll" จาก App.css) ไม่ใช่บีบปุ่มให้เล็กลงอีก */}
              <div className="table-scroll" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gridAutoRows: "calc((100% - 30px) / 6)", gap: "6px", overflowY: "auto", flex: 1, minHeight: 0, paddingRight: "4px" }}>
                {/* MARKER_ZONEA_BU_TOGGLE_V1 — กดปุ่ม BU ที่ Active อยู่แล้วซ้ำ ให้กลับเป็น Un-filter
                    (setBuFilter(null)) แทนที่จะค้างเลือกอันเดิมไว้เฉยๆ */}
                {buTabsForStep2Sorted.map((b) => (
                  <button key={b} onClick={() => setBuFilter(buFilter === b ? null : b)} style={gridBtnStyle(buFilter === b)}>
                    {b}
                  </button>
                ))}
              </div>
            </div>

            {/* Block 2+3 — Zone B + Zone F รวมกันใน Column เดียว (70fr) — หัวข้อเดียว "Summary
                Overall" อยู่กึ่งกลางด้านบนของทั้งคู่ MARKER_SUMMARY_OVERALL_TITLE_V1 */}
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, boxSizing: "border-box" }}>
              <div style={{ textAlign: "center", fontSize: "16px", fontWeight: 700, color: "white", background: "#0f7a6b", padding: "8px 10px", flexShrink: 0 }}>
                Summary Overall
              </div>
              <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
                {/* Zone B — MARKER_ZONEB_SPLIT50_V1: แบ่งเป็นซ้าย 50% / ขวา 50%: ซ้าย = Donut
                    (ขยายเต็มพื้นที่ แต่คงสัดส่วนวงกลมด้วย viewBox+preserveAspectRatio ไม่ยืดเป็น
                    วงรี), ขวา = บน 80% Legend, ล่าง 20% ปุ่มหลอด All/Paid/Aging (MARKER_VATSCOPE_V1)
                    MARKER_ZONEBF_WIDTH_REBALANCE_V1: ลดความกว้างรวมของ Zone B (flex:1 -> flex:0.8)
                    แล้วยกส่วนต่างให้ Zone F (bar chart รายชื่อ BU) แทน ไม่ใช่ขยาย Donut */}
                <div className="table-scroll" style={{ padding: "10px", borderRight: "1px solid #eee", display: "flex", flexDirection: "column", boxSizing: "border-box", minWidth: 0, minHeight: 0, overflowY: "auto", flex: 0.8 }}>
              <div style={{ flex: 1, minHeight: 0, display: "flex", gap: "10px" }}>
                {/* ซ้าย 50%: Donut — MARKER_DONUT_OVERFLOW_FIX_V1: เดิมใช้ width/height:"100%" บน
                    svg แล้วพึ่ง % resolve ตาม Flex Row ที่บางครั้งสูงไม่พอ ทำให้ถูก outerCardStyle
                    (overflow:"hidden") ตัดขอบบน/ล่างเป็นเส้นตรง (ไม่ใช่วงรี แต่โดนครอบตัดจริงๆ)
                    แก้โดยใช้ SVG ขนาดคงที่ (ไม่ผูกกับ % ของ Container) + overflow:"visible" ทั้ง
                    ที่ Container และตัว svg เอง เพื่อให้ "ล้น" ออกจากกรอบ 50% ได้ถ้าจำเป็น แทนที่จะ
                    โดนบีบ/ตัด — ขยาย viewBox เป็น 180x180 (จาก 160x160) ให้มี Margin พอให้ Stroke
                    กว้าง 26 ของวงแหวน (r=70 + 13 = 83) ไม่ชนขอบ viewBox เดิม (ครึ่งนึง=80) อีกด้วย */}
                <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "visible" }}>
                  {categoryBreakdown.total === 0 ? (
                    <div style={{ color: "#bbb", fontSize: "12px" }}>ไม่มีข้อมูล</div>
                  ) : (
                    <svg width="190" height="190" viewBox="0 0 180 180" style={{ overflow: "visible", flexShrink: 0 }}>
                      {/* MARKER_DONUT_HOVER_TOOLTIP_V1 — เดิม Hover แล้วขึ้นแค่ Tooltip ดำๆ ของ Browser
                          (<title>) ไม่สวย เปลี่ยนเป็น Custom Tooltip ลอยตามเมาส์แทน (ดู
                          MARKER_DONUT_CUSTOM_TOOLTIP_V1) บอกชื่อ Type + ยอดเต็ม (formatFull) + % */}
                      {categoryBreakdown.list.map((c) => {
                        const dash = (c.pct / 100) * DONUT_CIRC;
                        const el = (
                          <circle
                            key={c.key}
                            cx="90"
                            cy="90"
                            r={DONUT_R}
                            fill="none"
                            stroke={breakdownColorOf(c.key)}
                            strokeWidth="26"
                            strokeDasharray={`${dash} ${DONUT_CIRC - dash}`}
                            strokeDashoffset={-donutCumulative}
                            transform="rotate(-90 90 90)"
                            onMouseEnter={(e) => showDonutTooltip(c, e)}
                            onMouseMove={(e) => showDonutTooltip(c, e)}
                            onMouseLeave={hideDonutTooltip}
                            style={{ cursor: "pointer" }}
                          />
                        );
                        donutCumulative += dash;
                        return el;
                      })}
                      <text x="90" y="86" textAnchor="middle" fontSize="19" fontWeight="700" fill="#1a3a5c">
                        {formatCompact(categoryBreakdown.total)}
                      </text>
                      <text x="90" y="104" textAnchor="middle" fontSize="10" fill="#999">
                        ยอด VAT คงค้าง
                      </text>
                    </svg>
                  )}
                </div>

                {/* MARKER_ZONEB_LEGEND_NARROW_V1: ลดความกว้าง Legend ลง (flex:1 -> flex:0.8, ~28% ของแถว)
                    ให้ Donut (flex:2) ได้พื้นที่มากขึ้นแทน — บน 80% = Label + Legend ชิดซ้าย, ล่าง 20% = ปุ่ม All/Paid/Aging */}
                <div style={{ flex: 0.8, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
                  <div style={{ flex: 4, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "12px" }}>
                      {categoryBreakdown.list.map((c) => (
                        <div key={c.key} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ width: "10px", height: "10px", borderRadius: "2px", background: breakdownColorOf(c.key), display: "inline-block", flexShrink: 0 }} />
                          <span style={{ color: "#333", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {breakdownLabelOf(c.key)}
                          </span>
                          <span style={{ color: "#999", marginLeft: "auto" }}>{c.pct.toFixed(1)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", borderTop: "1px solid #eee", paddingTop: "6px", paddingLeft: "3px", paddingRight: "3px", flexShrink: 0, boxSizing: "border-box" }}>
                    <div style={scopeGroupStyle}>
                      {[["all", "All"], ["paid", "Paid"], ["aging", "Aging"]].map(([val, label], i, arr) => (
                        <button key={val} onClick={() => setVatScope(val)} style={scopeBtnStyle(vatScope === val, i === arr.length - 1)}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
                </div>

                {/* Zone F — MARKER_ZONEBF_WIDTH_REBALANCE_V1: รับส่วนต่างความกว้างจาก Zone B (flex:1 -> flex:1.2) */}
                <div className="table-scroll" style={{ padding: "10px", display: "flex", flexDirection: "column", boxSizing: "border-box", minWidth: 0, minHeight: 0, overflowY: "auto", flex: 1.2 }}>
              {singleBuLineChartNode ? singleBuLineChartNode : buOverview.length === 0 ? (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#bbb", fontSize: "12px" }}>
                  ไม่มีข้อมูลในมุมมองนี้
                </div>
              ) : (
                <>
                  {/* ref={zoneFRowsRef} — วัดความสูงจริงของกรอบนี้เพื่อคำนวณ zoneFRowH ด้านบน
                      flex:1 + minHeight:0 + overflow:hidden: ไม่ปล่อยให้ยืดเกินพื้นที่ที่มี
                      (ค่า gap ต้องตรงกับ ZONEF_ROW_GAP ด้านบนเสมอ ถ้าจะแก้ขนาดแถว) */}
                  <div ref={zoneFRowsRef} style={{ display: "flex", flexDirection: "column", gap: `${ZONEF_ROW_GAP}px`, flex: 1, minHeight: 0, overflow: "hidden", paddingTop: "3px", paddingBottom: "3px", boxSizing: "border-box" }}>
                    {buOverviewVisible.map((row) => (
                      <div key={row.bu} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{ width: "40px", fontSize: "9px", fontWeight: 600, color: "#333", textAlign: "right", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {row.bu}
                        </div>
                        {/* MARKER_ZONEF_BAR_HOVER_TOOLTIP_V1 — Hover ที่ตัวหลอด (ไม่ใช่แค่ยอดรวม
                            ท้ายแถว) ก็ขึ้น Tooltip แบบเดียวกัน (แยก Badge ตาม Aging + ยอดเต็มไม่ย่อ)
                            — เอา title เดิม (Native, โชว์ยอดย่อทีละ Segment) ออก ใช้ Tooltip รวมชุด
                            เดียวกับยอดท้ายแถวแทน */}
                        <div
                          style={{ flex: 1, display: "flex", height: `${zoneFRowH}px`, borderRadius: "3px", overflow: "hidden", background: "#f2f2f2", cursor: "default" }}
                          onMouseEnter={(e) => showZoneFTooltip(row, e)}
                          onMouseMove={moveZoneFTooltip}
                          onMouseLeave={hideZoneFTooltip}
                        >
                          {zoneFBucketOrder.map((grp) =>
                            row[grp] > 0 ? (
                              <div
                                key={grp}
                                style={{ width: `${buMax ? (row[grp] / buMax) * 100 : 0}%`, background: zoneFBucketColors[grp] }}
                              />
                            ) : null
                          )}
                        </div>
                        <div
                          style={{ width: "46px", fontSize: "9px", color: "#555", flexShrink: 0, textAlign: "right", cursor: "default" }}
                          onMouseEnter={(e) => showZoneFTooltip(row, e)}
                          onMouseMove={moveZoneFTooltip}
                          onMouseLeave={hideZoneFTooltip}
                        >
                          {formatCompact(row.total)}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "6px", flexShrink: 0 }}>
                    <div style={{ display: "flex", gap: "8px", fontSize: "9px", color: "#555", flexWrap: "wrap" }}>
                      {zoneFBucketOrder.map((grp) => (
                        <span key={grp} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                          <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: zoneFBucketColors[grp], display: "inline-block" }} />
                          {zoneFBucketLabels[grp]}
                        </span>
                      ))}
                    </div>
                    {/* MARKER_ZONEF_ALLBU_POPUP_V1 — เปลี่ยนจาก Toggle ย่อ/ขยายในที่เดิม เป็นเปิด
                        Popup แสดงทุก BU แทน (แบบ Detail Overview ของ VatController)
                        MARKER_ZONEF_ALLBU_BUTTON_RESTYLE_V1 — เปลี่ยนจากลิงก์ข้อความเปล่าๆ เป็น
                        ปุ่มหลอด (Pill) มีขอบ+พื้นหลังอ่อน ให้ดูเป็นปุ่มจริงๆ ไม่ใช่แค่ตัวหนังสือ */}
                    {buOverview.length > ZONEF_VISIBLE_N && (
                      <button
                        onClick={openAllBuPopup}
                        style={{
                          fontSize: "10px",
                          color: "#0f7a6b",
                          background: "#eaf5f3",
                          border: "1px solid #bfe0da",
                          borderRadius: "999px",
                          cursor: "pointer",
                          fontWeight: 700,
                          padding: "4px 12px",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        {`ดูทั้งหมด (${buOverview.length})`}
                        <span style={{ fontSize: "11px" }}>→</span>
                      </button>
                    )}
                  </div>
                </>
              )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* ── จบส่วน 40% (Header + Zone A + Zone B + Zone F) — ไม่ Sticky แล้ว เป็นส่วนปกติของ Page ── */}

      {/* MARKER_SPLIT_PANE_V2 — กรอบ Scroll ของตัวเอง เริ่มต้นพอดีที่ขอบล่างของส่วน 40% ด้านบน
          flex:1 + minHeight:0 ให้กินพื้นที่ที่เหลือทั้งหมด (60%) แล้ว overflowY:"auto" ภายในกรอบ
          นี้เท่านั้น (Root Container เปลี่ยนเป็น overflow:"hidden" ไปแล้ว ไม่ Scroll เองอีก) ใช้
          className="table-scroll" ต่อให้ธีม Scrollbar บางๆ เหมือน Zone A/B/F สม่ำเสมอกันทั้งหน้า */}
      <div className="table-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "14px" }}>
        {error && (
          <div style={{ fontSize: "12px", color: "#A32D2D", background: "#FBEAEA", padding: "8px 12px", borderRadius: "6px" }}>
            โหลดข้อมูลไม่สำเร็จ — {error.message || "เกิดข้อผิดพลาด"} (เช็คว่า Backend มี Route /vat_summary_live_dashboard หรือยัง)
          </div>
        )}

        {/* MARKER_ZONE_MAIN_SUMMARY_CARDS_V1 — Card สรุปยอด VAT คงค้าง วางไว้บนสุดของ Zone หลัก
            (ส่วน Scroll 60% ใต้ Header 40vh) ตามภาพตัวอย่างที่ส่งมา ("Summary Vat All [Type]") —
            ใบแรกสุด = "Summary Vat All" รวมยอด Overall ทั้งหมด ตามด้วย 5 Card แยกตาม Type
            (CPN/ITC/LAND/UTL/OTH) ใช้ summaryCardsData ที่คำนวณจาก categoryBreakdownOverall (ไม่ผูก
            กับปุ่ม All/Paid/Aging ของ Zone B เลย — การ์ดชุดนี้ตั้งใจให้เป็นภาพรวม "Overall" เสมอ ไม่
            สนสถานะ Payment ตามที่ขอ) — ส่วน Donut/Legend ของ Zone B ยังคง Sync กับ vatScope และโชว์
            "Unpaid" แยกปกติไม่เปลี่ยนแปลง (ดู MARKER_CATEGORY_TRUECATEGORY_BACKEND_TODO_V1 สำหรับ
            Requirement ที่รอ Backend ก่อนจะแยก "Unpaid" ตาม Type จริงได้) */}
        <div style={{ ...outerCardStyle, flexShrink: 0 }}>
        <div style={{ display: "flex" }}>
          {summaryCardsData.map((c, i) => (
            <div
              key={c.key}
              style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", borderLeft: i > 0 ? "1px solid #e5e5e5" : "none" }}
            >
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "4px", fontSize: "12px", fontWeight: 700, color: "#444", background: c.isTotal ? "#e8f4f1" : "#f5f6f8", padding: "7px 6px", borderBottom: "1px solid #e5e5e5" }}>
                <span style={{ textAlign: "center" }}>{c.label}</span>
                {/* MARKER_SUMMARYCARDS_PCT_OF_OVERALL_V1 -- 1 บรรทัดเดียวใต้ Label: การ์ดย่อย = Pill %, การ์ด Overall = หมายเหตุ "รวม Unpaid" */}
                {!c.isTotal && categoryBreakdownOverall.total > 0 ? (
                  <span style={{ fontSize: "10px", fontWeight: 700, padding: "1px 8px", borderRadius: "999px", background: "#e3f3ee", color: "#0f7a6b" }}>
                    {((c.amount / categoryBreakdownOverall.total) * 100).toFixed(1)}%
                  </span>
                ) : c.isTotal ? (
                  <span style={{ fontSize: "9px", fontWeight: 400, color: "#aaa" }}>Unpaid Include by Type</span>
                ) : (
                  <span style={{ fontSize: "10px", fontWeight: 700, padding: "1px 8px", borderRadius: "999px", visibility: "hidden" }}>0.0%</span>
                )}
              </div>
              <div style={{ textAlign: "center", fontSize: "20px", fontWeight: 700, color: c.isTotal ? "#0f7a6b" : "#1a3a5c", padding: "14px 6px" }}>
                {formatFull(c.amount)}
              </div>
            </div>
          ))}
        </div>

        {/* ── Zone C: การ์ดแบ่งตามสถานะการจ่าย — MARKER_ZONEC_PAYMENT_STATUS_V1
            Paid / Unpaid / Expired — แต่ละแถว 6 การ์ด (Overall + CPN/ITC/LAND/UTL/OTH)
            รวมกรอบเดียวกับ Summary Vat cards ด้านบน คั่นด้วยเส้น border-top บางๆ
            MARKER_ZONEC_EXPIRED_DETAIL_POPUP_V1 -- การ์ด "Total Vat Expired All" มีปุ่มเปิด Popup
            แสดง Realized/Unrealized Expired แบบละเอียด แทนการโชว์เป็นแถวเพิ่มในตารางหลัก */}
        {/* MARKER_ZONEC_SECTION_DIVIDER_V1 -- แถบคั่นหัวข้อ ระหว่างการ์ด Summary กับแถว Paid / Unpaid / Expired */}
        <div style={{ borderTop: "1px solid #e5e5e5", background: "#eef6f4", padding: "9px 14px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}> {/* MARKER_ZONEC_DIVIDER_CENTER_V1 -- จัดกลาง + ขยายฟอนต์หัวข้อ */}
          <span style={{ width: "3px", height: "18px", borderRadius: "2px", background: "#0f7a6b", display: "inline-block" }} />
          <span style={{ fontSize: "15px", fontWeight: 700, color: "#0f7a6b", letterSpacing: "0.3px", textAlign: "center" }}>
            Details by Payment Status and Vendor Type
          </span>
        </div>
        {PAYMENT_STATUS_ROWS.map((rowDef) => {
          const { sums, total } = paymentStatusBreakdown[rowDef.key];
          const isExpiredRow = rowDef.key === "expired";
          const expHoverProps = (k) => isExpiredRow ? {
            onMouseEnter: (e) => setExpiredHoverTip({ key: k, x: e.clientX, y: e.clientY }),
            onMouseMove: (e) => setExpiredHoverTip({ key: k, x: e.clientX, y: e.clientY }),
            onMouseLeave: () => setExpiredHoverTip(null),
          } : rowDef.key === "paid" ? {
            onMouseEnter: (e) => setPaidHoverTip({ key: k, x: e.clientX, y: e.clientY }),
            onMouseMove: (e) => setPaidHoverTip({ key: k, x: e.clientX, y: e.clientY }),
            onMouseLeave: () => setPaidHoverTip(null),
          } : {}; // MARKER_ZONEC_EXPIRED_HOVER_RU_V1 / MARKER_ZONEC_PAID_AGING_TOOLTIP_V1
          return (
            <div key={rowDef.key} style={{ borderTop: "1px solid #e5e5e5", display: "flex" }}>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }} {...expHoverProps("ALL")}>
                <div style={{ textAlign: "center", fontSize: "12px", fontWeight: 700, color: rowDef.color, background: "#f5f6f8", padding: "7px 6px", borderBottom: "1px solid #e5e5e5", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "4px" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    {rowDef.label} All
                    {isExpiredRow && (
                      <button
                        onClick={() => setShowExpiredDetailPopup(true)}
                        title="ดูรายละเอียด Realized / Unrealized Expired"
                        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "16px", height: "16px", padding: 0, border: "1px solid #b91c1c", borderRadius: "50%", background: "white", color: "#b91c1c", fontSize: "10px", fontWeight: 700, cursor: "pointer", lineHeight: 1 }}
                      >
                        i
                      </button>
                    )}
                  </span>
                  {/* MARKER_ZONEC_PCT_OF_OVERALL_V1 -- ป้าย % อยู่บรรทัดที่ 2 ใต้ชื่อ (Layout เดียวกับคอลัมน์ Type) ฐาน = Summary Vat Overall */}
                  {categoryBreakdownOverall.total > 0 && (
                    <span style={{ fontSize: "10px", fontWeight: 700, padding: "1px 8px", borderRadius: "999px", background: "#e3f3ee", color: "#0f7a6b" }}>
                      {((total / categoryBreakdownOverall.total) * 100).toFixed(1)}%
                    </span>
                  )}
                </div>
                <div style={{ textAlign: "center", fontSize: "20px", fontWeight: 700, color: rowDef.color, padding: "14px 6px" }}>
                  {formatFull(total)}
                </div>
              </div>
              {PAYMENT_STATUS_TYPES.map((t) => (
                <div key={t} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", borderLeft: "1px solid #e5e5e5" }} {...expHoverProps(t)}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "4px", textAlign: "center", fontSize: "12px", fontWeight: 700, color: "#444", background: "#f5f6f8", padding: "7px 6px", borderBottom: "1px solid #e5e5e5" }}>
                    <span>{rowDef.label} [{t}]</span>
                    {/* MARKER_ZONEC_PCT_OF_OVERALL_V1 */}
                    {/* ฐานของคอลัมน์ Type = ยอด Summary Vat All [Type] (= Paid + Unpaid ของ Type นั้น) ; คอลัมน์ All ใช้ฐาน Summary Vat Overall */}
                  {/* MARKER_ZONEC_PCT_TYPE_OF_OVERALL_V1 -- ฐานของ % ทุกคอลัมน์ Type = Summary Vat Overall (เช่น CPN Paid 14,678,137.38 / 278,020,524.65 = 5.3%) */}
                  {categoryBreakdownOverall.total > 0 && (
                    <span style={{ fontSize: "10px", fontWeight: 700, padding: "1px 8px", borderRadius: "999px", background: "#e3f3ee", color: "#0f7a6b" }}>
                      {(((sums[t] || 0) / categoryBreakdownOverall.total) * 100).toFixed(1)}%
                    </span>
                  )}
                  </div>
                  <div style={{ textAlign: "center", fontSize: "20px", fontWeight: 700, color: "#1a3a5c", padding: "14px 6px" }}>
                    {formatFull(sums[t] || 0)}
                  </div>
                </div>
              ))}
            </div>
          );
        })}

        {/* ── Zone D: Waterfall แยกตาม Aging Risk (High/Medium/Low) + Type — MARKER_ZONED_WATERFALL_V1
            3 แผงตามภาพตัวอย่าง Power BI ที่ส่งมา: High (Aging≥5) / Medium (Aging≥3) / Low (Aging≤2)
            แต่ละแผงแตกเป็นแท่งตาม Type (CPN/ITC/LAND/UTL/OTH) เรียงจากมากไปน้อย ปิดท้ายด้วยแท่ง
            "Total" สีตาม Risk — Sync กับ Booking/Claim % toggle (vatField) แต่ Fix Scope เป็น
            "Aging" เสมอ (ไม่ผูกกับปุ่ม All/Paid/Aging ของ Zone B) —
            MARKER_ZONED_MERGE_SINGLE_FRAME_V1: รวมกรอบเดียวกับ Summary Vat cards ด้านบน (ไม่แยก
            การ์ด/ไม่มีช่องว่างระหว่างกัน) คั่นด้วยเส้น border-top บางๆ แทน */}
        <div style={{ borderTop: "1px solid #e5e5e5" }}>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", padding: "12px 10px" }}>
            {WATERFALL_BUCKET_ORDER.map((bucket) => {
              const { items, total, zero: totalZero, ag: totalAg } = agingRiskWaterfall[bucket];
              const splitZero = bucket === "low" && totalZero > 0; // MARKER_ZONED_WATERFALL_ZERO_SPLIT_V1
              // Tooltip แยกยอดตาม Aging เดือน (แสดงเฉพาะเดือนที่อยู่ในแผงนี้ ; Aging 0 แสดงเฉพาะตอน All/Paid)
              const agMonths = WATERFALL_AGING_MONTHS[bucket].filter((m) => m !== "0" || vatScope !== "aging");
              const agTip = (title, amount, ag, posBottom) => (
                <div
                  style={{
                    /* MARKER_WATERFALL_TOOLTIP_FIXED_V1 -- เดิม absolute ภายในแผง (overflow:hidden) เลยโดนขอบแผงตัดตอนชี้แท่งชิดซ้าย/ขวา
                       เปลี่ยนเป็น fixed ตามเมาส์ + Clamp ไม่ให้หลุดจอ (สลับไปโผล่ซ้ายเมาส์ถ้าชิดขอบขวา) */
                    position: "fixed",
                    left: (() => { const w = typeof window !== "undefined" ? window.innerWidth : 1200; const est = 270; return wfPos.x + 16 + est > w ? Math.max(8, wfPos.x - est - 16) : wfPos.x + 16; })(),
                    top: Math.max(8, wfPos.y - 50),
                    zIndex: 9999, pointerEvents: "none",
                    background: "rgba(30,41,59,0.95)", color: "white", borderRadius: "6px", padding: "6px 9px", fontSize: "10px", lineHeight: 1.5, whiteSpace: "nowrap", boxShadow: "0 3px 10px rgba(0,0,0,0.25)",
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: "2px" }}>{title} · {formatCompact(amount)}</div>
                  {agMonths.map((m) => {
                    const v = (ag && ag[m]) || 0;
                    return (
                      <div key={m} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                        <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: m === "0" ? AGING_BUCKET_COLORS.zero : AGING_BUCKET_COLORS[bucket], display: "inline-block" }} />
                        Aging {m}: {formatFull(v)} ({amount ? ((v / amount) * 100).toFixed(1) : "0.0"}%)
                      </div>
                    );
                  })}
                </div>
              );
              const color = AGING_BUCKET_COLORS[bucket];
              const chartH = 170;
              let cum = 0;
              const bars = items.map((it) => {
                const bottom = cum;
                cum += it.amount;
                return { ...it, bottom };
              });
              return (
                <div key={bucket} style={{ flex: "1 1 320px", minWidth: "280px", border: "1px solid #e5e5e5", borderRadius: "8px", overflow: "hidden" }}>
                  <div style={{ background: "#eef1f4", borderBottom: `2px dotted ${color}`, padding: "8px 10px", fontSize: "12px", fontWeight: 700, color }}>
                    {WATERFALL_BUCKET_LABELS[bucket]}
                    
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: "6px", padding: "28px 10px 6px", minHeight: `${chartH + 50}px` }}>
                    {bars.length === 0 ? (
                      <div style={{ flex: 1, textAlign: "center", fontSize: "11px", color: "#aaa", paddingBottom: "20px" }}>ไม่มีข้อมูล</div>
                    ) : (
                      <>
                        {bars.map((b, bi) => (
                          <div
                            key={b.key}
                            style={{ flex: 1, position: "relative", height: `${chartH}px` }}
                            onMouseEnter={(e) => { setWfPos({ x: e.clientX, y: e.clientY }); setWfHover(`${bucket}|${b.key}`); }}
                            onMouseMove={(e) => setWfPos({ x: e.clientX, y: e.clientY })}
                            onMouseLeave={() => setWfHover(null)}
                          >
                            <span
                              style={{
                                position: "absolute",
                                left: 0,
                                right: 0,
                                textAlign: "center",
                                bottom: `${total ? ((b.bottom + b.amount) / total) * chartH + 4 : 4}px`,
                                fontSize: "10px",
                                fontWeight: 700,
                                color: "#444",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {formatCompact(b.amount)}
                            </span>
                            <div
                              style={{
                                position: "absolute",
                                left: "15%",
                                right: "15%",
                                bottom: `${total ? (b.bottom / total) * chartH : 0}px`,
                                height: `${total ? (b.amount / total) * chartH : 0}px`,
                                background: CATEGORY_COLORS[b.key] || color, /* MARKER_ZONED_WATERFALL_TYPE_COLOR_V1 -- แท่ง Type ใช้สีประจำ Type เหมือน Donut (แท่ง Total ยังเป็นสี Risk) */
                                opacity: 1,
                                borderRadius: "3px 3px 0 0",
                              }}
                            />
                            {wfHover === `${bucket}|${b.key}` && agTip(b.key, b.amount, b.ag, total ? ((b.bottom + b.amount / 2) / total) * chartH : 0)}
                          </div>
                        ))}
                        <div
                          style={{ flex: 1, position: "relative", height: `${chartH}px` }}
                          onMouseEnter={(e) => { setWfPos({ x: e.clientX, y: e.clientY }); setWfHover(`${bucket}|__total`); }}
                          onMouseMove={(e) => setWfPos({ x: e.clientX, y: e.clientY })}
                          onMouseLeave={() => setWfHover(null)}
                        >
                          {wfHover === `${bucket}|__total` && agTip("Total", total, totalAg, chartH / 2)}
                          <span style={{ position: "absolute", left: 0, right: 0, textAlign: "center", bottom: `${chartH + 4}px`, fontSize: "11px", fontWeight: 800, color, whiteSpace: "nowrap" }}>
                            {formatCompact(total)}
                          </span>
                          <div style={{ position: "absolute", left: "15%", right: "15%", bottom: 0, height: `${chartH}px`, background: color, borderRadius: "3px 3px 0 0", overflow: "hidden" }}>
                            {/* MARKER_ZONED_WATERFALL_TOTAL_SPLIT_V2 -- ปุ่ม All/Paid แผง Low: ส่วน Aging 0 (No Risk) เป็นสีฟ้า ที่เหลือ (Aging 1-2) เป็นสีเขียว */}
                            {splitZero && total > 0 && (
                              <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: `${(totalZero / total) * chartH}px`, background: AGING_BUCKET_COLORS.zero }} />
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "6px", padding: "0 10px 10px", fontSize: "10px", color: "#777", fontWeight: 600 }}>
                    {bars.map((b) => (
                      <div key={b.key} style={{ flex: 1, textAlign: "center" }}>{b.key}</div>
                    ))}
                    <div style={{ flex: 1, textAlign: "center", fontWeight: 800, color: "#333" }}>Total</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        </div>

      </div>

      {/* MARKER_ZONEF_ALLBU_POPUP_V1 — Popup "ดูทั้งหมด BU" แบบ Detail Overview ของ VatController:
          Backdrop มืด + การ์ดขาวกึ่งกลางจอ, Header มีช่องค้นหา + ปุ่มปิด, แถว Base Filter ของ Popup
          เอง (แยกจาก Zone A) + MARKER_ZONEF_ALLBU_POPUP_SCOPE_PILL_V1 ปุ่ม All/Paid/Aging Sync กับ
          ตัวหลัก, ตารางแถวละ BU พร้อมหลอดสัดส่วน Bucket + ยอดรวม —
          MARKER_ZONEF_ALLBU_POPUP_PREVIEW_V1 — คลิกแถวแล้วไม่ปิด Popup ออกมาข้างนอก แต่ขยายพื้นที่
          ด้านข้างขึ้นมาแทน (Donut ด้านบน + Preview Graph ด้านล่าง) ความสูง Popup คงที่ 86vh เสมอ
          ไม่ลดตามข้อมูล (height Fix ไม่ใช่ auto) */}
      {showAllBuPopup && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100 }}
          onClick={() => setShowAllBuPopup(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "white",
              borderRadius: "12px",
              width: "95vw",
              maxWidth: buFilter ? "1560px" : "900px",
              height: "86vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 10px 40px rgba(0,0,0,0.3)",
              transition: "max-width 0.15s ease",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "14px", padding: "14px 18px", borderBottom: "1px solid #e8e8e8", flexShrink: 0, background: "#0f7a6b", color: "white" }}>
              <div style={{ fontSize: "15px", fontWeight: 700, flexShrink: 0 }}>
                ทุก BU <span style={{ fontSize: "12px", fontWeight: 400, opacity: 0.85 }}>({popupRowsVisible.length} รายการ)</span>
              </div>

              {/* MARKER_ZONEF_ALLBU_POPUP_SCOPE_PILL_V1 — ปุ่ม All/Paid/Aging เดียวกับ Zone B/F
                  (Sync กับ vatScope ตัวเดียวกันทั้งหน้า ไม่มี State แยก) — ย้ายขึ้นมาไว้แถว Header */}
              <div style={{ ...scopeGroupStyle, width: "auto", minWidth: "170px", flexShrink: 0 }}>
                {[["all", "All"], ["paid", "Paid"], ["aging", "Aging"]].map(([val, label], i, arr) => (
                  <button key={val} onClick={() => setVatScope(val)} style={scopeBtnStyle(vatScope === val, i === arr.length - 1)}>
                    {label}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", gap: "8px", fontSize: "11px", flexShrink: 0, flexWrap: "wrap" }}>
                {zoneFBucketOrder.map((grp) => (
                  <span key={grp} style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: zoneFBucketColors[grp], display: "inline-block" }} />
                    {zoneFBucketLabels[grp]}
                  </span>
                ))}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginLeft: "auto", flexShrink: 0 }}>
                <input
                  value={popupSearch}
                  onChange={(e) => setPopupSearch(e.target.value)}
                  placeholder="ค้นหา BU"
                  style={{ padding: "5px 10px", fontSize: "12px", border: "1px solid #ccc", borderRadius: "8px", outline: "none", width: "150px" }}
                />
                <button
                  onClick={() => setShowAllBuPopup(false)}
                  style={{ width: "26px", height: "26px", padding: 0, border: "none", borderRadius: "50%", background: "rgba(255,255,255,0.2)", cursor: "pointer", fontSize: "14px", color: "white" }}
                >
                  ✕
                </button>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 18px", borderBottom: "1px solid #f0f0f0", fontSize: "11px", color: "#666", flexShrink: 0, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                {[{ k: null, label: "All Base" }, ...baseTabs.map((b) => ({ k: b, label: b }))].map((o) => (
                  <button
                    key={o.k || "all"}
                    onClick={() => setPopupBase(o.k)}
                    style={{
                      padding: "3px 10px",
                      fontSize: "11px",
                      borderRadius: "10px",
                      cursor: "pointer",
                      border: "1px solid #0f7a6b",
                      background: popupBase === o.k ? "#0f7a6b" : "white",
                      color: popupBase === o.k ? "white" : "#0f7a6b",
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <span style={{ marginLeft: "auto", color: "#999" }}>คลิกแถวเพื่อดู Preview Aging ของ BU นั้น</span>
            </div>

            <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
              <div className="table-scroll" style={{ flex: buFilter ? "1 1 0%" : "1 1 100%", minWidth: 0, overflowY: "auto", padding: "0 18px 16px", borderRight: buFilter ? "1px solid #eee" : "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "10px", color: "#999", padding: "8px 0", borderBottom: "1px solid #eee", position: "sticky", top: 0, background: "white", zIndex: 1 }}>
                  <span style={{ width: "40px", flexShrink: 0 }}>BU</span>
                  <span style={{ flex: 1 }}>สัดส่วน</span>
                  <span style={{ width: "54px", flexShrink: 0, textAlign: "right" }}>รวม</span>
                </div>
                {popupRowsVisible.length === 0 && (
                  <div style={{ padding: "24px", textAlign: "center", color: "#aaa", fontSize: "12px" }}>ไม่มีข้อมูล</div>
                )}
                {popupRowsVisible.map((row) => (
                  <div
                    key={row.bu}
                    onClick={() => setBuFilter(row.bu)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "6px 8px",
                      marginLeft: "-8px",
                      marginRight: "-8px",
                      borderRadius: "6px",
                      borderBottom: "1px solid #f4f4f4",
                      cursor: "pointer",
                      background: buFilter === row.bu ? "#eaf5f3" : "transparent",
                    }}
                    onMouseEnter={(e) => { if (buFilter !== row.bu) e.currentTarget.style.background = "#f7fafa"; }}
                    onMouseLeave={(e) => { if (buFilter !== row.bu) e.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{ width: "40px", fontSize: "11px", fontWeight: 600, color: buFilter === row.bu ? "#0f7a6b" : "#333", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {row.bu}
                    </span>
                    <div style={{ flex: 1, display: "flex", height: "16px", borderRadius: "3px", overflow: "hidden", background: "#f2f2f2" }}>
                      {zoneFBucketOrder.map((grp) =>
                        row[grp] > 0 ? (
                          <div
                            key={grp}
                            title={`${zoneFBucketLabels[grp]}: ${formatFull(row[grp])}`}
                            style={{ width: `${popupMax ? (row[grp] / popupMax) * 100 : 0}%`, background: zoneFBucketColors[grp] }}
                          />
                        ) : null
                      )}
                    </div>
                    <span style={{ width: "54px", fontSize: "10px", color: "#555", flexShrink: 0, textAlign: "right", fontWeight: 600 }}>
                      {formatCompact(row.total)}
                    </span>
                  </div>
                ))}
              </div>

              {/* MARKER_ZONEF_ALLBU_POPUP_PREVIEW_V1 — Panel Preview ด้านข้าง: บน = Donut (ย้ายไป
                  ซ้าย) + การ์ด 5 Type ด้านขวา, ล่าง = Preview Graph (ใช้ singleBuLineChartNode/
                  popupPreviewDonutNode ตัวเดียวกับ Zone B/F เพราะ categoryBreakdown/
                  singleBuChartGeom คำนวณจาก buFilter อยู่แล้ว)
                  MARKER_ZONEF_ALLBU_POPUP_PREVIEW_CARDS_V1 — เปลี่ยนจาก Donut เดี่ยวๆ กึ่งกลาง เป็น
                  Donut (เล็กลง, ย้ายไปซ้าย) + การ์ดสรุปยอดแต่ละ Type (5 การ์ด) ด้านขวา แทน Legend
                  ตัวหนังสือเฉยๆ — ใช้ flex:"0 0 auto"/"1 1 auto" แทน % เดิม กัน Bug กราฟล่างไม่ขึ้น
                  (Flex-basis แบบ % บางทีคำนวณพื้นที่เหลือผิดถ้า Parent Height มาจาก Flex ซ้อนกันหลายชั้น) */}
              {buFilter && (
                <div style={{ flex: "1 1 0%", minWidth: 0, display: "flex", flexDirection: "column", padding: "14px 18px", overflowX: "hidden", overflowY: "auto" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, marginBottom: "10px" }}>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: "#1a3a5c" }}>BU {buFilter}</div>
                    <button
                      onClick={() => setBuFilter(null)}
                      style={{ fontSize: "10px", color: "#999", background: "none", border: "1px solid #ddd", borderRadius: "8px", padding: "2px 8px", cursor: "pointer" }}
                    >
                      ล้างการเลือก
                    </button>
                  </div>
                  <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: "16px" }}>
                    <div style={{ flexShrink: 0, width: "210px", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                      {/* MARKER_POPUP_DONUT_PREV_CURRENT_TOGGLE_V1 — คลิกสลับ Donut แทนการวาด 2 วง */}
                      <div style={{ display: "flex", border: "1px solid #dde3e8", borderRadius: "999px", overflow: "hidden", flexShrink: 0 }}>
                        {[["current", "Current"], ["previous", "Previous"]].map(([val, label], i) => (
                          <button
                            key={val}
                            onClick={() => setPopupDonutView(val)}
                            style={{
                              padding: "3px 12px",
                              fontSize: "10px",
                              fontWeight: popupDonutView === val ? 700 : 500,
                              border: "none",
                              borderRight: i === 0 ? "1px solid #dde3e8" : "none",
                              background: popupDonutView === val ? "#0f7a6b" : "white",
                              color: popupDonutView === val ? "white" : "#555",
                              cursor: "pointer",
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div style={{ width: "210px", height: "210px", display: "flex", alignItems: "center", justifyContent: "center", overflow: "visible" }}>
                        {makePopupPreviewDonutNode(popupDonutView) || (
                          <div style={{ color: "#bbb", fontSize: "12px", textAlign: "center", padding: "0 20px" }}>
                            {popupDonutView === "previous" ? "ยังไม่มีข้อมูลเทียบ" : "ไม่มีข้อมูล"}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
                      {/* MARKER_CATEGORY_PREV_CURRENT_HEADER_V1 — หัวคอลัมน์ Previous/Current ตามที่ขอ
                          (เดิมไม่มีหัว Columns เลย) ให้ตรงกับตาราง Aging ด้านล่างที่มีอยู่แล้ว */}
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0 10px", fontSize: "10px", fontWeight: 700, color: "#0f7a6b" }}>
                        <span style={{ width: "9px", flexShrink: 0 }} />
                        <span style={{ width: "54px", flexShrink: 0 }} />
                        <span style={{ flex: 1, textAlign: "right" }}>Previous</span>
                        <span style={{ flex: 1, textAlign: "right" }}>Current</span>
                        <span style={{ width: "60px", textAlign: "right", flexShrink: 0 }}>% เปลี่ยนแปลง</span>
                      </div>
                      {categoryBreakdown.list.map((c) => {
                        const prevVal = categoryPrevByType && categoryPrevByType[c.key] != null ? categoryPrevByType[c.key] : null;
                        const rowPct = prevVal != null && prevVal > 0 ? ((c.amount - prevVal) / prevVal) * 100 : null;
                        return (
                          <div key={c.key} style={{ border: "1px solid #eee", borderRadius: "8px", padding: "7px 10px", display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                            <span style={{ width: "9px", height: "9px", borderRadius: "2px", background: breakdownColorOf(c.key), display: "inline-block", flexShrink: 0 }} />
                            <span style={{ fontSize: "11px", fontWeight: 700, color: "#333", width: "54px", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {breakdownLabelOf(c.key)}
                            </span>
                            <span style={{ flex: 1, fontSize: "12px", color: prevVal != null ? "#555" : "#ccc", textAlign: "right" }}>
                              {prevVal != null ? formatFull(prevVal) : "–"}
                            </span>
                            <span style={{ flex: 1, fontSize: "13px", fontWeight: 700, color: "#1a3a5c", textAlign: "right" }}>{formatFull(c.amount)}</span>
                            <span style={{ width: "60px", fontSize: "11px", fontWeight: rowPct != null ? 700 : 400, textAlign: "right", flexShrink: 0, color: rowPct == null ? "#ccc" : rowPct >= 0 ? "#dc2626" : "#16a34a" }}>
                              {rowPct != null ? `${rowPct >= 0 ? "▲" : "▼"} ${Math.abs(rowPct).toFixed(1)}%` : "–"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ flex: "0 0 1px", background: "#eee", margin: "12px 0", flexShrink: 0 }} />
                  <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" }}>
                    {makeSingleBuLineChartNode(false, true)}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MARKER_DONUT_CUSTOM_TOOLTIP_RENDER_V1 — Tooltip ลอยแบบ Fixed Position สไตล์เดียวกับ
          MARKER_ZONEF_ROW_TOOLTIP_V1 ด้านล่าง (การ์ดเข้มสีเดียวกัน + Clamp ไม่ให้หลุดขอบจอ) แทน
          <title> ของ Browser ที่ใช้ก่อนหน้านี้ — ใช้ร่วมกันทั้ง Donut หลัก (Zone B) และ Donut ใน
          Popup Preview */}
      {donutTooltip && (() => {
        const estW = 170;
        const estH = 80;
        const overflowsRight = donutTooltip.x + 14 + estW > window.innerWidth;
        const left = overflowsRight
          ? Math.max(8, donutTooltip.x - estW - 14)
          : Math.min(donutTooltip.x + 14, window.innerWidth - estW - 8);
        const top = Math.max(8, Math.min(window.innerHeight - estH - 8, donutTooltip.y - estH / 2));
        return (
          <div
            style={{
              position: "fixed",
              left,
              top,
              background: "#1a2b3c",
              color: "white",
              borderRadius: "6px",
              padding: "10px 12px",
              fontSize: "11px",
              boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
              zIndex: 9999,
              pointerEvents: "none",
              minWidth: "150px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 700, marginBottom: "6px", borderBottom: "1px solid rgba(255,255,255,0.2)", paddingBottom: "4px" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: breakdownColorOf(donutTooltip.key), display: "inline-block", flexShrink: 0 }} />
              {breakdownLabelOf(donutTooltip.key)}
            </div>
            <div style={{ fontSize: "14px", fontWeight: 700 }}>{formatFull(donutTooltip.amount)}</div>
            <div style={{ fontSize: "11px", color: "#b8c4d0", marginTop: "2px" }}>{donutTooltip.pct.toFixed(1)}% ของยอดรวม</div>
          </div>
        );
      })()}

      {/* MARKER_ZONEC_PAID_AGING_TOOLTIP_V1 -- Hover การ์ด Total Vat Paid (All / แต่ละ Type) แสดงยอดแยกตาม Aging */}
      {paidHoverTip && (() => {
        const k = paidHoverTip.key;
        const src = paidAgingBreakdown[k] || {};
        const colorOf = (m) => (m === "0" ? AGING_BUCKET_COLORS.zero : m === "1" || m === "2" ? AGING_BUCKET_COLORS.low : m === "3" || m === "4" ? AGING_BUCKET_COLORS.medium : m === "5" || m === "6" ? AGING_BUCKET_COLORS.high : m === "Expired" ? AGING_BUCKET_COLORS.expired : "#bbb");
        const labelOf = (m) => (m === "Expired" ? "Expired" : m === "other" ? "อื่นๆ" : `Aging ${m}`);
        const entries = ["0", "1", "2", "3", "4", "5", "6", "Expired", "other"].map((m) => [m, src[m] || 0]).filter(([, v]) => Math.abs(v) > 0.004);
        const tot = entries.reduce((a, [, v]) => a + v, 0);
        const pc = (v) => (tot ? ((v / tot) * 100).toFixed(1) : "0.0");
        return (
          <div style={{ position: "fixed", left: Math.min(paidHoverTip.x + 14, (typeof window !== "undefined" ? window.innerWidth : 1200) - 280), top: Math.max(8, paidHoverTip.y - 40), background: "rgba(30,41,59,0.96)", color: "white", borderRadius: "8px", padding: "8px 12px", fontSize: "11px", lineHeight: 1.6, boxShadow: "0 4px 14px rgba(0,0,0,0.25)", zIndex: 9999, pointerEvents: "none", minWidth: "240px" }}>
            <div style={{ fontWeight: 700, marginBottom: "4px", borderBottom: "1px solid rgba(255,255,255,0.2)", paddingBottom: "4px" }}>
              Paid {k === "ALL" ? "All" : `[${k}]`} · {formatFull(tot)}
            </div>
            {entries.length === 0 && <div style={{ opacity: 0.7 }}>ไม่มียอด</div>}
            {entries.map(([m, v]) => (
              <div key={m} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: colorOf(m), display: "inline-block" }} />
                <span style={{ flex: 1 }}>{labelOf(m)}</span>
                <span style={{ fontWeight: 700 }}>{formatFull(v)}</span>
                <span style={{ opacity: 0.7, width: "44px", textAlign: "right" }}>{pc(v)}%</span>
              </div>
            ))}
          </div>
        );
      })()}

      {/* MARKER_ZONEC_EXPIRED_HOVER_RU_V1 -- Hover การ์ด Total Vat Expired (All / แต่ละ Type) แสดงยอด Realized / Unrealized */}
      {expiredHoverTip && (() => {
        const k = expiredHoverTip.key;
        const realized = k === "ALL" ? paymentStatusBreakdown.realized_expired.total : (paymentStatusBreakdown.realized_expired.sums[k] || 0);
        const unrealized = k === "ALL" ? paymentStatusBreakdown.unrealized_expired.total : (paymentStatusBreakdown.unrealized_expired.sums[k] || 0);
        const tot = realized + unrealized;
        const pc = (v) => (tot ? ((v / tot) * 100).toFixed(1) : "0.0");
        return (
          <div style={{ position: "fixed", left: expiredHoverTip.x + 14, top: expiredHoverTip.y - 80, background: "rgba(30,41,59,0.96)", color: "white", borderRadius: "8px", padding: "8px 12px", fontSize: "11px", lineHeight: 1.6, boxShadow: "0 4px 14px rgba(0,0,0,0.25)", zIndex: 9999, pointerEvents: "none", minWidth: "210px" }}>
            <div style={{ fontWeight: 700, marginBottom: "4px", borderBottom: "1px solid rgba(255,255,255,0.2)", paddingBottom: "4px" }}>
              Expired {k === "ALL" ? "All" : `[${k}]`} · {formatFull(tot)}
            </div>
            {/* MARKER_EXPIRED_HOVER_RU_COLORS_V1 -- Realized = แดง / Unrealized = เขียว (ตัวอักษรอ่านง่ายบนพื้นเข้ม) */}
            <div style={{ display: "flex", justifyContent: "space-between", gap: "14px", color: "#f87171" }}>
              <span>Realized</span><span style={{ fontWeight: 700 }}>{formatFull(realized)} ({pc(realized)}%)</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "14px", color: "#4ade80" }}>
              <span>Unrealized</span><span style={{ fontWeight: 700 }}>{formatFull(unrealized)} ({pc(unrealized)}%)</span>
            </div>
          </div>
        );
      })()}

      {/* MARKER_ZONEF_ROW_TOOLTIP_V1 — Tooltip ลอยแบบ Fixed Position (หนี Overflow ของ Container
          ทุกชั้นเพราะไม่มี Ancestor ไหนใช้ transform) ปกติโผล่ "สูงขวา" ของ Mouse แต่
          MARKER_ZONEF_TOOLTIP_CLAMP_V1 — ถ้าชิดขอบขวาจอจนล้นออกไป (เช่นแถวอยู่ท้ายสุดของ Zone F
          ที่ติดขอบขวาอยู่แล้ว) ให้สลับไปโผล่ทางซ้ายของ Mouse แทน พร้อม Clamp บน/ล่างไม่ให้หลุดจอ */}
      {zoneFTooltip && (() => {
        const estW = 190;
        const estH = 170;
        const overflowsRight = zoneFTooltip.x + 12 + estW > window.innerWidth;
        const left = overflowsRight
          ? Math.max(8, zoneFTooltip.x - estW - 12)
          : Math.min(zoneFTooltip.x + 12, window.innerWidth - estW - 8);
        const top = Math.max(8, Math.min(window.innerHeight - estH - 8, zoneFTooltip.y - estH));
        return (
        <div
          style={{
            position: "fixed",
            left,
            top,
            background: "#1a2b3c",
            color: "white",
            borderRadius: "6px",
            padding: "10px 12px",
            fontSize: "11px",
            boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
            zIndex: 9999,
            pointerEvents: "none",
            minWidth: "150px",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: "6px", borderBottom: "1px solid rgba(255,255,255,0.2)", paddingBottom: "4px" }}>
            {zoneFTooltip.row.bu} · {valueMode === "claim"
              ? `Claim ${buRatePct[zoneFTooltip.row.bu] != null ? buRatePct[zoneFTooltip.row.bu].toFixed(2) : "–"}%`
              : "by Booking"}
          </div>
          {zoneFBucketOrder.map((grp) => (
            <div key={grp} style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px" }}>
              <span style={{ width: "7px", height: "7px", borderRadius: "2px", background: zoneFBucketColors[grp], display: "inline-block", flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{zoneFBucketLabels[grp]}</span>
              <span style={{ fontWeight: 600 }}>{formatFull(zoneFTooltip.row[grp] || 0)}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "6px", paddingTop: "4px", borderTop: "1px solid rgba(255,255,255,0.2)", fontWeight: 700 }}>
            <span>รวม</span>
            <span>{formatFull(zoneFTooltip.row.total)}</span>
          </div>
        </div>
        );
      })()}

      {/* MARKER_ZONEC_EXPIRED_DETAIL_POPUP_V1 — Popup รายละเอียด Realized/Unrealized Expired
          เปิดจากปุ่ม "i" ที่การ์ด Total Vat Expired All ใน Zone C แทนการโชว์เป็นแถวในตารางหลัก */}
      {showExpiredDetailPopup && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100 }}
          onClick={() => { setShowExpiredDetailPopup(false); setExpiredDetailFull(false); }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "white", borderRadius: expiredDetailFull ? 0 : "12px", width: expiredDetailFull ? "100vw" : "95vw", maxWidth: expiredDetailFull ? "none" : "1200px", height: expiredDetailFull ? "100vh" : "90vh", maxHeight: expiredDetailFull ? "100vh" : "90vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 10px 40px rgba(0,0,0,0.3)" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "14px 18px", borderBottom: "1px solid #e8e8e8", flexShrink: 0, background: "#b91c1c", color: "white" }}>
              <div style={{ fontSize: "15px", fontWeight: 700, flex: 1 }}>Expired Detail — Realized vs Unrealized</div>
              <button
                onClick={() => setExpiredDetailFull((v) => !v)}
                title={expiredDetailFull ? "ย่อกลับ" : "ขยายเต็มจอ"}
                aria-label={expiredDetailFull ? "ย่อกลับ" : "ขยายเต็มจอ"}
                style={{ width: "26px", height: "26px", padding: 0, border: "none", borderRadius: "50%", background: "rgba(255,255,255,0.2)", cursor: "pointer", fontSize: "14px", color: "white" }}
              >
                {expiredDetailFull ? "🗗" : "⛶"}
              </button>
              <button
                onClick={() => { setShowExpiredDetailPopup(false); setExpiredDetailFull(false); }}
                style={{ width: "26px", height: "26px", padding: 0, border: "none", borderRadius: "50%", background: "rgba(255,255,255,0.2)", cursor: "pointer", fontSize: "14px", color: "white" }}
              >
                ✕
              </button>
            </div>
            {/* MARKER_ZONEC_EXPIRED_DETAIL_ZONE_FILL_BOTTOM_V1 -- ครอบด้วย flex column + flex:1 แทน
                Fix เป็น vh เฉยๆ ให้ Zone Detail ด้านล่างยืดเต็มจนชิดขอบล่างของ Popup จริงๆ ไม่เหลือ
                พื้นที่ว่างเกินก่อนถึงขอบล่าง */}
            <div style={{ padding: "16px 18px", overflow: "hidden", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              {/* MARKER_ZONEC_EXPIRED_DETAIL_VIEW_TOGGLE_V1 -- สลับ Type/BU กลับมาแล้ว */}
              {/* MARKER_ZONEC_EXPIRED_DETAIL_VIEW_FIXED_HEIGHT_V1 -- Fix ความสูงของโซน By Type ให้เท่ากับ
                  By BU (ไม่ให้ Popup ยืด/หดตอนสลับ Toggle) -- กำหนด height คงที่ให้ Wrapper ของทั้งสอง View
                  แล้วให้แต่ละ View Scroll ภายในตัวเองแทน */}
              <div style={{ flexShrink: 0, display: "flex", gap: "0", marginBottom: "12px", border: "1px solid #ddd", borderRadius: "8px", width: "fit-content", overflow: "hidden" }}>
                {[["type", "By Type"], ["bu", `By BU (${expiredDetailByBU.length})`]].map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setExpiredDetailView(val)}
                    style={{
                      padding: "6px 16px", fontSize: "12px", fontWeight: 700, border: "none", cursor: "pointer",
                      background: expiredDetailView === val ? "#b91c1c" : "white",
                      color: expiredDetailView === val ? "white" : "#666",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {expiredDetailView === "type" ? (
                /* MARKER_ZONEC_EXPIRED_TYPE_SPLIT_MOM_V1 -- ตาราง By Type แบ่งครึ่ง: ซ้าย = ยอด
                   Realized/Unrealized/Total, ขวา = MoM เทียบเดือนก่อนหน้า (ลูกศรขึ้น/ลง + %)
                   MARKER_ZONEC_EXPIRED_DETAIL_VIEW_FIXED_HEIGHT_V1 -- ครอบด้วยความสูงคงที่ EXPIRED_VIEW_HEIGHT
                   เท่ากับฝั่ง By BU ไม่ให้ Popup ยืด/หดตอนสลับ Toggle
                   MARKER_ZONEC_EXPIRED_TREND_3PANELS_BYMONTH_REALIZED_ONLY_V1 -- เอากราฟเทียบ 3 เดือน
                   กลับมาไว้ในฝั่ง By Type เท่านั้น (ของเดิมอยู่นอก Toggle เลยโดนลบไปทั้งสองฝั่งพร้อมกัน
                   ตอนตัดออกจาก By BU -- พี่ไม่ได้ขอให้ตัดออกจาก By Type ด้วย) */
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", gap: "16px", flexShrink: 0 }}>
                  <div style={{ flex: 1 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                      <thead>
                        <tr style={{ background: "#f5f6f8" }}>
                          <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "2px solid #e0e0e0" }}>Type</th>
                          <th style={{ textAlign: "right", padding: "8px 10px", borderBottom: "2px solid #e0e0e0", color: "#b91c1c" }}>Realized Expired</th>
                          <th style={{ textAlign: "right", padding: "8px 10px", borderBottom: "2px solid #e0e0e0", color: "#7c3aed" }}>Unrealized Expired</th>
                          <th style={{ textAlign: "right", padding: "8px 10px", borderBottom: "2px solid #e0e0e0" }}>Total Expired</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr style={{ fontWeight: 700 }}>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #eee" }}>All</td>
                          <td style={{ textAlign: "right", padding: "8px 10px", borderBottom: "1px solid #eee" }}>{formatFull(paymentStatusBreakdown.realized_expired.total)}</td>
                          <td style={{ textAlign: "right", padding: "8px 10px", borderBottom: "1px solid #eee" }}>{formatFull(paymentStatusBreakdown.unrealized_expired.total)}</td>
                          <td style={{ textAlign: "right", padding: "8px 10px", borderBottom: "1px solid #eee" }}>{formatFull(paymentStatusBreakdown.expired.total)}</td>
                        </tr>
                        {PAYMENT_STATUS_TYPES.map((t) => (
                          <tr key={t}>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f3f3f3", color: "#666" }}>{t}</td>
                            <td style={{ textAlign: "right", padding: "8px 10px", borderBottom: "1px solid #f3f3f3" }}>{formatFull(paymentStatusBreakdown.realized_expired.sums[t] || 0)}</td>
                            <td style={{ textAlign: "right", padding: "8px 10px", borderBottom: "1px solid #f3f3f3" }}>{formatFull(paymentStatusBreakdown.unrealized_expired.sums[t] || 0)}</td>
                            <td style={{ textAlign: "right", padding: "8px 10px", borderBottom: "1px solid #f3f3f3" }}>{formatFull(paymentStatusBreakdown.expired.sums[t] || 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ flex: 1, borderLeft: "1px solid #eee", paddingLeft: "16px" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                      <thead>
                        <tr style={{ background: "#f5f6f8" }}>
                          <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "2px solid #e0e0e0" }}>Type</th>
                          <th style={{ textAlign: "right", padding: "8px 10px", borderBottom: "2px solid #e0e0e0" }}>เทียบเดือนก่อนหน้า</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr style={{ fontWeight: 700 }}>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #eee" }}>All</td>
                          <td style={{ textAlign: "right", padding: "8px 10px", borderBottom: "1px solid #eee" }}>{renderMomArrow(expiredMomByType.rows.All)}</td>
                        </tr>
                        {PAYMENT_STATUS_TYPES.map((t) => (
                          <tr key={t}>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid #f3f3f3", color: "#666" }}>{t}</td>
                            <td style={{ textAlign: "right", padding: "8px 10px", borderBottom: "1px solid #f3f3f3" }}>{renderMomArrow(expiredMomByType.rows[t])}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* MARKER_ZONEC_EXPIRED_TREND_3PANELS_BYMONTH_REALIZED_ONLY_V1 -- 3 กราฟแยกตาม "เดือน"
                    แต่ละ Panel = 1 เดือน ข้างในเป็นแท่งเทียบ Type (CPN/ITC/LAND/UTL/OTH) ของ Realized
                    Expired เดือนนั้นๆ -- ไม่มีกรอบ/กล่องล้อมรอบแต่ละ Panel ใช้เส้นคั่นบางๆ แทน */}
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#333", marginTop: "20px", marginBottom: "8px", flexShrink: 0 }}>
                  เทียบ 3 เดือนย้อนหลัง
                </div>
                {/* MARKER_ZONEC_EXPIRED_TREND_CHART_FILL_HEIGHT_V3 -- V2 (Fix สูงตรงเป็น vh) ทำให้ Popup
                    รวมสูงเกินจน Scroll ("ทำไมมันต้องสูงจนมี Scroll") -- กลับมาใช้ flex:1 ยืดเติมพื้นที่ที่
                    เหลือจริงแทน (flex-grow ไม่มีทาง Overflow เกิน Parent อยู่แล้วตาม Spec) ไม่ใช้ vh ตายตัว
                    MARKER_ZONEC_EXPIRED_TREND_CHART_SPREAD_BARS_V1 -- เปลี่ยน justifyContent ของแท่งจาก
                    "center" เป็น "space-evenly" ให้แท่งกระจายเต็มความกว้างแต่ละเดือน ตามที่ขอ "กระจายๆ ได้มั้ย"
                    (เดือนที่ไม่มีข้อมูลสองเดือนว่าง ทำให้เดือนปัจจุบันเหลือพื้นที่กว้างมากแต่แท่งชิดกึ่งกลาง) */}
                {(() => {
                  const months = expiredTrend3Month;
                  const typeRealizedOf = (m, t) => (m.byType[t] ? m.byType[t].realized || 0 : 0);
                  const globalMax = Math.max(
                    ...months.flatMap((m) => (m.hasData ? PAYMENT_STATUS_TYPES.map((t) => typeRealizedOf(m, t)) : [])),
                    1
                  );
                  return (
                    <div style={{ padding: "0 20px", borderBottom: "1px solid #e5e5e5", paddingBottom: "10px", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                      <div style={{ fontSize: "11px", fontWeight: 700, color: "#b91c1c", marginBottom: "6px", flexShrink: 0 }}>
                        Realized Expired — แยกตาม Type ในแต่ละเดือน
                      </div>
                      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
                        {months.map((m, mi) => (
                          <div
                            key={m.month}
                            style={{
                              flex: 1, paddingLeft: mi === 0 ? 0 : "14px", borderLeft: mi === 0 ? "none" : "1px solid #eee",
                              display: "flex", flexDirection: "column",
                            }}
                          >
                            <div style={{ fontSize: "11px", fontWeight: 700, color: m.month === periodMonth ? "#b91c1c" : "#888", textAlign: "center", marginBottom: "6px", flexShrink: 0 }}>
                              {m.month}{m.month === periodMonth ? " (ปัจจุบัน)" : ""}
                            </div>
                            {!m.hasData ? (
                              <div style={{ fontSize: "10px", color: "#bbb", fontStyle: "italic", textAlign: "center", padding: "40px 0", flex: 1 }}>
                                ไม่มีข้อมูล<br />(ยังไม่มี Freeze)
                              </div>
                            ) : (
                              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-evenly", flex: 1, minHeight: 0 }}>
                                {PAYMENT_STATUS_TYPES.map((t) => {
                                  const v = typeRealizedOf(m, t);
                                  const h = Math.max(2, (v / globalMax) * 100);
                                  const barKey = `${m.month}|${t}`;
                                  const isHovered = hoveredTrendBar && hoveredTrendBar.key === barKey;
                                  return (
                                    <div
                                      key={t}
                                      style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}
                                      onMouseEnter={() => setHoveredTrendBar({ key: barKey, month: m.month, type: t, value: v })}
                                      onMouseLeave={() => setHoveredTrendBar((prev) => (prev && prev.key === barKey ? null : prev))}
                                    >
                                      {isHovered && (
                                        <div
                                          style={{
                                            position: "absolute", bottom: "calc(100% + 4px)", left: "50%", transform: "translateX(-50%)",
                                            background: "#1f2937", color: "white", fontSize: "11px", padding: "6px 10px", borderRadius: "6px",
                                            whiteSpace: "nowrap", boxShadow: "0 4px 10px rgba(0,0,0,0.25)", zIndex: 5, pointerEvents: "none",
                                          }}
                                        >
                                          <div style={{ fontWeight: 700 }}>{m.month} — {t}</div>
                                          <div>{formatFull(v)}</div>
                                          <div
                                            style={{
                                              position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)",
                                              width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent",
                                              borderTop: "5px solid #1f2937",
                                            }}
                                          />
                                        </div>
                                      )}
                                      <div style={{ fontSize: "9px", color: TYPE_TREND_COLORS[t], marginBottom: "2px", whiteSpace: "nowrap" }}>
                                        {v > 0 ? formatCompact(v) : ""}
                                      </div>
                                      <div
                                        style={{
                                          width: "32px", height: `${h}%`, background: TYPE_TREND_COLORS[t], borderRadius: "2px 2px 0 0",
                                          cursor: "default", outline: isHovered ? "2px solid #1f2937" : "none", outlineOffset: "1px",
                                        }}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", fontSize: "11px", marginTop: "8px", flexShrink: 0 }}>
                        {PAYMENT_STATUS_TYPES.map((t) => (
                          <div key={t} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                            <span style={{ width: "10px", height: "10px", borderRadius: "2px", background: TYPE_TREND_COLORS[t], display: "inline-block" }} />
                            {t}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
                </div>
              ) : (
                /* MARKER_ZONEC_EXPIRED_BU_DETAIL_ZONE_V1 -- แบ่ง Zone เป็น 40:60 แนวตั้งคงที่
                   (EXPIRED_VIEW_HEIGHT รวม): บน 40% = ตาราง By BU, ล่าง 60% = Zone คงที่โชว์ Detail
                   Invoice เมื่อกดยอด Realized/Unrealized ของ BU หรือกด Card Reason (จาก
                   vat_watchlist_report รวม Column "remark"/Note) -- ไม่ใช่แทรกใต้แถวแบบเดิม ตามที่ขอ
                   MARKER_ZONEC_EXPIRED_UNREALIZED_REASON_CARDS_V1 -- ส่วน 40% บน แบ่งแนวกว้างต่อ
                   เป็น 70:30 (70 = ตาราง By BU เดิม, 30 = Card สรุป Unrealized ตาม Reason)
                   MARKER_ZONEC_EXPIRED_DETAIL_ZONE_FILL_BOTTOM_V1 -- flex:1 แทน height คงที่ ให้ Zone
                   60% ด้านล่างยืดจนชิดขอบล่าง Popup จริงๆ */
                <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                  <div style={{ flex: "0 0 40%", minHeight: 0, display: "flex", gap: "10px" }}>
                    <div style={{ flex: "0 0 70%", minHeight: 0, overflowY: "auto", border: "1px solid #eee", borderRadius: "8px" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                        <thead>
                          <tr style={{ background: "#f5f6f8" }}>
                            <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "2px solid #e0e0e0", position: "sticky", top: 0, background: "#f5f6f8" }}>BU</th>
                            <th style={{ textAlign: "right", padding: "8px 10px", borderBottom: "2px solid #e0e0e0", color: "#b91c1c", position: "sticky", top: 0, background: "#f5f6f8" }}>Realized Expired</th>
                            <th style={{ textAlign: "right", padding: "8px 10px", borderBottom: "2px solid #e0e0e0", color: "#7c3aed", position: "sticky", top: 0, background: "#f5f6f8" }}>Unrealized Expired</th>
                            <th style={{ textAlign: "right", padding: "8px 10px", borderBottom: "2px solid #e0e0e0", position: "sticky", top: 0, background: "#f5f6f8" }}>Total Expired</th>
                          </tr>
                        </thead>
                        <tbody>
                          {expiredDetailRows.length === 0 ? (
                            <tr>
                              <td colSpan={4} style={{ textAlign: "center", padding: "14px", color: "#999" }}>ไม่มีข้อมูล</td>
                            </tr>
                          ) : (
                            expiredDetailRows.map((row) => {
                              const isRealizedSel = buDetailSelection && buDetailSelection.bu === row.bu && buDetailSelection.bucket === "realized";
                              const isUnrealizedSel = buDetailSelection && buDetailSelection.bu === row.bu && buDetailSelection.bucket === "unrealized";
                              return (
                                <tr key={row.bu}>
                                  <td style={{ padding: "8px 10px", borderBottom: "1px solid #f3f3f3", fontWeight: 600 }}>{row.bu}</td>
                                  <td
                                    onClick={() => row.realized > 0 && selectBuDetail(row.bu, "realized")}
                                    title={row.realized > 0 ? "คลิกเพื่อดู Detail ที่มา" : undefined}
                                    style={{
                                      textAlign: "right", padding: "8px 10px", borderBottom: "1px solid #f3f3f3",
                                      cursor: row.realized > 0 ? "pointer" : "default",
                                      textDecoration: isRealizedSel ? "underline" : "none",
                                      color: isRealizedSel ? "#b91c1c" : "inherit", fontWeight: isRealizedSel ? 700 : 400,
                                    }}
                                  >
                                    {formatFull(row.realized)}
                                  </td>
                                  <td
                                    onClick={() => row.unrealized > 0 && selectBuDetail(row.bu, "unrealized")}
                                    title={row.unrealized > 0 ? "คลิกเพื่อดู Detail ที่มา" : undefined}
                                    style={{
                                      textAlign: "right", padding: "8px 10px", borderBottom: "1px solid #f3f3f3",
                                      color: row.unrealized > 0 ? "#7c3aed" : "#999",
                                      fontWeight: isUnrealizedSel || row.unrealized > 0 ? 700 : 400,
                                      cursor: row.unrealized > 0 ? "pointer" : "default",
                                      textDecoration: isUnrealizedSel ? "underline" : "none",
                                    }}
                                  >
                                    {formatFull(row.unrealized)}
                                  </td>
                                  <td style={{ textAlign: "right", padding: "8px 10px", borderBottom: "1px solid #f3f3f3" }}>{formatFull(row.total)}</td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* MARKER_ZONEC_EXPIRED_UNREALIZED_REASON_CARDS_V1 -- 30% ขวา: Card สรุป Unrealized
                        แยกตาม Reason (Check Return / Issue / Other) ดึงจาก Note/Remark จริง กด Card
                        แล้วโชว์ Detail Invoice ของ Reason นั้นใน Zone 60% ด้านล่างทันที
                        MARKER_ZONEC_EXPIRED_REASON_CARDS_SCOPE_BY_BU_V1 -- กดยอด Unrealized ของ BU
                        ไหนแล้ว Card ต้องเปลี่ยนมาแบ่งองค์ประกอบเฉพาะ BU นั้น พร้อม Label บอกบริบท
                        MARKER_ZONEC_EXPIRED_REASON_CARDS_FILL_HEIGHT_V1 -- เดิม Card สูงแค่ตามเนื้อหา เหลือ
                        พื้นที่ว่างด้านล่างไม่เท่าความสูงตาราง BU ฝั่งซ้าย (70%) ตามที่ขอ "ขยายให้สูงเท่ากัน"
                        -- ให้แต่ละ Card เป็น flex:1 แบ่งพื้นที่สูงเท่ากันเต็มความสูง Zone 40% แทน */}
                    <div style={{ flex: "0 0 30%", minHeight: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
                      <div style={{ fontSize: "10px", fontWeight: 700, color: (reasonCardsScopeBu || reasonCardsScopeBase) ? "#7c3aed" : "#999", flexShrink: 0 }}>
                        {reasonCardsScopeBu ? `เฉพาะ BU: ${reasonCardsScopeBu}` : reasonCardsScopeBase ? `เฉพาะ Base: ${reasonCardsScopeBase}` : `ทุก BU ในตาราง (${viewBuSet.size})`}
                      </div>
                      {unrealizedReasonState.loading ? (
                        <div style={{ fontSize: "11px", color: "#999", textAlign: "center", padding: "10px 0" }}>กำลังโหลด...</div>
                      ) : unrealizedReasonState.error ? (
                        <div style={{ fontSize: "11px", color: "#b91c1c", textAlign: "center", padding: "10px 0" }}>{unrealizedReasonState.error}</div>
                      ) : (
                        UNREALIZED_REASON_CARDS.map((c) => {
                          const bucket = unrealizedReasonBuckets[c.key] || { rows: [], total: 0 };
                          const isSel = buDetailSelection && buDetailSelection.reason === c.key;
                          return (
                            <div
                              key={c.key}
                              onClick={() => bucket.rows.length > 0 && selectReasonDetail(c.key, c.label)}
                              style={{
                                flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center",
                                border: `1px solid ${isSel ? c.color : "#eee"}`,
                                borderLeft: `4px solid ${c.color}`,
                                borderRadius: "6px", padding: "8px 10px",
                                cursor: bucket.rows.length > 0 ? "pointer" : "default",
                                background: isSel ? `${c.color}14` : "white",
                              }}
                            >
                              <div style={{ fontSize: "11px", fontWeight: 700, color: c.color }}>{c.label}</div>
                              <div style={{ fontSize: "13px", fontWeight: 700, color: "#333", marginTop: "2px" }}>{formatFull(bucket.total)}</div>
                              <div style={{ fontSize: "10px", color: "#999" }}>{bucket.rows.length} Invoice</div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Zone คงที่ 60% ด้านล่าง — โชว์ Detail ของ BU+Bucket หรือ Reason ที่เลือกล่าสุด, Scroll ในตัวเอง
                      MARKER_ZONEC_EXPIRED_DETAIL_ZONE_NO_INNER_BOX_V1 -- เอากรอบ Dashed ที่ทำให้ดูเป็น
                      "กล่องซ้อนกล่อง" ออก ตามที่ขอ "ไม่ต้องทำเป็น Zone Detail ... แสดงทุกอย่างที่เป็น
                      Detail" -- เหลือแค่เส้นคั่นบางๆ ด้านบนแทน ให้เนื้อหา Detail เต็มพื้นที่ */}
                  <div style={{ flex: "0 0 60%", minHeight: 0, marginTop: "10px", borderTop: "1px solid #e5e5e5", paddingTop: "10px", display: "flex", flexDirection: "column", overflow: "hidden" }}>
                    {!buDetailSelection ? (
                      <div style={{ fontSize: "12px", color: "#999", textAlign: "center", padding: "30px 0" }}>
                        คลิกยอด Realized/Unrealized ของ BU ด้านบน เพื่อดู Detail ที่มาของตัวเลข (รวม Note/Remark)
                      </div>
                    ) : (
                      /* MARKER_ZONEC_EXPIRED_BU_DETAIL_NOTE_COLUMN_V1 -- ดึง Column remark/Note
                         มาไว้ลำดับแรกๆ (ต่อจาก Column แรก) และไฮไลท์สีให้เห็นชัด ไม่ต้อง Scroll
                         ขวาไปหา ตามที่ขอ "ให้ดึง Note มาแสดง"
                         MARKER_ZONEC_EXPIRED_REASON_MATCH_FIX_V1 -- Priority Column "remark" ตรงตัว
                         ก่อนเสมอ (ไม่ใช่ "note" ที่มักเป็น [null] ตามที่เช็คจาก pgAdmin)
                         MARKER_ZONEC_EXPIRED_BU_DETAIL_STICKY_HEADER_FIX_V1 -- เดิม Sticky ไม่ติดเพราะ
                         div ห่อ Table มี overflowX:"auto" เฉยๆ (overflow-y เป็น visible) ตาม Spec
                         Browser จะบังคับ Compute overflow-y เป็น "auto" ไปด้วย กลายเป็น Scroll
                         Container แยกของตัวเอง คนละตัวกับที่ Scroll จริง (Zone 60% ด้านนอก) sticky
                         เลยอ้างอิงผิด Container -- แก้โดยให้ div นี้เป็น Scroll Container จริงตัวเดียว
                         (flex:1 + overflow:"auto" ทั้งสองแกน) แล้ว Sticky จะอ้างอิงถูกตัว
                         MARKER_ZONEC_EXPIRED_DETAIL_DEFAULT_COLS_UNREALIZED_V1 -- ตามที่ขอ "ไม่จำเป็นต้อง
                         ให้เลือก" (ตัดปุ่ม/Checkbox เลือกคอลัมน์ออก ไม่ต้องให้ User เลือกเอง) -- Unrealized
                         (ทั้งกด BU โดยตรง bucket==="unrealized" และกด Reason Card ซึ่งเป็น Unrealized เสมอ)
                         ให้ Fix แสดงเฉพาะชุด Column ที่ส่งมาให้ดู (16 คอลัมน์): doc_date, branch, tax_type,
                         invoice_ref, supplier_code, vendor_name, payment_date, check_date, check_no,
                         receive_doc_date, receive_doc_no, exp_amount, exp_vat, old_ref_check_no,
                         old_ref_pay_date (บวก Note/Remark ที่ดึงมาแสดงเสมออยู่แล้ว) -- Realized ยังแสดง
                         ทุก Column เหมือนเดิม (ไม่ได้ขอให้จำกัดฝั่งนั้น) */
                      (() => {
                        const hasRows = !buDetailState.loading && !buDetailState.error && buDetailState.rows.length > 0;
                        const allCols = hasRows ? Object.keys(buDetailState.rows[0]) : [];
                        const noteCol = allCols.find((c) => c.toLowerCase() === "remark")
                          || allCols.find((c) => /remark/i.test(c))
                          || allCols.find((c) => /note/i.test(c));
                        const restCols = allCols.filter((c) => c !== noteCol);
                        const orderedColsAll = noteCol
                          ? [restCols[0], noteCol, ...restCols.slice(1)].filter(Boolean)
                          : allCols;
                        const isUnrealizedView = !!(buDetailSelection && (buDetailSelection.bucket === "unrealized" || buDetailSelection.reason));
                        const DEFAULT_UNREALIZED_COLS = [
                          "doc_date", "branch", "tax_type", "invoice_ref", "supplier_code", "vendor_name",
                          "payment_date", "check_date", "check_no", "receive_doc_date", "receive_doc_no",
                          "exp_amount", "exp_vat", "old_ref_check_no", "old_ref_pay_date",
                        ];
                        // MARKER_ZONEC_EXPIRED_DETAIL_DEFAULT_COLS_REALIZED_V1 -- ตามที่ขอ: Realized ไม่ต้องแสดง id, Note/Remark, phone,
                        // ap_source, ap_batch_name..old_ref_*, rate_unresolved, type_* (ไม่ต้องดึงเยอะ) -- ใช้ Whitelist เหมือนฝั่ง Unrealized
                        const DEFAULT_REALIZED_COLS = [
                          "doc_date", "doc_no", "site", "pay_group", "branch", "tax_type", "invoice_ref", "supplier_code", "vendor_name",
                          "payment_date", "check_date", "check_no", "receive_doc_date", "receive_doc_no",
                          "exp_amount", "exp_vat", "avg_amount", "avg_vat",
                        ];
                        const orderedCols = isUnrealizedView
                          ? orderedColsAll.filter((c) => c === noteCol || DEFAULT_UNREALIZED_COLS.includes(c))
                          : orderedColsAll.filter((c) => DEFAULT_REALIZED_COLS.includes(c));
                        // MARKER_ZONEC_EXPIRED_DETAIL_CELL_NAV_V1 -- กดลูกศร = เลื่อนเลือก Cell ทีละช่อง
                        // (ไม่ใช่ Scroll หน้าทั้งหน้า) ถ้ากดค้าง Browser จะยิง keydown ซ้ำๆ เอง ทำให้เหมือนเลื่อนรัว
                        // ส่วนถ้าอยากใช้ Scroll ปกติ (เม้าส์/Trackpad) ยังใช้ได้ตามปกติเพราะไม่ได้ปิด overflow
                        // MARKER_ZONEC_EXPIRED_DETAIL_CELL_COPY_V1 -- ตามที่ขอ "ไม่รองรับ Ctrl+C หรอ" /
                        // "ต้องรองรับ Ctrl+C ในทุกกรณี" -- Cell ที่เลือกไว้เป็นแค่ div/td ไฮไลท์ด้วย CSS
                        // ไม่ใช่ Text Selection จริงของ Browser Ctrl+C เปล่าๆ เลยไม่มีอะไรให้ Copy -- ดักเอง
                        // เขียนค่า Cell ที่เลือกลง Clipboard ตรงๆ ลอง navigator.clipboard ก่อน (ทางหลัก) ถ้า
                        // ใช้ไม่ได้ (Browser เก่า/Permission ไม่ให้) Fallback เป็น execCommand("copy") ผ่าน
                        // textarea ชั่วคราว ให้ครอบคลุมทุกกรณีตามที่ขอ
                        const copyTextToClipboard = (text) => {
                          if (navigator.clipboard && navigator.clipboard.writeText) {
                            navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
                          } else {
                            fallbackCopy(text);
                          }
                        };
                        const fallbackCopy = (text) => {
                          try {
                            const ta = document.createElement("textarea");
                            ta.value = text;
                            ta.style.position = "fixed";
                            ta.style.opacity = "0";
                            document.body.appendChild(ta);
                            ta.focus();
                            ta.select();
                            document.execCommand("copy");
                            document.body.removeChild(ta);
                          } catch (err) {
                            // เงียบไว้ -- ไม่ใช่สาระสำคัญถึงขั้นต้องโชว์ Error ให้ผู้ใช้
                          }
                        };
                        const handleDetailKeyDown = (e) => {
                          if ((e.key === "c" || e.key === "C") && (e.ctrlKey || e.metaKey)) {
                            if (selectedDetailCell && hasRows) {
                              const row = buDetailState.rows[selectedDetailCell.row];
                              const col = orderedCols[selectedDetailCell.col];
                              if (row && col) {
                                const val = row[col] === null || row[col] === undefined ? "" : String(row[col]);
                                copyTextToClipboard(val);
                              }
                            }
                            return; // ไม่ preventDefault -- เผื่อผู้ใช้ลาก Select ข้อความเองข้าม Cell ก็ยัง Copy ปกติของ Browser ได้ด้วย
                          }
                          if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
                          if (!hasRows) return;
                          e.preventDefault();
                          setSelectedDetailCell((prev) => {
                            const maxRow = buDetailState.rows.length - 1;
                            const maxCol = orderedCols.length - 1;
                            let row = prev ? prev.row : 0;
                            let col = prev ? prev.col : 0;
                            if (e.key === "ArrowUp") row = Math.max(0, row - 1);
                            else if (e.key === "ArrowDown") row = Math.min(maxRow, row + 1);
                            else if (e.key === "ArrowLeft") col = Math.max(0, col - 1);
                            else if (e.key === "ArrowRight") col = Math.min(maxCol, col + 1);
                            return { row, col };
                          });
                        };
                        return (
                          <>
                            <div style={{ fontSize: "12px", fontWeight: 700, color: "#333", marginBottom: "8px", flexShrink: 0 }}>
                              {buDetailSelection.reason
                                ? `${buDetailSelection.scopedBu ? `${buDetailSelection.scopedBu} — ` : ""}Unrealized Expired — Reason: ${buDetailSelection.reasonLabel}`
                                : <>{buDetailSelection.bu} — {buDetailSelection.bucket === "realized" ? "Realized Expired" : "Unrealized Expired"}</>}
                              {!buDetailState.loading && !buDetailState.error && ` (${buDetailState.rows.length} Invoice)`} — ที่มา: vat_watchlist_report
                            </div>
                            {buDetailState.loading ? (
                              <div style={{ fontSize: "12px", color: "#999" }}>กำลังโหลด...</div>
                            ) : buDetailState.error ? (
                              <div style={{ fontSize: "12px", color: "#b91c1c" }}>{buDetailState.error}</div>
                            ) : buDetailState.rows.length === 0 ? (
                              <div style={{ fontSize: "12px", color: "#999" }}>ไม่มีรายการ Invoice</div>
                            ) : (
                              <div
                                style={{ flex: 1, minHeight: 0, overflow: "auto", outline: "none" }}
                                tabIndex={0}
                                onKeyDown={handleDetailKeyDown}
                              >
                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
                                  <thead>
                                    <tr style={{ background: "#eee" }}>
                                      {orderedCols.map((col) => (
                                        <th
                                          key={col}
                                          style={{
                                            textAlign: "left", padding: "4px 8px", whiteSpace: "nowrap",
                                            position: "sticky", top: 0, zIndex: 1,
                                            background: col === noteCol ? "#fef3c7" : "#eee",
                                            color: col === noteCol ? "#92400e" : "inherit",
                                          }}
                                        >
                                          {col === noteCol ? "Note / Remark" : col}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {buDetailState.rows.map((r, i) => (
                                      <tr key={i}>
                                        {orderedCols.map((col, ci) => {
                                          const isSelCell = selectedDetailCell && selectedDetailCell.row === i && selectedDetailCell.col === ci;
                                          return (
                                            <td
                                              key={col}
                                              ref={(el) => {
                                                if (el) detailCellRefs.current.set(`${i}-${ci}`, el);
                                                else detailCellRefs.current.delete(`${i}-${ci}`);
                                              }}
                                              onClick={() => setSelectedDetailCell({ row: i, col: ci })}
                                              style={{
                                                padding: "4px 8px", whiteSpace: "nowrap", borderBottom: "1px solid #f3f3f3",
                                                background: isSelCell ? "#dbeafe" : (col === noteCol ? "#fffbeb" : "transparent"),
                                                color: col === noteCol ? "#92400e" : "inherit",
                                                fontWeight: col === noteCol ? 600 : 400,
                                                cursor: "cell",
                                                outline: isSelCell ? "2px solid #2563eb" : "none",
                                                outlineOffset: "-1px",
                                              }}
                                            >
                                              {r[col] === null || r[col] === undefined || r[col] === ""
                                                ? "-"
                                                : (/_date$/i.test(col) ? formatDdMmmYy(r[col]) : String(r[col]))}
                                            </td>
                                          );
                                        })}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </>
                        );
                      })()
                    )}
                  </div>
                </div>
              )}

              {/* MARKER_ZONEC_EXPIRED_DETAIL_3MONTH_TREND_V1 -- เอากราฟเทียบ 3 เดือนย้อนหลังออกทั้งหมด
                  ตามที่ขอ ("อะใน หน้า by อ่ะ เอากราฟออกไปเลย") คนละ Feature กับ Zone Detail ด้านบน
                  MARKER_ZONEC_EXPIRED_DETAIL_FOOTER_NOTE_REMOVED_V1 -- เอาข้อความอธิบาย
                  Unrealized/Realized Expired ท้าย Popup ออกตามที่ขอ */}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
