@echo off
REM run_purge_recon_inputs.bat -- เรียกฟังก์ชัน purge_expired_recon_inputs(false) ใน DB (ล้าง Input ที่ Confirm แล้วและครบ 60 วัน, ไม่แตะ TB)
REM วางไฟล์นี้บนเครื่อง Server เช่น D:\fastapn-backend\run_purge_recon_inputs.bat แล้วตั้ง Task Scheduler ให้รันทุกวัน 02:00
REM แก้ 3 ค่าด้านล่างให้ตรงกับเครื่อง

set PGPASSWORD=PUT_DB_PASSWORD_HERE
set PSQL="D:\PostgreSQL\17\bin\psql.exe"
set LOGFILE=D:\fastapn-backend\purge_recon_inputs.log

echo ===== %date% %time% ===== >> %LOGFILE%
%PSQL% -h localhost -p 5432 -U postgres -d fastapn-link3ase -c "SELECT * FROM purge_expired_recon_inputs(false);" >> %LOGFILE% 2>&1
