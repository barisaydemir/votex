#!/usr/bin/env python3
"""Build PC: VOTEX saha runtime'larını (Node, Rust, WebView2, VC++) indirir.

Kullanım:
  python fetch_votex_runtimes.py

Çıktı: modules/dft_packager/payload/runtimes/
Kurulum sihirbazı / prepare_installer bunları hedefe sessiz kurar.
"""

from __future__ import annotations

import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "payload" / "runtimes"

# Sabit URL'ler (guncellemek gerekebilir)
URLS = {
    # Node 20 LTS Windows x64 MSI — major pin; gerekirse nodejs.org/dist guncelle
    "node-lts-x64.msi": "https://nodejs.org/dist/v20.18.1/node-v20.18.1-x64.msi",
    "rustup-init.exe": "https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe",
    "MicrosoftEdgeWebView2RuntimeInstallerX64.exe": (
        "https://go.microsoft.com/fwlink/p/?LinkId=2124703"
    ),
    "VC_redist.x64.exe": "https://aka.ms/vs/17/release/vc_redist.x64.exe",
}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, url in URLS.items():
        dest = OUT / name
        if dest.is_file() and dest.stat().st_size > 1_000_000:
            print(f"[skip] {name} ({dest.stat().st_size} bytes)")
            continue
        print(f"[get] {name} …")
        try:
            urllib.request.urlretrieve(url, dest)
            print(f"  → {dest} ({dest.stat().st_size} bytes)")
        except Exception as e:
            print(f"  HATA {name}: {e}")
            print("  Elle indirip payload/runtimes/ altına koyun.")
    print(f"Klasör: {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
