#!/usr/bin/env python3
"""Tablet paketine gomulu (embeddable) Python 3.12 hazirlar.

- python.org embed zip indirir (vendor onbellegi)
- pip etkinlestirir
- ILK_KURULUM / BASLAT runtime\\python* kullanir
"""

from __future__ import annotations

import io
import re
import shutil
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENDOR = ROOT / "vendor"
PYTHON_VERSION = "3.12.10"

# ElitePad eski Win10 x86 olabilir; her iki mimariyi de paketle.
ARCHES = ("amd64", "win32")


def _url(arch: str) -> str:
    return (
        f"https://www.python.org/ftp/python/{PYTHON_VERSION}/"
        f"python-{PYTHON_VERSION}-embed-{arch}.zip"
    )


def _cache_zip(arch: str) -> Path:
    VENDOR.mkdir(parents=True, exist_ok=True)
    return VENDOR / f"python-{PYTHON_VERSION}-embed-{arch}.zip"


def download_embed_zip(arch: str, force: bool = False) -> Path:
    dest = _cache_zip(arch)
    if dest.exists() and dest.stat().st_size > 1_000_000 and not force:
        print(f"[embed] onbellek: {dest.name}")
        return dest
    url = _url(arch)
    print(f"[embed] indiriliyor: {url}")
    urllib.request.urlretrieve(url, dest)
    print(f"[embed] kaydedildi: {dest} ({dest.stat().st_size // 1024} KB)")
    return dest


def download_get_pip() -> Path:
    dest = VENDOR / "get-pip.py"
    if dest.exists() and dest.stat().st_size > 100_000:
        return dest
    VENDOR.mkdir(parents=True, exist_ok=True)
    url = "https://bootstrap.pypa.io/get-pip.py"
    print(f"[embed] get-pip indiriliyor: {url}")
    urllib.request.urlretrieve(url, dest)
    return dest


def _enable_site(pth_file: Path) -> None:
    text = pth_file.read_text(encoding="utf-8")
    # import site satırını aç
    text = re.sub(r"(?m)^#\s*import site\s*$", "import site", text)
    if "import site" not in text:
        text = text.rstrip() + "\nimport site\n"
    # site-packages yolu
    if "Lib\\site-packages" not in text and "Lib/site-packages" not in text:
        lines = text.splitlines()
        out: list[str] = []
        inserted = False
        for line in lines:
            out.append(line)
            if not inserted and (line.strip() == "." or line.endswith(".zip")):
                out.append("Lib\\site-packages")
                inserted = True
        if not inserted:
            out.insert(0, "Lib\\site-packages")
        text = "\n".join(out) + "\n"
    pth_file.write_text(text, encoding="utf-8")


def extract_embed(arch: str, dest_dir: Path, force: bool = False) -> Path:
    """dest_dir/python312-{arch}/ icine acar, pip hazirlar."""
    out = dest_dir / f"python312-{arch}"
    marker = out / "python.exe"
    if marker.exists() and not force:
        print(f"[embed] hazir: {out}")
        return out

    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    zpath = download_embed_zip(arch, force=force)
    with zipfile.ZipFile(zpath, "r") as zf:
        zf.extractall(out)

    pth = next(out.glob("python*._pth"), None)
    if pth is None:
        raise RuntimeError(f"python*._pth bulunamadi: {out}")
    _enable_site(pth)

    (out / "Lib" / "site-packages").mkdir(parents=True, exist_ok=True)

    get_pip = download_get_pip()
    shutil.copy2(get_pip, out / "get-pip.py")
    print(f"[embed] cikartildi: {out}")
    return out


def install_pip_into(runtime_dir: Path) -> None:
    """get-pip ile pip kur (derleyici makinede bir kez)."""
    import subprocess

    py = runtime_dir / "python.exe"
    get_pip = runtime_dir / "get-pip.py"
    if not py.exists() or not get_pip.exists():
        raise FileNotFoundError(runtime_dir)
    pip_ok = (runtime_dir / "Scripts" / "pip.exe").exists() or (
        runtime_dir / "Lib" / "site-packages" / "pip"
    ).exists()
    if pip_ok:
        print(f"[embed] pip zaten var: {runtime_dir.name}")
        return
    print(f"[embed] pip kuruluyor: {runtime_dir.name} ...")
    subprocess.check_call(
        [str(py), str(get_pip), "--no-warn-script-location"],
        cwd=str(runtime_dir),
    )


def prepare_runtimes(pkg_runtime: Path, *, force: bool = False, with_pip: bool = True) -> list[Path]:
    pkg_runtime.mkdir(parents=True, exist_ok=True)
    prepared: list[Path] = []
    for arch in ARCHES:
        try:
            path = extract_embed(arch, pkg_runtime, force=force)
            if with_pip:
                try:
                    install_pip_into(path)
                except Exception as exc:
                    print(f"[embed] UYARI pip ({arch}): {exc}")
                    print("[embed] Tablette ILK_KURULUM get-pip ile deneyecek.")
            prepared.append(path)
        except Exception as exc:
            print(f"[embed] UYARI {arch} atlandi: {exc}")
    if not prepared:
        raise RuntimeError("Hicbir gomulu Python hazirlanamadi.")
    return prepared


def main() -> int:
    dest = ROOT / "dist" / "_runtime_preview"
    paths = prepare_runtimes(dest, force=False, with_pip=True)
    for p in paths:
        print("OK", p)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
