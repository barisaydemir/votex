#!/usr/bin/env python3
"""Aile lisansi: ayni hedefin DTA + Votex anahtarlarini uretir.

  # Bu makine
  python tools/issue_family_license.py --days 365 --activate

  # Hedef PC (DTA HWID + Votex cihaz kodu)
  python tools/issue_family_license.py --days 365 \\
    --dta-hwid <sha256> --votex-device ABCD-EF01-2345
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from core.hwid import get_hwid_hash, get_hwid_short  # noqa: E402
from core.license_manager import activate_license_token, issue_license_token  # noqa: E402
from core.license_policy import PRODUCT_FAMILY  # noqa: E402

VOTEX_SECRET = b"VOTEX-PRO-SECRET-KEY-2026-X9"


def _votex_sign(device_code: str, exp_str: str) -> str:
    payload = f"{device_code}:{exp_str}".encode("utf-8")
    dig = hmac.new(VOTEX_SECRET, payload, hashlib.sha256).hexdigest().upper()
    return dig[:16]


def _format_votex_key(raw: str) -> str:
    clean = raw.replace("-", "").upper()
    if len(clean) < 22:
        return raw
    return f"{clean[0:6]}-{clean[6:10]}-{clean[10:14]}-{clean[14:18]}-{clean[18:22]}"


def build_votex_key(device_code: str, days: int) -> str:
    """Votex HMAC anahtari (Rust ile ayni sema). days<=0 veya unlimited → 999999."""
    code = (
        str(device_code or "")
        .strip()
        .upper()
        .replace(" ", "")
    )
    if not code:
        raise ValueError("Votex cihaz kodu bos")
    if days <= 0 or days >= 900_000:
        exp_str = "999999"
    else:
        expiry = datetime.now(timezone.utc).date() + timedelta(days=max(1, days))
        # YYMMDD (2000+)
        exp_str = expiry.strftime("%y%m%d")
    raw = exp_str + _votex_sign(code, exp_str)
    return _format_votex_key(raw)


def _try_local_votex_device() -> str | None:
    """Votex get_device_code Rust ile birebir degil; hwid hash'ten turetme yok.

    Yerel cihazda kullanici Votex UI'dan kodu kopyalar. Opsiyonel: machine_uid yoksa None.
    """
    try:
        import machine_uid  # type: ignore

        raw = machine_uid.get() or ""
        hexu = hashlib.sha256(raw.encode("utf-8")).hexdigest().upper()
        return f"{hexu[0:4]}-{hexu[4:8]}-{hexu[8:12]}"
    except Exception:
        pass
    # Windows MachineGuid-based fallback (yaklasik; hedefte Votex kodu tercih edilir)
    try:
        import winreg

        with winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\Cryptography",
        ) as key:
            guid, _ = winreg.QueryValueEx(key, "MachineGuid")
        hexu = hashlib.sha256(str(guid).encode("utf-8")).hexdigest().upper()
        return f"{hexu[0:4]}-{hexu[4:8]}-{hexu[8:12]}"
    except Exception:
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description="DTA + Votex aile lisansi")
    parser.add_argument("--mode", choices=["trial", "full", "oem"], default="full")
    parser.add_argument("--days", type=int, default=365)
    parser.add_argument("--customer", default="")
    parser.add_argument(
        "--dta-hwid",
        default="auto",
        help="auto = bu makine DTA HWID, veya tam SHA256",
    )
    parser.add_argument(
        "--votex-device",
        default="auto",
        help="auto = yerel tahmin, veya XXXX-XXXX-XXXX (Votex UI)",
    )
    parser.add_argument(
        "--activate",
        action="store_true",
        help="DTA license.dat bu makinede aktive et",
    )
    parser.add_argument(
        "--out",
        default="",
        help="JSON cikti yolu (varsayilan reports/family_license_*.json)",
    )
    args = parser.parse_args()

    dta_hwid = get_hwid_hash() if args.dta_hwid == "auto" else args.dta_hwid.strip()
    if args.votex_device == "auto":
        votex_dev = _try_local_votex_device()
        if not votex_dev:
            print(
                "[HATA] Votex cihaz kodu bulunamadi. --votex-device XXXX-XXXX-XXXX verin.",
                file=sys.stderr,
            )
            return 1
    else:
        votex_dev = args.votex_device.strip().upper()

    dta_token = issue_license_token(
        args.mode,
        args.days,
        hwid_hash=dta_hwid,
        customer=args.customer or "family",
        features=None,
    )
    # product_family isaretlemek icin payload yeniden: issue_license_token zaten product yaziyor
    votex_key = build_votex_key(votex_dev, args.days)

    bundle = {
        "product_family": PRODUCT_FAMILY,
        "issued_at": datetime.now(timezone.utc).isoformat(),
        "mode": args.mode,
        "days": args.days,
        "dta": {
            "hwid_hash": dta_hwid,
            "hwid_short": dta_hwid[:16].upper(),
            "token": dta_token,
        },
        "votex": {
            "device_code": votex_dev,
            "key": votex_key,
        },
        "instructions": [
            "DTA: LISANS AKTIVASYONU ekranina dta.token yapistir (config/license.dat).",
            "Votex: cihaz kodunu dogrula, votex.key yapistir (Aktif Et).",
            "Saha paketi icin once: python tools/license_enforce.py on --also-votex C:\\Votexyeni",
        ],
    }

    out = Path(args.out) if args.out else (
        ROOT / "reports" / f"family_license_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(bundle, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"Family: {PRODUCT_FAMILY}")
    print(f"Mode: {args.mode} · Days: {args.days}")
    print(f"DTA HWID short: {dta_hwid[:16].upper()}")
    print(f"Votex device: {votex_dev}")
    print()
    print("=== DTA TOKEN ===")
    print(dta_token)
    print()
    print("=== VOTEX KEY ===")
    print(votex_key)
    print()
    print(f"JSON: {out}")

    if args.activate:
        if dta_hwid != get_hwid_hash():
            print("UYARI: --activate sadece bu makinenin DTA HWID icin.")
            return 1
        ok, msg = activate_license_token(dta_token)
        print(f"DTA activate: {msg}")
        return 0 if ok else 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
