"""Cift ekran (ELIC + VOTEX) algilama smoke."""

from __future__ import annotations

from actions.screen_workspace import (
    _elic_candidates,
    _votex_candidates,
    detect_open_screens,
)


def test_candidates_include_votex_and_elic():
    assert any("elic" in c.lower() or "proton" in c.lower() for c in _elic_candidates())
    assert any("votex" in c.lower() for c in _votex_candidates())


def test_detect_open_screens_shape():
    d = detect_open_screens()
    assert "elic_open" in d and "votex_open" in d
    assert isinstance(d["elic_open"], bool)
    assert isinstance(d["votex_open"], bool)


if __name__ == "__main__":
    test_candidates_include_votex_and_elic()
    test_detect_open_screens_shape()
    print("detect", detect_open_screens())
    print("workspace detect OK")
