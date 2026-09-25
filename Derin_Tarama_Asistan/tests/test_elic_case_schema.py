"""Faz 0: ELIC Case schema 1.0 dondurma testleri."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from actions.elic_case_schema import SCHEMA_VERSION, validate_case_dict, build_manifest
from actions.elic_case_export import export_case_from_image, validate_case_path, CASES_DIR


SAMPLE = ROOT / "tests" / "sample_elic_screen.png"


def test_schema_version_frozen():
    assert SCHEMA_VERSION == "1.0"
    m = build_manifest(capture_time="2026-07-14T05:30:00+03:00")
    assert m["schema_version"] == "1.0"
    assert m["schema_id"] == "elic_case"


def test_validate_rejects_bad_version():
    errs = validate_case_dict(
        manifest={"schema_version": "0.9", "schema_id": "elic_case", "source": "x",
                  "capture_time": "t", "product": {}},
        analysis={"heatmap_stats": {
            "metal_pct": 0, "void_pct": 0, "soil_pct": 0, "wall_pct": 0, "glow_pct": 0,
        }, "hud": {}},
        inference={"hypotheses": [], "summary": "x", "disclaimer": "d"},
        has_screen=True,
    )
    assert any("schema_version" in e for e in errs)


def test_export_sample_case():
    assert SAMPLE.is_file(), f"sample yok: {SAMPLE}"
    out = export_case_from_image(
        SAMPLE,
        make_zip=True,
        cases_dir=CASES_DIR / "_faz0_sample",
    )
    assert out["ok"], out.get("errors")
    zip_path = Path(out["zip_path"])
    assert zip_path.is_file()
    check = validate_case_path(zip_path)
    assert check["ok"], check.get("errors")
    case_dir = Path(out["case_dir"])
    for name in ("manifest.json", "analysis.json", "inference.json", "voice_summary.txt", "screen.png"):
        assert (case_dir / name).is_file(), name
    manifest = json.loads((case_dir / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["schema_version"] == "1.0"
    print("FAZ0 OK", out["case_id"], "zip=", zip_path)


if __name__ == "__main__":
    test_schema_version_frozen()
    test_validate_rejects_bad_version()
    test_export_sample_case()
    print("elic_case schema Faz 0 tests OK")
