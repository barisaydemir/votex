@echo off
chcp 65001 >nul
title Votex 3D Spatial ^& Anomaly Visualizer
echo ========================================================
echo   VOTEX 3D SPATIAL ^& ANOMALY VISUALIZER (Tauri + Rust)
echo   Digital Future Tech
echo ========================================================
echo.

echo [BILGI] Eski acik Votex 3D surecleri temizleniyor...
taskkill /F /IM "votex-3d-visualizer.exe" 2>nul
timeout /t 1 /nobreak >nul

cd /d "%~dp0votex-3d-visualizer"

if not exist node_modules (
    echo [BILGI] Ilk kurulum yapiliyor (npm install)...
    call npm install
)

echo [BILGI] 3D Visualizer uygulamasi baslatiliyor (Port 1444)...
call npm run tauri dev

pause
