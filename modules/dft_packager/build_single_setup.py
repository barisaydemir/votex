#!/usr/bin/env python3
"""
Tek Setup.exe üretici — kullanıcıya sadece DFT_Suite_Setup.exe verilir.

Akış (BUILD PC):
  1) fetch_votex_runtimes.py  → Node/Rust/WebView2/VC++
  2) tauri build (NSIS)       → Votex.exe (+ opsiyonel *-setup.exe)
  3) DTA stage                → runtime + wheels/venv
  4) Inno Setup ISCC          → dist/DFT_Suite_Setup.exe

Kullanım:
  python build_single_setup.py
  python build_single_setup.py --skip-tauri
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
VOTEX = HERE.parent.parent
DTA_SRC = Path(r"D:\surface-z\Surface-z")
STAGING = HERE / "staging"
DIST = HERE / "dist"
# Workspace kökü (C:\votex\target) veya src-tauri/target — hangisi doluysa
_RELEASE_CANDIDATES = (
    VOTEX / "target" / "release",
    VOTEX / "src-tauri" / "target" / "release",
)


def _resolve_release_dir() -> Path:
    for p in _RELEASE_CANDIDATES:
        if (p / "votex.exe").is_file() or (p / "Votex.exe").is_file():
            return p
    # henüz build yoksa workspace varsayılanı
    return _RELEASE_CANDIDATES[0]


RELEASE = _resolve_release_dir()
BUNDLE_NSIS = RELEASE / "bundle" / "nsis"
ISS = HERE / "DFT_Suite.iss"
PACKAGE_VERSION = "0.4.21"

ISCC_CANDIDATES = [
    Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Inno Setup 6" / "ISCC.exe",
    Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"))
    / "Inno Setup 6"
    / "ISCC.exe",
    Path(r"C:\Program Files\Inno Setup 6\ISCC.exe"),
]


def log(msg: str) -> None:
    line = f"[setup] {msg}"
    try:
        print(line, flush=True)
    except UnicodeEncodeError:
        print(line.encode("ascii", "replace").decode("ascii"), flush=True)


def find_iscc() -> Path:
    for p in ISCC_CANDIDATES:
        if p.is_file():
            return p
    w = shutil.which("ISCC")
    if w:
        return Path(w)
    raise SystemExit(
        "Inno Setup 6 bulunamadı (ISCC.exe).\n"
        "Kur: https://jrsoftware.org/isdl.php\n"
        "Sonra tekrar: python build_single_setup.py"
    )


def run(cmd: list[str], cwd: Path | None = None) -> None:
    log(" ".join(cmd))
    r = subprocess.run(cmd, cwd=str(cwd) if cwd else None)
    if r.returncode != 0:
        raise SystemExit(f"Başarısız ({r.returncode}): {' '.join(cmd)}")


def ensure_runtimes() -> Path:
    rt = HERE / "payload" / "runtimes"
    needed = [
        "node-lts-x64.msi",
        "rustup-init.exe",
        "MicrosoftEdgeWebView2RuntimeInstallerX64.exe",
        "VC_redist.x64.exe",
    ]
    missing = [n for n in needed if not (rt / n).is_file()]
    if missing:
        log("Eksik runtime — indiriliyor…")
        run([sys.executable, str(HERE / "fetch_votex_runtimes.py")])
        missing = [n for n in needed if not (rt / n).is_file()]
    if missing:
        raise SystemExit(
            "Runtime dosyaları eksik: "
            + ", ".join(missing)
            + f"\nKlasör: {rt}"
        )
    # settings writer for Inno [Run]
    ps = rt / "write_settings.ps1"
    ps.write_text(
        r"""
$votexSettings = Join-Path $env:APPDATA "Votex"
New-Item -ItemType Directory -Force -Path $votexSettings | Out-Null
$dta = Join-Path $env:LOCALAPPDATA "Programs\DerinTaramaAsistan\launcher.py"
@{
  dtaLaunchPath = $dta
  autoLaunchDta = $true
} | ConvertTo-Json | Set-Content (Join-Path $votexSettings "settings.json") -Encoding UTF8
$dft = Join-Path $env:APPDATA "DFT"
New-Item -ItemType Directory -Force -Path $dft | Out-Null
""",
        encoding="utf-8",
    )
    return rt


def build_tauri() -> None:
    npm = shutil.which("npm")
    if not npm:
        raise SystemExit("npm yok — build PC'de Node gerekli")
    run([npm, "run", "build:installer"], cwd=VOTEX)


def stage_votex(staging_votex: Path) -> Path | None:
    staging_votex.mkdir(parents=True, exist_ok=True)
    release = _resolve_release_dir()
    bundle_nsis = release / "bundle" / "nsis"
    log(f"Release: {release}")
    exe = None
    for name in ("votex.exe", "Votex.exe"):
        p = release / name
        if p.is_file():
            exe = p
            break
    if not exe:
        raise SystemExit(f"Votex.exe yok: {release} — önce tauri build")
    shutil.copy2(exe, staging_votex / "Votex.exe")
    # UI assets for some builds
    for name in ("resources",):
        src = release / name
        if src.is_dir():
            dst = staging_votex / name
            if dst.exists():
                shutil.rmtree(dst)
            shutil.copytree(src, dst)
    setup = None
    if bundle_nsis.is_dir():
        setups = sorted(
            bundle_nsis.glob("*setup.exe"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if setups:
            setup = setups[0]
            shutil.copy2(setup, STAGING / "votex-setup.exe")
            log(f"NSIS eklendi: {setup.name}")
    return setup


def stage_dta(dest: Path) -> None:
    # reuse prepare_installer.stage_dta logic via import
    sys.path.insert(0, str(HERE))
    from prepare_installer import stage_dta as _stage

    _stage(dest)


def write_info() -> None:
    (STAGING / "INFO_BEFORE.txt").write_text(
        """DFT Suite kurulumu

