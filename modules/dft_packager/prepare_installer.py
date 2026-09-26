#!/usr/bin/env python3
"""
DFT / VOTEX — Kurulum hazırlama programı (BUILD PC).

Ne yapar?
  1) `npm run build:installer` → Votex NSIS setup.exe (WebView2 + VC++ gömülü)
  2) DTA uygulamasını paketler (launcher + kaynak)
  3) Anahtar teslim klasör: dist/DFT_Installer/

Hedef PC'de Node/Rust GEREKMEZ — sadece setup.exe + DTA kurulumu.
(Geliştirme için start.bat ayrı kalır.)

Kullanım:
  python prepare_installer.py
  python prepare_installer.py --skip-build   # sadece mevcut exe/setup'ı topla
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
VOTEX = HERE.parent.parent  # C:\votex
DTA_SRC = Path(r"D:\surface-z\Surface-z")
OUT = HERE / "dist" / "DFT_Installer"
BUNDLE_DIR = VOTEX / "src-tauri" / "target" / "release" / "bundle" / "nsis"
RELEASE_DIR = VOTEX / "src-tauri" / "target" / "release"


def log(msg: str) -> None:
    line = f"[prepare] {msg}"
    try:
        print(line, flush=True)
    except UnicodeEncodeError:
        print(line.encode("ascii", "replace").decode("ascii"), flush=True)


def run(cmd: list[str], cwd: Path) -> None:
    log(" ".join(cmd))
    r = subprocess.run(cmd, cwd=str(cwd))
    if r.returncode != 0:
        raise SystemExit(f"Komut başarısız ({r.returncode}): {' '.join(cmd)}")


def build_votex_nsis() -> Path:
    """Tauri NSIS installer üretir → *-setup.exe"""
    npm = shutil.which("npm")
    if not npm:
        raise SystemExit("npm yok — build PC'de Node kurulu olmalı")
    run([npm, "run", "build:installer"], cwd=VOTEX)

    setups = sorted(BUNDLE_DIR.glob("*setup.exe"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not setups:
        # alternatif isimler
        setups = sorted(BUNDLE_DIR.glob("*.exe"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not setups:
        raise SystemExit(f"NSIS setup bulunamadı: {BUNDLE_DIR}")
    return setups[0]


def find_existing_setup() -> Path | None:
    if not BUNDLE_DIR.is_dir():
        return None
    setups = sorted(BUNDLE_DIR.glob("*setup.exe"), key=lambda p: p.stat().st_mtime, reverse=True)
    return setups[0] if setups else None


def find_votex_exe() -> Path | None:
    for name in ("votex.exe", "Votex.exe"):
        p = RELEASE_DIR / name
        if p.is_file():
            return p
    return None


def write_embed_pth(rt_dst: Path) -> None:
    """Saha PC'de kullanici site-packages karismasin; Lib + site-packages sys.path'te olsun."""
    if not rt_dst.is_dir():
        return
    pth = rt_dst / "python312._pth"
    pth.write_text(
        "python312.zip\n"
        "Lib\n"
        "Lib\\site-packages\n"
        ".\n"
        "\n"
        "# import site KAPALI — saha PC kullanici paketleri (bozuk cryptography) karismasin\n",
        encoding="utf-8",
    )
    log("python312._pth yazildi (import site KAPALI)")


def copy_portable_dta_files(dest: Path) -> None:
    """Launcher / kısayol / onarım — VoteX'e dokunmaz."""
    dest.mkdir(parents=True, exist_ok=True)
    mapping = {
        "dta_launcher.py": "launcher.py",
        "dta_run.py": "run_dta.py",
        "dta_paths.py": "dta_paths.py",
        "dta_baslat.vbs": "baslat.vbs",
        "dta_baslat.bat": "baslat.bat",
        "dta_onar.bat": "DTA_ONAR.bat",
        "dta_license_manager.py": "core/license_manager.py",
    }
    for src_name, dst_name in mapping.items():
        src = HERE / src_name
        if not src.is_file():
            continue
        dst = dest / dst_name
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)


