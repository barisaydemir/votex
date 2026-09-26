"""ELIC cikarim motoru birim testleri."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from actions.elic_parser import extract_physics_signal
from actions.elic_inference import infer_scene, format_inference_summary, should_recommend_thermal_from_inference


def test_wall_and_glow_types():
    wall = extract_physics_signal(240, 240, 245)
    assert wall["type"] == "wall"
    glow = extract_physics_signal(120, 230, 140)
    assert glow["type"] in ("glow", "soil")
    metal = extract_physics_signal(255, 40, 40)
    assert metal["type"] == "metal"
    void = extract_physics_signal(40, 40, 200)
    assert void["type"] == "void"


def test_filament_is_glow_not_wall():
    filament = extract_physics_signal(210, 235, 215)
    assert filament["type"] == "glow"
    white = extract_physics_signal(240, 240, 245)
    assert white["type"] == "wall"


def test_glow_tunnel_hypothesis():
    analysis = {
        "heatmap_stats": {
            "metal_pct": 1.0,
            "void_pct": 0.5,
            "soil_pct": 90.0,
            "wall_pct": 0.0,
            "glow_pct": 0.4,
        },
        "spatial_relations": [],
        "surface_ref_ok": True,
        "active_sensor": "magnetic",
    }
    inf = infer_scene(analysis)
    ids = {h["id"] for h in inf["hypotheses"]}
    assert "structure_glow" in ids
    summary = format_inference_summary(inf).lower()
    assert "oda" in summary or "tunel" in summary or "isik" in summary
    assert should_recommend_thermal_from_inference(inf)


def test_metal_in_void_hypothesis():
    analysis = {
        "heatmap_stats": {
            "metal_pct": 8.0,
            "void_pct": 5.0,
            "soil_pct": 60.0,
            "wall_pct": 2.0,
            "glow_pct": 0.5,
        },
        "spatial_relations": [{"type": "metal_in_void", "hits": 4}],
        "surface_ref_ok": True,
        "depth_m": 0.22,
        "heading_cardinal": "NW",
        "active_sensor": "magnetic",
        "strongest_anomaly": {"type": "metal", "region": "sag"},
    }
    inf = infer_scene(analysis)
    ids = {h["id"] for h in inf["hypotheses"]}
    assert "metal_in_void" in ids or "metal_candidate" in ids
    assert "void_candidate" in ids
    assert should_recommend_thermal_from_inference(inf)


if __name__ == "__main__":
    test_wall_and_glow_types()
    test_filament_is_glow_not_wall()
    test_glow_tunnel_hypothesis()
    test_metal_in_void_hypothesis()
    print("elic_inference tests OK")
