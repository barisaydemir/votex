#!/usr/bin/env python3
"""Build PC: DFT Suite kurulum paketini hazırlar.

Kullanım:
  python build.py                 # iskelet + manifest kopyala
  python build.py --fetch-urls    # (ileride) runtime URL indir

Not: Büyük runtime MSI/EXE'leri elle `payload/runtimes/` altına koyun
veya CI'da indirin. Issuer müşteri paketine ASLA kopyalanmaz.
"""

from __future__ import annotations

import argparse
import json
import shutil
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent  # C:\votex
DIST = HERE / "dist" / "DFT_Suite_Setup"
PAYLOAD = DIST / "payload"
DTA_SRC = Path(r"C:\surface-z\Surface-z")


def ensure_dirs() -> None:
    for p in [
        PAYLOAD / "runtimes",
        PAYLOAD / "apps" / "votex",
        PAYLOAD / "apps" / "dta",
    ]:
        p.mkdir(parents=True, exist_ok=True)


def copy_wizard() -> None:
    for name in (
        "prereq_manifest.json",
        "detect.py",
        "install_prereqs.py",
        "kurulum_wizard.py",
    ):
        shutil.copy2(HERE / name, DIST / name)
    # dft_license runtime (issuer hariç)
    lic_src = HERE.parent / "dft_license"
    lic_dst = DIST / "dft_license"
    if lic_dst.exists():
        shutil.rmtree(lic_dst)
    shutil.copytree(
        lic_src,
        lic_dst,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
    # README
    (DIST / "OKU_BENI.txt").write_text(
        """DFT Suite — Anahtar Teslim Kurulum
================================
1) Bu klasörü hedef PC'ye kopyalayın (USB/zip).
2) payload/runtimes/ içine Node MSI, rustup, WebView2, VC++ koyulmuş olmalı
   (build makinesinde doldurulur).
3) Kurulum.bat veya: pyw kurulum_wizard.py
4) Lisans kodunu sihirbazda veya VOTEX OPS'tan girin.

Son kullanıcıya Node/Rust linki gösterilmez — sihirbaz sessiz kurar.
""",
        encoding="utf-8",
    )
    (DIST / "Kurulum.bat").write_text(
        "@echo off\ncd /d \"%~dp0\"\nstart \"\" /B wscript //nologo \"%~dp0Kurulum.vbs\"\n",
        encoding="utf-8",
    )
    (DIST / "Kurulum.vbs").write_text(
        'Set sh=CreateObject("WScript.Shell")\n'
        'dir=CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)\n'
        'sh.Run "pyw """ & dir & "\\kurulum_wizard.py""", 0, False\n',
        encoding="utf-8",
    )


def stage_votex() -> None:
    dest = PAYLOAD / "apps" / "votex"
    # Release exe varsa kopyala
    exe_candidates = [
        ROOT / "src-tauri" / "target" / "release" / "votex.exe",
        ROOT / "src-tauri" / "target" / "release" / "Votex.exe",
    ]
    for exe in exe_candidates:
        if exe.is_file():
            shutil.copy2(exe, dest / "Votex.exe")
            break
    # UI fallback: package.json + dist frontend (geliştirme)
    for name in ("package.json", "index.html", "start.vbs", "start.bat"):
        src = ROOT / name
        if src.is_file():
            shutil.copy2(src, dest / name)
    ui = ROOT / "ui"
    if ui.is_dir():
        dst = dest / "ui"
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(ui, dst, ignore=shutil.ignore_patterns("node_modules"))
    (dest / "README.txt").write_text(
        "VOTEX — tercihen Votex.exe (tauri build --release).\n"
        "Exe yoksa bu PC'de Node+Rust ile start.vbs kullanın (kurulum kurar).\n",
        encoding="utf-8",
    )


def stage_dta() -> None:
    dest = PAYLOAD / "apps" / "dta"
    if not DTA_SRC.is_dir():
        (dest / "MISSING.txt").write_text(f"DTA kaynak yok: {DTA_SRC}", encoding="utf-8")
        return
    files = [
        "main.py",
        "ui.py",
        "launcher.py",
        "app_config.py",
        "requirements.txt",
        "baslat.vbs",
        "baslat.bat",
    ]
    for name in files:
        src = DTA_SRC / name
        if src.is_file():
            shutil.copy2(src, dest / name)
    for folder in ("actions", "core", "memory", "config"):
        src = DTA_SRC / folder
        if src.is_dir():
            dst = dest / folder
            if dst.exists():
                shutil.rmtree(dst)
            shutil.copytree(
                src,
                dst,
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "license.dat"),
            )


def write_payload_readme() -> None:
    (PAYLOAD / "runtimes" / "PUT_RUNTIMES_HERE.txt").write_text(
        """Bu klasöre build makinesinde indirin (prereq_manifest.json ile aynı adlar):

  node-lts-x64.msi
  rustup-init.exe
  MicrosoftEdgeWebView2RuntimeInstallerX64.exe
  VC_redist.x64.exe
  python312-amd64/   (gomulu Python klasoru)

Indirme ornekleri (build PC, internetli):
  Node: https://nodejs.org/dist/  (LTS Windows x64 MSI)
  Rust: https://win.rustup.rs/x86_64  → rustup-init.exe
  WebView2: Microsoft Edge WebView2 Evergreen Bootstrapper
  VC++: https://aka.ms/vs/17/release/vc_redist.x64.exe
""",
        encoding="utf-8",
    )


def zip_dist() -> Path:
    zpath = HERE / "dist" / "DFT_Suite_Setup.zip"
    if zpath.exists():
        zpath.unlink()
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in DIST.rglob("*"):
            if f.is_file():
                # issuer sızıntı kontrolü
                if "dft_license_issuer" in f.parts:
                    continue
                zf.write(f, f.relative_to(DIST.parent))
    return zpath


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--zip", action="store_true", help="Zip oluştur")
    args = parser.parse_args()

    if DIST.exists():
        shutil.rmtree(DIST, ignore_errors=True)
    ensure_dirs()
    copy_wizard()
    stage_votex()
    stage_dta()
    write_payload_readme()
    # manifest kopyası payload yanında
    shutil.copy2(HERE / "prereq_manifest.json", DIST / "prereq_manifest.json")
    meta = {
        "built_from": str(ROOT),
        "note": "Runtimes must be placed under payload/runtimes before field deploy",
    }
    (DIST / "build_meta.json").write_text(
        json.dumps(meta, indent=2), encoding="utf-8"
    )
    print(f"Paket iskeleti: {DIST}")
    if args.zip:
        z = zip_dist()
        print(f"Zip: {z}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
