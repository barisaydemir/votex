@echo off
title VOTEX — Hizli Baslatma
cd /d "%~dp0"

REM Release binary var mi kontrol et
if exist "target\release\votex.exe" (
    echo  VOTEX hizli baslatiliyor (release binary)...
    start "" "target\release\votex.exe"
) else (
    echo  Release binary bulunamadi. Dev mod baslatiliyor...
    npx tauri dev
)
