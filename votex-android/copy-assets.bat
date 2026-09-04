@echo off
REM Copy PWA files to Android assets folder
REM Run this before building the APK

set SCRIPT_DIR=%~dp0
set PWA_DIR=%SCRIPT_DIR%..\votex-mobile
set ASSETS_DIR=%SCRIPT_DIR%app\src\main\assets

echo Copying PWA files to Android assets...

REM Clean assets
if exist "%ASSETS_DIR%" rmdir /s /q "%ASSETS_DIR%"
mkdir "%ASSETS_DIR%\css"
mkdir "%ASSETS_DIR%\js"
mkdir "%ASSETS_DIR%\icons"
mkdir "%ASSETS_DIR%\wasm"

REM Copy core files
copy "%PWA_DIR%\index.html" "%ASSETS_DIR%\"
copy "%PWA_DIR%\manifest.json" "%ASSETS_DIR%\"
copy "%PWA_DIR%\sw.js" "%ASSETS_DIR%\"

REM Copy CSS
copy "%PWA_DIR%\css\style.css" "%ASSETS_DIR%\css\"

REM Copy JS
copy "%PWA_DIR%\js\*.js" "%ASSETS_DIR%\js\"

REM Copy WASM analysis core
copy "%PWA_DIR%\wasm\votex_wasm.js" "%ASSETS_DIR%\wasm\" 2>nul
copy "%PWA_DIR%\wasm\votex_wasm_bg.wasm" "%ASSETS_DIR%\wasm\" 2>nul

REM Copy icons
copy "%PWA_DIR%\icons\icon.svg" "%ASSETS_DIR%\icons\" 2>nul
copy "%PWA_DIR%\icons\icon-192.png" "%ASSETS_DIR%\icons\" 2>nul
copy "%PWA_DIR%\icons\icon-512.png" "%ASSETS_DIR%\icons\" 2>nul

echo Done! Assets copied to: %ASSETS_DIR%
dir "%ASSETS_DIR%"
pause