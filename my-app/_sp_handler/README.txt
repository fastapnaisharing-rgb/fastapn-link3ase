FastAPN SharePoint Handler
=========================
ส่งไฟล์รายงานภาษี (Input Reconcile) จาก Link3ase ไปเก็บที่ SharePoint ด้วยปุ่ม Confirm
หลักการ: Browser ดาวน์โหลดไฟล์ -> Handler ย้ายไฟล์จาก Downloads ไปโฟลเดอร์ OneDrive -> OneDrive ซิงก์ขึ้น SharePoint
ไม่ใช้ Token / ไม่ต้องใช้สิทธิ์ Admin

ติดตั้ง (ครั้งเดียวต่อเครื่อง):
1. แตก zip แล้วดับเบิลคลิก setup-fastapn-sp.bat
2. Setup หาโฟลเดอร์ Z_Report Reconcile และ Z_AllSystemUpload จาก OneDrive ในเครื่องให้อัตโนมัติ
   (<OneDrive>\\VAT Controller\\My System\\<ชื่อโฟลเดอร์>) ไม่ต้องเลือกเอง
   - ถ้าไม่พบ Z_Report Reconcile จะเปิดหน้าต่างให้เลือก (ต้องเป็นโฟลเดอร์ชื่อนี้เท่านั้น)
   - ถ้าไม่พบ Z_AllSystemUpload จะข้ามไป (ไม่บังคับ)
3. สคริปต์จะถูกติดตั้งที่ D:\\apps\\fastapn-sp.ps1 (เหมือน Outlook Handler)
4. รอขึ้น "ติดตั้งสำเร็จ!"

ใช้งาน: Link3ase > Input VAT Recon > กด "ส่งไป SharePoint" > ตรวจปลายทาง > Confirm
ไฟล์จะไปที่ <Z_Report Reconcile>\\<รหัส BU>\\<YYYY.MM>\\<ชื่อไฟล์> (สร้างโฟลเดอร์เดือนให้ถ้ายังไม่มี)
ชื่อไฟล์เดิมจะถูกทับ (SharePoint เก็บ Version History ให้)

ข้อกำหนดของ Browser: ต้องปิด "Ask where to save each file" (Chrome/Edge > Settings > Downloads)
ตั้งค่า: D:\\apps\\fastapn-sp-config.json  (dests = โฟลเดอร์ปลายทางแต่ละชนิด recon / upload, downloadsDir = ระบุเองถ้า Downloads ไม่ใช่ค่าเริ่มต้น)
Log: D:\\apps\\fastapn-sp.log
