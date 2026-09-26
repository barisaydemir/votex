@echo off
REM Tek Setup.exe — kullaniciya sadece DFT_Suite_Setup.exe verilir
cd /d "%~dp0"
echo.
echo  ========================================
echo   DFT Suite — TEK KURULUM PAKETI
echo   Cikti: DFT_Suite_Setup.exe
echo  ========================================
echo.
echo  Bu islem uzun surebilir (tauri build + Inno).
echo.
python modules\dft_packager\build_single_setup.py %*
if errorlevel 1 (
  echo.
  echo [HATA] Setup uretilemedi.
  pause
  exit /b 1
)
echo.
echo  Kullaniciya ver:
echo    modules\dft_packager\dist\DFT_Suite_Setup.exe
echo.
explorer modules\dft_packager\dist
pause
