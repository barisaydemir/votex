@echo off
REM İnce sarmalayıcı — asıl açılış launcher.py (Tk splash)
cd /d "%~dp0"

where pyw >nul 2>&1
if %ERRORLEVEL%==0 (
  start "" /B pyw -3.12 "%~dp0launcher.py" 2>nul
  if errorlevel 1 start "" /B pyw "%~dp0launcher.py"
  exit /b 0
)

where pythonw >nul 2>&1
if %ERRORLEVEL%==0 (
  start "" /B pythonw "%~dp0launcher.py"
  exit /b 0
)

REM Fallback: venv pythonw
if exist "%~dp0.venv_jarvis\Scripts\pythonw.exe" (
  start "" /B "%~dp0.venv_jarvis\Scripts\pythonw.exe" "%~dp0launcher.py"
  exit /b 0
)

REM Son çare: konsollu python (sadece host yoksa)
py -3.12 "%~dp0launcher.py" 2>nul
if errorlevel 1 py "%~dp0launcher.py" 2>nul
if errorlevel 1 python "%~dp0launcher.py"
