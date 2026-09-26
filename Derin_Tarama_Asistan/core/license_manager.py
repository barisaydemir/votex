# Derin Tarama Asistan — Barış Aydemir / Digital Future Tech
"""Lisans yonetimi: DFT ortak modüle delege (demo/m1/m3/m6/y1).

Geriye uyumlu API korunur. Asıl mantık:
  C:\\votex\\modules\\dft_license
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

# Ortak DFT lisans runtime
_DFT_MODULES = Path(r"C:\votex\modules")
if _DFT_MODULES.is_dir() and str(_DFT_MODULES) not in sys.path:
    sys.path.insert(0, str(_DFT_MODULES))

try:
    from dft_license import (  # type: ignore
        activate_license_token,
        check_tool_allowed,
        get_hwid_hash,
        get_hwid_short,
        get_license_status,
        license_banner_text,
        max_corners_allowed,
        record_tool_usage,
        require_valid_license,
    )
    from dft_license.schema import PLAN_DAYS, features_for_plan, normalize_plan
    from dft_license.store import is_enforcement_enabled

    _DFT_OK = True
except Exception as _e:  # pragma: no cover
    _DFT_OK = False
    _DFT_IMPORT_ERR = _e

# --- Geriye uyumluluk: eski issue API (mümkünse issuer) ---
DEFAULT_FEATURES = {
    "trial": features_for_plan("demo") if _DFT_OK else {},
    "demo": features_for_plan("demo") if _DFT_OK else {},
    "full": features_for_plan("y1") if _DFT_OK else {},
    "oem": features_for_plan("y1") if _DFT_OK else {},
    "m1": features_for_plan("m1") if _DFT_OK else {},
    "m3": features_for_plan("m3") if _DFT_OK else {},
    "m6": features_for_plan("m6") if _DFT_OK else {},
    "y1": features_for_plan("y1") if _DFT_OK else {},
}


def issue_license_token(
    mode: str,
    days: int,
    *,
    hwid_hash: str | None = None,
    customer: str = "",
    features: dict[str, Any] | None = None,
) -> str:
    """Üretim için issuer kullanın; bu sarmalayıcı geliştirme kolaylığı."""
    issuer_path = _DFT_MODULES / "dft_license_issuer"
    if str(_DFT_MODULES) not in sys.path:
        sys.path.insert(0, str(_DFT_MODULES))
    from dft_license_issuer.issue import issue_token  # type: ignore

    plan = normalize_plan(mode) if _DFT_OK else (mode or "demo")
    return issue_token(
        plan, days=days, hwid_hash=hwid_hash, customer=customer, features=features
    )


def build_license_payload(
    mode: str,
    days: int,
    *,
    hwid_hash: str | None = None,
    customer: str = "",
    features: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from dft_license_issuer.issue import build_payload  # type: ignore

    plan = normalize_plan(mode) if _DFT_OK else (mode or "demo")
    return build_payload(
        plan, days=days, hwid_hash=hwid_hash, customer=customer, features=features
    )


if not _DFT_OK:  # pragma: no cover
    raise ImportError(
        f"dft_license yüklenemedi ({_DFT_MODULES}): {_DFT_IMPORT_ERR}. "
        "C:\\votex\\modules\\dft_license kurulu olmalı."
    )

__all__ = [
    "activate_license_token",
    "check_tool_allowed",
    "get_hwid_hash",
    "get_hwid_short",
    "get_license_status",
    "license_banner_text",
    "max_corners_allowed",
    "record_tool_usage",
    "require_valid_license",
    "issue_license_token",
    "build_license_payload",
    "is_enforcement_enabled",
    "DEFAULT_FEATURES",
    "PLAN_DAYS",
]
