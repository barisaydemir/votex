# Derin Tarama Asistan — ortak lisans politikası (DTA + Votex)
"""enforce=false → geliştirme açık; enforce=true → saha kilidi.

Öncelik: ortam değişkeni DFT_LICENSE_ENFORCE > config/license_policy.json
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PRODUCT_FAMILY = "dft_elic_votex"

BASE_DIR = Path(__file__).resolve().parent.parent
POLICY_PATH = BASE_DIR / "config" / "license_policy.json"

_ENV_KEY = "DFT_LICENSE_ENFORCE"


def _parse_env_bool(raw: str | None) -> bool | None:
    if raw is None or str(raw).strip() == "":
        return None
    v = str(raw).strip().lower()
    if v in ("1", "true", "yes", "on"):
        return True
    if v in ("0", "false", "no", "off"):
        return False
    return None


def default_policy() -> dict[str, Any]:
    return {
        "enforce": False,
        "product_family": PRODUCT_FAMILY,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def load_policy() -> dict[str, Any]:
    data = default_policy()
    try:
        if POLICY_PATH.exists():
            raw = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                data.update(raw)
    except Exception:
        pass
    env = _parse_env_bool(os.environ.get(_ENV_KEY))
    if env is not None:
        data["enforce"] = env
    data["product_family"] = data.get("product_family") or PRODUCT_FAMILY
    data["enforce"] = bool(data.get("enforce", False))
    return data


def save_policy(policy: dict[str, Any]) -> dict[str, Any]:
    POLICY_PATH.parent.mkdir(parents=True, exist_ok=True)
    out = default_policy()
    out.update(policy or {})
    out["enforce"] = bool(out.get("enforce", False))
    out["product_family"] = out.get("product_family") or PRODUCT_FAMILY
    out["updated_at"] = datetime.now(timezone.utc).isoformat()
    POLICY_PATH.write_text(
        json.dumps(out, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return out


def is_enforcement_enabled() -> bool:
    return bool(load_policy().get("enforce", False))


def set_enforcement(enabled: bool) -> dict[str, Any]:
    policy = load_policy()
    # Env üstünlüğü dosyayı bastırır; yine de dosyayı güncelle (kalıcı tercih)
    policy["enforce"] = bool(enabled)
    return save_policy(policy)


def policy_status_line() -> str:
    p = load_policy()
    env = os.environ.get(_ENV_KEY)
    src = f"env={env}" if env not in (None, "") else f"file={POLICY_PATH.name}"
    state = "ACIK (saha kilidi)" if p["enforce"] else "KAPALI (gelistirme)"
    return f"enforce={p['enforce']} · {state} · {src} · family={p.get('product_family')}"