def prebake_embed_packages(dest: Path) -> None:
    """Build PC'de paketleri gömülü Python'a kur — saha PC ilk açılışta çökmesin."""
    py = dest / "runtime" / "python312-amd64" / "python.exe"
    req = dest / "requirements.txt"
    wheels = dest / "wheels"
    if not py.is_file():
        log("UYARI: prebake atlandı — embed python yok")
        return
    if not req.is_file():
        log("UYARI: prebake atlandı — requirements.txt yok")
        return

    wheels.mkdir(parents=True, exist_ok=True)
    if not any(wheels.glob("*.whl")):
        host_py = Path(
            os.environ.get("LOCALAPPDATA", "")
        ) / "Programs" / "Python" / "Python312" / "python.exe"
        if not host_py.is_file():
            host_py = Path(sys.executable)
        log("Wheels indiriliyor (build PC, bir kez)…")
        subprocess.run(
            [
                str(host_py),
                "-m",
                "pip",
                "download",
                "-r",
                str(req),
                "-d",
                str(wheels),
                "--prefer-binary",
                "--only-binary=:all:",
            ],
            check=False,
            timeout=600,
        )
        # pyaudio bazen only-binary ile gelmez — ikinci deneme
        if not any(wheels.glob("PyAudio*.whl")) and not any(wheels.glob("pyaudio*.whl")):
            subprocess.run(
                [
                    str(host_py),
                    "-m",
                    "pip",
                    "download",
                    "-d",
                    str(wheels),
                    "--prefer-binary",
                    "pyaudio",
                    "Pillow",
                    "psutil",
                    "flask",
                    "requests",
                    "google-genai",
                ],
                check=False,
                timeout=300,
            )
        for junk in list(wheels.glob("*.tar.gz")) + list(wheels.glob("*.zip")):
            junk.unlink(missing_ok=True)

    cmd = [
        str(py),
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--no-warn-script-location",
        "--prefer-binary",
    ]
    if any(wheels.glob("*.whl")):
        cmd += ["--no-index", f"--find-links={wheels}"]
        log(f"Gömülü pip: {len(list(wheels.glob('*.whl')))} wheel")
    else:
        log("Wheels yok — gömülü pip internetten kuracak")
    cmd += ["-r", str(req)]
    log("DTA paketleri gömülü Python'a kuruluyor…")
    r = subprocess.run(cmd, cwd=str(dest), timeout=900)
    if r.returncode != 0 and "--no-index" in cmd:
        log("Offline pip eksik — internet fallback")
        subprocess.run(
            [
                str(py),
                "-m",
                "pip",
                "install",
                "--disable-pip-version-check",
                "--no-warn-script-location",
                "--prefer-binary",
                "-r",
                str(req),
            ],
            cwd=str(dest),
            timeout=900,
            check=False,
        )
    probe = subprocess.run(
        [str(py), "-c", "import tkinter, PIL, psutil; print('UI_OK')"],
        capture_output=True,
        text=True,
        timeout=30,
        cwd=str(py.parent),
    )
    if probe.returncode == 0:
        log(f"prebake UI: {probe.stdout.strip()}")
    else:
        log(f"UYARI: prebake UI test: {(probe.stderr or '')[-240:]}")


