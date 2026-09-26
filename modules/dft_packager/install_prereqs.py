"""Önkoşulları payload'dan sessiz kur / kopyala."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from detect import load_manifest, scan  # noqa: E402

LogFn = Callable[[str], None]


def _log(msg: str, log: LogFn | None) -> None:
    if log:
        log(msg)
    else:
        print(msg, flush=True)


def _flags() -> int:
    if sys.platform == "win32":
        return getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
    return 0


def expand_dest(s: str) -> Path:
    return Path(os.path.expandvars(s))


def install_one(item: dict[str, Any], log: LogFn | None = None) -> tuple[bool, str]:
    pr = item["prereq"]
    pid = pr["id"]
    payload = Path(item["payload"])
    if item["ok"]:
        return True, f"{pid}: zaten kurulu"

    if not payload.exists():
        return False, f"{pid}: payload yok ({payload})"

    _log(f"Kuruluyor: {pr.get('label', pid)}…", log)

    if pid == "python312" or pr.get("detect") == "python_embed":
        dest = (
            Path(os.environ.get("LOCALAPPDATA", ""))
            / "Programs"
            / "DerinTaramaAsistan"
            / "runtime"
            / "python312-amd64"
        )
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists():
            shutil.rmtree(dest, ignore_errors=True)
        shutil.copytree(payload, dest)
        return True, f"{pid}: kopyalandı → {dest}"

    args = list(pr.get("silent_args") or [])
    if payload.suffix.lower() == ".msi":
        cmd = ["msiexec", "/i", str(payload), *args]
    else:
        cmd = [str(payload), *args]

    try:
        r = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600,
            creationflags=_flags(),
        )
        if r.returncode not in (0, 3010):
            return False, f"{pid}: kod {r.returncode} {(r.stderr or r.stdout)[:200]}"
        return True, f"{pid}: kuruldu"
    except Exception as e:
        return False, f"{pid}: {e}"


def install_missing(payload_root: Path, log: LogFn | None = None) -> list[tuple[str, bool, str]]:
    report = scan(payload_root)
    out: list[tuple[str, bool, str]] = []
    for item in report["missing"]:
        ok, msg = install_one(item, log=log)
        out.append((item["id"], ok, msg))
        _log(msg, log)
    return out


def copy_apps(payload_root: Path, manifest: dict[str, Any] | None = None, log: LogFn | None = None) -> list[str]:
    manifest = manifest or load_manifest()
    messages = []
    apps = manifest.get("apps") or {}
    for name, cfg in apps.items():
        src = payload_root / cfg["src"]
        dest = expand_dest(cfg["dest"])
        if not src.exists():
            messages.append(f"{name}: kaynak yok ({src})")
            _log(messages[-1], log)
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists():
            shutil.rmtree(dest, ignore_errors=True)
        shutil.copytree(src, dest)
        messages.append(f"{name}: {dest}")
        _log(messages[-1], log)
    return messages


if __name__ == "__main__":
    root = HERE / "payload"
    for row in install_missing(root):
        print(row)