Bu tek paket şunları kurar:
  • VOTEX (Tauri) + Node.js + Rust + WebView2 + VC++
  • Derin Tarama Asistan (DTA, Python)

Kurulum yönetici izni ister ve birkaç dakika sürebilir.
Mevcut VOTEX/DFT Suite kurulumu otomatik kaldırılır, sonra bu sürüm kurulur.
Kullanıcı arşivleri ve %APPDATA% ayarları korunur.
İnternet: Rust/Node MSI yerelde; WebView2 offline paket varsa internet gerekmez.

VOTEX ve DTA ayrı programlardır; kısayollar masaüstüne eklenir.
""",
        encoding="utf-8",
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="Tek DFT_Suite_Setup.exe üret")
    ap.add_argument("--skip-tauri", action="store_true")
    ap.add_argument("--skip-fetch", action="store_true")
    ap.add_argument(
        "--keep-staging",
        action="store_true",
        help="staging silinmez; VoteX'e dokunulmaz, sadece mevcut DTA+VOTEX ile Setup derlenir",
    )
    args = ap.parse_args()

    iscc = find_iscc()
    log(f"ISCC: {iscc}")

    DIST.mkdir(parents=True, exist_ok=True)

    if args.keep_staging:
        if not (STAGING / "DTA" / "launcher.py").is_file():
            raise SystemExit("staging\\DTA yok — önce --repair-staging-dta veya tam stage")
        log("staging korundu (VoteX yeniden kopyalanmadı)")
        write_info()
    else:
        if STAGING.exists():
            shutil.rmtree(STAGING)
        STAGING.mkdir(parents=True)

        if not args.skip_fetch:
            ensure_runtimes()
        else:
            ensure_runtimes()  # still validates

        if not args.skip_tauri:
            log("Tauri NSIS / release build…")
            build_tauri()
        else:
            log("Tauri build atlandı")

        rt = HERE / "payload" / "runtimes"
        shutil.copytree(rt, STAGING / "runtimes")
        stage_votex(STAGING / "VOTEX")
        stage_dta(STAGING / "DTA")
        write_info()

    # Inno OutputDir relative to iss location
    log("Inno Setup derleniyor -> tek Setup.exe...")
    run([str(iscc), str(ISS)], cwd=HERE)

    out = DIST / f"DFT_Suite_Setup_{PACKAGE_VERSION}.exe"
    if not out.is_file():
        # sometimes unversioned or alternate name
        cands = sorted(
            DIST.glob("DFT_Suite_Setup*.exe"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if not cands:
            raise SystemExit(f"Setup üretilemedi: {DIST}")
        out = cands[0]

    meta = {
        "created": datetime.now().isoformat(timespec="seconds"),
        "version": PACKAGE_VERSION,
        "output": str(out),
        "size_mb": round(out.stat().st_size / (1024 * 1024), 1),
        "user_action": f"Sadece DFT_Suite_Setup_{PACKAGE_VERSION}.exe çalıştır",
        "notes": [
            "Legacy3DMag dik çekim → anomali / olası yapı şekilleri",
            "DTA: PyAudio timeout + yazı-modu, Live 2.5 native-audio",
            f"VOTEX {PACKAGE_VERSION} + Derin Tarama Asistan",
        ],
    }
    (DIST / "setup_meta.json").write_text(
        json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    kurulum = VOTEX / "KURULUM_PAKETLERI"
    kurulum.mkdir(parents=True, exist_ok=True)
    dest = kurulum / f"Votex_{PACKAGE_VERSION}_Kurulum.exe"
    shutil.copy2(out, dest)
    log(f"KURULUM_PAKETLERI: {dest}")
    log(f"TAMAM: {out} ({meta['size_mb']} MB)")
    log("Kullanıcıya sadece bu dosyayı verin.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
