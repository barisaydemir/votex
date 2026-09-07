"""DTA bootstrap — DLL yolu once gomulu runtime; hatalar MessageBox ile."""
from __future__ import annotations

import os
import sys
import traceback
from pathlib import Path

os.environ["PYTHONNOUSERSITE"] = "1"

BASE = Path(__file__).resolve().parent
EMBED = BASE / "runtime" / "python312-amd64"
EMBED_SP = EMBED / "Lib" / "site-packages"
VENV_SP = BASE / ".venv_jarvis" / "Lib" / "site-packages"
VENDOR = BASE / "vendor"
CRYPTO_BINDINGS = EMBED_SP / "cryptography" / "hazmat" / "bindings"
BOOT_LOG = BASE / "logs" / "boot.log"


def _log(msg: str) -> None:
    try:
        BOOT_LOG.parent.mkdir(parents=True, exist_ok=True)
        with BOOT_LOG.open("a", encoding="utf-8") as f:
            f.write(msg.rstrip() + "\n")
    except Exception:
        pass
    try:
        sys.stderr.write(msg.rstrip() + "\n")
    except Exception:
        pass


def _message_box(text: str) -> None:
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(0, str(text)[-1200:], "DTA baslatma hatasi", 0x10)
    except Exception:
        pass


if EMBED.is_dir():
    os.environ["PATH"] = str(EMBED) + os.pathsep + os.environ.get("PATH", "")
    if hasattr(os, "add_dll_directory"):
        try:
            os.add_dll_directory(str(EMBED))
        except OSError:
            pass
        if CRYPTO_BINDINGS.is_dir():
            try:
                os.add_dll_directory(str(CRYPTO_BINDINGS))
            except OSError:
                pass

_cleaned = []
for p in sys.path:
    pl = p.replace("\\", "/").lower()
    if "site-packages" in pl and "derintaramaasistan" not in pl:
        continue
    _cleaned.append(p)
sys.path[:] = _cleaned
for p in (EMBED_SP, VENV_SP, VENDOR, BASE):
    s = str(p)
    if p.is_dir() and s not in sys.path:
        sys.path.insert(0, s)

if EMBED.is_dir():
    try:
        import ctypes

        p3 = EMBED / "python3.dll"
        if p3.is_file():
            ctypes.WinDLL(str(p3))
    except OSError as e:
        _log(f"[run_dta] python3.dll preload: {e}")

try:
    import runpy

    runpy.run_path(str(BASE / "main.py"), run_name="__main__")
except Exception:
    tb = traceback.format_exc()
    _log("[run_dta] FATAL:\n" + tb)
    _message_box(tb[-800:])
    raise SystemExit(1)
