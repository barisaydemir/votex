"""VOTEX ekran kılavuzu / prompt smoke."""

from __future__ import annotations

from pathlib import Path

from actions.votex_vision import VOTEX_SCREEN_GUIDE, _build_votex_prompt, _load_guide


def test_votex_guide_loads():
    g = _load_guide()
    assert "VOTEX" in g.upper() or "votex" in g.lower()
    assert "mavi" in g.lower() or "INTEL" in g
    assert len(g) > 100


def test_votex_prompt_mentions_panels():
    p = _build_votex_prompt("VOTEX ekranini yorumla", "Votex — Tactical Command")
    assert "VOTEX" in p
    assert "OPS" in p or "STAGE" in p or "3D" in p
    assert "VOTEX ekranini yorumla" in p


def test_fallback_guide_nonempty():
    assert "colormap" in VOTEX_SCREEN_GUIDE.lower() or "mavi" in VOTEX_SCREEN_GUIDE.lower()


def test_schema_md_exists():
    path = Path(__file__).resolve().parents[1] / "schema" / "VOTEX_EKRAN.md"
    assert path.is_file(), path


if __name__ == "__main__":
    test_votex_guide_loads()
    test_votex_prompt_mentions_panels()
    test_fallback_guide_nonempty()
    test_schema_md_exists()
    print("votex vision guide OK")
