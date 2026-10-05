-- Draft ใหม่: ติดตาม by Supplier (To Supplier) -- รันซ้ำได้ (ไม่สร้างซ้ำถ้ามีชื่อนี้แล้ว)
-- ตัวแปร: {BU} {เดือนเริ่ม} {เดือนสุดท้าย} {ชื่อผู้รับ} {Supplier Name} {BU_LIST}
INSERT INTO vat_mail_draft (draft_name, send_type, subject_template, body_template)
SELECT 'ติดตาม by Supplier', 'SUPPLIER',
 '{BU} - ขอติดตามใบกำกับภาษี ของรายการที่ตัดชำระตั้งแต่เดือน {เดือนเริ่ม} ถึง {เดือนสุดท้าย}',
 E'เรียน {ชื่อผู้รับ}\n\n    รบกวนขอติดตามใบกำกับภาษีของ {Supplier Name} จากรายชื่อที่ทำจ่ายดังนี้\n\n{BU_LIST}'
WHERE NOT EXISTS (SELECT 1 FROM vat_mail_draft WHERE draft_name = 'ติดตาม by Supplier');
