"""DTA runtime paths shared by launcher and bootstrap."""
from __future__ import annotations

import os
from pathlib import Path


def user_data_dir() -> Path:
    root = os.environ.get("DTA_USER_DATA_DIR")
    if root:
        return Path(root)
    appdata = os.environ.get("APPDATA") or os.environ.get("LOCALAPPDATA")
    if appdata:
        return Path(appdata) / "DFT" / "DerinTaramaAsistan"
    return Path.home() / ".dft" / "DerinTaramaAsistan"