def inject_tkinter(rt_dst: Path) -> None:
    """Embed Python'a tkinter + venv + get-pip ekle (DTA UI/kurulum zorunlu)."""
    if not rt_dst.is_dir():
        return

    candidates = [
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Python" / "Python312",
        Path(r"C:\Users\cpbar\AppData\Local\Programs\Python\Python312"),
        Path(sys.executable).resolve().parent,
    ]
    try:
        r = subprocess.run(
            ["py", "-3.12", "-c", "import sys; print(sys.base_prefix)"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        if r.returncode == 0:
            candidates.insert(0, Path(r.stdout.strip()))
    except Exception:
        pass

    src = None
    for c in candidates:
        if (c / "DLLs" / "_tkinter.pyd").is_file() and (c / "Lib" / "tkinter").is_dir():
            src = c
            break
    if src is None:
        log("UYARI: tkinter kaynak Python bulunamadı — DTA UI açılmaz")
        (rt_dst / "TKINTER_EKSIK.txt").write_text(
            "tkinter yok. Build PC'de Python 3.12 (Tcl/Tk ile) kurulu olmalı.\n",
            encoding="utf-8",
        )
        return

    log(f"embed zenginleştiriliyor (tkinter/venv): {src}")
    dlls = src / "DLLs"
    for name in ("_tkinter.pyd", "tcl86t.dll", "tk86t.dll", "zlib1.dll"):
        p = dlls / name
        if p.is_file():
            shutil.copy2(p, rt_dst / name)

    # SSL / ctypes bağımlılıkları (pip --target bazen silmez ama eksik kalmasın)
    for name in ("libssl-3.dll", "libcrypto-3.dll", "libffi-8.dll"):
        # tablet runtime kökünde olabilir
        for cand in (rt_dst / name, dlls / name, src / name):
            if cand.is_file():
                if not (rt_dst / name).is_file() or (rt_dst / name).stat().st_size != cand.stat().st_size:
                    if cand.resolve() != (rt_dst / name).resolve():
                        shutil.copy2(cand, rt_dst / name)
                break

    tcl_src = src / "tcl"
    tcl_dst = rt_dst / "tcl"
    if tcl_src.is_dir():
        if tcl_dst.exists():
            shutil.rmtree(tcl_dst)
        shutil.copytree(
            tcl_src,
            tcl_dst,
            ignore=shutil.ignore_patterns("*.lib", "nmake", "*.sh"),
        )

    for mod in ("tkinter", "venv", "ensurepip"):
        m_src = src / "Lib" / mod
        m_dst = rt_dst / "Lib" / mod
        if m_src.is_dir():
            if m_dst.exists():
                shutil.rmtree(m_dst)
            shutil.copytree(
                m_src,
                m_dst,
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
            )

    # get-pip.py
    for gp in (
        rt_dst / "get-pip.py",
        HERE.parent.parent / "surface-z" / "Surface-z" / "vendor" / "get-pip.py",
        Path(r"C:\surface-z\Surface-z\vendor\get-pip.py"),
        DTA_SRC / "vendor" / "get-pip.py",
        DTA_SRC / "get-pip.py",
    ):
        if gp.is_file():
            if gp.parent != rt_dst:
                shutil.copy2(gp, rt_dst / "get-pip.py")
            break

    write_embed_pth(rt_dst)

    try:
        r = subprocess.run(
            [
                str(rt_dst / "python.exe"),
                "-c",
                "import tkinter, venv; print('OK', tkinter.TkVersion)",
            ],
            capture_output=True,
            text=True,
            timeout=20,
            cwd=str(rt_dst),
        )
        if r.returncode == 0:
            log(f"embed OK: {r.stdout.strip()}")
        else:
            log(f"UYARI: embed test başarısız: {r.stderr[-300:]}")
    except Exception as e:
        log(f"UYARI: embed test: {e}")


def relocate_dta_user_data(dest: Path) -> None:
    """Move mutable DTA data out of Program Files while keeping resources portable."""
    (dest / "dta_user_data.py").write_text(
        '''from __future__ import annotations
import os
from pathlib import Path


def user_data_dir() -> Path:
    root = os.environ.get("DTA_USER_DATA_DIR")
    if root:
        return Path(root)
    appdata = os.environ.get("APPDATA") or os.environ.get("LOCALAPPDATA")
    if appdata:
        return Path(appdata) / "DFT" / "DerinTaramaAsistan"
    return Path.home() / ".dft" / "DerinTaramaAsistan"


USER_DATA_DIR = user_data_dir()
''',
        encoding="utf-8",
    )
    mutable_names = ("config", "memory", "logs", "reports", "recordings", "cache")
    for path in dest.rglob("*.py"):
        if "runtime" in path.parts or path.name == "dta_user_data.py":
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        updated = text
        for name in mutable_names:
            updated = updated.replace(f'BASE_DIR / "{name}"', f'USER_DATA_DIR / "{name}"')
            updated = updated.replace(f'BASE / "{name}"', f'USER_DATA_DIR / "{name}"')
        if updated == text:
            continue
        if "from dta_user_data import USER_DATA_DIR" not in updated:
            marker = "from pathlib import Path"
            if marker in updated:
                updated = updated.replace(marker, marker + "\nfrom dta_user_data import USER_DATA_DIR", 1)
        path.write_text(updated, encoding="utf-8")
    log(r"DTA kullanıcı verileri %APPDATA%\DFT\DerinTaramaAsistan konumuna yönlendirildi")


def stage_dta(dest: Path) -> None:
    """DTA + gömülü Python + wheels — ileri özellikler (Live/yorum) için zorunlu."""
    dest.mkdir(parents=True, exist_ok=True)
    if not DTA_SRC.is_dir():
        (dest / "DTA_EKSIK.txt").write_text(
            f"DTA kaynağı yok: {DTA_SRC}\n", encoding="utf-8"
        )
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
    copy_portable_dta_files(dest)
    for folder in ("actions", "core", "memory", "config"):
        src = DTA_SRC / folder
        if not src.is_dir():
            continue
        dst = dest / folder
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(
            src,
            dst,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "license.dat"),
        )

    # Gömülü Python (tablet paketinden)
    tablet_rt = (
        DTA_SRC / "dist" / "Derin_Tarama_Asistan_Tablet" / "runtime" / "python312-amd64"
    )
    rt_dst = dest / "runtime" / "python312-amd64"
    if tablet_rt.is_dir():
        log(f"Gömülü Python kopyalanıyor: {tablet_rt}")
        if rt_dst.exists():
            shutil.rmtree(rt_dst)
        shutil.copytree(
            tablet_rt,
            rt_dst,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
        )
        inject_tkinter(rt_dst)
        write_embed_pth(rt_dst)
    else:
        (dest / "RUNTIME_EKSIK.txt").write_text(
            "runtime\\python312-amd64 yok.\n"
            "Build PC'de tablet paketi veya embed Python gerekli.\n"
            f"Beklenen: {tablet_rt}\n",
            encoding="utf-8",
        )
        log("UYARI: gömülü Python bulunamadı — ileri özellikler sahada kırılır")

    # Offline wheels
    wheels_src = None
    for cand in (
        DTA_SRC / "wheels",
        DTA_SRC / "vendor" / "wheels",
        DTA_SRC / "dist" / "Derin_Tarama_Asistan_Tablet" / "wheels",
        HERE / "dist" / "DTA_Sadece" / "DerinTaramaAsistan" / "wheels",
    ):
        if cand.is_dir() and any(cand.glob("*.whl")):
            wheels_src = cand
            break
    wdst = dest / "wheels"
    if wheels_src:
        log(f"Wheels kopyalanıyor: {wheels_src}")
        if wdst.exists():
            shutil.rmtree(wdst)
        shutil.copytree(wheels_src, wdst)
        # sdist bırakma
        for junk in wdst.glob("*.tar.gz"):
            junk.unlink()
        for junk in wdst.glob("*.zip"):
            junk.unlink()
    else:
        # Build PC'de indir (win_amd64)
        log("Wheels yok — indiriliyor (bir kez)…")
        wdst.mkdir(parents=True, exist_ok=True)
        req = dest / "requirements.txt"
        host_py = Path(r"C:\Users\cpbar\AppData\Local\Programs\Python\Python312\python.exe")
        if not host_py.is_file():
            host_py = Path(sys.executable)
        if req.is_file():
            subprocess.run(
                [
                    str(host_py),
                    "-m",
                    "pip",
                    "download",
                    "-r",
                    str(req),
                    "-d",
                    str(wdst),
                    "--prefer-binary",
                ],
                check=False,
            )
            # sdist → wheel
            for sdist in list(wdst.glob("*.tar.gz")) + list(wdst.glob("*.zip")):
                subprocess.run(
                    [str(host_py), "-m", "pip", "wheel", str(sdist), "-w", str(wdst), "--no-deps"],
                    check=False,
                    capture_output=True,
                )
                sdist.unlink(missing_ok=True)
            # setuptools/wheel/pip
            subprocess.run(
                [
                    str(host_py),
                    "-m",
                    "pip",
                    "download",
                    "-d",
                    str(wdst),
                    "setuptools",
                    "wheel",
                    "pip",
                ],
                check=False,
            )
        if not any(wdst.glob("*.whl")):
            (dest / "WHEELS_EKSIK.txt").write_text(
                "wheels/ yok — ilk açılışta internet gerekir.\n",
                encoding="utf-8",
            )
            log("UYARI: wheels indirilemedi")
        else:
            log(f"Wheels hazır: {len(list(wdst.glob('*.whl')))} dosya")

    # Hazır venv KOPYALAMA — pyvenv.cfg build PC yoluna (Users\cpbar\...) bağlı kalır,
    # hedef PC'de "No Python at ..." hatası verir. Gömülü runtime ile ilk açılışta kurulur.
    venv_note = dest / "VENV_NOT_BUNDLED.txt"
    venv_note.write_text(
        "Portable kurulum: .venv_jarvis paketlenmez (başka PC yoluna bağlanır, çöker).\n"
        "Paketler runtime\\python312-amd64\\Lib\\site-packages içine kurulur.\n"
        "İlk açılış veya kurulum: launcher.py --silent-setup\n"
        "Onarım: DTA_ONAR.bat (VoteX'e dokunmaz)\n",
        encoding="utf-8",
    )
    log("Portable: .venv_jarvis atlandı — paketler gömülü Python'a")

    prebake_embed_packages(dest)
    copy_portable_dta_files(dest)
    relocate_dta_user_data(dest)

    # VC++ — cryptography/_rust icin saha PC'de sart
    for vc in (
        HERE / "payload" / "runtimes" / "VC_redist.x64.exe",
        HERE / "staging" / "runtimes" / "VC_redist.x64.exe",
    ):
        if vc.is_file():
            shutil.copy2(vc, dest / "VC_redist.x64.exe")
            log(f"VC++ eklendi: {vc.name}")
            break

    lic = HERE.parent / "dft_license"
    if lic.is_dir():
        # import adi: dft_license → vendor/dft_license
        dst = dest / "vendor" / "dft_license"
        if dst.exists():
            shutil.rmtree(dst)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(lic, dst, ignore=shutil.ignore_patterns("__pycache__"))
        # eski ad da kalsin (geriye uyum)
        legacy = dest / "dft_license_vendor"
        if legacy.exists():
            shutil.rmtree(legacy)
        # portable license_manager
        portable_lic = HERE / "dta_license_manager.py"
        if portable_lic.is_file():
            (dest / "core").mkdir(exist_ok=True)
            shutil.copy2(portable_lic, dest / "core" / "license_manager.py")

    # config sablonlari (gizli anahtar kopyalanmaz)
    cfg_dst = dest / "config"
    cfg_dst.mkdir(exist_ok=True)
    for name in ("api_keys.example.json", "license_policy.json"):
        src = DTA_SRC / "config" / name
        if src.is_file():
            shutil.copy2(src, cfg_dst / name)
    # Gerçek API anahtarı dosyası setup'a kopyalanmaz. Kullanıcı ayarları
    # launcher tarafından %APPDATA% altındaki veri dizininden okunur.
    (cfg_dst / "api_keys.json").unlink(missing_ok=True)
    pol = cfg_dst / "license_policy.json"
    if not pol.is_file():
        pol.write_text(
            '{\n  "enforce": false,\n  "product_family": "dft_elic_votex"\n}\n',
            encoding="utf-8",
        )

    # Saha kurulum betiği — VoteX ayarına dokunmaz
    (dest / "KUR_DTA.bat").write_text(
        """@echo off
cd /d "%~dp0"
echo DTA makine-basi hedefe kuruluyor (VoteX degismez)...
set DEST=%ProgramFiles%\\DerinTaramaAsistan
if not exist "%DEST%" mkdir "%DEST%"
xcopy /E /I /Y /Q "%~dp0*" "%DEST%\\"
echo.
echo Paketler gomulu Python'a kuruluyor...
if exist "%DEST%\\runtime\\python312-amd64\\python.exe" (
  "%DEST%\\runtime\\python312-amd64\\python.exe" "%DEST%\\launcher.py" --silent-setup
) else (
  echo UYARI: gomulu Python yok.
)
echo.
echo Tamam. Acilis: %DEST%\\baslat.vbs
echo Onarim: %DEST%\\DTA_ONAR.bat
pause
""",
        encoding="utf-8",
    )


def write_readme(setup_name: str) -> None:
    (OUT / "OKU_BENI.txt").write_text(
        f"""DFT Suite — Saha Kurulumu
========================
Üretim: {datetime.now().isoformat(timespec="seconds")}

İKİ AYRI PROGRAM
----------------
1) VOTEX  = Tauri 2 (Rust + Node toolchain + WebView2)
2) DTA    = Python (ayrı süreç; Live / ses / yorum)

VOTEX özellikleri Node + Rust OLMADAN çalışmaz (saha denemesi).
DTA'nın Python'u VOTEX'in Node/Rust ihtiyacını karşılamaz.

HEDEF PC
1) {setup_name}  (VOTEX)
2) Kurulum / payload ile Node LTS + Rust + WebView2 + VC++ sessiz kurulu olmalı
3) DTA\\KUR_DTA.bat  → gomulu Python + wheels/venv
4) Lisans: VOTEX OPS

Build PC: runtimes\\ altına MSI/exe koy, sonra hazirla-kurulum.bat
""",
        encoding="utf-8",
    )


def zip_out() -> Path:
    zpath = HERE / "dist" / "DFT_Installer.zip"
    if zpath.exists():
        zpath.unlink()
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in OUT.rglob("*"):
            if f.is_file():
                if "dft_license_issuer" in f.parts:
                    continue
                zf.write(f, f.relative_to(OUT.parent))
    return zpath


def main() -> int:
    ap = argparse.ArgumentParser(description="DFT kurulum hazırlayıcı (build PC)")
    ap.add_argument(
        "--skip-build",
        action="store_true",
        help="tauri build atla; mevcut setup.exe kullan",
    )
    ap.add_argument("--zip", action="store_true", help="Zip de oluştur")
    ap.add_argument(
        "--repair-staging-dta",
        action="store_true",
        help="Mevcut staging/DTA'yi VoteX'e dokunmadan onar",
    )
    args = ap.parse_args()

    if args.repair_staging_dta:
        dest = HERE / "staging" / "DTA"
        if not dest.is_dir():
            raise SystemExit(f"staging DTA yok: {dest}")
        rt = dest / "runtime" / "python312-amd64"
        log(f"DTA onarılıyor (VoteX yok): {dest}")
        inject_tkinter(rt)
        write_embed_pth(rt)
        copy_portable_dta_files(dest)
        prebake_embed_packages(dest)
        log("TAMAM: staging DTA onarıldı")
        return 0

    if OUT.exists():
        shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True, exist_ok=True)

    if args.skip_build:
        setup = find_existing_setup()
        if not setup:
            raise SystemExit(
                "Mevcut NSIS setup yok. Önce: npm run build:installer\n"
                f"Beklenen klasör: {BUNDLE_DIR}"
            )
        log(f"Mevcut setup: {setup}")
    else:
        log("VOTEX NSIS installer derleniyor (uzun sürebilir)…")
        setup = build_votex_nsis()
        log(f"Setup üretildi: {setup}")

    dest_setup = OUT / setup.name
    shutil.copy2(setup, dest_setup)

    exe = find_votex_exe()
    if exe:
        shutil.copy2(exe, OUT / "Votex.exe")
        log(f"Exe kopyalandı: {exe.name}")

    stage_dta(OUT / "DTA")
    write_readme(setup.name)

    # VOTEX saha runtimeleri (Node/Rust) — prepare çıktısına da kopyala
    rt_src = HERE / "payload" / "runtimes"
    if rt_src.is_dir():
        rt_dst = OUT / "runtimes"
        if rt_dst.exists():
            shutil.rmtree(rt_dst)
        shutil.copytree(rt_src, rt_dst)
        log(f"VOTEX runtimes kopyalandı: {rt_dst}")
    else:
        (OUT / "RUNTIMES_EKSIK.txt").write_text(
            "Node/Rust/WebView2/VC++ yok.\n"
            "Build PC: python modules\\dft_packager\\fetch_votex_runtimes.py\n"
            "VOTEX özellikleri hedef PC'de Node+Rust olmadan ölür.\n",
            encoding="utf-8",
        )
        log("UYARI: payload/runtimes eksik — VOTEX saha özellikleri kırılır")

    meta = {
        "created": datetime.now().isoformat(timespec="seconds"),
        "setup": setup.name,
        "votex_root": str(VOTEX),
        "note": "VOTEX needs Node+Rust on target; DTA needs Python separately",
    }
    (OUT / "build_meta.json").write_text(
        json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    log(f"Hazır: {OUT}")
    log(f"  → {dest_setup.name}  (VOTEX kurulum)")
    log("  → DTA\\               (DTA kopyala + launcher)")
    if args.zip:
        z = zip_out()
        log(f"Zip: {z}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
