@echo off
chcp 65001 >nul
title DTA — Temiz Baslat (ElitePad)
cd /d "%~dp0"

echo [DTA] Eski python surecleri kapatiliyor...
taskkill /F /IM python.exe /T >nul 2>&1
taskkill /F /IM pythonw.exe /T >nul 2>&1
timeout /t 1 /nobreak >nul

if not exist ".venv_jarvis\Scripts\python.exe" (
    echo [HATA] .venv_jarvis yok. Once baslat.bat ile kurulum yapin.
    pause
    exit /b 1
)

echo [DTA] Lite tablet modu ile basliyor (dusuk GPU / SFX kapali)...
echo.
".venv_jarvis\Scripts\python.exe" -u main.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Program hata ile cikti. Kod: %ERRORLEVEL%
    pause
)
