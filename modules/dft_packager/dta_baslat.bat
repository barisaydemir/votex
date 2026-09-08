@echo off
REM DTA acilis — yalnizca gomulu Python + launcher (sistem Python yok)
cd /d "%~dp0"
set PYW=%~dp0runtime\python312-amd64\pythonw.exe
set PY=%~dp0runtime\python312-amd64\python.exe
if exist "%PY%" (
  start "" /B "%PY%" "%~dp0launcher.py"
  exit /b 0
)
if exist "%PYW%" (
  start "" /B "%PYW%" "%~dp0launcher.py"
  exit /b 0
)
echo Gomulu Python yok. DTA_ONAR.bat calistirin.
pause
exit /b 1
