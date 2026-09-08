@echo off
REM VOTEX — CMD penceresi gostermeden baslat (start.vbs).
REM Cift tik: bu bat aninda VBS'e devreder ve kapanir.
cd /d "%~dp0"

if /I "%~1"=="--console" goto :console

REM Eski takili surecleri temizle
taskkill /F /IM "votex.exe" 2>nul
timeout /t 1 /nobreak >nul

start "" /B wscript //nologo "%~dp0start.vbs"
exit /b 0

:console
REM Eski gelistirme: gorunur konsol (debug)
echo.
echo  VOTEX - Manyetik Anomali Analiz (konsol modu)
echo  =============================================
echo.

taskkill /F /IM "votex.exe" 2>nul
timeout /t 1 /nobreak >nul

where node >nul 2>&1
if errorlevel 1 (
  echo [HATA] Node.js bulunamadi. https://nodejs.org
  pause
  exit /b 1
)
where cargo >nul 2>&1
if errorlevel 1 (
  echo [HATA] Rust/Cargo bulunamadi. https://rustup.rs
  pause
  exit /b 1
)
if not exist "node_modules\" (
  echo [1/2] Bagimliliklar yukleniyor...
  call npm install
  if errorlevel 1 ( echo [HATA] npm install & pause & exit /b 1 )
) else (
  echo [1/2] node_modules mevcut.
)
echo [2/2] npm run tauri dev
call npm run tauri dev
if errorlevel 1 ( echo [HATA] & pause )
exit /b %ERRORLEVEL%
