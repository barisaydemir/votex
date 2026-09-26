#!/usr/bin/env python3
"""requirements.txt icin Windows wheel'lerini indir (offline tablet kurulum)."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REQ = ROOT / "requirements.txt"
OUT = ROOT / "vendor" / "wheels"


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    py = sys.executable
    platforms = [
        "win_amd64",
        "win32",
    ]
    for plat in platforms:
        print(f"[wheels] {plat} ...")
        cmd = [
            py,
            "-m",
            "pip",
            "download",
            "-r",
            str(REQ),
            "-d",
            str(OUT),
            "--only-binary=:all:",
            "--python-version",
            "312",
            "--platform",
            plat,
        ]
        try:
            subprocess.check_call(cmd)
        except subprocess.CalledProcessError:
            print(f"[wheels] UYARI: {plat} tamamen indirilemedi (pyaudio vb.)")
            # best-effort without only-binary for remaining
            cmd2 = [
                py, "-m", "pip", "download",
                "-r", str(REQ),
                "-d", str(OUT),
                "--python-version", "312",
                "--platform", plat,
            ]
            try:
                subprocess.check_call(cmd2)
            except subprocess.CalledProcessError as exc:
                print(f"[wheels] atlandi {plat}: {exc}")
    print(f"[wheels] klasor: {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
