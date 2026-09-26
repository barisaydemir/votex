#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DTA güncelleme akışı — tek komut.

Kod değiştiğinde DTA'nın üç kopyasını senkronlar, DTA'yı kurulu kopyadan
yeniden başlatır ve canlı E2E doğrulamasını koşar:

  1. Senkron      — scripts/dta_sync_check.py --sync --yes (repo → surface-z + C:\\votex)
  2. Köprü        — VOTEX köprüsü (127.0.0.1:18765) canlı değilse target/release/votex.exe başlatılır
  3. Yeniden başlat — eski DTA süreçleri kapatılır, C:\\votex kopyasından pythonw main.py başlatılır,
                    boot.log'da "Live baglandi" beklenir
  4. E2E          — scripts/e2e_dta_bridge.py tam tur (18 senaryo)

Kullanım:
  python scripts/dta_update.py                 # tam akış
  python scripts/dta_update.py --skip-sync     # senkronu atla (yalnız restart + E2E)
  python scripts/dta_update.py --skip-e2e      # yalnız senkron + restart
  python scripts/dta_update.py --no-restart    # çalışan DTA'yı dokunma (E2E mevcut süreçle)
  python scripts/dta_update.py --bridge-only   # DTA'yı hiç karıştırma; köprü senaryoları yeter

Çıkış kodu: ilk başarısız adımın kodu (0 = tümü geçti).
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = REPO_ROOT / "scripts"
SYNC_SCRIPT = SCRIPTS / "dta_sync_check.py"
E2E_SCRIPT = SCRIPTS / "e2e_dta_bridge.py"

INSTALLED_DTA = Path(r"C:\votex\Derin_Tarama_Asistan")
BOOT_LOG = INSTALLED_DTA / "logs" / "boot.log"
DTA_EXE = INSTALLED_DTA / ".venv_jarvis" / "Scripts" / "pythonw.exe"
VOTEX_EXE = REPO_ROOT / "target" / "release" / "votex.exe"
BRIDGE_URL = "http://127.0.0.1:18765"

DETACHED = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP


def http_ok(url: str, timeout: float = 3.0) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return resp.status == 200
    except Exception:
        return False


def step(name: str) -> None:
    print(f"\n== {name} " + "=" * max(1, 64 - len(name)))


def run_sync() -> int:
    step("1/4 SENKRON (repo → surface-z + kurulum)")
    cmd = [sys.executable, str(SYNC_SCRIPT), "--sync", "--yes"]
    code = subprocess.call(cmd)
    if code == 0:
        print("[sync] kopyalar senkron")
    return code


def ensure_bridge() -> int:
    step("2/4 VOTEX KÖPRÜSÜ (127.0.0.1:18765)")
    if http_ok(f"{BRIDGE_URL}/health"):
        print("[bridge] canlı")
        return 0
    if not VOTEX_EXE.exists():
        print(f"[bridge] HATA: {VOTEX_EXE} yok — önce npm run build:installer")
        return 1
    print("[bridge] kapalı — başlatılıyor:", VOTEX_EXE.name)
    subprocess.Popen(
        [str(VOTEX_EXE)],
        cwd=str(VOTEX_EXE.parent),
        creationflags=DETACHED,
        close_fds=True,
    )
    for _ in range(20):
        time.sleep(1)
        if http_ok(f"{BRIDGE_URL}/health"):
            print("[bridge] canlı")
            return 0
    print("[bridge] HATA: 20 sn içinde yanıt vermedi")
    return 1


def dta_pids() -> list[int]:
    """Derin_Tarama_Asistan/main.py çalıştıran python/pythonw PID'leri."""
    ps = (
        "Get-CimInstance Win32_Process -Filter \"Name='python.exe' or Name='pythonw.exe'\" "
        "| Where-Object { $_.CommandLine -match 'Derin_Tarama_Asistan' -and $_.CommandLine -match 'main\\.py' } "
        "| Select-Object -ExpandProperty ProcessId"
    )
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command", ps],
        capture_output=True, text=True, timeout=30,
    )
    pids = []
    for line in (out.stdout or "").split():
        line = line.strip()
        if line.isdigit():
            pids.append(int(line))
    return pids


def restart_dta() -> int:
    step("3/4 DTA YENİDEN BAŞLATMA (kurulu kopya)")
    old = dta_pids()
    for pid in old:
        subprocess.run(["taskkill", "/F", "/PID", str(pid)],
                       capture_output=True, text=True)
    if old:
        print(f"[dta] {len(old)} eski süreç kapatıldı: {old}")
        time.sleep(2)
    else:
        print("[dta] çalışan eski süreç yok")
    if not DTA_EXE.exists():
        print(f"[dta] HATA: {DTA_EXE} yok — kurulum kopyası eksik mi?")
        return 1
    subprocess.Popen(
        [str(DTA_EXE), "main.py"],
        cwd=str(INSTALLED_DTA),
        creationflags=DETACHED,
        close_fds=True,
    )
    print(f"[dta] başlatıldı — boot.log bekleniyor: {BOOT_LOG.name}")
    # main() boot.log'u silerek başlar; "Live baglandi" satırını bekle
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        try:
            text = BOOT_LOG.read_text(encoding="utf-8", errors="replace")
        except OSError:
            text = ""
        if "Live baglandi" in text:
            print("[dta] Live bağlandı ✓")
            return 0
        if "HATA" in text and "Live" in text:
            print("[dta] HATA: boot.log'da Live hatası:")
            for line in text.splitlines()[-5:]:
                print("   ", line)
            return 1
        time.sleep(2)
    print("[dta] HATA: 60 sn içinde Live bağlantısı gelmedi (boot.log'u kontrol edin)")
    return 1


def run_e2e(bridge_only: bool) -> int:
    step("4/4 CANLI E2E (scripts/e2e_dta_bridge.py)")
    cmd = [sys.executable, str(E2E_SCRIPT)]
    if bridge_only:
        cmd.append("--bridge-only")
    code = subprocess.call(cmd)
    return code


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    ap = argparse.ArgumentParser(description="DTA güncelleme: senkron + restart + canlı E2E")
    ap.add_argument("--skip-sync", action="store_true", help="adım 1'i atla")
    ap.add_argument("--skip-e2e", action="store_true", help="adım 4'ü atla")
    ap.add_argument("--no-restart", action="store_true", help="çalışan DTA'yı yeniden başlatma")
    ap.add_argument("--bridge-only", action="store_true",
                    help="DTA bağımlı her şeyi atla (senkron + köprü + köprü-E2E)")
    args = ap.parse_args()

    print("DTA GÜNCELLEME AKIŞI"
          + ("  [bridge-only]" if args.bridge_only else ""))

    if not args.skip_sync:
        code = run_sync()
        if code != 0:
            print("\nAKIŞ DURDU: senkron başarısız")
            return code

    code = ensure_bridge()
    if code != 0:
        print("\nAKIŞ DURDU: köprü ayağa kalkmadı")
        return code

    if args.bridge_only:
        if not args.skip_e2e:
            return run_e2e(bridge_only=True)
        return 0

    if not args.no_restart:
        code = restart_dta()
        if code != 0:
            print("\nAKIŞ DURDU: DTA yeniden başlatılamadı")
            return code
    else:
        print("\n(--no-restart) çalışan DTA kullanılacak")

    if not args.skip_e2e:
        return run_e2e(bridge_only=False)

    print("\nAKIŞ TAMAM (--skip-e2e)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
