# Derin Tarama Asistan — Barış Aydemir / Digital Future Tech
from __future__ import annotations

import json
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
CONFIG_DIR = BASE_DIR / "config"
CONFIG_PATH = CONFIG_DIR / "api_keys.json"

# Uretici kimligi (tek yerden degisir)
VENDOR_AUTHOR = "Barış Aydemir"
VENDOR_ORG = "Digital Future Tech"
VENDOR_CREDIT = "Bu yazılım Barış Aydemir — Digital Future Tech üretimidir."
VENDOR_CREDIT_SHORT = "© Barış Aydemir · Digital Future Tech"

# Urun adi
PRODUCT_NAME = "Derin Tarama Asistan"
PRODUCT_SHORT = "DTA"

DEFAULT_CONFIG = {
    "gemini_api_key": "",
    "voice": "Charon",
    "assistant_name": PRODUCT_NAME,
    "elic_window_title": "Proton ELIC",
    "elic_depth_cap_m": 10,
    "ui_profile": "tablet",
    "youtube_api_key": "",
    "youtube_channel_handle": "",
}


def get_vendor_credit(short: bool = False) -> str:
    return VENDOR_CREDIT_SHORT if short else VENDOR_CREDIT


def get_product_name() -> str:
    return str(get_app_config_value("assistant_name", PRODUCT_NAME) or PRODUCT_NAME)


def load_app_config() -> dict:
    config = dict(DEFAULT_CONFIG)
    try:
        raw = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            config.update(raw)
    except Exception:
        pass
    return config


def save_app_config(updates: dict) -> dict:
    config = load_app_config()
    for key, value in (updates or {}).items():
        if value is None:
            continue
        config[key] = value
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(
        json.dumps(config, indent=4, ensure_ascii=False),
        encoding="utf-8",
    )
    return config


def get_app_config_value(key: str, default=None):
    return load_app_config().get(key, default)


def is_panel_hide_quiet() -> bool:
    """VOTEX paneli pencereyi tray'e gizlediginde sesli yanit otomatik susulsun mu?"""
    return bool(get_app_config_value("panel_hide_quiet_audio", True))


def set_panel_hide_quiet(enabled: bool) -> None:
    save_app_config({"panel_hide_quiet_audio": bool(enabled)})


def has_gemini_api_key() -> bool:
    value = str(get_app_config_value("gemini_api_key", "") or "").strip()
    return bool(value)


def is_tablet_ui() -> bool:
    return str(get_app_config_value("ui_profile", "tablet") or "tablet").strip().lower() == "tablet"
