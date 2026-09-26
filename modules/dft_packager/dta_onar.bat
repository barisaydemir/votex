@echo off
REM DTA saha onarimi — VoteX'e dokunmaz
cd /d "%~dp0"
set PY=%~dp0runtime\python312-amd64\python.exe
if not exist "%PY%" (
  echo Gomulu Python yok: runtime\python312-amd64\python.exe
  pause
  exit /b 1
)
echo Derin Tarama Asistan onariliyor (VoteX degismez)...
"%PY%" "%~dp0launcher.py" --silent-setup
echo.
echo Cikis kodu: %ERRORLEVEL%
echo Log: logs\boot.log
pause
