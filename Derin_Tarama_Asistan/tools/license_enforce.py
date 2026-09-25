#!/usr/bin/env python3
"""Lisans zorunlulugunu ac/kapat (DTA + istege bagli Votex).

  python tools/license_enforce.py status
  python tools/license_enforce.py off
  python tools/license_enforce.py on
  python tools/license_enforce.py on --also-votex C:\\Votexyeni
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from core.license_policy import (  # noqa: E402
    POLICY_PATH,
    is_enforcement_enabled,
    policy_status_line,
    set_enforcement,
)


def _write_votex_policy(votex_root: Path, enforce: bool) -> Path:
    """Votex license_policy.json (repo + src-tauri)."""
    payload = {
        "enforce": bool(enforce),
        "product_family": "dft_elic_votex",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    written: list[Path] = []
    for rel in ("license_policy.json", "src-tauri/license_policy.json"):
        path = votex_root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        written.append(path)
    return written[0]


def main() -> int:
    parser = argparse.ArgumentParser(description="DFT lisans enforce anahtari")
    parser.add_argument("action", choices=["on", "off", "status"])
    parser.add_argument(
        "--also-votex",
        default="",
        help=r"Votex repo kokü (orn. C:\Votexyeni) — ayni enforce yazilir",
    )
    args = parser.parse_args()

    if args.action == "status":
        print(policy_status_line())
        print(f"Policy file: {POLICY_PATH}")
        if args.also_votex:
            vp = Path(args.also_votex)
            print(f"Votex root: {vp} exists={vp.is_dir()}")
        return 0

    enabled = args.action == "on"
    set_enforcement(enabled)
    print(policy_status_line())
    print(f"Yazildi: {POLICY_PATH}")

    if args.also_votex:
        votex = Path(args.also_votex)
        if not votex.is_dir():
            print(f"[HATA] Votex klasoru yok: {votex}", file=sys.stderr)
            return 1
        out = _write_votex_policy(votex, enabled)
        print(f"Votex policy yazildi: {out} (ve src-tauri/)")
    elif enabled:
        print("Not: Votex icin --also-votex C:\\Votexyeni ekleyin.")

    print(
        "enforce=ON — hedef PC'de gecerli lisans gerekir."
        if enabled
        else "enforce=OFF — gelistirme acik; boot/tool/Rust kilidi yok."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
