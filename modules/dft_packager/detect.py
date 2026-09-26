"""Hedef PC önkoşul tespiti."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent


def load_manifest(path: Path | None = None) -> dict[str, Any]:
    p = path or (HERE / "prereq_manifest.json")
    return json.loads(p.read_text(encoding="utf-8"))


def _which(name: str) -> str | None:
    return shutil.which(name)


def _run(cmd: list[str]) -> tuple[int, str]:
    try:
        flags = 0
        if sys.platform == "win32":
            flags = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
        r = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
            creationflags=flags,
        )
        out = (r.stdout or "") + (r.stderr or "")
        return r.returncode, out.strip()
    except Exception as e:
        return 1, str(e)


def detect_webview2() -> bool:
    if sys.platform != "win32":
        return False
    try:
        import winreg

        key = winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE,
            r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        )
        winreg.CloseKey(key)
        return True
    except Exception:
        try:
            import winreg

            key = winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE,
                r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
            )
            winreg.CloseKey(key)
            return True
        except Exception:
            return False


def detect_vcredist() -> bool:
    # Basit: msvcp140.dll System32'de
    windir = os.environ.get("SystemRoot", r"C:\Windows")
    return Path(windir, "System32", "msvcp140.dll").is_file()


def detect_one(prereq: dict[str, Any], payload_root: Path) -> dict[str, Any]:
    pid = prereq["id"]
    label = prereq.get("label", pid)
    ok = False
    detail = ""
    kind = prereq.get("detect", pid)

    if kind == "node":
        p = _which("node")
        ok = bool(p)
        detail = p or "yok"
    elif kind == "cargo":
        p = _which("cargo")
        ok = bool(p)
        detail = p or "yok"
    elif kind == "webview2":
        ok = detect_webview2()
        detail = "kurulu" if ok else "yok"
    elif kind == "vcredist":
        ok = detect_vcredist()
        detail = "kurulu" if ok else "yok"
    elif kind == "python_embed":
        # Hedef kurulum yolunda veya payload içinde
        dest = prereq.get("copy_to", "")
        ok = (payload_root / prereq.get("payload", "")).exists() or bool(dest)
        # "detect" for install: if already copied to Programs
        local = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "DerinTaramaAsistan" / "runtime" / "python312-amd64" / "python.exe"
        if local.is_file():
            ok = True
            detail = str(local)
        else:
            detail = "paketten kopyalanacak" if (payload_root / prereq.get("payload", "")).exists() else "payload eksik"
            ok = False if "eksik" in detail else False
            # python embed always "needs copy" unless dest exists
            ok = local.is_file()
    else:
        detail = "bilinmeyen"

    payload = payload_root / prereq.get("payload", "")
    return {
        "id": pid,
        "label": label,
        "ok": ok,
        "detail": detail,
        "payload_present": payload.exists(),
        "payload": str(payload),
        "prereq": prereq,
    }


def scan(payload_root: Path | None = None, manifest: dict[str, Any] | None = None) -> dict[str, Any]:
    manifest = manifest or load_manifest()
    root = payload_root or (HERE / "payload")
    results = [detect_one(p, root) for p in manifest.get("prereqs", [])]
    missing = [r for r in results if not r["ok"]]
    arch = os.environ.get("PROCESSOR_ARCHITECTURE", "")
    disk_ok = True
    try:
        import shutil as sh

        free = sh.disk_usage(os.environ.get("SystemDrive", "C:\\")).free
        disk_ok = free >= int(manifest.get("min_disk_gb", 4)) * (1024**3)
    except Exception:
        pass
    return {
        "arch": arch,
        "arch_ok": "64" in arch or arch.upper() == "AMD64",
        "disk_ok": disk_ok,
        "results": results,
        "missing": missing,
        "ready": len(missing) == 0 and disk_ok,
    }


if __name__ == "__main__":
    print(json.dumps(scan(), indent=2, ensure_ascii=False))
