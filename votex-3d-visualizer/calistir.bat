@echo off
chcp 65001 >nul
title Votex 3D Spatial & Anomaly Visualizer
echo [BILGI] 3D Visualizer baslatiliyor...
cd /d "%~dp0"
call npm run tauri dev
pause
