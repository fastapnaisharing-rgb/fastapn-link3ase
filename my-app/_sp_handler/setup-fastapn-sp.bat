@echo off
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-fastapn-sp.ps1" %*
if /i not "%~1"=="-Silent" pause
