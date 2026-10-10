FastAPN SharePoint Handler
=========================
ส่งไฟล์รายงานภาษี (Input Reconcile) จาก Link3ase ไปเก็บที่ SharePoint ด้วยปุ่ม Confirm
หลักการ: Browser ดาวน์โหลดไฟล์ -> Handler ย้ายไฟล์จาก Downloads ไปโฟลเดอร์ OneDrive -> OneDrive ซิงก์ขึ้น SharePoint
ไม่ใช้ Token / ไม่ต้องใช้สิทธิ์ Admin

ติดตั้ง (ครั้งเดียวต่อเครื่อง):
1. แตก zip แล้วดับเบิลคลิก setup-fastapn-sp.bat
2. หน้าต่างเลือกโฟลเดอร์จะขึ้น ให้เลือกโฟลเดอร์ Z_Report Reconcile ที่ซิงก์ลงเครื่องแล้ว
   (เช่น D:\\My Data\\OneDrive - Central Group\\VAT Controller\\My System\\Z_Report Reconcile)
3. รอขึ้น "ติดตั้งสำเร็จ!"

ใช้งาน: Link3ase > Input VAT Recon > กด "ส่งไป SharePoint" > ตรวจปลายทาง > Confirm
ไฟล์จะไปที่ <Z_Report Reconcile>\\<รหัส BU>\\<YYYY.MM>\\<ชื่อไฟล์> (สร้างโฟลเดอร์เดือนให้ถ้ายังไม่มี)
ชื่อไฟล์เดิมจะถูกทับ (SharePoint เก็บ Version History ให้)

ข้อกำหนดของ Browser: ต้องปิด "Ask where to save each file" (Chrome/Edge > Settings > Downloads)
ตั้งค่า: %LOCALAPPDATA%\\FastAPN\\sp-config.json  (destRoot = โฟลเดอร์ปลายทาง, downloadsDir = ระบุเองถ้า Downloads ไม่ใช่ค่าเริ่มต้น)
Log: %LOCALAPPDATA%\\FastAPN\\sp-handler.log
