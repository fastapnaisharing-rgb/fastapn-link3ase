@echo off
chcp 65001 >nul
setlocal

REM ===== fill in once: same URL as the old "git pull" line in the old deploy.bat =====
set "GITEA_PULL_URL=PASTE_THE_SAME_URL_AS_YOUR_OLD_GIT_PULL_LINE"
REM ====================================================================================

set "SRC=D:\fastapn-link3ase\my-app"
set "LIVE=D:\fastapn\build"

D:
cd /d "%SRC%" || (echo [FAIL] cannot cd to source folder & exit /b 1)
git config --global --add safe.directory D:/fastapn-link3ase

echo [1] git reset and pull...
git reset --hard
git pull "%GITEA_PULL_URL%" main
if errorlevel 1 (echo [FAIL] git pull failed - live site untouched & exit /b 1)

echo [2] removing old build - source folder only...
if exist "%SRC%\build" rd /s /q "%SRC%\build"

echo [3] npm build...
set NODE_OPTIONS=--max-old-space-size=8192
set GENERATE_SOURCEMAP=false
call npm run build
if errorlevel 1 (echo [FAIL] npm build failed - live site untouched & exit /b 1)

echo [4] verify build output...
if not exist "%SRC%\build\index.html" (echo [FAIL] build index.html missing - live site untouched & exit /b 1)
if not exist "%SRC%\build\static\js\main.*.js" (echo [FAIL] build static main js missing - live site untouched & exit /b 1)

echo [5] copy to live site...
robocopy "%SRC%\build" "%LIVE%" /MIR /NFL /NDL /NJH /NJS /NP
if errorlevel 8 (echo [FAIL] robocopy failed & exit /b 1)

echo [6] iisreset...
iisreset /restart

echo [7] done!
exit /b 0
