@echo off
title VOTEX Patch — Hizli Guncelleme
echo.
echo  =============================================
echo   VOTEX HIZLI GUNCELLEME (PATCH)
echo  =============================================
echo.
echo  Frontend degisiklikleri ~1.5s'de derlenir.
echo  Rust degismediyse toplam ~30 sn surer.
echo.

cd /d "%~dp0"

REM Mevcut versiyonu oku ve patch no'sunu artir
for /f "tokens=2 delims=:" %%a in ('findstr /C:"version" src-tauri\tauri.conf.json') do (
    set "RAWVER=%%a"
)
set RAWVER=%RAWVER: =%
set RAWVER=%RAWVER:"=%
set RAWVER=%RAWVER:,=%
echo  Mevcut versiyon: %RAWVER%

REM Versiyonu 0.1.X formatinda artir (son sayiyi +1)
for /f "tokens=1,2,3 delims=." %%a in ("%RAWVER%") do (
    set "MAJOR=%%a"
    set "MINOR=%%b"
    set /a "PATCH=%%c + 1"
)
set "NEWVER=%MAJOR%.%MINOR%.%PATCH%"
echo  Yeni versiyon:   %NEWVER%
echo.

REM tauri.conf.json'daki versiyonu guncelle (PowerShell ile)
powershell -Command "(Get-Content 'src-tauri/tauri.conf.json') -replace '\"version\": \"%RAWVER%\"', '\"version\": \"%NEWVER%\"' | Set-Content 'src-tauri/tauri.conf.json'"
echo  Versiyon guncellendi: %NEWVER%
echo.

REM [1/2] Frontend uretim derlemesi
echo [1/2] Frontend uretim derlemesi...
call npx vite build
if errorlevel 1 (
  echo [HATA] vite build basarisiz!
  pause
  exit /b 1
)
echo      Tamamlandi.
echo.

REM [2/2] Tauri release build
echo [2/2] Tauri release derleme (Rust degismediyse ~30s)...
call npx tauri build --bundles nsis
if errorlevel 1 (
  echo [HATA] tauri build basarisiz!
  pause
  exit /b 1
)

echo.
echo  =============================================
echo   PATCH HAZIR: v%NEWVER%
echo  =============================================
echo.
echo  Installer: target\release\bundle\nsis\Votex_%NEWVER%_x64-setup.exe
echo.
pause
