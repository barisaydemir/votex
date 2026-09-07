# Derin Tarama Asistan — portable lisans (saha paketi)
"""Lisans: once paket ici vendor/dft_license, sonra C:\\votex\\modules."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

_BASE = Path(__file__).resolve().parent.parent
_CANDIDATES = [
    _BASE / "vendor",
    _BASE,  # dft_license/ dogrudan paket kokunde olabilir
    Path(r"C:\votex\modules"),
]

_DFT_MODULES: Path | None = None
for _cand in _CANDIDATES:
    if (_cand / "dft_license").is_dir():
        _DFT_MODULES = _cand
        break

if _DFT_MODULES is not None and str(_DFT_MODULES) not in sys.path:
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
    raise RuntimeError(
        "Saha paketinde lisans uretilmez. Build PC'de dft_license_issuer kullanin."
    )


def build_license_payload(
    mode: str,
    days: int,
    *,
    hwid_hash: str | None = None,
    customer: str = "",
    features: dict[str, Any] | None = None,
) -> dict[str, Any]:
    raise RuntimeError(
        "Saha paketinde lisans uretilmez. Build PC'de dft_license_issuer kullanin."
    )


if not _DFT_OK:  # pragma: no cover
    raise ImportError(
        f"dft_license yuklenemedi (aranan: {[str(c) for c in _CANDIDATES]}): {_DFT_IMPORT_ERR}. "
        "vendor\\dft_license paket icinde olmali."
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
    "is_enforcement_enabled",
    "PLAN_DAYS",
    "features_for_plan",
    "normalize_plan",
    "DEFAULT_FEATURES",
    "issue_license_token",
    "build_license_payload",
]
