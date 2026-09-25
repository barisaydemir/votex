#!/usr/bin/env python3
"""ELIC Asistan tablette kurulacak tek paketi olusturur (gomulu Python 3.12 dahil)."""

from __future__ import annotations

import argparse
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
PKG = DIST / "Derin_Tarama_Asistan_Tablet"
ZIP_PATH = DIST / "Derin_Tarama_Asistan_Tablet.zip"

COPY_FILES = (
    "app_config.py",
    "main.py",
    "ui.py",
    "requirements.txt",
)

COPY_DIRS = (
    "actions",
    "core",
)

MEMORY_FILES = (
    "memory/memory_manager.py",
    "memory/memory.example.json",
    "memory/survey_session.example.json",
    "memory/phone_book.example.json",
)

TEST_FILES = (
    "tests/run_field_test.py",
    "tests/sample_elic_screen.png",
    "tests/ELIC_SAHA_TEST.md",
)

CONFIG_FILES = (
    "config/api_keys.example.json",
    "config/license_policy.json",
)

# Ortak: paket ici Python sec (amd64 / win32)
_FIND_PY = r"""set "PYEXE="
if /I "%PROCESSOR_ARCHITECTURE%"=="AMD64" (
  if exist "runtime\python312-amd64\python.exe" set "PYEXE=runtime\python312-amd64\python.exe"
)
if /I "%PROCESSOR_ARCHITEW6432%"=="AMD64" (
  if exist "runtime\python312-amd64\python.exe" set "PYEXE=runtime\python312-amd64\python.exe"
)
if not defined PYEXE (
  if exist "runtime\python312-win32\python.exe" set "PYEXE=runtime\python312-win32\python.exe"
)
if not defined PYEXE (
  if exist "runtime\python312-amd64\python.exe" set "PYEXE=runtime\python312-amd64\python.exe"
)
if not defined PYEXE (
  if exist ".venv_jarvis\Scripts\python.exe" set "PYEXE=.venv_jarvis\Scripts\python.exe"
)
"""

BASLAT_BAT = r"""@echo off
cd /d "%~dp0"
title Derin Tarama Asistan
""" + _FIND_PY + r"""
if not defined PYEXE (
  echo [HATA] Gomulu Python yok. Once ILK_KURULUM.bat calistirin.
  pause
  exit /b 1
)
if not exist "config\api_keys.json" (
  echo [HATA] config\api_keys.json eksik. ILK_KURULUM.bat calistirin.
  pause
  exit /b 1
)
echo Derin Tarama Asistan baslatiliyor...
echo Python: %PYEXE%
echo (Kum saati uzun surerse logs\boot.log dosyasina bakin)
"%PYEXE%" -u main.py
if %ERRORLEVEL% NEQ 0 pause
"""

TEMIZ_BASLAT_BAT = r"""@echo off
cd /d "%~dp0"
title DTA Temiz Baslat
echo Eski python kapatiliyor...
taskkill /F /IM python.exe /T >nul 2>&1
taskkill /F /IM pythonw.exe /T >nul 2>&1
timeout /t 1 /nobreak >nul
""" + _FIND_PY + r"""
if not defined PYEXE (
  echo [HATA] Gomulu Python yok. Once ILK_KURULUM.bat calistirin.
  pause
  exit /b 1
)
echo DTA basliyor...
echo Python: %PYEXE%
"%PYEXE%" -u main.py
if %ERRORLEVEL% NEQ 0 pause
"""

ILK_KURULUM_BAT = r"""@echo off
cd /d "%~dp0"
title Derin Tarama Asistan - Ilk Kurulum
echo ============================================
echo   DERIN TARAMA ASISTAN - TABLET ILK KURULUM
echo ============================================
echo.
echo Bu paket icinde Python 3.12 gomuludur — sistem Python gerekmez.
echo.

""" + _FIND_PY + r"""
if not defined PYEXE (
  echo [HATA] runtime\python312-* bulunamadi.
  echo Paketi yeniden kopyalayin ^(runtime klasoru eksik^).
  pause
  exit /b 1
)

echo [1/3] Python: %PYEXE%
"%PYEXE%" -c "import sys; print(sys.version)"

echo [2/3] pip / kutuphaneler...
"%PYEXE%" -c "import pip" 1>nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  for %%D in ("%~dp0runtime\python312-amd64" "%~dp0runtime\python312-win32") do (
    if exist "%%~D\get-pip.py" if exist "%%~D\python.exe" (
      echo pip kuruluyor: %%~D
      "%%~D\python.exe" "%%~D\get-pip.py" --no-warn-script-location
    )
  )
)

"%PYEXE%" -m pip install --upgrade pip
if exist "wheels" (
  echo Yerel wheels klasorunden kuruluyor...
  "%PYEXE%" -m pip install --no-index --find-links=wheels -r requirements.txt
  if %ERRORLEVEL% NEQ 0 (
    echo Yerel kurulum eksik — internetten deneniyor...
    "%PYEXE%" -m pip install -r requirements.txt
  )
) else (
  "%PYEXE%" -m pip install -r requirements.txt
)
if %ERRORLEVEL% NEQ 0 (
  echo [HATA] Kutuphane kurulumunda sorun oldu.
  pause
  exit /b 1
)

if not exist "config\api_keys.json" (
  echo [3/3] API ayar dosyasi olusturuluyor...
  if not exist "config" mkdir config
  copy /Y "config\api_keys.example.json" "config\api_keys.json" >nul
  echo.
  echo config\api_keys.json dosyasina Gemini API anahtarinizi yazin.
) else (
  echo [OK] config\api_keys.json mevcut.
)

echo.
echo Kurulum tamam. Sisteme Python kurmaniza GEREK YOK.
echo Proton ELIC acikken BASLAT.bat calistirin.
echo.
pause
"""

