"""ELIC parser birim testleri."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from actions.elic_parser import (
    analyze_heatmap,
    extract_physics_signal,
    heatmap_roi,
    parse_depth_label_text,
)

BASE = ROOT


def test_yellow_is_wall_not_metal():
    yellow = extract_physics_signal(220, 200, 40)
    assert yellow["type"] == "wall"
    red = extract_physics_signal(220, 50, 30)
    assert red["type"] == "metal"


def test_extract_physics_signal_metal():
    sig = extract_physics_signal(255, 40, 40)
    assert sig["type"] == "metal"
    assert 65 <= sig["c"] <= 100


def test_extract_physics_signal_void():
    sig = extract_physics_signal(40, 40, 200)
    assert sig["type"] == "void"
    assert 1 <= sig["c"] <= 20


def test_heatmap_roi():
    roi = heatmap_roi(800, 600)
    assert roi["x1"] > roi["x0"]
    assert roi["y1"] > roi["y0"]


def test_parse_depth_label():
    assert parse_depth_label_text("Depth: 2m 45cm") == 2.45
    assert parse_depth_label_text("Depth: 3.5m") == 3.5
    assert parse_depth_label_text("") is None


def test_analyze_heatmap_sample():
    sample = BASE / "test.png"
    if not sample.exists():
        return
    result = analyze_heatmap(sample)
    assert "heatmap_stats" in result
    assert "dominant_signals" in result
    stats = result["heatmap_stats"]
    total = stats.get("metal_pct", 0) + stats.get("void_pct", 0) + stats.get("soil_pct", 0)
    assert total >= 0
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    test_extract_physics_signal_metal()
    test_extract_physics_signal_void()
    test_yellow_is_wall_not_metal()
    test_heatmap_roi()
    test_parse_depth_label()
    test_analyze_heatmap_sample()
    print("elic_parser tests OK")
