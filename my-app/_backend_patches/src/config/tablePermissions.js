/**
 * Mapping สิทธิ์ของแต่ละตาราง โดยอ้างอิงจาก RLS policy เดิมที่เคยอยู่บน Supabase
 * (ดูได้จากไฟล์ dump ตอน restore เช่น "Allow public read", "Allow write for admin" ฯลฯ)
 *
 * รูปแบบ:
 *   read.publicRead = true  -> ใครก็ตามที่ login ผ่าน (มี JWT ถูกต้อง) อ่านได้หมด
 *   read.roles / write.roles = [...]  -> ต้องมี appRole อยู่ใน list นี้เท่านั้นถึงทำ action นั้นได้
 *
 * เพิ่มตารางอื่นที่ frontend ยังเรียกใช้อยู่ตามรูปแบบเดียวกันนี้ได้เลย
 * ถ้าตารางไหนไม่มีอยู่ใน config นี้ genericTable router จะปฏิเสธ request ทันที (fail-safe)
 */
export const tablePermissions = {
  account_list: {
    read: { publicRead: true },
    write: { roles: ["Admin", "Owner", "Editor", "admin", "owner", "editor"] }, // MARKER_MASTERDATA_ADD_EDITOR_WRITE_V1
  },
  branch_list: {
    read: { publicRead: true },
    // MARKER_MASTERDATA_RESTRICT_VIEWER_WRITE_V1 -- กัน Viewer เขียนได้ เหลือ Owner/Admin/Editor เท่านั้น
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  // MARKER_TABLEPERMISSIONS_COMPANY_LIST_UNLOCK -- ปลดล็อกทั้งตาราง
  // เพื่อให้ใครก็แก้ company_list.ap_to_fp (To/Cc Feature Email) ได้
  company_list: {
    read: { publicRead: true },
    // MARKER_MASTERDATA_RESTRICT_VIEWER_WRITE_V1 -- กัน Viewer เขียนได้ เหลือ Owner/Admin/Editor เท่านั้น
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  cpc_list: {
    read: { publicRead: true },
    write: { roles: ["Admin", "Owner", "Editor", "admin", "owner", "editor"] }, // MARKER_MASTERDATA_ADD_EDITOR_WRITE_V1
  },
  itemcode_list: {
    read: { publicRead: true },
    write: { roles: ["Admin", "Owner", "Editor", "admin", "owner", "editor"] }, // MARKER_MASTERDATA_ADD_EDITOR_WRITE_V1
  },
  supplier_list: {
    read: { publicRead: true },
    write: { roles: ["Admin", "Owner", "Editor", "admin", "owner", "editor"] }, // MARKER_MASTERDATA_ADD_EDITOR_WRITE_V1
  },
  notice_list: {
    read: { publicRead: true },
    write: { roles: ["Admin", "Owner", "admin", "owner"] },
  },
  sub_acc_list: {
    // เดิม policy คือ "Allow select/insert/update/delete for authenticated users"
    // คือ login แล้วทำได้หมด ไม่ได้แยกตาม role เฉพาะ
    read: { publicRead: true },
    // MARKER_MASTERDATA_RESTRICT_VIEWER_WRITE_V1 -- กัน Viewer เขียนได้ เหลือ Owner/Admin/Editor เท่านั้น
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  contract_list: {
    // เดิม policy คือ allow_read_contract (authenticated) / allow_write_contract (Owner, Admin, Editor)
    read: { publicRead: true },
    write: { roles: ["Owner", "Admin", "Editor"] },
  },
  vendor_category: {
    read: { publicRead: true },
    write: { roles: ["Admin", "Owner", "Editor", "admin", "owner", "editor"] }, // MARKER_MASTERDATA_ADD_EDITOR_WRITE_V1
  },
  sm_code_list: {
    read: { publicRead: true },
    write: { publicRead: true },
  },
  ie_code_list: {
  // เดิม policy เปิดกว้างให้ authenticated ทุกคน insert/select/delete ได้ (เหมือน sub_acc_list)
  read: { publicRead: true },
    // MARKER_MASTERDATA_RESTRICT_VIEWER_WRITE_V1 -- กัน Viewer เขียนได้ เหลือ Owner/Admin/Editor เท่านั้น
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  recycle_bin: {
    // sensitive กว่าตารางอื่น จำกัดแค่ Admin/Owner (ตรงกับที่ UI ให้แค่ isAdmin เห็นปุ่มลบ)
    read: { publicRead: true },
    // MARKER_MASTERDATA_RESTRICT_VIEWER_WRITE_V1 -- กัน Viewer เขียนได้ เหลือ Owner/Admin/Editor เท่านั้น
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  user_roles: {
    // MARKER_TABLEPERMISSIONS_USERROLES_SELFSERVICE_V1
    // ── เปิดให้ Admin/Editor ผ่าน Middleware ชั้นนี้ได้ (เพื่อแก้ Username ──────
    // ── ตัวเอง) -- แก้ Role ของคนอื่น/ตัวเองยังถูกกันอีกชั้นที่ genericTable.js ──
    // ── (เช็ค Column ต้องเป็น username เท่านั้น + ต้องเป็นแถวตัวเอง) ───────────
    read: { publicRead: true },
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  // MARKER_TABLEPERMISSIONS_TAX_CLOSE_V1 -- Timeline ปิดภาษี
  tax_close_period: {
    read: { publicRead: true },
    write: { roles: ["Owner", "owner"] }, // ตารางวงจรรอบ/Purge: Backend จัดการเอง จำกัด Owner กันแก้ purge_after/status
  },
  tax_close_bu_master: {
    read: { publicRead: true },
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  tax_close_period_bu: {
    read: { publicRead: true },
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  tax_close_task: {
    read: { publicRead: true },
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  tax_close_task_log: {
    read: { publicRead: true },
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  tax_close_task_item: {
    read: { publicRead: true },
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  tax_close_bu_config: {
    read: { publicRead: true },
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  // MARKER_TABLEPERMISSIONS_TIMELINE_WATCH_V1 -- Timeline ปิดภาษี > Config BU > ดู Progress
  timeline_watch: {
    read: { publicRead: true },
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  // MARKER_TABLEPERMISSIONS_TIMELINE_PROGRESS_V1 -- Timeline ปิดภาษี: ความคืบหน้าต่อ Period + BU
  timeline_progress: {
    read: { publicRead: true },
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  system_settings: {
    read: { publicRead: true },
    write: { roles: ["Owner", "owner"] },
  },
  Vendor_rule: {
    read: { publicRead: true },
    // MARKER_MASTERDATA_RESTRICT_VIEWER_WRITE_V1 -- กัน Viewer เขียนได้ เหลือ Owner/Admin/Editor เท่านั้น
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  access_requests: {
    read: { publicRead: true },
    write: { publicRead: true },
  },
  batch_list: {
    read: { publicRead: true },
    write: { publicRead: true },
  },
  // MARKER_TABLEPERMISSIONS_ITEM_DESCRIPTION_FAVORITES_V1
  item_description_favorites: {
    read: { publicRead: true },
    write: { publicRead: true },
  },
  bucket_list: {
    read: { publicRead: true },
    write: { publicRead: true },
  },
  doc_access_override: {
    read: { roles: ["Admin", "Owner", "admin", "owner"] },
    write: { roles: ["Admin", "Owner", "admin", "owner"] },
  },
  // MARKER_TABLEPERMISSIONS_MENU_ACCESS_OVERRIDE_V1
  menu_access_override: {
    read: { roles: ["Admin", "Owner", "admin", "owner"] },
    write: { roles: ["Admin", "Owner", "admin", "owner"] },
  },
  activity_log: {
    read: { publicRead: true },
    write: { publicRead: true },
  },
  ap_active_sessions: {
    read: { publicRead: true },
    write: { publicRead: true },
  },
  // MARKER_TABLEPERMISSIONS_IE_ACTIVE_SESSIONS_V1 -- แก้ Heartbeat 404 (ตกหล่นมาตั้งแต่ต้น ทั้งที่ ap_active_sessions/menu_active_sessions มีอยู่แล้ว)
  ie_active_sessions: {
    read: { publicRead: true },
    write: { publicRead: true },
  },
  menu_active_sessions: {
    read: { publicRead: true },
    write: { publicRead: true },
  },
  doc_files: {
    read: { publicRead: true },
    write: { publicRead: true },
  },
  notifications: {
    read: { publicRead: true },
    write: { publicRead: true },
  },
  batch_notifications: {
    read: { publicRead: true },
    write: { publicRead: true },
  },
  doc_collection: {
    read: { publicRead: true },
    write: { publicRead: true },
  },
  imp_supplier_list: {
    read: { publicRead: true },
    write: { publicRead: true },
  },
  // MARKER_TABLEPERMISSIONS_EMAIL_TEMPLATES_OWNERONLY
  email_templates: {
    // Read เปิดให้ทุกคน (ต้องเห็น Preview ได้) -- Write จำกัด Owner เท่านั้น
    read: { publicRead: true },
    write: { roles: ["Owner", "owner"] },
  },
  // MARKER_ACCOUNT_CPC_RULES_PERMISSION_V1 -- Config Account/CPC/SubAcc (Double-Click ที่ Account)
  account_cpc_rules: {
    read: { publicRead: true },
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  // MARKER_TABLEPERMISSIONS_SUPPORT_THREADS_V1 -- Frontend Query severity/log_number/status
  // ตรงๆ ผ่าน db.from('support_threads') (Homepage.js) เหมือน notifications/batch_notifications
  support_threads: {
    read: { publicRead: true },
    write: { publicRead: true },
  },
  // MARKER_TABLEPERMISSIONS_SUPPORT_THREAD_SHARES_V1 -- Homepage.js Query หา Thread ที่ถูก Share มาให้ตัวเอง
  // (ผ่าน db.from('support_thread_shares')) -- Insert/Delete จริงคุมที่ support.js อยู่แล้ว
  support_thread_shares: {
    read: { publicRead: true },
    write: { publicRead: true },
  },
  // MARKER_TABLEPERMISSIONS_VAT_WATCHLIST_REPORT_V1
  vat_watchlist_report: {
    read: { publicRead: true },
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  // MARKER_TABLEPERMISSIONS_VAT_WATCHLIST_BU_GROUP_RANGE_V1
  vat_watchlist_bu_group_range: {
    read: { publicRead: true },
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  // MARKER_TABLEPERMISSIONS_VAT_WATCHLIST_RELATED_PERSON_V1
  vat_watchlist_related_person: {
    read: { publicRead: true },
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  // MARKER_TABLEPERMISSIONS_VAT_MAIL_CONFIG_V1
  vat_mail_config: {
    read: { publicRead: true },
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  // MARKER_TABLEPERMISSIONS_VAT_MAIL_DRAFT_V1
  vat_mail_draft: {
    read: { publicRead: true },
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  // MARKER_TABLEPERMISSIONS_VAT_WATCHLIST_NOTES_V1
  vat_watchlist_notes: {
    read: { publicRead: true },
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  // MARKER_TABLEPERMISSIONS_VAT_UPLOAD_POPVATDRAFT_V1
  vat_upload_popvatdraft: {
    read: { publicRead: true },
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  // MARKER_TABLEPERMISSIONS_VAT_BACKUP_TAX_INVOICE_V1
  vat_backup_tax_invoice: {
    read: { publicRead: true },
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  // MARKER_TABLEPERMISSIONS_VAT_SIMPLEINPUT_ADI_DRAFT_V1 -- Simple Input / ADI Journal Draft (Full Page - Popvat Add Data)
  vat_simpleinputdraft: {
    read: { publicRead: true },
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  vat_adi_transferdraft: {
    read: { publicRead: true },
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  // MARKER_TABLEPERMISSIONS_IE_SIMPLEVATDRAFT_V1 -- IE Invoice/Simple Tab (Sub-row Real Vendor Add -> Simple)
  ie_simplevatdraft: {
    read: { publicRead: true },
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  // MARKER_TABLEPERMISSIONS_VAT_INCOMPLETE_EXPORT_TEMPLATES_V1
  vat_incomplete_export_templates: {
    read: { publicRead: true },
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  // MARKER_TABLEPERMISSIONS_VAT_INCOMPLETE_COLUMN_CONFIG_V1
  vat_incomplete_column_config: {
    read: { publicRead: true },
    write: { publicRead: true },
  },
  // MARKER_TABLEPERMISSIONS_VAT_WATCHLIST_ROUND_STATE_V1 -- Round-based Active BU Update Tracking (Donut + Confirm ปิดรอบ)
  vat_watchlist_round_state: {
    read: { publicRead: true },
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  // MARKER_TABLEPERMISSIONS_VAT_RECONCILE_INPUT_SUMMARY_V1 -- VAT Input Rec. Dashboard > Quick Preview Popup > Inline Edit (Excel Grid)
  vat_reconcile_input_summary: {
    read: { publicRead: true },
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  // MARKER_TABLEPERMISSIONS_VAT_WAITING_FOR_CLAIM_V1 -- VAT Controller > Backup > Transaction, Tab 4 (Backup_Report Input Tax-Waiting for Claim)
  vat_waiting_for_claim: {
    read: { publicRead: true },
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  // MARKER_TABLEPERMISSIONS_VAT_SUMMARY_DASHBOARD_V1 -- VAT Watchlist Dashboard (vat_summary_schema.sql)
  vat_summary_live: {
    read: { publicRead: true },
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  vat_summary_live_dashboard: {
    read: { publicRead: true },
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] }, // VIEW — ไม่มีใคร Write ตรงๆ ใส่ไว้กัน Error เฉยๆ
  },
  vat_summary_frozen: {
    read: { publicRead: true },
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] },
  },
  vat_summary_frozen_dashboard: {
    read: { publicRead: true },
    write: { roles: ["Owner", "Admin", "Editor", "owner", "admin", "editor"] }, // VIEW — ไม่มีใคร Write ตรงๆ ใส่ไว้กัน Error เฉยๆ
  },
};