OKU_BENI = """DERIN TARAMA ASISTAN (DTA) — TABLET PAKETI
================================

Bu pakette Python 3.12 GOMMULUDUR (runtime\\python312-amd64 ve/veya win32).
Tablete ayrica Python kurmaniza GEREK YOK.

1) Klasoru USB ile tablete kopyalayin (runtime klasoru dahil)
2) ILK_KURULUM.bat   (bir kez — kutuphaneleri kurar)
3) config/api_keys.json icine Gemini API anahtari
4) Proton ELIC acik
5) BASLAT.bat veya TEMIZ-BASLAT.bat

Notlar:
- ElitePad 32-bit Win10 ise runtime\\python312-win32 kullanilir
- 64-bit ise runtime\\python312-amd64
- Internet yoksa: gelistirici makinede wheels/ olusturun
  python tools/download_wheels.py

Sorun:
  logs\\boot.log
  logs\\vision.log
  TEMIZ-BASLAT.bat

Uretici:
Bu yazilim Baris Aydemir — Digital Future Tech uretimidir.

Dosyalar:
  BASLAT.bat          Uygulamayi acar
  ILK_KURULUM.bat     pip + kutuphaneler (gomulu Python ile)
  TEMIZ-BASLAT.bat    Temiz acilis
  runtime\\            Python 3.12 (gomulu)
  config\\             API, lisans
  actions\\ core\\      Program
"""


def _copy_file(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def _copy_tree(src: Path, dst: Path) -> None:
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(
        src,
        dst,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".git"),
    )


def build_package(*, with_python: bool = True, force_python: bool = False) -> Path:
    if PKG.exists():
        shutil.rmtree(PKG)
    PKG.mkdir(parents=True)

    for name in COPY_FILES:
        _copy_file(ROOT / name, PKG / name)

    for name in COPY_DIRS:
        _copy_tree(ROOT / name, PKG / name)

    for rel in MEMORY_FILES:
        src = ROOT / rel
        if src.exists():
            _copy_file(src, PKG / rel)

    for rel in TEST_FILES:
        src = ROOT / rel
        if src.exists():
            _copy_file(src, PKG / rel)

    for rel in CONFIG_FILES:
        src = ROOT / rel
        if src.exists():
            _copy_file(src, PKG / rel)

    # wheels varsa paketle (offline kurulum)
    wheels_src = ROOT / "vendor" / "wheels"
    if wheels_src.is_dir() and any(wheels_src.iterdir()):
        _copy_tree(wheels_src, PKG / "wheels")

    if with_python:
        import sys

        if str(ROOT) not in sys.path:
            sys.path.insert(0, str(ROOT))
        from tools.embed_python import prepare_runtimes

        print("Gomulu Python 3.12 hazirlaniyor (birkaç dakika sürebilir)...")
        prepare_runtimes(PKG / "runtime", force=force_python, with_pip=True)

    import json
    from datetime import datetime, timezone

    (PKG / "config").mkdir(parents=True, exist_ok=True)
    policy = {
        "enforce": False,
        "product_family": "dft_elic_votex",
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "note": "Tablet paketi — Atom/4GB icin enforce kapali; kilidi gerekirse ac",
    }
    (PKG / "config" / "license_policy.json").write_text(
        json.dumps(policy, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    (PKG / "memory").mkdir(parents=True, exist_ok=True)
    (PKG / "config").mkdir(parents=True, exist_ok=True)
    (PKG / "tests").mkdir(parents=True, exist_ok=True)
    (PKG / "logs").mkdir(parents=True, exist_ok=True)

    (PKG / "BASLAT.bat").write_text(BASLAT_BAT, encoding="utf-8")
    (PKG / "TEMIZ-BASLAT.bat").write_text(TEMIZ_BASLAT_BAT, encoding="utf-8")
    (PKG / "ILK_KURULUM.bat").write_text(ILK_KURULUM_BAT, encoding="utf-8")
    (PKG / "OKU_BENI.txt").write_text(OKU_BENI, encoding="utf-8")

    DIST.mkdir(parents=True, exist_ok=True)
    if ZIP_PATH.exists():
        ZIP_PATH.unlink()

    print("ZIP olusturuluyor (Python gomulu — buyuk olabilir)...")
    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for path in PKG.rglob("*"):
            if path.is_file():
                # zip icinde Derin_Tarama_Asistan_Tablet/...
                arc = path.relative_to(PKG.parent)
                zf.write(path, arc.as_posix())

    return ZIP_PATH


def main() -> int:
    parser = argparse.ArgumentParser(description="DTA tablet paketi")
    parser.add_argument("--no-python", action="store_true", help="Gomulu Python ekleme")
    parser.add_argument("--force-python", action="store_true", help="Python'u yeniden indir")
    args = parser.parse_args()

    print("Derin Tarama Asistan tablet paketi olusturuluyor...")
    zip_path = build_package(
        with_python=not args.no_python,
        force_python=args.force_python,
    )
    print(f"Klasor: {PKG}")
    print(f"ZIP:    {zip_path}")
    try:
        mb = zip_path.stat().st_size / (1024 * 1024)
        print(f"Boyut:  {mb:.1f} MB")
    except Exception:
        pass
    print("Tablete kopyalayin: dist\\Derin_Tarama_Asistan_Tablet  (veya .zip)")
    print("Acin, ILK_KURULUM.bat calistirin — sistem Python gerekmez.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
