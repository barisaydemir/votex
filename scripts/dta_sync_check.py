#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DTA üç kopya senkron denetleyicisi.

Derin Tarama Asistan'ın senkron tutulan üç kopyasının dosyalarının
SHA-256 hash'lerini karşılaştırır:

  1. repo      — <votex repo>/Derin_Tarama_Asistan   (kaynak / git)
  2. surface-z — D:\\surface-z\\Surface-z              (ikinci geliştirme kopyası)
  3. kurulum   — C:\\votex\\Derin_Tarama_Asistan      (kurulu kopya)

Karşılaştırma kuralı: "canlı" kod dosyaları (main.py, ui.py, actions/*.py,
core/*, baslat.bat, TEMIZ-BASLAT.bat vb.) üç kopyada birebir aynı olmalıdır.
__pycache__, logs, config, .venv* gibi ortam-bağımlı içerik DENETLENDİĞİ
ORANA DAHİL EDİLMEZ (kurulumda kaçınılmaz olarak farklıdır).

Kullanım:
  python scripts/dta_sync_check.py              # denetle (çıkış kodu 0/1)
  python scripts/dta_sync_check.py --sync       # farklıysa repo'dan kopyala
  python scripts/dta_sync_check.py --set repo   # hangi kopya referans (varsayılan repo)
  python scripts/dta_sync_check.py --json       # makine çıktısı

--sync yalnızca değişik dosyaları repo → diğer kopyalar yönünde yazar
(tek yönlü; kurulum/surface-z'deki yerel düzenlemeler ezilmeden önce
fark listesi gösterilir ve onay istenir).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_COPY_REPO = REPO_ROOT / "Derin_Tarama_Asistan"
DEFAULT_COPY_SURFACE = Path(r"D:\surface-z\Surface-z")
DEFAULT_COPY_INSTALLED = Path(r"C:\votex\Derin_Tarama_Asistan")

COPY_NAMES = ("repo", "surface-z", "kurulum")

# Ortam-bağımlı / üretilen içerik — hash denetimi dışında
EXCLUDED_DIRS = {"__pycache__", ".venv_jarvis", ".venv", "logs", "config", ".git", ".idea", ".vscode"}
EXCLUDED_FILES = {"api_keys.json", "boot.log", "dta-stdout.log", "dta-stderr.log"}

HASH_CHUNK = 1 << 20


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(HASH_CHUNK):
            h.update(chunk)
    return h.hexdigest()


def copy_paths(root: Path) -> list[Path] | None:
    """Kopya kökündeki denetlenebilir dosyalar (göreli yollarla)."""
    if not root.is_dir():
        return None
    out: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDED_DIRS]
        for name in filenames:
            if name in EXCLUDED_FILES:
                continue
            p = Path(dirpath) / name
            out.append(p.relative_to(root))
    return out


def build_maps(copies: dict[str, Path]) -> tuple[dict[str, dict[str, str]], list[str]]:
    """Her kopya için {göreli yol: sha256}; eksik kopyalar raporlanır."""
    maps: dict[str, dict[str, str]] = {}
    missing: list[str] = []
    for name in COPY_NAMES:
        root = copies[name]
        rels = copy_paths(root)
        if rels is None:
            missing.append(name)
            continue
        maps[name] = {str(rel): sha256(root / rel) for rel in sorted(rels)}
    return maps, missing


def diff_against(reference: str, maps: dict[str, dict[str, str]]) -> dict[str, dict[str, list[str]]]:
    """Referans kopyaya göre her kopyanın fark listesi."""
    ref = maps.get(reference, {})
    out: dict[str, dict[str, list[str]]] = {}
    for name in COPY_NAMES:
        if name == reference or name not in maps:
            continue
        cur = maps[name]
        only_ref = sorted(set(ref) - set(cur))
        only_cur = sorted(set(cur) - set(ref))
        changed = sorted(
            rel for rel in set(ref) & set(cur) if ref[rel] != cur[rel]
        )
        out[name] = {"missing": only_ref, "extra": only_cur, "changed": changed}
    return out


def print_report(reference: str, copies: dict[str, Path], maps, diffs, missing) -> int:
    print(f"DTA üç kopya senkron denetimi — referans: {reference}")
    for name in COPY_NAMES:
        root = copies[name]
        if name in missing:
            print(f"  [YOK]    {name}: {root} bulunamadı")
        else:
            print(f"  [OK]     {name}: {root} — {len(maps[name])} dosya")
    print("-" * 72)

    problems = 0
    for name, d in diffs.items():
        total = len(d["missing"]) + len(d["extra"]) + len(d["changed"])
        if total == 0:
            print(f"  [SENKRON] {name} — referansla birebir")
            continue
        problems += total
        print(f"  [FARK]   {name}: {total} dosya farklı")
        for rel in d["changed"][:15]:
            print(f"     ~ {rel}")
        for rel in d["missing"][:10]:
            print(f"     - {rel} (referansta var, burada yok)")
        for rel in d["extra"][:10]:
            print(f"     + {rel} (yalnız burada var)")
        shown = sum(min(len(d[k]), lim) for k, lim in (("changed", 15), ("missing", 10), ("extra", 10)))
        if shown < total:
            print(f"     … ve {total - shown} dosya daha")
    print("-" * 72)
    if problems == 0 and not missing:
        print("SONUÇ: ÜÇ KOPYA SENKRON ✓")
        return 0
    print(f"SONUÇ: {problems} dosya farkı" + (", eksik kopya(lar) var" if missing else ""))
    return 1


def do_sync(reference: str, copies: dict[str, Path], diffs, assume_yes: bool) -> int:
    """Referanstan diğer kopyalara değişen dosyaları yazar."""
    ref_root = copies[reference]
    written = 0
    for name, d in diffs.items():
        if not (d["changed"] or d["missing"]):
            continue
        target_root = copies[name]
        rels = sorted(set(d["changed"]) | set(d["missing"]))
        print(f"[sync] {reference} → {name}: {len(rels)} dosya")
        if not assume_yes:
            for rel in rels[:20]:
                print(f"    {rel}")
            if len(rels) > 20:
                print(f"    … ve {len(rels) - 20} dosya daha")
            answer = input(f"  {name} kopyasına yazılsın mı? [e/H] ").strip().lower()
            if answer not in ("e", "evet", "y", "yes"):
                print(f"  [atlandı] {name}")
                continue
        # Hedefte eksik alt klasörleri oluştur
        for rel in rels:
            src = ref_root / rel
            dst = target_root / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            written += 1
    print(f"[sync] {written} dosya yazıldı")
    return 0


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    ap = argparse.ArgumentParser(description="DTA üç kopya SHA-256 senkron denetimi")
    ap.add_argument("--repo", default=str(DEFAULT_COPY_REPO), help="repo kopya yolu")
    ap.add_argument("--surface", default=str(DEFAULT_COPY_SURFACE), help="surface-z kopya yolu")
    ap.add_argument("--installed", default=str(DEFAULT_COPY_INSTALLED), help="kurulu kopya yolu")
    ap.add_argument("--set", dest="reference", choices=COPY_NAMES, default="repo",
                    help="referans kopya (varsayılan: repo)")
    ap.add_argument("--sync", action="store_true", help="farklı dosyaları referanstan kopyala")
    ap.add_argument("--yes", action="store_true", help="onay sorma (sync ile)")
    ap.add_argument("--json", action="store_true", help="makine-okur çıktı")
    args = ap.parse_args()

    copies = {
        "repo": Path(args.repo),
        "surface-z": Path(args.surface),
        "kurulum": Path(args.installed),
    }

    maps, missing = build_maps(copies)
    if args.reference in missing:
        print(f"Referans kopya bulunamadı: {copies[args.reference]}")
        return 1
    diffs = diff_against(args.reference, maps)

    if args.json:
        print(json.dumps({
            "reference": args.reference,
            "copies": {k: str(v) for k, v in copies.items()},
            "file_counts": {k: len(v) for k, v in maps.items()},
            "missing_copies": missing,
            "diffs": diffs,
        }, ensure_ascii=False, indent=2))
        problems = sum(len(x["changed"]) + len(x["missing"]) + len(x["extra"]) for x in diffs.values())
        return 0 if problems == 0 and not missing else 1

    code = print_report(args.reference, copies, maps, diffs, missing)
    if args.sync and code != 0:
        code = do_sync(args.reference, copies, diffs, assume_yes=args.yes)
        # tekrar denetle
        maps2, missing2 = build_maps(copies)
        diffs2 = diff_against(args.reference, maps2)
        problems = sum(len(x["changed"]) + len(x["missing"]) + len(x["extra"]) for x in diffs2.values())
        print("[yeniden denetim]", "SENKRON ✓" if problems == 0 and not missing2 else f"{problems} fark kaldı")
        return 0 if problems == 0 and not missing2 else 1
    return code


if __name__ == "__main__":
    sys.exit(main())
