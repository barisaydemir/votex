@echo off
cd /d "%~dp0"
echo Derin Tarama Asistan tablet paketi hazirlaniyor...
.venv_jarvis\Scripts\python tools\build_tablet_package.py
if %ERRORLEVEL% NEQ 0 (
    py -3 tools\build_tablet_package.py
)
echo.
echo Hazir: dist\Derin_Tarama_Asistan_Tablet.zip
pause
