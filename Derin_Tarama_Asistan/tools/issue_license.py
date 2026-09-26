#!/usr/bin/env python3
"""Eski giriş — DFT issuer'a delege eder."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VOTEX_MOD = Path(r"C:\votex\modules")
sys.path.insert(0, str(VOTEX_MOD))
sys.path.insert(0, str(ROOT))

from dft_license_issuer.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
