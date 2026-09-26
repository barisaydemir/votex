"""Lisans imzalama ve dogrulama (Faz A: HMAC)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from typing import Any

# Uretim build oncesi degistirin / PyArmor ile gizleyin.
_SIGNING_SEED = b"ELIC-Asistan-SIGN-v1-surface-z"


def signing_key() -> bytes:
    return hashlib.sha256(_SIGNING_SEED).digest()


def canonical_json(data: dict[str, Any]) -> str:
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sign_license_payload(payload: dict[str, Any]) -> str:
    body = canonical_json(payload)
    digest = hmac.new(signing_key(), body.encode("utf-8"), hashlib.sha256).hexdigest()
    envelope = {"payload": payload, "sig": digest}
    raw = json.dumps(envelope, ensure_ascii=False).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def verify_license_token(token: str) -> dict[str, Any] | None:
    if not token:
        return None
    try:
        pad = "=" * (-len(token) % 4)
        raw = base64.urlsafe_b64decode((token + pad).encode("ascii"))
        envelope = json.loads(raw.decode("utf-8"))
        payload = envelope.get("payload")
        sig = str(envelope.get("sig", ""))
        if not isinstance(payload, dict) or not sig:
            return None
        body = canonical_json(payload)
        expected = hmac.new(signing_key(), body.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, sig):
            return None
        return payload
    except Exception:
        return None
