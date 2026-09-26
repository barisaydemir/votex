@echo off
chcp 65001 >nul
title VOTEX — Live Console Debugger
echo ========================================================
echo   VOTEX CANLI KONSOL MODU (CANLI HATA VE LOGLAR)
echo   Digital Future Tech
echo ========================================================
echo.

cd /d "%~dp0"

echo [BILGI] Arka plandaki eski surecler temizleniyor...
taskkill /F /IM "votex.exe" 2>nul
taskkill /F /IM "votex-3d-visualizer.exe" 2>nul
timeout /t 1 /nobreak >nul

where node >nul 2>&1
if errorlevel 1 (
  echo [HATA] Node.js bulunamadi! Lutfen Node.js kurun: https://nodejs.org
  pause
  exit /b 1
)

where cargo >nul 2>&1
if errorlevel 1 (
  echo [HATA] Rust/Cargo bulunamadi! Lutfen Rust kurun: https://rustup.rs
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [BILGI] Ilk kurulum yapiliyor (npm install)...
  call npm install
  if errorlevel 1 (
    echo [HATA] npm install basarisiz oldu!
    pause
    exit /b 1
  )
)

echo [BILGI] VOTEX uygulamasi acik konsol modunda baslatiliyor...
echo [BILGI] Nerede takildigini ve tum hatalari bu pencereden canli izleyebilirsiniz.
echo.

set CARGO_TARGET_DIR=
set CARGO_BUILD_TARGET_DIR=

call npm run tauri dev

if errorlevel 1 (
  echo.
  echo ========================================================
  echo [HATA DETAYI] VOTEX bir hata ile kapandi veya takildi!
  echo ========================================================
  echo.
  pause
)

pause
