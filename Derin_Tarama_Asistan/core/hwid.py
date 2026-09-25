"""Windows cihaz parmak izi (HWID) — tablette asla WMIC/uuid ile kilitlenmesin."""

from __future__ import annotations

import hashlib
import platform

_cached_hash: str | None = None
_cached_short: str | None = None


def _machine_guid() -> str:
    if platform.system() != "Windows":
        return ""
    try:
        import winreg

        with winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\Cryptography",
        ) as key:
            value, _ = winreg.QueryValueEx(key, "MachineGuid")
            return str(value or "").strip()
    except Exception:
        return ""


def get_hwid_components() -> dict[str, str]:
    # Sadece registry — uuid.getnode() ve WMIC Atom tablette saniyelerce asılır.
    guid = _machine_guid()
    return {
        "machine_guid": guid or "no-guid",
        "host": (platform.node() or "unknown").strip().lower(),
        "system": platform.system() or "",
    }


def get_hwid_hash() -> str:
    global _cached_hash
    if _cached_hash:
        return _cached_hash
    parts = get_hwid_components()
    blob = "|".join(f"{k}={parts.get(k, '')}" for k in sorted(parts))
    _cached_hash = hashlib.sha256(blob.encode("utf-8")).hexdigest()
    return _cached_hash


def get_hwid_short() -> str:
    global _cached_short
    if _cached_short:
        return _cached_short
    _cached_short = get_hwid_hash()[:16].upper()
    return _cached_short


def clear_hwid_cache() -> None:
    global _cached_hash, _cached_short
    _cached_hash = None
    _cached_short = None
